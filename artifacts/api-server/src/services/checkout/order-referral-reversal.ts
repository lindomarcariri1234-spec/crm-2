import { referralsTable, clientsTable, referralCommissionsTable } from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { REFERRAL_STATUS } from "@workspace/permissions";
import { logger } from "../../lib/logger";
import type { DbExecutor } from "../../lib/reservation-payments";

/**
 * Reverses a COMPLETED referral that was credited on a **product-only** store
 * order (no trip reservation). Call this when such an order is refunded or
 * manually cancelled by an admin.
 *
 * ### Why this function exists
 * Referral PENDING rows are promoted to COMPLETED by `applyDeferredOrderCredits`
 * (called from `runPostPaymentSideEffects` at payment time). For trip-based
 * orders the promotion sets `reservationId` on the referral row, and the
 * reversal fires later through the reservation-cancellation path in
 * `reservations.ts` (Reversal 3, keyed on `reservationId`).
 *
 * Product-only orders have no reservations, so `reservationId` stays `null`
 * on the referral row and the reservation-cancellation path never fires. This
 * function fills that gap.
 *
 * ### Row identification
 * `storeOrdersTable.pendingReferral.referralId` stores the DB row ID of the
 * PENDING referral inserted at checkout time and updated at payment time.
 * When present (orders placed after its introduction) the lookup uses
 * `id + tenantId + status=COMPLETED` — deterministic even when the same
 * referral code has multiple COMPLETED conversions.
 * For legacy orders without `referralId` the fallback uses
 * `code + tenantId + status=COMPLETED + reservationId IS NULL limit(1)`.
 *
 * ### Safety / idempotency
 * - The `isNull(reservationId)` guard in the fallback path scopes the lookup
 *   to product-only referrals and prevents accidentally reversing a
 *   trip-linked referral that belongs to the reservation-cancellation path.
 * - If the referral is already REVERSED or not found the call is a no-op.
 * - The caller (markOrderRefunded / manual-cancel handler) guards with
 *   `referralEffectsAppliedAt != null` so we never try to reverse a referral
 *   that was never promoted.
 *
 * @returns `true` when a reversal was actually written, `false` for a no-op.
 */
export async function reverseProductOnlyOrderReferral(
  tx: DbExecutor,
  args: {
    tenantId: string;
    orderId: string;
    referralCode: string;
    /** Preferred: DB row ID stored in `pendingReferral.referralId`. When
     *  present, the lookup is exact (id-based) even with multiple COMPLETED
     *  conversions for the same code. Falls back to code+reservationId=null
     *  for legacy orders that predate this field. */
    referralId: string | null | undefined;
    reversalReason: "order_refunded" | "order_cancelled";
  },
): Promise<boolean> {
  const { tenantId, orderId, referralCode, referralId, reversalReason } = args;

  // --- Primary path: exact row identified by its DB id ----------------------
  // Preferred for all orders that stored referralId in pendingReferral JSONB
  // (checkout flow as of the referral-deferral hardening). Deterministic even
  // when multiple product-only conversions exist for the same referral code.
  let referral: { id: string; referrerId: string; bonusAmount: string } | undefined;

  if (referralId) {
    const [row] = await tx
      .select({
        id: referralsTable.id,
        referrerId: referralsTable.referrerId,
        bonusAmount: referralsTable.bonusAmount,
      })
      .from(referralsTable)
      .where(
        and(
          eq(referralsTable.id, referralId),
          eq(referralsTable.tenantId, tenantId),
          eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
        ),
      )
      .limit(1);
    referral = row;
  }

  // --- Fallback path: code-based lookup for legacy orders -------------------
  // Orders placed before `referralId` was stored in pendingReferral JSONB.
  // The `isNull(reservationId)` filter is the critical boundary: it scopes
  // the lookup to product-only referrals and prevents touching trip-linked
  // ones (which have a non-null reservationId and are handled separately).
  if (!referral) {
    const [row] = await tx
      .select({
        id: referralsTable.id,
        referrerId: referralsTable.referrerId,
        bonusAmount: referralsTable.bonusAmount,
      })
      .from(referralsTable)
      .where(
        and(
          eq(referralsTable.tenantId, tenantId),
          eq(referralsTable.code, referralCode),
          eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
          isNull(referralsTable.reservationId),
        ),
      )
      .limit(1);
    referral = row;
  }

  if (!referral) {
    logger.debug(
      { tenantId, orderId, referralCode, referralId, reason: "not_found_or_already_reversed" },
      "[referral] Product-only order referral reversal skipped — no COMPLETED row found",
    );
    return false;
  }

  const bonusToReverse = Number(referral.bonusAmount);
  const reversalNow = new Date();

  // Decrement the referrer's counters. GREATEST / COALESCE guards match the
  // pattern used in reservations.ts Reversal 3 to prevent negative values.
  await tx
    .update(clientsTable)
    .set({
      successfulReferrals: sql`GREATEST(0, COALESCE(successful_referrals, 0) - 1)`,
      referralEarnings: sql`GREATEST(0, COALESCE(referral_earnings, 0) - ${bonusToReverse.toFixed(2)})`,
    })
    .where(
      and(
        eq(clientsTable.id, referral.referrerId),
        eq(clientsTable.tenantId, tenantId),
      ),
    );

  // Mark the referral as REVERSED.
  await tx
    .update(referralsTable)
    .set({
      status: REFERRAL_STATUS.REVERSED,
      reversalReason,
      reversalAt: reversalNow,
      updatedAt: reversalNow,
    })
    .where(eq(referralsTable.id, referral.id));
  await tx.update(referralCommissionsTable)
    .set({ status: "reversed", reversedAt: reversalNow, updatedAt: reversalNow })
    .where(and(
      eq(referralCommissionsTable.tenantId, tenantId),
      eq(referralCommissionsTable.referralId, referral.id),
      inArray(referralCommissionsTable.status, ["pending", "approved"]),
    ));

  logger.info(
    { tenantId, orderId, referralCode, referralId: referral.id, bonusToReverse, reversalReason },
    "[referral] Product-only order referral reversed",
  );

  return true;
}

// ---------------------------------------------------------------------------
// Batch reversal for trip-based storefront orders (refund webhooks)
// ---------------------------------------------------------------------------

/**
 * Reverses all COMPLETED referrals linked to a set of reservation IDs that
 * are being cancelled as part of a refund webhook. This is the webhooks.ts
 * equivalent of reservations.ts Reversal 3 — it runs inside `markOrderRefunded`
 * after the reservations are identified and BEFORE they are bulk-updated to
 * `cancelled`, so the caller must pass the cancellableIds that were found.
 *
 * ### Why a separate function
 * `markOrderRefunded` does a BULK reservation status update (not the
 * per-reservation PATCH handler) so it never reaches reservations.ts Reversal
 * 3. Trip-based storefront referrals set `reservationId` at deferred-credit
 * time, and the only thing that keys on `reservationId` is the
 * reservations.ts cancel path — which this webhook bypasses. This function
 * fills that gap.
 *
 * ### Idempotency
 * - Filters on `status = COMPLETED`; if a referral is already REVERSED it is
 *   naturally skipped.
 * - `GREATEST(0, COALESCE(...))` guards prevent negative client counters on
 *   double-runs.
 *
 * @returns Array of reversed referral IDs (empty when nothing was reversed).
 */
export async function reverseTripOrderReferrals(
  tx: DbExecutor,
  args: {
    tenantId: string;
    orderId: string;
    cancellableReservationIds: string[];
    reversalReason: "order_refunded" | "order_cancelled";
  },
): Promise<string[]> {
  const { tenantId, orderId, cancellableReservationIds, reversalReason } = args;
  if (cancellableReservationIds.length === 0) return [];

  const completedReferrals = await tx
    .select({
      id: referralsTable.id,
      referrerId: referralsTable.referrerId,
      bonusAmount: referralsTable.bonusAmount,
    })
    .from(referralsTable)
    .where(
      and(
        eq(referralsTable.tenantId, tenantId),
        inArray(referralsTable.reservationId, cancellableReservationIds),
        eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
      ),
    );

  if (completedReferrals.length === 0) return [];

  const reversedIds: string[] = [];
  const reversalNow = new Date();

  for (const ref of completedReferrals) {
    const bonusToReverse = Number(ref.bonusAmount);

    await tx
      .update(clientsTable)
      .set({
        successfulReferrals: sql`GREATEST(0, COALESCE(successful_referrals, 0) - 1)`,
        referralEarnings: sql`GREATEST(0, COALESCE(referral_earnings, 0) - ${bonusToReverse.toFixed(2)})`,
      })
      .where(
        and(
          eq(clientsTable.id, ref.referrerId),
          eq(clientsTable.tenantId, tenantId),
        ),
      );

    await tx
      .update(referralsTable)
      .set({
        status: REFERRAL_STATUS.REVERSED,
        reversalReason,
        reversalAt: reversalNow,
        updatedAt: reversalNow,
      })
      .where(eq(referralsTable.id, ref.id));
    await tx.update(referralCommissionsTable)
      .set({ status: "reversed", reversedAt: reversalNow, updatedAt: reversalNow })
      .where(and(
        eq(referralCommissionsTable.tenantId, tenantId),
        eq(referralCommissionsTable.referralId, ref.id),
        inArray(referralCommissionsTable.status, ["pending", "approved"]),
      ));

    reversedIds.push(ref.id);
  }

  logger.info(
    { tenantId, orderId, reversedCount: reversedIds.length, reversedIds, reversalReason },
    "[referral] Trip-based order referrals reversed on refund",
  );

  return reversedIds;
}

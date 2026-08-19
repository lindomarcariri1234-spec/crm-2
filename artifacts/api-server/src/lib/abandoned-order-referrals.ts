import { db, referralsTable, storeOrdersTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { REFERRAL_STATUS, STORE_PAYMENT_STATUS } from "@workspace/permissions";
import { sendAbandonedReferralAlertEmail } from "@workspace/email";
import { logger } from "./logger";

/**
 * How old a store order must be (in hours) before its PENDING referral row is
 * considered abandoned and eligible for reversal. 24 h gives customers enough
 * time to complete a payment intent that was opened close to the cutoff.
 */
export const ABANDONED_ORDER_THRESHOLD_HOURS = 24;

/**
 * Minimum number of total abandoned orders that must be found before an
 * all-skipped alert is considered significant. Prevents noise when only one
 * or two orders fall into this state.
 */
export const ABANDONED_REFERRAL_ALERT_THRESHOLD =
  parseInt(process.env["ABANDONED_REFERRAL_ALERT_THRESHOLD"] ?? "5", 10) || 5;

/**
 * Alert rate-limit: at most one email per 24 hours to avoid flooding when
 * a persistent misconfiguration keeps the sweep in an all-skipped state.
 */
const ALERT_RATE_LIMIT_MS = 24 * 60 * 60 * 1000;

let _lastAlertSentAt: number | null = null;

/** Reset the alert rate-limit state. Exported for tests only. */
export function _resetAlertState(): void {
  _lastAlertSentAt = null;
}

/**
 * Payment statuses that represent orders that were never successfully paid.
 * - PENDING: checkout created but customer never attempted payment
 * - FAILED:  a gateway attempt was made but payment was not captured
 * Both are safe to sweep because no money changed hands.
 * PAID / REFUNDED are explicitly excluded: a paid order may have
 * `referralEffectsAppliedAt = null` temporarily due to transient retry lag,
 * and sweeping it would incorrectly reverse a legitimate conversion.
 */
const UNPAID_STATUSES = [STORE_PAYMENT_STATUS.PENDING, STORE_PAYMENT_STATUS.FAILED] as const;

/**
 * Sweeps store orders that were abandoned (never paid) and reverses their
 * associated PENDING referral rows.
 *
 * ### Why this exists
 * When a customer checks out with a referral code a PENDING referral row is
 * inserted immediately (at checkout / `persistCheckoutOrder`). If the order is
 * never paid the PENDING row is never promoted to COMPLETED and never reversed
 * by the refund/cancel paths (those paths guard on `referralEffectsAppliedAt`,
 * which is null for unpaid orders). Over time these ghost rows accumulate and
 * inflate referral-report counts.
 *
 * ### What this function does NOT do
 * PENDING rows were never promoted to COMPLETED, so the referrer's
 * `successfulReferrals` and `referralEarnings` counters were never incremented.
 * No counter decrements are needed — only the referral row status is updated.
 *
 * ### Idempotency
 * - The function only targets referral rows with `status = 'pending'`.
 *   Already-reversed rows are invisible to the lookup.
 * - When `pendingReferral.referralId` is present and the primary lookup finds
 *   no PENDING row, the order is skipped immediately — no fallback is attempted.
 *   This prevents a re-run from touching an unrelated PENDING row that happens to
 *   share the same referral code with the already-reversed one.
 * - The fallback (code + tenantId + PENDING + reservationId IS NULL) is used
 *   ONLY for legacy orders where `referralId` is absent from the JSONB field.
 * - Safe to re-run; subsequent runs find nothing for already-swept orders.
 *
 * ### Row identification
 * PRIMARY  — `pendingReferral.referralId` (DB row id): exact lookup by id +
 *             tenantId + status=PENDING + reservationId IS NULL. Deterministic.
 *             The `isNull(reservationId)` guard prevents the sweep from touching
 *             trip-linked referrals (those with reservationId != null), which are
 *             managed exclusively by the reservation-cancellation path. When
 *             referralId is present but lookup misses (already reversed, gone, or
 *             trip-linked), order is skipped (no fallback).
 * FALLBACK — code + tenantId + status=PENDING + reservationId IS NULL for
 *             legacy orders that predate the `referralId` field.
 */
export async function runAbandonedOrderReferralCleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - ABANDONED_ORDER_THRESHOLD_HOURS * 60 * 60 * 1000);

  const orders = await db
    .select({
      id: storeOrdersTable.id,
      tenantId: storeOrdersTable.tenantId,
      pendingReferral: storeOrdersTable.pendingReferral,
    })
    .from(storeOrdersTable)
    .where(
      and(
        // Only target orders where payment was never captured. Includes both
        // PENDING (never attempted) and FAILED (attempted but not captured).
        // Paid orders are excluded even when referralEffectsAppliedAt is null —
        // that can happen temporarily due to transient retry lag and sweeping
        // would incorrectly reverse a legitimate referral conversion.
        inArray(storeOrdersTable.paymentStatus, UNPAID_STATUSES),
        isNotNull(storeOrdersTable.pendingReferral),
        isNull(storeOrdersTable.referralEffectsAppliedAt),
        lt(storeOrdersTable.createdAt, cutoff),
      ),
    );

  if (orders.length === 0) {
    logger.debug("[abandoned-referrals] No abandoned orders with pending referrals found");
    return;
  }

  logger.info(
    { count: orders.length },
    "[abandoned-referrals] Sweeping abandoned order referral rows",
  );

  let reversed = 0;
  let skipped = 0;
  const reversalNow = new Date();

  for (const order of orders) {
    const ref = order.pendingReferral as {
      code: string;
      referrerId: string;
      referralId?: string | null;
    } | null;

    if (!ref) continue;

    // --- Primary path: exact lookup by DB row id ----------------------------
    // Used for all orders that stored referralId in pendingReferral JSONB.
    // When the primary lookup misses (row already reversed), we skip immediately
    // rather than falling through to the code-based fallback. Falling back when
    // referralId is present would risk reversing a different, unrelated PENDING
    // row that happens to share the same referral code on a subsequent run.
    if (ref.referralId) {
      const [row] = await db
        .select({ id: referralsTable.id })
        .from(referralsTable)
        .where(
          and(
            eq(referralsTable.id, ref.referralId),
            eq(referralsTable.tenantId, order.tenantId),
            eq(referralsTable.status, REFERRAL_STATUS.PENDING),
            // Guard: skip trip-linked referrals (those with a non-null
            // reservationId). Trip-linked referrals are managed exclusively by
            // the reservation-cancellation path; the abandoned-order sweep must
            // never reverse them even when their id appears in an order's
            // pendingReferral JSONB (e.g. due to a future code path change).
            isNull(referralsTable.reservationId),
          ),
        )
        .limit(1);

      if (!row) {
        // Primary miss with referralId present means the row is already
        // reversed (or externally removed). Skip — do NOT fall through.
        logger.debug(
          { orderId: order.id, tenantId: order.tenantId, referralId: ref.referralId },
          "[abandoned-referrals] Primary referral row not found — already reversed or gone, skipping",
        );
        skipped++;
        continue;
      }

      await reverseReferralRow(order.id, order.tenantId, ref.code, row.id, reversalNow);
      reversed++;
      continue;
    }

    // --- Fallback path: code-based lookup for legacy orders -----------------
    // Only reached when `referralId` is absent from pendingReferral JSONB
    // (orders placed before this field was introduced).
    // `isNull(reservationId)` scopes the lookup to product-only referrals;
    // trip-linked ones have a non-null reservationId and are handled separately.
    const [row] = await db
      .select({ id: referralsTable.id })
      .from(referralsTable)
      .where(
        and(
          eq(referralsTable.tenantId, order.tenantId),
          eq(referralsTable.code, ref.code),
          eq(referralsTable.status, REFERRAL_STATUS.PENDING),
          isNull(referralsTable.reservationId),
        ),
      )
      .limit(1);

    if (!row) {
      logger.debug(
        { orderId: order.id, tenantId: order.tenantId },
        "[abandoned-referrals] No PENDING referral row found — already reversed or not applicable",
      );
      skipped++;
      continue;
    }

    await reverseReferralRow(order.id, order.tenantId, ref.code, row.id, reversalNow);
    reversed++;
  }

  logger.info(
    { total: orders.length, reversed, skipped },
    "[abandoned-referrals] Sweep complete",
  );

  // --- Operator alert: all-skipped with significant volume -----------------
  // If every eligible order was skipped and the volume is above threshold,
  // something is misaligned (stale referralIds, schema drift, etc.).
  // Rate-limit to 24 h so a persistent issue doesn't flood the operator.
  if (skipped > 0 && reversed === 0 && orders.length >= ABANDONED_REFERRAL_ALERT_THRESHOLD) {
    void maybeSendAllSkippedAlert(orders.length, skipped);
  }
}

async function maybeSendAllSkippedAlert(total: number, skipped: number): Promise<void> {
  if (_lastAlertSentAt !== null && Date.now() - _lastAlertSentAt < ALERT_RATE_LIMIT_MS) {
    logger.info(
      { total, skipped, rateLimitHrs: 24 },
      "[abandoned-referrals] All-skipped alert suppressed by rate limit",
    );
    return;
  }

  const alertEmail =
    process.env["ABANDONED_REFERRAL_ALERT_EMAIL"]?.trim() ||
    process.env["SUPERADMIN_EMAIL"]?.trim() ||
    null;

  if (!alertEmail) {
    logger.warn(
      { total, skipped },
      "[abandoned-referrals] All-skipped condition met but no alert email configured (set ABANDONED_REFERRAL_ALERT_EMAIL or SUPERADMIN_EMAIL)",
    );
    return;
  }

  _lastAlertSentAt = Date.now();

  const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/$/, "");
  const dashboardUrl = appUrl ? `${appUrl}/admin` : null;

  sendAbandonedReferralAlertEmail({ to: alertEmail, skipped, total, dashboardUrl })
    .then((result) => {
      if (result.success) {
        logger.warn(
          { total, skipped, to: alertEmail },
          "[abandoned-referrals] All-skipped alert email sent",
        );
      } else {
        logger.error(
          { total, skipped, error: result.error },
          "[abandoned-referrals] Failed to send all-skipped alert email — clearing rate limit so next run can retry",
        );
        _lastAlertSentAt = null;
      }
    })
    .catch((err) => {
      logger.error(
        { total, skipped, err },
        "[abandoned-referrals] Unexpected error sending all-skipped alert email — clearing rate limit so next run can retry",
      );
      _lastAlertSentAt = null;
    });
}

async function reverseReferralRow(
  orderId: string,
  tenantId: string,
  code: string,
  referralId: string,
  reversalNow: Date,
): Promise<void> {
  await db
    .update(referralsTable)
    .set({
      status: REFERRAL_STATUS.REVERSED,
      reversalReason: "order_abandoned",
      reversalAt: reversalNow,
      updatedAt: reversalNow,
    })
    .where(eq(referralsTable.id, referralId));

  logger.info(
    { orderId, tenantId, referralId, code },
    "[abandoned-referrals] PENDING referral row reversed for abandoned order",
  );
}

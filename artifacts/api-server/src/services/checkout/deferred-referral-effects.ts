import { logger } from "../../lib/logger";
import { db } from "@workspace/db";
import { storeOrdersTable, referralsTable, reservationsTable } from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { STORE_PAYMENT_STATUS } from "@workspace/permissions";
import { recordReferralConversion, type ReferralConversionResult } from "./referral-conversion";
import type { Tx } from "./tx";

interface PendingReferral {
  code: string;
  referrerId: string;
  discountValue: number;
  discountType: string;
  cookieId?: string | null;
  /** ID of the PENDING referral row already inserted at checkout time (by persistCheckoutOrder).
   * When present, recordReferralConversion will UPDATE this row instead of inserting a new one. */
  referralId?: string | null;
}

export interface DeferredReferralResult {
  conversionApplied: boolean;
  referrerId?: string;
  referralCode?: string;
  customerName?: string;
  tenantId?: string;
  conversion?: ReferralConversionResult;
}

/**
 * Applies the referral conversion + referral-credit consumption that are
 * deferred from checkout to payment time, so anonymous/unpaid storefront orders
 * can never credit a referrer's conversion or burn a customer's referral credit
 * before money is captured. The intent is persisted on the order at checkout
 * (store_orders.pending_referral / pending_credit_spend).
 *
 * Runs in its OWN transaction, invoked AFTER the payment/reservation transaction
 * has already committed (from runPostPaymentSideEffects). It is intentionally not
 * part of the payment transaction: a Postgres query error aborts the whole
 * transaction, and that must never roll back a real captured payment.
 *
 * Exactly-once: the order row is locked FOR UPDATE; if referralEffectsAppliedAt
 * is already set the call is a no-op (safe under webhook retries and repeated
 * manual "mark paid"). The applied marker is written at the END of the
 * transaction, so a mid-transaction failure rolls back the marker and the call
 * stays retryable on the next payment event.
 *
 * Credit consumption is best-effort: the customer already paid a discounted
 * amount, so any race/double-spend shortfall is consumed up to the available
 * balance and logged — it never throws.
 */
export async function applyDeferredOrderCredits(orderId: string): Promise<DeferredReferralResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: storeOrdersTable.id,
        tenantId: storeOrdersTable.tenantId,
        clientId: storeOrdersTable.clientId,
        orderNumber: storeOrdersTable.orderNumber,
        customerEmail: storeOrdersTable.customerEmail,
        customerName: storeOrdersTable.customerName,
        discountAmount: storeOrdersTable.discountAmount,
        ipAddress: storeOrdersTable.ipAddress,
        paymentStatus: storeOrdersTable.paymentStatus,
        pendingReferral: storeOrdersTable.pendingReferral,
        pendingCreditSpend: storeOrdersTable.pendingCreditSpend,
        referralEffectsAppliedAt: storeOrdersTable.referralEffectsAppliedAt,
      })
      .from(storeOrdersTable)
      .where(eq(storeOrdersTable.id, orderId))
      .for("update")
      .limit(1);

    if (!order) return { conversionApplied: false };
    // Idempotency: effects already applied for this order.
    if (order.referralEffectsAppliedAt != null) return { conversionApplied: false };
    // Only apply once payment is actually confirmed.
    if (order.paymentStatus !== STORE_PAYMENT_STATUS.PAID) return { conversionApplied: false };

    // 1) Consume referral credit (best-effort — money is already captured, so a
    //    shortfall is logged and capped, never thrown).
    const creditSpend = order.pendingCreditSpend;
    if (Array.isArray(creditSpend) && creditSpend.length > 0) {
      const ids = creditSpend.map((r) => r.id);
      const lockedRows = await tx
        .select({
          id: referralsTable.id,
          bonusAmount: referralsTable.bonusAmount,
          bonusCreditUsedAmount: referralsTable.bonusCreditUsedAmount,
        })
        .from(referralsTable)
        .where(and(eq(referralsTable.tenantId, order.tenantId), inArray(referralsTable.id, ids)))
        .for("update");
      const lockedMap = new Map(
        lockedRows.map((r) => [
          r.id,
          { bonusAmount: Number(r.bonusAmount), alreadyUsed: Number(r.bonusCreditUsedAmount ?? 0) },
        ]),
      );
      const now = new Date();
      for (const { id, consumedAmount } of creditSpend) {
        const locked = lockedMap.get(id);
        if (!locked) {
          logger.warn({ creditId: id, orderId: order.id }, "[checkout/deferred-credits] credit row not found; skipping");
          continue;
        }
        const available = Math.max(0, locked.bonusAmount - locked.alreadyUsed);
        const consume = Math.min(available, consumedAmount);
        if (consume <= 0) {
          logger.warn({ creditId: id, orderId: order.id, planned: consumedAmount }, "[checkout/deferred-credits] no remaining credit; skipping");
          continue;
        }
        if (consume < consumedAmount - 0.005) {
          logger.warn({ creditId: id, orderId: order.id, consumed: consume, planned: consumedAmount }, "[checkout/deferred-credits] partial credit consumed");
        }
        await tx
          .update(referralsTable)
          .set({
            bonusCreditUsedAt: now,
            bonusCreditOrderId: order.id,
            bonusCreditUsedAmount: sql`COALESCE(${referralsTable.bonusCreditUsedAmount}, 0) + ${consume.toFixed(2)}`,
            updatedAt: now,
          })
          .where(eq(referralsTable.id, id));
      }
    }

    // 2) Record the referral conversion (credit the referrer), now linked to the
    //    first reservation created for this order so cancellation/refund reversal
    //    (keyed on reservationId) can find it. Product-only orders have no
    //    reservation → reservationId stays null (matches prior behavior).
    let result: DeferredReferralResult = { conversionApplied: false };
    const ref = order.pendingReferral as PendingReferral | null;
    if (ref?.code && ref?.referrerId) {
      const [firstRes] = await tx
        .select({ id: reservationsTable.id })
        .from(reservationsTable)
        .where(
          and(
            eq(reservationsTable.tenantId, order.tenantId),
            eq(reservationsTable.storeOrderId, order.orderNumber),
          ),
        )
        .orderBy(asc(reservationsTable.createdAt))
        .limit(1);

      const conversion = await recordReferralConversion(tx as unknown as Tx, {
        tenantId: order.tenantId,
        referrerId: ref.referrerId,
        referralCode: ref.code,
        referredClientId: order.clientId ?? null,
        customerEmail: order.customerEmail,
        customerName: order.customerName,
        // Preserve prior analytics value: store_orders.discountAmount is the
        // combined promo + credit discount that was passed before deferral.
        discountAmount: Number(order.discountAmount),
        discountValue: ref.discountValue,
        discountType: ref.discountType,
        referralCookieId: ref.cookieId ?? undefined,
        conversionIp: order.ipAddress ?? null,
        reservationId: firstRes?.id ?? null,
        // Link to the PENDING row inserted at checkout time (if present) so
        // recordReferralConversion can UPDATE it instead of inserting a duplicate.
        existingReferralId: ref.referralId ?? null,
      });

      result = {
        conversionApplied: true,
        referrerId: ref.referrerId,
        referralCode: ref.code,
        customerName: order.customerName,
        tenantId: order.tenantId,
        conversion,
      };
    }

    // Mark applied at the END so a mid-transaction failure rolls back the marker
    // and the call remains retryable on the next payment event.
    await tx
      .update(storeOrdersTable)
      .set({ referralEffectsAppliedAt: new Date() })
      .where(eq(storeOrdersTable.id, order.id));

    return result;
  });
}

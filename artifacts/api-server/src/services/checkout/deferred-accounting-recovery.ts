import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { runDeferredOrderAccounting } from "./post-booking";

export const DEFERRED_ACCOUNTING_RECOVERY_BATCH_SIZE = 100;

/**
 * Retries paid orders whose deferred referral/cashback transaction did not
 * reach its durable applied marker. Payment rows are the recovery signal; this
 * job never creates or changes payments.
 */
export async function retryPendingDeferredOrderAccounting(): Promise<{
  scanned: number;
  recovered: number;
  failed: number;
}> {
  const result = await db.execute(sql`
    SELECT o.id
    FROM store_orders o
    WHERE o.status <> 'cancelled'
      AND o.payment_status <> 'refunded'
      AND o.referral_effects_applied_at IS NULL
      AND (o.pending_referral IS NOT NULL OR o.pending_credit_spend IS NOT NULL)
      AND EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.tenant_id = o.tenant_id
          AND p.type = 'receivable'
          AND p.status IN ('paid', 'approved')
          AND (
            p.order_id = o.id
            OR EXISTS (
              SELECT 1
              FROM reservations r
              WHERE r.id = p.reservation_id
                AND r.tenant_id = p.tenant_id
                AND r.store_order_id = o.order_number
            )
          )
      )
    ORDER BY o.updated_at ASC, o.id ASC
    LIMIT ${DEFERRED_ACCOUNTING_RECOVERY_BATCH_SIZE}
  `);
  const candidates = (result as unknown as { rows: Array<{ id: string }> }).rows ?? [];
  let recovered = 0;
  let failed = 0;

  for (const { id: orderId } of candidates) {
    try {
      await runDeferredOrderAccounting(orderId, {
        allowPartialPayment: true,
        throwOnDeferredError: true,
      });
      recovered++;
    } catch (err) {
      failed++;
      logger.warn(
        {
          orderId,
          errorType: err instanceof Error ? err.name : "unknown",
        },
        "[checkout/deferred-accounting-recovery] Retry failed; order remains eligible for the next sweep",
      );
    }
  }

  if (candidates.length > 0) {
    logger.info(
      { scanned: candidates.length, recovered, failed },
      "[checkout/deferred-accounting-recovery] Sweep finished",
    );
  }
  return { scanned: candidates.length, recovered, failed };
}

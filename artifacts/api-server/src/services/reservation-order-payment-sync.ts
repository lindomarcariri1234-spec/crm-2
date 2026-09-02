import { db, reservationsTable, storeOrdersTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { STORE_ORDER_STATUS, STORE_PAYMENT_STATUS } from "@workspace/permissions";
import { applyOrderInventoryEffects } from "./checkout/persist-order";
import { recordOrderPaymentSettlement } from "./settlements/financial-ledger";
import { runPostPaymentSideEffects } from "./checkout/post-booking";

export interface ReservationOrderPaymentSyncResult {
  orderId: string | null;
  transitionedToPaid: boolean;
}

/**
 * Promotes the originating storefront order once every linked reservation is
 * fully paid. A positive reservation payment also dispatches the deferred
 * referral effects while the order is still pending. The order row lock is the
 * idempotency gate for inventory and settlement.
 */
export async function syncStoreOrderFromReservationPayment(
  reservationId: string,
  tenantId: string,
): Promise<ReservationOrderPaymentSyncResult> {
  const [reservation] = await db.select({
    storeOrderId: reservationsTable.storeOrderId,
  }).from(reservationsTable).where(and(
    eq(reservationsTable.id, reservationId),
    eq(reservationsTable.tenantId, tenantId),
  )).limit(1);
  if (!reservation?.storeOrderId) return { orderId: null, transitionedToPaid: false };

  let orderId: string | null = null;
  let transitionedToPaid = false;
  let canRunPaymentEffects = false;
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(storeOrdersTable).where(and(
      eq(storeOrdersTable.tenantId, tenantId),
      eq(storeOrdersTable.orderNumber, reservation.storeOrderId!),
    )).for("update").limit(1);
    if (!order) return;
    orderId = order.id;
    if (order.status === STORE_ORDER_STATUS.CANCELLED) return;
    canRunPaymentEffects = true;

    const siblings = await tx.select({
      balance: reservationsTable.balance,
    }).from(reservationsTable).where(and(
      eq(reservationsTable.tenantId, tenantId),
      eq(reservationsTable.storeOrderId, order.orderNumber),
    ));
    if (siblings.length === 0 || siblings.some(row => Number(row.balance) > 0)) return;
    if (order.paymentStatus === STORE_PAYMENT_STATUS.PAID) return;
    if (order.status === STORE_ORDER_STATUS.CANCELLED) return;

    const paidAt = new Date();
    await applyOrderInventoryEffects(order.id, tx);
    const updated = await tx.update(storeOrdersTable).set({
      paymentStatus: STORE_PAYMENT_STATUS.PAID,
      status: STORE_ORDER_STATUS.CONFIRMED,
      paidAt,
      confirmedAt: order.confirmedAt ?? paidAt,
      amountRemaining: "0",
    }).where(and(
      eq(storeOrdersTable.id, order.id),
      eq(storeOrdersTable.tenantId, tenantId),
      ne(storeOrdersTable.paymentStatus, STORE_PAYMENT_STATUS.PAID),
    )).returning({ id: storeOrdersTable.id });
    if (updated.length === 0) return;

    await recordOrderPaymentSettlement(tx, {
      tenantId,
      orderId: order.id,
      gateway: "manual-reservation",
      transactionId: `manual-reservation:${order.id}`,
      occurredAt: paidAt,
      receivedAmount: Number(order.totalAmount),
    });
    transitionedToPaid = true;
  });

  // This helper is called only after a positive receivable payment has been
  // persisted. It therefore also handles the partial-payment referral path;
  // the post-payment service skips full-order effects until paymentStatus is
  // PAID.
  if (orderId && canRunPaymentEffects) {
    await runPostPaymentSideEffects(orderId, { allowPartialPayment: true });
  }
  return { orderId, transitionedToPaid };
}
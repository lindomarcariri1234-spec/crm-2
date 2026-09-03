import { db, paymentsTable, reservationsTable, storeOrdersTable } from "@workspace/db";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { STORE_ORDER_STATUS, STORE_PAYMENT_STATUS } from "@workspace/permissions";
import { PAYMENT_STATUS, PAYMENT_TYPE } from "@workspace/permissions";
import { applyOrderInventoryEffects, reverseOrderInventoryEffects } from "./checkout/persist-order";
import {
  recordOrderPaymentSettlement,
  reinstateOrderPaymentSettlementEvent,
  reverseOrderPaymentSettlementEvent,
} from "./settlements/financial-ledger";
import { runPostPaymentSideEffects } from "./checkout/post-booking";

export interface ReservationOrderPaymentSyncResult {
  orderId: string | null;
  transitionedToPaid: boolean;
}

export interface OrderPaymentSyncEvent {
  received?: {
    gateway: string;
    transactionId: string;
    amount: number;
    occurredAt: Date;
    reactivated?: boolean;
  };
  reversed?: { gateway: string; transactionId: string; paymentId: string; amount: number; occurredAt: Date };
}

async function syncStoreOrderPaymentState(
  orderLookup: { id?: string; orderNumber?: string },
  tenantId: string,
  event?: OrderPaymentSyncEvent,
): Promise<ReservationOrderPaymentSyncResult> {
  let orderId: string | null = null;
  let transitionedToPaid = false;
  let canRunPaymentEffects = false;
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(storeOrdersTable).where(and(
      eq(storeOrdersTable.tenantId, tenantId),
      ...(orderLookup.id ? [eq(storeOrdersTable.id, orderLookup.id)] : []),
      ...(orderLookup.orderNumber ? [eq(storeOrdersTable.orderNumber, orderLookup.orderNumber)] : []),
    )).for("update").limit(1);
    if (!order) return;
    orderId = order.id;
    if (order.status === STORE_ORDER_STATUS.CANCELLED) return;

    const siblings = await tx.select({
      id: reservationsTable.id,
      balance: reservationsTable.balance,
      paidValue: reservationsTable.paidValue,
    }).from(reservationsTable).where(and(
      eq(reservationsTable.tenantId, tenantId),
      eq(reservationsTable.storeOrderId, order.orderNumber),
    ));
    const paymentScope = siblings.length > 0
      ? or(
        eq(paymentsTable.orderId, order.id),
        inArray(paymentsTable.reservationId, siblings.map((row) => row.id)),
      )
      : eq(paymentsTable.orderId, order.id);
    const paidPayments = await tx.select({
      id: paymentsTable.id,
      amount: paymentsTable.amount,
    }).from(paymentsTable).where(and(
      eq(paymentsTable.tenantId, tenantId),
      eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE),
      eq(paymentsTable.status, PAYMENT_STATUS.PAID),
      paymentScope,
    ));
    const paidAmount = Math.min(
      Number(order.totalAmount),
      paidPayments.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    );
    const amountRemaining = Math.max(0, Number(order.totalAmount) - paidAmount);
    canRunPaymentEffects = paidAmount > 0;
    if (event?.received && event.received.amount > 0) {
      const reinstatedCents = event.received.reactivated
        ? await reinstateOrderPaymentSettlementEvent(tx, {
          tenantId,
          orderId: order.id,
          gateway: event.received.gateway,
          transactionId: event.received.transactionId,
          amount: event.received.amount,
          eventKey: `payment-reinstated:${event.received.gateway}:${event.received.transactionId}:${event.received.occurredAt.toISOString()}`,
          occurredAt: event.received.occurredAt,
        })
        : 0;
      if (reinstatedCents === 0) {
        await recordOrderPaymentSettlement(tx, {
          tenantId,
          orderId: order.id,
          gateway: event.received.gateway,
          transactionId: event.received.transactionId,
          occurredAt: event.received.occurredAt,
          receivedAmount: event.received.amount,
        });
      }
    }
    if (event?.reversed) {
      await reverseOrderPaymentSettlementEvent(tx, {
        tenantId,
        orderId: order.id,
        gateway: event.reversed.gateway,
        transactionId: event.reversed.transactionId,
        amount: event.reversed.amount,
        eventKey: `payment-reversed:${event.reversed.paymentId}:${event.reversed.occurredAt.toISOString()}`,
        occurredAt: event.reversed.occurredAt,
        reason: "Pagamento manual removido ou estornado",
      });
    }
    const orderPaid = amountRemaining <= 0;
    if (!orderPaid) {
      if (order.paymentStatus === STORE_PAYMENT_STATUS.PAID) {
        await reverseOrderInventoryEffects(order.id, tx);
      }
      await tx.update(storeOrdersTable).set({
        amountRemaining: amountRemaining.toFixed(2),
        ...(order.paymentStatus === STORE_PAYMENT_STATUS.PAID ? {
          paymentStatus: STORE_PAYMENT_STATUS.PENDING,
          paidAt: null,
          ...(order.status === STORE_ORDER_STATUS.CONFIRMED
            ? { status: STORE_ORDER_STATUS.PENDING, confirmedAt: null }
            : {}),
        } : {}),
      }).where(and(
        eq(storeOrdersTable.id, order.id),
        eq(storeOrdersTable.tenantId, tenantId),
      ));
      return;
    }
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

/**
 * Promotes or demotes the storefront order using the full tenant-scoped set of
 * paid receivables linked either directly to the order or to its reservations.
 */
export async function syncStoreOrderFromReservationPayment(
  reservationId: string,
  tenantId: string,
  event?: OrderPaymentSyncEvent,
): Promise<ReservationOrderPaymentSyncResult> {
  const [reservation] = await db.select({
    storeOrderId: reservationsTable.storeOrderId,
  }).from(reservationsTable).where(and(
    eq(reservationsTable.id, reservationId),
    eq(reservationsTable.tenantId, tenantId),
  )).limit(1);
  if (!reservation?.storeOrderId) return { orderId: null, transitionedToPaid: false };
  return syncStoreOrderPaymentState({ orderNumber: reservation.storeOrderId }, tenantId, event);
}

export async function syncStoreOrderFromOrderPayment(
  orderId: string,
  tenantId: string,
  event?: OrderPaymentSyncEvent,
): Promise<ReservationOrderPaymentSyncResult> {
  return syncStoreOrderPaymentState({ id: orderId }, tenantId, event);
}
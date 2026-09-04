/**
 * Tenant-scoped, presentation-only links between checkout, CRM and referrals.
 * There is deliberately no JSON relationship stored on an order: old and new
 * rows are resolved from their canonical relational columns at read time.
 */
import { db, dealsTable, referralsTable, reservationsTable, storeOrdersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { PAYMENT_STATUS, PAYMENT_TYPE, RESERVATION_STATUS, STORE_ORDER_STATUS, STORE_PAYMENT_STATUS } from "@workspace/permissions";

const money = (value: unknown) => Number(value ?? 0);
const roundedMoney = (value: number) => Math.round(value * 100) / 100;

export type CanonicalPaymentState =
  | "pending"
  | "partially_paid"
  | "paid"
  | "failed"
  | "refunded"
  | "cancelled";

export type FinancialSummary = {
  source: "order" | "reservation";
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  depositRequested: number;
  paidAmount: number;
  amountRemaining: number;
  minimumRequired: number;
  reservationValid: boolean;
  states: {
    order: string | null;
    reservation: string | null;
    payment: CanonicalPaymentState;
  };
  diagnostics: {
    hasLegacyDivergence: boolean;
    issues: string[];
    legacy: {
      totalAmount: number | null;
      paidAmount: number | null;
      amountRemaining: number | null;
    } | null;
  };
};

export type LinkedOrderPayment = {
  orderId?: string | null;
  reservationId?: string | null;
  amount: unknown;
  status?: string | null;
  type?: string | null;
};

export function calculateReceivedAmount(
  orderId: string,
  reservationIds: string[],
  payments: LinkedOrderPayment[],
): number {
  const reservationIdSet = new Set(reservationIds);
  const received = payments.reduce((sum, payment) => {
    const belongsToOrder = payment.orderId === orderId
      || (payment.reservationId != null && reservationIdSet.has(payment.reservationId));
    if (!belongsToOrder || payment.status !== "paid" || payment.type !== "receivable") return sum;
    return sum + money(payment.amount);
  }, 0);
  return roundedMoney(received);
}

export function allocateOrderReceiptToReservation(
  orderPaidAmount: number,
  orderTotalAmount: unknown,
  reservationTotalAmount: unknown,
  reservationId?: string,
  siblingReservations?: Array<{ id: string; totalValue: unknown }>,
): number {
  const orderTotal = money(orderTotalAmount);
  const reservationTotal = Math.max(0, money(reservationTotalAmount));
  if (orderTotal <= 0 || reservationTotal <= 0) return 0;
  if (!reservationId || !siblingReservations?.length) {
    return roundedMoney(Math.min(reservationTotal, Math.max(0, orderPaidAmount) * reservationTotal / orderTotal));
  }
  const paidCents = Math.max(0, Math.round(orderPaidAmount * 100));
  const orderTotalCents = Math.round(orderTotal * 100);
  const siblings = siblingReservations.map(reservation => ({
    id: reservation.id,
    capacity: Math.max(0, Math.round(money(reservation.totalValue) * 100)),
  }));
  const totalReservationCents = siblings.reduce((sum, reservation) => sum + reservation.capacity, 0);
  const targetCents = Math.min(
    totalReservationCents,
    Math.round(paidCents * totalReservationCents / orderTotalCents),
  );
  const shares = siblings.map(reservation => {
    const raw = targetCents * reservation.capacity / Math.max(1, totalReservationCents);
    return { ...reservation, cents: Math.floor(raw), fraction: raw - Math.floor(raw) };
  });
  let remainder = targetCents - shares.reduce((sum, share) => sum + share.cents, 0);
  shares.sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id));
  for (const share of shares) {
    if (remainder <= 0) break;
    if (share.cents < share.capacity) {
      share.cents += 1;
      remainder -= 1;
    }
  }
  return (shares.find(share => share.id === reservationId)?.cents ?? 0) / 100;
}

function paymentState(args: {
  totalAmount: number;
  paidAmount: number;
  orderStatus?: string | null;
  reservationStatus?: string | null;
  storedPaymentStatus?: string | null;
  payments?: LinkedOrderPayment[];
}): CanonicalPaymentState {
  const { totalAmount, paidAmount, orderStatus, reservationStatus, storedPaymentStatus, payments = [] } = args;
  if (orderStatus === STORE_ORDER_STATUS.CANCELLED || reservationStatus === RESERVATION_STATUS.CANCELLED) return "cancelled";
  if (
    storedPaymentStatus === STORE_PAYMENT_STATUS.REFUNDED
    || reservationStatus === RESERVATION_STATUS.REFUNDED
    || payments.some(payment => payment.status === PAYMENT_STATUS.REFUNDED || payment.status === PAYMENT_STATUS.CHARGED_BACK)
  ) return "refunded";
  if (paidAmount > 0 && paidAmount + 0.005 < totalAmount) return "partially_paid";
  if (totalAmount <= 0 || paidAmount + 0.005 >= totalAmount) return "paid";
  if (
    storedPaymentStatus === STORE_PAYMENT_STATUS.FAILED
    || reservationStatus === RESERVATION_STATUS.FAILED
    || payments.some(payment => payment.status === PAYMENT_STATUS.FAILED)
  ) return "failed";
  return "pending";
}

export function financialSummary(args: {
  source: "order" | "reservation";
  subtotal: unknown;
  discountAmount?: unknown;
  totalAmount: unknown;
  depositRequested?: unknown;
  paidAmount: unknown;
  orderStatus?: string | null;
  reservationStatus?: string | null;
  storedPaymentStatus?: string | null;
  payments?: LinkedOrderPayment[];
  legacy?: {
    totalAmount?: unknown;
    paidAmount?: unknown;
    amountRemaining?: unknown;
  };
}): FinancialSummary {
  const subtotal = Math.max(0, roundedMoney(money(args.subtotal)));
  const discountAmount = Math.max(0, roundedMoney(money(args.discountAmount)));
  const totalAmount = Math.max(0, roundedMoney(money(args.totalAmount)));
  const depositRequested = Math.min(totalAmount, Math.max(0, roundedMoney(money(args.depositRequested))));
  const paidAmount = Math.max(0, roundedMoney(money(args.paidAmount)));
  const amountRemaining = Math.max(0, roundedMoney(totalAmount - paidAmount));
  const minimumRequired = totalAmount <= 0 ? 0 : depositRequested > 0 ? depositRequested : totalAmount;
  const state = paymentState({
    totalAmount,
    paidAmount,
    orderStatus: args.orderStatus,
    reservationStatus: args.reservationStatus,
    storedPaymentStatus: args.storedPaymentStatus,
    payments: args.payments,
  });
  const validReservationStatus = args.reservationStatus === RESERVATION_STATUS.CONFIRMED
    || args.reservationStatus === RESERVATION_STATUS.COMPLETED;
  const validPaymentState = state === "paid" || state === "partially_paid";
  const issues: string[] = [];
  let legacy: FinancialSummary["diagnostics"]["legacy"] = null;
  if (args.legacy) {
    legacy = {
      totalAmount: args.legacy.totalAmount == null ? null : roundedMoney(money(args.legacy.totalAmount)),
      paidAmount: args.legacy.paidAmount == null ? null : roundedMoney(money(args.legacy.paidAmount)),
      amountRemaining: args.legacy.amountRemaining == null ? null : roundedMoney(money(args.legacy.amountRemaining)),
    };
    if (legacy.totalAmount != null && Math.abs(legacy.totalAmount - totalAmount) >= 0.01) issues.push("legacy_total_differs");
    if (legacy.paidAmount != null && Math.abs(legacy.paidAmount - paidAmount) >= 0.01) issues.push("legacy_paid_differs");
    if (legacy.amountRemaining != null && Math.abs(legacy.amountRemaining - amountRemaining) >= 0.01) issues.push("legacy_balance_differs");
  }
  return {
    source: args.source,
    subtotal,
    discountAmount,
    totalAmount,
    depositRequested,
    paidAmount,
    amountRemaining,
    minimumRequired,
    reservationValid: validReservationStatus && validPaymentState && paidAmount + 0.005 >= minimumRequired,
    states: {
      order: args.orderStatus ?? null,
      reservation: args.reservationStatus ?? null,
      payment: state,
    },
    diagnostics: {
      hasLegacyDivergence: issues.length > 0,
      issues,
      legacy,
    },
  };
}

export function orderFinancialSummary(
  order: Pick<typeof storeOrdersTable.$inferSelect, "id" | "status" | "paymentStatus" | "subtotal" | "discountAmount" | "totalAmount" | "depositAmount" | "amountRemaining">,
  paidAmount: number,
  payments: LinkedOrderPayment[] = [],
  reservation?: Pick<typeof reservationsTable.$inferSelect, "status" | "totalValue" | "paidValue" | "balance"> | null,
  reservationIds: string[] = [],
): FinancialSummary {
  const ownedPayments = payments.filter(payment =>
    payment.orderId === order.id
    || (!!payment.reservationId && reservationIds.includes(payment.reservationId))
  );
  return financialSummary({
    source: "order",
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    totalAmount: order.totalAmount,
    depositRequested: order.depositAmount,
    paidAmount,
    orderStatus: order.status,
    reservationStatus: reservation?.status ?? null,
    storedPaymentStatus: order.paymentStatus,
    payments: ownedPayments,
    legacy: reservation ? {
      totalAmount: reservation.totalValue,
      paidAmount: reservation.paidValue,
      amountRemaining: reservation.balance,
    } : {
      amountRemaining: order.amountRemaining,
    },
  });
}

export function reservationFinancialSummary(
  reservation: Pick<typeof reservationsTable.$inferSelect, "id" | "status" | "totalValue" | "paidValue" | "balance" | "depositAmount" | "discountTotal">,
  paidAmount: number,
  payments: LinkedOrderPayment[] = [],
  order?: Pick<typeof storeOrdersTable.$inferSelect, "id" | "status" | "paymentStatus"> | null,
): FinancialSummary {
  const totalAmount = money(reservation.totalValue);
  const discountAmount = money(reservation.discountTotal);
  return financialSummary({
    source: "reservation",
    subtotal: totalAmount + discountAmount,
    discountAmount,
    totalAmount,
    depositRequested: reservation.depositAmount,
    paidAmount,
    orderStatus: order?.status,
    reservationStatus: reservation.status,
    storedPaymentStatus: order?.paymentStatus,
    payments: payments.filter(payment =>
      payment.reservationId === reservation.id
      || (!!order && payment.orderId === order.id)
    ),
    legacy: {
      totalAmount: reservation.totalValue,
      paidAmount: reservation.paidValue,
      amountRemaining: reservation.balance,
    },
  });
}

export const linkedOrder = (
  o: Pick<typeof storeOrdersTable.$inferSelect, "id" | "orderNumber" | "status" | "paymentStatus" | "subtotal" | "discountAmount" | "totalAmount" | "depositAmount" | "amountRemaining" | "paymentMethod" | "installments"> | null | undefined,
  financial?: { paidAmount?: number; amountRemaining?: number; payments?: LinkedOrderPayment[]; reservation?: Pick<typeof reservationsTable.$inferSelect, "status" | "totalValue" | "paidValue" | "balance"> | null; reservationIds?: string[] },
) => {
  if (!o) return null;
  const totalAmount = money(o.totalAmount);
  const paidAmount = Math.max(
    0,
    financial?.paidAmount ?? 0,
  );
  const summary = orderFinancialSummary(o, paidAmount, financial?.payments, financial?.reservation, financial?.reservationIds);
  return {
    id: o.id, orderNumber: o.orderNumber, status: o.status, paymentStatus: o.paymentStatus,
    subtotal: money(o.subtotal), discountAmount: money(o.discountAmount), totalAmount,
    depositAmount: money(o.depositAmount), paidAmount,
    amountRemaining: Math.max(0, financial?.amountRemaining ?? totalAmount - paidAmount),
    paymentMethod: o.paymentMethod, installments: o.installments,
    financialSummary: summary,
  };
};

export const linkedReservation = (
  r: typeof reservationsTable.$inferSelect | null | undefined,
  summary?: FinancialSummary,
) => r ? ({
  id: r.id, reservationNumber: r.reservationNumber, tripId: r.tripId, status: r.status,
  totalValue: money(r.totalValue), paidValue: money(r.paidValue), balance: money(r.balance),
  seats: r.seats ?? [], passengerCount: (r.seats ?? []).length,
  financialSummary: summary,
}) : null;

export const linkedReferral = (r: typeof referralsTable.$inferSelect | null | undefined) => r ? ({
  id: r.id, code: r.code, status: r.status, referrerId: r.referrerId,
  referrerName: r.referrerName, discountAmount: money(r.discountAmount), bonusAmount: money(r.bonusAmount),
}) : null;

export const linkedDeal = (d: typeof dealsTable.$inferSelect) => ({
  id: d.id, tripId: d.tripId, reservationId: d.reservationId, stageId: d.stageId,
  status: d.status, source: d.source ?? "manual", value: money(d.value),
});

export async function loadLinkedData(tenantId: string, args: {
  reservationIds?: string[];
  orderNumbers?: string[];
  dealIds?: string[];
  referralIds?: string[];
}) {
  const reservationIds = [...new Set(args.reservationIds ?? [])];
  const orderNumbers = [...new Set(args.orderNumbers ?? [])];
  const referralIds = [...new Set(args.referralIds ?? [])];
  const dealIds = [...new Set(args.dealIds ?? [])];
  const [reservations, orders, referrals, deals] = await Promise.all([
    reservationIds.length ? db.select().from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), inArray(reservationsTable.id, reservationIds))) : Promise.resolve([] as (typeof reservationsTable.$inferSelect)[]),
    orderNumbers.length ? db.select().from(storeOrdersTable).where(and(eq(storeOrdersTable.tenantId, tenantId), inArray(storeOrdersTable.orderNumber, orderNumbers))) : Promise.resolve([] as (typeof storeOrdersTable.$inferSelect)[]),
    referralIds.length ? db.select().from(referralsTable).where(and(eq(referralsTable.tenantId, tenantId), inArray(referralsTable.id, referralIds))) : Promise.resolve([] as (typeof referralsTable.$inferSelect)[]),
    dealIds.length ? db.select().from(dealsTable).where(and(eq(dealsTable.tenantId, tenantId), inArray(dealsTable.id, dealIds))) : Promise.resolve([] as (typeof dealsTable.$inferSelect)[]),
  ]);
  return { reservations, orders, referrals, deals };
}
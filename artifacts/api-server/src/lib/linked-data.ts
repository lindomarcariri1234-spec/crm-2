/**
 * Tenant-scoped, presentation-only links between checkout, CRM and referrals.
 * There is deliberately no JSON relationship stored on an order: old and new
 * rows are resolved from their canonical relational columns at read time.
 */
import { db, dealsTable, referralsTable, reservationsTable, storeOrdersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

const money = (value: unknown) => Number(value ?? 0);

export const linkedOrder = (o: Pick<typeof storeOrdersTable.$inferSelect, "id" | "orderNumber" | "status" | "paymentStatus" | "subtotal" | "discountAmount" | "totalAmount" | "depositAmount" | "amountRemaining" | "paymentMethod" | "installments"> | null | undefined) => o ? ({
  id: o.id, orderNumber: o.orderNumber, status: o.status, paymentStatus: o.paymentStatus,
  subtotal: money(o.subtotal), discountAmount: money(o.discountAmount), totalAmount: money(o.totalAmount),
  depositAmount: money(o.depositAmount), amountRemaining: money(o.amountRemaining),
  paymentMethod: o.paymentMethod, installments: o.installments,
}) : null;

export const linkedReservation = (r: typeof reservationsTable.$inferSelect | null | undefined) => r ? ({
  id: r.id, reservationNumber: r.reservationNumber, tripId: r.tripId, status: r.status,
  totalValue: money(r.totalValue), paidValue: money(r.paidValue), balance: money(r.balance),
  seats: r.seats ?? [], passengerCount: (r.seats ?? []).length,
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
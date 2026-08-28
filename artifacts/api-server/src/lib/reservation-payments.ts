import { db } from "@workspace/db";
import { reservationsTable, paymentsTable, tripsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { roundMoney } from "./pricing";
import { RESERVATION_STATUS, PAYMENT_STATUS, type ReservationStatus } from "@workspace/permissions";

export type DbExecutor = Pick<typeof db, "execute" | "select" | "insert" | "update" | "delete">;

type ReservationUpdate = Partial<typeof reservationsTable.$inferInsert> & {
  status?: ReservationStatus;
};

async function sumPaidPayments(
  executor: DbExecutor,
  reservationId: string,
  tenantId: string,
): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COALESCE(SUM(amount::numeric), 0) AS total_paid
    FROM payments
    WHERE reservation_id = ${reservationId}
      AND tenant_id = ${tenantId}
      AND status = ${PAYMENT_STATUS.PAID}
  `);
  const row = (result as unknown as { rows: Array<{ total_paid: string }> }).rows[0];
  return roundMoney(Number(row?.total_paid ?? "0"));
}

export async function syncReservationPaymentStatus(
  reservationId: string,
  tenantId: string,
  executor: DbExecutor = db,
): Promise<void> {
  const [reservation] = await executor
    .select()
    .from(reservationsTable)
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)))
    .limit(1);
  if (!reservation) return;

  const totalValue = roundMoney(Number(reservation.totalValue));
  const paidValue = await sumPaidPayments(executor, reservationId, tenantId);
  const balance = roundMoney(Math.max(totalValue - paidValue, 0));

  if (
    reservation.status === RESERVATION_STATUS.CANCELLED ||
    reservation.status === RESERVATION_STATUS.COMPLETED
  ) {
    await executor
      .update(reservationsTable)
      .set({ paidValue: String(paidValue), balance: String(balance) })
      .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)));
    return;
  }

  const updates: ReservationUpdate = {
    paidValue: String(paidValue),
    balance: String(balance),
  };

  const previousStatus = reservation.status;

  if (paidValue >= totalValue) {
    updates.status = RESERVATION_STATUS.CONFIRMED;
    if (!reservation.confirmedAt) updates.confirmedAt = new Date();
    updates.expiresAt = null;
  } else if (reservation.status === RESERVATION_STATUS.CONFIRMED) {
    // Reservations confirmed via minimum deposit must stay confirmed
    // even when additional partial payments haven't yet reached totalValue.
    if (!reservation.depositAmount) {
      updates.status = RESERVATION_STATUS.PENDING;
    }
  }

  await executor
    .update(reservationsTable)
    .set(updates)
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)));

  // Keep trip seat counters in sync when a payment auto-promotes or auto-demotes a reservation.
  // Only reservations linked to a trip carry a tripId; client-only payment records don't.
  const newStatus = updates.status;
  if (newStatus && newStatus !== previousStatus && reservation.tripId) {
    const seatsCount = Array.isArray(reservation.seats) ? reservation.seats.length : 0;
    if (seatsCount > 0) {
      const isNowConfirmed = newStatus === RESERVATION_STATUS.CONFIRMED && previousStatus === RESERVATION_STATUS.PENDING;
      const isNowPending = newStatus === RESERVATION_STATUS.PENDING && previousStatus === RESERVATION_STATUS.CONFIRMED;

      if (isNowConfirmed) {
        await executor.update(tripsTable).set({
          confirmedSeats: sql`confirmed_seats + ${seatsCount}`,
          reservedSeats: sql`GREATEST(0, reserved_seats - ${seatsCount})`,
        }).where(and(eq(tripsTable.id, reservation.tripId), eq(tripsTable.tenantId, tenantId)));
      } else if (isNowPending) {
        await executor.update(tripsTable).set({
          confirmedSeats: sql`GREATEST(0, confirmed_seats - ${seatsCount})`,
          reservedSeats: sql`reserved_seats + ${seatsCount}`,
        }).where(and(eq(tripsTable.id, reservation.tripId), eq(tripsTable.tenantId, tenantId)));
      }
    }
  }
}

export async function paymentExistsForGatewayTx(
  tenantId: string,
  gateway: string,
  transactionId: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  const [existing] = await executor
    .select({ id: paymentsTable.id })
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.tenantId, tenantId),
        eq(paymentsTable.gateway, gateway),
        eq(paymentsTable.transactionId, transactionId),
      ),
    )
    .limit(1);
  return !!existing;
}

import { db } from "@workspace/db";
import { reservationsTable, tripsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { broadcastSeatUpdate } from "./realtime";

type CancelledRow = {
  id: string;
  trip_id: string;
  tenant_id: string;
  seats: string[] | null;
};

export async function runExpiredReservationsCron(): Promise<void> {
  const now = new Date();

  // Capture the affected rows outside the transaction so we can broadcast
  // SSE notifications after the commit, when clients can query fresh data.
  let cancelledRows: CancelledRow[] = [];

  // Wrap the entire operation in a single transaction so that if any trip
  // seat update fails the reservation cancellations are also rolled back,
  // keeping the database consistent and allowing the next cron run to retry.
  await db.transaction(async (tx) => {
    // Cancel all expired pending reservations atomically and get the affected rows.
    // Reservations that already have at least one associated payment are skipped so
    // that paid-but-slow reservations are never incorrectly cancelled by the TTL cron.
    const result = await tx.execute(
      sql`
        UPDATE reservations
        SET
          status       = ${RESERVATION_STATUS.CANCELLED},
          cancelled_at = now(),
          updated_at   = now()
        WHERE
          status     = ${RESERVATION_STATUS.PENDING}
          AND expires_at IS NOT NULL
          AND expires_at < ${now}
          AND NOT EXISTS (
            SELECT 1 FROM payments
            WHERE payments.reservation_id = reservations.id
          )
        RETURNING id, trip_id, tenant_id, seats
      `,
    );

    const rows = (result as unknown as { rows: CancelledRow[] }).rows;

    if (rows.length === 0) {
      logger.debug("[expired-reservations] No expired reservations found");
      return;
    }

    logger.info({ count: rows.length }, "[expired-reservations] Cancelling expired reservations");

    // Aggregate seats to restore per trip within the same transaction.
    // Only PENDING reservations are eligible for expiry (see WHERE clause above), so
    // these seats always live in the reserved_seats bucket — never in confirmed_seats.
    const seatsByTrip = new Map<string, number>();
    for (const row of rows) {
      const seatsCount = Array.isArray(row.seats) ? row.seats.length : 0;
      if (seatsCount > 0) {
        seatsByTrip.set(row.trip_id, (seatsByTrip.get(row.trip_id) ?? 0) + seatsCount);
      }
    }

    for (const [tripId, seatsCount] of seatsByTrip) {
      // Mirror the cap used by existing cancellation paths in reservations.ts:
      // available_seats cannot exceed total_capacity.
      await tx
        .update(tripsTable)
        .set({
          availableSeats: sql`LEAST(total_capacity, GREATEST(0, available_seats + ${seatsCount}))`,
          reservedSeats: sql`GREATEST(0, reserved_seats - ${seatsCount})`,
        })
        .where(eq(tripsTable.id, tripId));

      logger.info({ tripId, seatsReturned: seatsCount }, "[expired-reservations] Restored seats to trip");
    }

    logger.info(
      { totalCancelled: rows.length, tripsUpdated: seatsByTrip.size },
      "[expired-reservations] Run complete",
    );

    // Save rows for post-commit SSE broadcast (must happen after tx commits).
    cancelledRows = rows;
  });

  // Notify connected vitrine clients so their seat maps update immediately.
  // Broadcast runs after the transaction commits so SSE queries see fresh data.
  // One broadcast per trip is enough — deduplication via Set.
  // Fire-and-forget: a broadcast failure must never fail the cron run.
  if (cancelledRows.length > 0) {
    const seen = new Set<string>();
    for (const row of cancelledRows) {
      if (!row.trip_id || !row.tenant_id) continue;
      const key = `${row.trip_id}:${row.tenant_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      broadcastSeatUpdate(row.trip_id, row.tenant_id).catch((err) => {
        logger.warn({ err, tripId: row.trip_id }, "[expired-reservations] broadcastSeatUpdate failed — continuing");
      });
    }
  }
}

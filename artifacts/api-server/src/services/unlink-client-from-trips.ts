import { db, reservationsTable } from "@workspace/db";
import { ACTIVE_RESERVATION_STATUSES } from "@workspace/permissions";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  cancelLockedReservationAndReleaseCapacity,
  type LockedReservationCapacityRow,
} from "./reservation-capacity.js";

type DbExecutor = Pick<typeof db, "select" | "update">;

/**
 * Cancels active reservations and removes the client identity from the agency's
 * reservations without deleting the reservation, its passengers, or its seats.
 *
 * Reservation rows are locked before the transition. The status predicate on
 * every update makes retries safe: only rows that are still linked and active
 * can release capacity, so an already processed row cannot release seats twice.
 */
export async function unlinkClientFromTrips(
  tx: DbExecutor,
  tenantId: string,
  clientId: string,
): Promise<string[]> {
  const activeReservations = await tx
    .select({
      id: reservationsTable.id,
      tripId: reservationsTable.tripId,
      status: reservationsTable.status,
      seats: reservationsTable.seats,
    })
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.tenantId, tenantId),
      eq(reservationsTable.clientId, clientId),
      inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
    ))
    .orderBy(asc(reservationsTable.id))
    .for("update");

  const typedActiveReservations = activeReservations as LockedReservationCapacityRow[];
  const tripIds = new Set<string>();

  // Keep the reservation transition and capacity release in this transaction.
  // Each row is already locked in stable order, and the shared transition
  // releases capacity only for the active status observed under that lock.
  for (const reservation of typedActiveReservations) {
    const transitioned = await cancelLockedReservationAndReleaseCapacity(tx, tenantId, reservation, {
      clearClientLink: true,
    });
    if (transitioned) tripIds.add(reservation.tripId);
  }

  // Historical, already inactive reservations keep their data and only lose
  // the identity link. This also makes a repeated invocation harmless.
  await tx.update(reservationsTable)
    .set({ clientId: null })
    .where(and(
      eq(reservationsTable.tenantId, tenantId),
      eq(reservationsTable.clientId, clientId),
    ));

  return [...tripIds];
}
import { db, reservationsTable, tripsTable } from "@workspace/db";
import { ACTIVE_RESERVATION_STATUSES, RESERVATION_STATUS } from "@workspace/permissions";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../lib/errors";

type DbExecutor = Pick<typeof db, "select" | "update">;
type DeleteDbExecutor = DbExecutor & Pick<typeof db, "delete">;

export type LockedReservationCapacityRow = {
  id: string;
  tripId: string;
  status: typeof RESERVATION_STATUS.PENDING | typeof RESERVATION_STATUS.CONFIRMED;
  seats: string[];
};

/**
 * Finds seats already occupied by active reservations or complimentary
 * passengers on a trip. Callers that need a race-safe answer must hold the
 * trip row lock before calling this function.
 */
export async function findTripSeatConflicts(
  tx: Pick<typeof db, "select">,
  tenantId: string,
  tripId: string,
  seats: string[],
): Promise<string[]> {
  if (seats.length === 0) return [];

  const [trip] = await tx
    .select({ freePassengers: tripsTable.freePassengers })
    .from(tripsTable)
    .where(and(
      eq(tripsTable.id, tripId),
      eq(tripsTable.tenantId, tenantId),
    ))
    .limit(1);
  const activeReservations = await tx
    .select({ seats: reservationsTable.seats })
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.tripId, tripId),
      eq(reservationsTable.tenantId, tenantId),
      inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
    ));

  const occupiedSeats = new Set<string>(activeReservations.flatMap(row =>
    row.seats.map(seat => seat.trim()),
  ));
  if (trip && Array.isArray(trip.freePassengers)) {
    for (const passenger of trip.freePassengers) {
      const seat = passenger.seatNumber?.trim();
      if (seat) occupiedSeats.add(seat);
    }
  }

  return [...new Set(
    seats
      .map(seat => seat.trim())
      .filter(seat => seat !== "" && occupiedSeats.has(seat)),
  )];
}

/**
 * Moves the capacity occupied by an already locked active reservation from
 * one tenant trip to another. The trip rows are locked in a stable order so
 * concurrent moves involving different reservations cannot deadlock while
 * acquiring the two capacity rows.
 */
export async function moveLockedReservationCapacity(
  tx: DbExecutor,
  tenantId: string,
  reservation: LockedReservationCapacityRow,
  newTripId: string,
  seatsForConflictCheck: string[] = reservation.seats,
): Promise<void> {
  if (reservation.tripId === newTripId || reservation.seats.length === 0) return;

  const tripIds = [reservation.tripId, newTripId].sort();
  await tx
    .select({ id: tripsTable.id })
    .from(tripsTable)
    .where(and(
      eq(tripsTable.tenantId, tenantId),
      inArray(tripsTable.id, tripIds),
    ))
    .orderBy(asc(tripsTable.id))
    .for("update");

  const conflictingSeats = await findTripSeatConflicts(
    tx,
    tenantId,
    newTripId,
    seatsForConflictCheck,
  );
  if (conflictingSeats.length > 0) {
    throw new AppError(
      "Não é possível transferir a reserva porque há assentos ocupados na viagem de destino",
      409,
      "SEAT_CONFLICT",
      { conflictingSeats },
    );
  }

  const seatsCount = reservation.seats.length;
  const oldTripCapacity = {
    availableSeats: sql`LEAST(total_capacity, GREATEST(0, available_seats + ${seatsCount}))`,
    ...(reservation.status === RESERVATION_STATUS.CONFIRMED
      ? { confirmedSeats: sql`GREATEST(0, confirmed_seats - ${seatsCount})` }
      : { reservedSeats: sql`GREATEST(0, reserved_seats - ${seatsCount})` }),
  };
  const newTripCapacity = {
    availableSeats: sql`GREATEST(0, LEAST(total_capacity, available_seats - ${seatsCount}))`,
    ...(reservation.status === RESERVATION_STATUS.CONFIRMED
      ? { confirmedSeats: sql`confirmed_seats + ${seatsCount}` }
      : { reservedSeats: sql`reserved_seats + ${seatsCount}` }),
  };

  await tx.update(tripsTable).set(oldTripCapacity).where(and(
    eq(tripsTable.id, reservation.tripId),
    eq(tripsTable.tenantId, tenantId),
  ));
  await tx.update(tripsTable).set(newTripCapacity).where(and(
    eq(tripsTable.id, newTripId),
    eq(tripsTable.tenantId, tenantId),
  ));
}

/**
 * Acquires the reservation lock used by every capacity-changing cancellation
 * path. The reservation lock must be acquired before the trip lock.
 */
export async function lockReservationForCancellation(
  tx: DbExecutor,
  tenantId: string,
  reservationId: string,
): Promise<LockedReservationCapacityRow | undefined> {
  const [reservation] = await tx
    .select({
      id: reservationsTable.id,
      tripId: reservationsTable.tripId,
      status: reservationsTable.status,
      seats: reservationsTable.seats,
    })
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.id, reservationId),
      eq(reservationsTable.tenantId, tenantId),
    ))
    .for("update");

  const isActive = reservation?.status === RESERVATION_STATUS.PENDING
    || reservation?.status === RESERVATION_STATUS.CONFIRMED;
  return isActive ? reservation as LockedReservationCapacityRow : undefined;
}

/**
 * Cancels an already locked active reservation and releases its capacity.
 * Keeping this operation separate lets callers that already locked a batch of
 * reservations reuse the exact same transition without taking locks twice.
 */
export async function cancelLockedReservationAndReleaseCapacity(
  tx: DbExecutor,
  tenantId: string,
  reservation: LockedReservationCapacityRow,
  options: { clearClientLink?: boolean } = {},
): Promise<boolean> {
  const isActive = reservation.status === RESERVATION_STATUS.PENDING
    || reservation.status === RESERVATION_STATUS.CONFIRMED;
  if (!isActive) return false;

  const [transitioned] = await tx
    .update(reservationsTable)
    .set({
      status: RESERVATION_STATUS.CANCELLED,
      cancelledAt: new Date(),
      ...(options.clearClientLink ? { clientId: null } : {}),
    })
    .where(and(
      eq(reservationsTable.id, reservation.id),
      eq(reservationsTable.tenantId, tenantId),
      eq(reservationsTable.status, reservation.status),
    ))
    .returning({ id: reservationsTable.id });

  // The reservation may have been changed by another cancellation path
  // before this transition ran. Never release capacity unless this operation
  // actually changed the active row.
  if (!transitioned) return false;

  const seatsCount = reservation.seats.length;
  if (seatsCount > 0) {
    await tx
      .update(tripsTable)
      .set({
        availableSeats: sql`LEAST(total_capacity, GREATEST(0, available_seats + ${seatsCount}))`,
        ...(reservation.status === RESERVATION_STATUS.CONFIRMED
          ? { confirmedSeats: sql`GREATEST(0, confirmed_seats - ${seatsCount})` }
          : { reservedSeats: sql`GREATEST(0, reserved_seats - ${seatsCount})` }),
      })
      .where(and(
        eq(tripsTable.id, reservation.tripId),
        eq(tripsTable.tenantId, tenantId),
      ));
  }

  return true;
}

/**
 * Deletes one reservation after acquiring the same reservation-first lock
 * used by cancellation. Only an active reservation releases capacity; an
 * already cancelled/refunded reservation is simply removed.
 */
export async function deleteReservationAndReleaseCapacity(
  tx: DeleteDbExecutor,
  tenantId: string,
  reservationId: string,
): Promise<boolean> {
  const reservation = await lockReservationForCancellation(tx, tenantId, reservationId);

  if (reservation) {
    const seatsCount = reservation.seats.length;
    if (seatsCount > 0) {
      await tx
        .update(tripsTable)
        .set({
          availableSeats: sql`LEAST(total_capacity, GREATEST(0, available_seats + ${seatsCount}))`,
          ...(reservation.status === RESERVATION_STATUS.CONFIRMED
            ? { confirmedSeats: sql`GREATEST(0, confirmed_seats - ${seatsCount})` }
            : { reservedSeats: sql`GREATEST(0, reserved_seats - ${seatsCount})` }),
        })
        .where(and(
          eq(tripsTable.id, reservation.tripId),
          eq(tripsTable.tenantId, tenantId),
        ));
    }
  }

  await tx
    .delete(reservationsTable)
    .where(and(
      eq(reservationsTable.id, reservationId),
      eq(reservationsTable.tenantId, tenantId),
    ));

  return reservation !== undefined;
}

/**
 * Locks one reservation and conditionally applies the cancellation/capacity
 * transition. A retry that finds an inactive reservation is a no-op.
 */
export async function cancelReservationAndReleaseCapacity(
  tx: DbExecutor,
  tenantId: string,
  reservationId: string,
): Promise<boolean> {
  const reservation = await lockReservationForCancellation(tx, tenantId, reservationId);
  if (!reservation) return false;
  return cancelLockedReservationAndReleaseCapacity(tx, tenantId, reservation);
}
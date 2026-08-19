/**
 * Trip-overlap conflict detection and notification.
 *
 * When a reservation is created (CRM or storefront), this helper checks whether
 * the client now has active reservations in two or more trips with overlapping
 * dates.  If so it writes a client activity record of type "overlap_conflict"
 * so the conflict appears in the CRM client timeline and is surfaced by the
 * /alerts computed feed.
 *
 * Always best-effort: never throws; all errors are logged.
 */

import { db } from "@workspace/db";
import { reservationsTable, tripsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { writeClientActivity } from "./activities";
import { logger } from "./logger";

export type OverlappingReservation = {
  reservationId: string;
  reservationNumber: string | null;
  tripId: string;
  tripName: string;
  departureDate: string;
  returnDate: string | null;
};

export async function detectAndNotifyTripOverlap({
  reservationId,
  clientId,
  tripId,
  tenantId,
  actorUserId,
}: {
  reservationId: string;
  clientId: string;
  tripId: string;
  tenantId: string;
  actorUserId: string;
}): Promise<void> {
  try {
    // Fetch the newly created trip's dates
    const [trip] = await db
      .select({
        id: tripsTable.id,
        name: tripsTable.name,
        departureDate: tripsTable.departureDate,
        returnDate: tripsTable.returnDate,
      })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, tenantId)))
      .limit(1);

    if (!trip) return;

    const targetStart = trip.departureDate;
    const targetEnd = trip.returnDate ?? trip.departureDate;

    // All genuinely active reservations for this client (with their trip dates).
    // Only PENDING and CONFIRMED count as active; FAILED, COMPLETED, CANCELLED,
    // and REFUNDED are excluded so historical or broken reservations never
    // produce false conflict alerts.
    const otherRows = await db
      .select({
        id: reservationsTable.id,
        reservationNumber: reservationsTable.reservationNumber,
        tripId: reservationsTable.tripId,
        tripName: tripsTable.name,
        departureDate: tripsTable.departureDate,
        returnDate: tripsTable.returnDate,
      })
      .from(reservationsTable)
      .innerJoin(
        tripsTable,
        and(
          eq(tripsTable.id, reservationsTable.tripId),
          eq(tripsTable.tenantId, reservationsTable.tenantId),
        ),
      )
      .where(
        and(
          eq(reservationsTable.tenantId, tenantId),
          eq(reservationsTable.clientId, clientId),
          inArray(reservationsTable.status, [
            RESERVATION_STATUS.PENDING,
            RESERVATION_STATUS.CONFIRMED,
          ]),
        ),
      );

    // Compute overlaps in memory
    const overlapping: OverlappingReservation[] = [];
    for (const r of otherRows) {
      if (r.id === reservationId) continue; // skip the new reservation itself
      if (r.tripId === tripId) continue;    // same trip — duplicate guard handles this
      const otherEnd = r.returnDate ?? r.departureDate;
      // Overlap: [targetStart, targetEnd] ∩ [r.departureDate, otherEnd] ≠ ∅
      if (targetStart <= otherEnd && targetEnd >= r.departureDate) {
        overlapping.push({
          reservationId: r.id,
          reservationNumber: r.reservationNumber ?? null,
          tripId: r.tripId,
          tripName: r.tripName,
          departureDate: r.departureDate.toISOString(),
          returnDate: r.returnDate?.toISOString() ?? null,
        });
      }
    }

    if (overlapping.length === 0) return;

    // Write a client activity entry that surfaces in the CRM timeline and
    // is counted by the /alerts overlap query.
    const conflictNames = overlapping.map((o) => `"${o.tripName}"`).join(", ");
    await writeClientActivity(
      clientId,
      "overlap_conflict",
      `Reserva criada em "${trip.name}" conflita com período de: ${conflictNames}`,
      actorUserId,
      {
        newReservationId: reservationId,
        newTripId: tripId,
        newTripName: trip.name,
        conflictingTrips: overlapping,
      },
    );

    logger.info(
      { reservationId, clientId, tenantId, conflictCount: overlapping.length },
      "[trip-overlap] Overlap conflict activity written",
    );
  } catch (err) {
    logger.error(
      { err, reservationId, clientId, tenantId },
      "[trip-overlap] detectAndNotifyTripOverlap failed — non-fatal",
    );
  }
}

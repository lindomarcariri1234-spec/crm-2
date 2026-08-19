import { db } from "@workspace/db";
import { reservationsTable, tripsTable, clientsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { logger } from "./logger";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { cancelDealOnReservationCancellation } from "../services/pipeline-automation";

type DriftRow = {
  tripId: string;
  tenantId: string;
  storedReserved: number;
  storedConfirmed: number;
  storedAvailable: number;
  computedReserved: number;
  computedConfirmed: number;
  totalCapacity: number;
};

export type SeatReconciliationResult = {
  tripsChecked: number;
  tripsWithDrift: number;
  tripsCorrected: number;
  driftDetails: DriftRow[];
  orphansFixed: number;
};

/**
 * Reconciles seat counters (reserved_seats, confirmed_seats, available_seats) for
 * every trip that is not cancelled or completed. Discrepancies are corrected atomically
 * per trip. Never throws — errors are logged and the run continues.
 */
export async function runSeatReconciliationCron(): Promise<SeatReconciliationResult> {
  const result: SeatReconciliationResult = {
    tripsChecked: 0,
    tripsWithDrift: 0,
    tripsCorrected: 0,
    driftDetails: [],
    orphansFixed: 0,
  };

  try {
    const activeTrips = await db
      .select({
        id: tripsTable.id,
        tenantId: tripsTable.tenantId,
        totalCapacity: tripsTable.totalCapacity,
        reservedSeats: tripsTable.reservedSeats,
        confirmedSeats: tripsTable.confirmedSeats,
        availableSeats: tripsTable.availableSeats,
        freePassengers: tripsTable.freePassengers,
      })
      .from(tripsTable)
      .where(
        and(
          ne(tripsTable.status, "cancelled"),
          ne(tripsTable.status, "completed"),
        ),
      );

    result.tripsChecked = activeTrips.length;

    for (const trip of activeTrips) {
      try {
        const activeReservations = await db
          .select({ status: reservationsTable.status, seats: reservationsTable.seats })
          .from(reservationsTable)
          .where(
            and(
              eq(reservationsTable.tripId, trip.id),
              eq(reservationsTable.tenantId, trip.tenantId),
              inArray(reservationsTable.status, [
                RESERVATION_STATUS.PENDING,
                RESERVATION_STATUS.CONFIRMED,
              ]),
            ),
          );

        let computedReserved = 0;
        let computedConfirmed = 0;
        for (const r of activeReservations) {
          const count = (r.seats ?? []).length;
          if (r.status === RESERVATION_STATUS.CONFIRMED) computedConfirmed += count;
          else computedReserved += count;
        }

        const fpCount = Array.isArray(trip.freePassengers)
          ? (trip.freePassengers as unknown[]).length
          : 0;
        const totalCapacity = Number(trip.totalCapacity) || 0;
        const computedAvailable = Math.max(
          0,
          totalCapacity - computedReserved - computedConfirmed - fpCount,
        );

        const storedReserved = Number(trip.reservedSeats) || 0;
        const storedConfirmed = Number(trip.confirmedSeats) || 0;
        const storedAvailable = Number(trip.availableSeats) || 0;

        const hasDrift =
          storedReserved !== computedReserved ||
          storedConfirmed !== computedConfirmed ||
          storedAvailable !== computedAvailable;

        if (!hasDrift) continue;

        result.tripsWithDrift++;
        result.driftDetails.push({
          tripId: trip.id,
          tenantId: trip.tenantId,
          storedReserved,
          storedConfirmed,
          storedAvailable,
          computedReserved,
          computedConfirmed,
          totalCapacity,
        });

        logger.warn(
          {
            tripId: trip.id,
            tenantId: trip.tenantId,
            storedReserved,
            storedConfirmed,
            storedAvailable,
            computedReserved,
            computedConfirmed,
            computedAvailable,
          },
          "[seat-reconciliation] Drift detected — correcting",
        );

        await db
          .update(tripsTable)
          .set({
            reservedSeats: computedReserved,
            confirmedSeats: computedConfirmed,
            availableSeats: computedAvailable,
          })
          .where(
            and(eq(tripsTable.id, trip.id), eq(tripsTable.tenantId, trip.tenantId)),
          );

        result.tripsCorrected++;
      } catch (err) {
        logger.error({ err, tripId: trip.id }, "[seat-reconciliation] Error processing trip — skipping");
      }
    }

    const { orphansFixed } = await cleanupOrphanDeals();
    result.orphansFixed = orphansFixed;

    logger.info(
      {
        tripsChecked: result.tripsChecked,
        tripsWithDrift: result.tripsWithDrift,
        tripsCorrected: result.tripsCorrected,
        orphansFixed: result.orphansFixed,
      },
      "[seat-reconciliation] Run complete",
    );
  } catch (err) {
    logger.error({ err }, "[seat-reconciliation] Fatal error during reconciliation run");
  }

  return result;
}

/**
 * Reconciles seat counters only (no orphan deal cleanup). Used by the on-demand
 * "Corrigir agora" button so the action is scoped to exactly what is displayed.
 * Returns { fixed, skipped } where fixed = trips corrected and skipped = trips that
 * had drift but could not be corrected due to an error.
 */
export async function repairSeatDriftOnly(): Promise<{ fixed: number; skipped: number }> {
  let fixed = 0;
  let skipped = 0;

  try {
    const activeTrips = await db
      .select({
        id: tripsTable.id,
        tenantId: tripsTable.tenantId,
        totalCapacity: tripsTable.totalCapacity,
        reservedSeats: tripsTable.reservedSeats,
        confirmedSeats: tripsTable.confirmedSeats,
        availableSeats: tripsTable.availableSeats,
        freePassengers: tripsTable.freePassengers,
      })
      .from(tripsTable)
      .where(
        and(
          ne(tripsTable.status, "cancelled"),
          ne(tripsTable.status, "completed"),
        ),
      );

    for (const trip of activeTrips) {
      try {
        const activeReservations = await db
          .select({ status: reservationsTable.status, seats: reservationsTable.seats })
          .from(reservationsTable)
          .where(
            and(
              eq(reservationsTable.tripId, trip.id),
              eq(reservationsTable.tenantId, trip.tenantId),
              inArray(reservationsTable.status, [
                RESERVATION_STATUS.PENDING,
                RESERVATION_STATUS.CONFIRMED,
              ]),
            ),
          );

        let computedReserved = 0;
        let computedConfirmed = 0;
        for (const r of activeReservations) {
          const count = (r.seats ?? []).length;
          if (r.status === RESERVATION_STATUS.CONFIRMED) computedConfirmed += count;
          else computedReserved += count;
        }

        const fpCount = Array.isArray(trip.freePassengers)
          ? (trip.freePassengers as unknown[]).length
          : 0;
        const totalCapacity = Number(trip.totalCapacity) || 0;
        const computedAvailable = Math.max(
          0,
          totalCapacity - computedReserved - computedConfirmed - fpCount,
        );

        const storedReserved = Number(trip.reservedSeats) || 0;
        const storedConfirmed = Number(trip.confirmedSeats) || 0;
        const storedAvailable = Number(trip.availableSeats) || 0;

        const hasDrift =
          storedReserved !== computedReserved ||
          storedConfirmed !== computedConfirmed ||
          storedAvailable !== computedAvailable;

        if (!hasDrift) continue;

        await db
          .update(tripsTable)
          .set({
            reservedSeats: computedReserved,
            confirmedSeats: computedConfirmed,
            availableSeats: computedAvailable,
          })
          .where(
            and(eq(tripsTable.id, trip.id), eq(tripsTable.tenantId, trip.tenantId)),
          );

        fixed++;
        logger.warn(
          { tripId: trip.id, tenantId: trip.tenantId, storedReserved, storedConfirmed, storedAvailable, computedReserved, computedConfirmed, computedAvailable },
          "[seat-reconciliation] On-demand drift corrected",
        );
      } catch (err) {
        skipped++;
        logger.error({ err, tripId: trip.id }, "[seat-reconciliation] On-demand: error processing trip — skipping");
      }
    }

    logger.info({ fixed, skipped }, "[seat-reconciliation] On-demand repair complete");
  } catch (err) {
    logger.error({ err }, "[seat-reconciliation] On-demand: fatal error");
  }

  return { fixed, skipped };
}

/**
 * Returns a snapshot of seat counter drift across all active trips.
 * Purely read-only — does NOT correct anything. Used by the system-health endpoint.
 */
export async function getDriftSnapshot(): Promise<{ tripsChecked: number; tripsWithDrift: number }> {
  try {
    const activeTrips = await db
      .select({
        id: tripsTable.id,
        tenantId: tripsTable.tenantId,
        totalCapacity: tripsTable.totalCapacity,
        reservedSeats: tripsTable.reservedSeats,
        confirmedSeats: tripsTable.confirmedSeats,
        availableSeats: tripsTable.availableSeats,
        freePassengers: tripsTable.freePassengers,
      })
      .from(tripsTable)
      .where(
        and(
          ne(tripsTable.status, "cancelled"),
          ne(tripsTable.status, "completed"),
        ),
      );

    let tripsWithDrift = 0;
    for (const trip of activeTrips) {
      const activeReservations = await db
        .select({ status: reservationsTable.status, seats: reservationsTable.seats })
        .from(reservationsTable)
        .where(
          and(
            eq(reservationsTable.tripId, trip.id),
            eq(reservationsTable.tenantId, trip.tenantId),
            inArray(reservationsTable.status, [
              RESERVATION_STATUS.PENDING,
              RESERVATION_STATUS.CONFIRMED,
            ]),
          ),
        );

      let computedReserved = 0;
      let computedConfirmed = 0;
      for (const r of activeReservations) {
        const count = (r.seats ?? []).length;
        if (r.status === RESERVATION_STATUS.CONFIRMED) computedConfirmed += count;
        else computedReserved += count;
      }

      const fpCount = Array.isArray(trip.freePassengers)
        ? (trip.freePassengers as unknown[]).length
        : 0;
      const totalCapacity = Number(trip.totalCapacity) || 0;
      const computedAvailable = Math.max(0, totalCapacity - computedReserved - computedConfirmed - fpCount);

      const hasDrift =
        Number(trip.reservedSeats) !== computedReserved ||
        Number(trip.confirmedSeats) !== computedConfirmed ||
        Number(trip.availableSeats) !== computedAvailable;

      if (hasDrift) tripsWithDrift++;
    }

    return { tripsChecked: activeTrips.length, tripsWithDrift };
  } catch {
    return { tripsChecked: 0, tripsWithDrift: 0 };
  }
}

/**
 * Returns the count of clients whose stored outstandingBalance is negative.
 * A negative balance indicates a data inconsistency (more paid than invoiced),
 * which can happen if payments were recorded incorrectly or the recalculation
 * function was skipped.
 */
export async function getClientFinancialDriftCount(): Promise<number> {
  try {
    const rows = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(lt(clientsTable.outstandingBalance, "0"));
    return rows.length;
  } catch {
    return 0;
  }
}

/**
 * Closes all open Pipeline deals whose linked reservations are cancelled or refunded.
 * Calls cancelDealOnReservationCancellation for each orphan so the deal is moved to
 * the "Cancelado" stage and marked LOST. Never throws — errors per-deal are logged
 * and the loop continues.
 *
 * Two legs:
 *  1. Deals with an explicit reservation_id that points to a cancelled/refunded reservation.
 *  2. Deals with NO reservation_id whose client+trip has ONLY cancelled/refunded reservations
 *     (pre-linkage deals created before reservationId was enforced). We pick one cancelled
 *     reservationId from the pair so cancelDealOnReservationCancellation can resolve the
 *     client+trip context and use its own client+trip fallback to find the deal.
 *
 * Both legs apply a NOT EXISTS guard that mirrors cancelDealOnReservationCancellation
 * Steps 3 and 3b: if the client has ANY active (pending/confirmed) reservation on ANY
 * trip the helper returns false without cancelling — so we pre-filter those deals out
 * to keep the dashboard count perfectly aligned with what repair will actually close.
 */
export async function cleanupOrphanDeals(): Promise<{ orphansFixed: number }> {
  let orphansFixed = 0;
  try {
    // Leg 1: deals with a direct reservation_id link pointing to a cancelled/refunded
    // reservation AND whose reservation's client has no other active reservation anywhere.
    //
    // The active-reservation guard uses r.client_id (the joined reservation's client),
    // NOT d.client_id. cancelDealOnReservationCancellation derives the authoritative
    // client from the linked reservation row — deals.client_id may be null or stale
    // for exactly the historical data this cleanup targets.
    const linkedRows = await db.execute(sql`
      SELECT d.id, d.tenant_id AS "tenantId", d.reservation_id AS "reservationId"
      FROM deals d
      JOIN reservations r ON r.id = d.reservation_id AND r.tenant_id = d.tenant_id
      WHERE d.status = 'open'
        AND d.reservation_id IS NOT NULL
        AND r.status IN ('cancelled', 'refunded')
        AND r.client_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM   reservations ar
          WHERE  ar.client_id = r.client_id
            AND  ar.tenant_id = d.tenant_id
            AND  ar.status IN ('pending', 'confirmed')
        )
    `);
    const linkedOrphans = (linkedRows as unknown as { rows: Array<{ id: string; tenantId: string; reservationId: string }> }).rows;

    // Leg 2: deals with NO reservation_id whose client+trip has ONLY cancelled/refunded
    // reservations. Pick one cancelled reservationId per deal so we can pass context
    // to cancelDealOnReservationCancellation (which uses client+trip fallback internally).
    //
    // Guard 1 (same-trip all-cancelled): no reservation for this client+trip exists with a
    //   status other than cancelled/refunded (e.g. completed, failed, pending, confirmed).
    //   This enforces "ONLY cancelled/refunded" — a deal with a completed + cancelled history
    //   must NOT be closed.
    // Guard 2 (any-trip active): mirrors cancelDealOnReservationCancellation Steps 3 and 3b —
    //   the helper leaves deals OPEN when the client has any pending/confirmed reservation
    //   anywhere (same trip → re-link; other trip → keep open). Pre-filtering those deals
    //   keeps the dashboard count aligned with what repair actually closes.
    const unlinkedRows = await db.execute(sql`
      SELECT DISTINCT ON (d.id)
        d.id,
        d.tenant_id AS "tenantId",
        r.id        AS "reservationId"
      FROM deals d
      JOIN reservations r
        ON  r.client_id  = d.client_id
        AND r.trip_id    = d.trip_id
        AND r.tenant_id  = d.tenant_id
        AND r.status IN ('cancelled', 'refunded')
      WHERE d.status          = 'open'
        AND d.reservation_id IS NULL
        AND d.client_id      IS NOT NULL
        AND d.trip_id        IS NOT NULL
        AND NOT EXISTS (
          -- Guard 1: every same-trip reservation must be cancelled/refunded
          SELECT 1
          FROM   reservations sr
          WHERE  sr.client_id = d.client_id
            AND  sr.trip_id   = d.trip_id
            AND  sr.tenant_id = d.tenant_id
            AND  sr.status NOT IN ('cancelled', 'refunded')
        )
        AND NOT EXISTS (
          -- Guard 2: client must have no active reservation on any trip
          SELECT 1
          FROM   reservations ar
          WHERE  ar.client_id = d.client_id
            AND  ar.tenant_id = d.tenant_id
            AND  ar.status IN ('pending', 'confirmed')
        )
    `);
    const unlinkedOrphans = (unlinkedRows as unknown as { rows: Array<{ id: string; tenantId: string; reservationId: string }> }).rows;

    const allOrphans = [...linkedOrphans, ...unlinkedOrphans];

    for (const orphan of allOrphans) {
      const fixed = await cancelDealOnReservationCancellation({
        tenantId: orphan.tenantId,
        reservationId: orphan.reservationId,
      });
      if (fixed) orphansFixed++;
    }
    if (orphansFixed > 0) {
      logger.info({ orphansFixed }, "[seat-reconciliation] Orphan deals closed");
    }
  } catch (err) {
    logger.error({ err }, "[seat-reconciliation] Fatal error during orphan deal cleanup");
  }
  return { orphansFixed };
}

/**
 * Returns the count of open Pipeline deals that are orphaned — i.e. stuck in an
 * open stage even though all their reservations are cancelled or refunded.
 *
 * Covers both:
 *  - Deals with a direct reservation_id pointing to a cancelled/refunded reservation.
 *  - Deals with NO reservation_id whose client+trip has only cancelled/refunded reservations.
 */
export async function getOrphanDealsCount(): Promise<number> {
  try {
    const result = await db.execute(sql`
      SELECT
        (
          SELECT COUNT(*)
          FROM deals d
          JOIN reservations r ON r.id = d.reservation_id AND r.tenant_id = d.tenant_id
          WHERE d.status = 'open'
            AND d.reservation_id IS NOT NULL
            AND r.status IN ('cancelled', 'refunded')
            AND r.client_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM   reservations ar
              WHERE  ar.client_id = r.client_id
                AND  ar.tenant_id = d.tenant_id
                AND  ar.status IN ('pending', 'confirmed')
            )
        )
        +
        (
          SELECT COUNT(DISTINCT d.id)
          FROM deals d
          JOIN reservations r
            ON  r.client_id  = d.client_id
            AND r.trip_id    = d.trip_id
            AND r.tenant_id  = d.tenant_id
            AND r.status IN ('cancelled', 'refunded')
          WHERE d.status          = 'open'
            AND d.reservation_id IS NULL
            AND d.client_id      IS NOT NULL
            AND d.trip_id        IS NOT NULL
            AND NOT EXISTS (
              -- Guard 1: every same-trip reservation must be cancelled/refunded
              SELECT 1
              FROM   reservations sr
              WHERE  sr.client_id = d.client_id
                AND  sr.trip_id   = d.trip_id
                AND  sr.tenant_id = d.tenant_id
                AND  sr.status NOT IN ('cancelled', 'refunded')
            )
            AND NOT EXISTS (
              -- Guard 2: client must have no active reservation on any trip
              SELECT 1
              FROM   reservations ar
              WHERE  ar.client_id = d.client_id
                AND  ar.tenant_id = d.tenant_id
                AND  ar.status IN ('pending', 'confirmed')
            )
        )
        AS cnt
    `);
    const row = (result as unknown as { rows: Array<{ cnt: string }> }).rows[0];
    return parseInt(row?.cnt ?? "0", 10);
  } catch {
    return 0;
  }
}

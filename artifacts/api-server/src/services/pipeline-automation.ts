import { db } from "@workspace/db";
import { dealsTable, pipelineStagesTable, tripsTable, reservationsTable } from "@workspace/db";
import { eq, and, desc, ne, inArray, lt, lte, gte, isNotNull, isNull, max, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ACTIVE_RESERVATION_STATUSES, DEAL_STATUS } from "@workspace/permissions";
import { logger } from "../lib/logger";
import { generateId } from "../lib/id";

type PipelineExecutor = Pick<typeof db, "select" | "update">;
const departureTargetStages = alias(pipelineStagesTable, "departure_target_stages");
const postTripTargetStages = alias(pipelineStagesTable, "post_trip_target_stages");

export async function moveDealToStage({
  tenantId,
  dealId,
  reservationId,
  targetStageName,
  forwardOnly,
  executor,
}: {
  tenantId: string;
  dealId?: string;
  clientId?: string | null;
  reservationId?: string | null;
  targetStageName: string;
  forwardOnly: boolean;
  /** Use the caller's transaction when the stage move is part of a larger write. */
  executor?: PipelineExecutor;
}): Promise<void> {
  try {
    const exec = executor ?? db;
    // Step 1: Find the deal first so we know which pipeline it belongs to.
    let deal: { id: string; stageId: string } | undefined;

    if (dealId) {
      const [found] = await exec
        .select({ id: dealsTable.id, stageId: dealsTable.stageId })
        .from(dealsTable)
        .where(and(eq(dealsTable.id, dealId), eq(dealsTable.tenantId, tenantId)))
        .limit(1);
      deal = found;
    } else if (reservationId) {
      const [found] = await exec
        .select({ id: dealsTable.id, stageId: dealsTable.stageId })
        .from(dealsTable)
        .where(
          and(
            eq(dealsTable.tenantId, tenantId),
            eq(dealsTable.status, DEAL_STATUS.OPEN),
            eq(dealsTable.reservationId, reservationId),
          ),
        )
        .orderBy(desc(dealsTable.createdAt))
        .limit(1);
      deal = found;
    } else {
      // A generic client can have multiple trips. Reservation lifecycle stages
      // must never choose the newest arbitrary card from that client.
      return;
    }

    if (!deal) return;

    // Step 2: Look up the deal's current stage to obtain its pipelineId and order.
    // Both are needed: pipelineId scopes the target-stage search to the same
    // pipeline; order is used for the forwardOnly guard.
    const [currentStageRow] = await exec
      .select({ order: pipelineStagesTable.order, pipelineId: pipelineStagesTable.pipelineId })
      .from(pipelineStagesTable)
      .where(eq(pipelineStagesTable.id, deal.stageId))
      .limit(1);

    if (!currentStageRow) return;

    // Step 3: Find the target stage by name, scoped to the deal's own pipeline.
    // If the name doesn't exist in this pipeline we log a warning and do nothing —
    // we never move a deal to a stage that belongs to a different pipeline.
    const [targetStage] = await exec
      .select({ id: pipelineStagesTable.id, order: pipelineStagesTable.order })
      .from(pipelineStagesTable)
      .where(
        and(
          eq(pipelineStagesTable.pipelineId, currentStageRow.pipelineId),
          eq(pipelineStagesTable.tenantId, tenantId),
          eq(pipelineStagesTable.name, targetStageName),
        ),
      )
      .limit(1);

    if (!targetStage) {
      logger.warn(
        { tenantId, targetStageName, pipelineId: currentStageRow.pipelineId, dealId: deal.id },
        "[pipeline-automation] Target stage not found in deal's pipeline — skipping move",
      );
      return;
    }

    // Step 4: Forward-only guard — never move a deal backwards.
    if (forwardOnly && currentStageRow.order >= targetStage.order) return;

    // Step 5: Advance the deal.
    await exec
      .update(dealsTable)
      .set({ stageId: targetStage.id })
      .where(and(eq(dealsTable.id, deal.id), eq(dealsTable.tenantId, tenantId)));
  } catch (err) {
    logger.error({ err, tenantId, targetStageName }, "[pipeline-automation] Failed to move deal to stage");
  }
}

/**
 * Moves the open deal linked to a cancelled reservation to the "Cancelado" stage.
 *
 * Rules:
 *  1. Load the cancelled reservation to obtain clientId + tripId (needed for
 *     the active-reservation check and the client+trip fallback lookup).
 *  2. Find the open deal — first by exact reservationId linkage, then by a
 *     client+trip fallback for deals created before reservationId linkage was
 *     enforced.
 *  3. If the client has ANOTHER active (pending/confirmed) reservation for the
 *     same trip, re-link the deal to that reservation and leave it OPEN.
 *  4. If the client has an active reservation for a different trip, also leave
 *     the deal OPEN and in its current stage. Confirmed/pending trips take
 *     priority over cancellation, but the deal is not re-linked across trips.
 *  5. Only when the client has no active reservation on any trip, move the deal
 *     to "Cancelado" and mark it LOST. Create the stage if it doesn't exist.
 *
 * Never throws — errors are logged and the cancellation continues.
 */
export async function cancelDealOnReservationCancellation({
  tenantId,
  reservationId,
}: {
  tenantId: string;
  reservationId: string;
}): Promise<boolean> {
  try {
    // Step 1: Load the cancelled reservation to get clientId + tripId.
    const [cancelledReservation] = await db
      .select({ clientId: reservationsTable.clientId, tripId: reservationsTable.tripId })
      .from(reservationsTable)
      .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)))
      .limit(1);

    if (!cancelledReservation?.clientId || !cancelledReservation?.tripId) return false;
    const { clientId, tripId } = cancelledReservation;

    // Step 2: Find the open deal.
    // Primary: exact reservationId match (preferred — avoids touching unrelated deals).
    // Fallback: client+trip match for pre-linkage deals that never had a reservationId set.
    let deal: { id: string; stageId: string } | undefined;

    const [byReservationId] = await db
      .select({ id: dealsTable.id, stageId: dealsTable.stageId })
      .from(dealsTable)
      .where(
        and(
          eq(dealsTable.tenantId, tenantId),
          eq(dealsTable.status, DEAL_STATUS.OPEN),
          eq(dealsTable.reservationId, reservationId),
        ),
      )
      .limit(1);

    if (byReservationId) {
      deal = byReservationId;
    } else {
      const [byClientTrip] = await db
        .select({ id: dealsTable.id, stageId: dealsTable.stageId })
        .from(dealsTable)
        .where(
          and(
            eq(dealsTable.tenantId, tenantId),
            eq(dealsTable.status, DEAL_STATUS.OPEN),
            eq(dealsTable.clientId, clientId),
            eq(dealsTable.tripId, tripId),
          ),
        )
        .orderBy(desc(dealsTable.createdAt))
        .limit(1);
      deal = byClientTrip;
    }

    if (!deal) return false;

    // Step 3: Check for another active reservation on this same trip. If one
    // exists, keep the trip-specific deal linked to its surviving booking.
    const [activeSameTripReservation] = await db
      .select({ id: reservationsTable.id })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.tenantId, tenantId),
          eq(reservationsTable.clientId, clientId),
          eq(reservationsTable.tripId, tripId),
          ne(reservationsTable.id, reservationId),
          inArray(reservationsTable.status, ["pending", "confirmed"]),
        ),
      )
      .limit(1);

    if (activeSameTripReservation) {
      await db
        .update(dealsTable)
        .set({ reservationId: activeSameTripReservation.id })
        .where(and(eq(dealsTable.id, deal.id), eq(dealsTable.tenantId, tenantId)));

      logger.info(
        {
          tenantId,
          dealId: deal.id,
          cancelledReservationId: reservationId,
          activeReservationId: activeSameTripReservation.id,
        },
        "[pipeline-automation] Deal re-linked to active reservation — not moved to Cancelado",
      );
      return false;
    }

    // Step 4: Another trip for the same client still has an active reservation.
    // Confirmed/pending travel takes priority over cancellation. Keep this
    // trip-specific deal in its current stage, without re-linking it to a
    // different trip's reservation.
    const [activeOtherTripReservation] = await db
      .select({ id: reservationsTable.id })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.tenantId, tenantId),
          eq(reservationsTable.clientId, clientId),
          ne(reservationsTable.id, reservationId),
          ne(reservationsTable.tripId, tripId),
          inArray(reservationsTable.status, ["pending", "confirmed"]),
        ),
      )
      .limit(1);

    if (activeOtherTripReservation) {
      logger.info(
        {
          tenantId,
          dealId: deal.id,
          cancelledReservationId: reservationId,
          activeReservationId: activeOtherTripReservation.id,
        },
        "[pipeline-automation] Client has another active trip — deal not moved to Cancelado",
      );
      return false;
    }

    // Step 5: No active reservation remains for this client. Resolve the deal's
    // pipeline from its current stage before finding/creating the target stage.
    const [currentStage] = await db
      .select({ pipelineId: pipelineStagesTable.pipelineId })
      .from(pipelineStagesTable)
      .where(eq(pipelineStagesTable.id, deal.stageId))
      .limit(1);

    if (!currentStage) return false;
    const { pipelineId } = currentStage;

    // Step 6: Look for an existing "Cancelado" stage in this pipeline.
    const [cancelledStage] = await db
      .select({ id: pipelineStagesTable.id })
      .from(pipelineStagesTable)
      .where(
        and(
          eq(pipelineStagesTable.pipelineId, pipelineId),
          eq(pipelineStagesTable.tenantId, tenantId),
          eq(pipelineStagesTable.name, "Cancelado"),
        ),
      )
      .limit(1);

    let cancelledStageId: string;

    if (cancelledStage) {
      cancelledStageId = cancelledStage.id;
    } else {
      // Stage doesn't exist — find the max order and create it.
      const [maxRow] = await db
        .select({ maxOrder: max(pipelineStagesTable.order) })
        .from(pipelineStagesTable)
        .where(
          and(
            eq(pipelineStagesTable.pipelineId, pipelineId),
            eq(pipelineStagesTable.tenantId, tenantId),
          ),
        );

      const newOrder = (maxRow?.maxOrder ?? 0) + 10;
      const newId = generateId();

      await db.insert(pipelineStagesTable).values({
        id: newId,
        tenantId,
        pipelineId,
        name: "Cancelado",
        color: "#6b7280",
        order: newOrder,
      }).onConflictDoNothing();

      // A cancellation replay can race another worker creating this default
      // stage. The stage-name unique index resolves the write; re-read the
      // canonical row so both workers move the deal to the same stage.
      const [resolvedStage] = await db
        .select({ id: pipelineStagesTable.id })
        .from(pipelineStagesTable)
        .where(and(
          eq(pipelineStagesTable.pipelineId, pipelineId),
          eq(pipelineStagesTable.tenantId, tenantId),
          eq(pipelineStagesTable.name, "Cancelado"),
        ))
        .limit(1);
      if (!resolvedStage) return false;

      cancelledStageId = resolvedStage.id;
      logger.info(
        { tenantId, pipelineId, stageId: newId, order: newOrder },
        "[pipeline-automation] Created default 'Cancelado' stage",
      );
    }

    // Step 7: Move the deal and mark it as lost.
    await db
      .update(dealsTable)
      .set({ stageId: cancelledStageId, status: DEAL_STATUS.LOST })
      .where(and(eq(dealsTable.id, deal.id), eq(dealsTable.tenantId, tenantId)));

    logger.info(
      { tenantId, dealId: deal.id, reservationId, stageId: cancelledStageId },
      "[pipeline-automation] Deal moved to Cancelado on reservation cancellation",
    );
    return true;
  } catch (err) {
    logger.error({ err, tenantId, reservationId }, "[pipeline-automation] Failed to cancel deal on reservation cancellation");
    return false;
  }
}

export async function runPipelineTripEndedCron(): Promise<void> {
  logger.info("[pipeline-automation] Running trip-ended cron");
  const now = new Date();

  // Catch up every overdue open deal, not only trips returned in the last
  // seven days. If Redis lease contention or an outage skips several runs,
  // the prior window could permanently strand older cards in "Em Viagem".
  // Joining deals and their stages avoids rescanning trips with no outstanding
  // pipeline work and leaves already-advanced cards out of the daily query.
  const candidates = await db
    .select({
      dealId: dealsTable.id,
      tenantId: dealsTable.tenantId,
      pipelineId: pipelineStagesTable.pipelineId,
      currentStageOrder: pipelineStagesTable.order,
      targetStageId: postTripTargetStages.id,
      targetStageOrder: postTripTargetStages.order,
    })
    .from(tripsTable)
    .innerJoin(
      dealsTable,
      and(
        eq(dealsTable.tripId, tripsTable.id),
        eq(dealsTable.tenantId, tripsTable.tenantId),
        eq(dealsTable.status, DEAL_STATUS.OPEN),
      ),
    )
    .innerJoin(
      pipelineStagesTable,
      and(
        eq(pipelineStagesTable.id, dealsTable.stageId),
        eq(pipelineStagesTable.tenantId, tripsTable.tenantId),
      ),
    )
    .leftJoin(
      postTripTargetStages,
      and(
        eq(postTripTargetStages.pipelineId, pipelineStagesTable.pipelineId),
        eq(postTripTargetStages.tenantId, tripsTable.tenantId),
        eq(postTripTargetStages.name, "Pós Viagem"),
      ),
    )
    .where(
      and(
        isNotNull(tripsTable.returnDate),
        lte(sql`${tripsTable.returnDate}`, sql`${now}`),
        or(
          isNull(postTripTargetStages.id),
          lt(pipelineStagesTable.order, postTripTargetStages.order),
        ),
      ),
    );

  logger.info({ count: candidates.length }, "[pipeline-automation] Overdue trip deals — processing");

  const missingTargetStagePipelines = new Set<string>();
  const dueDeals = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (!candidate.targetStageId || candidate.targetStageOrder == null) {
      missingTargetStagePipelines.add(candidate.pipelineId);
      continue;
    }
    if (candidate.currentStageOrder >= candidate.targetStageOrder) continue;
    dueDeals.set(candidate.dealId, candidate);
  }

  for (const pipelineId of missingTargetStagePipelines) {
    logger.warn(
      { pipelineId, targetStageName: "Pós Viagem" },
      "[pipeline-automation] Target stage not found in pipeline — skipping trip-ended moves",
    );
  }

  let attempted = 0;
  for (const candidate of dueDeals.values()) {
    await moveDealToStage({
      tenantId: candidate.tenantId,
      dealId: candidate.dealId,
      targetStageName: "Pós Viagem",
      forwardOnly: true,
    });
    attempted++;
  }

  logger.info(
    { candidates: candidates.length, attempted, missingTargetStagePipelines: missingTargetStagePipelines.size },
    "[pipeline-automation] Trip-ended cron complete",
  );
}

const saoPauloDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const saoPauloDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formattedParts(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
}

/**
 * Trip dates are stored at noon in the Brazil timezone to preserve the local
 * calendar date. The optional departureTime is a separate local wall-clock
 * value, so compare both in America/Sao_Paulo rather than treating the stored
 * date timestamp as the actual departure instant.
 */
export function isTripDepartureReached(
  departureDate: Date,
  departureTime: string | null,
  now: Date,
): boolean {
  if (!Number.isFinite(departureDate.getTime()) || !Number.isFinite(now.getTime()) || !departureTime) {
    return false;
  }

  const timeMatch = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(departureTime.trim());
  if (!timeMatch) return false;

  const tripDate = formattedParts(saoPauloDateFormatter, departureDate);
  const current = formattedParts(saoPauloDateTimeFormatter, now);
  const departureKey = `${tripDate.year}-${tripDate.month}-${tripDate.day}T${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  const currentKey = `${current.year}-${current.month}-${current.day}T${current.hour}:${current.minute}`;
  return currentKey >= departureKey;
}

/**
 * Advances only open pipeline cards attached to the exact active, fully-paid
 * reservation for a trip whose local departure date and time have passed.
 * Reservation status and payment records are deliberately left unchanged.
 */
export async function runPipelineTripDepartureCron(): Promise<void> {
  const now = new Date();
  // departure_date represents local noon, while departure_time can be earlier
  // on the same date. Include a lookback for short outages and a forward buffer
  // so today's date is in the DB range before its stored noon timestamp.
  const from = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  const through = new Date(now.getTime() + 12 * 60 * 60 * 1000);

  const candidates = await db
    .select({
      dealId: dealsTable.id,
      tenantId: tripsTable.tenantId,
      departureDate: tripsTable.departureDate,
      departureTime: tripsTable.departureTime,
      pipelineId: pipelineStagesTable.pipelineId,
      currentStageOrder: pipelineStagesTable.order,
      targetStageId: departureTargetStages.id,
      targetStageOrder: departureTargetStages.order,
    })
    .from(tripsTable)
    .innerJoin(
      reservationsTable,
      and(
        eq(reservationsTable.tripId, tripsTable.id),
        eq(reservationsTable.tenantId, tripsTable.tenantId),
      ),
    )
    .innerJoin(
      dealsTable,
      and(
        eq(dealsTable.reservationId, reservationsTable.id),
        eq(dealsTable.tripId, tripsTable.id),
        eq(dealsTable.clientId, reservationsTable.clientId),
        eq(dealsTable.tenantId, tripsTable.tenantId),
        eq(dealsTable.status, DEAL_STATUS.OPEN),
      ),
    )
    .innerJoin(
      pipelineStagesTable,
      and(
        eq(pipelineStagesTable.id, dealsTable.stageId),
        eq(pipelineStagesTable.tenantId, tripsTable.tenantId),
      ),
    )
    .leftJoin(
      departureTargetStages,
      and(
        eq(departureTargetStages.pipelineId, pipelineStagesTable.pipelineId),
        eq(departureTargetStages.tenantId, tripsTable.tenantId),
        eq(departureTargetStages.name, "Em Viagem"),
      ),
    )
    .where(
      and(
        gte(tripsTable.departureDate, from),
        lte(tripsTable.departureDate, through),
        inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
        lte(reservationsTable.balance, "0"),
      ),
    );

  const dueDeals = new Map<string, (typeof candidates)[number]>();
  let skippedWithoutTime = 0;
  const missingTargetStagePipelines = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.departureTime) {
      skippedWithoutTime++;
      continue;
    }
    if (!isTripDepartureReached(candidate.departureDate, candidate.departureTime, now)) continue;
    if (!candidate.targetStageId || candidate.targetStageOrder == null) {
      missingTargetStagePipelines.add(candidate.pipelineId);
      continue;
    }
    // The current stage itself is the idempotency marker: don't query or move
    // cards again after they have reached "Em Viagem" or any later stage.
    if (candidate.currentStageOrder >= candidate.targetStageOrder) continue;
    dueDeals.set(candidate.dealId, candidate);
  }

  for (const pipelineId of missingTargetStagePipelines) {
    logger.warn(
      { pipelineId, targetStageName: "Em Viagem" },
      "[pipeline-automation] Target stage not found in pipeline — skipping departure moves",
    );
  }

  for (const candidate of dueDeals.values()) {
    await moveDealToStage({
      tenantId: candidate.tenantId,
      dealId: candidate.dealId,
      targetStageName: "Em Viagem",
      forwardOnly: true,
    });
  }

  logger.info(
    { candidates: candidates.length, due: dueDeals.size, skippedWithoutTime },
    "[pipeline-automation] Trip-departure cron complete",
  );
}

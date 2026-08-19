import { db } from "@workspace/db";
import { dealsTable, pipelineStagesTable, tripsTable, reservationsTable } from "@workspace/db";
import { eq, and, desc, ne, inArray, lte, gte, isNotNull, max, sql } from "drizzle-orm";
import { DEAL_STATUS } from "@workspace/permissions";
import { logger } from "../lib/logger";
import { generateId } from "../lib/id";

export async function moveDealToStage({
  tenantId,
  dealId,
  clientId,
  reservationId,
  targetStageName,
  forwardOnly,
}: {
  tenantId: string;
  dealId?: string;
  clientId?: string | null;
  reservationId?: string | null;
  targetStageName: string;
  forwardOnly: boolean;
}): Promise<void> {
  try {
    // Step 1: Find the deal first so we know which pipeline it belongs to.
    let deal: { id: string; stageId: string } | undefined;

    if (dealId) {
      const [found] = await db
        .select({ id: dealsTable.id, stageId: dealsTable.stageId })
        .from(dealsTable)
        .where(and(eq(dealsTable.id, dealId), eq(dealsTable.tenantId, tenantId)))
        .limit(1);
      deal = found;
    } else {
      const [found] = await db
        .select({ id: dealsTable.id, stageId: dealsTable.stageId })
        .from(dealsTable)
        .where(
          and(
            eq(dealsTable.tenantId, tenantId),
            eq(dealsTable.status, DEAL_STATUS.OPEN),
            reservationId
              ? eq(dealsTable.reservationId, reservationId)
              : clientId
                ? eq(dealsTable.clientId, clientId)
                : undefined,
          ),
        )
        .orderBy(desc(dealsTable.createdAt))
        .limit(1);
      deal = found;
    }

    if (!deal) return;

    // Step 2: Look up the deal's current stage to obtain its pipelineId and order.
    // Both are needed: pipelineId scopes the target-stage search to the same
    // pipeline; order is used for the forwardOnly guard.
    const [currentStageRow] = await db
      .select({ order: pipelineStagesTable.order, pipelineId: pipelineStagesTable.pipelineId })
      .from(pipelineStagesTable)
      .where(eq(pipelineStagesTable.id, deal.stageId))
      .limit(1);

    if (!currentStageRow) return;

    // Step 3: Find the target stage by name, scoped to the deal's own pipeline.
    // If the name doesn't exist in this pipeline we log a warning and do nothing —
    // we never move a deal to a stage that belongs to a different pipeline.
    const [targetStage] = await db
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
    await db
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
 *     same trip, re-link the deal to that reservation and leave it OPEN —
 *     the deal should follow the surviving booking, not be cancelled.
 *  4. Otherwise move the deal to "Cancelado" and mark it LOST.  If the stage
 *     doesn't exist yet it is created automatically.
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

    // Step 3: Check if the client has another ACTIVE reservation for the same trip.
    // If so, re-link the deal to that reservation and leave it open — the client
    // still has a live booking; cancelling the deal would be incorrect.
    const [activeReservation] = await db
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

    if (activeReservation) {
      await db
        .update(dealsTable)
        .set({ reservationId: activeReservation.id })
        .where(and(eq(dealsTable.id, deal.id), eq(dealsTable.tenantId, tenantId)));

      logger.info(
        { tenantId, dealId: deal.id, cancelledReservationId: reservationId, activeReservationId: activeReservation.id },
        "[pipeline-automation] Deal re-linked to active reservation — not moved to Cancelado",
      );
      return false;
    }

    // Step 3b: Check if the client has an active reservation in any OTHER trip.
    // If so, the client is still an active booker — leave the deal open without
    // re-linking (the deal context remains tied to the cancelled trip).
    const [activeOtherTripReservation] = await db
      .select({ id: reservationsTable.id })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.tenantId, tenantId),
          eq(reservationsTable.clientId, clientId),
          ne(reservationsTable.tripId, tripId),
          inArray(reservationsTable.status, ["pending", "confirmed"]),
        ),
      )
      .limit(1);

    if (activeOtherTripReservation) {
      logger.info(
        { tenantId, dealId: deal.id, cancelledReservationId: reservationId, otherTripReservationId: activeOtherTripReservation.id },
        "[pipeline-automation] Client has active reservation in another trip — deal not moved to Cancelado",
      );
      return false;
    }

    // Step 4: No active reservation anywhere — get the deal's pipeline from its current stage.
    const [currentStage] = await db
      .select({ pipelineId: pipelineStagesTable.pipelineId })
      .from(pipelineStagesTable)
      .where(eq(pipelineStagesTable.id, deal.stageId))
      .limit(1);

    if (!currentStage) return false;
    const { pipelineId } = currentStage;

    // Step 5: Look for an existing "Cancelado" stage in this pipeline.
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
      });

      cancelledStageId = newId;
      logger.info(
        { tenantId, pipelineId, stageId: newId, order: newOrder },
        "[pipeline-automation] Created default 'Cancelado' stage",
      );
    }

    // Step 6: Move the deal and mark it as lost.
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
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const endedTrips = await db
    .select({ id: tripsTable.id, tenantId: tripsTable.tenantId })
    .from(tripsTable)
    .where(
      and(
        isNotNull(tripsTable.returnDate),
        lte(sql`${tripsTable.returnDate}`, sql`${now}`),
        gte(sql`${tripsTable.returnDate}`, sql`${sevenDaysAgo}`),
      ),
    );

  logger.info({ count: endedTrips.length }, "[pipeline-automation] Trips ended — processing deals");

  let moved = 0;
  for (const trip of endedTrips) {
    const openDeals = await db
      .select({ id: dealsTable.id })
      .from(dealsTable)
      .where(
        and(
          eq(dealsTable.tenantId, trip.tenantId),
          eq(dealsTable.tripId, trip.id),
          eq(dealsTable.status, DEAL_STATUS.OPEN),
        ),
      );

    for (const deal of openDeals) {
      await moveDealToStage({
        tenantId: trip.tenantId,
        dealId: deal.id,
        targetStageName: "Pós Viagem",
        forwardOnly: true,
      });
      moved++;
    }
  }

  logger.info({ moved }, "[pipeline-automation] Trip-ended cron complete");
}

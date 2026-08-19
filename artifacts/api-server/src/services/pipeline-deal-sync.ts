/**
 * pipeline-deal-sync.ts
 *
 * Ensures exactly one open Pipeline deal card exists for a given client+trip
 * whenever a reservation is created or updated.
 *
 * Invariant enforced here:
 *   - If an open deal already exists for (clientId, tripId, tenantId) → update
 *     it and advance to "Reserva Criada" stage (forwardOnly — never backwards).
 *   - If no open deal for that specific trip, but there IS an open deal for the
 *     same client (different trip) → also update/reuse it (prevent duplicate
 *     leads when a client switches trips).
 *   - If no open deal at all → insert exactly one new deal in "Reserva Criada"
 *     (or the first available stage if "Reserva Criada" is not configured).
 *
 * Called fire-and-forget from POST/PUT /reservations. Never throws —
 * the caller wraps the returned Promise in `.catch()`.
 */

import { db, clientsTable, tripsTable, dealsTable, pipelineStagesTable } from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { DEAL_STATUS } from "@workspace/permissions";
import { generateId } from "../lib/id.js";
import { moveDealToStage } from "./pipeline-automation.js";

export async function syncClientDeal(
  clientId: string,
  tenantId: string,
  tripId: string,
  totalValue: number,
  ownerId: string,
  reservationId?: string | null,
): Promise<void> {
  const [client] = await db.select({ name: clientsTable.name })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  const [trip] = await db.select({ name: tripsTable.name })
    .from(tripsTable)
    .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, tenantId)))
    .limit(1);

  const clientName = client?.name ?? "Cliente";
  const tripName = trip?.name ?? "Viagem";
  const title = `${clientName} — ${tripName}`;

  // Step 1: look for an open deal on the SAME trip (most specific match).
  let [existingDeal] = await db.select({ id: dealsTable.id })
    .from(dealsTable)
    .where(and(
      eq(dealsTable.clientId, clientId),
      eq(dealsTable.tenantId, tenantId),
      eq(dealsTable.tripId, tripId),
      eq(dealsTable.status, DEAL_STATUS.OPEN),
    ))
    .orderBy(desc(dealsTable.createdAt))
    .limit(1);

  // Step 2: if no trip-scoped deal, fall back to any open deal for this client.
  // This prevents a "Lead" card from lingering when a reservation is created
  // via a different path (e.g. frontend created a Lead deal without a tripId,
  // then the backend creates the reservation and syncClientDeal runs).
  if (!existingDeal) {
    [existingDeal] = await db.select({ id: dealsTable.id })
      .from(dealsTable)
      .where(and(
        eq(dealsTable.clientId, clientId),
        eq(dealsTable.tenantId, tenantId),
        eq(dealsTable.status, DEAL_STATUS.OPEN),
      ))
      .orderBy(desc(dealsTable.createdAt))
      .limit(1);
  }

  if (existingDeal) {
    await db.update(dealsTable)
      .set({ value: String(totalValue), tripId, title, ...(reservationId ? { reservationId } : {}) })
      .where(and(eq(dealsTable.id, existingDeal.id), eq(dealsTable.tenantId, tenantId)));
    await moveDealToStage({
      tenantId,
      dealId: existingDeal.id,
      targetStageName: "Reserva Criada",
      forwardOnly: true,
    });
  } else {
    const [reservaCriadaStage] = await db.select({ id: pipelineStagesTable.id })
      .from(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.tenantId, tenantId), eq(pipelineStagesTable.name, "Reserva Criada")))
      .limit(1);

    const [firstStage] = await db.select({ id: pipelineStagesTable.id })
      .from(pipelineStagesTable)
      .where(eq(pipelineStagesTable.tenantId, tenantId))
      .orderBy(asc(pipelineStagesTable.order))
      .limit(1);

    const stageId = reservaCriadaStage?.id ?? firstStage?.id;
    if (!stageId) return;

    await db.insert(dealsTable).values({
      id: generateId(),
      tenantId,
      clientId,
      stageId,
      tripId,
      reservationId: reservationId ?? null,
      title,
      value: String(totalValue),
      status: DEAL_STATUS.OPEN,
      ownerId,
    });
  }
}

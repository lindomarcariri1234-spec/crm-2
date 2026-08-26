/**
 * Keeps the reservation lifecycle and the sales pipeline on one canonical path.
 *
 * An open card belongs to a tenant + client + trip. A trip-less manual lead may
 * be adopted when its first reservation is created, but a card from another
 * trip is never repurposed. This preserves the history and avoids cross-trip
 * cards disappearing from the board.
 */
import {
  db,
  clientsTable,
  tripsTable,
  dealsTable,
  pipelineStagesTable,
  pipelinesTable,
} from "@workspace/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { DEAL_STATUS } from "@workspace/permissions";
import { generateId } from "../lib/id.js";
import { moveDealToStage } from "./pipeline-automation.js";

export type PipelineExecutor = Pick<typeof db, "select" | "insert" | "update">;

export interface SyncClientDealOptions {
  reservationId?: string | null;
  /**
   * The lifecycle event that caused this sync. The move is always forward-only
   * for an existing card, so replaying an earlier event cannot regress it.
   */
  targetStageName?: "Vitrine" | "Reserva Criada" | "Pagamento Confirmado" | "Em Viagem" | "Pós Viagem";
  /** The origin is set only when a card is first created. */
  source?: "manual" | "website";
  executor?: PipelineExecutor;
}

async function resolveCanonicalLifecycleStage(
  exec: PipelineExecutor,
  tenantId: string,
  stageName: NonNullable<SyncClientDealOptions["targetStageName"]>,
): Promise<string | null> {
  const [canonicalPipeline] = await exec.select({ id: pipelinesTable.id })
    .from(pipelinesTable)
    .where(and(
      eq(pipelinesTable.tenantId, tenantId),
      eq(pipelinesTable.isActive, true),
    ))
    .orderBy(desc(pipelinesTable.isDefault), asc(pipelinesTable.createdAt))
    .limit(1);
  if (!canonicalPipeline) return null;

  const [targetStage] = await exec.select({ id: pipelineStagesTable.id })
    .from(pipelineStagesTable)
    .where(and(
      eq(pipelineStagesTable.tenantId, tenantId),
      eq(pipelineStagesTable.pipelineId, canonicalPipeline.id),
      eq(pipelineStagesTable.name, stageName),
    ))
    .limit(1);
  if (targetStage) return targetStage.id;

  const [firstStage] = await exec.select({ id: pipelineStagesTable.id })
    .from(pipelineStagesTable)
    .where(and(
      eq(pipelineStagesTable.tenantId, tenantId),
      eq(pipelineStagesTable.pipelineId, canonicalPipeline.id),
    ))
    .orderBy(asc(pipelineStagesTable.order))
    .limit(1);
  return firstStage?.id ?? null;
}

export async function syncClientDeal(
  clientId: string,
  tenantId: string,
  tripId: string,
  totalValue: number,
  ownerId: string,
  optionsArg: SyncClientDealOptions | string | null = {},
): Promise<void> {
  // Keep the old reservationId argument accepted while checkout uses the
  // richer transaction-aware options object.
  const options: SyncClientDealOptions = typeof optionsArg === "string"
    ? { reservationId: optionsArg }
    : optionsArg ?? {};
  const exec = options.executor ?? db;
  const targetStageName = options.targetStageName ?? "Reserva Criada";

  const [client] = await exec.select({ name: clientsTable.name })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);
  const [trip] = await exec.select({ name: tripsTable.name })
    .from(tripsTable)
    .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, tenantId)))
    .limit(1);

  const title = `${client?.name ?? "Cliente"} — ${trip?.name ?? "Viagem"}`;

  // Prefer the precise trip card. A manually-created lead without a trip is
  // the only safe fallback that can be adopted by a new reservation.
  let [deal] = await exec.select({ id: dealsTable.id })
    .from(dealsTable)
    .where(and(
      eq(dealsTable.tenantId, tenantId),
      eq(dealsTable.clientId, clientId),
      eq(dealsTable.tripId, tripId),
      eq(dealsTable.status, DEAL_STATUS.OPEN),
    ))
    .orderBy(desc(dealsTable.createdAt))
    .limit(1);

  if (!deal) {
    [deal] = await exec.select({ id: dealsTable.id })
      .from(dealsTable)
      .where(and(
        eq(dealsTable.tenantId, tenantId),
        eq(dealsTable.clientId, clientId),
        isNull(dealsTable.tripId),
        eq(dealsTable.status, DEAL_STATUS.OPEN),
      ))
      .orderBy(desc(dealsTable.createdAt))
      .limit(1);
  }

  if (deal) {
    await exec.update(dealsTable)
      .set({
        value: String(totalValue),
        title,
        tripId,
        ...(options.reservationId ? { reservationId: options.reservationId } : {}),
      })
      .where(and(eq(dealsTable.id, deal.id), eq(dealsTable.tenantId, tenantId)));

    await moveDealToStage({
      tenantId,
      dealId: deal.id,
      targetStageName,
      forwardOnly: true,
      executor: exec,
    });
    return;
  }

  const stageId = await resolveCanonicalLifecycleStage(exec, tenantId, targetStageName);
  if (!stageId) return;

  // The database partial unique index is the final concurrency guard. This
  // makes duplicate requests a harmless no-op instead of a 500, while normal
  // replays find and update the already-created card above.
  await exec.insert(dealsTable).values({
    id: generateId(),
    tenantId,
    clientId,
    stageId,
    tripId,
    reservationId: options.reservationId ?? null,
    title,
    value: String(totalValue),
    status: DEAL_STATUS.OPEN,
    ownerId,
    source: options.source ?? "manual",
    autoCreated: true,
  }).onConflictDoNothing();
}

/**
 * Product-only orders have no reservation/trip and therefore must not use the
 * reservation lifecycle fallback. They retain their historical CRM visibility
 * as one stable, paid store-order card.
 */
export async function syncPaidProductOrderDeal(args: {
  tenantId: string;
  clientId: string;
  ownerId: string;
  orderNumber: string;
  totalValue: string | number;
  executor?: PipelineExecutor;
}): Promise<void> {
  const exec = args.executor ?? db;
  const title = `Pedido Loja ${args.orderNumber}`;
  const [existingDeal] = await exec.select({ id: dealsTable.id })
    .from(dealsTable)
    .where(and(
      eq(dealsTable.tenantId, args.tenantId),
      eq(dealsTable.title, title),
    ))
    .limit(1);

  const stageId = await resolveCanonicalLifecycleStage(exec, args.tenantId, "Pagamento Confirmado");
  if (!stageId) return;

  if (existingDeal) {
    await exec.update(dealsTable)
      .set({ value: String(args.totalValue), stageId, status: DEAL_STATUS.WON })
      .where(and(eq(dealsTable.id, existingDeal.id), eq(dealsTable.tenantId, args.tenantId)));
    return;
  }

  await exec.insert(dealsTable).values({
    id: generateId(),
    tenantId: args.tenantId,
    stageId,
    title,
    value: String(args.totalValue),
    clientId: args.clientId,
    ownerId: args.ownerId,
    status: DEAL_STATUS.WON,
    source: "website",
    autoCreated: true,
  });
}
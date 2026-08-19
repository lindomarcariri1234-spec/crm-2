import { db } from "@workspace/db";
import { usersTable, pipelineStagesTable, pipelinesTable, tripsTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { AppError } from "../../lib/errors";

export interface ReservationContext {
  reservationCreatedById: string;
  vitrineStageId: string | null;
  /** Stage "Reserva Criada" in the default pipeline, used when the order is
   *  deposit-confirmed so the deal enters the pipeline already won. */
  reservaCriadaStageId: string | null;
  tripNameMap: Map<string, string>;
}

export async function loadReservationContext(args: {
  tenantId: string;
  tripIds: string[];
}): Promise<ReservationContext> {
  const { tenantId, tripIds } = args;

  const [adminUser] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true)))
    .limit(1);
  if (!adminUser) {
    throw new AppError(
      "Não foi possível criar a reserva: nenhum usuário ativo encontrado para esta agência",
      500,
      "RESERVATION_NO_AGENCY_USER",
    );
  }

  const stages = await db.select({
    id: pipelineStagesTable.id,
    isDefaultWeb: pipelineStagesTable.isDefaultWeb,
    name: pipelineStagesTable.name,
    order: pipelineStagesTable.order,
    pipelineId: pipelineStagesTable.pipelineId,
    pipelineIsDefault: pipelinesTable.isDefault,
  })
    .from(pipelineStagesTable)
    .innerJoin(pipelinesTable, eq(pipelineStagesTable.pipelineId, pipelinesTable.id))
    .where(eq(pipelineStagesTable.tenantId, tenantId))
    // Order by pipeline age first so the fallback consistently picks the oldest pipeline.
    .orderBy(asc(pipelinesTable.createdAt), asc(pipelineStagesTable.order));

  // Prefer stages that belong to the default pipeline.
  // Fallback: use the oldest pipeline (first by createdAt, already sorted above).
  const defaultStages = stages.filter((s) => s.pipelineIsDefault);
  let sourceStages: typeof stages;
  if (defaultStages.length > 0) {
    sourceStages = defaultStages;
  } else {
    const firstPipelineId = stages[0]?.pipelineId;
    sourceStages = firstPipelineId
      ? stages.filter((s) => s.pipelineId === firstPipelineId)
      : stages;
  }
  const vitrine =
    sourceStages.find((s) => s.isDefaultWeb) ??
    sourceStages.find((s) => s.name === "Vitrine") ??
    sourceStages[0];

  const reservaCriada =
    sourceStages.find((s) => s.name === "Reserva Criada") ??
    null;

  const tripNameMap = new Map<string, string>();
  if (tripIds.length > 0) {
    const tripRows = await db.select({ id: tripsTable.id, name: tripsTable.name })
      .from(tripsTable)
      .where(and(inArray(tripsTable.id, tripIds), eq(tripsTable.tenantId, tenantId)));
    for (const t of tripRows) tripNameMap.set(t.id, t.name);
  }

  return {
    reservationCreatedById: adminUser.id,
    vitrineStageId: vitrine?.id ?? null,
    reservaCriadaStageId: reservaCriada?.id ?? null,
    tripNameMap,
  };
}

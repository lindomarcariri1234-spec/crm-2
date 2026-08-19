import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { pipelinesTable, pipelineStagesTable, dealsTable, clientsTable, reservationsTable } from "@workspace/db";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { generateId } from "../lib/id";
import { requireAuth, getTenantUser, ADMIN_ROLES } from '../lib/tenant';
import { z } from "zod";
import { ROLES, DEAL_STATUS, type DealStatus } from "@workspace/permissions";
import { parseDealStatus } from "../lib/status-validators";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";

const router = Router();

const CreateDealBody = z.object({
  clientId: z.string().optional(),
  stageId: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  value: z.number().optional(),
  leadName: z.string().optional(),
  leadEmail: z.string().optional(),
  leadWhatsapp: z.string().optional(),
  tripId: z.string().optional(),
  reservationId: z.string().optional(),
  expectedCloseDate: z.string().optional(),
  status: z.string().optional(),
  travelReason: z.string().optional(),
});

const UpdateDealBody = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  value: z.number().optional(),
  status: z.string().optional(),
  expectedCloseDate: z.string().optional().nullable(),
  stageId: z.string().optional(),
  lostReason: z.string().optional().nullable(),
  travelReason: z.string().optional().nullable(),
  followUpNote: z.string().optional().nullable(),
  reservationId: z.string().optional().nullable(),
  tripId: z.string().optional().nullable(),
});

const MoveDealBody = z.object({ stageId: z.string() });

const DEFAULT_STAGES = [
  { name: "Lead", order: 1, color: "#6366F1", isFinal: false, isDefaultWeb: false },
  { name: "Vitrine", order: 2, color: "#3B82F6", isFinal: false, isDefaultWeb: true },
  { name: "Reserva Criada", order: 3, color: "#0EA5E9", isFinal: false, isDefaultWeb: false },
  { name: "Pagamento Confirmado", order: 4, color: "#10B981", isFinal: false, isDefaultWeb: false },
  { name: "Em Viagem", order: 5, color: "#06B6D4", isFinal: false, isDefaultWeb: false },
  { name: "Pós Viagem", order: 6, color: "#6B7280", isFinal: true, isDefaultWeb: false },
  { name: "Perdido", order: 7, color: "#EF4444", isFinal: false, isDefaultWeb: false },
];

const STAGE_RENAMES: { oldName: string; newName: string }[] = [
  { oldName: "Interessado", newName: "Reserva Criada" },
  { oldName: "Cliente", newName: "Pagamento Confirmado" },
  { oldName: "Pós-venda", newName: "Pós Viagem" },
];

async function applyStageUpgrades(tenantId: string, pipelineId: string): Promise<void> {
  const stages = await db.select()
    .from(pipelineStagesTable)
    .where(eq(pipelineStagesTable.pipelineId, pipelineId));

  for (const r of STAGE_RENAMES) {
    await db.update(pipelineStagesTable)
      .set({ name: r.newName })
      .where(and(
        eq(pipelineStagesTable.pipelineId, pipelineId),
        eq(pipelineStagesTable.name, r.oldName),
      ));
  }

  const hasPerdido = stages.some(s => s.name.toLowerCase() === "perdido");
  if (!hasPerdido) {
    await db.insert(pipelineStagesTable).values({
      id: generateId(),
      tenantId,
      pipelineId,
      name: "Perdido",
      order: 7,
      color: "#EF4444",
      isFinal: false,
      isDefaultWeb: false,
    }).onConflictDoNothing();
  }
}

async function ensureDefaultPipeline(tenantId: string): Promise<string> {
  const existingPipelines = await db.select()
    .from(pipelinesTable)
    .where(eq(pipelinesTable.tenantId, tenantId))
    .orderBy(asc(pipelinesTable.createdAt));

  if (existingPipelines.length > 0) {
    const defaultPipelines = existingPipelines.filter(p => p.isDefault);

    // Zero-default guard: pipelines exist but none is marked default.
    // Pick the oldest and mark it as the default.
    if (defaultPipelines.length === 0) {
      const canonical = existingPipelines[0]!;
      await db.update(pipelinesTable)
        .set({ isDefault: true })
        .where(eq(pipelinesTable.id, canonical.id));
      await applyStageUpgrades(tenantId, canonical.id);
      return canonical.id;
    }

    // Happy path: exactly one default pipeline — apply upgrades and return.
    if (defaultPipelines.length === 1) {
      const canonical = defaultPipelines[0]!;
      await applyStageUpgrades(tenantId, canonical.id);
      return canonical.id;
    }

    // Duplicate-default self-healing: more than one pipeline has is_default=true.
    // Pick the oldest as canonical, remap deals from each extra pipeline's stages
    // to the matching canonical stage (by name, fallback to canonical's first stage),
    // then delete the extras (pipeline_stages cascade-delete automatically).
    const canonical = defaultPipelines[0]!; // already sorted by createdAt asc
    const canonicalId = canonical.id;

    await db.transaction(async (tx) => {
      const canonicalStages = await tx.select()
        .from(pipelineStagesTable)
        .where(eq(pipelineStagesTable.pipelineId, canonicalId))
        .orderBy(asc(pipelineStagesTable.order));

      const fallbackStageId = canonicalStages[0]?.id;

      for (const extra of defaultPipelines.slice(1)) {
        const extraStages = await tx.select()
          .from(pipelineStagesTable)
          .where(eq(pipelineStagesTable.pipelineId, extra.id));

        for (const extraStage of extraStages) {
          const target = canonicalStages.find(s => s.name === extraStage.name);
          const targetId = target?.id ?? fallbackStageId;
          if (targetId) {
            await tx.update(dealsTable)
              .set({ stageId: targetId })
              .where(eq(dealsTable.stageId, extraStage.id));
          }
        }

        // Delete extra pipeline — pipeline_stages cascade-delete automatically.
        await tx.delete(pipelinesTable)
          .where(eq(pipelinesTable.id, extra.id));
      }
    });

    await applyStageUpgrades(tenantId, canonicalId);
    return canonicalId;
  }

  // No pipeline exists for this tenant — create the default one.
  // ON CONFLICT DO NOTHING (via the partial unique index on is_default=true)
  // absorbs concurrent races where two requests both see zero pipelines.
  const pipelineId = generateId();
  await db.insert(pipelinesTable).values({
    id: pipelineId,
    tenantId,
    name: "Pipeline Principal",
    isDefault: true,
    isActive: true,
  }).onConflictDoNothing();

  // Re-fetch to get the winner's id (ours or a concurrent request's).
  const [winner] = await db.select()
    .from(pipelinesTable)
    .where(eq(pipelinesTable.tenantId, tenantId))
    .orderBy(asc(pipelinesTable.createdAt))
    .limit(1);

  const actualPipelineId = winner?.id ?? pipelineId;

  // Create default stages — ON CONFLICT DO NOTHING on (pipeline_id, name)
  // unique index absorbs concurrent stage inserts from two racing requests.
  for (const stage of DEFAULT_STAGES) {
    await db.insert(pipelineStagesTable).values({
      id: generateId(),
      tenantId,
      pipelineId: actualPipelineId,
      name: stage.name,
      order: stage.order,
      color: stage.color,
      isFinal: stage.isFinal,
      isDefaultWeb: stage.isDefaultWeb,
    }).onConflictDoNothing();
  }

  return actualPipelineId;
}

function formatStage(s: typeof pipelineStagesTable.$inferSelect) {
  return {
    id: s.id, name: s.name, order: s.order, color: s.color,
    isFinal: s.isFinal, isDefaultWeb: s.isDefaultWeb,
    tenantId: s.tenantId, pipelineId: s.pipelineId,
    createdAt: s.createdAt.toISOString(),
  };
}

function formatDeal(d: typeof dealsTable.$inferSelect, seats: string[] = [], reservationNumber: string | null = null) {
  return {
    id: d.id, tenantId: d.tenantId, clientId: d.clientId, stageId: d.stageId,
    title: d.title, description: d.description, value: Number(d.value),
    status: d.status, ownerId: d.ownerId,
    leadName: d.leadName, leadEmail: d.leadEmail, leadWhatsapp: d.leadWhatsapp,
    tripId: d.tripId, lostReason: d.lostReason, travelReason: d.travelReason ?? null,
    followUpNote: d.followUpNote ?? null,
    reservationId: d.reservationId ?? null,
    reservationNumber,
    source: d.source ?? "manual",
    autoCreated: d.autoCreated ?? false,
    seats,
    expectedCloseDate: d.expectedCloseDate?.toISOString() ?? null,
    closedAt: d.closedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  };
}

interface ReservationInfo { seats: string[]; reservationNumber: string | null }

async function getReservationInfoForDeals(deals: typeof dealsTable.$inferSelect[], tenantId: string): Promise<Map<string, ReservationInfo>> {
  const resIds = deals.map(d => d.reservationId).filter(Boolean) as string[];
  const infoMap = new Map<string, ReservationInfo>();
  if (resIds.length === 0) return infoMap;
  const rows = await db.select({ id: reservationsTable.id, seats: reservationsTable.seats, reservationNumber: reservationsTable.reservationNumber })
    .from(reservationsTable)
    .where(and(inArray(reservationsTable.id, resIds), eq(reservationsTable.tenantId, tenantId)));
  for (const r of rows) infoMap.set(r.id, { seats: r.seats ?? [], reservationNumber: r.reservationNumber ?? null });
  return infoMap;
}

async function requireDealAccess(me: { id: string; tenantId: string; role: string }, dealId: string): Promise<typeof dealsTable.$inferSelect> {
  if (me.role === ROLES.CLIENT) {
    throw new ForbiddenError("Access denied", "FORBIDDEN_ROLE");
  }
  const dealConditions: ReturnType<typeof eq>[] = [eq(dealsTable.id, dealId), eq(dealsTable.tenantId, me.tenantId)];
  if (me.role === ROLES.SALES) dealConditions.push(eq(dealsTable.ownerId, me.id));
  const [deal] = await db.select().from(dealsTable).where(and(...dealConditions)).limit(1);
  if (!deal) { throw new NotFoundError("Not found", "NOT_FOUND"); }
  return deal;
}

router.get("/pipeline/stages", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await ensureDefaultPipeline(me.tenantId);
    const { pipelineId } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [eq(pipelineStagesTable.tenantId, me.tenantId)];
    if (pipelineId) conditions.push(eq(pipelineStagesTable.pipelineId, pipelineId));
    const stages = await db.select().from(pipelineStagesTable)
      .where(and(...conditions))
      .orderBy(asc(pipelineStagesTable.order));
    res.json(stages.map(formatStage));
  } catch (err) {
    next(err);
  }
});

router.get("/deals", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role === ROLES.CLIENT) {
      next(new ForbiddenError("Access denied", "FORBIDDEN_ROLE"));
      return;
    }
    const ListDealsQuery = z.object({
      stageId: z.string().optional(),
      clientId: z.string().optional(),
      ownerId: z.string().optional(),
      status: z.enum(["open", "won", "lost"]).optional(),
    });
    const queryResult = ListDealsQuery.safeParse(req.query);
    if (!queryResult.success) {
      next(new ValidationError(queryResult.error.errors[0]?.message ?? "Invalid query params", "VALIDATION_ERROR"));
      return;
    }
    const { stageId, clientId, ownerId, status } = queryResult.data;
    const conditions: ReturnType<typeof eq>[] = [eq(dealsTable.tenantId, me.tenantId)];
    if (stageId) conditions.push(eq(dealsTable.stageId, stageId));
    if (clientId) conditions.push(eq(dealsTable.clientId, clientId));
    if (ownerId) conditions.push(eq(dealsTable.ownerId, ownerId));
    if (status) conditions.push(eq(dealsTable.status, parseDealStatus(status)));
    if (me.role === ROLES.SALES) conditions.push(eq(dealsTable.ownerId, me.id));
    const deals = await db.select().from(dealsTable)
      .where(and(...conditions)).orderBy(desc(dealsTable.createdAt));

    const uniqueClientIds = [...new Set(deals.map(d => d.clientId).filter(Boolean) as string[])];
    const clientRows = uniqueClientIds.length > 0
      ? await db.select({
          id: clientsTable.id,
          name: clientsTable.name,
          email: clientsTable.email,
          whatsapp: clientsTable.whatsapp,
          phone: clientsTable.phone,
          cpf: clientsTable.cpf,
          addressCity: clientsTable.addressCity,
          addressState: clientsTable.addressState,
          classification: clientsTable.classification,
          outstandingBalance: clientsTable.outstandingBalance,
          customerCode: clientsTable.customerCode,
        }).from(clientsTable).where(inArray(clientsTable.id, uniqueClientIds))
      : [];
    const clientMap = new Map(clientRows.map(c => [c.id, c]));

    const resInfoMap = await getReservationInfoForDeals(deals, me.tenantId);
    res.json(deals.map(d => {
      const info = d.reservationId ? resInfoMap.get(d.reservationId) : undefined;
      const client = d.clientId ? clientMap.get(d.clientId) : undefined;
      return {
        ...formatDeal(d, info?.seats ?? [], info?.reservationNumber ?? null),
        clientName: client?.name ?? null,
        clientEmail: client?.email ?? null,
        clientWhatsapp: client?.whatsapp ?? null,
        clientPhone: client?.phone ?? null,
        clientCpf: client?.cpf ?? null,
        clientCity: client?.addressCity ?? null,
        clientState: client?.addressState ?? null,
        clientClassification: client?.classification ?? null,
        clientOutstandingBalance: client ? Number(client.outstandingBalance ?? 0) : null,
        customerCode: client?.customerCode ?? null,
      };
    }));
  } catch (err) {
    next(err);
  }
});

router.post("/deals", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = CreateDealBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    if (parsed.data.clientId) {
      const [client] = await db.select().from(clientsTable)
        .where(and(eq(clientsTable.id, parsed.data.clientId), eq(clientsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!client) { next(new ValidationError("Client not found or not in tenant", "CLIENT_NOT_FOUND")); return; }
    }

    // Resolve stageId: explicit > default-pipeline isDefaultWeb > default-pipeline order=1 > any stage.
    let resolvedStageId = parsed.data.stageId;
    if (!resolvedStageId) {
      const [defaultPipeline] = await db.select({ id: pipelinesTable.id })
        .from(pipelinesTable)
        .where(and(eq(pipelinesTable.tenantId, me.tenantId), eq(pipelinesTable.isDefault, true)))
        .limit(1);
      const pipelineId = defaultPipeline?.id;
      if (pipelineId) {
        const stagesInDefault = await db.select({ id: pipelineStagesTable.id, isDefaultWeb: pipelineStagesTable.isDefaultWeb })
          .from(pipelineStagesTable)
          .where(and(eq(pipelineStagesTable.pipelineId, pipelineId), eq(pipelineStagesTable.tenantId, me.tenantId)))
          .orderBy(asc(pipelineStagesTable.order));
        const chosen = stagesInDefault.find((s) => s.isDefaultWeb) ?? stagesInDefault[0];
        resolvedStageId = chosen?.id;
      }
      if (!resolvedStageId) {
        // Fallback: first stage of any pipeline ordered by creation date then stage order.
        const [anyStage] = await db.select({ id: pipelineStagesTable.id })
          .from(pipelineStagesTable)
          .innerJoin(pipelinesTable, eq(pipelineStagesTable.pipelineId, pipelinesTable.id))
          .where(eq(pipelineStagesTable.tenantId, me.tenantId))
          .orderBy(asc(pipelinesTable.createdAt), asc(pipelineStagesTable.order))
          .limit(1);
        resolvedStageId = anyStage?.id;
      }
      if (!resolvedStageId) {
        next(new ValidationError("Nenhum estágio encontrado. Configure um pipeline para esta agência.", "STAGE_NOT_FOUND"));
        return;
      }
    } else {
      const [stage] = await db.select().from(pipelineStagesTable)
        .where(and(eq(pipelineStagesTable.id, resolvedStageId), eq(pipelineStagesTable.tenantId, me.tenantId)))
        .limit(1);
      if (!stage) { next(new ValidationError("Stage not found or not in tenant", "STAGE_NOT_FOUND")); return; }
    }

    const id = generateId();
    await db.insert(dealsTable).values({
      id,
      tenantId: me.tenantId,
      clientId: parsed.data.clientId ?? null,
      stageId: resolvedStageId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      value: String(parsed.data.value ?? 0),
      ownerId: me.id,
      status: parseDealStatus(parsed.data.status ?? DEAL_STATUS.OPEN),
      leadName: parsed.data.leadName ?? null,
      leadEmail: parsed.data.leadEmail ?? null,
      leadWhatsapp: parsed.data.leadWhatsapp ?? null,
      tripId: parsed.data.tripId ?? null,
      reservationId: parsed.data.reservationId ?? null,
      expectedCloseDate: parsed.data.expectedCloseDate ? new Date(parsed.data.expectedCloseDate) : null,
      travelReason: parsed.data.travelReason ?? null,
    });

    const [deal] = await db.select().from(dealsTable)
      .where(and(eq(dealsTable.id, id), eq(dealsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!deal) { next(new Error("Failed to create deal")); return; }
    res.status(201).json(formatDeal(deal));
  } catch (err) {
    next(err);
  }
});

router.get("/deals/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const deal = await requireDealAccess(me, req.params.id);
    res.json(formatDeal(deal));
  } catch (err) {
    next(err);
  }
});

router.patch("/deals/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await requireDealAccess(me, req.params.id);

    const parsed = UpdateDealBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const updates: Partial<typeof dealsTable.$inferInsert> = {};
    if (parsed.data.title != null) updates.title = parsed.data.title;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description ?? null;
    if (parsed.data.value != null) updates.value = String(parsed.data.value);
    if (parsed.data.status != null) updates.status = parseDealStatus(parsed.data.status);
    if (parsed.data.lostReason !== undefined) updates.lostReason = parsed.data.lostReason ?? null;
    if (parsed.data.travelReason !== undefined) updates.travelReason = parsed.data.travelReason ?? null;
    if (parsed.data.followUpNote !== undefined) updates.followUpNote = parsed.data.followUpNote ?? null;
    if (parsed.data.expectedCloseDate !== undefined) {
      updates.expectedCloseDate = parsed.data.expectedCloseDate ? new Date(parsed.data.expectedCloseDate) : null;
    }
    if (parsed.data.stageId != null) {
      const [stage] = await db.select().from(pipelineStagesTable)
        .where(and(eq(pipelineStagesTable.id, parsed.data.stageId), eq(pipelineStagesTable.tenantId, me.tenantId)))
        .limit(1);
      if (!stage) { next(new ValidationError("Stage not found or not in tenant", "STAGE_NOT_FOUND")); return; }
      updates.stageId = parsed.data.stageId;
    }
    if (parsed.data.reservationId !== undefined) {
      updates.reservationId = parsed.data.reservationId ?? null;
    }
    if (parsed.data.tripId !== undefined) {
      updates.tripId = parsed.data.tripId ?? null;
    }

    await db.update(dealsTable).set(updates)
      .where(and(eq(dealsTable.id, req.params.id), eq(dealsTable.tenantId, me.tenantId)));
    const [deal] = await db.select().from(dealsTable)
      .where(and(eq(dealsTable.id, req.params.id), eq(dealsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!deal) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(formatDeal(deal));
  } catch (err) {
    next(err);
  }
});

router.patch("/deals/:id/move", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await requireDealAccess(me, req.params.id);

    const parsed = MoveDealBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const [stage] = await db.select().from(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.id, parsed.data.stageId), eq(pipelineStagesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!stage) { next(new ValidationError("Stage not found or not in tenant", "STAGE_NOT_FOUND")); return; }
    await db.update(dealsTable).set({ stageId: parsed.data.stageId })
      .where(and(eq(dealsTable.id, req.params.id), eq(dealsTable.tenantId, me.tenantId)));
    const [deal] = await db.select().from(dealsTable)
      .where(and(eq(dealsTable.id, req.params.id), eq(dealsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!deal) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(formatDeal(deal));
  } catch (err) {
    next(err);
  }
});

router.delete("/deals/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await requireDealAccess(me, req.params.id);
    await db.delete(dealsTable)
      .where(and(eq(dealsTable.id, req.params.id), eq(dealsTable.tenantId, me.tenantId)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/pipelines", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await ensureDefaultPipeline(me.tenantId);
    const pipelines = await db.select().from(pipelinesTable)
      .where(eq(pipelinesTable.tenantId, me.tenantId));

    // Determine which pipelines have at least one deal (active or historical)
    const stagesWithDeals = await db.select({ pipelineId: pipelineStagesTable.pipelineId })
      .from(pipelineStagesTable)
      .innerJoin(dealsTable, and(
        eq(dealsTable.stageId, pipelineStagesTable.id),
        eq(dealsTable.tenantId, me.tenantId),
      ))
      .where(eq(pipelineStagesTable.tenantId, me.tenantId));
    const pipelinesWithDeals = new Set(stagesWithDeals.map(r => r.pipelineId));

    res.json(pipelines.map((p) => ({
      id: p.id, name: p.name, description: p.description,
      isDefault: p.isDefault, isActive: p.isActive, tenantId: p.tenantId,
      hasDeals: pipelinesWithDeals.has(p.id),
      createdAt: p.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

router.post("/pipelines", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }
    const parsed = z.object({ name: z.string().min(1), description: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(pipelinesTable).values({ id, tenantId: me.tenantId, name: parsed.data.name, description: parsed.data.description });
    const [pipeline] = await db.select().from(pipelinesTable).where(eq(pipelinesTable.id, id));
    res.status(201).json(pipeline);
  } catch (err) {
    next(err);
  }
});

router.patch("/pipelines/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }
    const parsed = z.object({
      name: z.string().min(1).optional(),
      isActive: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    // Validate target pipeline exists first before any mutations
    const [targetPipeline] = await db.select().from(pipelinesTable)
      .where(and(eq(pipelinesTable.id, req.params.id), eq(pipelinesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!targetPipeline) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }

    // When setting a pipeline as default, unset all others first (target already validated)
    if (parsed.data.isDefault === true) {
      await db.update(pipelinesTable)
        .set({ isDefault: false })
        .where(eq(pipelinesTable.tenantId, me.tenantId));
    }

    await db.update(pipelinesTable).set(parsed.data).where(and(eq(pipelinesTable.id, req.params.id), eq(pipelinesTable.tenantId, me.tenantId)));
    const [pipeline] = await db.select().from(pipelinesTable).where(and(eq(pipelinesTable.id, req.params.id), eq(pipelinesTable.tenantId, me.tenantId)));
    if (!pipeline) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(pipeline);
  } catch (err) {
    next(err);
  }
});

// ─── PIPELINE STAGE CRUD ──────────────────────────────────────────────────────

const CreateStageBody = z.object({
  name: z.string().min(1),
  color: z.string().optional().default("#6366F1"),
  isFinal: z.boolean().optional().default(false),
  isDefaultWeb: z.boolean().optional().default(false),
});

const UpdateStageBody = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  order: z.number().int().optional(),
  isFinal: z.boolean().optional(),
  isDefaultWeb: z.boolean().optional(),
});

router.post("/pipeline/stages", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const { pipelineId } = req.query as Record<string, string>;
    if (!pipelineId) { next(new ValidationError("pipelineId is required", "VALIDATION_ERROR")); return; }

    const [pipeline] = await db.select().from(pipelinesTable)
      .where(and(eq(pipelinesTable.id, pipelineId), eq(pipelinesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!pipeline) { next(new NotFoundError("Pipeline not found", "NOT_FOUND")); return; }

    const parsed = CreateStageBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    // Assign next order value
    const existing = await db.select({ order: pipelineStagesTable.order })
      .from(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.pipelineId, pipelineId), eq(pipelineStagesTable.tenantId, me.tenantId)));
    const maxOrder = existing.length > 0 ? Math.max(...existing.map(s => s.order)) : 0;

    const id = generateId();
    await db.insert(pipelineStagesTable).values({
      id,
      tenantId: me.tenantId,
      pipelineId,
      name: parsed.data.name,
      color: parsed.data.color,
      order: maxOrder + 1,
      isFinal: parsed.data.isFinal,
      isDefaultWeb: parsed.data.isDefaultWeb,
    });
    const [stage] = await db.select().from(pipelineStagesTable).where(eq(pipelineStagesTable.id, id));
    res.status(201).json(formatStage(stage));
  } catch (err) {
    next(err);
  }
});

router.patch("/pipeline/stages/:stageId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [stage] = await db.select().from(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.id, req.params.stageId), eq(pipelineStagesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!stage) { next(new NotFoundError("Stage not found", "NOT_FOUND")); return; }

    const parsed = UpdateStageBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    await db.update(pipelineStagesTable)
      .set(parsed.data)
      .where(and(eq(pipelineStagesTable.id, req.params.stageId), eq(pipelineStagesTable.tenantId, me.tenantId)));

    const [updated] = await db.select().from(pipelineStagesTable).where(eq(pipelineStagesTable.id, req.params.stageId));
    res.json(formatStage(updated));
  } catch (err) {
    next(err);
  }
});

router.delete("/pipeline/stages/:stageId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [stage] = await db.select().from(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.id, req.params.stageId), eq(pipelineStagesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!stage) { next(new NotFoundError("Stage not found", "NOT_FOUND")); return; }

    // Protect: block if ANY deal references this stage (open or historical)
    // The FK deals.stageId has no cascade, so DB would reject anyway — give a clear message instead
    const [deal] = await db.select({ id: dealsTable.id }).from(dealsTable)
      .where(and(
        eq(dealsTable.stageId, req.params.stageId),
        eq(dealsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (deal) {
      next(new ValidationError("Não é possível excluir uma etapa que possui negócios (ativos ou histórico). Mova ou exclua os negócios primeiro.", "STAGE_HAS_DEALS"));
      return;
    }

    await db.delete(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.id, req.params.stageId), eq(pipelineStagesTable.tenantId, me.tenantId)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/pipelines/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [pipeline] = await db.select().from(pipelinesTable)
      .where(and(eq(pipelinesTable.id, req.params.id), eq(pipelinesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!pipeline) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }

    // Protect: don't delete the only remaining pipeline
    const allPipelines = await db.select({ id: pipelinesTable.id, isDefault: pipelinesTable.isDefault })
      .from(pipelinesTable).where(eq(pipelinesTable.tenantId, me.tenantId));
    if (allPipelines.length <= 1) {
      next(new ValidationError("Não é possível excluir o único pipeline da agência", "LAST_PIPELINE"));
      return;
    }

    // Protect: don't delete the default pipeline — user must promote another first
    if (pipeline.isDefault) {
      next(new ValidationError("Não é possível excluir o pipeline padrão. Defina outro pipeline como padrão antes de excluir este.", "DELETE_DEFAULT_PIPELINE"));
      return;
    }

    // Protect: block if ANY deal references a stage of this pipeline (open or historical)
    // FK deals.stageId has no cascade, so DB would reject anyway — give a clear message instead
    const stagesOfPipeline = await db.select({ id: pipelineStagesTable.id })
      .from(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.pipelineId, req.params.id), eq(pipelineStagesTable.tenantId, me.tenantId)));

    if (stagesOfPipeline.length > 0) {
      const [anyDeal] = await db.select({ id: dealsTable.id }).from(dealsTable)
        .where(and(
          inArray(dealsTable.stageId, stagesOfPipeline.map(s => s.id)),
          eq(dealsTable.tenantId, me.tenantId),
        ))
        .limit(1);
      if (anyDeal) {
        next(new ValidationError("Não é possível excluir um pipeline que possui negócios (ativos ou histórico). Mova ou exclua os negócios primeiro.", "PIPELINE_HAS_DEALS"));
        return;
      }
    }

    await db.delete(pipelinesTable)
      .where(and(eq(pipelinesTable.id, req.params.id), eq(pipelinesTable.tenantId, me.tenantId)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── BULK MOVE DEALS ──────────────────────────────────────────────────────────

router.post("/pipeline/deals/bulk-move", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }

    const parsed = z.object({
      dealIds: z.array(z.string().min(1)).min(1).max(500),
      targetStageId: z.string().min(1),
    }).safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR"));
      return;
    }

    const { dealIds, targetStageId } = parsed.data;

    // Verify target stage belongs to this tenant
    const [targetStage] = await db
      .select({ id: pipelineStagesTable.id })
      .from(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.id, targetStageId), eq(pipelineStagesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!targetStage) {
      next(new NotFoundError("Target stage not found", "NOT_FOUND"));
      return;
    }

    // Move only deals that belong to this tenant (inArray + tenant guard)
    await db
      .update(dealsTable)
      .set({ stageId: targetStageId, updatedAt: new Date() })
      .where(and(inArray(dealsTable.id, dealIds), eq(dealsTable.tenantId, me.tenantId)));

    res.json({ success: true, count: dealIds.length });
  } catch (err) {
    next(err);
  }
});

// ─── PIPELINE ANALYTICS ───────────────────────────────────────────────────────

router.get("/pipeline/:pipelineId/analytics", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role === ROLES.CLIENT) { next(new AppError("Forbidden", 403, "FORBIDDEN")); return; }

    const [pipeline] = await db.select().from(pipelinesTable)
      .where(and(eq(pipelinesTable.id, req.params.pipelineId), eq(pipelinesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!pipeline) { next(new NotFoundError("Pipeline not found", "NOT_FOUND")); return; }

    const stages = await db.select().from(pipelineStagesTable)
      .where(and(
        eq(pipelineStagesTable.pipelineId, req.params.pipelineId),
        eq(pipelineStagesTable.tenantId, me.tenantId),
      ))
      .orderBy(asc(pipelineStagesTable.order));

    if (stages.length === 0) {
      res.json({ stages: [], lostReasons: [], totalPipeline: 0, totalLost: 0 });
      return;
    }

    const stageIds = stages.map(s => s.id);
    const allDeals = await db.select({
      id: dealsTable.id,
      stageId: dealsTable.stageId,
      status: dealsTable.status,
      value: dealsTable.value,
      lostReason: dealsTable.lostReason,
      createdAt: dealsTable.createdAt,
      updatedAt: dealsTable.updatedAt,
    }).from(dealsTable)
      .where(and(
        eq(dealsTable.tenantId, me.tenantId),
        inArray(dealsTable.stageId, stageIds),
      ));

    const openDeals = allDeals.filter(d => d.status === "open");
    const lostDeals = allDeals.filter(d => d.status === "lost");

    // Non-Perdido stages sorted by order for funnel computation
    const funnelStages = stages.filter(s => s.name.toLowerCase() !== "perdido");

    // Count of deals per non-Perdido stage (open only)
    const stageCountMap = new Map<string, number>();
    for (const stage of funnelStages) {
      stageCountMap.set(stage.id, openDeals.filter(d => d.stageId === stage.id).length);
    }

    // First stage count is the funnel entry point (baseline for conversion)
    const firstStageCount = funnelStages.length > 0 ? (stageCountMap.get(funnelStages[0].id) ?? 0) : 0;

    const stageStats = funnelStages.map((stage, idx) => {
      const stageDeals = openDeals.filter(d => d.stageId === stage.id);
      const stageValue = stageDeals.reduce((acc, d) => acc + Number(d.value), 0);
      // Avg days uses updatedAt as a proxy for when the deal last moved to this stage
      const avgDays = stageDeals.length > 0
        ? Math.round(
            stageDeals.reduce((acc, d) => acc + (Date.now() - d.updatedAt.getTime()) / 86400000, 0)
            / stageDeals.length
          )
        : 0;
      // Stage-to-stage: for stage 0 = 100%, for stage i = count[i] / count[i-1] (prev stage)
      const prevCount = idx === 0 ? stageDeals.length : (stageCountMap.get(funnelStages[idx - 1].id) ?? 0);
      const conversionRate = idx === 0
        ? 100
        : (prevCount > 0 ? Math.round((stageDeals.length / prevCount) * 100) : 0);
      // Also provide cumulative rate (from first stage)
      const cumulativeRate = firstStageCount > 0
        ? Math.round((stageDeals.length / firstStageCount) * 100)
        : (idx === 0 ? 100 : 0);
      return {
        stageId: stage.id,
        stageName: stage.name,
        color: stage.color,
        count: stageDeals.length,
        value: stageValue,
        avgDays,
        conversionRate,
        cumulativeRate,
      };
    });

    // Top-5 lost reasons
    const reasonMap = new Map<string, number>();
    for (const d of lostDeals) {
      const reason = d.lostReason ?? "Não informado";
      reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
    }
    const lostReasons = Array.from(reasonMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    const totalPipeline = openDeals.reduce((acc, d) => acc + Number(d.value), 0);

    res.json({
      stages: stageStats,
      lostReasons,
      totalPipeline,
      totalLost: lostDeals.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

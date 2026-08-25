import { Router, type NextFunction } from "express";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { db } from "@workspace/db";
import { clientsTable, notesTable, reservationsTable, tripsTable, npsResponsesTable, referralsTable, usersTable, paymentsTable, dealsTable, storeOrdersTable, storeReviewsTable, clientScoresTable, loyaltyMembersTable, tenantsTable, referralAttemptLogsTable, calendarEventsTable, campaignSendsTable, clientNpsResponsesTable } from "@workspace/db";
import { eq, and, ilike, or, sql, desc, asc, inArray, count } from "drizzle-orm";
import { generateId, generateReferralCode } from "../lib/id";
import { generateAndAssignReferralCode } from "../lib/referral-code";
import { dispatchReferralWelcomeEmail, dispatchReferralCodeSuspendedEmail } from "../queues/email-helpers";
import { requireAuth, getTenantUser } from "../lib/tenant";
import { validateCPF, cleanCPF } from "../lib/cpf";
import { localToday } from "@workspace/shared";
import { checkPlanLimit } from "../lib/planLimits";
import {
  CreateClientBody,
  UpdateClientBody,
  UpdateClientPipelineStageBody,
  CreateClientNoteBody,
} from "@workspace/api-zod";
import { CalendarSyncService } from "../lib/google-calendar/sync-service";
import { scheduleCalendarSyncBirthday } from "../lib/google-calendar/schedule-sync";
import { logger } from "../lib/logger";
import { ADMIN_ROLES, MANAGEMENT_ROLES } from '../lib/tenant';
import { ROLES } from "@workspace/permissions";
import { clerkClient } from "@clerk/express";
import { calculateScoresForClient } from "../lib/client-scores";
import { getRedisConnection } from "../lib/redis";
import { getAIClientForTenant } from "../lib/ai-client";
import { z } from "zod";
import { clientSellerScopeCondition } from "../lib/seller-scope";

const ListClientsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  sortBy: z.enum(["createdAt", "name", "totalSpent", "lastActivity", "purchaseScore", "churnScore"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().max(200).optional(),
  cpf: z.string().max(20).optional(),
  status: z.string().optional(),
  pipelineStage: z.string().optional(),
  classification: z.string().optional(),
  city: z.string().max(100).optional(),
  tripId: z.string().optional(),
  sellerId: z.string().optional(),
  origin: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minPurchaseScore: z.coerce.number().min(0).max(100).optional(),
  maxPurchaseScore: z.coerce.number().min(0).max(100).optional(),
  minChurnScore: z.coerce.number().min(0).max(100).optional(),
  maxChurnScore: z.coerce.number().min(0).max(100).optional(),
});

const router = Router();

function parseSafeBirthDate(str: string): Date | null {
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  if (year < 1900 || year > 2100) return null;
  return d;
}

type ScoreRow = {
  clientId: string;
  purchaseScore: number;
  recompraScore: number;
  churnScore: number;
  nboTripId: string | null;
  nboReasoning: string | null;
  calculatedAt: Date;
  nboTripName: string | null;
  nboTripDestination: string | null;
};

function formatClient(c: typeof clientsTable.$inferSelect, extra?: { isNew?: boolean; message?: string; scores?: ScoreRow | null }) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    whatsapp: c.whatsapp,
    phone: c.phone,
    cpf: c.cpf,
    rg: c.rg,
    birthDate: c.birthDate?.toISOString() ?? null,
    gender: c.gender,
    photoUrl: c.photoUrl,
    instagram: c.instagram,
    addressCity: c.addressCity,
    addressState: c.addressState,
    classification: c.classification,
    status: c.status,
    tags: c.tags ?? [],
    pipelineStage: c.pipelineStage,
    totalSpent: Number(c.totalSpent),
    outstandingBalance: Number(c.outstandingBalance),
    npsScore: c.npsScore,
    observations: c.observations,
    dreamDestinations: c.dreamDestinations ?? [],
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    lastContactAt: c.lastContactAt?.toISOString() ?? null,
    origin: c.origin ?? null,
    maritalStatus: c.maritalStatus ?? null,
    professionalArea: c.professionalArea ?? null,
    favoriteDrink: c.favoriteDrink ?? null,
    companyFeedback: c.companyFeedback ?? null,
    musicalPreferences: c.musicalPreferences ?? null,
    foodPreferences: c.foodPreferences ?? null,
    internalRating: c.internalRating ?? null,
    companyNps: c.companyNps ?? null,
    isNew: extra?.isNew ?? null,
    message: extra?.message ?? null,
    purchaseScore: extra?.scores?.purchaseScore ?? null,
    recompraScore: extra?.scores?.recompraScore ?? null,
    churnScore: extra?.scores?.churnScore ?? null,
    nboTripId: extra?.scores?.nboTripId ?? null,
    nboTripName: extra?.scores?.nboTripName ?? null,
    nboTripDestination: extra?.scores?.nboTripDestination ?? null,
    nboReasoning: extra?.scores?.nboReasoning ?? null,
    scoresCalculatedAt: extra?.scores?.calculatedAt?.toISOString() ?? null,
    travelInterests: c.travelInterests ?? [],
    travelPreference: c.travelPreference ?? null,
    preferredDestinationTypes: c.preferredDestinationTypes ?? [],
    likesPhotosVideos: c.likesPhotosVideos ?? null,
    ambassadorOptIn: c.ambassadorOptIn ?? null,
    customerCode: c.customerCode ?? null,
  };
}

router.get("/clients", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const queryResult = ListClientsQuery.safeParse(req.query);
    if (!queryResult.success) {
      next(new ValidationError(queryResult.error.errors[0]?.message ?? "Invalid query params", "VALIDATION_ERROR"));
      return;
    }
    const {
      search, cpf: cpfParam, status, pipelineStage, classification,
      city, tripId, sellerId, origin, dateFrom, dateTo, sortBy, sortOrder,
      page: pageNum, limit: limitNum,
      minPurchaseScore, maxPurchaseScore, minChurnScore, maxChurnScore,
    } = queryResult.data;
    const offset = (pageNum - 1) * limitNum;

    if (me.role === ROLES.CLIENT) {
      const [clientRecord] = await db.select().from(clientsTable)
        .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.userId, me.id)))
        .limit(1);
      if (!clientRecord) {
        res.json({ data: [], total: 0, page: pageNum, limit: limitNum });
        return;
      }
      res.json({
        data: [{ ...formatClient(clientRecord), lastTripName: null }],
        total: 1, page: pageNum, limit: limitNum,
      });
      return;
    }

    const conditions: ReturnType<typeof eq>[] = [eq(clientsTable.tenantId, me.tenantId)];

    if (me.role === ROLES.SALES) {
      conditions.push(clientSellerScopeCondition(me) as ReturnType<typeof eq>);
    }

    if (search) {
      const searchClean = cleanCPF(search);
      conditions.push(or(
        ilike(clientsTable.name, `%${search}%`),
        ilike(clientsTable.email, `%${search}%`),
        ilike(clientsTable.whatsapp, `%${search}%`),
        ilike(clientsTable.customerCode, `%${search}%`),
        searchClean.length >= 3 ? ilike(clientsTable.cpf, `%${searchClean}%`) : undefined,
      ) as ReturnType<typeof eq>);
    }
    if (cpfParam) {
      const cleanedCpfParam = cleanCPF(cpfParam);
      if (cleanedCpfParam.length === 11) {
        conditions.push(eq(clientsTable.cpf, cleanedCpfParam));
      }
    }
    if (status) conditions.push(eq(clientsTable.status, status));
    if (pipelineStage) conditions.push(eq(clientsTable.pipelineStage, pipelineStage));
    if (classification) conditions.push(eq(clientsTable.classification, classification));
    if (city) conditions.push(ilike(clientsTable.addressCity, `%${city}%`) as ReturnType<typeof eq>);
    if (origin) conditions.push(ilike(clientsTable.origin, `%${origin}%`) as ReturnType<typeof eq>);
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (dateFrom && !ISO_DATE.test(dateFrom)) { next(new ValidationError("dateFrom must be a valid ISO date (YYYY-MM-DD)", "VALIDATION_ERROR")); return; }
    if (dateTo && !ISO_DATE.test(dateTo)) { next(new ValidationError("dateTo must be a valid ISO date (YYYY-MM-DD)", "VALIDATION_ERROR")); return; }
    if (dateFrom) conditions.push(sql`${clientsTable.createdAt} >= ${dateFrom}::timestamptz` as ReturnType<typeof eq>);
    if (dateTo) conditions.push(sql`${clientsTable.createdAt} <= (${dateTo}::date + interval '1 day - 1 millisecond')` as ReturnType<typeof eq>);
    if (me.role !== ROLES.SALES && sellerId) {
      conditions.push(clientSellerScopeCondition({ id: sellerId, tenantId: me.tenantId }) as ReturnType<typeof eq>);
    }
    const scoreSubquery = (col: "purchase_score" | "churn_score") =>
      sql`(SELECT ${sql.raw(col)} FROM client_scores WHERE client_id = ${clientsTable.id} AND tenant_id = ${clientsTable.tenantId})`;
    if (minPurchaseScore != null) conditions.push(sql`${scoreSubquery("purchase_score")} >= ${minPurchaseScore}` as ReturnType<typeof eq>);
    if (maxPurchaseScore != null) conditions.push(sql`${scoreSubquery("purchase_score")} <= ${maxPurchaseScore}` as ReturnType<typeof eq>);
    if (minChurnScore != null) conditions.push(sql`${scoreSubquery("churn_score")} >= ${minChurnScore}` as ReturnType<typeof eq>);
    if (maxChurnScore != null) conditions.push(sql`${scoreSubquery("churn_score")} <= ${maxChurnScore}` as ReturnType<typeof eq>);
    if (tripId) {
      const clientIdsInTrip = await db.selectDistinct({ clientId: reservationsTable.clientId })
        .from(reservationsTable)
        .where(and(eq(reservationsTable.tripId, tripId), eq(reservationsTable.tenantId, me.tenantId)));
      const ids = clientIdsInTrip.map(r => r.clientId).filter((id): id is string => id !== null);
      conditions.push(ids.length > 0 ? inArray(clientsTable.id, ids) : sql`false` as ReturnType<typeof eq>);
    }

    const scoreColName = sortBy === "purchaseScore" ? "purchase_score"
      : sortBy === "churnScore" ? "churn_score" : null;
    const orderExpr = scoreColName
      ? (sortOrder === "asc"
        ? sql`(SELECT ${sql.raw(scoreColName!)} FROM client_scores WHERE client_id = ${clientsTable.id} AND tenant_id = ${clientsTable.tenantId}) ASC NULLS LAST`
        : sql`(SELECT ${sql.raw(scoreColName!)} FROM client_scores WHERE client_id = ${clientsTable.id} AND tenant_id = ${clientsTable.tenantId}) DESC NULLS LAST`)
      : (() => {
          const col = sortBy === "name" ? clientsTable.name
            : sortBy === "totalSpent" ? clientsTable.totalSpent
            : clientsTable.createdAt;
          return sortOrder === "asc" ? col : desc(col);
        })();

    const clients = await db.select().from(clientsTable)
      .where(and(...conditions))
      .orderBy(orderExpr)
      .limit(limitNum)
      .offset(offset);

    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(clientsTable).where(and(...conditions));

    const clientIds = clients.map(c => c.id);
    let lastTripMap: Record<string, string> = {};
    if (clientIds.length > 0) {
      const lastTrips = await db.select({
        clientId: reservationsTable.clientId,
        tripName: tripsTable.name,
        createdAt: reservationsTable.createdAt,
      })
        .from(reservationsTable)
        .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
        .where(and(eq(reservationsTable.tenantId, me.tenantId), inArray(reservationsTable.clientId, clientIds)))
        .orderBy(desc(reservationsTable.createdAt));
      for (const row of lastTrips) {
        if (row.clientId && !lastTripMap[row.clientId]) lastTripMap[row.clientId] = row.tripName;
      }
    }

    let scoreMap = new Map<string, ScoreRow>();
    if (clientIds.length > 0) {
      const scoreRows = await db.select({
        clientId: clientScoresTable.clientId,
        purchaseScore: clientScoresTable.purchaseScore,
        recompraScore: clientScoresTable.recompraScore,
        churnScore: clientScoresTable.churnScore,
        nboTripId: clientScoresTable.nboTripId,
        nboReasoning: clientScoresTable.nboReasoning,
        calculatedAt: clientScoresTable.calculatedAt,
        nboTripName: tripsTable.name,
        nboTripDestination: tripsTable.destination,
      })
        .from(clientScoresTable)
        .leftJoin(tripsTable, eq(clientScoresTable.nboTripId, tripsTable.id))
        .where(and(inArray(clientScoresTable.clientId, clientIds), eq(clientScoresTable.tenantId, me.tenantId)));
      scoreMap = new Map(scoreRows.map(s => [s.clientId, s]));
    }

    res.json({
      data: clients.map(c => ({ ...formatClient(c, { scores: scoreMap.get(c.id) ?? null }), lastTripName: lastTripMap[c.id] ?? null })),
      total: Number(countResult?.count ?? 0),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/clients", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.tenantId) {
      const allowed = await checkPlanLimit(me.tenantId, "clients", req, res);
      if (!allowed) return;
    }
    const parsed = CreateClientBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    // Duplicate name+WhatsApp check — unless the caller explicitly overrides
    if (!parsed.data.forceCreate) {
      const [nameWaDupe] = await db
        .select({ id: clientsTable.id, name: clientsTable.name, customerCode: clientsTable.customerCode, whatsapp: clientsTable.whatsapp })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, me.tenantId),
          sql`lower(trim(${clientsTable.name})) = lower(trim(${parsed.data.name}))`,
          eq(clientsTable.whatsapp, parsed.data.whatsapp),
          sql`${clientsTable.status} != 'merged'`,
        ))
        .limit(1);
      if (nameWaDupe) {
        res.status(409).json({
          conflict: "name_whatsapp",
          existingClient: {
            id: nameWaDupe.id,
            name: nameWaDupe.name,
            code: nameWaDupe.customerCode,
            whatsapp: nameWaDupe.whatsapp,
          },
        });
        return;
      }
    }

    let cleanedCpf: string | null = null;
    if (parsed.data.cpf != null && parsed.data.cpf.trim() !== "") {
      try {
        cleanedCpf = validateCPF(parsed.data.cpf);
      } catch (err) {
        next(new ValidationError(err instanceof Error ? err.message : "CPF inválido", "CPF_INVALID")); return;
      }
    }

    const sharedFields = {
      name: parsed.data.name,
      email: parsed.data.email,
      whatsapp: parsed.data.whatsapp,
      phone: parsed.data.phone ?? null,
      rg: parsed.data.rg ?? null,
      birthDate: parsed.data.birthDate ? parseSafeBirthDate(parsed.data.birthDate) : null,
      gender: parsed.data.gender ?? null,
      photoUrl: parsed.data.photoUrl ?? null,
      instagram: parsed.data.instagram ?? null,
      addressCity: parsed.data.addressCity ?? null,
      addressState: parsed.data.addressState ?? null,
      observations: parsed.data.observations ?? null,
      tags: parsed.data.tags ?? [],
      dreamDestinations: parsed.data.dreamDestinations ?? [],
      origin: parsed.data.origin ?? null,
      maritalStatus: parsed.data.maritalStatus ?? null,
      professionalArea: parsed.data.professionalArea ?? null,
      favoriteDrink: parsed.data.favoriteDrink ?? null,
      companyFeedback: parsed.data.companyFeedback ?? null,
      musicalPreferences: parsed.data.musicalPreferences ?? null,
      foodPreferences: parsed.data.foodPreferences ?? null,
      internalRating: parsed.data.internalRating ?? null,
      companyNps: parsed.data.companyNps ?? null,
      travelInterests: parsed.data.travelInterests ?? [],
      ambassadorOptIn: parsed.data.ambassadorOptIn ?? undefined,
    };

    const id = generateId();
    const [upserted] = await db.transaction(async (tx) => {
      let existing: { id: string } | undefined;
      if (cleanedCpf) {
        [existing] = await tx
          .select({ id: clientsTable.id })
          .from(clientsTable)
          .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.cpf, cleanedCpf)))
          .limit(1);
      }

      let customerCode: string | null = null;
      if (!existing) {
        const [tenantRow] = await tx
          .update(tenantsTable)
          .set({ lastClientSeq: sql`${tenantsTable.lastClientSeq} + 1` })
          .where(eq(tenantsTable.id, me.tenantId))
          .returning({ lastClientSeq: tenantsTable.lastClientSeq, reservationPrefix: tenantsTable.reservationPrefix, slug: tenantsTable.slug });
        const seq = tenantRow?.lastClientSeq ?? 1;
        const rawPrefix = tenantRow?.reservationPrefix?.trim() || tenantRow?.slug?.slice(0, 3) || "CLI";
        const prefix = rawPrefix.toUpperCase();
        // Use Brazil calendar YYYYMM so codes assigned at 21h-midnight get the correct BRT month
        const yyyymm = localToday().slice(0, 7).replace("-", "");
        customerCode = `${prefix}-${yyyymm}-${String(seq).padStart(5, "0")}`;
      }

      return await tx.insert(clientsTable)
        .values({
          id,
          tenantId: me.tenantId,
          cpf: cleanedCpf,
          ...sharedFields,
          createdById: me.id,
          customerCode,
        })
        .onConflictDoUpdate({
          target: [clientsTable.tenantId, clientsTable.cpf],
          targetWhere: sql`${clientsTable.cpf} IS NOT NULL`,
          set: { ...sharedFields, updatedAt: new Date() },
        })
        .returning();
    }).catch((err: unknown) => {
      const pgErr = err as { code?: string };
      if (pgErr?.code === "23505") {
        throw new AppError("Conflito ao gerar código do cliente — tente novamente", 409, "CUSTOMER_CODE_CONFLICT");
      }
      throw err;
    });

    if (!upserted) { next(new AppError("Failed to create client", 500, "CLIENT_CREATE_FAILED")); return; }

    const isNew = upserted.id === id;
    const message = isNew ? "Cliente cadastrado com sucesso." : "Cliente já cadastrado — dados atualizados.";
    const statusCode = isNew ? 201 : 200;
    res.status(statusCode).json(formatClient(upserted, { isNew, message }));

    if (upserted.birthDate) {
      scheduleCalendarSyncBirthday(upserted.id).catch((err) => logger.warn({ err }, "[clients] calendar birthday sync (create) failed"));
    }

    if (isNew) {
      const baseCode = generateReferralCode(upserted.name ?? "REF", me.tenantId);
      const namePart = baseCode.replace(/\d+$/, "");
      const year = Number(localToday().slice(0, 4)); // Brazil calendar year
      generateAndAssignReferralCode(upserted.id, me.tenantId, baseCode, namePart, year)
        .then((code) => {
          dispatchReferralWelcomeEmail({ clientId: upserted.id, referralCode: code, tenantId: me.tenantId }).catch((err) => logger.warn({ err }, "[clients] referral welcome email dispatch failed"));
        })
        .catch((err) => logger.warn({ err }, "[clients] referral code generation failed"));
    }
  } catch (err) {
    next(err);
  }
});

async function requireClientAccess(
  me: { id: string; tenantId: string; role: string },
  clientId: string,
): Promise<typeof clientsTable.$inferSelect> {
  const conditions: ReturnType<typeof eq>[] = [eq(clientsTable.id, clientId), eq(clientsTable.tenantId, me.tenantId)];
  if (me.role === ROLES.CLIENT) conditions.push(eq(clientsTable.userId, me.id));
  else if (me.role === ROLES.SALES) conditions.push(clientSellerScopeCondition(me) as ReturnType<typeof eq>);
  const [client] = await db.select().from(clientsTable).where(and(...conditions)).limit(1);
  if (!client) throw new NotFoundError("Client not found", "CLIENT_NOT_FOUND");
  return client;
}

router.get("/clients/duplicates", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const pairs: Array<{ reason: string; clients: ReturnType<typeof formatClient>[] }> = [];

    const cpfDupeGroups = await db
      .select({ cpf: clientsTable.cpf })
      .from(clientsTable)
      .where(and(
        eq(clientsTable.tenantId, me.tenantId),
        sql`${clientsTable.cpf} IS NOT NULL`,
        sql`${clientsTable.status} != 'merged'`
      ))
      .groupBy(clientsTable.cpf)
      .having(sql`count(*) > 1`);

    if (cpfDupeGroups.length > 0) {
      const dupeCpfs = cpfDupeGroups.map(r => r.cpf!);
      const dupeClients = await db.select().from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, me.tenantId),
          inArray(clientsTable.cpf, dupeCpfs),
          sql`${clientsTable.status} != 'merged'`
        ))
        .orderBy(clientsTable.cpf, clientsTable.createdAt);
      const byCpf = new Map<string, typeof clientsTable.$inferSelect[]>();
      for (const c of dupeClients) {
        const key = c.cpf!;
        if (!byCpf.has(key)) byCpf.set(key, []);
        byCpf.get(key)!.push(c);
      }
      for (const [, clients] of byCpf) {
        if (clients.length >= 2) pairs.push({ reason: "cpf", clients: clients.map(c => formatClient(c)) });
      }
    }

    const cpfDupeIds = new Set(pairs.flatMap(p => p.clients.map(c => c.id)));

    const nameWaGroups = await db
      .select({
        normName: sql<string>`lower(trim(${clientsTable.name}))`,
        whatsapp: clientsTable.whatsapp,
      })
      .from(clientsTable)
      .where(and(
        eq(clientsTable.tenantId, me.tenantId),
        sql`${clientsTable.status} != 'merged'`
      ))
      .groupBy(sql`lower(trim(${clientsTable.name}))`, clientsTable.whatsapp)
      .having(sql`count(*) > 1`);

    for (const group of nameWaGroups) {
      const dupeClients = await db.select().from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, me.tenantId),
          sql`lower(trim(${clientsTable.name})) = ${group.normName}`,
          eq(clientsTable.whatsapp, group.whatsapp),
          sql`${clientsTable.status} != 'merged'`
        ))
        .orderBy(clientsTable.createdAt);
      const nonCpfDupes = dupeClients.filter(c => !cpfDupeIds.has(c.id));
      if (nonCpfDupes.length >= 2) pairs.push({ reason: "name_whatsapp", clients: nonCpfDupes.map(c => formatClient(c)) });
    }

    res.json({ pairs, total: pairs.length });
  } catch (err) {
    next(err);
  }
});

router.get("/clients/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const client = await requireClientAccess(me, req.params.id);
    const [scoreRow] = await db.select({
      clientId: clientScoresTable.clientId,
      purchaseScore: clientScoresTable.purchaseScore,
      recompraScore: clientScoresTable.recompraScore,
      churnScore: clientScoresTable.churnScore,
      nboTripId: clientScoresTable.nboTripId,
      nboReasoning: clientScoresTable.nboReasoning,
      calculatedAt: clientScoresTable.calculatedAt,
      nboTripName: tripsTable.name,
      nboTripDestination: tripsTable.destination,
    })
      .from(clientScoresTable)
      .leftJoin(tripsTable, eq(clientScoresTable.nboTripId, tripsTable.id))
      .where(and(eq(clientScoresTable.clientId, client.id), eq(clientScoresTable.tenantId, me.tenantId)))
      .limit(1);
    res.json(formatClient(client, { scores: scoreRow ?? null }));
  } catch (err) {
    next(err);
  }
});

router.patch("/clients/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role === ROLES.CLIENT) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const existing = await requireClientAccess(me, req.params.id);

    delete (req.body as Record<string, unknown>).customerCode;
    const parsed = UpdateClientBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const updates: Partial<typeof clientsTable.$inferInsert> = {};
    if (parsed.data.name != null) updates.name = parsed.data.name;
    if (parsed.data.email != null) updates.email = parsed.data.email;
    if (parsed.data.whatsapp != null) updates.whatsapp = parsed.data.whatsapp;
    if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone ?? null;
    if (parsed.data.cpf != null) {
      try { updates.cpf = validateCPF(parsed.data.cpf); } catch { next(new ValidationError("CPF inválido", "VALIDATION_ERROR")); return; }
    }
    if (parsed.data.rg !== undefined) updates.rg = parsed.data.rg ?? null;
    if (parsed.data.birthDate !== undefined) updates.birthDate = parsed.data.birthDate ? parseSafeBirthDate(parsed.data.birthDate) : null;
    if (parsed.data.gender !== undefined) updates.gender = parsed.data.gender ?? null;
    if (parsed.data.instagram !== undefined) updates.instagram = parsed.data.instagram ?? null;
    if (parsed.data.status != null) updates.status = parsed.data.status;
    const isDeactivatingStatus = parsed.data.status != null && ["inactive", "blocked", "cancelled"].includes(parsed.data.status);
    const shouldAutoBlockReferralCode = isDeactivatingStatus && existing.referralCodeStatus === "active";
    if (shouldAutoBlockReferralCode) {
      updates.referralCodeStatus = "blocked";
    }
    if (parsed.data.classification != null) updates.classification = parsed.data.classification;
    if (parsed.data.tags != null) updates.tags = parsed.data.tags;
    if (parsed.data.observations !== undefined) updates.observations = parsed.data.observations ?? null;
    if (parsed.data.dreamDestinations != null) updates.dreamDestinations = parsed.data.dreamDestinations;
    if (parsed.data.addressCity !== undefined) updates.addressCity = parsed.data.addressCity ?? null;
    if (parsed.data.addressState !== undefined) updates.addressState = parsed.data.addressState ?? null;
    if (parsed.data.npsScore !== undefined) updates.npsScore = parsed.data.npsScore ?? null;
    if (parsed.data.pipelineStage != null) updates.pipelineStage = parsed.data.pipelineStage;
    if (parsed.data.lastContactAt !== undefined) updates.lastContactAt = parsed.data.lastContactAt ? new Date(parsed.data.lastContactAt) : null;
    if (parsed.data.photoUrl !== undefined) updates.photoUrl = parsed.data.photoUrl ?? null;
    if (parsed.data.instagram !== undefined) updates.instagram = parsed.data.instagram ?? null;
    if (parsed.data.origin !== undefined) updates.origin = parsed.data.origin ?? null;
    if (parsed.data.maritalStatus !== undefined) updates.maritalStatus = parsed.data.maritalStatus ?? null;
    if (parsed.data.professionalArea !== undefined) updates.professionalArea = parsed.data.professionalArea ?? null;
    if (parsed.data.favoriteDrink !== undefined) updates.favoriteDrink = parsed.data.favoriteDrink ?? null;
    if (parsed.data.companyFeedback !== undefined) updates.companyFeedback = parsed.data.companyFeedback ?? null;
    if (parsed.data.musicalPreferences !== undefined) updates.musicalPreferences = parsed.data.musicalPreferences ?? null;
    if (parsed.data.foodPreferences !== undefined) updates.foodPreferences = parsed.data.foodPreferences ?? null;
    if (parsed.data.internalRating !== undefined) updates.internalRating = parsed.data.internalRating ?? null;
    if (parsed.data.companyNps !== undefined) {
      updates.companyNps = parsed.data.companyNps ?? null;
      updates.npsScore = parsed.data.companyNps ?? null;
    }
    if (parsed.data.travelInterests != null) updates.travelInterests = parsed.data.travelInterests;
    if (parsed.data.ambassadorOptIn !== undefined) updates.ambassadorOptIn = parsed.data.ambassadorOptIn ?? undefined;

    await db.transaction(async (tx) => {
      await tx.update(clientsTable).set(updates)
        .where(and(eq(clientsTable.id, req.params.id), eq(clientsTable.tenantId, me.tenantId)));

      if (parsed.data.companyNps != null) {
        const score = parsed.data.companyNps;
        const classification = score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor";
        const npsUserId = existing.userId ?? existing.id;
        await tx.insert(npsResponsesTable).values({
          id: generateId(),
          tenantId: me.tenantId,
          userId: npsUserId,
          score,
          classification,
          feedback: null,
          orderId: null,
        });
      }
    });

    const [client] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.id, req.params.id), eq(clientsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!client) { next(new NotFoundError("Client not found", "NOT_FOUND")); return; }
    res.json(formatClient(client));

    if (shouldAutoBlockReferralCode) {
      dispatchReferralCodeSuspendedEmail({ clientId: client.id, tenantId: me.tenantId, status: "blocked" }).catch((err: unknown) => {
        req.log?.warn({ err, clientId: client.id }, "[clients] referral-code-suspended auto-email on deactivation failed");
      });
    }

    if (parsed.data.birthDate !== undefined) {
      scheduleCalendarSyncBirthday(client.id).catch((err) => logger.warn({ err }, "[clients] calendar birthday sync (update) failed"));
    }
  } catch (err) {
    next(err);
  }
});

router.delete("/clients/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [client] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.id, req.params.id), eq(clientsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!client) { next(new NotFoundError("Client not found", "NOT_FOUND")); return; }

    const linkedUserId = client.userId;

    let linkedUser: typeof usersTable.$inferSelect | undefined;
    if (linkedUserId) {
      const [found] = await db.select().from(usersTable)
        .where(and(eq(usersTable.id, linkedUserId), eq(usersTable.tenantId, me.tenantId)))
        .limit(1);
      linkedUser = found;
    }

    if (linkedUser) {
      try {
        await clerkClient.users.deleteUser(linkedUser.clerkId);
      } catch (clerkErr: unknown) {
        const status = (clerkErr as { status?: number })?.status;
        if (status !== 404) {
          next(new AppError(`Não foi possível remover a conta do portal: ${(clerkErr as Error).message}`, 502, "CLERK_DELETE_FAILED"));
          return;
        }
      }
    }

    await db.transaction(async (tx) => {
      await Promise.all([
        tx.update(reservationsTable).set({ clientId: sql`NULL` }).where(eq(reservationsTable.clientId, client.id)),
        tx.update(paymentsTable).set({ clientId: null }).where(eq(paymentsTable.clientId, client.id)),
        tx.update(dealsTable).set({ clientId: null }).where(eq(dealsTable.clientId, client.id)),
        tx.update(storeOrdersTable).set({ clientId: null }).where(eq(storeOrdersTable.clientId, client.id)),
        tx.update(storeReviewsTable).set({ clientId: null }).where(eq(storeReviewsTable.clientId, client.id)),
      ]);
      if (linkedUser) {
        await tx.delete(usersTable).where(eq(usersTable.id, linkedUser.id));
      }
      await tx.delete(clientsTable)
        .where(and(eq(clientsTable.id, client.id), eq(clientsTable.tenantId, me.tenantId)));
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.patch("/clients/:id/pipeline-stage", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role === ROLES.CLIENT) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const existing = await requireClientAccess(me, req.params.id);

    const parsed = UpdateClientPipelineStageBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    await db.update(clientsTable).set({ pipelineStage: parsed.data.stage })
      .where(and(eq(clientsTable.id, req.params.id), eq(clientsTable.tenantId, me.tenantId)));
    const [client] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.id, req.params.id), eq(clientsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!client) { next(new NotFoundError("Client not found", "NOT_FOUND")); return; }
    res.json(formatClient(client));
  } catch (err) {
    next(err);
  }
});

router.get("/clients/:clientId/activities", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const client = await requireClientAccess(me, req.params.clientId);
    const activities = await db.select().from(notesTable)
      .where(eq(notesTable.clientId, req.params.clientId))
      .orderBy(desc(notesTable.createdAt));
    res.json(activities.map(n => ({
      id: n.id, clientId: n.clientId, type: n.type,
      content: n.content,
      metadata: n.metadata ? (() => { try { return JSON.parse(n.metadata!); } catch { return null; } })() : null,
      isPrivate: n.isPrivate, createdById: n.createdById,
      createdAt: n.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

const CreateActivityBody = z.object({
  type: z.enum(["note", "call", "whatsapp", "email", "meeting"]),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

router.post("/clients/:clientId/activities", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const client = await requireClientAccess(me, req.params.clientId);
    const parsedBody = CreateActivityBody.safeParse(req.body);
    if (!parsedBody.success) {
      next(new ValidationError(parsedBody.error.issues[0]?.message ?? "type and content are required", "VALIDATION_ERROR")); return;
    }
    const { type, content, metadata } = parsedBody.data;
    const id = generateId();
    await db.insert(notesTable).values({
      id,
      clientId: req.params.clientId,
      type,
      content,
      metadata: metadata ? JSON.stringify(metadata) : null,
      isPrivate: false,
      createdById: me.id,
    });
    const [activity] = await db.select().from(notesTable)
      .where(and(eq(notesTable.id, id), eq(notesTable.clientId, req.params.clientId)))
      .limit(1);
    if (!activity) { next(new AppError("Failed to create activity", 500, "ACTIVITY_CREATE_FAILED")); return; }
    res.status(201).json({
      id: activity.id, clientId: activity.clientId, type: activity.type,
      content: activity.content,
      metadata: activity.metadata ? (() => { try { return JSON.parse(activity.metadata!); } catch { return null; } })() : null,
      isPrivate: activity.isPrivate, createdById: activity.createdById,
      createdAt: activity.createdAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/clients/:clientId/notes", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const client = await requireClientAccess(me, req.params.clientId);
    const notes = await db.select().from(notesTable)
      .where(eq(notesTable.clientId, req.params.clientId))
      .orderBy(desc(notesTable.createdAt));
    res.json(notes.map(n => ({
      id: n.id, clientId: n.clientId, content: n.content,
      isPrivate: n.isPrivate, createdById: n.createdById,
      createdAt: n.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

router.post("/clients/:clientId/notes", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const client = await requireClientAccess(me, req.params.clientId);
    const parsed = CreateClientNoteBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(notesTable).values({
      id,
      clientId: req.params.clientId,
      content: parsed.data.content,
      isPrivate: parsed.data.isPrivate ?? false,
      createdById: me.id,
    });
    const [note] = await db.select().from(notesTable)
      .where(and(eq(notesTable.id, id), eq(notesTable.clientId, req.params.clientId)))
      .limit(1);
    if (!note) { next(new AppError("Failed to create note", 500, "NOTE_CREATE_FAILED")); return; }
    res.status(201).json({
      id: note.id, clientId: note.clientId, content: note.content,
      isPrivate: note.isPrivate, createdById: note.createdById,
      createdAt: note.createdAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/clients/:clientId/notes/:noteId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const client = await requireClientAccess(me, req.params.clientId);
    await db.delete(notesTable)
      .where(and(eq(notesTable.id, req.params.noteId), eq(notesTable.clientId, req.params.clientId)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/clients/:clientId/referral", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const client = await requireClientAccess(me, req.params.clientId);
    const referrals = await db.select().from(referralsTable)
      .where(and(
        eq(referralsTable.tenantId, me.tenantId),
        eq(referralsTable.referrerId, req.params.clientId),
      ))
      .orderBy(desc(referralsTable.createdAt));
    const attemptLogs = await db.select()
      .from(referralAttemptLogsTable)
      .where(and(
        eq(referralAttemptLogsTable.tenantId, me.tenantId),
        eq(referralAttemptLogsTable.clientId, req.params.clientId),
      ))
      .orderBy(desc(referralAttemptLogsTable.createdAt))
      .limit(20);
    res.json({
      referralCode: client.referralCode ?? null,
      referralCodeStatus: client.referralCodeStatus ?? "active",
      totalReferrals: client.totalReferrals ?? 0,
      successfulReferrals: client.successfulReferrals ?? 0,
      referralEarnings: Number(client.referralEarnings ?? 0),
      referralSuspendedAttemptAt: client.referralSuspendedAttemptAt ?? null,
      referralSuspendedAttemptCount: client.referralSuspendedAttemptCount ?? 0,
      referrals,
      attemptLogs,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/clients/:clientId/referral/generate", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const client = await requireClientAccess(me, req.params.clientId);

    // If client already has a code return it
    if (client.referralCode) {
      res.json({ code: client.referralCode });
      return;
    }

    // Generate unique referral code using utility: NOME2026 format (tenant-scoped uniqueness)
    const baseCode = generateReferralCode(client.name ?? "REF", me.tenantId);
    const namePart = baseCode.replace(/\d+$/, "");
    const year = Number(localToday().slice(0, 4)); // Brazil calendar year

    const code = await generateAndAssignReferralCode(
      client.id,
      me.tenantId,
      baseCode,
      namePart,
      year,
    );

    // Fire-and-forget welcome email on first code generation
    dispatchReferralWelcomeEmail({
      clientId: client.id,
      referralCode: code,
      tenantId: me.tenantId,
    }).catch((err: unknown) => {
      logger.warn({ err }, "[clients] Failed to dispatch referral welcome email");
    });

    res.json({ code });
  } catch (err) {
    next(err);
  }
});

router.patch("/clients/:id/referral-code", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const client = await requireClientAccess(me, req.params.id);
    const parsed = z.object({
      status: z.enum(["active", "blocked", "cancelled"]),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const [updated] = await db.update(clientsTable)
      .set({ referralCodeStatus: parsed.data.status, updatedAt: new Date() })
      .where(and(eq(clientsTable.id, client.id), eq(clientsTable.tenantId, me.tenantId)))
      .returning({ id: clientsTable.id, referralCodeStatus: clientsTable.referralCodeStatus });
    if (parsed.data.status === "active") {
      void db.delete(referralAttemptLogsTable)
        .where(and(eq(referralAttemptLogsTable.clientId, client.id), eq(referralAttemptLogsTable.tenantId, me.tenantId)))
        .catch((err: unknown) => {
          req.log?.warn({ err, clientId: client.id }, "[clients] referral-attempt-log clear on re-activation failed");
        });
    }
    let emailSent: boolean | undefined;
    if (parsed.data.status === "blocked" || parsed.data.status === "cancelled") {
      try {
        emailSent = await dispatchReferralCodeSuspendedEmail({ clientId: client.id, tenantId: me.tenantId, status: parsed.data.status });
      } catch (err) {
        req.log?.warn({ err, clientId: client.id }, "[clients] referral-code-suspended email dispatch failed");
        emailSent = false;
      }
    }
    res.json({ id: updated.id, referralCodeStatus: updated.referralCodeStatus, ...(emailSent !== undefined ? { emailSent } : {}) });
  } catch (err) {
    next(err);
  }
});

router.post("/clients/:id/recalculate-score", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const client = await requireClientAccess(me, req.params.id);
    calculateScoresForClient(client.id, me.tenantId).catch((err) => {
      req.log.warn({ err, clientId: client.id }, "[scores] Background recalculation failed");
    });
    res.status(202).json({ message: "Recálculo de scores iniciado." });
  } catch (err) {
    next(err);
  }
});

router.get("/clients/:clientId/recommendations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const client = await requireClientAccess(me, req.params.clientId);

    const redis = getRedisConnection();
    const cacheKey = `recommendations:${me.tenantId}:${client.id}`;
    if (redis) {
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) {
        res.json(JSON.parse(cached));
        return;
      }
    }

    const now = new Date();
    const availableTrips = await db
      .select()
      .from(tripsTable)
      .where(and(
        eq(tripsTable.tenantId, me.tenantId),
        eq(tripsTable.status, "published"),
        sql`${tripsTable.departureDate} > ${now}`,
        sql`${tripsTable.availableSeats} > 0`,
      ))
      .orderBy(asc(tripsTable.departureDate))
      .limit(20);

    if (availableTrips.length === 0) {
      res.json({ recommendations: [], source: "none" });
      return;
    }

    // "Viagens realizadas" = completed OR confirmed with departure already passed
    const pastReservationRows = await db
      .select({
        tripId: reservationsTable.tripId,
        status: reservationsTable.status,
        totalValue: reservationsTable.totalValue,
      })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.clientId, client.id),
        eq(reservationsTable.tenantId, me.tenantId),
        inArray(reservationsTable.status, ["confirmed", "completed"]),
      ));

    // Fetch trip data for past reservations to use in AI prompt
    const pastTripIdList = [...new Set(pastReservationRows.map(r => r.tripId))];
    const pastTripsData = pastTripIdList.length > 0
      ? await db
          .select({
            id: tripsTable.id,
            name: tripsTable.name,
            destination: tripsTable.destination,
            type: tripsTable.type,
            category: tripsTable.category,
            departureDate: tripsTable.departureDate,
            priceAdult: tripsTable.priceAdult,
          })
          .from(tripsTable)
          .where(and(
            eq(tripsTable.tenantId, me.tenantId),
            inArray(tripsTable.id, pastTripIdList),
          ))
      : [];

    // Only count trips that truly happened: completed OR departure date already passed
    const completedOrDeparted = pastReservationRows.filter(r => {
      if (r.status === "completed") return true;
      const tripInfo = pastTripsData.find(t => t.id === r.tripId);
      return tripInfo ? tripInfo.departureDate < now : false;
    });

    interface RecommendedTrip {
      tripId: string;
      name: string;
      destination: string;
      departureDate: string;
      returnDate: string | null;
      availableSeats: number;
      priceAdult: number;
      reason: string;
    }

    let result: { recommendations: RecommendedTrip[]; source: string };

    if (completedOrDeparted.length < 2) {
      const popularRows = await db
        .select({ tripId: reservationsTable.tripId, cnt: count() })
        .from(reservationsTable)
        .where(and(
          eq(reservationsTable.tenantId, me.tenantId),
          inArray(reservationsTable.tripId, availableTrips.map(t => t.id)),
        ))
        .groupBy(reservationsTable.tripId)
        .orderBy(desc(count()))
        .limit(3);

      // Sort available trips by actual reservation count (popularRows already sorted by count)
      const tripsById = new Map(availableTrips.map(t => [t.id, t]));
      const top3 = [
        ...popularRows.map(p => tripsById.get(p.tripId)).filter(Boolean),
        ...availableTrips.filter(t => !popularRows.find(p => p.tripId === t.id)),
      ].slice(0, 3) as typeof availableTrips;

      result = {
        recommendations: top3.map(t => ({
          tripId: t.id,
          name: t.name,
          destination: t.destination,
          departureDate: t.departureDate.toISOString(),
          returnDate: t.returnDate?.toISOString() ?? null,
          availableSeats: t.availableSeats,
          priceAdult: Number(t.priceAdult),
          reason: "Viagem popular entre os clientes da agência",
        })),
        source: "popular",
      };
    } else {
      // Exclude all trips client already has reservations for (regardless of status)
      const pastTripIds = new Set(pastTripIdList);
      const candidateTrips = availableTrips.filter(t => !pastTripIds.has(t.id)).slice(0, 10);

      if (candidateTrips.length === 0) {
        result = { recommendations: [], source: "none" };
      } else {
        // Enrich client profile: loyalty tier + historical price range
        const [loyaltyMember] = await db
          .select({ tier: loyaltyMembersTable.tier, totalPoints: loyaltyMembersTable.totalPoints, availablePoints: loyaltyMembersTable.availablePoints })
          .from(loyaltyMembersTable)
          .where(and(eq(loyaltyMembersTable.clientId, client.id), eq(loyaltyMembersTable.tenantId, me.tenantId)))
          .limit(1);

        const paidPayments = await db
          .select({ amount: paymentsTable.amount })
          .from(paymentsTable)
          .where(and(
            eq(paymentsTable.clientId, client.id),
            eq(paymentsTable.tenantId, me.tenantId),
            eq(paymentsTable.status, "paid"),
          ))
          .limit(20);

        const prices = paidPayments.map(p => Number(p.amount)).filter(v => v > 0);
        const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
        const minPrice = prices.length ? Math.min(...prices) : null;
        const maxPrice = prices.length ? Math.max(...prices) : null;

        // Build travel history summary from completed/departed trips
        const travelHistorySummary = pastTripsData.length
          ? pastTripsData
              .sort((a, b) => b.departureDate.getTime() - a.departureDate.getTime())
              .slice(0, 5)
              .map(t => `- ${t.name} (${t.destination}, ${t.departureDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}, R$ ${Number(t.priceAdult).toFixed(0)})`)
              .join("\n")
          : "";

        const clientProfile = [
          `Nome: ${client.name}`,
          client.dreamDestinations?.length ? `Destinos sonhados: ${client.dreamDestinations.join(", ")}` : "",
          client.travelInterests?.length ? `Interesses de viagem: ${client.travelInterests.join(", ")}` : "",
          client.travelPreference ? `Preferência: ${client.travelPreference}` : "",
          client.preferredDestinationTypes?.length ? `Tipos de destino preferidos: ${client.preferredDestinationTypes.join(", ")}` : "",
          loyaltyMember ? `Fidelidade: tier ${loyaltyMember.tier} (${loyaltyMember.availablePoints} pts disponíveis)` : "",
          avgPrice != null ? `Faixa de gasto histórico: média R$ ${avgPrice.toFixed(0)}, min R$ ${minPrice?.toFixed(0)}, max R$ ${maxPrice?.toFixed(0)}` : "",
          travelHistorySummary ? `Viagens realizadas (mais recentes):\n${travelHistorySummary}` : "",
        ].filter(Boolean).join("\n");

        const tripsList = candidateTrips.map((t, i) =>
          `${i + 1}. ID: ${t.id} | ${t.name} | ${t.destination} | ${t.departureDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} | Vagas: ${t.availableSeats} | R$ ${Number(t.priceAdult).toFixed(2)}`
        ).join("\n");

        const prompt = `Você é consultor de turismo. Analise o perfil do cliente e selecione as 3 melhores viagens para recomendar.

PERFIL DO CLIENTE:
${clientProfile}

VIAGENS DISPONÍVEIS:
${tripsList}

Responda APENAS com JSON válido:
{"recommendations":[{"tripId":"id","reason":"motivo em português (máx 80 chars)"}]}

Selecione até 3 viagens priorizando: destinos sonhados, histórico de viagens realizadas (padrões e destinos já visitados), interesses declarados, faixa de preço histórica e fidelidade do cliente.`;

        try {
          const { client: aiClient, model } = await getAIClientForTenant(me.tenantId);
          const response = await aiClient.chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            max_tokens: 400,
            temperature: 0.3,
          });
          const raw = response.choices[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(raw) as { recommendations?: Array<{ tripId: string; reason: string }> };
          const aiRecs = parsed.recommendations ?? [];
          const tripsByIdMap = new Map(candidateTrips.map(t => [t.id, t]));
          const recommendations: RecommendedTrip[] = aiRecs
            .filter(r => tripsByIdMap.has(r.tripId))
            .slice(0, 3)
            .map(r => {
              const t = tripsByIdMap.get(r.tripId)!;
              return {
                tripId: t.id,
                name: t.name,
                destination: t.destination,
                departureDate: t.departureDate.toISOString(),
                returnDate: t.returnDate?.toISOString() ?? null,
                availableSeats: t.availableSeats,
                priceAdult: Number(t.priceAdult),
                reason: r.reason,
              };
            });
          result = { recommendations, source: "ai" };
        } catch {
          result = {
            recommendations: candidateTrips.slice(0, 3).map(t => ({
              tripId: t.id,
              name: t.name,
              destination: t.destination,
              departureDate: t.departureDate.toISOString(),
              returnDate: t.returnDate?.toISOString() ?? null,
              availableSeats: t.availableSeats,
              priceAdult: Number(t.priceAdult),
              reason: "Viagem disponível com vagas",
            })),
            source: "fallback",
          };
        }
      }
    }

    // Cache all outcomes for 24h to prevent repeated AI calls (including empty/fallback)
    if (redis) {
      await redis.set(cacheKey, JSON.stringify(result), "EX", 86400).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

const MergeClientBody = z.object({
  secondaryId: z.string().min(1),
});

router.post("/clients/:id/merge", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const primaryId = req.params.id;
    const parsedBody = MergeClientBody.safeParse(req.body);
    if (!parsedBody.success) {
      next(new ValidationError(parsedBody.error.issues[0]?.message ?? "secondaryId é obrigatório", "VALIDATION_ERROR")); return;
    }
    const { secondaryId } = parsedBody.data;
    if (secondaryId === primaryId) {
      next(new ValidationError("O cliente primário e secundário não podem ser o mesmo", "VALIDATION_ERROR")); return;
    }

    const [[primary], [secondary]] = await Promise.all([
      db.select().from(clientsTable).where(and(eq(clientsTable.id, primaryId), eq(clientsTable.tenantId, me.tenantId))).limit(1),
      db.select().from(clientsTable).where(and(eq(clientsTable.id, secondaryId), eq(clientsTable.tenantId, me.tenantId))).limit(1),
    ]);
    if (!primary) { next(new NotFoundError("Cliente primário não encontrado", "NOT_FOUND")); return; }
    if (!secondary) { next(new NotFoundError("Cliente secundário não encontrado", "NOT_FOUND")); return; }
    if (secondary.status === "merged") { next(new ValidationError("Este cliente já foi mesclado anteriormente", "VALIDATION_ERROR")); return; }

    await db.transaction(async (tx) => {
      await Promise.all([
        tx.delete(clientScoresTable).where(and(eq(clientScoresTable.clientId, secondaryId), eq(clientScoresTable.tenantId, me.tenantId))),
        tx.delete(campaignSendsTable).where(eq(campaignSendsTable.clientId, secondaryId)),
      ]);

      await Promise.all([
        tx.update(reservationsTable).set({ clientId: primaryId }).where(and(eq(reservationsTable.clientId, secondaryId), eq(reservationsTable.tenantId, me.tenantId))),
        tx.update(paymentsTable).set({ clientId: primaryId }).where(eq(paymentsTable.clientId, secondaryId)),
        tx.update(dealsTable).set({ clientId: primaryId }).where(and(eq(dealsTable.clientId, secondaryId), eq(dealsTable.tenantId, me.tenantId))),
        tx.update(storeOrdersTable).set({ clientId: primaryId }).where(eq(storeOrdersTable.clientId, secondaryId)),
        tx.update(storeReviewsTable).set({ clientId: primaryId }).where(eq(storeReviewsTable.clientId, secondaryId)),
        tx.update(notesTable).set({ clientId: primaryId }).where(eq(notesTable.clientId, secondaryId)),
        tx.update(calendarEventsTable).set({ clientId: primaryId }).where(eq(calendarEventsTable.clientId, secondaryId)),
        tx.update(referralsTable).set({ referrerId: primaryId }).where(and(eq(referralsTable.referrerId, secondaryId), eq(referralsTable.tenantId, me.tenantId))),
        tx.update(loyaltyMembersTable).set({ clientId: primaryId }).where(and(eq(loyaltyMembersTable.clientId, secondaryId), eq(loyaltyMembersTable.tenantId, me.tenantId))),
        tx.update(clientNpsResponsesTable).set({ clientId: primaryId }).where(eq(clientNpsResponsesTable.clientId, secondaryId)),
      ]);

      await tx.insert(notesTable).values({
        id: generateId(),
        clientId: primaryId,
        type: "merge",
        content: `Registros mesclados: cadastro duplicado de "${secondary.name}" (ID: ${secondaryId}) foi incorporado a este perfil por ${me.id} em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
        createdById: me.id,
        isPrivate: true,
      });

      await tx.update(clientsTable)
        .set({
          status: "merged",
          cpf: null,
          observations: `[MESCLADO em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}] Incorporado ao cliente ${primary.name} (ID: ${primaryId}). ${secondary.observations ?? ""}`.trim(),
          updatedAt: new Date(),
        })
        .where(and(eq(clientsTable.id, secondaryId), eq(clientsTable.tenantId, me.tenantId)));
    });

    const [updatedPrimary] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.id, primaryId), eq(clientsTable.tenantId, me.tenantId)))
      .limit(1);

    res.json({ success: true, client: formatClient(updatedPrimary!) });
  } catch (err) {
    next(err);
  }
});

export default router;

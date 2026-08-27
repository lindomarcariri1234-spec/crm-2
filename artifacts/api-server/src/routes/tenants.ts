import { Router, type NextFunction } from "express";
import {
  db, tenantsTable, usersTable, plansTable, referralSettingsTable, tripsTable,
  clientsTable, reservationsTable, passengersTable, reservationInstallmentsTable, storesTable,
  storeCategoriesTable, storeProductsTable, storeCouponsTable, storeOrdersTable,
  storeOrderItemsTable, storePagesTable, storeReviewsTable, paymentsTable, expensesTable,
  vehiclesTable, vehicleLayoutsTable, boardingLocationsTable, commissionRulesTable, commissionsTable,
  pipelinesTable, pipelineStagesTable, dealsTable, loyaltyProgramsTable, loyaltyMembersTable,
  loyaltyTransactionsTable, referralCampaignsTable, referralsTable, referralCommissionsTable,
  salesGoalsTable, couponsTable, documentsTable, notesTable, messageTemplatesTable,
  automationsTable, automationActionsTable, tripCostsTable, tripMediaTable,
  clientAchievementsTable, clientDreamDestinationsTable, clientFavoritesTable,
  suppliersTable, accommodationsTable, destinationsTable, clubConfigTable, clubBenefitsTable,
  settlementItemsTable, financialLedgerEntriesTable, partnersTable, partnerProductsTable,
  partnerAvailabilityTable, partnerCommissionsTable, campaignsTable, calendarEventsTable,
  productCategoriesTable, productImagesTable, productsTable, ordersTable, orderItemsTable,
  npsResponsesTable, clientNpsResponsesTable, npsInvitationsTable, clientScoresTable,
  priceAlertSubscriptionsTable, invitesTable, tripCheckinsTable,
} from "@workspace/db";
import { eq, desc, count, or, and, gt, asc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth, ADMIN_ROLES } from "../lib/tenant";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { deleteOrphanedFile } from "../lib/uploadthing";
import { ROLES } from "@workspace/permissions";
import { enqueueAgencySuspendedEmail, enqueueAgencyReactivatedEmail } from "../queues/email-helpers";
import { canEnableFeature, getFeatureLabel, getFeatureRequiredPlanLabel, hasSeatMapFeature } from "../lib/plan-features";
import { formatTrip } from "./trips.js";
import {
  BACKUP_FORMAT_VERSION, BACKUP_BATCH_SIZE, streamArraySection, writeExportChunk,
  formatBackupTenant, formatBackupUser, formatBackupClient, formatBackupPassenger,
  formatBackupReservationInstallment, formatBackupReservation, formatBackupStore,
  formatBackupStoreCategory, formatBackupStoreProduct, formatBackupStoreCoupon,
  formatBackupStorePage, formatBackupStoreReview,
  formatBackupOrderItem, formatBackupStoreOrder, formatBackupPayment, formatBackupExpense,
  formatBackupVehicle, formatBackupVehicleLayout, formatBackupBoardingLocation, formatBackupCommissionRule,
  formatBackupCommission, formatBackupPipeline, formatBackupPipelineStage, formatBackupDeal,
  formatBackupLoyaltyProgram, formatBackupLoyaltyMember, formatBackupLoyaltyTransaction,
  formatBackupReferralSettings, formatBackupReferralCampaign, formatBackupReferral,
  formatBackupReferralCommission, formatBackupSalesGoal, formatBackupCoupon,
  formatBackupDocument, formatBackupNote, formatBackupMessageTemplate,
  formatBackupAutomation, formatBackupAutomationAction, formatBackupTripCost,
  formatBackupTripMedia, formatBackupClientAchievement, formatBackupClientDreamDestination,
  formatBackupClientFavorite, formatBackupSupplier, formatBackupAccommodation,
  formatBackupDestination, formatBackupClubConfig, formatBackupClubBenefit,
  formatBackupSettlementItem, formatBackupFinancialLedgerEntry, formatBackupPartner,
  formatBackupPartnerProduct, formatBackupPartnerAvailability, formatBackupPartnerCommission,
  formatBackupCampaign, formatBackupCalendarEvent, formatBackupProductCategory,
  formatBackupProductImage, formatBackupMarketingProduct, formatBackupMarketingOrderItem,
  formatBackupMarketingOrder, formatBackupNpsResponse, formatBackupClientNpsResponse,
  formatBackupNpsInvitation, formatBackupClientScore, formatBackupPriceAlertSubscription,
  formatBackupInvite, formatBackupTripCheckin,
} from "../lib/backup-export.js";

const router = Router();

const UpdateTenantBody = z.object({
  name: z.string().min(1).optional(),
  planId: z.string().optional(),
  status: z.string().optional(),
  suspensionReason: z.string().max(500).optional(),
  logoUrl: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  whatsapp: z.string().optional(),
  phone: z.string().optional(),
  cnpj: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  maxUsersOverride: z.number().int().nullable().optional(),
  maxClientsOverride: z.number().int().nullable().optional(),
  maxTripsOverride: z.number().int().nullable().optional(),
  trialEndsAt: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  reservationPrefix: z.string().max(5).optional().nullable(),
  birthdayMessagesEnabled: z.boolean().nullable().optional(),
  couponsEnabled: z.boolean().nullable().optional(),
  referralsEnabled: z.boolean().nullable().optional(),
  seatMapEnabled: z.boolean().nullable().optional(),
  npsCategories: z.object({
    transport: z.boolean().optional(),
    service: z.boolean().optional(),
    organization: z.boolean().optional(),
    guide: z.boolean().optional(),
  }).nullable().optional(),
});

router.get("/admin/stats", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [tenants, allPlans] = await Promise.all([
      db.select().from(tenantsTable),
      db.select({ id: plansTable.id, slug: plansTable.slug, monthlyPrice: plansTable.monthlyPrice }).from(plansTable),
    ]);

    const planPriceMap: Record<string, number> = {};
    for (const p of allPlans) {
      const price = Number(p.monthlyPrice) || 0;
      planPriceMap[p.id] = price;
      if (p.slug) planPriceMap[p.slug] = price;
    }

    const totalTenants = tenants.length;
    const byStatus: Record<string, number> = {};
    const byPlan: Record<string, number> = {};
    let mrr = 0;

    for (const t of tenants) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byPlan[t.planId] = (byPlan[t.planId] ?? 0) + 1;
      if (t.status === "active") {
        mrr += planPriceMap[t.planId] ?? 0;
      }
    }

    res.json({
      totalTenants,
      byStatus,
      byPlan,
      mrr,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/tenants", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const tenants = await db.select().from(tenantsTable).orderBy(desc(tenantsTable.createdAt));

    const userCounts = await db
      .select({ tenantId: usersTable.tenantId, userCount: count(usersTable.id) })
      .from(usersTable)
      .groupBy(usersTable.tenantId);

    const countMap: Record<string, number> = {};
    for (const row of userCounts) {
      if (row.tenantId) countMap[row.tenantId] = row.userCount;
    }

    const result = tenants.map((t) => ({ ...t, userCount: countMap[t.id] ?? 0 }));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/tenants/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN && me.tenantId !== req.params.id) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, req.params.id)).limit(1);
    if (!tenant) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(tenant);
  } catch (err) {
    next(err);
  }
});

router.post("/tenants", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
      email: z.string().email(),
      planId: z.string().optional(),
      status: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(tenantsTable).values({ id, ...parsed.data });
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1);
    res.status(201).json(tenant);
  } catch (err) {
    next(err);
  }
});

router.patch("/tenants/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const isAdminOfTenant = (me.role === ROLES.AGENCY_ADMIN || me.role === ROLES.SUPER_ADMIN) && me.tenantId === req.params.id;
    const isSuperadmin = me.role === ROLES.SUPER_ADMIN;
    if (!isAdminOfTenant && !isSuperadmin) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    if (me.role !== ROLES.SUPER_ADMIN && (req.body.planId || req.body.status !== undefined || req.body.maxUsersOverride !== undefined || req.body.maxClientsOverride !== undefined || req.body.maxTripsOverride !== undefined)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const parsed = UpdateTenantBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const { birthdayMessagesEnabled, couponsEnabled, referralsEnabled, seatMapEnabled, npsCategories, suspensionReason, ...rest } = parsed.data;
    const updateData: Record<string, unknown> = { ...rest };
    if (me.role !== ROLES.SUPER_ADMIN) {
      delete updateData.planId;
      delete updateData.status;
      delete updateData.maxUsersOverride;
      delete updateData.maxClientsOverride;
      delete updateData.maxTripsOverride;
      delete updateData.trialEndsAt;
    }
    // Validate and convert trialEndsAt ISO 8601 string to Date for the timestamp column.
    // We accept both full ISO datetimes and bare YYYY-MM-DD date strings (the HTML
    // date input sends "YYYY-MM-DD").  Anything else is rejected.
    if (updateData.trialEndsAt !== undefined) {
      if (updateData.trialEndsAt) {
        const raw = updateData.trialEndsAt as string;
        const isIso8601 = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(raw);
        if (!isIso8601) {
          next(new ValidationError("trialEndsAt deve ser uma data no formato ISO 8601 (ex: 2026-12-31 ou 2026-12-31T23:59:59Z)", "VALIDATION_ERROR"));
          return;
        }
        const parsedDate = new Date(raw);
        if (isNaN(parsedDate.getTime())) {
          next(new ValidationError("trialEndsAt contém uma data inválida", "VALIDATION_ERROR"));
          return;
        }
        updateData.trialEndsAt = parsedDate;
      } else {
        updateData.trialEndsAt = null;
      }
    }
    if (updateData.reservationPrefix != null) {
      const rawPrefix = (updateData.reservationPrefix as string).trim().toUpperCase();
      if (rawPrefix !== "" && !/^[A-Z]{1,5}$/.test(rawPrefix)) {
        next(new AppError("O prefixo deve conter apenas letras (1–5 caracteres)", 422, "PREFIX_INVALID"));
        return;
      }
      updateData.reservationPrefix = rawPrefix || null;
    }
    const [existing] = await db.select({ settings: tenantsTable.settings, logoUrl: tenantsTable.logoUrl, planId: tenantsTable.planId, prefixLocked: tenantsTable.prefixLocked, status: tenantsTable.status, email: tenantsTable.email }).from(tenantsTable).where(eq(tenantsTable.id, req.params.id)).limit(1);
    if (updateData.reservationPrefix != null && existing?.prefixLocked) {
      next(new AppError("O prefixo de identificação já foi definido e não pode ser alterado", 422, "PREFIX_LOCKED"));
      return;
    }
    if (updateData.reservationPrefix != null && !existing?.prefixLocked) {
      updateData.prefixLocked = true;
    }
    if (me.role !== ROLES.SUPER_ADMIN) {
      const rawPlanId = existing?.planId ?? "starter";
      const [planRow] = await db.select({ slug: plansTable.slug }).from(plansTable).where(eq(plansTable.id, rawPlanId)).limit(1);
      const planSlug = planRow?.slug ?? rawPlanId;
      const featuresToCheck: Array<{ key: string; effectiveValue: boolean }> = [
        { key: "couponsEnabled", effectiveValue: couponsEnabled !== undefined ? (couponsEnabled ?? true) : false },
        { key: "referralsEnabled", effectiveValue: referralsEnabled !== undefined ? (referralsEnabled ?? true) : false },
        { key: "seatMap", effectiveValue: seatMapEnabled !== undefined ? (seatMapEnabled ?? true) : false },
      ];
      for (const { key, effectiveValue } of featuresToCheck) {
        if (effectiveValue === true && !canEnableFeature(key, planSlug)) {
          const featureLabel = getFeatureLabel(key);
          const requiredPlan = getFeatureRequiredPlanLabel(key);
          next(new ForbiddenError(`O plano atual não inclui "${featureLabel}". Faça upgrade para o plano ${requiredPlan} ou superior para ativar esta funcionalidade.`, "PLAN_UPGRADE_REQUIRED"));
          return;
        }
      }
    }
    const settingsUpdates: Record<string, unknown> = {};
    if (birthdayMessagesEnabled !== undefined) settingsUpdates.birthdayMessagesEnabled = birthdayMessagesEnabled ?? true;
    if (couponsEnabled !== undefined) settingsUpdates.couponsEnabled = couponsEnabled ?? true;
    if (referralsEnabled !== undefined) settingsUpdates.referralsEnabled = referralsEnabled ?? true;
    if (seatMapEnabled !== undefined) settingsUpdates.seatMapEnabled = seatMapEnabled ?? true;
    if (npsCategories !== undefined) settingsUpdates.npsCategories = npsCategories ?? { transport: true, service: true, organization: true, guide: true };
    if (Object.keys(settingsUpdates).length > 0) {
      const currentSettings = (existing?.settings ?? {}) as Record<string, unknown>;
      updateData.settings = { ...currentSettings, ...settingsUpdates };
    }
    const oldLogoUrl = existing?.logoUrl;
    await db.update(tenantsTable).set(updateData).where(eq(tenantsTable.id, req.params.id));
    if (typeof updateData.planId === "string" && updateData.planId) {
      const newPlanId = updateData.planId;
      const [syncPlan] = await db
        .select({ supportedFeatures: plansTable.supportedFeatures })
        .from(plansTable)
        .where(or(eq(plansTable.id, newPlanId), eq(plansTable.slug, newPlanId)))
        .limit(1);
      if (syncPlan && !hasSeatMapFeature((syncPlan.supportedFeatures ?? []) as string[])) {
        await db.update(tripsTable).set({ showSeatMap: true }).where(eq(tripsTable.tenantId, req.params.id));
      }
    }
    if (referralsEnabled !== undefined) {
      await db.update(referralSettingsTable)
        .set({ isEnabled: referralsEnabled ?? true })
        .where(eq(referralSettingsTable.tenantId, req.params.id));
    }
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, req.params.id)).limit(1);
    if (!tenant) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    if ("logoUrl" in parsed.data) {
      await deleteOrphanedFile(oldLogoUrl, parsed.data.logoUrl, req.log, req.params.id);
    }
    res.json(tenant);

    // Fire-and-forget status-change emails (after response so latency is not affected)
    if (isSuperadmin && typeof updateData.status === "string" && existing && updateData.status !== existing.status) {
      const newStatus = updateData.status;
      const tenantId = req.params.id;
      if (newStatus === "suspended") {
        enqueueAgencySuspendedEmail(tenantId, suspensionReason ?? null).catch((err) => {
          req.log.error({ err, tenantId }, "[tenants] failed to send agency-suspended email");
        });
      } else if (newStatus === "active" && existing.status === "suspended") {
        enqueueAgencyReactivatedEmail(tenantId).catch((err) => {
          req.log.error({ err, tenantId }, "[tenants] failed to send agency-reactivated email");
        });
      }
    }
  } catch (err) {
    next(err);
  }
});

// Full agency data backup — streams a single JSON file containing every
// tenant-scoped entity group (settings, users, clients, trips, reservations
// with embedded passengers, store products/coupons/orders with items,
// payments and expenses). Restricted to the agency's own admins (or
// superadmin) and always scoped to the caller's own tenantId. Large tables
// are paginated in batches so memory/response time stay bounded regardless
// of tenant size — mirrors the cursor pattern used by GET /trips/export.
//
// Must be declared before /tenants/:id so "backup" isn't captured as an id.
router.get("/tenants/backup/export", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Apenas administradores da agência podem exportar o backup", "FORBIDDEN_ROLE"));
      return;
    }
    if (!me.tenantId) {
      next(new ValidationError("Nenhuma agência associada a este usuário", "VALIDATION_ERROR"));
      return;
    }
    const tenantId = me.tenantId;

    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
    if (!tenant) { next(new NotFoundError("Agência não encontrada", "NOT_FOUND")); return; }

    res.status(200);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Disposition", `attachment; filename="backup-${tenant.slug}-${dateStr}.json"`);

    const meta = {
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
    };

    await writeExportChunk(
      res,
      `{"meta":${JSON.stringify(meta)},"tenant":${JSON.stringify(formatBackupTenant(tenant))}`,
    );

    // ── Users ────────────────────────────────────────────────────────────
    await writeExportChunk(res, ',"users":[');
    const usersCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(usersTable.createdAt, cursor.createdAt), and(eq(usersTable.createdAt, cursor.createdAt), gt(usersTable.id, cursor.id)))
          : undefined;
        return db.select().from(usersTable)
          .where(cursorCondition ? and(eq(usersTable.tenantId, tenantId), cursorCondition) : eq(usersTable.tenantId, tenantId))
          .orderBy(asc(usersTable.createdAt), asc(usersTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupUser,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Clients (with embedded notes, achievements, dream destinations and
    // favorites) ─────────────────────────────────────────────────────────
    // Child rows are batch-fetched per page of clients (inArray on the
    // batch's client ids), same pattern as reservation passengers/installments,
    // to avoid an N+1 query storm on large tenants.
    await writeExportChunk(res, ',"clients":[');
    let clientsCount = 0;
    {
      let cursor: { createdAt: Date; id: string } | undefined;
      while (true) {
        const cursorCondition = cursor
          ? or(gt(clientsTable.createdAt, cursor.createdAt), and(eq(clientsTable.createdAt, cursor.createdAt), gt(clientsTable.id, cursor.id)))
          : undefined;
        const batch = await db.select().from(clientsTable)
          .where(cursorCondition ? and(eq(clientsTable.tenantId, tenantId), cursorCondition) : eq(clientsTable.tenantId, tenantId))
          .orderBy(asc(clientsTable.createdAt), asc(clientsTable.id))
          .limit(BACKUP_BATCH_SIZE);
        if (batch.length === 0) break;

        const clientIds = batch.map((c) => c.id);
        const noteRows = clientIds.length > 0
          ? await db.select().from(notesTable).where(inArray(notesTable.clientId, clientIds))
          : [];
        const notesByClient = new Map<string, ReturnType<typeof formatBackupNote>[]>();
        for (const n of noteRows) {
          const list = notesByClient.get(n.clientId) ?? [];
          list.push(formatBackupNote(n));
          notesByClient.set(n.clientId, list);
        }

        const achievementRows = clientIds.length > 0
          ? await db.select().from(clientAchievementsTable).where(inArray(clientAchievementsTable.clientId, clientIds))
          : [];
        const achievementsByClient = new Map<string, ReturnType<typeof formatBackupClientAchievement>[]>();
        for (const a of achievementRows) {
          const list = achievementsByClient.get(a.clientId) ?? [];
          list.push(formatBackupClientAchievement(a));
          achievementsByClient.set(a.clientId, list);
        }

        const dreamDestinationRows = clientIds.length > 0
          ? await db.select().from(clientDreamDestinationsTable).where(inArray(clientDreamDestinationsTable.clientId, clientIds))
          : [];
        const dreamDestinationsByClient = new Map<string, ReturnType<typeof formatBackupClientDreamDestination>[]>();
        for (const d of dreamDestinationRows) {
          const list = dreamDestinationsByClient.get(d.clientId) ?? [];
          list.push(formatBackupClientDreamDestination(d));
          dreamDestinationsByClient.set(d.clientId, list);
        }

        const favoriteRows = clientIds.length > 0
          ? await db.select().from(clientFavoritesTable).where(inArray(clientFavoritesTable.clientId, clientIds))
          : [];
        const favoritesByClient = new Map<string, ReturnType<typeof formatBackupClientFavorite>[]>();
        for (const f of favoriteRows) {
          const list = favoritesByClient.get(f.clientId) ?? [];
          list.push(formatBackupClientFavorite(f));
          favoritesByClient.set(f.clientId, list);
        }

        const scoreRows = clientIds.length > 0
          ? await db.select().from(clientScoresTable).where(inArray(clientScoresTable.clientId, clientIds))
          : [];
        const scoreByClient = new Map<string, ReturnType<typeof formatBackupClientScore>>();
        for (const s of scoreRows) scoreByClient.set(s.clientId, formatBackupClientScore(s));

        for (const c of batch) {
          const formatted = {
            ...formatBackupClient(c),
            notes: notesByClient.get(c.id) ?? [],
            achievements: achievementsByClient.get(c.id) ?? [],
            dreamDestinationRecords: dreamDestinationsByClient.get(c.id) ?? [],
            favorites: favoritesByClient.get(c.id) ?? [],
            scores: scoreByClient.get(c.id) ?? null,
          };
          await writeExportChunk(res, `${clientsCount > 0 ? "," : ""}${JSON.stringify(formatted)}`);
          clientsCount++;
        }

        const last = batch[batch.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
        if (batch.length < BACKUP_BATCH_SIZE) break;
      }
    }
    await writeExportChunk(res, "]");

    // ── Trips (with embedded costs and media) ───────────────────────────
    // Costs/media are batch-fetched per page of trips (inArray on the
    // batch's trip ids), same N+1-avoidance pattern as reservation passengers.
    await writeExportChunk(res, ',"trips":[');
    let tripsCount = 0;
    {
      let cursor: { createdAt: Date; id: string } | undefined;
      while (true) {
        const cursorCondition = cursor
          ? or(gt(tripsTable.createdAt, cursor.createdAt), and(eq(tripsTable.createdAt, cursor.createdAt), gt(tripsTable.id, cursor.id)))
          : undefined;
        const batch = await db.select().from(tripsTable)
          .where(cursorCondition ? and(eq(tripsTable.tenantId, tenantId), cursorCondition) : eq(tripsTable.tenantId, tenantId))
          .orderBy(asc(tripsTable.createdAt), asc(tripsTable.id))
          .limit(BACKUP_BATCH_SIZE);
        if (batch.length === 0) break;

        const tripIds = batch.map((t) => t.id);
        const costRows = tripIds.length > 0
          ? await db.select().from(tripCostsTable).where(inArray(tripCostsTable.tripId, tripIds))
          : [];
        const costsByTrip = new Map<string, ReturnType<typeof formatBackupTripCost>[]>();
        for (const c of costRows) {
          const list = costsByTrip.get(c.tripId) ?? [];
          list.push(formatBackupTripCost(c));
          costsByTrip.set(c.tripId, list);
        }

        const mediaRows = tripIds.length > 0
          ? await db.select().from(tripMediaTable).where(inArray(tripMediaTable.tripId, tripIds))
          : [];
        const mediaByTrip = new Map<string, ReturnType<typeof formatBackupTripMedia>[]>();
        for (const m of mediaRows) {
          const list = mediaByTrip.get(m.tripId) ?? [];
          list.push(formatBackupTripMedia(m));
          mediaByTrip.set(m.tripId, list);
        }

        const checkinRows = tripIds.length > 0
          ? await db.select().from(tripCheckinsTable).where(inArray(tripCheckinsTable.tripId, tripIds))
          : [];
        const checkinsByTrip = new Map<string, ReturnType<typeof formatBackupTripCheckin>[]>();
        for (const c of checkinRows) {
          const list = checkinsByTrip.get(c.tripId) ?? [];
          list.push(formatBackupTripCheckin(c));
          checkinsByTrip.set(c.tripId, list);
        }

        for (const t of batch) {
          const formatted = {
            ...formatTrip(t),
            costs: costsByTrip.get(t.id) ?? [],
            media: mediaByTrip.get(t.id) ?? [],
            checkins: checkinsByTrip.get(t.id) ?? [],
          };
          await writeExportChunk(res, `${tripsCount > 0 ? "," : ""}${JSON.stringify(formatted)}`);
          tripsCount++;
        }

        const last = batch[batch.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
        if (batch.length < BACKUP_BATCH_SIZE) break;
      }
    }
    await writeExportChunk(res, "]");

    // ── Reservations (with embedded passengers + installments) ──────────
    // Passengers/installments are batch-fetched per reservation page
    // (inArray on the batch's reservation ids) instead of one query per
    // reservation, to avoid an N+1 query storm on large tenants.
    await writeExportChunk(res, ',"reservations":[');
    let reservationsCount = 0;
    {
      let cursor: { createdAt: Date; id: string } | undefined;
      while (true) {
        const cursorCondition = cursor
          ? or(gt(reservationsTable.createdAt, cursor.createdAt), and(eq(reservationsTable.createdAt, cursor.createdAt), gt(reservationsTable.id, cursor.id)))
          : undefined;
        const batch = await db.select().from(reservationsTable)
          .where(cursorCondition ? and(eq(reservationsTable.tenantId, tenantId), cursorCondition) : eq(reservationsTable.tenantId, tenantId))
          .orderBy(asc(reservationsTable.createdAt), asc(reservationsTable.id))
          .limit(BACKUP_BATCH_SIZE);
        if (batch.length === 0) break;

        const reservationIds = batch.map((r) => r.id);
        const passengerRows = reservationIds.length > 0
          ? await db.select().from(passengersTable).where(inArray(passengersTable.reservationId, reservationIds))
          : [];
        const passengersByReservation = new Map<string, ReturnType<typeof formatBackupPassenger>[]>();
        for (const p of passengerRows) {
          const list = passengersByReservation.get(p.reservationId) ?? [];
          list.push(formatBackupPassenger(p));
          passengersByReservation.set(p.reservationId, list);
        }

        const installmentRows = reservationIds.length > 0
          ? await db.select().from(reservationInstallmentsTable).where(inArray(reservationInstallmentsTable.reservationId, reservationIds))
          : [];
        const installmentsByReservation = new Map<string, ReturnType<typeof formatBackupReservationInstallment>[]>();
        for (const i of installmentRows) {
          const list = installmentsByReservation.get(i.reservationId) ?? [];
          list.push(formatBackupReservationInstallment(i));
          installmentsByReservation.set(i.reservationId, list);
        }

        for (const r of batch) {
          const formatted = formatBackupReservation(
            r,
            passengersByReservation.get(r.id) ?? [],
            installmentsByReservation.get(r.id) ?? [],
          );
          await writeExportChunk(res, `${reservationsCount > 0 ? "," : ""}${JSON.stringify(formatted)}`);
          reservationsCount++;
        }

        const last = batch[batch.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
        if (batch.length < BACKUP_BATCH_SIZE) break;
      }
    }
    await writeExportChunk(res, "]");

    // ── Vehicle layouts (referenced by trips.layoutId) ──────────────────
    await writeExportChunk(res, ',"vehicleLayouts":[');
    const vehicleLayoutsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(vehicleLayoutsTable.createdAt, cursor.createdAt), and(eq(vehicleLayoutsTable.createdAt, cursor.createdAt), gt(vehicleLayoutsTable.id, cursor.id)))
          : undefined;
        return db.select().from(vehicleLayoutsTable)
          .where(cursorCondition ? and(eq(vehicleLayoutsTable.tenantId, tenantId), cursorCondition) : eq(vehicleLayoutsTable.tenantId, tenantId))
          .orderBy(asc(vehicleLayoutsTable.createdAt), asc(vehicleLayoutsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupVehicleLayout,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Boarding locations (referenced by reservations/store orders) ───
    await writeExportChunk(res, ',"boardingLocations":[');
    const boardingLocationsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(boardingLocationsTable.createdAt, cursor.createdAt), and(eq(boardingLocationsTable.createdAt, cursor.createdAt), gt(boardingLocationsTable.id, cursor.id)))
          : undefined;
        return db.select().from(boardingLocationsTable)
          .where(cursorCondition ? and(eq(boardingLocationsTable.tenantId, tenantId), cursorCondition) : eq(boardingLocationsTable.tenantId, tenantId))
          .orderBy(asc(boardingLocationsTable.createdAt), asc(boardingLocationsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupBoardingLocation,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Vehicles (fleet registrations referenced by trips.vehicleId) ────
    await writeExportChunk(res, ',"vehicles":[');
    const vehiclesCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(vehiclesTable.createdAt, cursor.createdAt), and(eq(vehiclesTable.createdAt, cursor.createdAt), gt(vehiclesTable.id, cursor.id)))
          : undefined;
        return db.select().from(vehiclesTable)
          .where(cursorCondition ? and(eq(vehiclesTable.tenantId, tenantId), cursorCondition) : eq(vehiclesTable.tenantId, tenantId))
          .orderBy(asc(vehiclesTable.createdAt), asc(vehiclesTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupVehicle,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Store (info + categories + products + coupons + pages + reviews +
    // orders with items) ─────────────────────────────────────────────────
    const [store] = await db.select().from(storesTable).where(eq(storesTable.tenantId, tenantId)).limit(1);
    await writeExportChunk(
      res,
      `,"store":{"info":${store ? JSON.stringify(formatBackupStore(store)) : "null"}`,
    );

    // Categories precede products in the payload so a future importer can
    // resolve storeProducts.categoryId against an already-seen category.
    await writeExportChunk(res, ',"categories":[');
    const storeCategoriesCount = store
      ? await streamArraySection({
          res,
          fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
            const cursorCondition = cursor
              ? or(gt(storeCategoriesTable.createdAt, cursor.createdAt), and(eq(storeCategoriesTable.createdAt, cursor.createdAt), gt(storeCategoriesTable.id, cursor.id)))
              : undefined;
            return db.select().from(storeCategoriesTable)
              .where(cursorCondition ? and(eq(storeCategoriesTable.storeId, store.id), cursorCondition) : eq(storeCategoriesTable.storeId, store.id))
              .orderBy(asc(storeCategoriesTable.createdAt), asc(storeCategoriesTable.id))
              .limit(BACKUP_BATCH_SIZE);
          },
          getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
          formatRow: formatBackupStoreCategory,
          batchSize: BACKUP_BATCH_SIZE,
        })
      : 0;
    await writeExportChunk(res, "]");

    await writeExportChunk(res, ',"products":[');
    const storeProductsCount = store
      ? await streamArraySection({
          res,
          fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
            const cursorCondition = cursor
              ? or(gt(storeProductsTable.createdAt, cursor.createdAt), and(eq(storeProductsTable.createdAt, cursor.createdAt), gt(storeProductsTable.id, cursor.id)))
              : undefined;
            return db.select().from(storeProductsTable)
              .where(cursorCondition ? and(eq(storeProductsTable.storeId, store.id), cursorCondition) : eq(storeProductsTable.storeId, store.id))
              .orderBy(asc(storeProductsTable.createdAt), asc(storeProductsTable.id))
              .limit(BACKUP_BATCH_SIZE);
          },
          getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
          formatRow: formatBackupStoreProduct,
          batchSize: BACKUP_BATCH_SIZE,
        })
      : 0;
    await writeExportChunk(res, "]");

    await writeExportChunk(res, ',"coupons":[');
    const storeCouponsCount = store
      ? await streamArraySection({
          res,
          fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
            const cursorCondition = cursor
              ? or(gt(storeCouponsTable.createdAt, cursor.createdAt), and(eq(storeCouponsTable.createdAt, cursor.createdAt), gt(storeCouponsTable.id, cursor.id)))
              : undefined;
            return db.select().from(storeCouponsTable)
              .where(cursorCondition ? and(eq(storeCouponsTable.storeId, store.id), cursorCondition) : eq(storeCouponsTable.storeId, store.id))
              .orderBy(asc(storeCouponsTable.createdAt), asc(storeCouponsTable.id))
              .limit(BACKUP_BATCH_SIZE);
          },
          getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
          formatRow: formatBackupStoreCoupon,
          batchSize: BACKUP_BATCH_SIZE,
        })
      : 0;
    await writeExportChunk(res, "]");

    await writeExportChunk(res, ',"pages":[');
    const storePagesCount = store
      ? await streamArraySection({
          res,
          fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
            const cursorCondition = cursor
              ? or(gt(storePagesTable.createdAt, cursor.createdAt), and(eq(storePagesTable.createdAt, cursor.createdAt), gt(storePagesTable.id, cursor.id)))
              : undefined;
            return db.select().from(storePagesTable)
              .where(cursorCondition ? and(eq(storePagesTable.storeId, store.id), cursorCondition) : eq(storePagesTable.storeId, store.id))
              .orderBy(asc(storePagesTable.createdAt), asc(storePagesTable.id))
              .limit(BACKUP_BATCH_SIZE);
          },
          getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
          formatRow: formatBackupStorePage,
          batchSize: BACKUP_BATCH_SIZE,
        })
      : 0;
    await writeExportChunk(res, "]");

    await writeExportChunk(res, ',"reviews":[');
    const storeReviewsCount = store
      ? await streamArraySection({
          res,
          fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
            const cursorCondition = cursor
              ? or(gt(storeReviewsTable.createdAt, cursor.createdAt), and(eq(storeReviewsTable.createdAt, cursor.createdAt), gt(storeReviewsTable.id, cursor.id)))
              : undefined;
            return db.select().from(storeReviewsTable)
              .where(cursorCondition ? and(eq(storeReviewsTable.storeId, store.id), cursorCondition) : eq(storeReviewsTable.storeId, store.id))
              .orderBy(asc(storeReviewsTable.createdAt), asc(storeReviewsTable.id))
              .limit(BACKUP_BATCH_SIZE);
          },
          getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
          formatRow: formatBackupStoreReview,
          batchSize: BACKUP_BATCH_SIZE,
        })
      : 0;
    await writeExportChunk(res, "]");

    // Orders embed their items, batch-fetched the same way passengers are
    // for reservations above.
    await writeExportChunk(res, ',"orders":[');
    let storeOrdersCount = 0;
    {
      let cursor: { createdAt: Date; id: string } | undefined;
      while (true) {
        const cursorCondition = cursor
          ? or(gt(storeOrdersTable.createdAt, cursor.createdAt), and(eq(storeOrdersTable.createdAt, cursor.createdAt), gt(storeOrdersTable.id, cursor.id)))
          : undefined;
        const batch = await db.select().from(storeOrdersTable)
          .where(cursorCondition ? and(eq(storeOrdersTable.tenantId, tenantId), cursorCondition) : eq(storeOrdersTable.tenantId, tenantId))
          .orderBy(asc(storeOrdersTable.createdAt), asc(storeOrdersTable.id))
          .limit(BACKUP_BATCH_SIZE);
        if (batch.length === 0) break;

        const orderIds = batch.map((o) => o.id);
        const itemRows = orderIds.length > 0
          ? await db.select().from(storeOrderItemsTable).where(inArray(storeOrderItemsTable.orderId, orderIds))
          : [];
        const itemsByOrder = new Map<string, ReturnType<typeof formatBackupOrderItem>[]>();
        for (const i of itemRows) {
          const list = itemsByOrder.get(i.orderId) ?? [];
          list.push(formatBackupOrderItem(i));
          itemsByOrder.set(i.orderId, list);
        }

        for (const o of batch) {
          const formatted = formatBackupStoreOrder(o, itemsByOrder.get(o.id) ?? []);
          await writeExportChunk(res, `${storeOrdersCount > 0 ? "," : ""}${JSON.stringify(formatted)}`);
          storeOrdersCount++;
        }

        const last = batch[batch.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
        if (batch.length < BACKUP_BATCH_SIZE) break;
      }
    }
    await writeExportChunk(res, '],"priceAlerts":[');
    const priceAlertsCount = store
      ? await streamArraySection({
          res,
          fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
            const cursorCondition = cursor
              ? or(gt(priceAlertSubscriptionsTable.createdAt, cursor.createdAt), and(eq(priceAlertSubscriptionsTable.createdAt, cursor.createdAt), gt(priceAlertSubscriptionsTable.id, cursor.id)))
              : undefined;
            return db.select().from(priceAlertSubscriptionsTable)
              .where(cursorCondition ? and(eq(priceAlertSubscriptionsTable.storeId, store.id), cursorCondition) : eq(priceAlertSubscriptionsTable.storeId, store.id))
              .orderBy(asc(priceAlertSubscriptionsTable.createdAt), asc(priceAlertSubscriptionsTable.id))
              .limit(BACKUP_BATCH_SIZE);
          },
          getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
          formatRow: formatBackupPriceAlertSubscription,
          batchSize: BACKUP_BATCH_SIZE,
        })
      : 0;
    await writeExportChunk(res, "]}");

    // ── Commissions (rules + records) ───────────────────────────────────
    await writeExportChunk(res, ',"commissionRules":[');
    const commissionRulesCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(commissionRulesTable.createdAt, cursor.createdAt), and(eq(commissionRulesTable.createdAt, cursor.createdAt), gt(commissionRulesTable.id, cursor.id)))
          : undefined;
        return db.select().from(commissionRulesTable)
          .where(cursorCondition ? and(eq(commissionRulesTable.tenantId, tenantId), cursorCondition) : eq(commissionRulesTable.tenantId, tenantId))
          .orderBy(asc(commissionRulesTable.createdAt), asc(commissionRulesTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupCommissionRule,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, '],"commissions":[');
    const commissionsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(commissionsTable.createdAt, cursor.createdAt), and(eq(commissionsTable.createdAt, cursor.createdAt), gt(commissionsTable.id, cursor.id)))
          : undefined;
        return db.select().from(commissionsTable)
          .where(cursorCondition ? and(eq(commissionsTable.tenantId, tenantId), cursorCondition) : eq(commissionsTable.tenantId, tenantId))
          .orderBy(asc(commissionsTable.createdAt), asc(commissionsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupCommission,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Pipeline (configuration: pipelines + stages; live records: deals) ─
    await writeExportChunk(res, ',"pipeline":{"pipelines":[');
    const pipelinesCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(pipelinesTable.createdAt, cursor.createdAt), and(eq(pipelinesTable.createdAt, cursor.createdAt), gt(pipelinesTable.id, cursor.id)))
          : undefined;
        return db.select().from(pipelinesTable)
          .where(cursorCondition ? and(eq(pipelinesTable.tenantId, tenantId), cursorCondition) : eq(pipelinesTable.tenantId, tenantId))
          .orderBy(asc(pipelinesTable.createdAt), asc(pipelinesTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupPipeline,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, '],"stages":[');
    const pipelineStagesCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(pipelineStagesTable.createdAt, cursor.createdAt), and(eq(pipelineStagesTable.createdAt, cursor.createdAt), gt(pipelineStagesTable.id, cursor.id)))
          : undefined;
        return db.select().from(pipelineStagesTable)
          .where(cursorCondition ? and(eq(pipelineStagesTable.tenantId, tenantId), cursorCondition) : eq(pipelineStagesTable.tenantId, tenantId))
          .orderBy(asc(pipelineStagesTable.createdAt), asc(pipelineStagesTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupPipelineStage,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, '],"deals":[');
    const dealsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(dealsTable.createdAt, cursor.createdAt), and(eq(dealsTable.createdAt, cursor.createdAt), gt(dealsTable.id, cursor.id)))
          : undefined;
        return db.select().from(dealsTable)
          .where(cursorCondition ? and(eq(dealsTable.tenantId, tenantId), cursorCondition) : eq(dealsTable.tenantId, tenantId))
          .orderBy(asc(dealsTable.createdAt), asc(dealsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupDeal,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]}");

    // ── Loyalty (programs + members + transactions) ─────────────────────
    await writeExportChunk(res, ',"loyalty":{"programs":[');
    const loyaltyProgramsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(loyaltyProgramsTable.createdAt, cursor.createdAt), and(eq(loyaltyProgramsTable.createdAt, cursor.createdAt), gt(loyaltyProgramsTable.id, cursor.id)))
          : undefined;
        return db.select().from(loyaltyProgramsTable)
          .where(cursorCondition ? and(eq(loyaltyProgramsTable.tenantId, tenantId), cursorCondition) : eq(loyaltyProgramsTable.tenantId, tenantId))
          .orderBy(asc(loyaltyProgramsTable.createdAt), asc(loyaltyProgramsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupLoyaltyProgram,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, '],"members":[');
    const loyaltyMembersCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { joinedAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(loyaltyMembersTable.joinedAt, cursor.joinedAt), and(eq(loyaltyMembersTable.joinedAt, cursor.joinedAt), gt(loyaltyMembersTable.id, cursor.id)))
          : undefined;
        return db.select().from(loyaltyMembersTable)
          .where(cursorCondition ? and(eq(loyaltyMembersTable.tenantId, tenantId), cursorCondition) : eq(loyaltyMembersTable.tenantId, tenantId))
          .orderBy(asc(loyaltyMembersTable.joinedAt), asc(loyaltyMembersTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ joinedAt: row.joinedAt, id: row.id }),
      formatRow: formatBackupLoyaltyMember,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, '],"transactions":[');
    const loyaltyTransactionsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(loyaltyTransactionsTable.createdAt, cursor.createdAt), and(eq(loyaltyTransactionsTable.createdAt, cursor.createdAt), gt(loyaltyTransactionsTable.id, cursor.id)))
          : undefined;
        return db.select().from(loyaltyTransactionsTable)
          .where(cursorCondition ? and(eq(loyaltyTransactionsTable.tenantId, tenantId), cursorCondition) : eq(loyaltyTransactionsTable.tenantId, tenantId))
          .orderBy(asc(loyaltyTransactionsTable.createdAt), asc(loyaltyTransactionsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupLoyaltyTransaction,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]}");

    // ── Referrals (agency settings + campaigns + records + commissions) ─
    const [referralSettingsRow] = await db.select().from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, tenantId)).limit(1);
    await writeExportChunk(
      res,
      `,"referrals":{"settings":${referralSettingsRow ? JSON.stringify(formatBackupReferralSettings(referralSettingsRow)) : "null"},"campaigns":[`,
    );
    const referralCampaignsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(referralCampaignsTable.createdAt, cursor.createdAt), and(eq(referralCampaignsTable.createdAt, cursor.createdAt), gt(referralCampaignsTable.id, cursor.id)))
          : undefined;
        return db.select().from(referralCampaignsTable)
          .where(cursorCondition ? and(eq(referralCampaignsTable.tenantId, tenantId), cursorCondition) : eq(referralCampaignsTable.tenantId, tenantId))
          .orderBy(asc(referralCampaignsTable.createdAt), asc(referralCampaignsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupReferralCampaign,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, '],"records":[');
    const referralsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(referralsTable.createdAt, cursor.createdAt), and(eq(referralsTable.createdAt, cursor.createdAt), gt(referralsTable.id, cursor.id)))
          : undefined;
        return db.select().from(referralsTable)
          .where(cursorCondition ? and(eq(referralsTable.tenantId, tenantId), cursorCondition) : eq(referralsTable.tenantId, tenantId))
          .orderBy(asc(referralsTable.createdAt), asc(referralsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupReferral,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, '],"commissions":[');
    const referralCommissionsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(referralCommissionsTable.createdAt, cursor.createdAt), and(eq(referralCommissionsTable.createdAt, cursor.createdAt), gt(referralCommissionsTable.id, cursor.id)))
          : undefined;
        return db.select().from(referralCommissionsTable)
          .where(cursorCondition ? and(eq(referralCommissionsTable.tenantId, tenantId), cursorCondition) : eq(referralCommissionsTable.tenantId, tenantId))
          .orderBy(asc(referralCommissionsTable.createdAt), asc(referralCommissionsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupReferralCommission,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]}");

    // ── Payments ─────────────────────────────────────────────────────────
    await writeExportChunk(res, ',"payments":[');
    const paymentsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(paymentsTable.createdAt, cursor.createdAt), and(eq(paymentsTable.createdAt, cursor.createdAt), gt(paymentsTable.id, cursor.id)))
          : undefined;
        return db.select().from(paymentsTable)
          .where(cursorCondition ? and(eq(paymentsTable.tenantId, tenantId), cursorCondition) : eq(paymentsTable.tenantId, tenantId))
          .orderBy(asc(paymentsTable.createdAt), asc(paymentsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupPayment,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Expenses ─────────────────────────────────────────────────────────
    await writeExportChunk(res, ',"expenses":[');
    const expensesCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(expensesTable.createdAt, cursor.createdAt), and(eq(expensesTable.createdAt, cursor.createdAt), gt(expensesTable.id, cursor.id)))
          : undefined;
        return db.select().from(expensesTable)
          .where(cursorCondition ? and(eq(expensesTable.tenantId, tenantId), cursorCondition) : eq(expensesTable.tenantId, tenantId))
          .orderBy(asc(expensesTable.createdAt), asc(expensesTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupExpense,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Sales goals ──────────────────────────────────────────────────────
    await writeExportChunk(res, ',"salesGoals":[');
    const salesGoalsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(salesGoalsTable.createdAt, cursor.createdAt), and(eq(salesGoalsTable.createdAt, cursor.createdAt), gt(salesGoalsTable.id, cursor.id)))
          : undefined;
        return db.select().from(salesGoalsTable)
          .where(cursorCondition ? and(eq(salesGoalsTable.tenantId, tenantId), cursorCondition) : eq(salesGoalsTable.tenantId, tenantId))
          .orderBy(asc(salesGoalsTable.createdAt), asc(salesGoalsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupSalesGoal,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Coupons (agency-wide client coupons, distinct from store coupons) ─
    await writeExportChunk(res, ',"agencyCoupons":[');
    const agencyCouponsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(couponsTable.createdAt, cursor.createdAt), and(eq(couponsTable.createdAt, cursor.createdAt), gt(couponsTable.id, cursor.id)))
          : undefined;
        return db.select().from(couponsTable)
          .where(cursorCondition ? and(eq(couponsTable.tenantId, tenantId), cursorCondition) : eq(couponsTable.tenantId, tenantId))
          .orderBy(asc(couponsTable.createdAt), asc(couponsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupCoupon,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Documents (uploaded files attached to any tenant record) ────────
    await writeExportChunk(res, ',"documents":[');
    const documentsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(documentsTable.createdAt, cursor.createdAt), and(eq(documentsTable.createdAt, cursor.createdAt), gt(documentsTable.id, cursor.id)))
          : undefined;
        return db.select().from(documentsTable)
          .where(cursorCondition ? and(eq(documentsTable.tenantId, tenantId), cursorCondition) : eq(documentsTable.tenantId, tenantId))
          .orderBy(asc(documentsTable.createdAt), asc(documentsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupDocument,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Message templates ────────────────────────────────────────────────
    await writeExportChunk(res, ',"messageTemplates":[');
    const messageTemplatesCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(messageTemplatesTable.createdAt, cursor.createdAt), and(eq(messageTemplatesTable.createdAt, cursor.createdAt), gt(messageTemplatesTable.id, cursor.id)))
          : undefined;
        return db.select().from(messageTemplatesTable)
          .where(cursorCondition ? and(eq(messageTemplatesTable.tenantId, tenantId), cursorCondition) : eq(messageTemplatesTable.tenantId, tenantId))
          .orderBy(asc(messageTemplatesTable.createdAt), asc(messageTemplatesTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupMessageTemplate,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Automations (with embedded actions) ──────────────────────────────
    // Execution logs (automation_logs) are intentionally excluded — see
    // formatBackupAutomation's doc comment.
    await writeExportChunk(res, ',"automations":[');
    let automationsCount = 0;
    {
      let cursor: { createdAt: Date; id: string } | undefined;
      while (true) {
        const cursorCondition = cursor
          ? or(gt(automationsTable.createdAt, cursor.createdAt), and(eq(automationsTable.createdAt, cursor.createdAt), gt(automationsTable.id, cursor.id)))
          : undefined;
        const batch = await db.select().from(automationsTable)
          .where(cursorCondition ? and(eq(automationsTable.tenantId, tenantId), cursorCondition) : eq(automationsTable.tenantId, tenantId))
          .orderBy(asc(automationsTable.createdAt), asc(automationsTable.id))
          .limit(BACKUP_BATCH_SIZE);
        if (batch.length === 0) break;

        const automationIds = batch.map((a) => a.id);
        const actionRows = automationIds.length > 0
          ? await db.select().from(automationActionsTable).where(inArray(automationActionsTable.automationId, automationIds))
          : [];
        const actionsByAutomation = new Map<string, ReturnType<typeof formatBackupAutomationAction>[]>();
        for (const a of actionRows) {
          const list = actionsByAutomation.get(a.automationId) ?? [];
          list.push(formatBackupAutomationAction(a));
          actionsByAutomation.set(a.automationId, list);
        }

        for (const a of batch) {
          const formatted = formatBackupAutomation(a, actionsByAutomation.get(a.id) ?? []);
          await writeExportChunk(res, `${automationsCount > 0 ? "," : ""}${JSON.stringify(formatted)}`);
          automationsCount++;
        }

        const last = batch[batch.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
        if (batch.length < BACKUP_BATCH_SIZE) break;
      }
    }
    await writeExportChunk(res, "]");

    // ── Suppliers (referenced by trip costs' and expenses' supplierId) ──
    await writeExportChunk(res, ',"suppliers":[');
    const suppliersCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(suppliersTable.createdAt, cursor.createdAt), and(eq(suppliersTable.createdAt, cursor.createdAt), gt(suppliersTable.id, cursor.id)))
          : undefined;
        return db.select().from(suppliersTable)
          .where(cursorCondition ? and(eq(suppliersTable.tenantId, tenantId), cursorCondition) : eq(suppliersTable.tenantId, tenantId))
          .orderBy(asc(suppliersTable.createdAt), asc(suppliersTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupSupplier,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Accommodations (registration/planning data) ─────────────────────
    await writeExportChunk(res, ',"accommodations":[');
    const accommodationsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(accommodationsTable.createdAt, cursor.createdAt), and(eq(accommodationsTable.createdAt, cursor.createdAt), gt(accommodationsTable.id, cursor.id)))
          : undefined;
        return db.select().from(accommodationsTable)
          .where(cursorCondition ? and(eq(accommodationsTable.tenantId, tenantId), cursorCondition) : eq(accommodationsTable.tenantId, tenantId))
          .orderBy(asc(accommodationsTable.createdAt), asc(accommodationsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupAccommodation,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Destinations (registration/planning data) ───────────────────────
    await writeExportChunk(res, ',"destinations":[');
    const destinationsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(destinationsTable.createdAt, cursor.createdAt), and(eq(destinationsTable.createdAt, cursor.createdAt), gt(destinationsTable.id, cursor.id)))
          : undefined;
        return db.select().from(destinationsTable)
          .where(cursorCondition ? and(eq(destinationsTable.tenantId, tenantId), cursorCondition) : eq(destinationsTable.tenantId, tenantId))
          .orderBy(asc(destinationsTable.createdAt), asc(destinationsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupDestination,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Club (config + tier benefits) ───────────────────────────────────
    const [clubConfig] = await db.select().from(clubConfigTable).where(eq(clubConfigTable.tenantId, tenantId)).limit(1);
    await writeExportChunk(
      res,
      `,"club":{"config":${clubConfig ? JSON.stringify(formatBackupClubConfig(clubConfig)) : "null"}`,
    );
    await writeExportChunk(res, ',"benefits":[');
    const clubBenefitsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(clubBenefitsTable.createdAt, cursor.createdAt), and(eq(clubBenefitsTable.createdAt, cursor.createdAt), gt(clubBenefitsTable.id, cursor.id)))
          : undefined;
        return db.select().from(clubBenefitsTable)
          .where(cursorCondition ? and(eq(clubBenefitsTable.tenantId, tenantId), cursorCondition) : eq(clubBenefitsTable.tenantId, tenantId))
          .orderBy(asc(clubBenefitsTable.createdAt), asc(clubBenefitsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupClubBenefit,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]}");

    // ── Settlements (immutable per-order-item snapshots + append-only
    // financial ledger) — resolves sellerId/settlementItemId references
    // from store order items and the ledger itself. ───────────────────────
    await writeExportChunk(res, ',"settlements":{"items":[');
    const settlementItemsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(settlementItemsTable.createdAt, cursor.createdAt), and(eq(settlementItemsTable.createdAt, cursor.createdAt), gt(settlementItemsTable.id, cursor.id)))
          : undefined;
        return db.select().from(settlementItemsTable)
          .where(cursorCondition ? and(eq(settlementItemsTable.tenantId, tenantId), cursorCondition) : eq(settlementItemsTable.tenantId, tenantId))
          .orderBy(asc(settlementItemsTable.createdAt), asc(settlementItemsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupSettlementItem,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, '],"ledgerEntries":[');
    const financialLedgerEntriesCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(financialLedgerEntriesTable.createdAt, cursor.createdAt), and(eq(financialLedgerEntriesTable.createdAt, cursor.createdAt), gt(financialLedgerEntriesTable.id, cursor.id)))
          : undefined;
        return db.select().from(financialLedgerEntriesTable)
          .where(cursorCondition ? and(eq(financialLedgerEntriesTable.tenantId, tenantId), cursorCondition) : eq(financialLedgerEntriesTable.tenantId, tenantId))
          .orderBy(asc(financialLedgerEntriesTable.createdAt), asc(financialLedgerEntriesTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupFinancialLedgerEntry,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]}");

    // ── Partners (marketplace partners, with embedded products+availability
    // and commissions) — resolves storeOrderItems.partnerId/partnerProductId
    // and settlementItems.sellerId (when sellerType="partner"). ──────────
    await writeExportChunk(res, ',"partners":[');
    let partnersCount = 0;
    {
      let cursor: { createdAt: Date; id: string } | undefined;
      while (true) {
        const cursorCondition = cursor
          ? or(gt(partnersTable.createdAt, cursor.createdAt), and(eq(partnersTable.createdAt, cursor.createdAt), gt(partnersTable.id, cursor.id)))
          : undefined;
        const batch = await db.select().from(partnersTable)
          .where(cursorCondition ? and(eq(partnersTable.tenantId, tenantId), cursorCondition) : eq(partnersTable.tenantId, tenantId))
          .orderBy(asc(partnersTable.createdAt), asc(partnersTable.id))
          .limit(BACKUP_BATCH_SIZE);
        if (batch.length === 0) break;

        const partnerIds = batch.map((p) => p.id);
        const productRows = partnerIds.length > 0
          ? await db.select().from(partnerProductsTable).where(inArray(partnerProductsTable.partnerId, partnerIds))
          : [];
        const productIds = productRows.map((p) => p.id);
        const availabilityRows = productIds.length > 0
          ? await db.select().from(partnerAvailabilityTable).where(inArray(partnerAvailabilityTable.productId, productIds))
          : [];
        const availabilityByProduct = new Map<string, ReturnType<typeof formatBackupPartnerAvailability>[]>();
        for (const a of availabilityRows) {
          const list = availabilityByProduct.get(a.productId) ?? [];
          list.push(formatBackupPartnerAvailability(a));
          availabilityByProduct.set(a.productId, list);
        }
        const productsByPartner = new Map<string, ReturnType<typeof formatBackupPartnerProduct>[]>();
        for (const p of productRows) {
          const list = productsByPartner.get(p.partnerId) ?? [];
          list.push(formatBackupPartnerProduct(p, availabilityByProduct.get(p.id) ?? []));
          productsByPartner.set(p.partnerId, list);
        }

        const commissionRows = partnerIds.length > 0
          ? await db.select().from(partnerCommissionsTable).where(inArray(partnerCommissionsTable.partnerId, partnerIds))
          : [];
        const commissionsByPartner = new Map<string, ReturnType<typeof formatBackupPartnerCommission>[]>();
        for (const c of commissionRows) {
          const list = commissionsByPartner.get(c.partnerId) ?? [];
          list.push(formatBackupPartnerCommission(c));
          commissionsByPartner.set(c.partnerId, list);
        }

        for (const p of batch) {
          const formatted = formatBackupPartner(
            p,
            productsByPartner.get(p.id) ?? [],
            commissionsByPartner.get(p.id) ?? [],
          );
          await writeExportChunk(res, `${partnersCount > 0 ? "," : ""}${JSON.stringify(formatted)}`);
          partnersCount++;
        }

        const last = batch[batch.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
        if (batch.length < BACKUP_BATCH_SIZE) break;
      }
    }
    await writeExportChunk(res, "]");

    // ── Campaigns (email/WhatsApp blasts; excludes the per-recipient send log) ─
    await writeExportChunk(res, ',"campaigns":[');
    const campaignsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(campaignsTable.createdAt, cursor.createdAt), and(eq(campaignsTable.createdAt, cursor.createdAt), gt(campaignsTable.id, cursor.id)))
          : undefined;
        return db.select().from(campaignsTable)
          .where(cursorCondition ? and(eq(campaignsTable.tenantId, tenantId), cursorCondition) : eq(campaignsTable.tenantId, tenantId))
          .orderBy(asc(campaignsTable.createdAt), asc(campaignsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupCampaign,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Calendar events (Google Calendar sync mirror) ────────────────────
    await writeExportChunk(res, ',"calendarEvents":[');
    const calendarEventsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(calendarEventsTable.createdAt, cursor.createdAt), and(eq(calendarEventsTable.createdAt, cursor.createdAt), gt(calendarEventsTable.id, cursor.id)))
          : undefined;
        return db.select().from(calendarEventsTable)
          .where(cursorCondition ? and(eq(calendarEventsTable.tenantId, tenantId), cursorCondition) : eq(calendarEventsTable.tenantId, tenantId))
          .orderBy(asc(calendarEventsTable.createdAt), asc(calendarEventsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupCalendarEvent,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    // ── Marketing module's parallel catalog + orders (categories, products
    // with embedded images, orders with embedded items) — distinct dataset
    // from the storefront's store.products/store.orders above. ───────────
    await writeExportChunk(res, ',"marketing":{"productCategories":[');
    const productCategoriesCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(productCategoriesTable.createdAt, cursor.createdAt), and(eq(productCategoriesTable.createdAt, cursor.createdAt), gt(productCategoriesTable.id, cursor.id)))
          : undefined;
        return db.select().from(productCategoriesTable)
          .where(cursorCondition ? and(eq(productCategoriesTable.tenantId, tenantId), cursorCondition) : eq(productCategoriesTable.tenantId, tenantId))
          .orderBy(asc(productCategoriesTable.createdAt), asc(productCategoriesTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupProductCategory,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, '],"products":[');
    let marketingProductsCount = 0;
    {
      let cursor: { createdAt: Date; id: string } | undefined;
      while (true) {
        const cursorCondition = cursor
          ? or(gt(productsTable.createdAt, cursor.createdAt), and(eq(productsTable.createdAt, cursor.createdAt), gt(productsTable.id, cursor.id)))
          : undefined;
        const batch = await db.select().from(productsTable)
          .where(cursorCondition ? and(eq(productsTable.tenantId, tenantId), cursorCondition) : eq(productsTable.tenantId, tenantId))
          .orderBy(asc(productsTable.createdAt), asc(productsTable.id))
          .limit(BACKUP_BATCH_SIZE);
        if (batch.length === 0) break;

        const productIds = batch.map((p) => p.id);
        const imageRows = productIds.length > 0
          ? await db.select().from(productImagesTable).where(inArray(productImagesTable.productId, productIds))
          : [];
        const imagesByProduct = new Map<string, ReturnType<typeof formatBackupProductImage>[]>();
        for (const i of imageRows) {
          const list = imagesByProduct.get(i.productId) ?? [];
          list.push(formatBackupProductImage(i));
          imagesByProduct.set(i.productId, list);
        }

        for (const p of batch) {
          const formatted = formatBackupMarketingProduct(p, imagesByProduct.get(p.id) ?? []);
          await writeExportChunk(res, `${marketingProductsCount > 0 ? "," : ""}${JSON.stringify(formatted)}`);
          marketingProductsCount++;
        }

        const last = batch[batch.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
        if (batch.length < BACKUP_BATCH_SIZE) break;
      }
    }
    await writeExportChunk(res, '],"orders":[');
    let marketingOrdersCount = 0;
    {
      let cursor: { createdAt: Date; id: string } | undefined;
      while (true) {
        const cursorCondition = cursor
          ? or(gt(ordersTable.createdAt, cursor.createdAt), and(eq(ordersTable.createdAt, cursor.createdAt), gt(ordersTable.id, cursor.id)))
          : undefined;
        const batch = await db.select().from(ordersTable)
          .where(cursorCondition ? and(eq(ordersTable.tenantId, tenantId), cursorCondition) : eq(ordersTable.tenantId, tenantId))
          .orderBy(asc(ordersTable.createdAt), asc(ordersTable.id))
          .limit(BACKUP_BATCH_SIZE);
        if (batch.length === 0) break;

        const orderIds = batch.map((o) => o.id);
        const itemRows = orderIds.length > 0
          ? await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds))
          : [];
        const itemsByOrder = new Map<string, ReturnType<typeof formatBackupMarketingOrderItem>[]>();
        for (const i of itemRows) {
          const list = itemsByOrder.get(i.orderId) ?? [];
          list.push(formatBackupMarketingOrderItem(i));
          itemsByOrder.set(i.orderId, list);
        }

        for (const o of batch) {
          const formatted = formatBackupMarketingOrder(o, itemsByOrder.get(o.id) ?? []);
          await writeExportChunk(res, `${marketingOrdersCount > 0 ? "," : ""}${JSON.stringify(formatted)}`);
          marketingOrdersCount++;
        }

        const last = batch[batch.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
        if (batch.length < BACKUP_BATCH_SIZE) break;
      }
    }
    await writeExportChunk(res, "]}");

    // ── NPS: e-commerce order feedback + client trip-survey responses/invites ─
    await writeExportChunk(res, ',"npsResponses":[');
    const npsResponsesCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(npsResponsesTable.createdAt, cursor.createdAt), and(eq(npsResponsesTable.createdAt, cursor.createdAt), gt(npsResponsesTable.id, cursor.id)))
          : undefined;
        return db.select().from(npsResponsesTable)
          .where(cursorCondition ? and(eq(npsResponsesTable.tenantId, tenantId), cursorCondition) : eq(npsResponsesTable.tenantId, tenantId))
          .orderBy(asc(npsResponsesTable.createdAt), asc(npsResponsesTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupNpsResponse,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, '],"clientNps":{"responses":[');
    const clientNpsResponsesCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(clientNpsResponsesTable.createdAt, cursor.createdAt), and(eq(clientNpsResponsesTable.createdAt, cursor.createdAt), gt(clientNpsResponsesTable.id, cursor.id)))
          : undefined;
        return db.select().from(clientNpsResponsesTable)
          .where(cursorCondition ? and(eq(clientNpsResponsesTable.tenantId, tenantId), cursorCondition) : eq(clientNpsResponsesTable.tenantId, tenantId))
          .orderBy(asc(clientNpsResponsesTable.createdAt), asc(clientNpsResponsesTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupClientNpsResponse,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, '],"invitations":[');
    const npsInvitationsCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { invitedAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(npsInvitationsTable.invitedAt, cursor.invitedAt), and(eq(npsInvitationsTable.invitedAt, cursor.invitedAt), gt(npsInvitationsTable.id, cursor.id)))
          : undefined;
        return db.select().from(npsInvitationsTable)
          .where(cursorCondition ? and(eq(npsInvitationsTable.tenantId, tenantId), cursorCondition) : eq(npsInvitationsTable.tenantId, tenantId))
          .orderBy(asc(npsInvitationsTable.invitedAt), asc(npsInvitationsTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ invitedAt: row.invitedAt, id: row.id }),
      formatRow: formatBackupNpsInvitation,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]}");

    // ── Pending team invites (token stripped — see formatBackupInvite) ───
    await writeExportChunk(res, ',"invites":[');
    const invitesCount = await streamArraySection({
      res,
      fetchBatch: (cursor: { createdAt: Date; id: string } | undefined) => {
        const cursorCondition = cursor
          ? or(gt(invitesTable.createdAt, cursor.createdAt), and(eq(invitesTable.createdAt, cursor.createdAt), gt(invitesTable.id, cursor.id)))
          : undefined;
        return db.select().from(invitesTable)
          .where(cursorCondition ? and(eq(invitesTable.tenantId, tenantId), cursorCondition) : eq(invitesTable.tenantId, tenantId))
          .orderBy(asc(invitesTable.createdAt), asc(invitesTable.id))
          .limit(BACKUP_BATCH_SIZE);
      },
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      formatRow: formatBackupInvite,
      batchSize: BACKUP_BATCH_SIZE,
    });
    await writeExportChunk(res, "]");

    const counts = {
      users: usersCount,
      clients: clientsCount,
      trips: tripsCount,
      reservations: reservationsCount,
      vehicles: vehiclesCount,
      vehicleLayouts: vehicleLayoutsCount,
      boardingLocations: boardingLocationsCount,
      storeCategories: storeCategoriesCount,
      storeProducts: storeProductsCount,
      storeCoupons: storeCouponsCount,
      storePages: storePagesCount,
      storeReviews: storeReviewsCount,
      storeOrders: storeOrdersCount,
      commissionRules: commissionRulesCount,
      commissions: commissionsCount,
      pipelines: pipelinesCount,
      pipelineStages: pipelineStagesCount,
      deals: dealsCount,
      loyaltyPrograms: loyaltyProgramsCount,
      loyaltyMembers: loyaltyMembersCount,
      loyaltyTransactions: loyaltyTransactionsCount,
      referralCampaigns: referralCampaignsCount,
      referrals: referralsCount,
      referralCommissions: referralCommissionsCount,
      payments: paymentsCount,
      expenses: expensesCount,
      salesGoals: salesGoalsCount,
      agencyCoupons: agencyCouponsCount,
      documents: documentsCount,
      messageTemplates: messageTemplatesCount,
      automations: automationsCount,
      suppliers: suppliersCount,
      accommodations: accommodationsCount,
      destinations: destinationsCount,
      clubBenefits: clubBenefitsCount,
      settlementItems: settlementItemsCount,
      financialLedgerEntries: financialLedgerEntriesCount,
      partners: partnersCount,
      priceAlerts: priceAlertsCount,
      campaigns: campaignsCount,
      calendarEvents: calendarEventsCount,
      productCategories: productCategoriesCount,
      marketingProducts: marketingProductsCount,
      marketingOrders: marketingOrdersCount,
      npsResponses: npsResponsesCount,
      clientNpsResponses: clientNpsResponsesCount,
      npsInvitations: npsInvitationsCount,
      invites: invitesCount,
    };
    res.end(`,"counts":${JSON.stringify(counts)}}`);
  } catch (err) {
    next(err);
  }
});

export default router;

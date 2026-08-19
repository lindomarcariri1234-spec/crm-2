import { Router, type NextFunction } from "express";
import { db, tenantsTable, usersTable, plansTable, referralSettingsTable, tripsTable } from "@workspace/db";
import { eq, desc, count, or } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { deleteOrphanedFile } from "../lib/uploadthing";
import { ROLES } from "@workspace/permissions";
import { enqueueAgencySuspendedEmail, enqueueAgencyReactivatedEmail } from "../queues/email-helpers";
import { canEnableFeature, getFeatureLabel, getFeatureRequiredPlanLabel, hasSeatMapFeature } from "../lib/plan-features";

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

export default router;

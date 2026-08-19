import { Router, type NextFunction } from "express";
import { db, tenantsTable, usersTable, auditLogsTable, plansTable, invoicesTable, featureFlagsTable, storesTable, storeProductsTable, storeCategoriesTable, storeOrderItemsTable, storeReviewsTable, tripsTable, productCategoriesTable, productImagesTable, vehiclesTable, accommodationsTable, destinationsTable, clientsTable, documentsTable, storeOrdersTable, referralsTable } from "@workspace/db";
import { eq, desc, asc, count, sql, and, gte, lte, ne, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { getAuth } from "@clerk/express";
import { utapi, extractVerifiedUploadThingKey, deleteOrphanedFile } from "../lib/uploadthing";
import { collectReferencedUploadThingKeys } from "../lib/collectReferencedUploadThingKeys";
import { ROLES, PAYMENT_STATUS, REFERRAL_STATUS, STORE_PAYMENT_STATUS } from "@workspace/permissions";
import { randomUUID } from "node:crypto";
import { getStripeSecretKey } from "../lib/stripeClient";
import Stripe from "stripe";

const router = Router();

const CreateClientDocumentBody = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

const SuspendTenantBody = z.object({
  reason: z.string().optional(),
});

function requireSuperAdmin(role: string, res: import("express").Response, next: import("express").NextFunction): boolean {
  if (role !== ROLES.SUPER_ADMIN) {
    next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
    return false;
  }
  return true;
}

// ─── PLANS CRUD ──────────────────────────────────────────────────────────────

const PlanBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  priceMonthly: z.string().optional(),
  priceYearly: z.string().optional(),
  maxUsers: z.number().int().optional(),
  maxClients: z.number().int().optional(),
  maxTrips: z.number().int().optional(),
  features: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

router.get("/admin/plans", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const plans = await db.select().from(plansTable).orderBy(asc(plansTable.sortOrder), asc(plansTable.createdAt));
    // For each plan, count tenants
    const tenantCounts = await db
      .select({ planId: tenantsTable.planId, cnt: count(tenantsTable.id) })
      .from(tenantsTable)
      .groupBy(tenantsTable.planId);
    const cmap: Record<string, number> = {};
    for (const r of tenantCounts) cmap[r.planId] = r.cnt;
    res.json(plans.map(p => ({ ...p, tenantCount: cmap[p.slug] ?? cmap[p.id] ?? 0 })));
  } catch (err) {
    next(err);
  }
});

router.post("/admin/plans", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const parsed = PlanBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(plansTable).values({ id, ...parsed.data });
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, id)).limit(1);
    res.status(201).json(plan);
  } catch (err) {
    next(err);
  }
});

router.patch("/admin/plans/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const parsed = PlanBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    await db.update(plansTable).set(parsed.data).where(eq(plansTable.id, req.params.id));
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, req.params.id)).limit(1);
    if (!plan) { next(new NotFoundError("Plan not found", "NOT_FOUND")); return; }
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.delete("/admin/plans/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    await db.delete(plansTable).where(eq(plansTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── PLANS STRIPE HEALTH ──────────────────────────────────────────────────────

router.get("/admin/plans/stripe-health", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;

    const secretKey = await getStripeSecretKey();
    if (!secretKey) {
      res.json({ stripeConfigured: false, plans: [] });
      return;
    }

    const stripe = new Stripe(secretKey, {
      apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
    });

    const plans = await db.select().from(plansTable).orderBy(asc(plansTable.sortOrder), asc(plansTable.createdAt));

    const results = await Promise.all(
      plans.map(async (plan) => {
        const monthlyPriceCents = Math.round(Number(plan.monthlyPrice) * 100);
        const annualPriceCents = Math.round(Number(plan.annualPrice) * 100);

        const needsMonthly = monthlyPriceCents > 0;
        const needsAnnual = annualPriceCents > 0;

        if (!needsMonthly && !needsAnnual) {
          return {
            planId: plan.id,
            slug: plan.slug,
            name: plan.name,
            isActive: plan.isActive,
            monthlyOk: true,
            annualOk: true,
            isFree: true,
          };
        }

        let stripePrices: Stripe.Price[] = [];
        try {
          const result = await stripe.prices.search({
            query: `metadata['planSlug']:'${plan.slug}' AND active:'true'`,
            limit: 20,
          });
          stripePrices = result.data;
        } catch {
          return {
            planId: plan.id,
            slug: plan.slug,
            name: plan.name,
            isActive: plan.isActive,
            monthlyOk: false,
            annualOk: false,
            isFree: false,
            error: "Falha ao consultar preços no Stripe",
          };
        }

        const monthlyOk = !needsMonthly || stripePrices.some(
          p => p.recurring?.interval === "month" && p.unit_amount === monthlyPriceCents && p.currency === "brl"
        );
        const annualOk = !needsAnnual || stripePrices.some(
          p => p.recurring?.interval === "year" && p.unit_amount === annualPriceCents && p.currency === "brl"
        );

        return {
          planId: plan.id,
          slug: plan.slug,
          name: plan.name,
          isActive: plan.isActive,
          monthlyOk,
          annualOk,
          isFree: false,
        };
      })
    );

    res.json({ stripeConfigured: true, plans: results });
  } catch (err) {
    next(err);
  }
});

// ─── INVOICES ─────────────────────────────────────────────────────────────────

const InvoiceBody = z.object({
  tenantId: z.string().min(1),
  planId: z.string().optional(),
  description: z.string().min(1),
  amount: z.string(),
  status: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

router.get("/admin/invoices", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const { tenantId, status } = req.query as Record<string, string>;
    let query = db.select({
      invoice: invoicesTable,
      tenantName: tenantsTable.name,
      tenantEmail: tenantsTable.email,
    }).from(invoicesTable)
      .leftJoin(tenantsTable, eq(invoicesTable.tenantId, tenantsTable.id))
      .orderBy(desc(invoicesTable.createdAt))
      .$dynamic();
    const conditions = [];
    if (tenantId) conditions.push(eq(invoicesTable.tenantId, tenantId));
    if (status) conditions.push(eq(invoicesTable.status, status));
    if (conditions.length) query = query.where(and(...conditions));
    const rows = await query.limit(200);
    res.json(rows.map(r => ({ ...r.invoice, tenantName: r.tenantName, tenantEmail: r.tenantEmail })));
  } catch (err) {
    next(err);
  }
});

router.post("/admin/invoices", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const parsed = InvoiceBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(invoicesTable).values({
      id,
      tenantId: parsed.data.tenantId,
      planId: parsed.data.planId,
      description: parsed.data.description,
      amount: parsed.data.amount,
      status: parsed.data.status ?? PAYMENT_STATUS.PENDING,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      notes: parsed.data.notes,
    });
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
});

router.patch("/admin/invoices/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const UpdateBody = z.object({
      status: z.string().optional(),
      paidAt: z.string().optional(),
      notes: z.string().optional(),
    });
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const updateData: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.paidAt) updateData.paidAt = new Date(parsed.data.paidAt);
    if (parsed.data.status === PAYMENT_STATUS.PAID && !parsed.data.paidAt) updateData.paidAt = new Date();
    await db.update(invoicesTable).set(updateData).where(eq(invoicesTable.id, req.params.id));
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, req.params.id)).limit(1);
    if (!invoice) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(invoice);
  } catch (err) {
    next(err);
  }
});

// ─── FEATURE FLAGS ────────────────────────────────────────────────────────────

const FlagBody = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
});

router.get("/admin/feature-flags", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const flags = await db.select().from(featureFlagsTable).orderBy(asc(featureFlagsTable.key));
    res.json(flags);
  } catch (err) {
    next(err);
  }
});

router.post("/admin/feature-flags", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const parsed = FlagBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(featureFlagsTable).values({ id, ...parsed.data });
    const [flag] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.id, id)).limit(1);
    res.status(201).json(flag);
  } catch (err) {
    next(err);
  }
});

router.patch("/admin/feature-flags/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const parsed = FlagBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    await db.update(featureFlagsTable).set(parsed.data).where(eq(featureFlagsTable.id, req.params.id));
    const [flag] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.id, req.params.id)).limit(1);
    if (!flag) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(flag);
  } catch (err) {
    next(err);
  }
});

router.delete("/admin/feature-flags/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    await db.delete(featureFlagsTable).where(eq(featureFlagsTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── METRICS HISTÓRICAS ────────────────────────────────────────────────────────

router.get("/admin/metrics/growth", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;

    const months: { month: string; label: string; new_tenants: number; active: number }[] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "America/Sao_Paulo" });

      const [newRow] = await db
        .select({ cnt: count() })
        .from(tenantsTable)
        .where(and(gte(tenantsTable.createdAt, start), lte(tenantsTable.createdAt, end)));

      const [activeRow] = await db
        .select({ cnt: count() })
        .from(tenantsTable)
        .where(and(eq(tenantsTable.status, "active"), lte(tenantsTable.createdAt, end)));

      months.push({
        month: start.toISOString().slice(0, 7),
        label,
        new_tenants: newRow?.cnt ?? 0,
        active: activeRow?.cnt ?? 0,
      });
    }

    res.json(months);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/metrics/mrr", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;

    const PLAN_MRR: Record<string, number> = { starter: 0, pro: 297, enterprise: 997 };
    const months: { month: string; label: string; mrr: number }[] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "America/Sao_Paulo" });

      const tenants = await db.select({ planId: tenantsTable.planId, status: tenantsTable.status })
        .from(tenantsTable)
        .where(and(eq(tenantsTable.status, "active"), lte(tenantsTable.createdAt, end)));

      const mrr = tenants.reduce((sum, t) => sum + (PLAN_MRR[t.planId] ?? 0), 0);
      months.push({ month: d.toISOString().slice(0, 7), label, mrr });
    }

    res.json(months);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/metrics/churn", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;

    const months: { month: string; label: string; suspended: number; churnRate: number }[] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "America/Sao_Paulo" });

      const [suspRow] = await db
        .select({ cnt: count() })
        .from(tenantsTable)
        .where(and(eq(tenantsTable.status, "suspended"), gte(tenantsTable.suspendedAt!, start), lte(tenantsTable.suspendedAt!, end)));

      const [totalRow] = await db
        .select({ cnt: count() })
        .from(tenantsTable)
        .where(lte(tenantsTable.createdAt, end));

      const suspended = suspRow?.cnt ?? 0;
      const total = totalRow?.cnt ?? 1;
      months.push({ month: d.toISOString().slice(0, 7), label, suspended, churnRate: Number(((suspended / total) * 100).toFixed(2)) });
    }

    res.json(months);
  } catch (err) {
    next(err);
  }
});

// ─── ADMIN USERS (todos da plataforma) ───────────────────────────────────────

router.get("/admin/users", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const { tenantId, role } = req.query as Record<string, string>;
    const conditions = [];
    if (tenantId) conditions.push(eq(usersTable.tenantId, tenantId));
    if (role) conditions.push(eq(usersTable.role, role as import("@workspace/permissions").Role));

    const rows = await db.select({
      user: usersTable,
      tenantName: tenantsTable.name,
    }).from(usersTable)
      .leftJoin(tenantsTable, eq(usersTable.tenantId, tenantsTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(usersTable.createdAt))
      .limit(500);

    const result = rows.map(r => ({ ...r.user, tenantName: r.tenantName }));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── GLOBAL AUDIT LOGS ────────────────────────────────────────────────────────

router.get("/admin/audit-logs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const { tenantId, entityType, action } = req.query as Record<string, string>;
    const conditions = [];
    if (tenantId) conditions.push(eq(auditLogsTable.tenantId, tenantId));
    if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType));
    if (action) conditions.push(eq(auditLogsTable.action, action));

    const rows = await db.select({
      log: auditLogsTable,
      tenantName: tenantsTable.name,
      userName: usersTable.name,
    }).from(auditLogsTable)
      .leftJoin(tenantsTable, eq(auditLogsTable.tenantId, tenantsTable.id))
      .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(500);

    const result = rows.map(r => ({ ...r.log, tenantName: r.tenantName, userName: r.userName }));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── ADMIN TENANTS LIST ───────────────────────────────────────────────────────

router.get("/admin/tenants", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;

    const tenants = await db.select().from(tenantsTable).orderBy(desc(tenantsTable.createdAt));

    const userCounts = await db
      .select({ tenantId: usersTable.tenantId, userCount: count(usersTable.id) })
      .from(usersTable)
      .groupBy(usersTable.tenantId);

    const countMap: Record<string, number> = {};
    for (const row of userCounts) {
      if (row.tenantId) countMap[row.tenantId] = row.userCount;
    }

    res.json(tenants.map((t) => ({ ...t, userCount: countMap[t.id] ?? 0 })));
  } catch (err) {
    next(err);
  }
});

// ─── SUPERADMIN SYNC ──────────────────────────────────────────────────────────
// Bootstrap: set role="superadmin" for the calling user if their Clerk ID matches
// the SUPERADMIN_CLERK_ID environment variable. Safe to call multiple times.

router.post("/admin/sync-superadmin", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const { userId: clerkId } = getAuth(req);
    if (!clerkId) { next(new AppError("Not authenticated", 401, "UNAUTHORIZED")); return; }

    const superadminClerkId = process.env.SUPERADMIN_CLERK_ID;
    if (!superadminClerkId) {
      next(new AppError("SUPERADMIN_CLERK_ID not configured", 500, "SERVER_MISCONFIGURED")); return;
    }
    if (clerkId !== superadminClerkId) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
    if (!existing) {
      next(new NotFoundError("User not found — sign in first to create your profile, then call this endpoint", "NOT_FOUND")); return;
    }

    if (existing.role === ROLES.SUPER_ADMIN) {
      res.json({ ok: true, already: true, userId: existing.id, role: ROLES.SUPER_ADMIN }); return;
    }

    await db.update(usersTable).set({ role: ROLES.SUPER_ADMIN }).where(eq(usersTable.clerkId, clerkId));
    res.json({ ok: true, already: false, userId: existing.id, role: ROLES.SUPER_ADMIN });
  } catch (err) {
    next(err);
  }
});

// ─── TENANT DETAILS + ACTIONS ─────────────────────────────────────────────────

router.get("/admin/tenants/:id/details", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, req.params.id)).limit(1);
    if (!tenant) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }

    const users = await db.select().from(usersTable).where(eq(usersTable.tenantId, req.params.id)).orderBy(desc(usersTable.createdAt));
    const [userCount] = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.tenantId, req.params.id));
    const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.tenantId, req.params.id)).orderBy(desc(auditLogsTable.createdAt)).limit(50);
    const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.tenantId, req.params.id)).orderBy(desc(invoicesTable.createdAt));

    res.json({ ...tenant, users, userCount: userCount?.cnt ?? 0, logs, invoices });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/tenants/:id/suspend", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    const parsed = SuspendTenantBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      next(new ValidationError("reason deve ser uma string", "VALIDATION_ERROR")); return;
    }
    const reason = parsed.data.reason;
    await db.update(tenantsTable).set({
      status: "suspended",
      suspendedAt: new Date(),
      suspensionReason: reason ?? "Suspensão administrativa",
    }).where(eq(tenantsTable.id, req.params.id));
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, req.params.id)).limit(1);
    res.json(tenant);
  } catch (err) {
    next(err);
  }
});

router.post("/admin/tenants/:id/activate", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;
    await db.update(tenantsTable).set({
      status: "active",
      suspendedAt: null,
      suspensionReason: null,
    }).where(eq(tenantsTable.id, req.params.id));
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, req.params.id)).limit(1);
    res.json(tenant);
  } catch (err) {
    next(err);
  }
});

// ─── ORPHANED UPLOADTHING FILE CLEANUP ───────────────────────────────────────
//
// Operator runbook:
//   1. POST /admin/cleanup-orphaned-uploadthing-files          (dry-run, default)
//      Review "wouldDelete" count and "orphanedKeys" list in the response.
//   2. POST /admin/cleanup-orphaned-uploadthing-files?dryRun=false
//      Executes deletion only after you have confirmed the dry-run output.
//
// This endpoint covers all UploadThing-backed media across the entire database:
// tenant logos, store assets (logo, logoDark, favicon, banners), store product
// images/galleries, store review photos, store category images, trip covers and
// galleries, catalog product images, vehicle photos, accommodation/destination
// covers and galleries, client profile photos, and user avatars.
// extractVerifiedUploadThingKey() filters out non-UploadThing URLs
// (Clerk avatars, external links) so they are never deleted.

router.post("/admin/cleanup-orphaned-uploadthing-files", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;

    // dry-run mode: pass ?dryRun=false to actually delete; default is true (safe preview).
    const dryRun = req.query["dryRun"] !== "false";
    // verbose mode: pass ?verbose=true to include the full key list in the response.
    const verbose = req.query["verbose"] === "true";

    // 1. Collect all UploadThing file keys currently referenced anywhere in the DB.
    const referencedKeys = await collectReferencedUploadThingKeys();

    // 2. List all files in UploadThing (paginate with offset)
    const PAGE_SIZE = 500;
    const allFileKeys: string[] = [];
    let offset = 0;
    while (true) {
      const page = await utapi.listFiles({ limit: PAGE_SIZE, offset });
      for (const f of page.files) allFileKeys.push(f.key);
      if (!page.hasMore) break;
      offset += PAGE_SIZE;
    }

    // 3. Identify orphaned keys (files in UploadThing not referenced in any DB column)
    const orphanedKeys = allFileKeys.filter((key) => !referencedKeys.has(key));

    if (dryRun || orphanedKeys.length === 0) {
      res.json({
        dryRun,
        deleted: 0,
        wouldDelete: orphanedKeys.length,
        ...(verbose ? { orphanedKeys } : {}),
      });
      return;
    }

    // 4. Delete orphaned files in batches of 100; track per-batch success
    const BATCH_SIZE = 100;
    let deletedCount = 0;
    const failedKeys: string[] = [];
    for (let i = 0; i < orphanedKeys.length; i += BATCH_SIZE) {
      const batch = orphanedKeys.slice(i, i + BATCH_SIZE);
      try {
        const result = await utapi.deleteFiles(batch);
        deletedCount += result.deletedCount;
      } catch (batchErr) {
        failedKeys.push(...batch);
      }
    }

    res.json({
      dryRun: false,
      deleted: deletedCount,
      failed: failedKeys.length,
      ...(verbose ? { failedKeys, orphanedKeys } : {}),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/maintenance/orphaned-files
// Body: { dryRun?: boolean, keys?: string[] }
//   dryRun=true (default): scan and return orphaned file details (key, name, size, url)
//   dryRun=false, keys=[...]: delete only the supplied keys
//   dryRun=false, keys omitted: delete all orphaned files
// ---------------------------------------------------------------------------
router.post("/admin/maintenance/orphaned-files", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;

    const dryRun: boolean = req.body.dryRun !== false;
    const suppliedKeys: string[] | undefined = Array.isArray(req.body.keys) ? req.body.keys : undefined;

    // Collect all DB-referenced UploadThing keys
    const referencedKeys = await collectReferencedUploadThingKeys();

    // List all files in UploadThing with details (paginate)
    const PAGE_SIZE = 500;
    const allFiles: { key: string; name: string; size: number }[] = [];
    let offset = 0;
    while (true) {
      const page = await utapi.listFiles({ limit: PAGE_SIZE, offset });
      for (const f of page.files) allFiles.push({ key: f.key, name: f.name, size: f.size });
      if (!page.hasMore) break;
      offset += PAGE_SIZE;
    }

    // Identify orphaned files
    const orphaned = allFiles
      .filter((f) => !referencedKeys.has(f.key))
      .map((f) => ({
        key: f.key,
        name: f.name,
        size: f.size,
        url: `https://utfs.io/f/${f.key}`,
      }));

    if (dryRun) {
      res.json({
        dryRun: true,
        orphanedCount: orphaned.length,
        totalSize: orphaned.reduce((acc, f) => acc + f.size, 0),
        files: orphaned,
      });
      return;
    }

    // Delete: either supplied keys (intersected with orphaned set for safety) or all orphaned
    const orphanedKeySet = new Set(orphaned.map((f) => f.key));
    const keysToDelete = suppliedKeys
      ? suppliedKeys.filter((k) => orphanedKeySet.has(k))
      : orphaned.map((f) => f.key);
    const skippedKeys = suppliedKeys ? suppliedKeys.filter((k) => !orphanedKeySet.has(k)) : [];
    if (keysToDelete.length === 0) {
      res.json({ dryRun: false, deleted: 0, failed: 0, ...(skippedKeys.length ? { skippedKeys } : {}) });
      return;
    }

    const BATCH = 100;
    let deletedCount = 0;
    const failedKeys: string[] = [];
    for (let i = 0; i < keysToDelete.length; i += BATCH) {
      const batch = keysToDelete.slice(i, i + BATCH);
      try {
        const result = await utapi.deleteFiles(batch);
        deletedCount += result.deletedCount;
      } catch (batchErr) {
        failedKeys.push(...batch);
      }
    }

    res.json({
      dryRun: false,
      deleted: deletedCount,
      failed: failedKeys.length,
      ...(failedKeys.length ? { failedKeys } : {}),
      ...(skippedKeys.length ? { skippedKeys } : {}),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/maintenance/backfill-referral-pending-orders
// Superadmin-only. Idempotent: inserts PENDING referral rows for store_orders
// that were placed with a referral code BEFORE the checkout fix (which now
// inserts the row at checkout time). Orders already processed are skipped
// because their pending_referral JSON already contains a referralId.
// Returns: { inserted, skipped, total }
// ---------------------------------------------------------------------------
router.post("/admin/maintenance/backfill-referral-pending-orders", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;

    const orders = await db
      .select({
        id: storeOrdersTable.id,
        tenantId: storeOrdersTable.tenantId,
        customerEmail: storeOrdersTable.customerEmail,
        customerName: storeOrdersTable.customerName,
        ipAddress: storeOrdersTable.ipAddress,
        pendingReferral: storeOrdersTable.pendingReferral,
      })
      .from(storeOrdersTable)
      .where(
        and(
          isNotNull(storeOrdersTable.pendingReferral),
          isNull(storeOrdersTable.referralEffectsAppliedAt),
          ne(storeOrdersTable.paymentStatus, STORE_PAYMENT_STATUS.PAID),
          // Idempotency: skip orders already processed (referralId present in JSON)
          sql`(${storeOrdersTable.pendingReferral}->>'referralId') IS NULL`,
        ),
      );

    let inserted = 0;
    let skipped = 0;

    for (const order of orders) {
      const ref = order.pendingReferral;
      if (!ref || !ref.code || !ref.referrerId) {
        skipped++;
        continue;
      }

      const referralId = randomUUID().replace(/-/g, "");

      try {
        await db.transaction(async (tx) => {
          await tx.insert(referralsTable).values({
            id: referralId,
            tenantId: order.tenantId,
            referrerId: ref.referrerId,
            code: ref.code,
            status: REFERRAL_STATUS.PENDING,
            source: "store",
            referredEmail: order.customerEmail,
            referredName: order.customerName,
            discountApplied: true,
            discountValue: String(ref.discountValue ?? 0),
            discountType: ref.discountType ?? "percentage",
            discountAmount: "0",
            bonusAmount: "0",
            ...(ref.cookieId ? { cookieId: ref.cookieId } : {}),
            ...(order.ipAddress ? { ipAddress: order.ipAddress } : {}),
          });

          await tx
            .update(storeOrdersTable)
            .set({ pendingReferral: { ...ref, referralId } })
            .where(eq(storeOrdersTable.id, order.id));
        });
        inserted++;
      } catch {
        skipped++;
      }
    }

    res.json({ inserted, skipped, total: orders.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/maintenance/backfill-referral-pending-orders/dry-run
// Superadmin-only. Read-only count of orders that would be processed by the
// POST backfill. Used by the Maintenance page to auto-hide the card once all
// pre-fix orders have been corrected.
// Returns: { count }
// ---------------------------------------------------------------------------
router.get("/admin/maintenance/backfill-referral-pending-orders/dry-run", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!requireSuperAdmin(me.role, res, next)) return;

    const orders = await db
      .select({ id: storeOrdersTable.id })
      .from(storeOrdersTable)
      .where(
        and(
          isNotNull(storeOrdersTable.pendingReferral),
          isNull(storeOrdersTable.referralEffectsAppliedAt),
          ne(storeOrdersTable.paymentStatus, STORE_PAYMENT_STATUS.PAID),
          sql`(${storeOrdersTable.pendingReferral}->>'referralId') IS NULL`,
        ),
      );

    res.json({ count: orders.length });
  } catch (err) {
    next(err);
  }
});

// ─── CLIENT DOCUMENTS ────────────────────────────────────────────────────────

router.get("/admin/clients/:clientId/documents", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const docs = await db.select().from(documentsTable)
      .where(and(
        eq(documentsTable.tenantId, me.tenantId),
        eq(documentsTable.entityType, "client"),
        eq(documentsTable.entityId, req.params.clientId),
      ))
      .orderBy(desc(documentsTable.createdAt));
    res.json(docs.map(d => ({
      id: d.id,
      name: d.name,
      url: d.url,
      fileKey: d.fileKey,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      uploadedById: d.uploadedById,
      createdAt: d.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

router.post("/admin/clients/:clientId/documents", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    // Verify the clientId belongs to the caller's tenant before creating the document
    const [clientRow] = await db.select({ id: clientsTable.id })
      .from(clientsTable)
      .where(and(eq(clientsTable.id, req.params.clientId), eq(clientsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!clientRow) { next(new NotFoundError("Client not found", "CLIENT_NOT_FOUND")); return; }
    const parsed = CreateClientDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.issues[0]?.message ?? "name and url are required", "VALIDATION_ERROR")); return;
    }
    const { name, url, mimeType, sizeBytes } = parsed.data;
    // Derive fileKey from the trusted UploadThing URL — never trust client-supplied key
    const fileKey = extractVerifiedUploadThingKey(url);
    const id = generateId();
    await db.insert(documentsTable).values({
      id,
      tenantId: me.tenantId,
      name,
      url,
      fileKey,
      mimeType: mimeType ?? null,
      sizeBytes: sizeBytes ?? null,
      type: "client_document",
      entityType: "client",
      entityId: req.params.clientId,
      uploadedById: me.id,
    });
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id)).limit(1);
    if (!doc) { next(new AppError("Failed to create document", 500, "DOC_CREATE_FAILED")); return; }
    res.status(201).json({
      id: doc.id,
      name: doc.name,
      url: doc.url,
      fileKey: doc.fileKey,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      uploadedById: doc.uploadedById,
      createdAt: doc.createdAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/admin/clients/:clientId/documents/:docId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const [doc] = await db.select().from(documentsTable)
      .where(and(
        eq(documentsTable.id, req.params.docId),
        eq(documentsTable.tenantId, me.tenantId),
        eq(documentsTable.entityType, "client"),
        eq(documentsTable.entityId, req.params.clientId),
      ))
      .limit(1);
    if (!doc) { next(new NotFoundError("Document not found", "DOC_NOT_FOUND")); return; }
    // Route through deleteOrphanedFile so the cross-tenant ownership guard runs
    await deleteOrphanedFile(doc.url, null, req.log ?? console, me.tenantId);
    await db.delete(documentsTable).where(eq(documentsTable.id, doc.id));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;

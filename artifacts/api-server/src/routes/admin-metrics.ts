import { Router, type NextFunction } from "express";
import { db, tenantsTable, usersTable, clientsTable, tripsTable, auditLogsTable, reservationsTable, plansTable, emailLogsTable } from "@workspace/db";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ROLES } from "@workspace/permissions";
import { LIST_SAFETY_CAP } from "../lib/list-limits";

const router = Router();

async function buildPlanPriceMap(): Promise<Record<string, number>> {
  const plans = await db.select({ id: plansTable.id, slug: plansTable.slug, monthlyPrice: plansTable.monthlyPrice }).from(plansTable);
  const map: Record<string, number> = {};
  for (const p of plans) {
    const price = Number(p.monthlyPrice) || 0;
    map[p.id] = price;
    if (p.slug) map[p.slug] = price;
  }
  return map;
}

function getMonthBuckets(months = 12) {
  const buckets = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      label: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "America/Sao_Paulo" }),
      year: d.getFullYear(),
      month: d.getMonth() + 1,
    });
  }
  return buckets;
}

router.get("/admin/metrics/mrr", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [tenants, planPriceMap] = await Promise.all([
      db.select().from(tenantsTable),
      buildPlanPriceMap(),
    ]);
    const buckets = getMonthBuckets(12);

    const series = buckets.map(({ label, year, month }) => {
      let mrr = 0;
      for (const t of tenants) {
        const created = new Date(t.createdAt);
        const cYear = created.getFullYear();
        const cMonth = created.getMonth() + 1;
        if (cYear < year || (cYear === year && cMonth <= month)) {
          if (t.status === "active") {
            mrr += planPriceMap[t.planId] ?? 0;
          }
        }
      }
      return { label, value: mrr };
    });

    res.json(series);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/metrics/churn", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const tenants = await db.select().from(tenantsTable);
    const buckets = getMonthBuckets(12);

    const series = buckets.map(({ label, year, month }) => {
      let total = 0;
      let suspended = 0;
      for (const t of tenants) {
        const created = new Date(t.createdAt);
        const cYear = created.getFullYear();
        const cMonth = created.getMonth() + 1;
        if (cYear < year || (cYear === year && cMonth <= month)) {
          total++;
          if (t.status === "suspended") suspended++;
        }
      }
      const rate = total > 0 ? Math.round((suspended / total) * 100 * 10) / 10 : 0;
      return { label, value: rate };
    });

    res.json(series);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/metrics/growth", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const tenants = await db.select().from(tenantsTable);
    const buckets = getMonthBuckets(12);

    const series = buckets.map(({ label, year, month }) => {
      let active = 0;
      for (const t of tenants) {
        const created = new Date(t.createdAt);
        const cYear = created.getFullYear();
        const cMonth = created.getMonth() + 1;
        if (cYear < year || (cYear === year && cMonth <= month)) {
          if (t.status === "active") {
            active++;
          }
        }
      }
      return { label, value: active };
    });

    res.json(series);
  } catch (err) {
    next(err);
  }
});

router.get("/tenants/:id/details", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, req.params.id)).limit(1);
    if (!tenant) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }

    const [userCount] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.tenantId, req.params.id));
    const [clientCount] = await db.select({ count: count() }).from(clientsTable).where(eq(clientsTable.tenantId, req.params.id));
    const [tripCount] = await db.select({ count: count() }).from(tripsTable).where(eq(tripsTable.tenantId, req.params.id));
    const [reservationCount] = await db.select({ count: count() }).from(reservationsTable).where(eq(reservationsTable.tenantId, req.params.id));

    const [plan] = await db.select({
      maxUsers: plansTable.maxUsers,
      maxClients: plansTable.maxClients,
      maxTrips: plansTable.maxTrips,
    }).from(plansTable).where(eq(plansTable.id, tenant.planId)).limit(1);

    res.json({
      ...tenant,
      userCount: userCount?.count ?? 0,
      clientCount: clientCount?.count ?? 0,
      tripCount: tripCount?.count ?? 0,
      reservationCount: reservationCount?.count ?? 0,
      planMaxUsers: plan?.maxUsers ?? null,
      planMaxClients: plan?.maxClients ?? null,
      planMaxTrips: plan?.maxTrips ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/tenants/:id/users", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const users = await db.select().from(usersTable).where(eq(usersTable.tenantId, req.params.id)).orderBy(desc(usersTable.createdAt)).limit(LIST_SAFETY_CAP);
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.post("/tenants/:id/suspend", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    await db.update(tenantsTable).set({ status: "suspended" }).where(eq(tenantsTable.id, req.params.id));
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, req.params.id)).limit(1);
    if (!tenant) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(tenant);
  } catch (err) {
    next(err);
  }
});

router.post("/tenants/:id/activate", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    await db.update(tenantsTable).set({ status: "active" }).where(eq(tenantsTable.id, req.params.id));
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, req.params.id)).limit(1);
    if (!tenant) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(tenant);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/users", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const users = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      isActive: usersTable.isActive,
      tenantId: usersTable.tenantId,
      tenantName: tenantsTable.name,
      tenantStatus: tenantsTable.status,
      createdAt: usersTable.createdAt,
    })
      .from(usersTable)
      .leftJoin(tenantsTable, eq(usersTable.tenantId, tenantsTable.id))
      .orderBy(desc(usersTable.createdAt))
      .limit(LIST_SAFETY_CAP);

    res.json(users);
  } catch (err) {
    next(err);
  }
});

const AuditLogsQuery = z.object({
  tenantId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
});

router.get("/admin/audit-logs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = AuditLogsQuery.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError("Parâmetro inválido: tenantId deve ser UUID válido; action e entityType devem ter no máximo 100 caracteres", "VALIDATION_ERROR"));
      return;
    }
    const { tenantId, action, entityType } = parsed.data;

    const conditions = [];
    if (tenantId) conditions.push(eq(auditLogsTable.tenantId, tenantId));
    if (action) conditions.push(eq(auditLogsTable.action, action));
    if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType));

    const aliasedUsers = db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).as("log_users");

    const query = db.select({
      id: auditLogsTable.id,
      tenantId: auditLogsTable.tenantId,
      userId: auditLogsTable.userId,
      action: auditLogsTable.action,
      entityType: auditLogsTable.entityType,
      entityId: auditLogsTable.entityId,
      before: auditLogsTable.before,
      after: auditLogsTable.after,
      ipAddress: auditLogsTable.ipAddress,
      createdAt: auditLogsTable.createdAt,
      tenantName: tenantsTable.name,
      userName: aliasedUsers.name,
      userEmail: aliasedUsers.email,
    })
      .from(auditLogsTable)
      .leftJoin(tenantsTable, eq(auditLogsTable.tenantId, tenantsTable.id))
      .leftJoin(aliasedUsers, eq(auditLogsTable.userId, aliasedUsers.id))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(500)
      .$dynamic();

    const logs = conditions.length > 0 ? await query.where(and(...conditions)) : await query;
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/email-jobs/failed-count", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [row] = await db
      .select({ count: count() })
      .from(emailLogsTable)
      .where(eq(emailLogsTable.status, "failed"));

    const recent = await db
      .select()
      .from(emailLogsTable)
      .where(eq(emailLogsTable.status, "failed"))
      .orderBy(desc(emailLogsTable.createdAt))
      .limit(20);

    res.json({ failedCount: row?.count ?? 0, recent });
  } catch (err) {
    next(err);
  }
});

export default router;

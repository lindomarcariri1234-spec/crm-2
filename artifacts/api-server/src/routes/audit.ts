import { Router, type NextFunction } from "express";
import { db, auditLogsTable, systemConfigsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth, ADMIN_ROLES } from '../lib/tenant';
import { ForbiddenError, ValidationError } from "../lib/errors";

const router = Router();

router.get("/audit-logs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const logs = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.tenantId, me.tenantId))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(500);
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

router.get("/system-configs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const configs = await db.select().from(systemConfigsTable)
      .where(eq(systemConfigsTable.tenantId, me.tenantId));
    res.json(configs);
  } catch (err) {
    next(err);
  }
});

const UpsertConfigBody = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

router.put("/system-configs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpsertConfigBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const existing = await db.select().from(systemConfigsTable)
      .where(and(eq(systemConfigsTable.tenantId, me.tenantId), eq(systemConfigsTable.key, parsed.data.key))).limit(1);
    if (existing.length > 0) {
      await db.update(systemConfigsTable)
        .set({ value: parsed.data.value as Record<string, unknown>, updatedById: me.id })
        .where(and(eq(systemConfigsTable.tenantId, me.tenantId), eq(systemConfigsTable.key, parsed.data.key)));
    } else {
      const id = generateId();
      await db.insert(systemConfigsTable).values({
        id, tenantId: me.tenantId, key: parsed.data.key,
        value: parsed.data.value as Record<string, unknown>, updatedById: me.id,
      });
    }
    const [config] = await db.select().from(systemConfigsTable)
      .where(and(eq(systemConfigsTable.tenantId, me.tenantId), eq(systemConfigsTable.key, parsed.data.key))).limit(1);
    res.json(config);
  } catch (err) {
    next(err);
  }
});

export default router;

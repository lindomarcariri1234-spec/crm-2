import { Router, type NextFunction } from "express";
import { db, auditLogsTable, systemConfigsTable } from "@workspace/db";
import { eq, and, desc, gte, lt, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth, ADMIN_ROLES } from '../lib/tenant';
import { ForbiddenError, ValidationError } from "../lib/errors";

const router = Router();

const AuditLogsQuery = z.object({
  accommodationId: z.string().trim().min(1).max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function brazilianDateStart(date: string): Date {
  return new Date(`${date}T03:00:00.000Z`);
}

router.get("/audit-logs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = AuditLogsQuery.safeParse(req.query);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
      next(new ValidationError("O início do período não pode ser posterior ao fim", "VALIDATION_ERROR")); return;
    }
    const conditions = [eq(auditLogsTable.tenantId, me.tenantId)];
    if (parsed.data.accommodationId) {
      const accommodationId = parsed.data.accommodationId;
      conditions.push(
        eq(auditLogsTable.entityType, "accommodation_room"),
        or(
          sql`${auditLogsTable.before}->>'accommodationId' = ${accommodationId}`,
          sql`${auditLogsTable.after}->>'accommodationId' = ${accommodationId}`,
        )!,
      );
    }
    if (parsed.data.from) {
      conditions.push(gte(auditLogsTable.createdAt, brazilianDateStart(parsed.data.from)));
    }
    if (parsed.data.to) {
      const exclusiveEnd = brazilianDateStart(parsed.data.to);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      conditions.push(lt(auditLogsTable.createdAt, exclusiveEnd));
    }
    const logs = await db.select().from(auditLogsTable)
      .where(and(...conditions))
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

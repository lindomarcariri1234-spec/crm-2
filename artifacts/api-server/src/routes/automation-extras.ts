import { Router, type NextFunction } from "express";
import { db, automationActionsTable, automationLogsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth, ADMIN_ROLES } from '../lib/tenant';
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";

const router = Router();

const CreateAutomationActionBody = z.object({
  automationId: z.string(),
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  order: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

router.get("/automation-actions", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const actions = await db.select().from(automationActionsTable)
      .where(eq(automationActionsTable.tenantId, me.tenantId))
      .orderBy(automationActionsTable.order);
    res.json(actions);
  } catch (err) {
    next(err);
  }
});

router.post("/automation-actions", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateAutomationActionBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(automationActionsTable).values({
      id, tenantId: me.tenantId,
      automationId: parsed.data.automationId,
      type: parsed.data.type,
      ...(parsed.data.config && { config: parsed.data.config }),
      ...(parsed.data.order != null && { order: parsed.data.order }),
      ...(parsed.data.isActive != null && { isActive: parsed.data.isActive }),
    });
    const [action] = await db.select().from(automationActionsTable).where(eq(automationActionsTable.id, id)).limit(1);
    res.status(201).json(action);
  } catch (err) {
    next(err);
  }
});

router.patch("/automation-actions/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateAutomationActionBody.partial().omit({ automationId: true }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    await db.update(automationActionsTable).set(parsed.data as Record<string, unknown>)
      .where(and(eq(automationActionsTable.id, req.params.id), eq(automationActionsTable.tenantId, me.tenantId)));
    const [action] = await db.select().from(automationActionsTable)
      .where(and(eq(automationActionsTable.id, req.params.id), eq(automationActionsTable.tenantId, me.tenantId))).limit(1);
    if (!action) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(action);
  } catch (err) {
    next(err);
  }
});

router.delete("/automation-actions/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.delete(automationActionsTable)
      .where(and(eq(automationActionsTable.id, req.params.id), eq(automationActionsTable.tenantId, me.tenantId)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/automation-logs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const logs = await db.select().from(automationLogsTable)
      .where(eq(automationLogsTable.tenantId, me.tenantId))
      .orderBy(desc(automationLogsTable.executedAt))
      .limit(500);
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

export default router;

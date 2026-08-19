import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { messagesTable, messageTemplatesTable, automationsTable, clientsTable, emailLogsTable, reservationsTable } from "@workspace/db";
import { eq, and, desc, isNotNull, inArray, notLike } from "drizzle-orm";
import { generateId } from "../lib/id";
import { requireAuth, getTenantUser } from "../lib/tenant";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors"; 
import { z } from "zod";
import { ADMIN_ROLES, MANAGEMENT_ROLES, ALL_STAFF_ROLES } from '../lib/tenant';
import { resendEmailLog } from "../queues/email-helpers";
import { LIST_SAFETY_CAP } from "../lib/list-limits";

const router = Router();

const CreateMessageBody = z.object({
  toClientId: z.string().optional(),
  channel: z.string(),
  content: z.string(),
});

const CreateMessageTemplateBody = z.object({
  name: z.string(),
  channel: z.string(),
  category: z.string().optional(),
  subject: z.string().optional(),
  content: z.string(),
  variables: z.array(z.string()).optional(),
});

const UpdateMessageTemplateBody = z.object({
  name: z.string().optional(),
  content: z.string().optional(),
  subject: z.string().optional(),
  variables: z.array(z.string()).optional(),
});

const CreateAutomationBody = z.object({
  name: z.string(),
  description: z.string().optional(),
  triggerType: z.string(),
  triggerConfig: z.record(z.unknown()).optional(),
  conditions: z.unknown().optional(),
  isActive: z.boolean().optional(),
});

const UpdateAutomationBody = z.object({
  name: z.string().optional(),
  isActive: z.boolean().optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  conditions: z.unknown().optional(),
});

function formatMessage(m: typeof messagesTable.$inferSelect) {
  return {
    id: m.id, tenantId: m.tenantId, fromUserId: m.fromUserId, toClientId: m.toClientId,
    channel: m.channel, content: m.content, status: m.status,
    sentAt: m.sentAt.toISOString(),
    deliveredAt: m.deliveredAt?.toISOString() ?? null, readAt: m.readAt?.toISOString() ?? null,
    metadata: m.metadata,
  };
}

function formatTemplate(t: typeof messageTemplatesTable.$inferSelect) {
  return {
    id: t.id, tenantId: t.tenantId, name: t.name, channel: t.channel,
    category: t.category, subject: t.subject, content: t.content,
    variables: t.variables ?? [],
    createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
  };
}

function formatAutomation(a: typeof automationsTable.$inferSelect) {
  return {
    id: a.id, tenantId: a.tenantId, name: a.name, description: a.description,
    triggerType: a.triggerType, triggerConfig: a.triggerConfig ?? {},
    conditions: a.conditions ?? {}, isActive: a.isActive,
    executionsCount: a.executionsCount,
    lastExecutedAt: a.lastExecutedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString(),
  };
}

router.get("/messages", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const { clientId } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [eq(messagesTable.tenantId, me.tenantId)];
    if (clientId) conditions.push(eq(messagesTable.toClientId, clientId));
    const messages = await db.select().from(messagesTable)
      .where(and(...conditions)).orderBy(desc(messagesTable.sentAt))
      .limit(LIST_SAFETY_CAP);
    res.json(messages.map(formatMessage));
  } catch (err) {
    next(err);
  }
});

router.post("/messages", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = CreateMessageBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    if (parsed.data.toClientId) {
      const [client] = await db.select().from(clientsTable)
        .where(and(eq(clientsTable.id, parsed.data.toClientId), eq(clientsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!client) { next(new ValidationError(String("Client not found or not in tenant" ), "VALIDATION_ERROR")); return; }
    }

    const id = generateId();
    await db.insert(messagesTable).values({
      id,
      tenantId: me.tenantId,
      fromUserId: me.id,
      toClientId: parsed.data.toClientId ?? null,
      channel: parsed.data.channel,
      content: parsed.data.content,
      status: "sent",
    });
    const [message] = await db.select().from(messagesTable)
      .where(and(eq(messagesTable.id, id), eq(messagesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!message) { next(new AppError("Resource not found", 404, "NOT_FOUND")); return; }
    res.status(201).json(formatMessage(message));
  } catch (err) {
    next(err);
  }
});

router.get("/message-templates", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const templates = await db.select().from(messageTemplatesTable)
      .where(eq(messageTemplatesTable.tenantId, me.tenantId))
      .orderBy(desc(messageTemplatesTable.createdAt))
      .limit(LIST_SAFETY_CAP);
    res.json(templates.map(formatTemplate));
  } catch (err) {
    next(err);
  }
});

router.post("/message-templates", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateMessageTemplateBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(messageTemplatesTable).values({
      id,
      tenantId: me.tenantId,
      name: parsed.data.name,
      channel: parsed.data.channel,
      category: parsed.data.category ?? null,
      subject: parsed.data.subject ?? null,
      content: parsed.data.content,
      variables: parsed.data.variables ?? [],
    });
    const [template] = await db.select().from(messageTemplatesTable)
      .where(and(eq(messageTemplatesTable.id, id), eq(messageTemplatesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!template) { next(new AppError("Resource not found", 404, "NOT_FOUND")); return; }
    res.status(201).json(formatTemplate(template));
  } catch (err) {
    next(err);
  }
});

router.patch("/message-templates/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdateMessageTemplateBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const updates: Partial<typeof messageTemplatesTable.$inferInsert> = {};
    if (parsed.data.name != null) updates.name = parsed.data.name;
    if (parsed.data.content != null) updates.content = parsed.data.content;
    if (parsed.data.subject !== undefined) updates.subject = parsed.data.subject ?? null;
    if (parsed.data.variables != null) updates.variables = parsed.data.variables;
    await db.update(messageTemplatesTable).set(updates)
      .where(and(eq(messageTemplatesTable.id, req.params.id), eq(messageTemplatesTable.tenantId, me.tenantId)));
    const [template] = await db.select().from(messageTemplatesTable)
      .where(and(eq(messageTemplatesTable.id, req.params.id), eq(messageTemplatesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!template) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(formatTemplate(template));
  } catch (err) {
    next(err);
  }
});

router.delete("/message-templates/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.delete(messageTemplatesTable)
      .where(and(eq(messageTemplatesTable.id, req.params.id), eq(messageTemplatesTable.tenantId, me.tenantId)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/automations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const automations = await db.select().from(automationsTable)
      .where(eq(automationsTable.tenantId, me.tenantId))
      .orderBy(desc(automationsTable.createdAt))
      .limit(LIST_SAFETY_CAP);
    res.json(automations.map(formatAutomation));
  } catch (err) {
    next(err);
  }
});

router.post("/automations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateAutomationBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(automationsTable).values({
      id,
      tenantId: me.tenantId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      triggerType: parsed.data.triggerType,
      triggerConfig: parsed.data.triggerConfig ?? {},
      conditions: parsed.data.conditions ?? null,
      isActive: parsed.data.isActive ?? true,
    });
    const [automation] = await db.select().from(automationsTable)
      .where(and(eq(automationsTable.id, id), eq(automationsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!automation) { next(new AppError("Resource not found", 404, "NOT_FOUND")); return; }
    res.status(201).json(formatAutomation(automation));
  } catch (err) {
    next(err);
  }
});

router.patch("/automations/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdateAutomationBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const updates: Partial<typeof automationsTable.$inferInsert> = {};
    if (parsed.data.name != null) updates.name = parsed.data.name;
    if (parsed.data.isActive != null) updates.isActive = parsed.data.isActive;
    if (parsed.data.triggerConfig != null) updates.triggerConfig = parsed.data.triggerConfig;
    if (parsed.data.conditions !== undefined) updates.conditions = parsed.data.conditions ?? null;
    await db.update(automationsTable).set(updates)
      .where(and(eq(automationsTable.id, req.params.id), eq(automationsTable.tenantId, me.tenantId)));
    const [automation] = await db.select().from(automationsTable)
      .where(and(eq(automationsTable.id, req.params.id), eq(automationsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!automation) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(formatAutomation(automation));
  } catch (err) {
    next(err);
  }
});

router.delete("/automations/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.delete(automationsTable)
      .where(and(eq(automationsTable.id, req.params.id), eq(automationsTable.tenantId, me.tenantId)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.patch("/automations/:id/toggle", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const [existing] = await db.select().from(automationsTable)
      .where(and(eq(automationsTable.id, req.params.id), eq(automationsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!existing) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    await db.update(automationsTable).set({ isActive: !existing.isActive })
      .where(and(eq(automationsTable.id, req.params.id), eq(automationsTable.tenantId, me.tenantId)));
    const [automation] = await db.select().from(automationsTable)
      .where(and(eq(automationsTable.id, req.params.id), eq(automationsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!automation) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(formatAutomation(automation));
  } catch (err) {
    next(err);
  }
});

router.get("/clients-for-messaging", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const clients = await db.select().from(clientsTable)
      .where(eq(clientsTable.tenantId, me.tenantId));
    res.json(clients.map(c => ({ id: c.id, name: c.name, email: c.email, whatsapp: c.whatsapp })));
  } catch (err) {
    next(err);
  }
});

// ── Email Logs ──────────────────────────────────────────────────────────────

router.get("/email-logs/failed-summary", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }

    const exhaustedLogs = await db
      .select({
        id: emailLogsTable.id,
        reservationId: emailLogsTable.reservationId,
        retriesExhaustedAt: emailLogsTable.retriesExhaustedAt,
      })
      .from(emailLogsTable)
      .where(
        and(
          eq(emailLogsTable.tenantId, me.tenantId),
          isNotNull(emailLogsTable.retriesExhaustedAt),
          isNotNull(emailLogsTable.reservationId),
        ),
      )
      .orderBy(desc(emailLogsTable.createdAt));

    const byReservation = new Map<string, { exhaustedAt: Date; latestLogId: string }>();
    for (const log of exhaustedLogs) {
      const rid = log.reservationId!;
      const exhaustedAt = log.retriesExhaustedAt!;
      const existing = byReservation.get(rid);
      if (!existing || exhaustedAt > existing.exhaustedAt) {
        byReservation.set(rid, { exhaustedAt, latestLogId: log.id });
      }
    }

    if (byReservation.size === 0) {
      res.json([]);
      return;
    }

    const allExhaustedIds = [...byReservation.keys()];

    const manualResends = await db
      .select({ reservationId: emailLogsTable.reservationId, createdAt: emailLogsTable.createdAt })
      .from(emailLogsTable)
      .where(
        and(
          eq(emailLogsTable.tenantId, me.tenantId),
          inArray(emailLogsTable.reservationId, allExhaustedIds),
          eq(emailLogsTable.status, "sent"),
          eq(emailLogsTable.isAutoRetry, false),
          notLike(emailLogsTable.subject, "Alerta: Falha no e-mail de confirmação%"),
          notLike(emailLogsTable.subject, "Reserva Cancelada%"),
          notLike(emailLogsTable.subject, "Nova reserva%"),
        ),
      );

    const resolvedIds = new Set<string>();
    for (const resend of manualResends) {
      const rid = resend.reservationId!;
      const sentAt = resend.createdAt;
      const { exhaustedAt } = byReservation.get(rid)!;
      if (sentAt >= exhaustedAt) resolvedIds.add(rid);
    }

    const unresolvedIds = allExhaustedIds.filter((rid) => !resolvedIds.has(rid));
    if (unresolvedIds.length === 0) {
      res.json([]);
      return;
    }

    const latestFailedLogs = await db
      .select({ id: emailLogsTable.id, reservationId: emailLogsTable.reservationId })
      .from(emailLogsTable)
      .where(
        and(
          eq(emailLogsTable.tenantId, me.tenantId),
          inArray(emailLogsTable.reservationId, unresolvedIds),
          eq(emailLogsTable.status, "failed"),
        ),
      )
      .orderBy(desc(emailLogsTable.createdAt));

    const latestFailedByReservation = new Map<string, string>();
    for (const log of latestFailedLogs) {
      if (!latestFailedByReservation.has(log.reservationId!)) {
        latestFailedByReservation.set(log.reservationId!, log.id);
      }
    }

    const details = await db
      .select({
        reservationId: reservationsTable.id,
        reservationNumber: reservationsTable.reservationNumber,
        voucherCode: reservationsTable.voucherCode,
        clientName: clientsTable.name,
        clientEmail: clientsTable.email,
      })
      .from(reservationsTable)
      .innerJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
      .where(inArray(reservationsTable.id, unresolvedIds));

    const result = details.map((d) => ({
      emailLogId: latestFailedByReservation.get(d.reservationId) ?? null,
      reservationId: d.reservationId,
      reservationNumber: d.reservationNumber ?? d.voucherCode,
      clientName: d.clientName,
      clientEmail: d.clientEmail,
      exhaustedAt: byReservation.get(d.reservationId)!.exhaustedAt.toISOString(),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/email-logs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const { reservationId } = req.query as Record<string, string>;
    const isReservationScoped = !!reservationId;
    const allowedRoles = isReservationScoped ? ALL_STAFF_ROLES : MANAGEMENT_ROLES;
    if (!allowedRoles.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }
    const conditions = [eq(emailLogsTable.tenantId, me.tenantId)];
    if (isReservationScoped) conditions.push(eq(emailLogsTable.reservationId, reservationId));
    const logs = await db
      .select()
      .from(emailLogsTable)
      .where(and(...conditions))
      .orderBy(desc(emailLogsTable.createdAt))
      .limit(200);
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

router.post("/email-logs/:id/resend", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }
    const result = await resendEmailLog(req.params.id, me.tenantId);
    if (!result.ok) {
      const status = result.error === "Only failed emails can be resent" ? 422 : 404;
      res.status(status).json({ error: result.error ?? "Not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;

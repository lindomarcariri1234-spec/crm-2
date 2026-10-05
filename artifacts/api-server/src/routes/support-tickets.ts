import { Router, type NextFunction } from "express";
import {
  chatbotConversationsTable,
  chatbotMessagesTable,
  clientsTable,
  db,
  supportQueuesTable,
  supportQuickRepliesTable,
  supportTicketEventsTable,
  supportTicketsTable,
  tenantIntegrationsTable,
  usersTable,
} from "@workspace/db";
import { ALL_STAFF_ROLES, MANAGEMENT_ROLES } from "@workspace/permissions";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth } from "../lib/tenant.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors.js";
import { generateId } from "../lib/id.js";
import { deliverAttendanceReply } from "../services/whatsapp-attendance.js";
import { ensureSupportTicketForConversation, recordSupportTicketEvent } from "../services/support-ticketing.js";

const router = Router();

const TicketFilters = z.object({
  status: z.enum(["all", "pending", "open", "resolved"]).default("all"),
  queueId: z.string().optional(),
  assignedUserId: z.string().optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(50_000).default(0),
});

const ActionBody = z.object({
  action: z.enum(["claim", "assign", "transfer", "resolve", "reopen", "set_priority"]),
  assignedUserId: z.string().nullable().optional(),
  queueId: z.string().nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
}).superRefine((value, context) => {
  if (
    value.action === "assign"
    && (value.assignedUserId === undefined || value.assignedUserId === "")
  ) {
    context.addIssue({ code: "custom", message: "Informe quem receberá o ticket.", path: ["assignedUserId"] });
  }
  if (value.action === "transfer" && value.queueId === undefined) {
    context.addIssue({ code: "custom", message: "Informe a fila de destino.", path: ["queueId"] });
  }
  if (value.action === "set_priority" && !value.priority) {
    context.addIssue({ code: "custom", message: "Informe a prioridade.", path: ["priority"] });
  }
});

const ReplyBody = z.object({
  content: z.string().trim().min(1).max(4000),
  idempotencyKey: z.string().uuid(),
});

const CreateQueueBody = z.object({
  name: z.string().trim().min(2).max(80),
});
const UpdateQueueBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Informe ao menos uma alteração.");

const QuickReplyBody = z.object({
  title: z.string().trim().min(2).max(80),
  shortcut: z.string().trim().min(1).max(32),
  content: z.string().trim().min(1).max(2000),
  queueId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
const UpdateQuickReplyBody = QuickReplyBody.partial()
  .refine((value) => Object.keys(value).length > 0, "Informe ao menos uma alteração.");

function isStaff(role: string): boolean {
  return ALL_STAFF_ROLES.includes(role);
}

function canManage(role: string): boolean {
  return MANAGEMENT_ROLES.includes(role);
}

function slugify(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function requireStaff(me: { role: string }, next: NextFunction): boolean {
  if (isStaff(me.role)) return true;
  next(new ForbiddenError("Apenas a equipe da agência pode acessar os tickets.", "FORBIDDEN_ROLE"));
  return false;
}

function requireManager(me: { role: string }, next: NextFunction): boolean {
  if (canManage(me.role)) return true;
  next(new ForbiddenError("Apenas administradores e gerentes podem alterar esta configuração.", "FORBIDDEN_ROLE"));
  return false;
}

function ticketListQuery(tenantId: string) {
  return db.select({
    id: supportTicketsTable.id,
    tenantId: supportTicketsTable.tenantId,
    conversationId: supportTicketsTable.conversationId,
    clientId: supportTicketsTable.clientId,
    clientName: clientsTable.name,
    clientPhone: sql<string | null>`COALESCE(${clientsTable.whatsapp}, ${clientsTable.phone})`,
    channel: chatbotConversationsTable.channel,
    whatsappConnectionName: sql<string | null>`COALESCE(NULLIF(${tenantIntegrationsTable.name}, ''), ${tenantIntegrationsTable.config} ->> 'instanceName')`,
    queueId: supportTicketsTable.queueId,
    queueName: supportQueuesTable.name,
    assignedUserId: supportTicketsTable.assignedUserId,
    assignedUserName: usersTable.name,
    status: supportTicketsTable.status,
    priority: supportTicketsTable.priority,
    subject: supportTicketsTable.subject,
    lastMessageAt: supportTicketsTable.lastMessageAt,
    firstResponseAt: supportTicketsTable.firstResponseAt,
    resolvedAt: supportTicketsTable.resolvedAt,
    createdAt: supportTicketsTable.createdAt,
    lastMessageContent: sql<string | null>`(
      SELECT cm.content
      FROM chatbot_messages cm
      WHERE cm.tenant_id = ${tenantId}
        AND cm.conversation_id = ${supportTicketsTable.conversationId}
        AND (
          cm.ticket_id = ${supportTicketsTable.id}
          OR (cm.ticket_id IS NULL AND cm.sent_at <= ${supportTicketsTable.createdAt})
        )
      ORDER BY cm.sent_at DESC, cm.id DESC
      LIMIT 1
    )`,
    messageCount: sql<number>`(
      SELECT count(*)::int
      FROM chatbot_messages cm
      WHERE cm.tenant_id = ${tenantId}
        AND cm.conversation_id = ${supportTicketsTable.conversationId}
        AND (
          cm.ticket_id = ${supportTicketsTable.id}
          OR (cm.ticket_id IS NULL AND cm.sent_at <= ${supportTicketsTable.createdAt})
        )
    )`.mapWith(Number),
  }).from(supportTicketsTable)
    .leftJoin(chatbotConversationsTable, and(
      eq(chatbotConversationsTable.id, supportTicketsTable.conversationId),
      eq(chatbotConversationsTable.tenantId, tenantId),
    ))
    .leftJoin(tenantIntegrationsTable, and(
      eq(tenantIntegrationsTable.id, supportTicketsTable.whatsappIntegrationId),
      eq(tenantIntegrationsTable.tenantId, tenantId),
      eq(tenantIntegrationsTable.type, "whatsapp_evolution"),
    ))
    .leftJoin(clientsTable, and(
      eq(clientsTable.id, supportTicketsTable.clientId),
      eq(clientsTable.tenantId, tenantId),
    ))
    .leftJoin(supportQueuesTable, and(
      eq(supportQueuesTable.id, supportTicketsTable.queueId),
      eq(supportQueuesTable.tenantId, tenantId),
    ))
    .leftJoin(usersTable, and(
      eq(usersTable.id, supportTicketsTable.assignedUserId),
      eq(usersTable.tenantId, tenantId),
    ));
}

router.get("/support/tickets", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next)) return;
    const parsed = TicketFilters.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.message, "VALIDATION_ERROR"));
      return;
    }
    const { status, queueId, assignedUserId, search, limit, offset } = parsed.data;
    const conditions = [eq(supportTicketsTable.tenantId, me.tenantId)];
    if (status !== "all") conditions.push(eq(supportTicketsTable.status, status));
    if (queueId) conditions.push(eq(supportTicketsTable.queueId, queueId));
    if (assignedUserId === "mine") conditions.push(eq(supportTicketsTable.assignedUserId, me.id));
    else if (assignedUserId === "unassigned") conditions.push(isNull(supportTicketsTable.assignedUserId));
    else if (assignedUserId) conditions.push(eq(supportTicketsTable.assignedUserId, assignedUserId));
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(or(
        ilike(supportTicketsTable.subject, pattern),
        ilike(clientsTable.name, pattern),
        ilike(clientsTable.whatsapp, pattern),
        ilike(clientsTable.phone, pattern),
      )!);
    }

    const items = await ticketListQuery(me.tenantId)
      .where(and(...conditions))
      .orderBy(desc(supportTicketsTable.lastMessageAt), desc(supportTicketsTable.id))
      .limit(limit)
      .offset(offset);
    res.json({ items, limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get("/support/tickets/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next)) return;
    const [ticket] = await ticketListQuery(me.tenantId)
      .where(and(
        eq(supportTicketsTable.id, req.params.id),
        eq(supportTicketsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!ticket) {
      next(new NotFoundError("Ticket não encontrado.", "NOT_FOUND"));
      return;
    }
    res.json(ticket);
  } catch (err) {
    next(err);
  }
});

router.get("/support/tickets/:id/events", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next)) return;
    const [ticket] = await db.select({ id: supportTicketsTable.id })
      .from(supportTicketsTable)
      .where(and(
        eq(supportTicketsTable.id, req.params.id),
        eq(supportTicketsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!ticket) {
      next(new NotFoundError("Ticket não encontrado.", "NOT_FOUND"));
      return;
    }
    const events = await db.select({
      id: supportTicketEventsTable.id,
      eventType: supportTicketEventsTable.eventType,
      details: supportTicketEventsTable.details,
      createdAt: supportTicketEventsTable.createdAt,
      actorUserId: supportTicketEventsTable.actorUserId,
      actorName: usersTable.name,
    }).from(supportTicketEventsTable)
      .leftJoin(usersTable, and(
        eq(usersTable.id, supportTicketEventsTable.actorUserId),
        eq(usersTable.tenantId, me.tenantId),
      ))
      .where(and(
        eq(supportTicketEventsTable.ticketId, ticket.id),
        eq(supportTicketEventsTable.tenantId, me.tenantId),
      ))
      .orderBy(desc(supportTicketEventsTable.createdAt));
    res.json(events);
  } catch (err) {
    next(err);
  }
});

router.post("/support/tickets/:id/actions", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next)) return;
    const parsed = ActionBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.message, "VALIDATION_ERROR"));
      return;
    }
    const action = parsed.data;
    if (["assign", "transfer", "reopen", "set_priority"].includes(action.action) && !requireManager(me, next)) return;

    const result = await db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(supportTicketsTable)
        .where(and(
          eq(supportTicketsTable.id, req.params.id),
          eq(supportTicketsTable.tenantId, me.tenantId),
        ))
        .for("update")
        .limit(1);
      if (!ticket) return { error: "not_found" as const };

      const now = new Date();
      let updates: Partial<typeof supportTicketsTable.$inferInsert> = { updatedAt: now };
      let eventType = "";
      let details: Record<string, unknown> = {};

      if (action.action === "claim") {
        if (ticket.status === "resolved") return { error: "resolved" as const };
        if (ticket.assignedUserId && ticket.assignedUserId !== me.id) return { error: "assigned" as const };
        updates = { ...updates, assignedUserId: me.id, status: "open", resolvedAt: null };
        eventType = "ticket_claimed";
        details = { userId: me.id };
      } else if (action.action === "assign") {
        if (ticket.status === "resolved") return { error: "resolved" as const };
        if (action.assignedUserId === null) {
          updates = { ...updates, assignedUserId: null, status: "pending", resolvedAt: null };
          eventType = "ticket_unassigned";
        } else if (action.assignedUserId !== undefined) {
          const [assignedUser] = await tx.select({ id: usersTable.id })
            .from(usersTable)
            .where(and(
              eq(usersTable.id, action.assignedUserId),
              eq(usersTable.tenantId, me.tenantId),
              eq(usersTable.isActive, true),
            ))
            .limit(1);
          if (!assignedUser) return { error: "user_not_found" as const };
          updates = { ...updates, assignedUserId: assignedUser.id, status: "open", resolvedAt: null };
          eventType = "ticket_assigned";
          details = { userId: assignedUser.id };
        } else {
          return { error: "invalid_action" as const };
        }
      } else if (action.action === "transfer") {
        if (ticket.status === "resolved") return { error: "resolved" as const };
        let queueId: string | null = null;
        if (action.queueId !== null) {
          const [queue] = await tx.select({ id: supportQueuesTable.id })
            .from(supportQueuesTable)
            .where(and(
              eq(supportQueuesTable.id, action.queueId!),
              eq(supportQueuesTable.tenantId, me.tenantId),
              eq(supportQueuesTable.isActive, true),
            ))
            .limit(1);
          if (!queue) return { error: "queue_not_found" as const };
          queueId = queue.id;
        }
        let assignedUserId = ticket.assignedUserId;
        if (action.assignedUserId !== undefined) {
          if (action.assignedUserId === null) {
            assignedUserId = null;
          } else {
            const [user] = await tx.select({ id: usersTable.id })
              .from(usersTable)
              .where(and(
                eq(usersTable.id, action.assignedUserId),
                eq(usersTable.tenantId, me.tenantId),
                eq(usersTable.isActive, true),
              ))
              .limit(1);
            if (!user) return { error: "user_not_found" as const };
            assignedUserId = user.id;
          }
        }
        updates = {
          ...updates,
          queueId,
          assignedUserId,
          status: assignedUserId ? "open" : "pending",
          resolvedAt: null,
        };
        eventType = "ticket_transferred";
        details = { queueId, assignedUserId };
      } else if (action.action === "resolve") {
        if (ticket.status === "resolved") return { ticket };
        if (ticket.assignedUserId && ticket.assignedUserId !== me.id && !canManage(me.role)) {
          return { error: "assigned" as const };
        }
        updates = { ...updates, status: "resolved", resolvedAt: now };
        eventType = "ticket_resolved";
        details = {};
      } else if (action.action === "reopen") {
        if (ticket.status !== "resolved") return { error: "not_resolved" as const };
        updates = { ...updates, status: "pending", assignedUserId: null, resolvedAt: null };
        eventType = "ticket_reopened";
        details = { reason: "staff_action" };
      } else {
        if (ticket.status === "resolved") return { error: "resolved" as const };
        updates = { ...updates, priority: action.priority! };
        eventType = "ticket_priority_changed";
        details = { priority: action.priority };
      }

      const [updated] = await tx.update(supportTicketsTable)
        .set(updates)
        .where(and(
          eq(supportTicketsTable.id, ticket.id),
          eq(supportTicketsTable.tenantId, me.tenantId),
        ))
        .returning();
      if (!updated) return { error: "not_found" as const };

      if (["claim", "assign", "transfer", "reopen"].includes(action.action)) {
        await tx.update(chatbotConversationsTable)
          .set({
            status: "human_handoff",
            assignedUserId: updated.assignedUserId,
          })
          .where(and(
            eq(chatbotConversationsTable.id, ticket.conversationId),
            eq(chatbotConversationsTable.tenantId, me.tenantId),
          ));
      }
      await recordSupportTicketEvent(tx, {
        tenantId: me.tenantId,
        ticketId: ticket.id,
        actorUserId: me.id,
        eventType,
        details,
      });
      return { ticket: updated };
    });

    if ("error" in result) {
      if (result.error === "not_found") next(new NotFoundError("Ticket não encontrado.", "NOT_FOUND"));
      else if (result.error === "user_not_found") next(new NotFoundError("Membro da equipe não encontrado ou inativo.", "USER_NOT_FOUND"));
      else if (result.error === "queue_not_found") next(new NotFoundError("Fila não encontrada ou inativa.", "QUEUE_NOT_FOUND"));
      else if (result.error === "assigned") next(new ConflictError("Este ticket está atribuído a outra pessoa.", "TICKET_ASSIGNED"));
      else if (result.error === "not_resolved") next(new ConflictError("Só é possível reabrir um ticket resolvido.", "TICKET_NOT_RESOLVED"));
      else next(new ConflictError("Esta ação não está disponível para o ticket resolvido.", "TICKET_RESOLVED"));
      return;
    }
    res.json(result.ticket);
  } catch (err) {
    next(err);
  }
});

router.post("/support/tickets/:id/reply", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next)) return;
    const parsed = ReplyBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.message, "VALIDATION_ERROR"));
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(supportTicketsTable)
        .where(and(
          eq(supportTicketsTable.id, req.params.id),
          eq(supportTicketsTable.tenantId, me.tenantId),
        ))
        .for("update")
        .limit(1);
      if (!ticket) return { error: "not_found" as const };
      if (ticket.status === "resolved") return { error: "resolved" as const };
      if (ticket.assignedUserId && ticket.assignedUserId !== me.id && !canManage(me.role)) {
        return { error: "assigned" as const };
      }

      const [conversation] = await tx.select({
        id: chatbotConversationsTable.id,
        clientId: chatbotConversationsTable.clientId,
        sessionId: chatbotConversationsTable.sessionId,
        status: chatbotConversationsTable.status,
        whatsappIntegrationId: chatbotConversationsTable.whatsappIntegrationId,
        clientWhatsappOptIn: clientsTable.whatsappOptIn,
      }).from(chatbotConversationsTable)
        .leftJoin(clientsTable, and(
          eq(clientsTable.id, chatbotConversationsTable.clientId),
          eq(clientsTable.tenantId, me.tenantId),
        ))
        .where(and(
          eq(chatbotConversationsTable.id, ticket.conversationId),
          eq(chatbotConversationsTable.tenantId, me.tenantId),
          eq(chatbotConversationsTable.channel, "whatsapp"),
        ))
        .limit(1);
      if (!conversation?.sessionId || conversation.status === "opted_out") return { error: "unavailable" as const };
      if (conversation.clientId && conversation.clientWhatsappOptIn !== true) return { error: "opted_out" as const };
      if (ticket.whatsappIntegrationId !== conversation.whatsappIntegrationId) {
        return { error: "connection_mismatch" as const };
      }

      const now = new Date();
      const sourceMessageId = `support-staff:${parsed.data.idempotencyKey}`;
      const messageId = generateId();
      const [created] = await tx.insert(chatbotMessagesTable).values({
        id: messageId,
        tenantId: me.tenantId,
        conversationId: conversation.id,
        ticketId: ticket.id,
        sourceMessageId,
        role: "assistant",
        content: parsed.data.content,
        isBot: false,
        deliveryStatus: "pending",
        deliveryAttempts: 0,
      }).onConflictDoNothing().returning({ id: chatbotMessagesTable.id });

      const [existing] = created ? [created] : await tx.select({
        id: chatbotMessagesTable.id,
        content: chatbotMessagesTable.content,
        conversationId: chatbotMessagesTable.conversationId,
        ticketId: chatbotMessagesTable.ticketId,
      }).from(chatbotMessagesTable)
        .where(and(
          eq(chatbotMessagesTable.tenantId, me.tenantId),
          eq(chatbotMessagesTable.sourceMessageId, sourceMessageId),
        ))
        .limit(1);
      if (!existing) return { error: "message_failed" as const };
      if (
        "content" in existing
        && (
          existing.content !== parsed.data.content
          || existing.conversationId !== conversation.id
          || existing.ticketId !== ticket.id
        )
      ) {
        return { error: "idempotency_conflict" as const };
      }

      const claimed = !ticket.assignedUserId;
      await tx.update(supportTicketsTable)
        .set({
          assignedUserId: ticket.assignedUserId ?? me.id,
          status: "open",
          lastMessageAt: now,
          firstResponseAt: ticket.firstResponseAt ?? now,
          resolvedAt: null,
          updatedAt: now,
        })
        .where(and(
          eq(supportTicketsTable.id, ticket.id),
          eq(supportTicketsTable.tenantId, me.tenantId),
        ));
      await tx.update(chatbotConversationsTable)
        .set({ status: "human_handoff", assignedUserId: ticket.assignedUserId ?? me.id })
        .where(and(
          eq(chatbotConversationsTable.id, conversation.id),
          eq(chatbotConversationsTable.tenantId, me.tenantId),
        ));
      if (created && claimed) {
        await recordSupportTicketEvent(tx, {
          tenantId: me.tenantId,
          ticketId: ticket.id,
          actorUserId: me.id,
          eventType: "ticket_claimed",
          details: { userId: me.id },
        });
      }
      return { messageId: existing.id };
    });

    if ("error" in result) {
      if (result.error === "not_found") next(new NotFoundError("Ticket não encontrado.", "NOT_FOUND"));
      else if (result.error === "resolved") next(new ConflictError("Este ticket já foi resolvido.", "TICKET_RESOLVED"));
      else if (result.error === "assigned") next(new ConflictError("Este ticket está atribuído a outra pessoa.", "TICKET_ASSIGNED"));
      else if (result.error === "unavailable") next(new NotFoundError("Conversa de WhatsApp indisponível.", "NOT_FOUND"));
      else if (result.error === "opted_out") next(new ForbiddenError("O cliente não autorizou mensagens por WhatsApp.", "WHATSAPP_OPTED_OUT"));
      else if (result.error === "connection_mismatch") next(new ConflictError("A conexão WhatsApp do ticket mudou. Atualize o ticket antes de responder.", "WHATSAPP_CONNECTION_MISMATCH"));
      else if (result.error === "idempotency_conflict") next(new ConflictError("A chave de envio já foi usada com outro conteúdo.", "IDEMPOTENCY_CONFLICT"));
      else next(new ConflictError("Não foi possível registrar a resposta.", "WHATSAPP_REPLY_FAILED"));
      return;
    }

    const delivered = await deliverAttendanceReply({
      tenantId: me.tenantId,
      messageId: result.messageId,
    });
    const [message] = await db.select().from(chatbotMessagesTable)
      .where(and(
        eq(chatbotMessagesTable.id, result.messageId),
        eq(chatbotMessagesTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!message) {
      next(new NotFoundError("Mensagem não encontrada após o envio.", "MESSAGE_NOT_FOUND"));
      return;
    }
    res.status(delivered ? 201 : 202).json({ message, deliveryQueued: !delivered });
  } catch (err) {
    next(err);
  }
});

router.get("/support/queues", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next)) return;
    const queues = await db.select().from(supportQueuesTable)
      .where(eq(supportQueuesTable.tenantId, me.tenantId))
      .orderBy(desc(supportQueuesTable.isDefault), supportQueuesTable.name);
    res.json(queues);
  } catch (err) {
    next(err);
  }
});

router.post("/support/queues", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next) || !requireManager(me, next)) return;
    const parsed = CreateQueueBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.message, "VALIDATION_ERROR"));
      return;
    }
    const slug = slugify(parsed.data.name);
    if (!slug) {
      next(new ValidationError("Informe um nome de fila válido.", "VALIDATION_ERROR"));
      return;
    }
    const [queue] = await db.insert(supportQueuesTable).values({
      id: generateId(),
      tenantId: me.tenantId,
      name: parsed.data.name,
      slug,
    }).onConflictDoNothing().returning();
    if (!queue) {
      next(new ConflictError("Já existe uma fila com esse nome.", "QUEUE_ALREADY_EXISTS"));
      return;
    }
    res.status(201).json(queue);
  } catch (err) {
    next(err);
  }
});

router.patch("/support/queues/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next) || !requireManager(me, next)) return;
    const parsed = UpdateQueueBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.message, "VALIDATION_ERROR"));
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [queue] = await tx.select().from(supportQueuesTable)
        .where(and(
          eq(supportQueuesTable.id, req.params.id),
          eq(supportQueuesTable.tenantId, me.tenantId),
        ))
        .for("update")
        .limit(1);
      if (!queue) return { error: "not_found" as const };
      if (parsed.data.isActive === false && queue.isDefault && parsed.data.isDefault !== true) {
        return { error: "default_queue" as const };
      }
      if (parsed.data.isDefault === false && queue.isDefault) {
        return { error: "replace_default" as const };
      }
      if (parsed.data.isDefault === true && parsed.data.isActive === false) {
        return { error: "inactive_default" as const };
      }
      if (parsed.data.isDefault === true) {
        await tx.update(supportQueuesTable)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(supportQueuesTable.tenantId, me.tenantId));
      }
      const updates: Partial<typeof supportQueuesTable.$inferInsert> = {
        ...parsed.data,
        updatedAt: new Date(),
      };
      if (parsed.data.name && parsed.data.name !== queue.name) updates.slug = slugify(parsed.data.name);
      const [updated] = await tx.update(supportQueuesTable)
        .set(updates)
        .where(and(
          eq(supportQueuesTable.id, queue.id),
          eq(supportQueuesTable.tenantId, me.tenantId),
        ))
        .returning();
      return updated ? { queue: updated } : { error: "not_found" as const };
    });
    if ("error" in result) {
      if (result.error === "not_found") next(new NotFoundError("Fila não encontrada.", "NOT_FOUND"));
      else if (result.error === "default_queue") next(new ConflictError("Escolha outra fila padrão antes de arquivar esta.", "DEFAULT_QUEUE_ACTIVE"));
      else if (result.error === "replace_default") next(new ConflictError("Defina outra fila padrão antes de removê-la.", "DEFAULT_QUEUE_REQUIRED"));
      else next(new ConflictError("Uma fila inativa não pode ser a fila padrão.", "INACTIVE_DEFAULT_QUEUE"));
      return;
    }
    res.json(result.queue);
  } catch (err) {
    next(err);
  }
});

router.get("/support/quick-replies", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next)) return;
    const includeInactive = req.query["includeInactive"] === "true" && canManage(me.role);
    const conditions = [eq(supportQuickRepliesTable.tenantId, me.tenantId)];
    if (!includeInactive) conditions.push(eq(supportQuickRepliesTable.isActive, true));
    const replies = await db.select().from(supportQuickRepliesTable)
      .where(and(...conditions))
      .orderBy(supportQuickRepliesTable.title);
    res.json(replies);
  } catch (err) {
    next(err);
  }
});

router.post("/support/quick-replies", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next) || !requireManager(me, next)) return;
    const parsed = QuickReplyBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.message, "VALIDATION_ERROR"));
      return;
    }
    if (parsed.data.queueId) {
      const [queue] = await db.select({ id: supportQueuesTable.id }).from(supportQueuesTable)
        .where(and(
          eq(supportQueuesTable.id, parsed.data.queueId),
          eq(supportQueuesTable.tenantId, me.tenantId),
          eq(supportQueuesTable.isActive, true),
        ))
        .limit(1);
      if (!queue) {
        next(new NotFoundError("Fila não encontrada ou inativa.", "QUEUE_NOT_FOUND"));
        return;
      }
    }
    const [reply] = await db.insert(supportQuickRepliesTable).values({
      id: generateId(),
      tenantId: me.tenantId,
      title: parsed.data.title,
      shortcut: parsed.data.shortcut,
      content: parsed.data.content,
      queueId: parsed.data.queueId ?? null,
      isActive: parsed.data.isActive ?? true,
    }).onConflictDoNothing().returning();
    if (!reply) {
      next(new ConflictError("Já existe uma resposta rápida com esse atalho.", "QUICK_REPLY_ALREADY_EXISTS"));
      return;
    }
    res.status(201).json(reply);
  } catch (err) {
    next(err);
  }
});

router.patch("/support/quick-replies/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next) || !requireManager(me, next)) return;
    const parsed = UpdateQuickReplyBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.message, "VALIDATION_ERROR"));
      return;
    }
    if (parsed.data.queueId) {
      const [queue] = await db.select({ id: supportQueuesTable.id }).from(supportQueuesTable)
        .where(and(
          eq(supportQueuesTable.id, parsed.data.queueId),
          eq(supportQueuesTable.tenantId, me.tenantId),
          eq(supportQueuesTable.isActive, true),
        ))
        .limit(1);
      if (!queue) {
        next(new NotFoundError("Fila não encontrada ou inativa.", "QUEUE_NOT_FOUND"));
        return;
      }
    }
    const updates: Partial<typeof supportQuickRepliesTable.$inferInsert> = {
      ...parsed.data,
      updatedAt: new Date(),
    };
    const [reply] = await db.update(supportQuickRepliesTable)
      .set(updates)
      .where(and(
        eq(supportQuickRepliesTable.id, req.params.id),
        eq(supportQuickRepliesTable.tenantId, me.tenantId),
      ))
      .returning();
    if (!reply) {
      next(new NotFoundError("Resposta rápida não encontrada.", "NOT_FOUND"));
      return;
    }
    res.json(reply);
  } catch (err) {
    next(err);
  }
});

router.delete("/support/quick-replies/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me || !requireStaff(me, next) || !requireManager(me, next)) return;
    const [reply] = await db.update(supportQuickRepliesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(supportQuickRepliesTable.id, req.params.id),
        eq(supportQuickRepliesTable.tenantId, me.tenantId),
      ))
      .returning({ id: supportQuickRepliesTable.id });
    if (!reply) {
      next(new NotFoundError("Resposta rápida não encontrada.", "NOT_FOUND"));
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router, type NextFunction } from "express";
import { db, chatbotConversationsTable, chatbotMessagesTable, clientsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ADMIN_ROLES } from '../lib/tenant';
import { deliverAttendanceReply } from "../services/whatsapp-attendance";
import { recomputeClientClassification, recordClientClassificationEvent } from "../services/client-classification.js";
import { ACTIONS, hasPermission, RESOURCES } from "@workspace/permissions";

const router = Router();

const CreateConversationBody = z.object({
  clientId: z.string().optional(),
  channel: z.enum(["webchat", "whatsapp", "email"]).optional(),
  sessionId: z.string().optional(),
});

const CreateMessageBody = z.object({
  conversationId: z.string(),
  role: z.enum(["user", "assistant", "system"]).optional(),
  content: z.string().min(1),
  mediaUrl: z.string().optional(),
  isBot: z.boolean().optional(),
});

const ReplyConversationBody = z.object({
  content: z.string().trim().min(1).max(4000),
  idempotencyKey: z.string().uuid(),
});

router.get("/chatbot-conversations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const conversations = await db.select({
      id: chatbotConversationsTable.id,
      tenantId: chatbotConversationsTable.tenantId,
      clientId: chatbotConversationsTable.clientId,
      channel: chatbotConversationsTable.channel,
      status: chatbotConversationsTable.status,
      assignedUserId: chatbotConversationsTable.assignedUserId,
      sessionId: chatbotConversationsTable.sessionId,
      metadata: chatbotConversationsTable.metadata,
      startedAt: chatbotConversationsTable.startedAt,
      endedAt: chatbotConversationsTable.endedAt,
      createdAt: chatbotConversationsTable.createdAt,
      clientName: clientsTable.name,
      lastMessageId: sql<string | null>`(
        SELECT ${chatbotMessagesTable.id}
        FROM ${chatbotMessagesTable}
        WHERE ${chatbotMessagesTable.conversationId} = ${chatbotConversationsTable.id}
          AND ${chatbotMessagesTable.tenantId} = ${me.tenantId}
        ORDER BY ${chatbotMessagesTable.sentAt} DESC, ${chatbotMessagesTable.id} DESC
        LIMIT 1
      )`,
      lastMessageContent: sql<string | null>`(
        SELECT ${chatbotMessagesTable.content}
        FROM ${chatbotMessagesTable}
        WHERE ${chatbotMessagesTable.conversationId} = ${chatbotConversationsTable.id}
          AND ${chatbotMessagesTable.tenantId} = ${me.tenantId}
        ORDER BY ${chatbotMessagesTable.sentAt} DESC, ${chatbotMessagesTable.id} DESC
        LIMIT 1
      )`,
      lastMessageAt: sql<Date | null>`(
        SELECT ${chatbotMessagesTable.sentAt}
        FROM ${chatbotMessagesTable}
        WHERE ${chatbotMessagesTable.conversationId} = ${chatbotConversationsTable.id}
          AND ${chatbotMessagesTable.tenantId} = ${me.tenantId}
        ORDER BY ${chatbotMessagesTable.sentAt} DESC, ${chatbotMessagesTable.id} DESC
        LIMIT 1
      )`,
      lastMessageRole: sql<string | null>`(
        SELECT ${chatbotMessagesTable.role}
        FROM ${chatbotMessagesTable}
        WHERE ${chatbotMessagesTable.conversationId} = ${chatbotConversationsTable.id}
          AND ${chatbotMessagesTable.tenantId} = ${me.tenantId}
        ORDER BY ${chatbotMessagesTable.sentAt} DESC, ${chatbotMessagesTable.id} DESC
        LIMIT 1
      )`,
      lastMessageIsBot: sql<boolean | null>`(
        SELECT ${chatbotMessagesTable.isBot}
        FROM ${chatbotMessagesTable}
        WHERE ${chatbotMessagesTable.conversationId} = ${chatbotConversationsTable.id}
          AND ${chatbotMessagesTable.tenantId} = ${me.tenantId}
        ORDER BY ${chatbotMessagesTable.sentAt} DESC, ${chatbotMessagesTable.id} DESC
        LIMIT 1
      )`,
      lastMessageStatus: sql<string | null>`(
        SELECT ${chatbotMessagesTable.deliveryStatus}
        FROM ${chatbotMessagesTable}
        WHERE ${chatbotMessagesTable.conversationId} = ${chatbotConversationsTable.id}
          AND ${chatbotMessagesTable.tenantId} = ${me.tenantId}
        ORDER BY ${chatbotMessagesTable.sentAt} DESC, ${chatbotMessagesTable.id} DESC
        LIMIT 1
      )`,
      messageCount: sql<number>`(
        SELECT count(*)::int
        FROM ${chatbotMessagesTable}
        WHERE ${chatbotMessagesTable.conversationId} = ${chatbotConversationsTable.id}
          AND ${chatbotMessagesTable.tenantId} = ${me.tenantId}
      )`.mapWith(Number),
    }).from(chatbotConversationsTable)
      .leftJoin(clientsTable, and(
        eq(clientsTable.id, chatbotConversationsTable.clientId),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(eq(chatbotConversationsTable.tenantId, me.tenantId))
      .orderBy(desc(chatbotConversationsTable.createdAt));
    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

router.post("/chatbot-conversations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = CreateConversationBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(chatbotConversationsTable).values({ id, tenantId: me.tenantId, ...parsed.data });
    const [conv] = await db.select().from(chatbotConversationsTable).where(eq(chatbotConversationsTable.id, id)).limit(1);
    res.status(201).json(conv);
  } catch (err) {
    next(err);
  }
});

router.get("/chatbot-conversations/:id/messages", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const [conv] = await db.select().from(chatbotConversationsTable)
      .where(and(eq(chatbotConversationsTable.id, req.params.id), eq(chatbotConversationsTable.tenantId, me.tenantId))).limit(1);
    if (!conv) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    const messages = await db.select().from(chatbotMessagesTable)
      .where(and(
        eq(chatbotMessagesTable.conversationId, req.params.id),
        eq(chatbotMessagesTable.tenantId, me.tenantId),
      ))
      .orderBy(chatbotMessagesTable.sentAt);
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

router.post("/chatbot-messages", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = CreateMessageBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const [conv] = await db.select().from(chatbotConversationsTable)
      .where(and(
        eq(chatbotConversationsTable.id, parsed.data.conversationId),
        eq(chatbotConversationsTable.tenantId, me.tenantId),
      )).limit(1);
    if (!conv) { next(new NotFoundError("Conversation not found or does not belong to your tenant", "NOT_FOUND")); return; }
    const id = generateId();
    await db.insert(chatbotMessagesTable).values({ id, tenantId: me.tenantId, ...parsed.data });
    const [msg] = await db.select().from(chatbotMessagesTable).where(eq(chatbotMessagesTable.id, id)).limit(1);
    res.status(201).json(msg);
  } catch (err) {
    next(err);
  }
});

router.patch("/chatbot-conversations/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = z.object({
      status: z.string().optional(),
      assignedUserId: z.string().optional(),
      endedAt: z.string().optional(),
      clientId: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const changesConversationOperations =
      parsed.data.status !== undefined ||
      parsed.data.assignedUserId !== undefined ||
      parsed.data.endedAt !== undefined;
    if (changesConversationOperations && !ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }
    if (parsed.data.clientId !== undefined && !hasPermission(me.role, RESOURCES.CLIENTS, ACTIONS.EDIT)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM chatbot_conversations
        WHERE id = ${req.params.id} AND tenant_id = ${me.tenantId}
        FOR UPDATE
      `);
      const [current] = await tx.select().from(chatbotConversationsTable)
        .where(and(eq(chatbotConversationsTable.id, req.params.id), eq(chatbotConversationsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!current) return { error: "conversation" as const };

      if (parsed.data.clientId && parsed.data.clientId !== current.clientId) {
        const [target] = await tx.select({ id: clientsTable.id }).from(clientsTable)
          .where(and(eq(clientsTable.id, parsed.data.clientId), eq(clientsTable.tenantId, me.tenantId)))
          .limit(1);
        if (!target) return { error: "client" as const };
      }

      const updates: Partial<typeof chatbotConversationsTable.$inferInsert> = {};
      if (parsed.data.status !== undefined) updates.status = parsed.data.status;
      if (parsed.data.assignedUserId !== undefined) updates.assignedUserId = parsed.data.assignedUserId || null;
      if (parsed.data.endedAt !== undefined) updates.endedAt = parsed.data.endedAt ? new Date(parsed.data.endedAt) : null;
      const clientChanged = parsed.data.clientId !== undefined && parsed.data.clientId !== current.clientId;
      if (clientChanged) updates.clientId = parsed.data.clientId;
      if (Object.keys(updates).length > 0) {
        await tx.update(chatbotConversationsTable).set(updates)
          .where(and(eq(chatbotConversationsTable.id, current.id), eq(chatbotConversationsTable.tenantId, me.tenantId)));
      }

      if (clientChanged) {
        const now = new Date();
        if (current.clientId) {
          await recordClientClassificationEvent({
            tenantId: me.tenantId,
            clientId: current.clientId,
            eventType: "manual_whatsapp_unassociation",
            idempotencyKey: `whatsapp-unassociate:${current.id}:${now.toISOString()}`,
            sourceType: "chatbot_conversation",
            sourceId: current.id,
            actorId: me.id,
            reason: "A equipe removeu ou alterou o vínculo desta conversa com o cadastro.",
            occurredAt: now,
          }, tx);
          await recomputeClientClassification({
            tenantId: me.tenantId,
            clientId: current.clientId,
            trigger: "manual_whatsapp_unassociation",
            sourceId: current.id,
            actorId: me.id,
            reason: "Vínculo manual da conversa alterado pela equipe.",
            occurredAt: now,
          }, tx);
        }
        if (parsed.data.clientId) {
          await recordClientClassificationEvent({
            tenantId: me.tenantId,
            clientId: parsed.data.clientId,
            eventType: "manual_whatsapp_association",
            idempotencyKey: `whatsapp-associate:${current.id}:${parsed.data.clientId}:${now.toISOString()}`,
            sourceType: "chatbot_conversation",
            sourceId: current.id,
            actorId: me.id,
            reason: "A equipe associou manualmente esta conversa ao cadastro.",
            occurredAt: now,
          }, tx);
          await recomputeClientClassification({
            tenantId: me.tenantId,
            clientId: parsed.data.clientId,
            trigger: "manual_whatsapp_association",
            sourceId: current.id,
            actorId: me.id,
            reason: "A equipe confirmou manualmente a associação da conversa.",
            occurredAt: now,
          }, tx);
        }
      }

      const [updated] = await tx.select().from(chatbotConversationsTable)
        .where(and(eq(chatbotConversationsTable.id, current.id), eq(chatbotConversationsTable.tenantId, me.tenantId)))
        .limit(1);
      return { conversation: updated };
    });
    if ("error" in result) {
      next(new NotFoundError(result.error === "client" ? "Client not found" : "Not found", "NOT_FOUND"));
      return;
    }
    if (!result.conversation) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(result.conversation);
  } catch (err) {
    next(err);
  }
});

/** Human reply after an AI handoff. The phone is server-owned in sessionId and
 * never accepted from the browser, which keeps an agent inside their tenant. */
router.post("/chatbot-conversations/:id/reply", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = ReplyConversationBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const [conversation] = await db.select().from(chatbotConversationsTable)
      .where(and(
        eq(chatbotConversationsTable.id, req.params.id),
        eq(chatbotConversationsTable.tenantId, me.tenantId),
        eq(chatbotConversationsTable.channel, "whatsapp"),
      ))
      .limit(1);
    if (!conversation?.sessionId || conversation.status === "opted_out") {
      next(new NotFoundError("WhatsApp conversation not available for delivery", "NOT_FOUND"));
      return;
    }
    const sourceMessageId = `staff:${parsed.data.idempotencyKey}`;
    const id = generateId();
    const [created] = await db.insert(chatbotMessagesTable).values({
      id,
      tenantId: me.tenantId,
      conversationId: conversation.id,
      sourceMessageId,
      role: "assistant",
      content: parsed.data.content,
      isBot: false,
      deliveryStatus: "pending",
    }).onConflictDoNothing().returning({ id: chatbotMessagesTable.id });
    const [existing] = created ? [created] : await db.select({ id: chatbotMessagesTable.id })
      .from(chatbotMessagesTable)
      .where(and(
        eq(chatbotMessagesTable.tenantId, me.tenantId),
        eq(chatbotMessagesTable.sourceMessageId, sourceMessageId),
      ))
      .limit(1);
    if (!existing || !await deliverAttendanceReply({
      tenantId: me.tenantId,
      messageId: existing.id,
      phone: conversation.sessionId,
    })) {
      next(new ValidationError("Não foi possível enviar a mensagem pelo WhatsApp.", "WHATSAPP_DELIVERY_FAILED"));
      return;
    }
    await db.update(chatbotConversationsTable)
      .set({ status: "human_handoff", assignedUserId: me.id })
      .where(eq(chatbotConversationsTable.id, conversation.id));
    const [message] = await db.select().from(chatbotMessagesTable)
      .where(and(eq(chatbotMessagesTable.id, id), eq(chatbotMessagesTable.tenantId, me.tenantId)))
      .limit(1);
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

export default router;

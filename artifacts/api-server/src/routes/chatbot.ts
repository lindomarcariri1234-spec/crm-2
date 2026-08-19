import { Router, type NextFunction } from "express";
import { db, chatbotConversationsTable, chatbotMessagesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ADMIN_ROLES } from '../lib/tenant';

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

router.get("/chatbot-conversations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const conversations = await db.select().from(chatbotConversationsTable)
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
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = z.object({
      status: z.string().optional(),
      assignedUserId: z.string().optional(),
      endedAt: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const updates: Record<string, unknown> = {};
    if (parsed.data.status) updates.status = parsed.data.status;
    if (parsed.data.assignedUserId) updates.assignedUserId = parsed.data.assignedUserId;
    if (parsed.data.endedAt) updates.endedAt = new Date(parsed.data.endedAt);
    await db.update(chatbotConversationsTable).set(updates)
      .where(and(eq(chatbotConversationsTable.id, req.params.id), eq(chatbotConversationsTable.tenantId, me.tenantId)));
    const [conv] = await db.select().from(chatbotConversationsTable)
      .where(and(eq(chatbotConversationsTable.id, req.params.id), eq(chatbotConversationsTable.tenantId, me.tenantId))).limit(1);
    if (!conv) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(conv);
  } catch (err) {
    next(err);
  }
});

export default router;

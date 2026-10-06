import { Router, type NextFunction } from "express";
import {
  db,
  chatbotConversationsTable,
  chatbotMessagesTable,
  clientsTable,
  usersTable,
  supportTicketsTable,
  tenantIntegrationsTable,
} from "@workspace/db";
import { eq, and, desc, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ADMIN_ROLES } from '../lib/tenant';
import { deliverAttendanceReply } from "../services/whatsapp-attendance";
import {
  getInstagramMetaConfig,
  isInstagramReplyWindowOpen,
  INSTAGRAM_MESSAGING_TYPE,
  InstagramProviderError,
  readInstagramAccessToken,
  sendInstagramText,
} from "../services/instagram-messaging";
import { recomputeClientClassification, recordClientClassificationEvent } from "../services/client-classification.js";
import { ACTIONS, hasPermission, RESOURCES } from "@workspace/permissions";
import { extractVerifiedUploadThingKey, utapi } from "../lib/uploadthing";
import { logger } from "../lib/logger";
import { getWhatsAppInboundMediaExpirationAt } from "../lib/whatsapp-media-retention";
import { ensureSupportTicketForConversation, recordSupportTicketEvent } from "../services/support-ticketing.js";
import { broadcastSupportTicketUpdate } from "../lib/realtime.js";

const router = Router();
const DEFAULT_MEDIA_SIGNED_URL_TTL_SECONDS = 60 * 60;

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
    const ticketId = req.query["ticketId"];
    let ticketMessageFilter = undefined;
    if (ticketId !== undefined) {
      if (typeof ticketId !== "string" || ticketId.length === 0) {
        next(new ValidationError("ticketId inválido.", "VALIDATION_ERROR"));
        return;
      }
      const [ticket] = await db.select({
        id: supportTicketsTable.id,
        createdAt: supportTicketsTable.createdAt,
      }).from(supportTicketsTable)
        .where(and(
          eq(supportTicketsTable.id, ticketId),
          eq(supportTicketsTable.conversationId, conv.id),
          eq(supportTicketsTable.tenantId, me.tenantId),
        ))
        .limit(1);
      if (!ticket) { next(new NotFoundError("Ticket não encontrado.", "NOT_FOUND")); return; }
      ticketMessageFilter = or(
        eq(chatbotMessagesTable.ticketId, ticket.id),
        and(isNull(chatbotMessagesTable.ticketId), lte(chatbotMessagesTable.sentAt, ticket.createdAt)),
      );
    }
    const messages = await db.select().from(chatbotMessagesTable)
      .where(and(
        eq(chatbotMessagesTable.conversationId, req.params.id),
        eq(chatbotMessagesTable.tenantId, me.tenantId),
        ...(ticketMessageFilter ? [ticketMessageFilter] : []),
      ))
      .orderBy(chatbotMessagesTable.sentAt);
    const now = Date.now();
    const visibleMessages = await Promise.all(messages.map(async (message) => {
      const isInboundWhatsAppMedia =
        conv.channel === "whatsapp" &&
        message.role === "user" &&
        Boolean(message.mediaUrl);
      let expiresIn = DEFAULT_MEDIA_SIGNED_URL_TTL_SECONDS;
      if (isInboundWhatsAppMedia) {
        const mediaExpiresAt = getWhatsAppInboundMediaExpirationAt(message.sentAt);
        const secondsUntilExpiry = Math.floor((mediaExpiresAt.getTime() - now) / 1000);
        if (message.mediaExpiredAt || secondsUntilExpiry <= 0) {
          return {
            ...message,
            mediaUrl: null,
            mediaExpiredAt: message.mediaExpiredAt ?? mediaExpiresAt,
          };
        }
        expiresIn = Math.min(DEFAULT_MEDIA_SIGNED_URL_TTL_SECONDS, secondsUntilExpiry);
      }

      const fileKey = message.mediaUrl ? extractVerifiedUploadThingKey(message.mediaUrl) : null;
      if (!fileKey) return message;
      try {
        const signed = await utapi.generateSignedURL(fileKey, { expiresIn });
        return { ...message, mediaUrl: signed.ufsUrl };
      } catch {
        logger.warn(
          { tenantId: me.tenantId, messageId: message.id },
          "[chatbot] could not create temporary media URL",
        );
        return { ...message, mediaUrl: null };
      }
    }));
    res.json(visibleMessages);
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
      if (parsed.data.assignedUserId) {
        const [targetUser] = await tx.select({ id: usersTable.id }).from(usersTable)
          .where(and(
            eq(usersTable.id, parsed.data.assignedUserId),
            eq(usersTable.tenantId, me.tenantId),
            eq(usersTable.isActive, true),
          ))
          .limit(1);
        if (!targetUser) return { error: "user" as const };
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

      const shouldCreateTicket = current.channel === "whatsapp" && (
        parsed.data.status === "human_handoff"
        || Boolean(parsed.data.assignedUserId)
      );
      let supportTicketId: string | null = null;
      if (shouldCreateTicket) {
        const ticket = await ensureSupportTicketForConversation(tx, {
          tenantId: me.tenantId,
          conversationId: current.id,
          actorUserId: me.id,
        });
        supportTicketId = ticket?.id ?? null;
        if (ticket && parsed.data.assignedUserId !== undefined) {
          const assignedUserId = parsed.data.assignedUserId || null;
          if (ticket.assignedUserId !== assignedUserId) {
            await tx.update(supportTicketsTable)
              .set({
                assignedUserId,
                status: assignedUserId ? "open" : "pending",
                updatedAt: new Date(),
              })
              .where(and(
                eq(supportTicketsTable.id, ticket.id),
                eq(supportTicketsTable.tenantId, me.tenantId),
              ));
            await recordSupportTicketEvent(tx, {
              tenantId: me.tenantId,
              ticketId: ticket.id,
              actorUserId: me.id,
              eventType: assignedUserId ? "ticket_assigned" : "ticket_unassigned",
              details: { userId: assignedUserId },
            });
          }
        }
      } else if (current.channel === "whatsapp" && parsed.data.assignedUserId === "") {
        const [activeTicket] = await tx.select().from(supportTicketsTable)
          .where(and(
            eq(supportTicketsTable.tenantId, me.tenantId),
            eq(supportTicketsTable.conversationId, current.id),
            sql`${supportTicketsTable.status} <> 'resolved'`,
          ))
          .for("update")
          .limit(1);
        if (activeTicket?.assignedUserId) {
          supportTicketId = activeTicket.id;
          await tx.update(supportTicketsTable)
            .set({ assignedUserId: null, status: "pending", updatedAt: new Date() })
            .where(and(
              eq(supportTicketsTable.id, activeTicket.id),
              eq(supportTicketsTable.tenantId, me.tenantId),
            ));
          await recordSupportTicketEvent(tx, {
            tenantId: me.tenantId,
            ticketId: activeTicket.id,
            actorUserId: me.id,
            eventType: "ticket_unassigned",
            details: {},
          });
        }
      }

      const [updated] = await tx.select().from(chatbotConversationsTable)
        .where(and(eq(chatbotConversationsTable.id, current.id), eq(chatbotConversationsTable.tenantId, me.tenantId)))
        .limit(1);
      return { conversation: updated, supportTicketId };
    });
    if ("error" in result) {
      next(new NotFoundError(
        result.error === "client" ? "Client not found" : result.error === "user" ? "Team member not found or inactive" : "Not found",
        result.error === "user" ? "USER_NOT_FOUND" : "NOT_FOUND",
      ));
      return;
    }
    if (!result.conversation) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    if (result.supportTicketId) {
      void broadcastSupportTicketUpdate(me.tenantId, {
        type: "ticket",
        ticketId: result.supportTicketId,
      });
    }
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
    const [conversation] = await db.select({
      id: chatbotConversationsTable.id,
      tenantId: chatbotConversationsTable.tenantId,
      clientId: chatbotConversationsTable.clientId,
      channel: chatbotConversationsTable.channel,
      sessionId: chatbotConversationsTable.sessionId,
      status: chatbotConversationsTable.status,
      metadata: chatbotConversationsTable.metadata,
      clientWhatsappOptIn: clientsTable.whatsappOptIn,
    }).from(chatbotConversationsTable)
      .leftJoin(clientsTable, and(
        eq(clientsTable.id, chatbotConversationsTable.clientId),
        eq(clientsTable.tenantId, chatbotConversationsTable.tenantId),
      ))
      .where(and(
        eq(chatbotConversationsTable.id, req.params.id),
        eq(chatbotConversationsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!conversation?.sessionId || conversation.status === "opted_out") {
      next(new NotFoundError("WhatsApp conversation not available for delivery", "NOT_FOUND"));
      return;
    }
    if (conversation.channel === "instagram") {
      const metadata = conversation.metadata
        && typeof conversation.metadata === "object"
        && !Array.isArray(conversation.metadata)
        ? conversation.metadata as Record<string, unknown>
        : {};
      const integrationId = typeof metadata["instagramIntegrationId"] === "string"
        ? metadata["instagramIntegrationId"]
        : null;
      const [integration] = integrationId
        ? await db.select().from(tenantIntegrationsTable)
          .where(and(
            eq(tenantIntegrationsTable.id, integrationId),
            eq(tenantIntegrationsTable.tenantId, me.tenantId),
            eq(tenantIntegrationsTable.type, INSTAGRAM_MESSAGING_TYPE),
            eq(tenantIntegrationsTable.enabled, true),
            eq(tenantIntegrationsTable.status, "connected"),
          ))
          .limit(1)
        : [];
      if (!integration) {
        res.status(409).json({
          code: "INSTAGRAM_CONNECTION_UNAVAILABLE",
          error: "A conta do Instagram não está conectada. Reconecte-a nas configurações.",
        });
        return;
      }
      if (Buffer.byteLength(parsed.data.content, "utf8") > 1000) {
        res.status(422).json({
          code: "INSTAGRAM_MESSAGE_TOO_LONG",
          error: "O Direct do Instagram permite até 1.000 bytes por mensagem.",
        });
        return;
      }
      const [lastInbound] = await db.select({ sentAt: chatbotMessagesTable.sentAt })
        .from(chatbotMessagesTable)
        .where(and(
          eq(chatbotMessagesTable.tenantId, me.tenantId),
          eq(chatbotMessagesTable.conversationId, conversation.id),
          eq(chatbotMessagesTable.role, "user"),
        ))
        .orderBy(desc(chatbotMessagesTable.sentAt), desc(chatbotMessagesTable.id))
        .limit(1);
      if (!isInstagramReplyWindowOpen(lastInbound?.sentAt ?? null)) {
        res.status(403).json({
          code: "INSTAGRAM_REPLY_WINDOW_EXPIRED",
          error: "A janela de resposta do Instagram expirou. Peça ao cliente para enviar uma nova mensagem.",
        });
        return;
      }

      const sourceMessageId = `instagram:staff:${parsed.data.idempotencyKey}`;
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
      if (!created) {
        const [existing] = await db.select().from(chatbotMessagesTable)
          .where(and(
            eq(chatbotMessagesTable.tenantId, me.tenantId),
            eq(chatbotMessagesTable.conversationId, conversation.id),
            eq(chatbotMessagesTable.sourceMessageId, sourceMessageId),
          ))
          .limit(1);
        if (existing?.deliveryStatus === "sent") {
          res.status(200).json(existing);
          return;
        }
        res.status(409).json({
          code: "INSTAGRAM_DELIVERY_UNRESOLVED",
          error: "O envio anterior ainda não pode ser confirmado. Não reenvie a mesma mensagem.",
        });
        return;
      }

      try {
        const meta = getInstagramMetaConfig();
        if (!meta.appConfigured) throw new InstagramProviderError("rejected");
        const integrationConfig = (integration.config ?? {}) as Record<string, string>;
        const instagramUserId = integrationConfig["instagramUserId"];
        if (!instagramUserId) throw new InstagramProviderError("rejected");
        await sendInstagramText(
          meta,
          readInstagramAccessToken(integration),
          instagramUserId,
          conversation.sessionId,
          parsed.data.content,
        );
        await db.update(chatbotMessagesTable).set({
          deliveryStatus: "sent",
          deliveryAttempts: 1,
          deliveryUpdatedAt: new Date(),
          lastDeliveryError: null,
        }).where(and(
          eq(chatbotMessagesTable.id, id),
          eq(chatbotMessagesTable.tenantId, me.tenantId),
        ));
        await db.update(chatbotConversationsTable)
          .set({ status: "human_handoff", assignedUserId: me.id })
          .where(and(
            eq(chatbotConversationsTable.id, conversation.id),
            eq(chatbotConversationsTable.tenantId, me.tenantId),
          ));
        const [message] = await db.select().from(chatbotMessagesTable)
          .where(and(eq(chatbotMessagesTable.id, id), eq(chatbotMessagesTable.tenantId, me.tenantId)))
          .limit(1);
        res.status(201).json(message);
      } catch (error) {
        const providerError = error instanceof InstagramProviderError ? error : null;
        const outcomeUnknown = providerError?.kind === "unknown";
        await db.update(chatbotMessagesTable).set({
          deliveryStatus: outcomeUnknown ? "unknown" : "failed",
          deliveryAttempts: 1,
          deliveryUpdatedAt: new Date(),
          lastDeliveryError: outcomeUnknown ? "instagram-outcome-unknown" : "instagram-provider-rejected",
        }).where(and(
          eq(chatbotMessagesTable.id, id),
          eq(chatbotMessagesTable.tenantId, me.tenantId),
        ));
        if (providerError?.httpStatus === 401) {
          await db.update(tenantIntegrationsTable).set({
            enabled: false,
            status: "error",
            lastError: "O acesso ao Instagram expirou. Reconecte a conta.",
          }).where(and(
            eq(tenantIntegrationsTable.id, integration.id),
            eq(tenantIntegrationsTable.tenantId, me.tenantId),
          ));
        }
        res.status(outcomeUnknown ? 502 : 422).json({
          code: outcomeUnknown ? "INSTAGRAM_DELIVERY_UNKNOWN" : "INSTAGRAM_DELIVERY_FAILED",
          error: outcomeUnknown
            ? "A Meta não confirmou o resultado do envio. Verifique a conversa antes de tentar novamente."
            : "A Meta recusou o envio. Revise a conexão e as permissões do Instagram.",
        });
      }
      return;
    }
    if (conversation.channel !== "whatsapp") {
      next(new NotFoundError("Conversation channel is not available for delivery", "NOT_FOUND"));
      return;
    }
    if (conversation.clientId && conversation.clientWhatsappOptIn !== true) {
      next(new ForbiddenError("O cliente não autorizou mensagens por WhatsApp.", "WHATSAPP_OPTED_OUT"));
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
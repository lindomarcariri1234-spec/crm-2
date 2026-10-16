import { Router, type NextFunction } from "express";
import {
  db,
  chatbotConversationsTable,
  chatbotMessagesTable,
  messagesTable,
  outboundDeliveriesTable,
  outboundDeliveryAttemptsTable,
  outboundMessagesTable,
  clientsTable,
  usersTable,
  supportTicketsTable,
  tenantIntegrationsTable,
} from "@workspace/db";
import { eq, and, desc, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { decryptCredential } from "../lib/crypto";
import { ALL_STAFF_ROLES, requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ADMIN_ROLES } from '../lib/tenant';
import { deliverAttendanceReply } from "../services/whatsapp-attendance";
import { dispatchOutboundMessage } from "../services/outbound-delivery.js";
import {
  getInstagramMetaConfig,
  isInstagramReplyWindowOpen,
  INSTAGRAM_MESSAGING_TYPE,
} from "../services/instagram-messaging";
import {
  INSTAGRAM_ZERNIO_TYPE,
} from "../services/instagram-zernio.js";
import { recomputeClientClassification, recordClientClassificationEvent } from "../services/client-classification.js";
import { ACTIONS, hasPermission, RESOURCES } from "@workspace/permissions";
import { extractVerifiedUploadThingKey, utapi } from "../lib/uploadthing";
import { logger } from "../lib/logger";
import { getWhatsAppInboundMediaExpirationAt } from "../lib/whatsapp-media-retention";
import { ensureSupportTicketForConversation, recordSupportTicketEvent } from "../services/support-ticketing.js";
import { broadcastSupportTicketUpdate } from "../lib/realtime.js";

const router = Router();
const TIMELINE_DEFAULT_PAGE_SIZE = 50;
const TIMELINE_MAX_PAGE_SIZE = 100;

type ConversationTimelineCursor = { at: Date; id: string };

function decodeConversationTimelineCursor(raw: unknown): ConversationTimelineCursor | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string" || raw.length > 1024) {
    throw new ValidationError("Cursor de histórico inválido.", "VALIDATION_ERROR");
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_cursor");
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.at !== "string" ||
      !Number.isFinite(Date.parse(record.at)) ||
      typeof record.id !== "string" ||
      !record.id ||
      record.id.length > 300
    ) throw new Error("invalid_cursor");
    return { at: new Date(record.at), id: record.id };
  } catch {
    throw new ValidationError("Cursor de histórico inválido.", "VALIDATION_ERROR");
  }
}

function encodeConversationTimelineCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString("base64url");
}

function compareTimelineIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseConversationTimelineLimit(raw: unknown): number {
  if (raw === undefined) return TIMELINE_DEFAULT_PAGE_SIZE;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw new ValidationError("Limite de histórico inválido.", "VALIDATION_ERROR");
  }
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > TIMELINE_MAX_PAGE_SIZE) {
    throw new ValidationError(`O limite deve estar entre 1 e ${TIMELINE_MAX_PAGE_SIZE}.`, "VALIDATION_ERROR");
  }
  return limit;
}

async function requireChatbotStaff(
  req: Parameters<typeof requireAuth>[0],
  res: Parameters<typeof requireAuth>[1],
  next: NextFunction,
) {
  const me = await requireAuth(req, res);
  if (!me) return null;
  if (!ALL_STAFF_ROLES.includes(me.role)) {
    next(new ForbiddenError("Apenas membros da equipe podem acessar a caixa de entrada da agência.", "FORBIDDEN_ROLE"));
    return null;
  }
  return me;
}
const DEFAULT_MEDIA_SIGNED_URL_TTL_SECONDS = 60 * 60;
const CHATBOT_DELIVERY_ISSUES = {
  optedOut: "Envio cancelado: o cliente não autorizou contato pelo WhatsApp.",
  invalidPhone: "Número de WhatsApp inválido ou desatualizado. Atualize o contato e tente novamente.",
  conversationUnavailable: "Esta conversa não está disponível para receber respostas.",
  connectionUnavailable: "Conexão do WhatsApp indisponível. Revise a integração e tente novamente.",
  providerUnavailable: "O serviço do WhatsApp está indisponível. Tente novamente mais tarde.",
  rateLimited: "O provedor limitou o envio. Aguarde alguns minutos antes de tentar novamente.",
  deliveryUnknown: "O WhatsApp não confirmou o resultado do envio. Confira o status antes de enviar outra vez.",
  rejected: "O WhatsApp não aceitou a mensagem. Revise o contato e a integração antes de tentar novamente.",
} as const;

function safeChatbotDeliveryIssue(
  channel: string,
  status: string | null | undefined,
  rawReason: unknown,
): string | null {
  if (status === "unknown" && channel === "whatsapp") {
    return CHATBOT_DELIVERY_ISSUES.deliveryUnknown;
  }
  if (status !== "failed" && status !== "cancelled") return null;
  if (channel !== "whatsapp") {
    return "A plataforma não aceitou a mensagem. Revise a conexão da conta e tente novamente.";
  }
  const reason = typeof rawReason === "string" ? rawReason : "";
  if (["contact_opted_out", "whatsapp_opted_out", "whatsapp_recipient_opted_out"].includes(reason)) {
    return CHATBOT_DELIVERY_ISSUES.optedOut;
  }
  if (["invalid_phone", "whatsapp_invalid_phone", "whatsapp_address_missing", "whatsapp_recipient_changed", "whatsapp_recipient_unavailable"].includes(reason)) {
    return CHATBOT_DELIVERY_ISSUES.invalidPhone;
  }
  if (["conversation_unavailable", "whatsapp_conversation_unavailable", "outbound_message_unavailable"].includes(reason)) {
    return CHATBOT_DELIVERY_ISSUES.conversationUnavailable;
  }
  if (["credentials_not_configured", "whatsapp_connection_unavailable", "whatsapp_connection_ambiguous", "no_whatsapp_provider", "whatsapp_account_unavailable"].includes(reason)) {
    return CHATBOT_DELIVERY_ISSUES.connectionUnavailable;
  }
  const providerStatus = /^(?:zapi|evolution)_(\d{3})$/.exec(reason)?.[1];
  if (providerStatus === "401" || providerStatus === "403") return CHATBOT_DELIVERY_ISSUES.connectionUnavailable;
  if (providerStatus === "429") return CHATBOT_DELIVERY_ISSUES.rateLimited;
  if (providerStatus && Number(providerStatus) >= 500) return CHATBOT_DELIVERY_ISSUES.providerUnavailable;
  if (providerStatus) return CHATBOT_DELIVERY_ISSUES.rejected;
  return CHATBOT_DELIVERY_ISSUES.rejected;
}

function readZernioApiKey(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    const parsed: unknown = JSON.parse(decryptCredential(encrypted));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const apiKey = (parsed as Record<string, unknown>)["apiKey"];
    return typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : null;
  } catch {
    return null;
  }
}

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
    const me = await requireChatbotStaff(req, res, next);
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
    const me = await requireChatbotStaff(req, res, next);
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
    const me = await requireChatbotStaff(req, res, next);
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
      let mediaExpiresAt: Date | null = null;
      if (isInboundWhatsAppMedia) {
        mediaExpiresAt = getWhatsAppInboundMediaExpirationAt(message.sentAt);
        const secondsUntilExpiry = Math.floor((mediaExpiresAt.getTime() - now) / 1000);
        if (message.mediaExpiredAt || secondsUntilExpiry <= 0) {
          return {
            ...message,
            mediaUrl: null,
            mediaExpiredAt: message.mediaExpiredAt ?? mediaExpiresAt,
            mediaExpiresAt,
          };
        }
        expiresIn = Math.min(DEFAULT_MEDIA_SIGNED_URL_TTL_SECONDS, secondsUntilExpiry);
      }

      const fileKey = message.mediaUrl ? extractVerifiedUploadThingKey(message.mediaUrl) : null;
      if (!fileKey) {
        return mediaExpiresAt ? { ...message, mediaExpiresAt } : message;
      }
      try {
        const signed = await utapi.generateSignedURL(fileKey, { expiresIn });
        return {
          ...message,
          mediaUrl: signed.ufsUrl,
          ...(mediaExpiresAt ? { mediaExpiresAt } : {}),
        };
      } catch {
        logger.warn(
          { tenantId: me.tenantId, messageId: message.id },
          "[chatbot] could not create temporary media URL",
        );
        return {
          ...message,
          mediaUrl: null,
          ...(mediaExpiresAt ? { mediaExpiresAt } : {}),
        };
      }
    }));
    res.json(visibleMessages.map((message) => {
      const { lastDeliveryError, ...safeMessage } = message;
      return {
        ...safeMessage,
        deliveryIssue: safeChatbotDeliveryIssue(conv.channel, message.deliveryStatus, lastDeliveryError),
      };
    }));
  } catch (err) {
    next(err);
  }
});

router.get("/chatbot-conversations/:id/timeline", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireChatbotStaff(req, res, next);
    if (!me) return;
    const pageSize = parseConversationTimelineLimit(req.query.limit);
    const cursor = decodeConversationTimelineCursor(req.query.cursor);
    const [conversation] = await db.select().from(chatbotConversationsTable)
      .where(and(
        eq(chatbotConversationsTable.id, req.params.id),
        eq(chatbotConversationsTable.tenantId, me.tenantId),
      )).limit(1);
    if (!conversation) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }

    const messageConditions = [
      eq(chatbotMessagesTable.conversationId, conversation.id),
      eq(chatbotMessagesTable.tenantId, me.tenantId),
    ];
    if (cursor) {
      messageConditions.push(or(
        lt(chatbotMessagesTable.sentAt, cursor.at),
        and(
          eq(chatbotMessagesTable.sentAt, cursor.at),
          lt(sql<string>`${chatbotMessagesTable.id} COLLATE "C"`, cursor.id),
        ),
      )!);
    }
    const storedMessages = await db.select().from(chatbotMessagesTable)
      .where(and(...messageConditions))
      .orderBy(desc(chatbotMessagesTable.sentAt), desc(sql`${chatbotMessagesTable.id} COLLATE "C"`))
      .limit(pageSize + 1);

    const outboundSelection = {
      id: outboundDeliveriesTable.id,
      outboundMessageId: outboundDeliveriesTable.outboundMessageId,
      channel: outboundDeliveriesTable.channel,
      content: outboundDeliveriesTable.content,
      status: outboundDeliveriesTable.status,
      attempts: outboundDeliveriesTable.attempts,
      provider: outboundDeliveriesTable.provider,
      externalId: outboundDeliveriesTable.externalId,
      createdAt: outboundDeliveriesTable.createdAt,
      acceptedAt: outboundDeliveriesTable.acceptedAt,
      origin: outboundMessagesTable.origin,
      metadata: outboundMessagesTable.metadata,
    };
    const outboundConditions = [
      eq(outboundDeliveriesTable.tenantId, me.tenantId),
      or(
        sql`${outboundMessagesTable.metadata}->>'conversationId' = ${conversation.id}`,
        ...(conversation.clientId
          ? [and(
              eq(outboundMessagesTable.recipientType, "client"),
              eq(outboundMessagesTable.recipientId, conversation.clientId),
            )]
          : []),
      )!,
      sql`NOT EXISTS (
        SELECT 1
        FROM chatbot_messages linked_message
        WHERE linked_message.id = (${outboundMessagesTable.metadata}->>'chatbotMessageId')
          AND linked_message.conversation_id = ${conversation.id}
          AND linked_message.tenant_id = ${me.tenantId}
      )`,
    ];
    if (cursor) {
      outboundConditions.push(or(
        lt(outboundDeliveriesTable.createdAt, cursor.at),
        and(
          eq(outboundDeliveriesTable.createdAt, cursor.at),
          sql`(('delivery:' || ${outboundDeliveriesTable.id}) COLLATE "C") < (${cursor.id} COLLATE "C")`,
        ),
      )!);
    }
    const independentOutboundRows = await db.select(outboundSelection).from(outboundDeliveriesTable)
      .innerJoin(outboundMessagesTable, and(
        eq(outboundMessagesTable.id, outboundDeliveriesTable.outboundMessageId),
        eq(outboundMessagesTable.tenantId, outboundDeliveriesTable.tenantId),
      ))
      .where(and(...outboundConditions))
      .orderBy(desc(outboundDeliveriesTable.createdAt), desc(sql`(('delivery:' || ${outboundDeliveriesTable.id}) COLLATE "C")`))
      .limit(pageSize + 1);

    const candidates = [
      ...storedMessages.map((message) => ({
        kind: "chatbot" as const,
        id: message.id,
        at: message.sentAt,
        message,
      })),
      ...independentOutboundRows.map((row) => ({
        kind: "delivery" as const,
        id: `delivery:${row.id}`,
        at: row.createdAt,
        row,
      })),
    ].sort((left, right) =>
      right.at.getTime() - left.at.getTime() || compareTimelineIds(right.id, left.id),
    );
    const hasMore = candidates.length > pageSize;
    const pageCandidates = candidates.slice(0, pageSize);
    const pageMessages = pageCandidates.flatMap((candidate) => candidate.kind === "chatbot" ? [candidate.message] : []);
    const selectedIndependentRows = pageCandidates.flatMap((candidate) => candidate.kind === "delivery" ? [candidate.row] : []);
    const pageMessageIds = pageMessages.map((message) => message.id);
    const linkedOutboundRows = pageMessageIds.length
      ? await db.select(outboundSelection).from(outboundDeliveriesTable)
          .innerJoin(outboundMessagesTable, and(
            eq(outboundMessagesTable.id, outboundDeliveriesTable.outboundMessageId),
            eq(outboundMessagesTable.tenantId, outboundDeliveriesTable.tenantId),
          ))
          .where(and(
            eq(outboundDeliveriesTable.tenantId, me.tenantId),
            inArray(sql<string>`${outboundMessagesTable.metadata}->>'chatbotMessageId'`, pageMessageIds),
            sql`${outboundMessagesTable.metadata}->>'conversationId' = ${conversation.id}`,
          ))
      : [];
    const outboundRows = [...selectedIndependentRows, ...linkedOutboundRows];

    const now = Date.now();
    const visibleMessages = await Promise.all(pageMessages.map(async (message) => {
      const mediaExpiresAt = conversation.channel === "whatsapp" && message.role === "user" && message.mediaUrl
        ? getWhatsAppInboundMediaExpirationAt(message.sentAt)
        : null;
      if (mediaExpiresAt && (message.mediaExpiredAt || mediaExpiresAt.getTime() <= now)) {
        return { ...message, mediaUrl: null, mediaExpiredAt: message.mediaExpiredAt ?? mediaExpiresAt, mediaExpiresAt };
      }
      const fileKey = message.mediaUrl ? extractVerifiedUploadThingKey(message.mediaUrl) : null;
      if (!fileKey) return mediaExpiresAt ? { ...message, mediaExpiresAt } : message;
      const expiresIn = mediaExpiresAt
        ? Math.min(DEFAULT_MEDIA_SIGNED_URL_TTL_SECONDS, Math.max(1, Math.floor((mediaExpiresAt.getTime() - now) / 1000)))
        : DEFAULT_MEDIA_SIGNED_URL_TTL_SECONDS;
      try {
        const signed = await utapi.generateSignedURL(fileKey, { expiresIn });
        return { ...message, mediaUrl: signed.ufsUrl, ...(mediaExpiresAt ? { mediaExpiresAt } : {}) };
      } catch {
        logger.warn({ tenantId: me.tenantId, messageId: message.id }, "[chatbot] could not create temporary timeline media URL");
        return { ...message, mediaUrl: null, ...(mediaExpiresAt ? { mediaExpiresAt } : {}) };
      }
    }));

    const attempts = outboundRows.length
      ? await db.select({
          deliveryId: outboundDeliveryAttemptsTable.deliveryId,
          attemptNumber: outboundDeliveryAttemptsTable.attemptNumber,
          status: outboundDeliveryAttemptsTable.status,
          provider: outboundDeliveryAttemptsTable.provider,
          externalId: outboundDeliveryAttemptsTable.externalId,
          error: outboundDeliveryAttemptsTable.error,
          startedAt: outboundDeliveryAttemptsTable.startedAt,
          completedAt: outboundDeliveryAttemptsTable.completedAt,
        }).from(outboundDeliveryAttemptsTable)
          .where(and(
            eq(outboundDeliveryAttemptsTable.tenantId, me.tenantId),
            inArray(outboundDeliveryAttemptsTable.deliveryId, outboundRows.map((row) => row.id)),
          ))
          .orderBy(outboundDeliveryAttemptsTable.attemptNumber)
      : [];
    const attemptsByDelivery = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      const list = attemptsByDelivery.get(attempt.deliveryId) ?? [];
      list.push(attempt);
      attemptsByDelivery.set(attempt.deliveryId, list);
    }
    type TimelineEntry = Omit<(typeof visibleMessages)[number], "lastDeliveryError"> & {
      direction: "inbound" | "outbound";
      origin: string;
      channel: string;
      provider: string | null;
      externalId?: string | null;
      deliveryAttempts?: number;
      deliveryHistory?: Array<{
        attemptNumber: number;
        status: string;
        provider: string | null;
        externalId: string | null;
        error: string | null;
        startedAt: Date;
        completedAt: Date | null;
      }>;
      deliveryIssue: string | null;
    };
    const projectedMessages: TimelineEntry[] = visibleMessages.map((message) => {
      const { lastDeliveryError, ...safeMessage } = message;
      return {
        ...safeMessage,
        direction: message.role === "user" ? "inbound" : "outbound",
        origin: "chatbot",
        channel: conversation.channel,
        provider: null as string | null,
        deliveryIssue: safeChatbotDeliveryIssue(conversation.channel, message.deliveryStatus, lastDeliveryError),
      };
    });
    const messageIndexById = new Map(projectedMessages.map((message, index) => [message.id, index]));
    for (const row of outboundRows) {
      const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
      const chatbotMessageId = typeof metadata.chatbotMessageId === "string" ? metadata.chatbotMessageId : null;
      const deliveryIssue = row.status === "unknown"
        ? "Não foi possível confirmar a entrega."
        : row.status === "failed" || row.status === "skipped"
          ? "A entrega não foi concluída."
          : null;
      const deliveryHistory = (attemptsByDelivery.get(row.id) ?? []).map((attempt) => ({
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        provider: attempt.provider,
        externalId: attempt.externalId,
        error: attempt.error ? "provider_error" : null,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
      }));
      const linkedIndex = chatbotMessageId ? messageIndexById.get(chatbotMessageId) : undefined;
      if (linkedIndex !== undefined) {
        projectedMessages[linkedIndex] = {
          ...projectedMessages[linkedIndex]!,
          channel: row.channel,
          origin: row.origin,
          provider: row.provider,
          externalId: row.externalId,
          deliveryStatus: row.status === "accepted" ? "sent" : row.status,
          deliveryAttempts: row.attempts,
          deliveryIssue,
          deliveryHistory,
        };
        continue;
      }
      projectedMessages.push({
        id: `delivery:${row.id}`,
        conversationId: conversation.id,
        tenantId: me.tenantId,
        ticketId: null,
        sourceMessageId: null,
        providerMessageId: row.externalId,
        deliveryUpdatedAt: row.acceptedAt ?? row.createdAt,
        role: "assistant",
        content: row.content,
        isBot: false,
        sentAt: row.createdAt,
        mediaUrl: null,
        mediaMimeType: null,
        mediaFileName: null,
        mediaExpiredAt: null,
        direction: "outbound",
        origin: row.origin,
        channel: row.channel,
        provider: row.provider,
        externalId: row.externalId,
        deliveryStatus: row.status === "accepted" ? "sent" : row.status,
        deliveryAttempts: row.attempts,
        deliveryIssue,
        deliveryHistory,
      });
    }
    const items = projectedMessages.sort((left, right) =>
      new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime() || compareTimelineIds(left.id, right.id),
    );
    const oldestCandidate = pageCandidates.at(-1);
    res.json({
      items,
      hasMore,
      nextCursor: hasMore && oldestCandidate
        ? encodeConversationTimelineCursor(oldestCandidate.at, oldestCandidate.id)
        : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/clients/:clientId/communication-timeline", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireChatbotStaff(req, res, next);
    if (!me) return;
    const pageSize = parseConversationTimelineLimit(req.query.limit);
    const cursor = decodeConversationTimelineCursor(req.query.cursor);
    const [client] = await db.select({ id: clientsTable.id, name: clientsTable.name })
      .from(clientsTable)
      .where(and(
        eq(clientsTable.id, req.params.clientId),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!client) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }

    const legacyConditions = [
      eq(messagesTable.tenantId, me.tenantId),
      eq(messagesTable.toClientId, client.id),
      sql`NOT EXISTS (
        SELECT 1 FROM outbound_messages legacy_outbound
        WHERE legacy_outbound.id = ${messagesTable.outboundMessageId}
          AND legacy_outbound.tenant_id = ${me.tenantId}
      )`,
    ];
    if (cursor) {
      legacyConditions.push(or(
        lt(messagesTable.sentAt, cursor.at),
        and(
          eq(messagesTable.sentAt, cursor.at),
          sql`(('message:' || ${messagesTable.id}) COLLATE "C") < (${cursor.id} COLLATE "C")`,
        ),
      )!);
    }
    const legacyRows = await db.select({
      id: messagesTable.id,
      channel: messagesTable.channel,
      content: messagesTable.content,
      status: messagesTable.status,
      mediaUrl: messagesTable.mediaUrl,
      sentAt: messagesTable.sentAt,
    }).from(messagesTable)
      .where(and(...legacyConditions))
      .orderBy(desc(messagesTable.sentAt), desc(sql`(('message:' || ${messagesTable.id}) COLLATE "C")`))
      .limit(pageSize + 1);

    const chatbotConditions = [
      eq(chatbotMessagesTable.tenantId, me.tenantId),
      eq(chatbotConversationsTable.tenantId, me.tenantId),
      eq(chatbotConversationsTable.clientId, client.id),
      eq(chatbotConversationsTable.channel, "whatsapp"),
      sql`${chatbotMessagesTable.role} <> 'system'`,
    ];
    if (cursor) {
      chatbotConditions.push(or(
        lt(chatbotMessagesTable.sentAt, cursor.at),
        and(
          eq(chatbotMessagesTable.sentAt, cursor.at),
          sql`(('chatbot:' || ${chatbotMessagesTable.id}) COLLATE "C") < (${cursor.id} COLLATE "C")`,
        ),
      )!);
    }
    const chatbotRows = await db.select({
      id: chatbotMessagesTable.id,
      conversationId: chatbotMessagesTable.conversationId,
      role: chatbotMessagesTable.role,
      content: chatbotMessagesTable.content,
      isBot: chatbotMessagesTable.isBot,
      deliveryStatus: chatbotMessagesTable.deliveryStatus,
      lastDeliveryError: chatbotMessagesTable.lastDeliveryError,
      mediaUrl: chatbotMessagesTable.mediaUrl,
      mediaMimeType: chatbotMessagesTable.mediaMimeType,
      mediaFileName: chatbotMessagesTable.mediaFileName,
      mediaExpiredAt: chatbotMessagesTable.mediaExpiredAt,
      sentAt: chatbotMessagesTable.sentAt,
    }).from(chatbotMessagesTable)
      .innerJoin(chatbotConversationsTable, and(
        eq(chatbotConversationsTable.id, chatbotMessagesTable.conversationId),
        eq(chatbotConversationsTable.tenantId, chatbotMessagesTable.tenantId),
      ))
      .where(and(...chatbotConditions))
      .orderBy(desc(chatbotMessagesTable.sentAt), desc(sql`(('chatbot:' || ${chatbotMessagesTable.id}) COLLATE "C")`))
      .limit(pageSize + 1);

    const outboundSelection = {
      id: outboundDeliveriesTable.id,
      outboundMessageId: outboundDeliveriesTable.outboundMessageId,
      channel: outboundDeliveriesTable.channel,
      content: outboundDeliveriesTable.content,
      status: outboundDeliveriesTable.status,
      createdAt: outboundDeliveriesTable.createdAt,
      acceptedAt: outboundDeliveriesTable.acceptedAt,
      failedAt: outboundDeliveriesTable.failedAt,
      externalId: outboundDeliveriesTable.externalId,
      provider: outboundDeliveriesTable.provider,
      origin: outboundMessagesTable.origin,
      recipientName: outboundMessagesTable.recipientName,
      metadata: outboundMessagesTable.metadata,
    };
    const deliveryTimelineAt = sql<Date>`COALESCE(
      ${outboundDeliveriesTable.acceptedAt},
      ${outboundDeliveriesTable.failedAt},
      ${outboundDeliveriesTable.createdAt}
    )`;
    const deliveryConditions = [
      eq(outboundDeliveriesTable.tenantId, me.tenantId),
      eq(outboundMessagesTable.tenantId, me.tenantId),
      eq(outboundMessagesTable.recipientType, "client"),
      eq(outboundMessagesTable.recipientId, client.id),
      sql`NOT EXISTS (
        SELECT 1
        FROM chatbot_messages linked_message
        INNER JOIN chatbot_conversations linked_conversation
          ON linked_conversation.id = linked_message.conversation_id
         AND linked_conversation.tenant_id = linked_message.tenant_id
        WHERE linked_message.id = (outbound_messages.metadata->>'chatbotMessageId')
          AND linked_message.tenant_id = ${me.tenantId}
          AND linked_conversation.client_id = ${client.id}
          AND linked_conversation.channel = 'whatsapp'
      )`,
    ];
    if (cursor) {
      deliveryConditions.push(or(
        lt(deliveryTimelineAt, cursor.at),
        and(
          eq(deliveryTimelineAt, cursor.at),
          sql`(('outbound:' || ${outboundDeliveriesTable.outboundMessageId} || ':' || ${outboundDeliveriesTable.id}) COLLATE "C") < (${cursor.id} COLLATE "C")`,
        ),
      )!);
    }
    const deliveryRows = await db.select(outboundSelection).from(outboundDeliveriesTable)
      .innerJoin(outboundMessagesTable, and(
        eq(outboundMessagesTable.id, outboundDeliveriesTable.outboundMessageId),
        eq(outboundMessagesTable.tenantId, outboundDeliveriesTable.tenantId),
      ))
      .where(and(...deliveryConditions))
      .orderBy(desc(deliveryTimelineAt), desc(sql`(('outbound:' || ${outboundDeliveriesTable.outboundMessageId} || ':' || ${outboundDeliveriesTable.id}) COLLATE "C")`))
      .limit(pageSize + 1);

    const candidates = [
      ...legacyRows.map((row) => ({ kind: "legacy" as const, id: `message:${row.id}`, at: row.sentAt, row })),
      ...chatbotRows.map((row) => ({ kind: "chatbot" as const, id: `chatbot:${row.id}`, at: row.sentAt, row })),
      ...deliveryRows.map((row) => ({
        kind: "delivery" as const,
        id: `outbound:${row.outboundMessageId}:${row.id}`,
        at: row.acceptedAt ?? row.failedAt ?? row.createdAt,
        row,
      })),
    ].sort((left, right) =>
      right.at.getTime() - left.at.getTime() || compareTimelineIds(right.id, left.id),
    );
    const hasMore = candidates.length > pageSize;
    const pageCandidates = candidates.slice(0, pageSize);
    const pageChatbotRows = pageCandidates.flatMap((candidate) => candidate.kind === "chatbot" ? [candidate.row] : []);
    const chatbotIds = pageChatbotRows.map((row) => row.id);
    const linkedRows = chatbotIds.length
      ? await db.select(outboundSelection).from(outboundDeliveriesTable)
          .innerJoin(outboundMessagesTable, and(
            eq(outboundMessagesTable.id, outboundDeliveriesTable.outboundMessageId),
            eq(outboundMessagesTable.tenantId, outboundDeliveriesTable.tenantId),
          ))
          .where(and(
            eq(outboundDeliveriesTable.tenantId, me.tenantId),
            inArray(sql<string>`${outboundMessagesTable.metadata}->>'chatbotMessageId'`, chatbotIds),
            eq(outboundMessagesTable.recipientType, "client"),
            eq(outboundMessagesTable.recipientId, client.id),
          ))
      : [];
    const linkedByMessage = new Map(linkedRows.map((row) => {
      const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
      return [String(metadata.chatbotMessageId), row];
    }));
    const now = Date.now();
    const items = await Promise.all(pageCandidates.map(async (candidate) => {
      if (candidate.kind === "legacy") {
        return {
          id: candidate.id,
          clientId: client.id,
          clientName: client.name,
          channel: candidate.row.channel,
          content: candidate.row.content,
          direction: "outbound" as const,
          actor: "team" as const,
          sentAt: candidate.row.sentAt,
          status: candidate.row.status,
          source: "message" as const,
          mediaUrl: candidate.row.mediaUrl,
        };
      }
      if (candidate.kind === "delivery") {
        return {
          id: candidate.id,
          clientId: client.id,
          clientName: candidate.row.recipientName || client.name,
          channel: candidate.row.channel,
          content: candidate.row.content,
          direction: "outbound" as const,
          actor: "team" as const,
          sentAt: candidate.row.acceptedAt ?? candidate.row.failedAt ?? candidate.row.createdAt,
          status: candidate.row.status === "accepted" ? "sent" : candidate.row.status,
          source: "outbound" as const,
        };
      }
      let mediaUrl = candidate.row.mediaUrl;
      const mediaExpiresAt = candidate.row.role === "user" && candidate.row.mediaUrl
        ? getWhatsAppInboundMediaExpirationAt(candidate.row.sentAt)
        : null;
      if (mediaExpiresAt && (candidate.row.mediaExpiredAt || mediaExpiresAt.getTime() <= now)) {
        mediaUrl = null;
      } else if (mediaUrl) {
        const fileKey = extractVerifiedUploadThingKey(mediaUrl);
        if (fileKey) {
          const expiresIn = mediaExpiresAt
            ? Math.min(DEFAULT_MEDIA_SIGNED_URL_TTL_SECONDS, Math.max(1, Math.floor((mediaExpiresAt.getTime() - now) / 1000)))
            : DEFAULT_MEDIA_SIGNED_URL_TTL_SECONDS;
          try {
            mediaUrl = (await utapi.generateSignedURL(fileKey, { expiresIn })).ufsUrl;
          } catch {
            mediaUrl = null;
          }
        }
      }
      const linked = linkedByMessage.get(candidate.row.id);
      const isInbound = candidate.row.role === "user";
      return {
        id: candidate.id,
        clientId: client.id,
        clientName: client.name,
        channel: linked?.channel ?? "whatsapp",
        content: candidate.row.content,
        direction: isInbound ? "inbound" as const : "outbound" as const,
        actor: isInbound ? "client" as const : candidate.row.isBot ? "ai" as const : "team" as const,
        sentAt: candidate.row.sentAt,
        status: isInbound ? "received" : linked?.status === "accepted" ? "sent" : linked?.status ?? candidate.row.deliveryStatus,
        source: "chatbot" as const,
        mediaUrl,
        mediaMimeType: candidate.row.mediaMimeType,
        mediaFileName: candidate.row.mediaFileName,
        mediaExpiredAt: candidate.row.mediaExpiredAt ?? (mediaExpiresAt && mediaUrl === null ? mediaExpiresAt : null),
        mediaExpiresAt,
      };
    }));
    const oldestCandidate = pageCandidates.at(-1);
    res.json({
      items: items.sort((left, right) =>
        left.sentAt.getTime() - right.sentAt.getTime() || compareTimelineIds(left.id, right.id),
      ),
      hasMore,
      nextCursor: hasMore && oldestCandidate
        ? encodeConversationTimelineCursor(oldestCandidate.at, oldestCandidate.id)
        : null,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/chatbot-messages", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireChatbotStaff(req, res, next);
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
    const me = await requireChatbotStaff(req, res, next);
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
      if (parsed.data.clientId !== undefined) {
        const currentMetadata = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
          ? current.metadata as Record<string, unknown>
          : {};
        updates.metadata = { ...currentMetadata, clientAssociationManualOverride: true };
      }
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
    const me = await requireChatbotStaff(req, res, next);
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
      const provider = metadata["provider"] === "zernio" ? "zernio" : "meta";
      const integrationType = provider === "zernio"
        ? INSTAGRAM_ZERNIO_TYPE
        : INSTAGRAM_MESSAGING_TYPE;
      const integrationId = typeof metadata["instagramIntegrationId"] === "string"
        ? metadata["instagramIntegrationId"]
        : null;
      const [integration] = integrationId
        ? await db.select().from(tenantIntegrationsTable)
          .where(and(
            eq(tenantIntegrationsTable.id, integrationId),
            eq(tenantIntegrationsTable.tenantId, me.tenantId),
            eq(tenantIntegrationsTable.type, integrationType),
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
      const zernioConfig = provider === "zernio"
        ? (integration.config ?? {}) as Record<string, string>
        : null;
      const zernioApiKey = provider === "zernio"
        ? readZernioApiKey(integration.secretsEncrypted)
        : null;
      if (
        provider === "zernio" &&
        (
          !zernioApiKey ||
          !zernioConfig?.accountId ||
          zernioConfig.accountId !== metadata["zernioAccountId"] ||
          zernioConfig.profileId !== metadata["zernioProfileId"] ||
          typeof metadata["zernioConversationId"] !== "string"
        )
      ) {
        res.status(409).json({
          code: "ZERNIO_SEND_CONFIGURATION_INCOMPLETE",
          error: "Configure a chave de API da Zernio e confira o vínculo da conta antes de enviar.",
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

      await db.update(chatbotConversationsTable)
        .set({ status: "human_handoff", assignedUserId: me.id })
        .where(and(eq(chatbotConversationsTable.id, conversation.id), eq(chatbotConversationsTable.tenantId, me.tenantId)));
      const queued = await dispatchOutboundMessage({
        tenantId: me.tenantId,
        eventType: "instagram_human_reply",
        idempotencyKey: `instagram:staff:${parsed.data.idempotencyKey}`,
        recipient: { type: "direct", name: "Instagram" },
        instagram: { text: parsed.data.content },
        channels: ["instagram"],
        origin: "instagram-attendance",
        originChannel: "instagram",
        createdById: me.id,
        metadata: {
          conversationId: conversation.id,
          chatbotMessageId: id,
          instagramRecipientId: conversation.sessionId,
          instagramIntegrationId: integration.id,
          instagramProvider: provider,
          instagramUserId: provider === "meta"
            ? ((integration.config ?? {}) as Record<string, string>).instagramUserId
            : null,
          zernioConversationId: metadata["zernioConversationId"],
          zernioAccountId: metadata["zernioAccountId"],
          zernioProfileId: metadata["zernioProfileId"],
        },
      });
      const [message] = await db.select().from(chatbotMessagesTable)
        .where(and(eq(chatbotMessagesTable.id, id), eq(chatbotMessagesTable.tenantId, me.tenantId)))
        .limit(1);
      res.status(queued.deliveries.some((delivery) => delivery.status === "accepted") ? 201 : 202).json(message);
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
    const delivered = existing
      ? await deliverAttendanceReply({
          tenantId: me.tenantId,
          messageId: existing.id,
          inlineOnQueueFailure: true,
        })
      : false;
    if (!existing) {
      next(new ValidationError("Não foi possível enviar a mensagem pelo WhatsApp.", "WHATSAPP_DELIVERY_FAILED"));
      return;
    }
    const [message] = await db.select().from(chatbotMessagesTable)
      .where(and(eq(chatbotMessagesTable.id, existing.id), eq(chatbotMessagesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!message) {
      next(new NotFoundError("Mensagem não encontrada após o envio.", "MESSAGE_NOT_FOUND"));
      return;
    }
    if (!delivered && message.deliveryStatus === "cancelled") {
      next(new ForbiddenError(
        safeChatbotDeliveryIssue(conversation.channel, message.deliveryStatus, message.lastDeliveryError)
          ?? CHATBOT_DELIVERY_ISSUES.optedOut,
        "WHATSAPP_OPTED_OUT",
      ));
      return;
    }
    if (!delivered && message.deliveryStatus === "unknown") {
      res.status(502).json({
        code: "WHATSAPP_DELIVERY_UNKNOWN",
        error: safeChatbotDeliveryIssue(conversation.channel, message.deliveryStatus, message.lastDeliveryError)
          ?? CHATBOT_DELIVERY_ISSUES.deliveryUnknown,
      });
      return;
    }
    if (!delivered && message.deliveryStatus === "failed") {
      next(new ValidationError(
        safeChatbotDeliveryIssue(conversation.channel, message.deliveryStatus, message.lastDeliveryError)
          ?? CHATBOT_DELIVERY_ISSUES.rejected,
        "WHATSAPP_DELIVERY_FAILED",
      ));
      return;
    }
    await db.update(chatbotConversationsTable)
      .set({ status: "human_handoff", assignedUserId: me.id })
      .where(eq(chatbotConversationsTable.id, conversation.id));
    res.status(delivered ? 201 : 202).json(message);
  } catch (err) {
    next(err);
  }
});

export default router;
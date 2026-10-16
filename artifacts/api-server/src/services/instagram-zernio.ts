import { createHmac, timingSafeEqual } from "node:crypto";
import {
  db,
  clientsTable,
  chatbotConversationsTable,
  chatbotMessagesTable,
  tenantIntegrationsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { generateId } from "../lib/id";
import { logger } from "../lib/logger";
import type { InboundProviderAdapter } from "./messaging-provider-adapters.js";

export const INSTAGRAM_ZERNIO_TYPE = "instagram_zernio";

export class ZernioInstagramSendError extends Error {
  constructor(
    readonly kind: "rejected" | "unknown",
    readonly httpStatus?: number,
  ) {
    super("Zernio Instagram message send failed");
    this.name = "ZernioInstagramSendError";
  }
}

export async function sendZernioInstagramText(
  apiKey: string,
  accountId: string,
  conversationId: string,
  content: string,
  idempotencyKey: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(
      `https://zernio.com/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ accountId, message: content }),
        signal: AbortSignal.timeout(12000),
      },
    );
  } catch {
    throw new ZernioInstagramSendError("unknown");
  }

  if (!response.ok) {
    throw new ZernioInstagramSendError(response.status >= 500 ? "unknown" : "rejected", response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ZernioInstagramSendError("unknown", response.status);
  }
  const data = asObject(asObject(payload)?.data);
  const messageId = nonEmptyString(data?.messageId);
  if (!messageId) throw new ZernioInstagramSendError("unknown", response.status);
  return messageId;
}

type JsonObject = Record<string, unknown>;

export interface ZernioInstagramMessage {
  accountId: string;
  profileId: string | null;
  conversationId: string;
  senderId: string;
  senderUsername: string | null;
  messageId: string;
  content: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  sentAt: Date;
}

export interface ZernioInstagramMessageStatus {
  accountId: string;
  profileId: string | null;
  conversationId: string;
  messageId: string;
  status: "delivered" | "read";
  statusAt: Date;
}

interface ZernioInstagramSentMessage {
  accountId: string;
  profileId: string | null;
  conversationId: string;
  messageId: string;
  content: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  sentAt: Date;
}

interface ZernioInstagramAttachment {
  mediaUrl: string;
  mediaMimeType: string | null;
  mediaFileName: string | null;
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeHttpUrl(value: unknown): string | null {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function inferInstagramMediaMimeType(url: string, type: unknown): string | null {
  const normalizedType = nonEmptyString(type)?.toLowerCase();
  if (normalizedType && /^(image|video|audio)\//.test(normalizedType)) return normalizedType;
  const path = new URL(url).pathname.toLowerCase();
  const extension = path.split(".").pop();
  const knownMimeTypes: Record<string, string> = {
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    wav: "audio/wav",
  };
  return extension ? knownMimeTypes[extension] ?? null : null;
}

function firstZernioInstagramAttachment(value: unknown): ZernioInstagramAttachment | null {
  if (!Array.isArray(value)) return null;
  for (const rawAttachment of value) {
    const attachment = asObject(rawAttachment);
    const mediaUrl = safeHttpUrl(attachment?.url ?? attachment?.mediaUrl);
    if (!attachment || !mediaUrl) continue;
    const rawMimeType = nonEmptyString(attachment.mimeType) ?? nonEmptyString(attachment.contentType);
    const normalizedMimeType = rawMimeType?.split(";", 1)[0]?.trim().toLowerCase();
    const mediaMimeType = normalizedMimeType && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalizedMimeType)
      ? normalizedMimeType
      : inferInstagramMediaMimeType(mediaUrl, attachment.type);
    const mediaFileName = nonEmptyString(attachment.fileName) ?? nonEmptyString(attachment.name);
    return { mediaUrl, mediaMimeType, mediaFileName };
  }
  return null;
}

export function normalizeInstagramUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim()
    .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "")
    .split(/[/?#]/, 1)[0]!
    .replace(/^@+/, "");
  if (!/^[a-z0-9._]{1,30}$/i.test(username)) return null;
  return username.toLocaleLowerCase("en-US");
}

export function resolveUniqueInstagramClientMatch(
  matchingClientIds: string[],
  currentClientId: string | null,
  hasManualOverride: boolean,
): string | null {
  if (currentClientId || hasManualOverride || matchingClientIds.length !== 1) return null;
  return matchingClientIds[0] ?? null;
}

export function verifyZernioWebhookSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secret: string | null | undefined,
): boolean {
  if (!rawBody || !signatureHeader || !secret || !/^[a-f0-9]{64}$/.test(signatureHeader)) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signatureHeader, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function parseZernioInstagramMessage(payload: unknown): ZernioInstagramMessage | null {
  const event = asObject(payload);
  if (event?.event !== "message.received") return null;
  const account = asObject(event.account);
  const message = asObject(event.message);
  const sender = asObject(message?.sender);
  if (!message || message.platform !== "instagram" || message.direction !== "incoming") return null;

  const accountId = nonEmptyString(account?.accountId) ?? nonEmptyString(account?.id);
  const profileId = nonEmptyString(account?.profileId);
  const conversationId = nonEmptyString(message.conversationId);
  const senderId = nonEmptyString(sender?.id);
  const senderUsername = normalizeInstagramUsername(sender?.username);
  const messageId = nonEmptyString(message.id) ?? nonEmptyString(message.platformMessageId);
  if (!accountId || !conversationId || !senderId || !messageId) return null;

  const timestampValue = event.timestamp ?? message.timestamp;
  const sentAt = typeof timestampValue === "number"
    ? new Date(timestampValue)
    : typeof timestampValue === "string"
      ? new Date(timestampValue)
      : new Date();
  if (Number.isNaN(sentAt.getTime())) return null;

  const text = nonEmptyString(message.text);
  const attachment = firstZernioInstagramAttachment(message.attachments);
  if (!text && !attachment) return null;

  return {
    accountId,
    profileId,
    conversationId,
    senderId,
    senderUsername,
    messageId,
    content: text ?? "Mídia recebida pelo Instagram",
    mediaUrl: attachment?.mediaUrl ?? null,
    mediaMimeType: attachment?.mediaMimeType ?? null,
    mediaFileName: attachment?.mediaFileName ?? null,
    sentAt,
  };
}

export const zernioInstagramInboundAdapter: InboundProviderAdapter<unknown, ZernioInstagramMessage> = {
  id: "zernio",
  normalize(payload) {
    const message = parseZernioInstagramMessage(payload);
    if (!message) return [];
    return [{
      provider: "zernio",
      channel: "instagram",
      accountId: message.accountId,
      conversationId: message.conversationId,
      senderId: message.senderId,
      externalId: message.messageId,
      content: message.content,
      occurredAt: message.sentAt,
      media: message.mediaUrl || message.mediaMimeType || message.mediaFileName
        ? {
            kind: "attachment",
            mimeType: message.mediaMimeType,
            fileName: message.mediaFileName,
            url: message.mediaUrl,
          }
        : null,
      providerData: message,
    }];
  },
};

export function parseZernioInstagramMessageStatus(
  payload: unknown,
): ZernioInstagramMessageStatus | null {
  const event = asObject(payload);
  if (event?.event !== "message.delivered" && event?.event !== "message.read") {
    return null;
  }
  const account = asObject(event.account);
  const message = asObject(event.message);
  if (
    !message ||
    message.platform !== "instagram" ||
    message.direction !== "outgoing"
  ) {
    return null;
  }

  const accountId = nonEmptyString(account?.accountId) ?? nonEmptyString(account?.id);
  const profileId = nonEmptyString(account?.profileId);
  const conversationId = nonEmptyString(message.conversationId);
  const messageId = nonEmptyString(message.id) ?? nonEmptyString(message.platformMessageId);
  const statusAtValue = event.statusAt;
  const statusAt = typeof statusAtValue === "string" ? new Date(statusAtValue) : null;
  if (
    !accountId ||
    !conversationId ||
    !messageId ||
    !statusAt ||
    Number.isNaN(statusAt.getTime())
  ) {
    return null;
  }

  return {
    accountId,
    profileId,
    conversationId,
    messageId,
    status: event.event === "message.read" ? "read" : "delivered",
    statusAt,
  };
}

export function parseZernioInstagramSentMessage(payload: unknown): ZernioInstagramSentMessage | null {
  const event = asObject(payload);
  if (event?.event !== "message.sent") return null;
  const account = asObject(event.account);
  const message = asObject(event.message);
  if (
    !message ||
    message.platform !== "instagram" ||
    message.direction !== "outgoing"
  ) {
    return null;
  }
  const accountId = nonEmptyString(account?.accountId) ?? nonEmptyString(account?.id);
  const profileId = nonEmptyString(account?.profileId);
  const conversationId = nonEmptyString(message.conversationId);
  const messageId = nonEmptyString(message.id) ?? nonEmptyString(message.platformMessageId);
  const timestampValue = event.timestamp ?? message.timestamp;
  const attachment = firstZernioInstagramAttachment(message.attachments);
  const sentAt = typeof timestampValue === "string" || typeof timestampValue === "number"
    ? new Date(timestampValue)
    : new Date();
  if (
    !accountId ||
    !conversationId ||
    !messageId ||
    (!nonEmptyString(message.text) && !attachment) ||
    Number.isNaN(sentAt.getTime())
  ) {
    return null;
  }
  return {
    accountId,
    profileId,
    conversationId,
    messageId,
    content: nonEmptyString(message.text) ?? "Mídia enviada pelo Instagram",
    mediaUrl: attachment?.mediaUrl ?? null,
    mediaMimeType: attachment?.mediaMimeType ?? null,
    mediaFileName: attachment?.mediaFileName ?? null,
    sentAt,
  };
}

function integrationConfig(value: unknown): JsonObject {
  return asObject(value) ?? {};
}

export async function resolveZernioIntegration(
  accountId: string,
  profileId: string | null,
  integrationId?: string,
) {
  const integrations = await db.select().from(tenantIntegrationsTable)
    .where(and(
      eq(tenantIntegrationsTable.type, INSTAGRAM_ZERNIO_TYPE),
      eq(tenantIntegrationsTable.enabled, true),
      eq(tenantIntegrationsTable.status, "connected"),
      ...(integrationId ? [eq(tenantIntegrationsTable.id, integrationId)] : []),
    ));
  const matches = integrations.filter((integration) => {
    const config = integrationConfig(integration.config);
    return config["accountId"] === accountId
      && (!profileId || config["profileId"] === profileId);
  });
  if (matches.length !== 1) {
    logger.warn({
      accountId,
      profileId,
      matchCount: matches.length,
    }, "[instagram-zernio] Ignored event for an unmapped or ambiguous account");
    return null;
  }
  return matches[0]!;
}

export async function processZernioInstagramWebhook(
  payload: unknown,
  integrationId?: string,
): Promise<number> {
  const sent = parseZernioInstagramSentMessage(payload);
  if (sent) {
    const integration = await resolveZernioIntegration(sent.accountId, sent.profileId, integrationId);
    if (!integration) return 0;
    const [conversation] = await db.select({ id: chatbotConversationsTable.id })
      .from(chatbotConversationsTable)
      .where(and(
        eq(chatbotConversationsTable.tenantId, integration.tenantId),
        eq(chatbotConversationsTable.channel, "instagram"),
        sql`${chatbotConversationsTable.metadata}->>'provider' = 'zernio'`,
        sql`${chatbotConversationsTable.metadata}->>'instagramIntegrationId' = ${integration.id}`,
        sql`${chatbotConversationsTable.metadata}->>'zernioAccountId' = ${sent.accountId}`,
        sql`${chatbotConversationsTable.metadata}->>'zernioConversationId' = ${sent.conversationId}`,
      ))
      .limit(1);
    if (!conversation) return 0;
    const [created] = await db.insert(chatbotMessagesTable).values({
      id: generateId(),
      tenantId: integration.tenantId,
      conversationId: conversation.id,
      providerMessageId: sent.messageId,
      role: "assistant",
      content: sent.content,
      mediaUrl: sent.mediaUrl,
      mediaMimeType: sent.mediaMimeType,
      mediaFileName: sent.mediaFileName,
      sentAt: sent.sentAt,
      isBot: false,
      deliveryStatus: "sent",
    }).onConflictDoNothing().returning({ id: chatbotMessagesTable.id });
    return created ? 1 : 0;
  }

  const status = parseZernioInstagramMessageStatus(payload);
  if (status) {
    const integration = await resolveZernioIntegration(status.accountId, status.profileId, integrationId);
    if (!integration) return 0;
    const [conversation] = await db.select({ id: chatbotConversationsTable.id })
      .from(chatbotConversationsTable)
      .where(and(
        eq(chatbotConversationsTable.tenantId, integration.tenantId),
        eq(chatbotConversationsTable.channel, "instagram"),
        sql`${chatbotConversationsTable.metadata}->>'provider' = 'zernio'`,
        sql`${chatbotConversationsTable.metadata}->>'instagramIntegrationId' = ${integration.id}`,
        sql`${chatbotConversationsTable.metadata}->>'zernioAccountId' = ${status.accountId}`,
        sql`${chatbotConversationsTable.metadata}->>'zernioConversationId' = ${status.conversationId}`,
      ))
      .limit(1);
    if (!conversation) return 0;

    const updated = await db.update(chatbotMessagesTable)
      .set({
        deliveryStatus: status.status === "read"
          ? "read"
          : sql`CASE WHEN ${chatbotMessagesTable.deliveryStatus} = 'read' THEN 'read' ELSE 'delivered' END`,
        deliveryUpdatedAt: sql`GREATEST(${chatbotMessagesTable.deliveryUpdatedAt}, ${status.statusAt})`,
      })
      .where(and(
        eq(chatbotMessagesTable.tenantId, integration.tenantId),
        eq(chatbotMessagesTable.conversationId, conversation.id),
        eq(chatbotMessagesTable.providerMessageId, status.messageId),
        eq(chatbotMessagesTable.role, "assistant"),
      ))
      .returning({ id: chatbotMessagesTable.id });
    return updated.length;
  }

  const event = zernioInstagramInboundAdapter.normalize(payload)[0];
  if (!event) return 0;
  const message = event.providerData;

  const integration = await resolveZernioIntegration(message.accountId, message.profileId, integrationId);
  if (!integration) return 0;
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`instagram-zernio:${message.accountId}:${message.senderId}`}, 0)
      )
    `);

    const [activeIntegration] = await tx.select({ id: tenantIntegrationsTable.id })
      .from(tenantIntegrationsTable)
      .where(and(
        eq(tenantIntegrationsTable.id, integration.id),
        eq(tenantIntegrationsTable.tenantId, integration.tenantId),
        eq(tenantIntegrationsTable.type, INSTAGRAM_ZERNIO_TYPE),
        eq(tenantIntegrationsTable.enabled, true),
        eq(tenantIntegrationsTable.status, "connected"),
        sql`${tenantIntegrationsTable.config}->>'accountId' = ${message.accountId}`,
      ))
      .for("update")
      .limit(1);
    if (!activeIntegration) return 0;

    const [existingConversation] = await tx.select().from(chatbotConversationsTable)
      .where(and(
        eq(chatbotConversationsTable.tenantId, integration.tenantId),
        eq(chatbotConversationsTable.channel, "instagram"),
        eq(chatbotConversationsTable.sessionId, message.senderId),
        sql`${chatbotConversationsTable.metadata}->>'instagramIntegrationId' = ${integration.id}`,
        sql`${chatbotConversationsTable.metadata}->>'zernioConversationId' = ${message.conversationId}`,
      ))
      .limit(1);
    const existingMetadata = asObject(existingConversation?.metadata) ?? {};
    const instagramUsername = message.senderUsername
      ?? normalizeInstagramUsername(existingMetadata["instagramUsername"]);
    const exactClientMatches = instagramUsername
      ? await tx.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, integration.tenantId),
          eq(clientsTable.status, "active"),
          sql`lower(regexp_replace(regexp_replace(regexp_replace(trim(${clientsTable.instagram}), '^https?://(www\\.)?instagram\\.com/', '', 'i'), '[/#?].*$', ''), '^@+', '')) = ${instagramUsername}`,
        ))
        .limit(2)
      : [];
    const autoMatchedClientId = resolveUniqueInstagramClientMatch(
      exactClientMatches.map((client) => client.id),
      existingConversation?.clientId ?? null,
      existingMetadata["clientAssociationManualOverride"] === true,
    );
    const metadata = {
      ...existingMetadata,
      source: "instagram",
      provider: "zernio",
      instagramIntegrationId: integration.id,
      zernioAccountId: message.accountId,
      zernioProfileId: message.profileId ?? "",
      zernioConversationId: message.conversationId,
      ...(instagramUsername ? { instagramUsername } : {}),
    };
    let conversation = existingConversation;
    if (!conversation) {
      [conversation] = await tx.insert(chatbotConversationsTable).values({
        id: generateId(),
        tenantId: integration.tenantId,
        clientId: autoMatchedClientId,
        channel: "instagram",
        sessionId: message.senderId,
        metadata,
      }).returning();
    } else {
      [conversation] = await tx.update(chatbotConversationsTable)
        .set({
          ...(conversation.status === "closed" ? { status: "open", endedAt: null } : {}),
          ...(autoMatchedClientId ? { clientId: autoMatchedClientId } : {}),
          metadata,
        })
        .where(and(
          eq(chatbotConversationsTable.id, conversation.id),
          eq(chatbotConversationsTable.tenantId, integration.tenantId),
        ))
        .returning();
    }
    if (!conversation) throw new Error("Could not persist Zernio Instagram conversation");

    const [created] = await tx.insert(chatbotMessagesTable).values({
      id: generateId(),
      tenantId: integration.tenantId,
      conversationId: conversation.id,
      sourceMessageId: `zernio:${message.messageId}`,
      role: "user",
      content: message.content,
      mediaUrl: message.mediaUrl,
      mediaMimeType: message.mediaMimeType,
      mediaFileName: message.mediaFileName,
      sentAt: message.sentAt,
      isBot: false,
    }).onConflictDoNothing().returning({ id: chatbotMessagesTable.id });
    return created ? 1 : 0;
  });
}

export interface ZernioHistoryImportProgress {
  conversationsFound: number;
  conversationsProcessed: number;
  messagesImported: number;
  messagesAlreadyPresent: number;
  messagesSkipped: number;
}

export interface ZernioHistoryImportCursor {
  status: "active" | "archived";
  conversationCursor: string | null;
  conversationIds: string[] | null;
  conversationIndex: number;
  conversationPageHasMore: boolean;
  conversationPageNextCursor: string | null;
  messageConversationId: string | null;
  messageCursor: string | null;
  progress: ZernioHistoryImportProgress;
}

export interface ZernioHistoryImportChunk {
  done: boolean;
  cursor: ZernioHistoryImportCursor | null;
  progress: ZernioHistoryImportProgress;
}

function initialHistoryCursor(): ZernioHistoryImportCursor {
  return {
    status: "active",
    conversationCursor: null,
    conversationIds: null,
    conversationIndex: 0,
    conversationPageHasMore: false,
    conversationPageNextCursor: null,
    messageConversationId: null,
    messageCursor: null,
    progress: {
      conversationsFound: 0,
      conversationsProcessed: 0,
      messagesImported: 0,
      messagesAlreadyPresent: 0,
      messagesSkipped: 0,
    },
  };
}

function cloneHistoryCursor(cursor: ZernioHistoryImportCursor): ZernioHistoryImportCursor {
  return {
    ...cursor,
    conversationIds: cursor.conversationIds ? [...cursor.conversationIds] : null,
    progress: { ...cursor.progress, messagesSkipped: cursor.progress.messagesSkipped ?? 0 },
  };
}

function validHistoryCursor(value: unknown): value is ZernioHistoryImportCursor {
  const cursor = asObject(value);
  const progress = asObject(cursor?.progress);
  const ids = cursor?.conversationIds;
  return (
    (cursor?.status === "active" || cursor?.status === "archived") &&
    (cursor.conversationCursor === null || typeof cursor.conversationCursor === "string") &&
    (ids === null || (Array.isArray(ids) && ids.length <= 100 && ids.every((id) => typeof id === "string" && id.length <= 200))) &&
    Number.isInteger(cursor.conversationIndex) &&
    typeof cursor.conversationPageHasMore === "boolean" &&
    (cursor.conversationPageNextCursor === null || typeof cursor.conversationPageNextCursor === "string") &&
    (cursor.messageConversationId === null || typeof cursor.messageConversationId === "string") &&
    (cursor.messageCursor === null || typeof cursor.messageCursor === "string") &&
    ["conversationsFound", "conversationsProcessed", "messagesImported", "messagesAlreadyPresent"]
      .every((key) => Number.isSafeInteger(progress?.[key]) && Number(progress?.[key]) >= 0) &&
    (progress?.messagesSkipped === undefined ||
      (Number.isSafeInteger(progress.messagesSkipped) && Number(progress.messagesSkipped) >= 0))
  );
}

function cursorPage(payload: unknown, arrayKey: "data" | "messages") {
  const object = asObject(payload);
  const pagination = asObject(object?.pagination);
  const items = object?.[arrayKey];
  if (!Array.isArray(items) || typeof pagination?.hasMore !== "boolean") {
    throw new Error("Invalid Zernio inbox response");
  }
  return {
    items,
    hasMore: pagination.hasMore,
    nextCursor: nonEmptyString(pagination.nextCursor),
  };
}

async function fetchZernioInboxPage(url: URL, apiKey: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Zernio inbox returned HTTP ${response.status}`);
  return response.json();
}

/**
 * Imports a bounded number of provider pages. The returned cursor contains no
 * credentials and can be saved by the client between requests, so transient
 * network failures do not force completed pages to be fetched again.
 */
export async function importZernioInstagramHistoryChunk(
  apiKey: string,
  accountId: string,
  profileId: string,
  integrationId: string,
  inputCursor?: unknown,
): Promise<ZernioHistoryImportChunk> {
  const cursor = inputCursor === undefined ? initialHistoryCursor() :
    validHistoryCursor(inputCursor) ? cloneHistoryCursor(inputCursor) : null;
  if (!cursor) throw new Error("Invalid Zernio import cursor");

  const baseUrl = "https://zernio.com/api/v1/inbox/conversations";
  let requests = 0;
  const maxRequests = 2;
  let integrationTenantId: string | null | undefined;

  while (requests < maxRequests) {
    if (!cursor.conversationIds) {
      const url = new URL(baseUrl);
      url.searchParams.set("accountId", accountId);
      url.searchParams.set("profileId", profileId);
      url.searchParams.set("platform", "instagram");
      url.searchParams.set("status", cursor.status);
      url.searchParams.set("limit", "100");
      if (cursor.conversationCursor) url.searchParams.set("cursor", cursor.conversationCursor);
      const page = cursorPage(await fetchZernioInboxPage(url, apiKey), "data");
      requests++;
      const seen = new Set<string>();
      cursor.conversationIds = page.items.flatMap((raw) => {
        const conversation = asObject(raw);
        const id = nonEmptyString(conversation?.id);
        if (!id || conversation?.platform !== "instagram" || conversation.accountId !== accountId || seen.has(id)) return [];
        seen.add(id);
        return [id];
      });
      cursor.progress.conversationsFound += cursor.conversationIds.length;
      cursor.conversationPageHasMore = page.hasMore;
      cursor.conversationPageNextCursor = page.nextCursor;
      cursor.conversationIndex = 0;
    }

    if (cursor.conversationIndex >= cursor.conversationIds.length) {
      if (cursor.conversationPageHasMore) {
        if (!cursor.conversationPageNextCursor || cursor.conversationPageNextCursor === cursor.conversationCursor) {
          throw new Error("Invalid Zernio conversation pagination cursor");
        }
        cursor.conversationCursor = cursor.conversationPageNextCursor;
        cursor.conversationIds = null;
        cursor.conversationPageNextCursor = null;
        continue;
      }
      if (cursor.status === "active") {
        cursor.status = "archived";
        cursor.conversationCursor = null;
        cursor.conversationIds = null;
        cursor.conversationPageNextCursor = null;
        continue;
      }
      return { done: true, cursor: null, progress: cursor.progress };
    }

    const conversationId = cursor.conversationIds[cursor.conversationIndex]!;
    cursor.messageConversationId = conversationId;
    if (requests >= maxRequests) break;
    const messagesUrl = new URL(`${baseUrl}/${encodeURIComponent(conversationId)}/messages`);
    messagesUrl.searchParams.set("accountId", accountId);
    messagesUrl.searchParams.set("limit", "100");
    messagesUrl.searchParams.set("sortOrder", "asc");
    if (cursor.messageCursor) messagesUrl.searchParams.set("cursor", cursor.messageCursor);
    const messagePage = cursorPage(await fetchZernioInboxPage(messagesUrl, apiKey), "messages");
    requests++;
    for (const rawMessage of messagePage.items) {
      const item = asObject(rawMessage);
      const messageId = nonEmptyString(item?.id);
      const direction = item?.direction;
      const senderId = nonEmptyString(item?.senderId);
      const createdAt = nonEmptyString(item?.createdAt) ?? nonEmptyString(item?.sentAt);
      const content = nonEmptyString(item?.message);
      const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
      const attachment = firstZernioInstagramAttachment(attachments);
      if (
        !messageId ||
        item?.platform !== "instagram" ||
        item.conversationId !== conversationId ||
        item.accountId !== accountId ||
        (direction !== "incoming" && direction !== "outgoing") ||
        (direction === "incoming" && !senderId) ||
        (!content && !attachment) ||
        !createdAt
      ) continue;
      const imported = await processZernioInstagramWebhook({
        event: direction === "incoming" ? "message.received" : "message.sent",
        timestamp: createdAt,
        account: { accountId, profileId },
        message: {
          id: messageId,
          conversationId,
          platform: "instagram",
          direction,
          text: content,
          sender: { id: senderId },
          attachments,
        },
      }, integrationId);
      if (imported > 0) cursor.progress.messagesImported++;
      else {
        if (integrationTenantId === undefined) {
          const [integration] = await db.select({ tenantId: tenantIntegrationsTable.tenantId })
            .from(tenantIntegrationsTable)
            .where(eq(tenantIntegrationsTable.id, integrationId))
            .limit(1);
          integrationTenantId = integration?.tenantId ?? null;
        }
        const messageSourceFilter = direction === "incoming"
          ? eq(chatbotMessagesTable.sourceMessageId, `zernio:${messageId}`)
          : eq(chatbotMessagesTable.providerMessageId, messageId);
        const existingMessage = integrationTenantId
          ? await db.select({ id: chatbotMessagesTable.id })
            .from(chatbotMessagesTable)
            .where(and(
              eq(chatbotMessagesTable.tenantId, integrationTenantId),
              messageSourceFilter,
            ))
            .limit(1)
          : [];
        if (existingMessage.length > 0) cursor.progress.messagesAlreadyPresent++;
        else cursor.progress.messagesSkipped++;
      }
    }
    if (messagePage.hasMore) {
      if (!messagePage.nextCursor || messagePage.nextCursor === cursor.messageCursor) {
        throw new Error("Invalid Zernio message pagination cursor");
      }
      cursor.messageCursor = messagePage.nextCursor;
    } else {
      cursor.messageCursor = null;
      cursor.messageConversationId = null;
      cursor.conversationIndex++;
      cursor.progress.conversationsProcessed++;
    }
  }

  return { done: false, cursor, progress: cursor.progress };
}

export async function importZernioInstagramHistory(
  apiKey: string,
  accountId: string,
  profileId: string,
  integrationId: string,
  onProgress: (progress: ZernioHistoryImportProgress) => void,
): Promise<ZernioHistoryImportProgress> {
  let cursor: ZernioHistoryImportCursor | undefined;
  while (true) {
    const chunk = await importZernioInstagramHistoryChunk(apiKey, accountId, profileId, integrationId, cursor);
    onProgress(chunk.progress);
    if (chunk.done) return chunk.progress;
    cursor = chunk.cursor ?? undefined;
  }
}

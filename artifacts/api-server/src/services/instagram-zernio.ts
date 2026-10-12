import { createHmac, timingSafeEqual } from "node:crypto";
import {
  db,
  chatbotConversationsTable,
  chatbotMessagesTable,
  tenantIntegrationsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { generateId } from "../lib/id";
import { logger } from "../lib/logger";

export const INSTAGRAM_ZERNIO_TYPE = "instagram_zernio";

type JsonObject = Record<string, unknown>;

export interface ZernioInstagramMessage {
  accountId: string;
  profileId: string | null;
  conversationId: string;
  senderId: string;
  messageId: string;
  content: string;
  sentAt: Date;
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
  if (!text && !hasAttachments) return null;

  return {
    accountId,
    profileId,
    conversationId,
    senderId,
    messageId,
    content: text ?? "Mídia recebida pelo Instagram",
    sentAt,
  };
}

function integrationConfig(value: unknown): JsonObject {
  return asObject(value) ?? {};
}

export async function processZernioInstagramWebhook(payload: unknown): Promise<number> {
  const message = parseZernioInstagramMessage(payload);
  if (!message) return 0;

  const integrations = await db.select().from(tenantIntegrationsTable)
    .where(and(
      eq(tenantIntegrationsTable.type, INSTAGRAM_ZERNIO_TYPE),
      eq(tenantIntegrationsTable.enabled, true),
      eq(tenantIntegrationsTable.status, "connected"),
    ));
  const matches = integrations.filter((integration) => {
    const config = integrationConfig(integration.config);
    return config["accountId"] === message.accountId
      && (!message.profileId || config["profileId"] === message.profileId);
  });
  if (matches.length !== 1) {
    logger.warn({
      accountId: message.accountId,
      profileId: message.profileId,
      matchCount: matches.length,
    }, "[instagram-zernio] Ignored message for an unmapped or ambiguous account");
    return 0;
  }

  const integration = matches[0]!;
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
    const metadata = {
      ...(asObject(existingConversation?.metadata) ?? {}),
      source: "instagram",
      provider: "zernio",
      instagramIntegrationId: integration.id,
      zernioAccountId: message.accountId,
      zernioProfileId: message.profileId ?? "",
      zernioConversationId: message.conversationId,
    };
    let conversation = existingConversation;
    if (!conversation) {
      [conversation] = await tx.insert(chatbotConversationsTable).values({
        id: generateId(),
        tenantId: integration.tenantId,
        clientId: null,
        channel: "instagram",
        sessionId: message.senderId,
        metadata,
      }).returning();
    } else if (conversation.status === "closed") {
      [conversation] = await tx.update(chatbotConversationsTable)
        .set({ status: "open", endedAt: null, metadata })
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
      sentAt: message.sentAt,
      isBot: false,
    }).onConflictDoNothing().returning({ id: chatbotMessagesTable.id });
    return created ? 1 : 0;
  });
}

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  db,
  chatbotConversationsTable,
  chatbotMessagesTable,
  instagramDataDeletionRequestsTable,
  instagramOAuthStatesTable,
  tenantIntegrationsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { decryptCredential, encryptCredential } from "../lib/crypto";
import { generateId } from "../lib/id";
import { logger } from "../lib/logger";

const DEFAULT_GRAPH_VERSION = "v26.0";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_INSTAGRAM_TEXT_BYTES = 1000;

export const INSTAGRAM_MESSAGING_TYPE = "instagram_messaging";

export interface InstagramMetaConfig {
  appId: string | null;
  appSecret: string | null;
  webhookVerifyToken: string | null;
  redirectUri: string | null;
  webhookUrl: string | null;
  deauthorizationUrl: string | null;
  dataDeletionUrl: string | null;
  dataDeletionStatusUrl: string | null;
  settingsUrl: string | null;
  graphVersion: string;
  appConfigured: boolean;
}

export interface InstagramOAuthResult {
  instagramUserId: string;
  username: string | null;
  accessToken: string;
  tokenIssuedAt: Date;
  tokenExpiresAt: Date;
}

export interface InstagramWebhookMessage {
  instagramUserId: string;
  senderId: string;
  messageId: string;
  content: string;
  sentAt: Date;
}

export class InstagramProviderError extends Error {
  constructor(
    readonly kind: "rejected" | "unknown",
    readonly httpStatus?: number,
  ) {
    super(kind === "unknown" ? "Instagram provider outcome is unknown" : "Instagram provider rejected the request");
    this.name = "InstagramProviderError";
  }
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validPublicUrl(raw: string | undefined): string | null {
  const candidate = raw?.trim();
  if (!candidate) return null;
  try {
    const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
      ? candidate
      : `https://${candidate}`;
    const url = new URL(normalized);
    if (
      url.protocol !== "https:"
      || !url.hostname
      || url.username
      || url.password
      || url.hostname === "localhost"
      || url.hostname.endsWith(".localhost")
    ) {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function publicBaseUrl(): string | null {
  const firstReplitDomain = (process.env["REPLIT_DOMAINS"] ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .find(Boolean);
  const candidates = [
    process.env["API_BASE_URL"],
    ...(process.env["NODE_ENV"] === "development" ? [process.env["REPLIT_DEV_DOMAIN"]] : []),
    firstReplitDomain,
    process.env["FRONTEND_URL"],
    ...(process.env["NODE_ENV"] !== "development" ? [process.env["REPLIT_DEV_DOMAIN"]] : []),
  ];
  for (const candidate of candidates) {
    const normalized = validPublicUrl(candidate);
    if (!normalized) continue;
    const url = new URL(normalized);
    const basePath = url.pathname.replace(/\/+$/, "").replace(/\/api$/i, "");
    return `${url.origin}${basePath}`;
  }
  return null;
}

function resolveRedirectUri(baseUrl: string | null): string | null {
  const override = process.env["INSTAGRAM_OAUTH_REDIRECT_URI"]?.trim();
  if (override) return validPublicUrl(override);
  return baseUrl ? `${baseUrl}/api/instagram-messaging/callback` : null;
}

export function getInstagramMetaConfig(): InstagramMetaConfig {
  const appId = process.env["INSTAGRAM_APP_ID"]?.trim() || null;
  const appSecret = process.env["INSTAGRAM_APP_SECRET"]?.trim() || null;
  const webhookVerifyToken = process.env["INSTAGRAM_WEBHOOK_VERIFY_TOKEN"]?.trim() || null;
  const baseUrl = publicBaseUrl();
  const redirectUri = resolveRedirectUri(baseUrl);
  const webhookUrl = baseUrl ? `${baseUrl}/api/webhooks/instagram` : null;
  const deauthorizationUrl = baseUrl ? `${baseUrl}/api/instagram-messaging/deauthorize` : null;
  const dataDeletionUrl = baseUrl ? `${baseUrl}/api/instagram-messaging/data-deletion` : null;
  const dataDeletionStatusUrl = baseUrl
    ? `${baseUrl}/api/instagram-messaging/data-deletion-status`
    : null;
  const frontendBase = validPublicUrl(process.env["FRONTEND_URL"]) ?? baseUrl;
  const settingsUrl = frontendBase ? `${frontendBase}/configuracoes` : null;
  const configuredGraphVersion = process.env["INSTAGRAM_GRAPH_API_VERSION"]?.trim();
  const graphVersion = configuredGraphVersion && /^v\d+\.\d+$/.test(configuredGraphVersion)
    ? configuredGraphVersion
    : DEFAULT_GRAPH_VERSION;
  return {
    appId,
    appSecret,
    webhookVerifyToken,
    redirectUri,
    webhookUrl,
    deauthorizationUrl,
    dataDeletionUrl,
    dataDeletionStatusUrl,
    settingsUrl,
    graphVersion,
    appConfigured: Boolean(
      appId
      && appSecret
      && webhookVerifyToken
      && redirectUri
      && webhookUrl
      && deauthorizationUrl
      && dataDeletionUrl
      && dataDeletionStatusUrl,
    ),
  };
}

export function hashInstagramOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function createInstagramAuthorizationUrl(
  config: InstagramMetaConfig,
  state: string,
): string | null {
  if (!config.appId || !config.redirectUri) return null;
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_messages");
  url.searchParams.set("state", state);
  url.searchParams.set("enable_fb_login", "false");
  return url.toString();
}

export function verifyInstagramWebhookSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string | null,
): boolean {
  if (!rawBody || !signatureHeader || !appSecret) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader.trim());
  if (!match?.[1]) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1], "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function verifyInstagramSignedRequest(
  signedRequest: unknown,
  appSecret: string | null,
): string | null {
  if (typeof signedRequest !== "string" || !appSecret || signedRequest.length > 8_192) return null;
  const parts = signedRequest.split(".");
  const encodedSignature = parts[0];
  const encodedPayload = parts[1];
  if (
    parts.length !== 2
    || !encodedSignature
    || !encodedPayload
    || !/^[A-Za-z0-9_-]+={0,2}$/.test(encodedSignature)
    || !/^[A-Za-z0-9_-]+={0,2}$/.test(encodedPayload)
  ) {
    return null;
  }

  const received = Buffer.from(encodedSignature, "base64url");
  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  let payload: JsonObject | null = null;
  try {
    payload = asObject(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")));
  } catch {
    return null;
  }
  if (stringValue(payload?.["algorithm"])?.toUpperCase() !== "HMAC-SHA256") return null;
  const rawUserId = payload?.["user_id"];
  const userId = typeof rawUserId === "string"
    ? rawUserId.trim()
    : typeof rawUserId === "number" && Number.isSafeInteger(rawUserId)
      ? String(rawUserId)
      : "";
  return userId && userId.length <= 255 ? userId : null;
}

export function createInstagramDeletionConfirmationCode(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

export function isInstagramReplyWindowOpen(
  lastInboundAt: Date | null,
  nowMs = Date.now(),
): boolean {
  if (!lastInboundAt || Number.isNaN(lastInboundAt.getTime())) return false;
  const ageMs = nowMs - lastInboundAt.getTime();
  return ageMs >= -5 * 60 * 1000 && ageMs < 24 * 60 * 60 * 1000;
}

export function parseInstagramWebhook(payload: unknown): InstagramWebhookMessage[] {
  const root = asObject(payload);
  if (!root || root.object !== "instagram" || !Array.isArray(root.entry)) return [];
  const result: InstagramWebhookMessage[] = [];
  const now = Date.now();

  for (const rawEntry of root.entry) {
    const entry = asObject(rawEntry);
    const instagramUserId = stringValue(entry?.id);
    if (!instagramUserId || !Array.isArray(entry?.messaging)) continue;
    for (const rawEvent of entry.messaging) {
      const event = asObject(rawEvent);
      const message = asObject(event?.message);
      const sender = asObject(event?.sender);
      const senderId = stringValue(sender?.id);
      const messageId = stringValue(message?.mid);
      if (!message || message.is_echo === true || !senderId || !messageId) continue;
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      const text = stringValue(message.text);
      if (!text && attachments.length === 0) continue;
      const timestamp = typeof event?.timestamp === "number"
        ? event.timestamp
        : typeof event?.timestamp === "string"
          ? Number(event.timestamp)
          : NaN;
      const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date(now);
      if (Number.isNaN(date.getTime())) continue;
      result.push({
        instagramUserId,
        senderId,
        messageId,
        content: text ?? "Mídia recebida pelo Instagram",
        sentAt: date,
      });
    }
  }
  return result;
}

async function providerJson(
  url: URL,
  init: RequestInit = {},
): Promise<JsonObject> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new InstagramProviderError("unknown");
  }
  let payload: JsonObject | null = null;
  try {
    payload = asObject(await response.json());
  } catch {
    // Treat malformed responses as a provider failure without exposing the body.
  }
  if (!response.ok || !payload || payload.error) {
    throw new InstagramProviderError(response.status >= 500 ? "unknown" : "rejected", response.status);
  }
  const wrappedData = payload.data;
  const data = Array.isArray(wrappedData)
    ? asObject(wrappedData[0])
    : asObject(wrappedData) ?? payload;
  if (!data) throw new InstagramProviderError("rejected", response.status);
  return data;
}

function graphUrl(config: InstagramMetaConfig, path: string): URL {
  return new URL(`https://graph.instagram.com/${config.graphVersion}/${path}`);
}

async function graphGet(
  config: InstagramMetaConfig,
  path: string,
  accessToken: string,
): Promise<JsonObject> {
  return providerJson(graphUrl(config, path), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function exchangeInstagramOAuthCode(
  code: string,
  config: InstagramMetaConfig,
): Promise<InstagramOAuthResult> {
  if (!config.appId || !config.appSecret || !config.redirectUri) {
    throw new InstagramProviderError("rejected");
  }
  const form = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });
  const shortLived = await providerJson(new URL("https://api.instagram.com/oauth/access_token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const shortToken = stringValue(shortLived.access_token);
  if (!shortToken) throw new InstagramProviderError("rejected");

  const exchangeUrl = graphUrl(config, "access_token");
  exchangeUrl.searchParams.set("grant_type", "ig_exchange_token");
  exchangeUrl.searchParams.set("client_secret", config.appSecret);
  exchangeUrl.searchParams.set("access_token", shortToken);
  const longLived = await providerJson(exchangeUrl);
  const accessToken = stringValue(longLived.access_token);
  const instagramUserId = stringValue(longLived.user_id) ?? stringValue(shortLived.user_id);
  if (!accessToken || !instagramUserId) throw new InstagramProviderError("rejected");

  const profile = await graphGet(config, `me?fields=user_id,username`, accessToken);
  const profileUserId = stringValue(profile.user_id) ?? stringValue(profile.id);
  if (profileUserId && profileUserId !== instagramUserId) {
    throw new InstagramProviderError("rejected");
  }
  const expiresIn = Number(longLived.expires_in);
  const tokenIssuedAt = new Date();
  return {
    instagramUserId,
    username: stringValue(profile.username),
    accessToken,
    tokenIssuedAt,
    tokenExpiresAt: new Date(tokenIssuedAt.getTime() + (Number.isFinite(expiresIn) ? expiresIn : 60 * 24 * 60 * 60) * 1000),
  };
}

export async function subscribeInstagramAccount(
  config: InstagramMetaConfig,
  accessToken: string,
): Promise<void> {
  const url = graphUrl(config, "me/subscribed_apps");
  url.searchParams.set("subscribed_fields", "messages");
  await providerJson(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function readInstagramAccessToken(
  integration: Pick<typeof tenantIntegrationsTable.$inferSelect, "secretsEncrypted">,
): string {
  if (!integration.secretsEncrypted) throw new InstagramProviderError("rejected");
  try {
    const value: unknown = JSON.parse(decryptCredential(integration.secretsEncrypted));
    const secrets = asObject(value);
    const token = stringValue(secrets?.accessToken);
    if (token) return token;
  } catch {
    // Do not surface decryption or credential contents to the caller.
  }
  throw new InstagramProviderError("rejected");
}

export async function disconnectInstagramAccountFromMeta(instagramUserId: string): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`instagram-account:${instagramUserId}`}, 0)
      )
    `);
    await tx.update(tenantIntegrationsTable)
      .set({
        config: {},
        secretsEncrypted: null,
        enabled: false,
        status: "disconnected",
        lastError: null,
        lastSyncAt: now,
      })
      .where(and(
        eq(tenantIntegrationsTable.type, INSTAGRAM_MESSAGING_TYPE),
        sql`${tenantIntegrationsTable.config}->>'instagramUserId' = ${instagramUserId}`,
      ));
  });
}

export async function deleteInstagramAccountData(
  instagramUserId: string,
  confirmationCode: string,
): Promise<Date> {
  const completedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`instagram-account:${instagramUserId}`}, 0)
      )
    `);

    const matchingConversationIds = tx.select({ id: chatbotConversationsTable.id })
      .from(chatbotConversationsTable)
      .where(and(
        eq(chatbotConversationsTable.channel, "instagram"),
        sql`${chatbotConversationsTable.metadata}->>'instagramUserId' = ${instagramUserId}`,
      ));
    await tx.delete(chatbotMessagesTable)
      .where(inArray(chatbotMessagesTable.conversationId, matchingConversationIds));
    await tx.delete(chatbotConversationsTable)
      .where(and(
        eq(chatbotConversationsTable.channel, "instagram"),
        sql`${chatbotConversationsTable.metadata}->>'instagramUserId' = ${instagramUserId}`,
      ));
    await tx.update(tenantIntegrationsTable)
      .set({
        config: {},
        secretsEncrypted: null,
        enabled: false,
        status: "disconnected",
        lastError: null,
        lastSyncAt: completedAt,
      })
      .where(and(
        eq(tenantIntegrationsTable.type, INSTAGRAM_MESSAGING_TYPE),
        sql`${tenantIntegrationsTable.config}->>'instagramUserId' = ${instagramUserId}`,
      ));
    await tx.insert(instagramDataDeletionRequestsTable).values({
      confirmationCode,
      completedAt,
    });
  });
  return completedAt;
}

export async function getInstagramDataDeletionStatus(confirmationCode: string): Promise<Date | null> {
  const [request] = await db.select({
    completedAt: instagramDataDeletionRequestsTable.completedAt,
  }).from(instagramDataDeletionRequestsTable)
    .where(eq(instagramDataDeletionRequestsTable.confirmationCode, confirmationCode))
    .limit(1);
  return request?.completedAt ?? null;
}

export async function sendInstagramText(
  config: InstagramMetaConfig,
  accessToken: string,
  instagramUserId: string,
  recipientId: string,
  text: string,
): Promise<void> {
  if (Buffer.byteLength(text, "utf8") > MAX_INSTAGRAM_TEXT_BYTES) {
    throw new InstagramProviderError("rejected", 413);
  }
  const url = graphUrl(config, `${encodeURIComponent(instagramUserId)}/messages`);
  await providerJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });
}

function parseInstagramConfig(value: unknown): Record<string, string> {
  const config = asObject(value);
  if (!config) return {};
  return Object.fromEntries(
    Object.entries(config).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export async function refreshInstagramTokens(): Promise<void> {
  const metaConfig = getInstagramMetaConfig();
  if (!metaConfig.appConfigured || !metaConfig.appSecret) return;
  const integrations = await db.select().from(tenantIntegrationsTable)
    .where(and(
      eq(tenantIntegrationsTable.type, INSTAGRAM_MESSAGING_TYPE),
      eq(tenantIntegrationsTable.enabled, true),
    ));
  const now = Date.now();

  for (const integration of integrations) {
    const config = parseInstagramConfig(integration.config);
    const expiresAt = Date.parse(config["tokenExpiresAt"] ?? "");
    const issuedAt = Date.parse(config["tokenIssuedAt"] ?? "");
    if (
      !Number.isFinite(expiresAt)
      || !Number.isFinite(issuedAt)
      || expiresAt - now > TOKEN_REFRESH_WINDOW_MS
      || now - issuedAt < TOKEN_MIN_AGE_MS
    ) {
      continue;
    }
    try {
      const accessToken = readInstagramAccessToken(integration);
      const refreshUrl = graphUrl(metaConfig, "refresh_access_token");
      refreshUrl.searchParams.set("grant_type", "ig_refresh_token");
      refreshUrl.searchParams.set("access_token", accessToken);
      const refreshed = await providerJson(refreshUrl);
      const nextToken = stringValue(refreshed.access_token);
      const expiresIn = Number(refreshed.expires_in);
      if (!nextToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new InstagramProviderError("rejected");
      }
      const tokenIssuedAt = new Date();
      await db.update(tenantIntegrationsTable)
        .set({
          secretsEncrypted: encryptCredential(JSON.stringify({ accessToken: nextToken })),
          config: {
            ...config,
            tokenIssuedAt: tokenIssuedAt.toISOString(),
            tokenExpiresAt: new Date(tokenIssuedAt.getTime() + expiresIn * 1000).toISOString(),
          },
          status: "connected",
          lastError: null,
          lastSyncAt: tokenIssuedAt,
        })
        .where(and(
          eq(tenantIntegrationsTable.id, integration.id),
          eq(tenantIntegrationsTable.tenantId, integration.tenantId),
        ));
    } catch (error) {
      const providerError = error instanceof InstagramProviderError ? error : null;
      await db.update(tenantIntegrationsTable)
        .set({
          status: "error",
          enabled: false,
          lastError: "Não foi possível renovar o acesso ao Instagram. Reconecte a conta.",
        })
        .where(and(
          eq(tenantIntegrationsTable.id, integration.id),
          eq(tenantIntegrationsTable.tenantId, integration.tenantId),
        ));
      logger.warn({
        tenantId: integration.tenantId,
        integrationId: integration.id,
        providerStatus: providerError?.httpStatus ?? null,
      }, "[instagram] Access-token refresh failed");
    }
  }
  await db.delete(instagramOAuthStatesTable)
    .where(lt(instagramOAuthStatesTable.expiresAt, new Date()));
}

export async function processInstagramWebhook(payload: unknown): Promise<number> {
  const incoming = parseInstagramWebhook(payload);
  if (incoming.length === 0) return 0;
  const integrations = await db.select().from(tenantIntegrationsTable)
    .where(and(
      eq(tenantIntegrationsTable.type, INSTAGRAM_MESSAGING_TYPE),
      eq(tenantIntegrationsTable.enabled, true),
      eq(tenantIntegrationsTable.status, "connected"),
    ));
  const integrationsByAccount = new Map<string, typeof integrations>();
  for (const integration of integrations) {
    const instagramUserId = parseInstagramConfig(integration.config)["instagramUserId"];
    if (instagramUserId) {
      integrationsByAccount.set(
        instagramUserId,
        [...(integrationsByAccount.get(instagramUserId) ?? []), integration],
      );
    }
  }

  let storedCount = 0;
  for (const message of incoming) {
    const matches = integrationsByAccount.get(message.instagramUserId) ?? [];
    if (matches.length !== 1) {
      logger.warn("[instagram] Ignored message for an unmapped or ambiguous account");
      continue;
    }
    const integration = matches[0]!;
    const stored = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`instagram-account:${message.instagramUserId}`}, 0)
        )
      `);
      const [activeIntegration] = await tx.select({ id: tenantIntegrationsTable.id })
        .from(tenantIntegrationsTable)
        .where(and(
          eq(tenantIntegrationsTable.id, integration.id),
          eq(tenantIntegrationsTable.tenantId, integration.tenantId),
          eq(tenantIntegrationsTable.type, INSTAGRAM_MESSAGING_TYPE),
          eq(tenantIntegrationsTable.enabled, true),
          eq(tenantIntegrationsTable.status, "connected"),
          sql`${tenantIntegrationsTable.config}->>'instagramUserId' = ${message.instagramUserId}`,
        ))
        .for("update")
        .limit(1);
      if (!activeIntegration) return 0;
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`instagram:${integration.id}:${message.senderId}`}, 0)
        )
      `);
      const [existingConversation] = await tx.select().from(chatbotConversationsTable)
        .where(and(
          eq(chatbotConversationsTable.tenantId, integration.tenantId),
          eq(chatbotConversationsTable.channel, "instagram"),
          eq(chatbotConversationsTable.sessionId, message.senderId),
          sql`${chatbotConversationsTable.metadata}->>'instagramIntegrationId' = ${integration.id}`,
        ))
        .orderBy(chatbotConversationsTable.createdAt)
        .limit(1);
      const metadata = {
        ...(asObject(existingConversation?.metadata) ?? {}),
        source: "instagram",
        instagramIntegrationId: integration.id,
        instagramUserId: message.instagramUserId,
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
      if (!conversation) throw new Error("Could not persist Instagram conversation");
      const [created] = await tx.insert(chatbotMessagesTable).values({
        id: generateId(),
        tenantId: integration.tenantId,
        conversationId: conversation.id,
        sourceMessageId: `instagram:${message.messageId}`,
        role: "user",
        content: message.content,
        sentAt: message.sentAt,
        isBot: false,
      }).onConflictDoNothing().returning({ id: chatbotMessagesTable.id });
      return created ? 1 : 0;
    });
    storedCount += stored;
  }
  return storedCount;
}

export const instagramOAuthStateTtlMs = OAUTH_STATE_TTL_MS;

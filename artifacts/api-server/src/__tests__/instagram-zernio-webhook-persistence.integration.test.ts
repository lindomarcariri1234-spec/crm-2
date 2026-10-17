import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ tenantId: "" }));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(async () => ({
    id: "zernio-media-staff",
    tenantId: authState.tenantId,
    role: "agency_admin",
  })),
  ALL_STAFF_ROLES: ["agency_admin"],
  ADMIN_ROLES: ["agency_admin"],
}));
vi.mock("../lib/uploadthing.js", () => ({
  extractVerifiedUploadThingKey: () => null,
  utapi: { generateSignedURL: vi.fn() },
}));
vi.mock("../services/whatsapp-attendance.js", () => ({
  deliverAttendanceReply: vi.fn(),
}));
vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: vi.fn(),
}));
vi.mock("../services/client-classification.js", () => ({
  recomputeClientClassification: vi.fn(),
  recordClientClassificationEvent: vi.fn(),
}));
vi.mock("../services/support-ticketing.js", () => ({
  ensureSupportTicketForConversation: vi.fn(),
  recordSupportTicketEvent: vi.fn(),
}));
vi.mock("../lib/realtime.js", () => ({
  broadcastSupportTicketUpdate: vi.fn(),
}));

import { and, eq, inArray } from "drizzle-orm";
import {
  chatbotConversationsTable,
  chatbotMessagesTable,
  db,
  pool,
  tenantIntegrationsTable,
  tenantsTable,
} from "@workspace/db";
import { errorHandler } from "../middlewares/errorHandler.js";
import chatbotRouter from "../routes/chatbot.js";
import instagramMessagingRouter from "../routes/instagram-messaging.js";
import { generateId } from "../lib/id.js";

const TEST_WEBHOOK_SECRET = "zernio-media-persistence-test-secret";
const RUN_ID = randomUUID().replaceAll("-", "");
const TENANT_ID = `zernio-media-tenant-${RUN_ID}`;
const OTHER_TENANT_ID = `zernio-media-other-tenant-${RUN_ID}`;
const TENANT_IDS = [TENANT_ID, OTHER_TENANT_ID];
const INTEGRATION_ID = `zernio-media-integration-${RUN_ID}`;
const ACCOUNT_ID = `zernio-media-account-${RUN_ID}`;
const PROFILE_ID = `zernio-media-profile-${RUN_ID}`;
const PROVIDER_CONVERSATION_ID = `zernio-provider-conversation-${RUN_ID}`;
const CUSTOMER_ID = `zernio-media-customer-${RUN_ID}`;
const MESSAGE_ID = `zernio-media-message-${RUN_ID}`;
const UNSAFE_MESSAGE_ID = `zernio-unsafe-media-message-${RUN_ID}`;
const PROVIDER_MEDIA_URL = `https://media.example.test/${RUN_ID}/photo.png`;
const TEST_DATABASE = "visitecrm_test";
const CI_DATABASE = "visitecrm_ci";
let isolatedDatabaseVerified = false;

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(
    hostname.replace(/^\[|\]$/g, "").toLowerCase(),
  );
}

async function assertIsolatedDatabase(): Promise<void> {
  const rawUrl = process.env["DATABASE_URL"];
  if (!rawUrl) throw new Error("DATABASE_URL must point to an isolated Zernio media test database");

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    throw new Error("Refusing to run Zernio media integration tests with an invalid database URL");
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
  const loopbackHost = isLoopback(databaseUrl.hostname);
  const localDatabase = databaseName === TEST_DATABASE && loopbackHost;
  const ciDatabase = process.env["CI"] === "true"
    && databaseName === CI_DATABASE
    && loopbackHost;
  if (!localDatabase && !ciDatabase) {
    throw new Error("Refusing to run Zernio media integration tests outside an isolated database");
  }

  const { rows } = await pool.query(
    "SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address",
  );
  const connected = rows[0] as { database_name?: string; server_address?: string | null } | undefined;
  const localConnectionMatches = localDatabase
    && connected?.database_name === TEST_DATABASE
    && isLoopback(connected.server_address ?? "");
  const ciConnectionMatches = ciDatabase && connected?.database_name === CI_DATABASE;
  if (!localConnectionMatches && !ciConnectionMatches) {
    throw new Error("Refusing to run Zernio media tests against a non-isolated database connection");
  }
}

function buildApp() {
  const app = express();
  app.use((req: express.Request & { log?: pino.Logger }, _res, next) => {
    req.log = pino({ level: "silent" });
    next();
  });
  app.use(express.json({
    verify: (req, _res, buffer) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buffer;
    },
  }));
  app.use(instagramMessagingRouter);
  app.use("/api", chatbotRouter);
  app.use(errorHandler);
  return app;
}

function incomingEvent(messageId: string, mediaUrl: string) {
  return {
    id: `event-${messageId}`,
    event: "message.received",
    timestamp: "2026-10-16T15:30:00.000Z",
    account: { accountId: ACCOUNT_ID, profileId: PROFILE_ID, platform: "instagram" },
    message: {
      id: messageId,
      conversationId: PROVIDER_CONVERSATION_ID,
      platform: "instagram",
      direction: "incoming",
      attachments: [{
        type: "image",
        url: mediaUrl,
        mimeType: "image/png",
        fileName: "customer-photo.png",
      }],
      sender: { id: CUSTOMER_ID },
    },
  };
}

async function postWebhook(app: express.Express, event: ReturnType<typeof incomingEvent>) {
  const rawBody = JSON.stringify(event);
  const signature = createHmac("sha256", TEST_WEBHOOK_SECRET).update(rawBody).digest("hex");
  return request(app)
    .post("/webhooks/zernio")
    .set("X-Zernio-Signature", signature)
    .set("X-Zernio-Event-Id", event.id)
    .set("Content-Type", "application/json")
    .send(rawBody);
}

beforeAll(async () => {
  await assertIsolatedDatabase();
  isolatedDatabaseVerified = true;
  authState.tenantId = TENANT_ID;
  vi.stubEnv("ZERNIO_WEBHOOK_SECRET", TEST_WEBHOOK_SECRET);

  await db.insert(tenantsTable).values([
    {
      id: TENANT_ID,
      name: "Zernio media integration tenant",
      slug: `zernio-media-${RUN_ID}`,
      email: `zernio-media-${RUN_ID}@example.test`,
    },
    {
      id: OTHER_TENANT_ID,
      name: "Zernio media other tenant",
      slug: `zernio-media-other-${RUN_ID}`,
      email: `zernio-media-other-${RUN_ID}@example.test`,
    },
  ]);
  await db.insert(tenantIntegrationsTable).values({
    id: INTEGRATION_ID,
    tenantId: TENANT_ID,
    type: "instagram_zernio",
    config: { accountId: ACCOUNT_ID, profileId: PROFILE_ID },
    enabled: true,
    status: "connected",
  });
});

afterAll(async () => {
  if (!isolatedDatabaseVerified) return;
  await db.delete(chatbotMessagesTable).where(inArray(chatbotMessagesTable.tenantId, TENANT_IDS));
  await db.delete(chatbotConversationsTable).where(inArray(chatbotConversationsTable.tenantId, TENANT_IDS));
  await db.delete(tenantIntegrationsTable).where(inArray(tenantIntegrationsTable.tenantId, TENANT_IDS));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, TENANT_IDS));
  vi.unstubAllEnvs();
});

describe("Zernio Instagram webhook media persistence", () => {
  it("persists safe attachment metadata and returns it from the tenant-scoped history read", async () => {
    const app = buildApp();
    const response = await postWebhook(app, incomingEvent(MESSAGE_ID, PROVIDER_MEDIA_URL));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, stored: 1 });

    const [conversation] = await db.select({
      id: chatbotConversationsTable.id,
      tenantId: chatbotConversationsTable.tenantId,
      metadata: chatbotConversationsTable.metadata,
    }).from(chatbotConversationsTable).where(and(
      eq(chatbotConversationsTable.tenantId, TENANT_ID),
      eq(chatbotConversationsTable.sessionId, CUSTOMER_ID),
    ));
    expect(conversation).toMatchObject({
      tenantId: TENANT_ID,
      metadata: expect.objectContaining({
        instagramIntegrationId: INTEGRATION_ID,
        zernioAccountId: ACCOUNT_ID,
        zernioProfileId: PROFILE_ID,
        zernioConversationId: PROVIDER_CONVERSATION_ID,
      }),
    });

    const [storedMessage] = await db.select({
      tenantId: chatbotMessagesTable.tenantId,
      conversationId: chatbotMessagesTable.conversationId,
      sourceMessageId: chatbotMessagesTable.sourceMessageId,
      mediaUrl: chatbotMessagesTable.mediaUrl,
      mediaMimeType: chatbotMessagesTable.mediaMimeType,
      mediaFileName: chatbotMessagesTable.mediaFileName,
    }).from(chatbotMessagesTable).where(and(
      eq(chatbotMessagesTable.tenantId, TENANT_ID),
      eq(chatbotMessagesTable.sourceMessageId, `zernio:${MESSAGE_ID}`),
    ));
    expect(storedMessage).toEqual({
      tenantId: TENANT_ID,
      conversationId: conversation!.id,
      sourceMessageId: `zernio:${MESSAGE_ID}`,
      mediaUrl: PROVIDER_MEDIA_URL,
      mediaMimeType: "image/png",
      mediaFileName: "customer-photo.png",
    });

    const historyResponse = await request(app)
      .get(`/api/chatbot-conversations/${conversation!.id}/messages`);
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body).toEqual([
      expect.objectContaining({
        tenantId: TENANT_ID,
        conversationId: conversation!.id,
        sourceMessageId: `zernio:${MESSAGE_ID}`,
        mediaUrl: PROVIDER_MEDIA_URL,
        mediaMimeType: "image/png",
        mediaFileName: "customer-photo.png",
      }),
    ]);

    authState.tenantId = OTHER_TENANT_ID;
    const crossTenantResponse = await request(app)
      .get(`/api/chatbot-conversations/${conversation!.id}/messages`);
    expect(crossTenantResponse.status).toBe(404);
  });

  it("does not persist unsafe provider media URLs", async () => {
    const response = await postWebhook(
      buildApp(),
      incomingEvent(UNSAFE_MESSAGE_ID, "javascript:alert(1)"),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, stored: 0 });
    const unsafeRows = await db.select({ id: chatbotMessagesTable.id })
      .from(chatbotMessagesTable)
      .where(eq(chatbotMessagesTable.sourceMessageId, `zernio:${UNSAFE_MESSAGE_ID}`));
    expect(unsafeRows).toHaveLength(0);
  });
});

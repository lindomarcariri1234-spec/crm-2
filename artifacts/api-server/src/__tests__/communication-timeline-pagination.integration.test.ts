import { randomUUID } from "node:crypto";
import express from "express";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mockAuthState = vi.hoisted(() => ({ tenantId: "" }));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(async () => ({
    id: "timeline-pagination-staff",
    tenantId: mockAuthState.tenantId,
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
vi.mock("../services/instagram-messaging.js", () => ({
  getInstagramMetaConfig: vi.fn(),
  isInstagramReplyWindowOpen: vi.fn(),
  INSTAGRAM_MESSAGING_TYPE: "instagram_messaging",
}));
vi.mock("../services/instagram-zernio.js", () => ({
  INSTAGRAM_ZERNIO_TYPE: "instagram_zernio",
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

import {
  chatbotConversationsTable,
  chatbotMessagesTable,
  clientsTable,
  db,
  messagesTable,
  pool,
  tenantsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { errorHandler } from "../middlewares/errorHandler.js";
import chatbotRouter from "../routes/chatbot.js";

const RUN_ID = randomUUID().replaceAll("-", "");
const TENANT_ID = `timeline-page-${RUN_ID}`;
const TENANT_SLUG = `timeline-page-${RUN_ID}`;
const CLIENT_ID = `timeline-client-${RUN_ID}`;
const CONVERSATION_ID = `timeline-conversation-${RUN_ID}`;
const LOCAL_TEST_DATABASE = "visitecrm_test";
const CI_TEST_DATABASE = "visitecrm_ci";
const SHARED_TIMESTAMP = new Date("2026-10-16T15:30:00.000Z");
const legacyIds = ["legacy-a", "legacy-b", "legacy-c"].map((id) => `${RUN_ID}-${id}`);
const chatbotIds = ["chat-a", "chat-b", "chat-c"].map((id) => `${RUN_ID}-${id}`);
let isolatedDatabaseVerified = false;

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(
    hostname.replace(/^\[|\]$/g, "").toLowerCase(),
  );
}

async function assertIsolatedDatabase(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must point to an isolated timeline pagination test database");
  }

  let configuredUrl: URL;
  try {
    configuredUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Refusing to run timeline pagination integration test with an invalid database URL");
  }

  const databaseName = decodeURIComponent(configuredUrl.pathname.replace(/^\/+/, ""));
  const host = configuredUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isDedicatedLocalDatabase = databaseName === LOCAL_TEST_DATABASE && isLoopback(host);
  const isDedicatedCiDatabase = process.env["CI"] === "true"
    && databaseName === CI_TEST_DATABASE
    && isLoopback(host);
  if (!isDedicatedLocalDatabase && !isDedicatedCiDatabase) {
    throw new Error("Refusing to run timeline pagination integration test outside an isolated database");
  }

  const { rows } = await pool.query<{
    database_name: string;
    server_address: string | null;
  }>(`
    SELECT current_database() AS database_name,
           host(inet_server_addr()) AS server_address
  `);
  const connected = rows[0];
  const localDatabaseMatches = isDedicatedLocalDatabase
    && connected?.database_name === LOCAL_TEST_DATABASE
    && isLoopback(connected.server_address ?? "");
  const ciDatabaseMatches = isDedicatedCiDatabase && connected?.database_name === CI_TEST_DATABASE;
  if (!localDatabaseMatches && !ciDatabaseMatches) {
    throw new Error("Refusing to run timeline pagination integration test outside an isolated database");
  }
}

function buildApp() {
  const app = express();
  app.use((req: express.Request & { log?: pino.Logger }, _res, next) => {
    req.log = pino({ level: "silent" });
    next();
  });
  app.use("/api", chatbotRouter);
  app.use(errorHandler);
  return app;
}

beforeAll(async () => {
  await assertIsolatedDatabase();
  isolatedDatabaseVerified = true;
  mockAuthState.tenantId = TENANT_ID;

  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Timeline pagination integration test",
    slug: TENANT_SLUG,
    email: `${TENANT_SLUG}@example.test`,
  });
  await db.insert(clientsTable).values({
    id: CLIENT_ID,
    tenantId: TENANT_ID,
    name: "Timeline test client",
    email: `${CLIENT_ID}@example.test`,
    whatsapp: "5511999900000",
  });
  await db.insert(chatbotConversationsTable).values({
    id: CONVERSATION_ID,
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    channel: "whatsapp",
  });
  await db.insert(messagesTable).values(
    legacyIds.map((id) => ({
      id,
      tenantId: TENANT_ID,
      toClientId: CLIENT_ID,
      channel: "email",
      content: `Legacy ${id}`,
      sentAt: SHARED_TIMESTAMP,
    })),
  );
  await db.insert(chatbotMessagesTable).values(
    chatbotIds.map((id) => ({
      id,
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      role: "user",
      content: `WhatsApp ${id}`,
      sentAt: SHARED_TIMESTAMP,
    })),
  );
});

afterAll(async () => {
  if (!isolatedDatabaseVerified) return;
  await db.delete(messagesTable).where(eq(messagesTable.tenantId, TENANT_ID));
  await db.delete(chatbotMessagesTable).where(eq(chatbotMessagesTable.tenantId, TENANT_ID));
  await db.delete(chatbotConversationsTable).where(eq(chatbotConversationsTable.tenantId, TENANT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

describe("client communication timeline pagination", () => {
  it("keeps equal-timestamp entries ordered and complete across cursor boundaries", async () => {
    const pages: string[][] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      let pageRequest = request(buildApp())
        .get(`/api/clients/${CLIENT_ID}/communication-timeline`)
        .query({ limit: "2" });
      if (cursor) pageRequest = pageRequest.query({ cursor });
      const response = await pageRequest;

      expect(response.status).toBe(200);
      pages.push(response.body.items.map((item: { id: string }) => item.id));
      expect(response.body.items.every((item: { sentAt: string }) =>
        new Date(item.sentAt).getTime() === SHARED_TIMESTAMP.getTime(),
      )).toBe(true);
      cursor = response.body.nextCursor;
      hasMore = response.body.hasMore;
      expect(hasMore).toBe(!cursor ? false : true);
    }

    expect(pages).toEqual([
      [`message:${legacyIds[1]}`, `message:${legacyIds[2]}`],
      [`chatbot:${chatbotIds[2]}`, `message:${legacyIds[0]}`],
      [`chatbot:${chatbotIds[0]}`, `chatbot:${chatbotIds[1]}`],
    ]);

    const chronologicalEntries = [...pages].reverse().flat();
    expect(chronologicalEntries).toEqual([
      ...chatbotIds.map((id) => `chatbot:${id}`),
      ...legacyIds.map((id) => `message:${id}`),
    ]);
    expect(new Set(chronologicalEntries).size).toBe(legacyIds.length + chatbotIds.length);
  });
});

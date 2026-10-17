import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  chatbotConversationsTable,
  chatbotMessagesTable,
  db,
  pool,
  tenantIntegrationsTable,
  tenantsTable,
} from "@workspace/db";
import instagramMessagingRouter from "../routes/instagram-messaging.js";

const TEST_APP_SECRET = "instagram-account-scope-integration-secret";
const RUN_ID = randomUUID().replaceAll("-", "");
const TENANT_A_ID = `instagram-scope-a-${RUN_ID}`;
const TENANT_B_ID = `instagram-scope-b-${RUN_ID}`;
const TENANT_IDS = [TENANT_A_ID, TENANT_B_ID];
const INTEGRATION_A_ID = `instagram-integration-a-${RUN_ID}`;
const INTEGRATION_B_ID = `instagram-integration-b-${RUN_ID}`;
const ACCOUNT_A_ID = `instagram-account-a-${RUN_ID}`;
const ACCOUNT_B_ID = `instagram-account-b-${RUN_ID}`;
const UNKNOWN_ACCOUNT_ID = `instagram-account-unknown-${RUN_ID}`;
const CUSTOMER_ID = `instagram-customer-${RUN_ID}`;
const MESSAGE_A_ID = `instagram-message-a-${RUN_ID}`;
const MESSAGE_B_ID = `instagram-message-b-${RUN_ID}`;
const UNKNOWN_MESSAGE_ID = `instagram-message-unknown-${RUN_ID}`;
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
  if (!rawUrl) throw new Error("DATABASE_URL must point to an isolated Instagram account-scope database");

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    throw new Error("Refusing to run Instagram account-scope integration tests with an invalid database URL");
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
  const loopbackHost = isLoopback(databaseUrl.hostname);
  const localDatabase = databaseName === TEST_DATABASE && loopbackHost;
  const ciDatabase = process.env["CI"] === "true"
    && databaseName === CI_DATABASE
    && loopbackHost;
  if (!localDatabase && !ciDatabase) {
    throw new Error("Refusing to run Instagram account-scope integration tests outside an isolated database");
  }

  // CI uses a loopback URL through its service network; the server address
  // may be the service container's bridge IP rather than loopback.
  const { rows } = await pool.query(
    "SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address",
  );
  const connected = rows[0] as { database_name?: string; server_address?: string | null } | undefined;
  const localConnectionMatches = localDatabase
    && connected?.database_name === TEST_DATABASE
    && isLoopback(connected.server_address ?? "");
  const ciConnectionMatches = ciDatabase && connected?.database_name === CI_DATABASE;
  if (!localConnectionMatches && !ciConnectionMatches) {
    throw new Error("Refusing to run Instagram account-scope tests against a non-isolated database connection");
  }
}

function buildApp() {
  const app = express();
  app.use(express.json({
    verify: (req, _res, buffer) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buffer;
    },
  }));
  app.use(instagramMessagingRouter);
  return app;
}

function webhookPayload() {
  const makeEntry = (accountId: string, messageId: string, text: string) => ({
    id: accountId,
    messaging: [{
      sender: { id: CUSTOMER_ID },
      timestamp: 1_797_000_000_000,
      message: { mid: messageId, text },
    }],
  });
  return {
    object: "instagram",
    entry: [
      makeEntry(ACCOUNT_A_ID, MESSAGE_A_ID, "Mensagem da conta A"),
      makeEntry(ACCOUNT_B_ID, MESSAGE_B_ID, "Mensagem da conta B"),
      makeEntry(UNKNOWN_ACCOUNT_ID, UNKNOWN_MESSAGE_ID, "Conta sem vínculo"),
    ],
  };
}

async function postWebhook(app: express.Express, payload: ReturnType<typeof webhookPayload>) {
  const rawBody = JSON.stringify(payload);
  const signature = createHmac("sha256", TEST_APP_SECRET).update(rawBody).digest("hex");
  return request(app)
    .post("/webhooks/instagram")
    .set("X-Hub-Signature-256", `sha256=${signature}`)
    .set("Content-Type", "application/json")
    .send(rawBody);
}

beforeAll(async () => {
  await assertIsolatedDatabase();
  isolatedDatabaseVerified = true;
  vi.stubEnv("INSTAGRAM_APP_SECRET", TEST_APP_SECRET);

  await db.insert(tenantsTable).values([
    {
      id: TENANT_A_ID,
      name: "Instagram scope integration tenant A",
      slug: `instagram-scope-a-${RUN_ID}`,
      email: `instagram-scope-a-${RUN_ID}@example.test`,
    },
    {
      id: TENANT_B_ID,
      name: "Instagram scope integration tenant B",
      slug: `instagram-scope-b-${RUN_ID}`,
      email: `instagram-scope-b-${RUN_ID}@example.test`,
    },
  ]);
  await db.insert(tenantIntegrationsTable).values([
    {
      id: INTEGRATION_A_ID,
      tenantId: TENANT_A_ID,
      type: "instagram_messaging",
      config: { instagramUserId: ACCOUNT_A_ID },
      enabled: true,
      status: "connected",
    },
    {
      id: INTEGRATION_B_ID,
      tenantId: TENANT_B_ID,
      type: "instagram_messaging",
      config: { instagramUserId: ACCOUNT_B_ID },
      enabled: true,
      status: "connected",
    },
  ]);
});

afterAll(async () => {
  if (!isolatedDatabaseVerified) return;
  await db.delete(chatbotMessagesTable).where(inArray(chatbotMessagesTable.tenantId, TENANT_IDS));
  await db.delete(chatbotConversationsTable).where(inArray(chatbotConversationsTable.tenantId, TENANT_IDS));
  await db.delete(tenantIntegrationsTable).where(inArray(tenantIntegrationsTable.tenantId, TENANT_IDS));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, TENANT_IDS));
  vi.unstubAllEnvs();
});

describe("Meta Instagram webhook account scoping", () => {
  it("stores messages only for uniquely mapped connected accounts", async () => {
    const response = await postWebhook(buildApp(), webhookPayload());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, stored: 2 });

    const storedMessages = await db.select({
      tenantId: chatbotMessagesTable.tenantId,
      conversationId: chatbotMessagesTable.conversationId,
      sourceMessageId: chatbotMessagesTable.sourceMessageId,
      content: chatbotMessagesTable.content,
    }).from(chatbotMessagesTable).where(inArray(
      chatbotMessagesTable.sourceMessageId,
      [MESSAGE_A_ID, MESSAGE_B_ID, UNKNOWN_MESSAGE_ID].map((id) => `instagram:${id}`),
    ));

    expect(storedMessages).toHaveLength(2);
    expect(storedMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: TENANT_A_ID,
        sourceMessageId: `instagram:${MESSAGE_A_ID}`,
        content: "Mensagem da conta A",
      }),
      expect.objectContaining({
        tenantId: TENANT_B_ID,
        sourceMessageId: `instagram:${MESSAGE_B_ID}`,
        content: "Mensagem da conta B",
      }),
    ]));

    const conversations = await db.select({
      tenantId: chatbotConversationsTable.tenantId,
      id: chatbotConversationsTable.id,
      sessionId: chatbotConversationsTable.sessionId,
      metadata: chatbotConversationsTable.metadata,
    }).from(chatbotConversationsTable).where(and(
      inArray(chatbotConversationsTable.tenantId, TENANT_IDS),
      eq(chatbotConversationsTable.sessionId, CUSTOMER_ID),
    ));

    expect(conversations).toHaveLength(2);
    expect(conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: TENANT_A_ID,
        metadata: expect.objectContaining({
          instagramIntegrationId: INTEGRATION_A_ID,
          instagramUserId: ACCOUNT_A_ID,
        }),
      }),
      expect.objectContaining({
        tenantId: TENANT_B_ID,
        metadata: expect.objectContaining({
          instagramIntegrationId: INTEGRATION_B_ID,
          instagramUserId: ACCOUNT_B_ID,
        }),
      }),
    ]));
    expect(new Set(storedMessages.map((message) => message.conversationId)).size).toBe(2);
  });
});

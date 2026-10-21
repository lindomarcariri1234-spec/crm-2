import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const {
  mockBroadcastSupportTicketUpdate,
  mockRecomputeClientClassification,
  mockRecordClientClassificationEvent,
  mockEnsureSupportTicket,
  mockStoreEvolutionInboundMedia,
} = vi.hoisted(() => ({
  mockBroadcastSupportTicketUpdate: vi.fn(async () => undefined),
  mockRecomputeClientClassification: vi.fn(async () => undefined),
  mockRecordClientClassificationEvent: vi.fn(async () => undefined),
  mockEnsureSupportTicket: vi.fn(async () => ({ id: "test-support-ticket" })),
  mockStoreEvolutionInboundMedia: vi.fn(),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSupportTicketUpdate: mockBroadcastSupportTicketUpdate,
}));
vi.mock("../services/client-classification.js", () => ({
  recomputeClientClassification: mockRecomputeClientClassification,
  recordClientClassificationEvent: mockRecordClientClassificationEvent,
}));
vi.mock("../services/support-ticketing.js", () => ({
  ensureSupportTicketForConversation: mockEnsureSupportTicket,
}));
vi.mock("../services/whatsapp-media.js", () => ({
  unwrapEvolutionMessage: (message: unknown) => message,
  extractEvolutionInboundMedia: () => ({
    kind: "image",
    mimeType: "image/jpeg",
    fileName: "received-image.jpg",
    caption: null,
    messageId: "evolution-replay-media",
    remoteJid: "5511999912345@s.whatsapp.net",
  }),
  storeEvolutionInboundMedia: mockStoreEvolutionInboundMedia,
}));

import {
  chatbotConversationsTable,
  chatbotMessagesTable,
  clientsTable,
  db,
  pool,
  tenantIntegrationsTable,
  tenantsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { processEvolutionInbound } from "../services/whatsapp-attendance.js";

const RUN_ID = randomUUID().replaceAll("-", "");
const TENANT_ID = `wa-idempotency-${RUN_ID}`;
const TENANT_SLUG = `wa-idempotency-${RUN_ID}`;
const INTEGRATION_ID = `wa-integration-${RUN_ID}`;
const CLIENT_ID = `wa-client-${RUN_ID}`;
const PHONE = "5511999912345";
const INSTANCE_NAME = `wa-instance-${RUN_ID}`;
const API_KEY = "whatsapp-integration-test-key";
const PROVIDER_MESSAGE_ID = `evolution-replay-${RUN_ID}`;
const LOCAL_TEST_DATABASE = "visitecrm_test";
const CI_TEST_DATABASE = "visitecrm_ci";
let isolatedDatabaseVerified = false;

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(
    hostname.replace(/^\[|\]$/g, "").toLowerCase(),
  );
}

async function assertIsolatedDatabase(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must point to an isolated WhatsApp idempotency test database");
  }

  let configuredUrl: URL;
  try {
    configuredUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Refusing to run WhatsApp idempotency integration test with an invalid database URL");
  }

  const databaseName = decodeURIComponent(configuredUrl.pathname.replace(/^\/+/, ""));
  const host = configuredUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isDedicatedLocalDatabase = databaseName === LOCAL_TEST_DATABASE && isLoopback(host);
  const isDedicatedCiDatabase = process.env["CI"] === "true"
    && databaseName === CI_TEST_DATABASE
    && isLoopback(host);
  if (!isDedicatedLocalDatabase && !isDedicatedCiDatabase) {
    throw new Error("Refusing to run WhatsApp idempotency integration test outside an isolated database");
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
    throw new Error("Refusing to run WhatsApp idempotency integration test outside an isolated database");
  }
}

beforeAll(async () => {
  await assertIsolatedDatabase();
  isolatedDatabaseVerified = true;

  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "WhatsApp webhook idempotency test",
    slug: TENANT_SLUG,
    email: `${TENANT_SLUG}@example.test`,
  });
  await db.insert(tenantIntegrationsTable).values({
    id: INTEGRATION_ID,
    tenantId: TENANT_ID,
    type: "whatsapp_evolution",
    config: { instanceName: INSTANCE_NAME, baseUrl: "https://evolution.example.test" },
    secretsEncrypted: JSON.stringify({ apiKey: API_KEY }),
    enabled: true,
    status: "connected",
  });
  await db.insert(clientsTable).values({
    id: CLIENT_ID,
    tenantId: TENANT_ID,
    name: "WhatsApp replay test client",
    email: `${CLIENT_ID}@example.test`,
    whatsapp: PHONE,
    phone: PHONE,
  });
});

afterAll(async () => {
  if (!isolatedDatabaseVerified) return;
  await db.delete(chatbotMessagesTable).where(eq(chatbotMessagesTable.tenantId, TENANT_ID));
  await db.delete(chatbotConversationsTable).where(eq(chatbotConversationsTable.tenantId, TENANT_ID));
  await db.delete(tenantIntegrationsTable).where(eq(tenantIntegrationsTable.tenantId, TENANT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

describe("Evolution inbound webhook database idempotency", () => {
  it("keeps one message and retries media storage without repeating classification or ticket effects", async () => {
    mockBroadcastSupportTicketUpdate.mockClear();
    mockRecomputeClientClassification.mockClear();
    mockRecordClientClassificationEvent.mockClear();
    mockEnsureSupportTicket.mockClear();
    mockStoreEvolutionInboundMedia
      .mockReset()
      .mockResolvedValueOnce({ ok: false, reason: "request_failed" })
      .mockResolvedValueOnce({
        ok: true,
        media: {
          mediaUrl: "https://utfs.io/f/wa-idempotency-private-media",
          mimeType: "image/jpeg",
          fileName: "received-image.jpg",
        },
      });

    const opts = {
      instanceName: INSTANCE_NAME,
      apiKey: API_KEY,
      payload: {
        data: {
          messageTimestamp: 1_700_000_000,
          key: {
            remoteJid: `${PHONE}@s.whatsapp.net`,
            id: PROVIDER_MESSAGE_ID,
            fromMe: false,
          },
          message: { imageMessage: { mimetype: "image/jpeg" } },
        },
      },
    };

    await expect(processEvolutionInbound(opts)).resolves.toBe("human_handoff");
    const [firstStoredMessage] = await db.select()
      .from(chatbotMessagesTable)
      .where(and(
        eq(chatbotMessagesTable.tenantId, TENANT_ID),
        eq(chatbotMessagesTable.sourceMessageId, PROVIDER_MESSAGE_ID),
      ));
    expect(firstStoredMessage).toMatchObject({
      tenantId: TENANT_ID,
      content: "Imagem recebida",
      mediaUrl: null,
    });

    await expect(processEvolutionInbound(opts)).resolves.toBe("human_handoff");

    const storedMessages = await db.select()
      .from(chatbotMessagesTable)
      .where(and(
        eq(chatbotMessagesTable.tenantId, TENANT_ID),
        eq(chatbotMessagesTable.sourceMessageId, PROVIDER_MESSAGE_ID),
      ));
    expect(storedMessages).toHaveLength(1);
    expect(storedMessages[0]).toMatchObject({
      tenantId: TENANT_ID,
      sourceMessageId: PROVIDER_MESSAGE_ID,
      mediaUrl: "https://utfs.io/f/wa-idempotency-private-media",
      mediaMimeType: "image/jpeg",
      mediaFileName: "received-image.jpg",
    });
    expect(mockStoreEvolutionInboundMedia).toHaveBeenCalledTimes(2);
    expect(mockEnsureSupportTicket).toHaveBeenCalledTimes(1);
    expect(mockBroadcastSupportTicketUpdate).toHaveBeenCalledTimes(1);
    expect(mockRecordClientClassificationEvent).toHaveBeenCalledTimes(1);
    expect(mockRecomputeClientClassification).toHaveBeenCalledTimes(1);
  });
});

import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  chatbotConversationsTable,
  chatbotMessagesTable,
  db,
  tenantIntegrationsTable,
  tenantsTable,
} from "@workspace/db";
import { generateId } from "../lib/id";
import { importZernioInstagramHistory } from "../services/instagram-zernio";
import instagramMessagingRouter from "../routes/instagram-messaging";

const TEST_WEBHOOK_SECRET = "instagram-zernio-dedup-test-secret";
const TENANT_A_ID = `zernio-dedup-a-${generateId()}`;
const TENANT_B_ID = `zernio-dedup-b-${generateId()}`;
const INTEGRATION_A_ID = `zernio-integration-a-${generateId()}`;
const INTEGRATION_B_ID = `zernio-integration-b-${generateId()}`;
const ACCOUNT_A_ID = `zernio-account-a-${generateId()}`;
const ACCOUNT_B_ID = `zernio-account-b-${generateId()}`;
const PROFILE_A_ID = `zernio-profile-a-${generateId()}`;
const PROFILE_B_ID = `zernio-profile-b-${generateId()}`;
const CONVERSATION_ID = `zernio-conversation-${generateId()}`;
const INBOUND_MESSAGE_ID = `zernio-inbound-${generateId()}`;
const MEDIA_MESSAGE_ID = `zernio-media-${generateId()}`;
const MALFORMED_MESSAGE_IDS = [
  `zernio-empty-attachments-${generateId()}`,
  `zernio-unusable-attachments-${generateId()}`,
  `zernio-missing-attachments-${generateId()}`,
];
const OUTBOUND_MESSAGE_ID = `zernio-outbound-${generateId()}`;
const TENANT_IDS = [TENANT_A_ID, TENANT_B_ID];
let safeDatabaseVerified = false;

function assertIsolatedDatabase(): void {
  const rawUrl = process.env["DATABASE_URL"];
  if (!rawUrl) throw new Error("DATABASE_URL is required for the Zernio dedup integration test");
  const url = new URL(rawUrl);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  const database = url.pathname.replace(/^\/+/, "");
  const isolatedCiDatabase = process.env["CI"] === "true" && database === "visitecrm_ci";
  const isolatedLocalDatabase = database === "visitecrm_test";
  if (!loopback || (!isolatedCiDatabase && !isolatedLocalDatabase)) {
    throw new Error("Zernio dedup integration tests require the isolated visitecrm_test or CI visitecrm_ci database on loopback");
  }
}

function webhookRequest(event: Record<string, unknown>) {
  const raw = JSON.stringify(event);
  const signature = createHmac("sha256", TEST_WEBHOOK_SECRET).update(raw).digest("hex");
  const app = express();
  app.use(express.json({
    verify: (req, _res, buffer) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buffer;
    },
  }));
  app.use(instagramMessagingRouter);
  return request(app)
    .post("/webhooks/zernio")
    .set("X-Zernio-Signature", signature)
    .set("X-Zernio-Event-Id", String(event.id))
    .send(event);
}

function incomingEvent(accountId: string, profileId: string, eventId: string) {
  return {
    id: eventId,
    event: "message.received",
    timestamp: "2026-10-10T12:00:00.000Z",
    account: { accountId, profileId, platform: "instagram" },
    message: {
      id: INBOUND_MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      platform: "instagram",
      direction: "incoming",
      text: "Mensagem recebida",
      sender: { id: `${accountId}-customer` },
    },
  };
}

function incomingMediaEvent(accountId: string, profileId: string, eventId: string) {
  return {
    id: eventId,
    event: "message.received",
    timestamp: "2026-10-10T12:03:00.000Z",
    account: { accountId, profileId, platform: "instagram" },
    message: {
      id: MEDIA_MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      platform: "instagram",
      direction: "incoming",
      attachments: [{ type: "image", url: "https://media.example.test/image.jpg" }],
      sender: { id: `${accountId}-customer` },
    },
  };
}

function incomingMalformedMediaEvent(accountId: string, profileId: string, eventId: string) {
  return {
    id: eventId,
    event: "message.received",
    timestamp: "2026-10-10T12:04:00.000Z",
    account: { accountId, profileId, platform: "instagram" },
    message: {
      id: MALFORMED_MESSAGE_IDS[0],
      conversationId: CONVERSATION_ID,
      platform: "instagram",
      direction: "incoming",
      attachments: [],
      sender: { id: `${accountId}-customer` },
    },
  };
}

function outgoingEvent(accountId: string, profileId: string, eventId: string) {
  return {
    id: eventId,
    event: "message.sent",
    timestamp: "2026-10-10T12:05:00.000Z",
    account: { accountId, profileId, platform: "instagram" },
    message: {
      id: OUTBOUND_MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      platform: "instagram",
      direction: "outgoing",
      text: "Resposta enviada",
    },
  };
}

function statusEvent(
  accountId: string,
  profileId: string,
  eventId: string,
  eventType: "message.delivered" | "message.read",
  statusAt: string,
) {
  return {
    id: eventId,
    event: eventType,
    statusAt,
    account: { accountId, profileId, platform: "instagram" },
    message: {
      id: OUTBOUND_MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      platform: "instagram",
      direction: "outgoing",
    },
  };
}

beforeAll(async () => {
  assertIsolatedDatabase();
  safeDatabaseVerified = true;
  vi.stubEnv("ZERNIO_WEBHOOK_SECRET", TEST_WEBHOOK_SECRET);

  await db.insert(tenantsTable).values([
    {
      id: TENANT_A_ID,
      name: "Zernio dedup agency A",
      slug: `zernio-dedup-a-${generateId()}`,
      email: `zernio-dedup-a-${generateId()}@example.com`,
    },
    {
      id: TENANT_B_ID,
      name: "Zernio dedup agency B",
      slug: `zernio-dedup-b-${generateId()}`,
      email: `zernio-dedup-b-${generateId()}@example.com`,
    },
  ]);
  await db.insert(tenantIntegrationsTable).values([
    {
      id: INTEGRATION_A_ID,
      tenantId: TENANT_A_ID,
      type: "instagram_zernio",
      config: { accountId: ACCOUNT_A_ID, profileId: PROFILE_A_ID },
      enabled: true,
      status: "connected",
    },
    {
      id: INTEGRATION_B_ID,
      tenantId: TENANT_B_ID,
      type: "instagram_zernio",
      config: { accountId: ACCOUNT_B_ID, profileId: PROFILE_B_ID },
      enabled: true,
      status: "connected",
    },
  ]);
});

afterAll(async () => {
  if (!safeDatabaseVerified) return;
  await db.delete(chatbotMessagesTable).where(inArray(chatbotMessagesTable.tenantId, TENANT_IDS));
  await db.delete(chatbotConversationsTable).where(inArray(chatbotConversationsTable.tenantId, TENANT_IDS));
  await db.delete(tenantIntegrationsTable).where(inArray(tenantIntegrationsTable.tenantId, TENANT_IDS));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, TENANT_IDS));
  vi.unstubAllEnvs();
});

describe("Zernio history import and webhook idempotency", () => {
  it("deduplicates imported inbound/outbound IDs and keeps identical provider IDs tenant-scoped", async () => {
    const historyFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages")) {
        return new Response(JSON.stringify({
          messages: [
            {
              id: INBOUND_MESSAGE_ID,
              accountId: ACCOUNT_A_ID,
              conversationId: CONVERSATION_ID,
              platform: "instagram",
              direction: "incoming",
              senderId: `${ACCOUNT_A_ID}-customer`,
              message: "Mensagem recebida",
              createdAt: "2026-10-10T12:00:00.000Z",
            },
            {
              id: OUTBOUND_MESSAGE_ID,
              accountId: ACCOUNT_A_ID,
              conversationId: CONVERSATION_ID,
              platform: "instagram",
              direction: "outgoing",
              senderId: ACCOUNT_A_ID,
              message: "Resposta enviada",
              createdAt: "2026-10-10T12:05:00.000Z",
            },
            {
              id: MEDIA_MESSAGE_ID,
              accountId: ACCOUNT_A_ID,
              conversationId: CONVERSATION_ID,
              platform: "instagram",
              direction: "incoming",
              senderId: `${ACCOUNT_A_ID}-customer`,
              attachments: [{ type: "image", url: "https://media.example.test/image.jpg" }],
              createdAt: "2026-10-10T12:03:00.000Z",
            },
            {
              id: MALFORMED_MESSAGE_IDS[0],
              accountId: ACCOUNT_A_ID,
              conversationId: CONVERSATION_ID,
              platform: "instagram",
              direction: "incoming",
              senderId: `${ACCOUNT_A_ID}-customer`,
              message: "",
              attachments: [],
              createdAt: "2026-10-10T12:04:00.000Z",
            },
            {
              id: MALFORMED_MESSAGE_IDS[1],
              accountId: ACCOUNT_A_ID,
              conversationId: CONVERSATION_ID,
              platform: "instagram",
              direction: "incoming",
              senderId: `${ACCOUNT_A_ID}-customer`,
              message: "",
              attachments: [null, { type: "image" }],
              createdAt: "2026-10-10T12:04:30.000Z",
            },
            {
              id: MALFORMED_MESSAGE_IDS[2],
              accountId: ACCOUNT_A_ID,
              conversationId: CONVERSATION_ID,
              platform: "instagram",
              direction: "incoming",
              senderId: `${ACCOUNT_A_ID}-customer`,
              message: "",
              createdAt: "2026-10-10T12:04:45.000Z",
            },
          ],
          pagination: { hasMore: false },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: url.searchParams.get("status") === "active"
          ? [{ id: CONVERSATION_ID, accountId: ACCOUNT_A_ID, platform: "instagram" }]
          : [],
        pagination: { hasMore: false },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", historyFetch);

    const firstImport = await importZernioInstagramHistory(
      "not-used-by-stub",
      ACCOUNT_A_ID,
      PROFILE_A_ID,
      INTEGRATION_A_ID,
      () => undefined,
    );
    const repeatedImport = await importZernioInstagramHistory(
      "not-used-by-stub",
      ACCOUNT_A_ID,
      PROFILE_A_ID,
      INTEGRATION_A_ID,
      () => undefined,
    );
    expect(firstImport.messagesImported).toBe(3);
    expect(repeatedImport.messagesImported).toBe(0);
    expect(repeatedImport.messagesAlreadyPresent).toBe(3);

    vi.unstubAllGlobals();
    const aInbound = await webhookRequest(incomingEvent(ACCOUNT_A_ID, PROFILE_A_ID, `evt-a-in-${generateId()}`));
    const aOutbound = await webhookRequest(outgoingEvent(ACCOUNT_A_ID, PROFILE_A_ID, `evt-a-out-${generateId()}`));
    expect(aInbound.status).toBe(200);
    expect(aInbound.body).toMatchObject({ received: true, stored: 0 });
    expect(aOutbound.status).toBe(200);
    expect(aOutbound.body).toMatchObject({ received: true, stored: 0 });
    const aMedia = await webhookRequest(incomingMediaEvent(
      ACCOUNT_A_ID,
      PROFILE_A_ID,
      `evt-a-media-${generateId()}`,
    ));
    expect(aMedia.status).toBe(200);
    expect(aMedia.body).toMatchObject({ received: true, stored: 0 });
    const malformedMedia = await webhookRequest(incomingMalformedMediaEvent(
      ACCOUNT_A_ID,
      PROFILE_A_ID,
      `evt-a-malformed-media-${generateId()}`,
    ));
    expect(malformedMedia.status).toBe(200);
    expect(malformedMedia.body).toMatchObject({ received: true, stored: 0 });

    const bInbound = await webhookRequest(incomingEvent(ACCOUNT_B_ID, PROFILE_B_ID, `evt-b-in-${generateId()}`));
    const bOutbound = await webhookRequest(outgoingEvent(ACCOUNT_B_ID, PROFILE_B_ID, `evt-b-out-${generateId()}`));
    expect(bInbound.status).toBe(200);
    expect(bInbound.body).toMatchObject({ received: true, stored: 1 });
    expect(bOutbound.status).toBe(200);
    expect(bOutbound.body).toMatchObject({ received: true, stored: 1 });

    const aDelivered = await webhookRequest(statusEvent(
      ACCOUNT_A_ID,
      PROFILE_A_ID,
      `evt-a-delivered-${generateId()}`,
      "message.delivered",
      "2026-10-14T12:06:00.000Z",
    ));
    const aRead = await webhookRequest(statusEvent(
      ACCOUNT_A_ID,
      PROFILE_A_ID,
      `evt-a-read-${generateId()}`,
      "message.read",
      "2026-10-14T12:07:00.000Z",
    ));
    const aOlderDelivered = await webhookRequest(statusEvent(
      ACCOUNT_A_ID,
      PROFILE_A_ID,
      `evt-a-old-delivered-${generateId()}`,
      "message.delivered",
      "2026-10-14T12:05:00.000Z",
    ));
    expect(aDelivered.status).toBe(200);
    expect(aDelivered.body).toMatchObject({ received: true, stored: 1 });
    expect(aRead.status).toBe(200);
    expect(aRead.body).toMatchObject({ received: true, stored: 1 });
    expect(aOlderDelivered.status).toBe(200);
    expect(aOlderDelivered.body).toMatchObject({ received: true, stored: 1 });

    const inboundRows = await db.select({
      tenantId: chatbotMessagesTable.tenantId,
      conversationId: chatbotMessagesTable.conversationId,
    }).from(chatbotMessagesTable).where(eq(chatbotMessagesTable.sourceMessageId, `zernio:${INBOUND_MESSAGE_ID}`));
    const mediaRows = await db.select({
      tenantId: chatbotMessagesTable.tenantId,
      content: chatbotMessagesTable.content,
      sourceMessageId: chatbotMessagesTable.sourceMessageId,
      mediaUrl: chatbotMessagesTable.mediaUrl,
      mediaMimeType: chatbotMessagesTable.mediaMimeType,
    }).from(chatbotMessagesTable).where(eq(chatbotMessagesTable.sourceMessageId, `zernio:${MEDIA_MESSAGE_ID}`));
    const malformedRows = await db.select({
      sourceMessageId: chatbotMessagesTable.sourceMessageId,
      content: chatbotMessagesTable.content,
    }).from(chatbotMessagesTable)
      .where(inArray(
        chatbotMessagesTable.sourceMessageId,
        MALFORMED_MESSAGE_IDS.map((messageId) => `zernio:${messageId}`),
      ));
    const outboundRows = await db.select({
      tenantId: chatbotMessagesTable.tenantId,
      conversationId: chatbotMessagesTable.conversationId,
      deliveryStatus: chatbotMessagesTable.deliveryStatus,
      deliveryUpdatedAt: chatbotMessagesTable.deliveryUpdatedAt,
    }).from(chatbotMessagesTable).where(eq(chatbotMessagesTable.providerMessageId, OUTBOUND_MESSAGE_ID));

    expect(inboundRows.map((row) => row.tenantId).sort()).toEqual([TENANT_A_ID, TENANT_B_ID].sort());
    expect(mediaRows).toHaveLength(1);
    expect(malformedRows).toHaveLength(0);
    expect(mediaRows[0]).toMatchObject({
      tenantId: TENANT_A_ID,
      sourceMessageId: `zernio:${MEDIA_MESSAGE_ID}`,
      content: "Mídia recebida pelo Instagram",
      mediaUrl: "https://media.example.test/image.jpg",
      mediaMimeType: "image/jpeg",
    });
    expect(outboundRows.map((row) => row.tenantId).sort()).toEqual([TENANT_A_ID, TENANT_B_ID].sort());
    expect(new Set(inboundRows.map((row) => row.conversationId)).size).toBe(2);
    expect(new Set(outboundRows.map((row) => row.conversationId)).size).toBe(2);
    expect(outboundRows).toHaveLength(2);
    expect(outboundRows.find((row) => row.tenantId === TENANT_A_ID)).toMatchObject({
      deliveryStatus: "read",
      deliveryUpdatedAt: new Date("2026-10-14T12:07:00.000Z"),
    });
    expect(outboundRows.find((row) => row.tenantId === TENANT_B_ID)?.deliveryStatus).toBe("sent");

    const agencyBConversation = await db.select({ id: chatbotConversationsTable.id })
      .from(chatbotConversationsTable)
      .where(and(
        eq(chatbotConversationsTable.tenantId, TENANT_B_ID),
        eq(chatbotConversationsTable.sessionId, `${ACCOUNT_B_ID}-customer`),
      ));
    expect(agencyBConversation).toHaveLength(1);
    expect(inboundRows.find((row) => row.tenantId === TENANT_B_ID)?.conversationId)
      .toBe(agencyBConversation[0]?.id);
  });
});

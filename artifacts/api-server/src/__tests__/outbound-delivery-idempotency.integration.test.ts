import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { mockWhatsAppSend } = vi.hoisted(() => ({
  mockWhatsAppSend: vi.fn(async () => ({
    provider: "integration-test",
    externalId: "provider-accepted-once",
    success: true,
    error: null,
    outcomeUnknown: false,
  })),
}));

vi.mock("../services/messaging-provider-adapters.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/messaging-provider-adapters.js")>();
  return {
    ...actual,
    whatsappProviderAdapter: {
      ...actual.whatsappProviderAdapter,
      send: mockWhatsAppSend,
    },
  };
});

import {
  db,
  outboundDeliveriesTable,
  outboundMessagesTable,
  pool,
  tenantsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  createOutboundMessage,
  processOutboundDelivery,
} from "../services/outbound-delivery.js";

const runId = randomUUID().replaceAll("-", "");
const tenantId = `outbound-idem-${runId}`;
const tenantSlug = `outbound-idem-${runId}`;
const phone = "5511999912345";
const campaignId = randomUUID();
const newCampaignId = randomUUID();
const testDatabase = "visitecrm_test";
const ciTestDatabase = "visitecrm_ci";
let isolatedDatabaseVerified = false;

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(
    hostname.replace(/^\[|\]$/g, "").toLowerCase(),
  );
}

async function assertIsolatedDatabase(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must point to an isolated outbound delivery test database");
  }

  let configuredUrl: URL;
  try {
    configuredUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Refusing to run outbound delivery integration test with an invalid database URL");
  }

  const databaseName = decodeURIComponent(configuredUrl.pathname.replace(/^\/+/, ""));
  const host = configuredUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = databaseName === testDatabase && isLoopback(host);
  const ci = process.env["CI"] === "true" && databaseName === ciTestDatabase && isLoopback(host);
  if (!local && !ci) {
    throw new Error("Refusing to run outbound delivery integration test outside an isolated database");
  }

  const { rows } = await pool.query<{
    database_name: string;
    server_address: string | null;
  }>(`
    SELECT current_database() AS database_name,
           host(inet_server_addr()) AS server_address
  `);
  const connected = rows[0];
  const localMatches = local
    && connected?.database_name === testDatabase
    && isLoopback(connected.server_address ?? "");
  const ciMatches = ci && connected?.database_name === ciTestDatabase;
  if (!localMatches && !ciMatches) {
    throw new Error("Refusing to run outbound delivery integration test outside an isolated database");
  }
}

beforeAll(async () => {
  await assertIsolatedDatabase();
  isolatedDatabaseVerified = true;
  await db.insert(tenantsTable).values({
    id: tenantId,
    name: "Outbound delivery idempotency test",
    slug: tenantSlug,
    email: `${tenantSlug}@example.test`,
  });
});

afterAll(async () => {
  if (!isolatedDatabaseVerified) return;
  await db.delete(outboundMessagesTable).where(eq(outboundMessagesTable.tenantId, tenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  await pool.end();
});

describe("outbound delivery database idempotency", () => {
  it("persists one WhatsApp delivery for concurrent campaign requests and accepts it once", async () => {
    mockWhatsAppSend.mockClear();
    const logicalCampaignKey = `trip:trip-test:${campaignId}:passenger:${phone}`;
    const input = {
      tenantId,
      eventType: "trip_whatsapp_broadcast",
      idempotencyKey: logicalCampaignKey,
      recipient: { type: "direct" as const, whatsapp: phone },
      whatsapp: { text: "Integration test broadcast" },
      channels: ["whatsapp" as const],
      origin: "legacy_whatsapp",
      originChannel: "whatsapp" as const,
    };

    const concurrentCreations = await Promise.all([
      createOutboundMessage(input),
      createOutboundMessage(input),
    ]);
    const messageIds = new Set(concurrentCreations.map(({ message }) => message.id));
    expect(messageIds.size).toBe(1);
    expect(concurrentCreations.filter(({ created }) => created).length).toBe(1);

    const [message] = await db.select().from(outboundMessagesTable).where(and(
      eq(outboundMessagesTable.tenantId, tenantId),
      eq(outboundMessagesTable.idempotencyKey, logicalCampaignKey),
    ));
    expect(message).toBeDefined();
    const deliveries = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, message!.id),
    ));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.channel).toBe("whatsapp");

    const deliveryId = deliveries[0]!.id;
    const workerResults = await Promise.all([
      processOutboundDelivery(deliveryId, tenantId),
      processOutboundDelivery(deliveryId, tenantId),
    ]);
    expect(workerResults.filter(Boolean)).toHaveLength(1);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);

    const [acceptedDelivery] = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.id, deliveryId),
    ));
    expect(acceptedDelivery?.status).toBe("accepted");
    const [acceptedMessage] = await db.select().from(outboundMessagesTable).where(and(
      eq(outboundMessagesTable.tenantId, tenantId),
      eq(outboundMessagesTable.id, message!.id),
    ));
    expect(acceptedMessage?.status).toBe("accepted");

    const distinctCampaign = await createOutboundMessage({
      ...input,
      idempotencyKey: `trip:trip-test:${newCampaignId}:passenger:${phone}`,
    });
    expect(distinctCampaign.created).toBe(true);
    expect(distinctCampaign.message.id).not.toBe(message!.id);
    expect(distinctCampaign.deliveries).toHaveLength(1);
    expect(await processOutboundDelivery(distinctCampaign.deliveries[0]!.id, tenantId)).toBe(true);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(2);

    const persistedMessages = await db.select().from(outboundMessagesTable)
      .where(eq(outboundMessagesTable.tenantId, tenantId));
    const persistedDeliveries = await db.select().from(outboundDeliveriesTable)
      .where(eq(outboundDeliveriesTable.tenantId, tenantId));
    expect(persistedMessages).toHaveLength(2);
    expect(persistedDeliveries).toHaveLength(2);
  });
});

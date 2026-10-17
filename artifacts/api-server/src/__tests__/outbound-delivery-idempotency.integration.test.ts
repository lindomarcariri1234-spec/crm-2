import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { mockWhatsAppSend, mockReconcileWhatsAppMessage } = vi.hoisted(() => ({
  mockWhatsAppSend: vi.fn(async () => ({
    provider: "integration-test",
    externalId: "provider-accepted-once",
    success: true,
    error: null as string | null,
    outcomeUnknown: false,
  })),
  mockReconcileWhatsAppMessage: vi.fn<() => Promise<{
    outcome: "accepted" | "inconclusive";
    provider: "evolution";
    externalId: string;
    providerStatus?: string;
    detail: string;
  }>>(async () => ({
    outcome: "accepted" as const,
    provider: "evolution" as const,
    externalId: "provider-accepted-after-timeout",
    providerStatus: "SERVER_ACK",
    detail: "provider_message_found",
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

vi.mock("../lib/whatsapp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/whatsapp")>();
  return {
    ...actual,
    reconcileTenantWhatsAppMessage: mockReconcileWhatsAppMessage,
  };
});

import {
  db,
  outboundDeliveriesTable,
  outboundDeliveryAttemptsTable,
  outboundMessagesTable,
  pool,
  tenantsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  createOutboundMessage,
  processOutboundDelivery,
  reconcileOutboundDelivery,
  recoverOutboundDeliveries,
} from "../services/outbound-delivery.js";

const runId = randomUUID().replaceAll("-", "");
const tenantId = `outbound-idem-${runId}`;
const tenantSlug = `outbound-idem-${runId}`;
const secondTenantId = `outbound-idem-other-${runId}`;
const secondTenantSlug = `outbound-idem-other-${runId}`;
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
  await db.insert(tenantsTable).values({
    id: secondTenantId,
    name: "Outbound delivery idempotency test (second tenant)",
    slug: secondTenantSlug,
    email: `${secondTenantSlug}@example.test`,
  });
});

afterAll(async () => {
  if (!isolatedDatabaseVerified) return;
  await db.delete(outboundMessagesTable).where(eq(outboundMessagesTable.tenantId, tenantId));
  await db.delete(outboundMessagesTable).where(eq(outboundMessagesTable.tenantId, secondTenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, secondTenantId));
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

  it("keeps concurrent identical keys and delivery processing isolated between tenants", async () => {
    mockWhatsAppSend.mockClear();
    const logicalCampaignKey = `trip:trip-test:shared-campaign:${phone}`;
    const inputForTenant = (tenantId: string) => ({
      tenantId,
      eventType: "trip_whatsapp_broadcast",
      idempotencyKey: logicalCampaignKey,
      recipient: { type: "direct" as const, whatsapp: phone },
      whatsapp: { text: "Same logical key sent by two agencies" },
      channels: ["whatsapp" as const],
      origin: "legacy_whatsapp",
      originChannel: "whatsapp" as const,
    });

    const [aFirst, bFirst, aSecond, bSecond] = await Promise.all([
      createOutboundMessage(inputForTenant(tenantId)),
      createOutboundMessage(inputForTenant(secondTenantId)),
      createOutboundMessage(inputForTenant(tenantId)),
      createOutboundMessage(inputForTenant(secondTenantId)),
    ]);
    const tenantAMessages = [aFirst, aSecond];
    const tenantBMessages = [bFirst, bSecond];

    for (const tenantMessages of [tenantAMessages, tenantBMessages]) {
      expect(new Set(tenantMessages.map(({ message }) => message.id)).size).toBe(1);
      expect(tenantMessages.filter(({ created }) => created)).toHaveLength(1);
    }
    const [messagesA, messagesB] = await Promise.all([
      db.select().from(outboundMessagesTable).where(and(
        eq(outboundMessagesTable.tenantId, tenantId),
        eq(outboundMessagesTable.idempotencyKey, logicalCampaignKey),
      )),
      db.select().from(outboundMessagesTable).where(and(
        eq(outboundMessagesTable.tenantId, secondTenantId),
        eq(outboundMessagesTable.idempotencyKey, logicalCampaignKey),
      )),
    ]);
    expect(messagesA).toHaveLength(1);
    expect(messagesB).toHaveLength(1);
    const messageA = messagesA[0]!;
    const messageB = messagesB[0]!;
    expect(messageA.id).not.toBe(messageB.id);
    expect(messageA.id).toBe(aFirst.message.id);
    expect(messageB.id).toBe(bFirst.message.id);
    expect(messageA.tenantId).toBe(tenantId);
    expect(messageB.tenantId).toBe(secondTenantId);
    expect(messageA.idempotencyKey).toBe(logicalCampaignKey);
    expect(messageB.idempotencyKey).toBe(logicalCampaignKey);

    const [deliveriesA, deliveriesB] = await Promise.all([
      db.select().from(outboundDeliveriesTable).where(and(
        eq(outboundDeliveriesTable.tenantId, tenantId),
        eq(outboundDeliveriesTable.outboundMessageId, messageA.id),
      )),
      db.select().from(outboundDeliveriesTable).where(and(
        eq(outboundDeliveriesTable.tenantId, secondTenantId),
        eq(outboundDeliveriesTable.outboundMessageId, messageB.id),
      )),
    ]);
    expect(deliveriesA).toHaveLength(1);
    expect(deliveriesB).toHaveLength(1);
    const deliveryA = deliveriesA[0]!;
    const deliveryB = deliveriesB[0]!;
    expect(deliveryA.id).not.toBe(deliveryB.id);
    expect(deliveryA.tenantId).toBe(tenantId);
    expect(deliveryB.tenantId).toBe(secondTenantId);
    expect(deliveryA.channel).toBe("whatsapp");
    expect(deliveryB.channel).toBe("whatsapp");

    await expect(processOutboundDelivery(deliveryA.id, tenantId)).resolves.toBe(true);
    const [acceptedDeliveryA] = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.id, deliveryA.id),
    ));
    const [untouchedDeliveryB] = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, secondTenantId),
      eq(outboundDeliveriesTable.id, deliveryB.id),
    ));
    const [untouchedMessageB] = await db.select().from(outboundMessagesTable).where(and(
      eq(outboundMessagesTable.tenantId, secondTenantId),
      eq(outboundMessagesTable.id, messageB.id),
    ));
    const [attemptsA, attemptsB] = await Promise.all([
      db.select().from(outboundDeliveryAttemptsTable).where(and(
        eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
        eq(outboundDeliveryAttemptsTable.deliveryId, deliveryA.id),
      )),
      db.select().from(outboundDeliveryAttemptsTable).where(and(
        eq(outboundDeliveryAttemptsTable.tenantId, secondTenantId),
        eq(outboundDeliveryAttemptsTable.deliveryId, deliveryB.id),
      )),
    ]);
    expect(acceptedDeliveryA?.status).toBe("accepted");
    expect(untouchedDeliveryB?.status).toBe("pending");
    expect(untouchedMessageB?.status).toBe("pending");
    expect(attemptsA).toHaveLength(1);
    expect(attemptsA[0]?.status).toBe("accepted");
    expect(attemptsB).toHaveLength(0);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);

    await expect(processOutboundDelivery(deliveryB.id, secondTenantId)).resolves.toBe(true);
    const [acceptedDeliveryB] = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, secondTenantId),
      eq(outboundDeliveriesTable.id, deliveryB.id),
    ));
    expect(acceptedDeliveryB?.status).toBe("accepted");
    const [attemptsBAfterProcessing] = await db.select().from(outboundDeliveryAttemptsTable).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, secondTenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, deliveryB.id),
    ));
    expect(attemptsBAfterProcessing?.status).toBe("accepted");
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(2);
  });

  it("keeps an ambiguous provider result in reconciliation until the same delivery is confirmed accepted", async () => {
    mockWhatsAppSend.mockClear();
    mockReconcileWhatsAppMessage.mockClear();
    const externalId = "provider-accepted-after-timeout";
    const logicalCampaignKey = `trip:trip-test:ambiguous:${randomUUID()}:${phone}`;
    mockWhatsAppSend.mockResolvedValueOnce({
      provider: "evolution",
      externalId,
      success: false,
      error: "response_lost_after_send_started",
      outcomeUnknown: true,
    });
    mockReconcileWhatsAppMessage.mockResolvedValueOnce({
      outcome: "accepted",
      provider: "evolution",
      externalId,
      providerStatus: "SERVER_ACK",
      detail: "provider_message_found",
    });

    const created = await createOutboundMessage({
      tenantId,
      eventType: "trip_whatsapp_broadcast",
      idempotencyKey: logicalCampaignKey,
      recipient: { type: "direct", whatsapp: phone },
      whatsapp: { text: "A response was lost after the provider call started" },
      channels: ["whatsapp"],
      origin: "legacy_whatsapp",
      originChannel: "whatsapp",
    });
    expect(created.deliveries).toHaveLength(1);
    const deliveryId = created.deliveries[0]!.id;

    await expect(processOutboundDelivery(deliveryId, tenantId)).resolves.toBe(false);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);
    const [unknownDelivery] = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.id, deliveryId),
    ));
    expect(unknownDelivery).toMatchObject({
      status: "unknown",
      provider: "evolution",
      externalId,
      lastError: "delivery_result_unknown",
      attempts: 1,
    });
    const [unknownAttempt] = await db.select().from(outboundDeliveryAttemptsTable).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, deliveryId),
    ));
    expect(unknownAttempt).toMatchObject({
      status: "unknown",
      provider: "evolution",
      externalId,
      attemptNumber: 1,
    });

    await expect(recoverOutboundDeliveries({ databaseFallback: true })).resolves.toEqual({
      recovered: 0,
      enqueued: 0,
      inlineAttempted: 0,
    });
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);
    const stillUnknown = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.id, deliveryId),
      eq(outboundDeliveriesTable.status, "unknown"),
    ));
    expect(stillUnknown).toHaveLength(1);

    await expect(reconcileOutboundDelivery(tenantId, deliveryId, {
      userId: "integration-test-reviewer",
    })).resolves.toMatchObject({
      outcome: "accepted",
      canRetry: false,
      deliveryId,
      messageId: created.message.id,
      provider: "evolution",
      externalId,
      providerStatus: "SERVER_ACK",
    });
    expect(mockReconcileWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);

    const persistedDeliveries = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, created.message.id),
    ));
    expect(persistedDeliveries).toHaveLength(1);
    expect(persistedDeliveries[0]).toMatchObject({
      id: deliveryId,
      status: "accepted",
      provider: "evolution",
      externalId,
      lastError: null,
      acceptedAt: expect.any(Date),
    });
    const [acceptedAttempt] = await db.select().from(outboundDeliveryAttemptsTable).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, deliveryId),
    ));
    expect(acceptedAttempt).toMatchObject({
      status: "accepted",
      provider: "evolution",
      externalId,
      attemptNumber: 1,
    });
    const [acceptedMessage] = await db.select().from(outboundMessagesTable).where(and(
      eq(outboundMessagesTable.tenantId, tenantId),
      eq(outboundMessagesTable.id, created.message.id),
    ));
    expect(acceptedMessage?.status).toBe("accepted");
  });

  it("keeps delivery and attempt unknown when provider reconciliation is inconclusive", async () => {
    mockWhatsAppSend.mockClear();
    mockReconcileWhatsAppMessage.mockClear();
    const externalId = "provider-inconclusive-after-timeout";
    const detail = "provider_lookup_temporarily_unavailable";
    mockWhatsAppSend.mockResolvedValueOnce({
      provider: "evolution",
      externalId,
      success: false,
      error: "response_lost_after_send_started",
      outcomeUnknown: true,
    });
    mockReconcileWhatsAppMessage.mockResolvedValueOnce({
      outcome: "inconclusive",
      provider: "evolution",
      externalId,
      detail,
    });

    const created = await createOutboundMessage({
      tenantId,
      eventType: "trip_whatsapp_broadcast",
      idempotencyKey: `trip:trip-test:inconclusive:${randomUUID()}:${phone}`,
      recipient: { type: "direct", whatsapp: phone },
      whatsapp: { text: "The provider lookup is temporarily unavailable" },
      channels: ["whatsapp"],
      origin: "legacy_whatsapp",
      originChannel: "whatsapp",
    });
    expect(created.deliveries).toHaveLength(1);
    const deliveryId = created.deliveries[0]!.id;

    await expect(processOutboundDelivery(deliveryId, tenantId)).resolves.toBe(false);
    await expect(reconcileOutboundDelivery(tenantId, deliveryId, {
      userId: "integration-test-reviewer",
    })).resolves.toMatchObject({
      outcome: "inconclusive",
      canRetry: false,
      deliveryId,
      messageId: created.message.id,
      provider: "evolution",
      externalId,
      detail,
    });

    expect(mockReconcileWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);
    const persistedDeliveries = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, created.message.id),
    ));
    expect(persistedDeliveries).toHaveLength(1);
    expect(persistedDeliveries[0]).toMatchObject({
      id: deliveryId,
      status: "unknown",
      provider: "evolution",
      externalId,
      lastError: detail,
      attempts: 1,
    });
    const attempts = await db.select().from(outboundDeliveryAttemptsTable).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, deliveryId),
    ));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      status: "unknown",
      provider: "evolution",
      externalId,
      error: detail,
      attemptNumber: 1,
    });
  });

  it("recovers an expired processing lease only once across concurrent sweeps", async () => {
    mockWhatsAppSend.mockClear();
    mockReconcileWhatsAppMessage.mockClear();
    const created = await createOutboundMessage({
      tenantId,
      eventType: "trip_whatsapp_broadcast",
      idempotencyKey: `trip:trip-test:worker-crash:${randomUUID()}:${phone}`,
      recipient: { type: "direct", whatsapp: phone },
      whatsapp: { text: "The worker stopped after starting the provider request" },
      channels: ["whatsapp"],
      origin: "legacy_whatsapp",
      originChannel: "whatsapp",
    });
    expect(created.deliveries).toHaveLength(1);
    const deliveryId = created.deliveries[0]!.id;
    const expiredClaimAt = new Date(Date.now() - 16 * 60 * 1000);

    // Simulate the durable state left behind when the worker dies after
    // claiming the delivery and starting the provider attempt.
    await db.update(outboundDeliveriesTable).set({
      status: "processing",
      provider: "evolution",
      attempts: 1,
      claimedAt: expiredClaimAt,
      nextAttemptAt: expiredClaimAt,
    }).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.id, deliveryId),
    ));
    await db.insert(outboundDeliveryAttemptsTable).values({
      id: randomUUID(),
      tenantId,
      deliveryId,
      attemptNumber: 1,
      provider: "evolution",
      status: "processing",
      startedAt: expiredClaimAt,
    });

    const recoveries = await Promise.all([
      recoverOutboundDeliveries({ databaseFallback: true }),
      recoverOutboundDeliveries({ databaseFallback: true }),
    ]);
    expect(recoveries.map((result) => result.recovered).sort()).toEqual([0, 1]);
    expect(recoveries.reduce(
      (total, result) => ({
        recovered: total.recovered + result.recovered,
        enqueued: total.enqueued + result.enqueued,
        inlineAttempted: total.inlineAttempted + result.inlineAttempted,
      }),
      { recovered: 0, enqueued: 0, inlineAttempted: 0 },
    )).toEqual({
      recovered: 1,
      enqueued: 0,
      inlineAttempted: 0,
    });
    expect(mockWhatsAppSend).not.toHaveBeenCalled();
    expect(mockReconcileWhatsAppMessage).not.toHaveBeenCalled();

    const deliveries = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, created.message.id),
    ));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      id: deliveryId,
      status: "unknown",
      provider: "evolution",
      attempts: 1,
      claimedAt: null,
      lastError: "delivery_result_unknown",
    });
    const attempts = await db.select().from(outboundDeliveryAttemptsTable).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, deliveryId),
    ));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      attemptNumber: 1,
      provider: "evolution",
      status: "unknown",
      error: "delivery_result_unknown",
      completedAt: expect.any(Date),
    });
  });
});

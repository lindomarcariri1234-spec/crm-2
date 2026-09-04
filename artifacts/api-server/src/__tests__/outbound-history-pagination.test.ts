import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListOutboundMessages,
  mockListOutboundProviderFailureSummary,
  mockReconcileOutboundDelivery,
  mockRetryUnknownOutboundDelivery,
  mockRequireAuth,
} = vi.hoisted(() => ({
  mockListOutboundMessages: vi.fn(),
  mockListOutboundProviderFailureSummary: vi.fn(),
  mockReconcileOutboundDelivery: vi.fn(),
  mockRetryUnknownOutboundDelivery: vi.fn(),
  mockRequireAuth: vi.fn(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  ADMIN_ROLES: ["agencia", "gerente"],
}));

vi.mock("../services/outbound-delivery.js", () => ({
  listOutboundMessages: mockListOutboundMessages,
  listOutboundProviderFailureSummary: mockListOutboundProviderFailureSummary,
  dispatchOutboundMessage: vi.fn(),
  retryOutboundDelivery: vi.fn(),
  reconcileOutboundDelivery: mockReconcileOutboundDelivery,
  retryUnknownOutboundDelivery: mockRetryUnknownOutboundDelivery,
}));

import outboundMessagesRouter from "../routes/outbound-messages.js";

function makeApp() {
  const app = express();
  app.use(outboundMessagesRouter);
  app.use((
    error: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(error.status ?? 500).json({ error: error.message });
  });
  return app;
}

const createdAt = new Date("2026-09-01T12:00:00.000Z");

function historyRow(id: string, tenantId: string, status: "partial" | "failed", deliveryStatus: "failed" | "accepted") {
  return {
    message: {
      id,
      tenantId,
      idempotencyKey: `key-${id}`,
      eventType: "reservation_confirmation",
      origin: "reservation",
      originChannel: "email",
      recipientType: "client",
      recipientId: `client-${id}`,
      recipientName: "Cliente",
      emailAddress: "cliente@example.com",
      whatsappNumber: null,
      emailSubject: "Confirmação",
      emailHtml: null,
      whatsappText: null,
      senderName: null,
      metadata: {},
      status,
      createdAt,
      updatedAt: createdAt,
    },
    deliveries: [{
      id: `delivery-${id}`,
      tenantId,
      outboundMessageId: id,
      channel: "email" as const,
      recipient: "cliente@example.com",
      subject: "Confirmação",
      content: "Conteúdo",
      status: deliveryStatus,
      attempts: 3,
      maxAttempts: 3,
      provider: "resend",
      externalId: null,
      lastError: deliveryStatus === "failed" ? "provider_failed" : null,
      skippedReason: null,
      nextAttemptAt: createdAt,
      claimedAt: null,
      acceptedAt: deliveryStatus === "accepted" ? createdAt : null,
      failedAt: deliveryStatus === "failed" ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
    }],
  };
}

describe("GET /outbound-messages filtered pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      id: "user-a",
      tenantId: "tenant-a",
      role: "agencia",
    });
  });

  it("passes combined tenant, provider, channel and delivery filters before the page limit", async () => {
    const firstPageNoise = Array.from({ length: 200 }, (_, index) =>
      historyRow(`noise-${index}`, "tenant-a", "failed", "accepted"),
    );
    const partialFailure = historyRow("partial-failure", "tenant-a", "partial", "failed");
    const otherTenant = historyRow("other-tenant", "tenant-b", "failed", "failed");
    // The service applies these predicates in SQL before LIMIT. Keep the
    // out-of-page fixture here so a regression to post-limit filtering can be
    // represented without making the route mock a second implementation.
    const allRows = [...firstPageNoise, partialFailure, otherTenant];
    mockListOutboundMessages.mockImplementation(async (tenantId: string, options: {
      provider?: string;
      channel?: string;
      deliveryStatus?: string;
      limit?: number;
    }) => {
      expect(tenantId).toBe("tenant-a");
      expect(options).toEqual(expect.objectContaining({
        provider: "resend",
        channel: "email",
        deliveryStatus: "failed",
        limit: 200,
      }));
      return allRows.filter((row) => row.message.id === "partial-failure");
    });

    const response = await request(makeApp())
      .get("/outbound-messages")
      .query({
        limit: 200,
        provider: "resend",
        channel: "email",
        deliveryStatus: "failed",
      });

    expect(response.status).toBe(200);
    expect(mockListOutboundMessages).toHaveBeenCalledWith("tenant-a", expect.objectContaining({
      provider: "resend",
      channel: "email",
      deliveryStatus: "failed",
      limit: 200,
    }));
    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe("partial-failure");
    expect(response.body[0].status).toBe("partial");
    expect(response.body[0].deliveries).toHaveLength(1);
    expect(response.body[0].deliveries[0].status).toBe("failed");
    expect(response.body).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "other-tenant" }),
    ]));
  });
});

describe("GET /outbound-messages/provider-failure-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      id: "user-a",
      tenantId: "tenant-a",
      role: "agencia",
    });
  });

  it("passes the tenant and all history filters to the aggregate service", async () => {
    mockListOutboundProviderFailureSummary.mockResolvedValue([
      {
        provider: "resend",
        failureCount: 3,
        totalFailures: 4,
        failurePercentage: 75,
      },
      {
        provider: "meta",
        failureCount: 1,
        totalFailures: 4,
        failurePercentage: 25,
      },
    ]);

    const response = await request(makeApp())
      .get("/outbound-messages/provider-failure-summary")
      .query({
        status: "partial",
        channel: "email",
        deliveryStatus: "failed",
        provider: "resend",
        clientId: "client-a",
        origin: "campaign",
        eventType: "reservation_confirmation",
        campaignId: "campaign-a",
        automationId: "automation-a",
        bounceType: "permanent",
        dateFrom: "2026-08-01",
        dateTo: "2026-08-31",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { provider: "resend", failureCount: 3, totalFailures: 4, failurePercentage: 75 },
      { provider: "meta", failureCount: 1, totalFailures: 4, failurePercentage: 25 },
    ]);
    expect(mockListOutboundProviderFailureSummary).toHaveBeenCalledWith(
      "tenant-a",
      expect.objectContaining({
        status: "partial",
        channel: "email",
        deliveryStatus: "failed",
        provider: "resend",
        clientId: "client-a",
        origin: "campaign",
        eventType: "reservation_confirmation",
        campaignId: "campaign-a",
        automationId: "automation-a",
        bounceType: "permanent",
        dateFrom: new Date("2026-08-01T00:00:00.000Z"),
        dateTo: new Date("2026-08-31T23:59:59.999Z"),
      }),
    );
  });
});

describe("POST /outbound-messages/:deliveryId/reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      id: "admin-a",
      tenantId: "tenant-a",
      role: "agencia",
    });
  });

  it("passes the authenticated tenant and actor context to reconciliation", async () => {
    mockReconcileOutboundDelivery.mockResolvedValue({
      outcome: "not_found",
      deliveryId: "delivery-a",
      messageId: "message-a",
      provider: "evolution",
      externalId: "external-a",
      detail: "provider_message_not_found",
      canRetry: true,
    });

    const response = await request(makeApp())
      .post("/outbound-messages/delivery-a/reconcile");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      outcome: "not_found",
      canRetry: true,
    }));
    expect(mockReconcileOutboundDelivery).toHaveBeenCalledWith(
      "tenant-a",
      "delivery-a",
      expect.objectContaining({ userId: "admin-a" }),
    );
  });

  it("does not allow a non-administrator to review an ambiguous delivery", async () => {
    mockRequireAuth.mockResolvedValue({
      id: "support-a",
      tenantId: "tenant-a",
      role: "suporte",
    });

    const response = await request(makeApp())
      .post("/outbound-messages/delivery-a/reconcile");

    expect(response.status).toBe(403);
    expect(response.body.message).toContain("administradores");
    expect(mockReconcileOutboundDelivery).not.toHaveBeenCalled();
  });

  it("queues only through the explicit re-check endpoint", async () => {
    mockRetryUnknownOutboundDelivery.mockResolvedValue({
      outcome: "queued",
      deliveryId: "delivery-a",
      messageId: "message-a",
    });

    const response = await request(makeApp())
      .post("/outbound-messages/delivery-a/reconcile/retry");

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      outcome: "queued",
      deliveryId: "delivery-a",
      messageId: "message-a",
    });
    expect(mockRetryUnknownOutboundDelivery).toHaveBeenCalledWith(
      "tenant-a",
      "delivery-a",
      expect.objectContaining({ userId: "admin-a" }),
    );
  });
});
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuditValues,
  mockListOutboundMessages,
  mockRequireAuth,
} = vi.hoisted(() => ({
  mockAuditValues: vi.fn().mockResolvedValue([]),
  mockListOutboundMessages: vi.fn(),
  mockRequireAuth: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn(() => ({ values: mockAuditValues })),
  },
  auditLogsTable: {},
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn()
    .mockReturnValueOnce("audit-log-id")
    .mockReturnValueOnce("export-id"),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock("../lib/outbound-sse.js", () => ({
  addOutboundClient: vi.fn(),
  removeOutboundClient: vi.fn(),
}));

vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: vi.fn(),
  listOutboundMessages: mockListOutboundMessages,
  retryOutboundDelivery: vi.fn(),
}));

import outboundMessagesRouter from "../routes/outbound-messages.js";

function buildApp() {
  const app = express();
  app.use(express.json());
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

describe("GET /outbound-messages/export audit trail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      id: "user-1",
      tenantId: "tenant-1",
      role: "agencia",
    });
    mockListOutboundMessages.mockResolvedValue([
      {
        message: {
          id: "message-1",
          recipientName: "Cliente confidencial",
          recipientId: "client-1",
          eventType: "reservation_confirmation",
          origin: "reservation",
          status: "failed",
        },
        deliveries: [
          {
            id: "delivery-1",
            recipient: "cliente@example.com",
            channel: "email",
            attempts: 2,
            lastError: "secret provider token leaked in error",
            skippedReason: null,
          },
        ],
      },
    ]);
  });

  it("records the authenticated user, tenant, format, filters, and exported row count", async () => {
    const response = await request(buildApp())
      .get("/outbound-messages/export")
      .set("user-agent", "audit-test")
      .query({
        format: "csv",
        status: "failed",
        channel: "email",
        dateFrom: "2026-08-01",
        dateTo: "2026-08-31",
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(mockAuditValues).toHaveBeenCalledWith(expect.objectContaining({
      id: "audit-log-id",
      tenantId: "tenant-1",
      userId: "user-1",
      action: "export_outbound_messages",
      entityType: "outbound_messages_export",
      entityId: "export-id",
      userAgent: "audit-test",
      after: {
        format: "csv",
        filters: {
          status: "failed",
          channel: "email",
          deliveryStatus: null,
          provider: null,
          clientId: null,
          origin: null,
          eventType: null,
          campaignId: null,
          automationId: null,
          bounceType: null,
          dateFrom: "2026-08-01",
          dateTo: "2026-08-31",
        },
        rowCount: 1,
      },
    }));
  });

  it("does not store message content, recipient data, or provider errors", async () => {
    const response = await request(buildApp())
      .get("/outbound-messages/export")
      .query({ format: "csv" });

    expect(response.status).toBe(200);
    const auditRecord = mockAuditValues.mock.calls[0]?.[0];
    const serialized = JSON.stringify(auditRecord);
    expect(serialized).not.toContain("Cliente confidencial");
    expect(serialized).not.toContain("cliente@example.com");
    expect(serialized).not.toContain("secret provider token");
  });

  it("does not send an export when the audit record cannot be persisted", async () => {
    mockAuditValues.mockRejectedValueOnce(new Error("audit database unavailable"));

    const response = await request(buildApp())
      .get("/outbound-messages/export")
      .query({ format: "csv" });

    expect(response.status).toBe(500);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.text).not.toContain("message-1");
  });
});
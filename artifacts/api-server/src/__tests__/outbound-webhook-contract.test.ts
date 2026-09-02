import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUpdateDelivery,
  mockEvolutionStatus,
  mockEvolutionInbound,
} = vi.hoisted(() => ({
  mockUpdateDelivery: vi.fn(),
  mockEvolutionStatus: vi.fn(),
  mockEvolutionInbound: vi.fn(),
}));

vi.mock("../services/outbound-delivery.js", () => ({
  updateOutboundDeliveryFromWebhook: mockUpdateDelivery,
}));

vi.mock("../services/whatsapp-attendance.js", () => ({
  processEvolutionDeliveryStatus: mockEvolutionStatus,
  processEvolutionInbound: mockEvolutionInbound,
}));

import webhooksRouter from "../routes/webhooks";
import {
  addOutboundClient,
  emitOutboundDeliveryUpdate,
  removeOutboundClient,
} from "../lib/outbound-sse";

const SECRET = "contract-test-secret";

function makeApp() {
  const app = express();
  app.use(express.json({
    verify(req, _res, buffer) {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }));
  app.use(webhooksRouter);
  return app;
}

function resendSignature(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("base64");
}

describe("outbound provider webhook contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["RESEND_WEBHOOK_SECRET"] = SECRET;
    mockUpdateDelivery.mockResolvedValue({ updated: true });
    mockEvolutionStatus.mockResolvedValue("updated");
  });

  it.each([
    ["email.delivered", "accepted", null],
    ["email.failed", "failed", "email.failed"],
  ] as const)("validates Resend %s and scopes the update to the URL tenant", async (type, status, error) => {
    const payload = JSON.stringify({ type, data: { email_id: "resend-42" } });
    const response = await request(makeApp())
      .post("/webhooks/resend/tenant-a")
      .set("Content-Type", "application/json")
      .set("x-resend-signature", resendSignature(payload))
      .send(payload);

    expect(response.status).toBe(200);
    expect(mockUpdateDelivery).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      provider: "resend",
      externalId: "resend-42",
      status,
      providerStatus: type,
      error,
    });
  });

  it("rejects an invalid Resend signature without updating any tenant", async () => {
    const response = await request(makeApp())
      .post("/webhooks/resend/tenant-b")
      .set("Content-Type", "application/json")
      .set("x-resend-signature", "invalid")
      .send({ type: "email.delivered", data: { email_id: "resend-42" } });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mockUpdateDelivery).not.toHaveBeenCalled();
  });

  it("acknowledges replayed Evolution delivery events without processing inbound messages", async () => {
    const payload = {
      event: "messages.update",
      data: { key: { id: "evolution-7" }, update: { status: 3 } },
    };

    const first = await request(makeApp())
      .post("/webhooks/whatsapp/evolution/agency-instance")
      .set("apikey", "test-key")
      .send(payload);
    const replay = await request(makeApp())
      .post("/webhooks/whatsapp/evolution/agency-instance")
      .set("apikey", "test-key")
      .send(payload);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(first.body).toEqual({ received: true, outcome: "updated" });
    expect(mockEvolutionStatus).toHaveBeenCalledTimes(2);
    expect(mockEvolutionInbound).not.toHaveBeenCalled();
  });
});

describe("outbound history SSE tenant stream", () => {
  it("writes to connected clients only and stops after disconnect", () => {
    const tenantAWrite = vi.fn();
    const tenantBWrite = vi.fn();
    const tenantA = { write: tenantAWrite } as unknown as express.Response;
    const tenantB = { write: tenantBWrite } as unknown as express.Response;
    const payload = {
      deliveryId: "delivery-1",
      messageId: "message-1",
      status: "accepted",
      channel: "email" as const,
      provider: "resend",
    };

    addOutboundClient("tenant-a", tenantA);
    addOutboundClient("tenant-b", tenantB);
    emitOutboundDeliveryUpdate("tenant-a", payload);

    expect(tenantAWrite).toHaveBeenCalledWith(
      `event: outbound-delivery-updated\ndata: ${JSON.stringify(payload)}\n\n`,
    );
    expect(tenantBWrite).not.toHaveBeenCalled();

    removeOutboundClient("tenant-a", tenantA);
    emitOutboundDeliveryUpdate("tenant-a", { ...payload, status: "failed" });
    expect(tenantAWrite).toHaveBeenCalledTimes(1);

    removeOutboundClient("tenant-b", tenantB);
  });
});
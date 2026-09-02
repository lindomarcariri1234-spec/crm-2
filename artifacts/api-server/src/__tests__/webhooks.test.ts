import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import request from "supertest";

const { mockUpdateOutboundDeliveryFromWebhook } = vi.hoisted(() => ({
  mockUpdateOutboundDeliveryFromWebhook: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  storeOrdersTable: {},
  reservationsTable: {},
  paymentsTable: {},
  storesTable: {},
  tripsTable: {},
}));

vi.mock("../services/outbound-delivery.js", () => ({
  updateOutboundDeliveryFromWebhook: (...args: unknown[]) =>
    mockUpdateOutboundDeliveryFromWebhook(...args),
}));

vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: vi.fn(),
}));
vi.mock("../services/checkout/post-booking.js", () => ({
  runPostPaymentSideEffects: vi.fn(),
}));
vi.mock("../services/checkout/persist-order.js", () => ({
  applyOrderInventoryEffects: vi.fn(),
}));
vi.mock("../services/checkout/cancel-partner-items.js", () => ({
  cancelPartnerOrderItems: vi.fn(),
}));
vi.mock("../queues/email-helpers.js", () => ({
  enqueueNewBookingNotificationEmail: vi.fn(),
}));
vi.mock("../lib/crypto.js", () => ({
  decryptOrPassthrough: vi.fn((value: string | null | undefined) => value),
}));
vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn(),
}));
vi.mock("../services/checkout/order-referral-reversal.js", () => ({
  reverseProductOnlyOrderReferral: vi.fn(),
  reverseTripOrderReferrals: vi.fn(),
}));
vi.mock("../lib/reservation-payments.js", () => ({
  syncReservationPaymentStatus: vi.fn(),
  paymentExistsForGatewayTx: vi.fn(),
}));
vi.mock("../services/whatsapp-attendance.js", () => ({
  processEvolutionInbound: vi.fn(),
  processEvolutionDeliveryStatus: vi.fn(),
}));
vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn(),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import webhooksRouter from "../routes/webhooks.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const WEBHOOK_SECRET = "whsec_cmVzZW5kLXJvdXRlLXRlc3Qtc2VjcmV0";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function buildApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, rawBody) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = rawBody;
      },
    }),
  );
  app.use("/api", webhooksRouter);
  app.use(errorHandler);
  return app;
}

function makeSvixHeaders(
  rawBody: string,
  secret = WEBHOOK_SECRET,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const svixId = "msg_route_test";
  const svixTimestamp = timestamp.toString();
  const signed = `${svixId}.${svixTimestamp}.${rawBody}`;
  const signature = crypto
    .createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64"))
    .update(signed)
    .digest("base64");

  return {
    "svix-id": svixId,
    "svix-timestamp": svixTimestamp,
    "svix-signature": `v1,${signature}`,
  };
}

function makeEvent(type = "email.delivered", emailId = "resend-message-1", bounceType?: string) {
  return {
    type,
    data: {
      email_id: emailId,
      ...(bounceType ? { bounce: { type: bounceType } } : {}),
    },
  };
}

describe("Resend webhook route", () => {
  let savedWebhookSecret: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    savedWebhookSecret = process.env["RESEND_WEBHOOK_SECRET"];
    process.env["RESEND_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
  });

  afterEach(() => {
    if (savedWebhookSecret === undefined) {
      delete process.env["RESEND_WEBHOOK_SECRET"];
    } else {
      process.env["RESEND_WEBHOOK_SECRET"] = savedWebhookSecret;
    }
  });

  it("accepts a valid Svix callback and updates the delivery for the URL tenant", async () => {
    mockUpdateOutboundDeliveryFromWebhook.mockResolvedValue({
      updated: true,
      deliveryId: "delivery-1",
      messageId: "message-1",
    });
    const rawBody = JSON.stringify(makeEvent());

    const response = await request(buildApp())
      .post(`/api/webhooks/resend/${TENANT_A}`)
      .set(makeSvixHeaders(rawBody))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, outcome: "updated" });
    expect(mockUpdateOutboundDeliveryFromWebhook).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      provider: "resend",
      externalId: "resend-message-1",
      status: "accepted",
      providerStatus: "email.delivered",
      error: null,
    });
  });

  it.each(["email.bounced", "email.failed", "email.complained"] as const)(
    "forwards a valid Svix %s callback as a failed delivery",
    async (eventType) => {
      mockUpdateOutboundDeliveryFromWebhook.mockResolvedValue({
        updated: true,
        deliveryId: "delivery-1",
        messageId: "message-1",
      });
      const rawBody = JSON.stringify(makeEvent(eventType));

      const response = await request(buildApp())
        .post(`/api/webhooks/resend/${TENANT_A}`)
        .set(makeSvixHeaders(rawBody))
        .set("content-type", "application/json")
        .send(rawBody);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true, outcome: "updated" });
      expect(mockUpdateOutboundDeliveryFromWebhook).toHaveBeenCalledWith({
        tenantId: TENANT_A,
        provider: "resend",
        externalId: "resend-message-1",
        status: "failed",
        providerStatus: eventType,
        error: eventType,
      });
    },
  );

  it("forwards a validated permanent bounce classification without changing the failure cause", async () => {
    mockUpdateOutboundDeliveryFromWebhook.mockResolvedValue({
      updated: true,
      deliveryId: "delivery-1",
      messageId: "message-1",
    });
    const rawBody = JSON.stringify({
      type: "email.bounced",
      data: {
        email_id: "resend-message-1",
        bounce: { type: "Permanent", message: "Mailbox does not exist" },
      },
    });

    const response = await request(buildApp())
      .post(`/api/webhooks/resend/${TENANT_A}`)
      .set(makeSvixHeaders(rawBody))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(mockUpdateOutboundDeliveryFromWebhook).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      provider: "resend",
      externalId: "resend-message-1",
      status: "failed",
      providerStatus: "email.bounced",
      error: "email.bounced",
      bounceType: "permanent",
    });
  });

  it.each([
    ["hard", "permanent"],
    ["soft", "temporary"],
  ] as const)("normalizes the Resend %s bounce alias to %s", async (rawType, bounceType) => {
    mockUpdateOutboundDeliveryFromWebhook.mockResolvedValue({
      updated: true,
      deliveryId: "delivery-1",
      messageId: "message-1",
    });
    const rawBody = JSON.stringify(makeEvent("email.bounced", "resend-message-1", rawType));

    const response = await request(buildApp())
      .post(`/api/webhooks/resend/${TENANT_A}`)
      .set(makeSvixHeaders(rawBody))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(mockUpdateOutboundDeliveryFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ bounceType }),
    );
  });

  it("ignores an unknown bounce type while still processing the provider failure", async () => {
    mockUpdateOutboundDeliveryFromWebhook.mockResolvedValue({
      updated: true,
      deliveryId: "delivery-1",
      messageId: "message-1",
    });
    const rawBody = JSON.stringify(makeEvent("email.bounced", "resend-message-1", "delayed"));

    const response = await request(buildApp())
      .post(`/api/webhooks/resend/${TENANT_A}`)
      .set(makeSvixHeaders(rawBody))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(mockUpdateOutboundDeliveryFromWebhook).toHaveBeenCalledWith(
      expect.not.objectContaining({ bounceType: expect.anything() }),
    );
  });

  it("rejects a callback with no signature", async () => {
    const rawBody = JSON.stringify(makeEvent());

    const response = await request(buildApp())
      .post(`/api/webhooks/resend/${TENANT_A}`)
      .set("content-type", "application/json")
      .send(rawBody);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(mockUpdateOutboundDeliveryFromWebhook).not.toHaveBeenCalled();
  });

  it("rejects a callback with an invalid signature", async () => {
    const rawBody = JSON.stringify(makeEvent());

    const response = await request(buildApp())
      .post(`/api/webhooks/resend/${TENANT_A}`)
      .set({
        "svix-id": "msg_route_test",
        "svix-timestamp": Math.floor(Date.now() / 1000).toString(),
        "svix-signature": "v1,not-a-valid-signature",
        "content-type": "application/json",
      })
      .send(rawBody);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(mockUpdateOutboundDeliveryFromWebhook).not.toHaveBeenCalled();
  });

  it("rejects a correctly signed callback outside the five-minute tolerance", async () => {
    const rawBody = JSON.stringify(makeEvent());
    const oldTimestamp = Math.floor(Date.now() / 1000) - 5 * 60 - 1;

    const response = await request(buildApp())
      .post(`/api/webhooks/resend/${TENANT_A}`)
      .set(makeSvixHeaders(rawBody, WEBHOOK_SECRET, oldTimestamp))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(mockUpdateOutboundDeliveryFromWebhook).not.toHaveBeenCalled();
  });

  it("rejects a body changed after the signature was created", async () => {
    const signedBody = JSON.stringify(makeEvent());
    const alteredBody = JSON.stringify(makeEvent("email.bounced", "resend-message-1"));

    const response = await request(buildApp())
      .post(`/api/webhooks/resend/${TENANT_A}`)
      .set(makeSvixHeaders(signedBody))
      .set("content-type", "application/json")
      .send(alteredBody);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(mockUpdateOutboundDeliveryFromWebhook).not.toHaveBeenCalled();
  });

  it("keeps the tenant from the URL when a provider ID could belong to another tenant", async () => {
    mockUpdateOutboundDeliveryFromWebhook.mockResolvedValue({ updated: false });
    const rawBody = JSON.stringify(makeEvent());

    const response = await request(buildApp())
      .post(`/api/webhooks/resend/${TENANT_B}`)
      .set(makeSvixHeaders(rawBody))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, outcome: "not_found" });
    expect(mockUpdateOutboundDeliveryFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_B, externalId: "resend-message-1" }),
    );
    expect(mockUpdateOutboundDeliveryFromWebhook).not.toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
    );
  });

  it("acknowledges unknown events without changing delivery history", async () => {
    const rawBody = JSON.stringify(makeEvent("email.received"));

    const response = await request(buildApp())
      .post(`/api/webhooks/resend/${TENANT_A}`)
      .set(makeSvixHeaders(rawBody))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, outcome: "ignored" });
    expect(mockUpdateOutboundDeliveryFromWebhook).not.toHaveBeenCalled();
  });
});
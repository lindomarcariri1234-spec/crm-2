import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  chatbotConversationsTable: {},
  chatbotMessagesTable: {},
  tenantIntegrationsTable: {},
}));
vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "zernio-test-id") }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../services/instagram-zernio.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/instagram-zernio.js")>();
  return {
    ...actual,
    processZernioInstagramWebhook: vi.fn().mockResolvedValue(1),
  };
});

import instagramMessagingRouter from "../routes/instagram-messaging.js";
import * as zernioService from "../services/instagram-zernio.js";

const secret = "test-zernio-webhook-secret";
const event = {
  id: "evt_123",
  event: "message.received",
  message: {
    id: "msg_123",
    conversationId: "conv_123",
    platform: "instagram",
    direction: "incoming",
    text: "Olá",
    sender: { id: "customer_123" },
  },
  account: {
    id: "account_123",
    accountId: "account_123",
    profileId: "profile_123",
    platform: "instagram",
  },
  timestamp: "2026-10-11T12:00:00.000Z",
};

function signedRequest(payload: unknown, eventIdHeader?: string) {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
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
    .set("X-Zernio-Event-Id", eventIdHeader ?? String((payload as { id?: unknown }).id))
    .send(payload);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Zernio Instagram webhook", () => {
  it("parses only incoming Instagram messages and retains the provider identifiers", () => {
    expect(zernioService.parseZernioInstagramMessage(event)).toMatchObject({
      accountId: "account_123",
      profileId: "profile_123",
      conversationId: "conv_123",
      senderId: "customer_123",
      messageId: "msg_123",
      content: "Olá",
    });
    expect(zernioService.parseZernioInstagramMessage({
      ...event,
      message: { ...event.message, direction: "outgoing" },
    })).toBeNull();
    expect(zernioService.parseZernioInstagramMessage({
      ...event,
      message: { ...event.message, platform: "whatsapp" },
    })).toBeNull();
  });

  it("verifies the raw-body signature and processes a matching event", async () => {
    vi.stubEnv("ZERNIO_WEBHOOK_SECRET", secret);

    const response = await signedRequest(event);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, stored: 1 });
    expect(zernioService.processZernioInstagramWebhook).toHaveBeenCalledWith(event);
  });

  it("rejects an invalid signature without processing the event", async () => {
    vi.stubEnv("ZERNIO_WEBHOOK_SECRET", secret);
    const app = express();
    app.use(express.json({
      verify: (req, _res, buffer) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buffer;
      },
    }));
    app.use(instagramMessagingRouter);

    const response = await request(app)
      .post("/webhooks/zernio")
      .set("X-Zernio-Signature", "0".repeat(64))
      .send(event);

    expect(response.status).toBe(401);
    expect(zernioService.processZernioInstagramWebhook).not.toHaveBeenCalled();
  });

  it("rejects a mismatched event id header", async () => {
    vi.stubEnv("ZERNIO_WEBHOOK_SECRET", secret);
    const response = await signedRequest(event, "evt_other");

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_ZERNIO_EVENT_ID");
    expect(zernioService.processZernioInstagramWebhook).not.toHaveBeenCalled();
  });

  it("asks Zernio to retry if no webhook secret is configured", async () => {
    vi.stubEnv("ZERNIO_WEBHOOK_SECRET", "");
    const app = express();
    app.use(express.json());
    app.use(instagramMessagingRouter);

    const response = await request(app).post("/webhooks/zernio").send(event);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("ZERNIO_WEBHOOK_NOT_CONFIGURED");
  });
});

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
    sender: { id: "customer_123", username: "LindomarSantos.Cariri" },
  },
  account: {
    id: "account_123",
    accountId: "account_123",
    profileId: "profile_123",
    platform: "instagram",
  },
  timestamp: "2026-10-11T12:00:00.000Z",
};

function signedRequest(payload: object, eventIdHeader?: string) {
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
  vi.unstubAllGlobals();
});

describe("Zernio Instagram webhook", () => {
  it("paginates the linked account's active and archived conversations before import", async () => {
    const response = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        data: [{ id: "conversation-1", accountId: "account_123", platform: "instagram" }],
        pagination: { hasMore: true, nextCursor: "conversation-cursor" },
      }))
      .mockResolvedValueOnce(response({ messages: [], pagination: { hasMore: false } }))
      .mockResolvedValueOnce(response({
        data: [{ id: "conversation-2", accountId: "account_123", platform: "instagram" }],
        pagination: { hasMore: false },
      }))
      .mockResolvedValueOnce(response({ messages: [], pagination: { hasMore: false } }))
      .mockResolvedValueOnce(response({ data: [], pagination: { hasMore: false } }));
    vi.stubGlobal("fetch", fetchMock);
    const progress: unknown[] = [];

    const result = await zernioService.importZernioInstagramHistory(
      "secret-api-key",
      "account_123",
      "profile_123",
      "tenant-integration-id",
      (snapshot) => progress.push(snapshot),
    );

    expect(result).toMatchObject({ conversationsFound: 2, conversationsProcessed: 2 });
    expect(progress).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("status=active");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("profileId=profile_123");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("cursor=conversation-cursor");
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain("status=archived");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer secret-api-key" },
    });
  });

  it("returns a resumable cursor after a bounded chunk and finishes from that cursor", async () => {
    const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        data: [{ id: "conversation-1", accountId: "account_123", platform: "instagram" }],
        pagination: { hasMore: false },
      }))
      .mockResolvedValueOnce(response({
        messages: [],
        pagination: { hasMore: true, nextCursor: "message-cursor-2" },
      }))
      .mockResolvedValueOnce(response({ messages: [], pagination: { hasMore: false } }))
      .mockResolvedValueOnce(response({ data: [], pagination: { hasMore: false } }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await zernioService.importZernioInstagramHistoryChunk(
      "secret-api-key",
      "account_123",
      "profile_123",
      "tenant-integration-id",
    );
    expect(first.done).toBe(false);
    expect(first.cursor?.messageCursor).toBe("message-cursor-2");

    const resumed = await zernioService.importZernioInstagramHistoryChunk(
      "secret-api-key",
      "account_123",
      "profile_123",
      "tenant-integration-id",
      first.cursor,
    );
    expect(resumed.done).toBe(true);
    expect(resumed.progress.conversationsProcessed).toBe(1);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("cursor=message-cursor-2");
  });

  it("sends an inbox reply through Zernio with account, conversation, and idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { messageId: "zernio-message-123" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const messageId = await zernioService.sendZernioInstagramText(
      "secret-api-key",
      "account_123",
      "conversation_123",
      "Olá!",
      "c5d0e860-e98c-4f61-8a27-2678c64c54bc",
    );

    expect(messageId).toBe("zernio-message-123");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://zernio.com/api/v1/inbox/conversations/conversation_123/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-api-key",
          "Idempotency-Key": "c5d0e860-e98c-4f61-8a27-2678c64c54bc",
        }),
        body: JSON.stringify({ accountId: "account_123", message: "Olá!" }),
      }),
    );
  });

  it("parses only incoming Instagram messages and retains the provider identifiers", () => {
    expect(zernioService.parseZernioInstagramMessage(event)).toMatchObject({
      accountId: "account_123",
      profileId: "profile_123",
      conversationId: "conv_123",
      senderId: "customer_123",
      senderUsername: "lindomarsantos.cariri",
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

  it("normalizes only Instagram handle wrappers and case, without fuzzy punctuation matching", () => {
    expect(zernioService.normalizeInstagramUsername("@LindomarSantos.Cariri")).toBe("lindomarsantos.cariri");
    expect(zernioService.normalizeInstagramUsername("https://www.instagram.com/LindomarSantos.Cariri/"))
      .toBe("lindomarsantos.cariri");
    expect(zernioService.normalizeInstagramUsername("lindomarsantos_cariri")).toBe("lindomarsantos_cariri");
    expect(zernioService.normalizeInstagramUsername("lindomarsantos-cariri")).toBeNull();
    expect(zernioService.normalizeInstagramUsername("not a handle")).toBeNull();
  });

  it("only auto-associates one exact match and preserves manual choices", () => {
    expect(zernioService.resolveUniqueInstagramClientMatch(["client-1"], null, false)).toBe("client-1");
    expect(zernioService.resolveUniqueInstagramClientMatch(["client-1", "client-2"], null, false)).toBeNull();
    expect(zernioService.resolveUniqueInstagramClientMatch(["client-1"], "client-manual", false)).toBeNull();
    expect(zernioService.resolveUniqueInstagramClientMatch(["client-1"], null, true)).toBeNull();
  });

  it("keeps the handle optional when Zernio omits the sender username", () => {
    const parsed = zernioService.parseZernioInstagramMessage({
      ...event,
      message: { ...event.message, sender: { id: event.message.sender.id } },
    });
    expect(parsed?.senderUsername).toBeNull();
  });

  it("parses outgoing delivery and read status events without accepting inbound messages", () => {
    const deliveredEvent = {
      ...event,
      event: "message.delivered",
      statusAt: "2026-10-11T12:05:00.000Z",
      message: {
        ...event.message,
        direction: "outgoing",
      },
    };
    expect(zernioService.parseZernioInstagramMessageStatus(deliveredEvent)).toMatchObject({
      accountId: "account_123",
      profileId: "profile_123",
      conversationId: "conv_123",
      messageId: "msg_123",
      status: "delivered",
      statusAt: new Date("2026-10-11T12:05:00.000Z"),
    });
    expect(zernioService.parseZernioInstagramMessageStatus({
      ...deliveredEvent,
      event: "message.read",
    })).toMatchObject({ status: "read" });
    expect(zernioService.parseZernioInstagramMessageStatus(event)).toBeNull();
    expect(zernioService.parseZernioInstagramMessageStatus({
      ...deliveredEvent,
      statusAt: "not-a-date",
    })).toBeNull();
  });

  it("parses sent Instagram messages so later status events can find the stored provider id", () => {
    const sentEvent = {
      ...event,
      event: "message.sent",
      message: { ...event.message, direction: "outgoing" },
    };
    expect(zernioService.parseZernioInstagramSentMessage(sentEvent)).toMatchObject({
      accountId: "account_123",
      profileId: "profile_123",
      conversationId: "conv_123",
      messageId: "msg_123",
      content: "Olá",
      sentAt: new Date("2026-10-11T12:00:00.000Z"),
    });
    expect(zernioService.parseZernioInstagramSentMessage(event)).toBeNull();
  });

  it("verifies the raw-body signature and processes a matching event", async () => {
    vi.stubEnv("ZERNIO_WEBHOOK_SECRET", secret);

    const response = await signedRequest(event);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, stored: 1 });
    expect(zernioService.processZernioInstagramWebhook).toHaveBeenCalledWith(event);
  });

  it("accepts a signed read-status event and forwards it for processing", async () => {
    vi.stubEnv("ZERNIO_WEBHOOK_SECRET", secret);
    const readEvent = {
      ...event,
      event: "message.read",
      statusAt: "2026-10-11T12:05:00.000Z",
      message: { ...event.message, direction: "outgoing" },
    };

    const response = await signedRequest(readEvent);

    expect(response.status).toBe(200);
    expect(zernioService.processZernioInstagramWebhook).toHaveBeenCalledWith(readEvent);
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

import express from "express";
import pino from "pino";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  dbSelect: vi.fn(),
  generateSignedURL: vi.fn(),
  conversation: null as Record<string, unknown> | null,
  messages: [] as Record<string, unknown>[],
  eq: vi.fn((column: unknown, value: unknown) => ({ operator: "eq", column, value })),
  outboundRows: [] as Record<string, unknown>[],
  attempts: [] as Record<string, unknown>[],
  chatbotConversationsTable: {
    id: { table: "chatbot_conversations", column: "id" },
    tenantId: { table: "chatbot_conversations", column: "tenant_id" },
  },
  chatbotMessagesTable: {
    conversationId: { table: "chatbot_messages", column: "conversation_id" },
    tenantId: { table: "chatbot_messages", column: "tenant_id" },
    sentAt: { table: "chatbot_messages", column: "sent_at" },
  },
  outboundDeliveriesTable: {
    id: { table: "outbound_deliveries", column: "id" },
    tenantId: { table: "outbound_deliveries", column: "tenant_id" },
    outboundMessageId: { table: "outbound_deliveries", column: "outbound_message_id" },
    channel: { table: "outbound_deliveries", column: "channel" },
    content: { table: "outbound_deliveries", column: "content" },
    status: { table: "outbound_deliveries", column: "status" },
    attempts: { table: "outbound_deliveries", column: "attempts" },
    provider: { table: "outbound_deliveries", column: "provider" },
    externalId: { table: "outbound_deliveries", column: "external_id" },
    createdAt: { table: "outbound_deliveries", column: "created_at" },
    acceptedAt: { table: "outbound_deliveries", column: "accepted_at" },
  },
  outboundDeliveryAttemptsTable: {
    deliveryId: { table: "outbound_delivery_attempts", column: "delivery_id" },
    tenantId: { table: "outbound_delivery_attempts", column: "tenant_id" },
    attemptNumber: { table: "outbound_delivery_attempts", column: "attempt_number" },
    status: { table: "outbound_delivery_attempts", column: "status" },
    provider: { table: "outbound_delivery_attempts", column: "provider" },
    externalId: { table: "outbound_delivery_attempts", column: "external_id" },
    error: { table: "outbound_delivery_attempts", column: "error" },
    startedAt: { table: "outbound_delivery_attempts", column: "started_at" },
    completedAt: { table: "outbound_delivery_attempts", column: "completed_at" },
  },
  outboundMessagesTable: {
    id: { table: "outbound_messages", column: "id" },
    tenantId: { table: "outbound_messages", column: "tenant_id" },
    origin: { table: "outbound_messages", column: "origin" },
    metadata: { table: "outbound_messages", column: "metadata" },
    recipientType: { table: "outbound_messages", column: "recipient_type" },
    recipientId: { table: "outbound_messages", column: "recipient_id" },
  },
}));

vi.mock("@workspace/db", () => ({
  db: { select: mockState.dbSelect },
  chatbotConversationsTable: mockState.chatbotConversationsTable,
  chatbotMessagesTable: mockState.chatbotMessagesTable,
  outboundDeliveriesTable: mockState.outboundDeliveriesTable,
  outboundDeliveryAttemptsTable: mockState.outboundDeliveryAttemptsTable,
  outboundMessagesTable: mockState.outboundMessagesTable,
  clientsTable: {
    id: { table: "clients", column: "id" },
    tenantId: { table: "clients", column: "tenant_id" },
    name: { table: "clients", column: "name" },
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: (...conditions: unknown[]) => ({ operator: "and", conditions }),
    or: (...conditions: unknown[]) => ({ operator: "or", conditions }),
    eq: mockState.eq,
    inArray: (column: unknown, values: unknown[]) => ({ operator: "inArray", column, values }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ operator: "sql", strings, values }),
  };
});

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockState.requireAuth,
  ADMIN_ROLES: [],
  ALL_STAFF_ROLES: ["agency_admin"],
}));

vi.mock("../lib/uploadthing.js", () => ({
  extractVerifiedUploadThingKey: (url: string): string | null => {
    try {
      const parsedUrl = new URL(url);
      if (
        parsedUrl.hostname !== "utfs.io" ||
        !parsedUrl.pathname.startsWith("/f/")
      ) {
        return null;
      }
      return parsedUrl.pathname.slice("/f/".length) || null;
    } catch {
      return null;
    }
  },
  utapi: {
    generateSignedURL: mockState.generateSignedURL,
  },
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "chatbot-media-test-id"),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../services/whatsapp-attendance.js", () => ({
  deliverAttendanceReply: vi.fn(),
}));
vi.mock("../services/client-classification.js", () => ({
  recomputeClientClassification: vi.fn(),
  recordClientClassificationEvent: vi.fn(),
}));

import { errorHandler } from "../middlewares/errorHandler.js";
import { requireAuth } from "../lib/tenant.js";
import chatbotRouter from "../routes/chatbot.js";

const TENANT_ID = "tenant-media-links";
const CONVERSATION_ID = "whatsapp-media-conversation";
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function createQueryBuilder() {
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.limit.mockImplementation(async () =>
    mockState.conversation ? [mockState.conversation] : [],
  );
  builder.orderBy.mockImplementation(async () => mockState.messages);
  return builder;
}

function configureDatabaseRows(
  conversation: Record<string, unknown> | null,
  messages: Record<string, unknown>[],
) {
  mockState.conversation = conversation;
  mockState.messages = messages;

  const conversationQuery = createQueryBuilder();
  const messagesQuery = createQueryBuilder();
  mockState.dbSelect.mockReset();
  mockState.dbSelect
    .mockImplementationOnce(() => conversationQuery)
    .mockImplementationOnce(() => messagesQuery);

  return { conversationQuery, messagesQuery };
}

function makeMessage(
  id: string,
  sentAt: Date,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    conversationId: CONVERSATION_ID,
    tenantId: TENANT_ID,
    role: "user",
    content: `message-${id}`,
    mediaUrl: `https://utfs.io/f/${id}`,
    mediaMimeType: "audio/ogg",
    mediaFileName: `${id}.ogg`,
    mediaExpiredAt: null,
    sentAt,
    ...overrides,
  };
}

function buildApp() {
  const app = express();
  app.use((req: express.Request & { log?: pino.Logger }, _res, next) => {
    req.log = pino({ level: "silent" });
    next();
  });
  app.use("/api", chatbotRouter);
  app.use(errorHandler);
  return app;
}

const requireAuthMock = vi.mocked(requireAuth);

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({
    id: "staff-media-user",
    tenantId: TENANT_ID,
    role: "agency_admin",
  } as never);
  mockState.generateSignedURL.mockImplementation(
    async (key: string, options: { expiresIn: number }) => ({
      ufsUrl: `https://signed.example/${key}?ttl=${options.expiresIn}`,
    }),
  );
});

describe("GET /chatbot-conversations/:id/messages media links", () => {
  it("returns safe explanations for terminal delivery failures without exposing provider details", async () => {
    const sentAt = new Date();
    const messages = [
      makeMessage("invalid-phone", sentAt, {
        role: "assistant",
        deliveryStatus: "failed",
        lastDeliveryError: "whatsapp_invalid_phone",
        mediaUrl: null,
        mediaMimeType: null,
        mediaFileName: null,
      }),
      makeMessage("connection", sentAt, {
        role: "assistant",
        deliveryStatus: "failed",
        lastDeliveryError: "evolution_401",
        mediaUrl: null,
        mediaMimeType: null,
        mediaFileName: null,
      }),
      makeMessage("opted-out", sentAt, {
        role: "assistant",
        deliveryStatus: "cancelled",
        lastDeliveryError: "contact_opted_out",
        mediaUrl: null,
        mediaMimeType: null,
        mediaFileName: null,
      }),
      makeMessage("unknown-provider-error", sentAt, {
        role: "assistant",
        deliveryStatus: "failed",
        lastDeliveryError: "Authorization: Bearer private-provider-response",
        mediaUrl: null,
        mediaMimeType: null,
        mediaFileName: null,
      }),
      makeMessage("pending-error", sentAt, {
        role: "assistant",
        deliveryStatus: "pending",
        lastDeliveryError: "raw transient provider detail",
        mediaUrl: null,
        mediaMimeType: null,
        mediaFileName: null,
      }),
    ];
    configureDatabaseRows(
      { id: CONVERSATION_ID, tenantId: TENANT_ID, channel: "whatsapp" },
      messages,
    );

    const response = await request(buildApp()).get(
      `/api/chatbot-conversations/${CONVERSATION_ID}/messages`,
    );

    expect(response.status).toBe(200);
    expect(response.body.find((message: { id: string }) => message.id === "invalid-phone"))
      .toMatchObject({ deliveryIssue: expect.stringContaining("Número de WhatsApp inválido") });
    expect(response.body.find((message: { id: string }) => message.id === "connection"))
      .toMatchObject({ deliveryIssue: expect.stringContaining("Revise a integração") });
    expect(response.body.find((message: { id: string }) => message.id === "opted-out"))
      .toMatchObject({ deliveryIssue: expect.stringContaining("não autorizou contato") });
    expect(response.body.find((message: { id: string }) => message.id === "unknown-provider-error"))
      .toMatchObject({ deliveryIssue: expect.stringContaining("não aceitou a mensagem") });
    expect(response.body.find((message: { id: string }) => message.id === "pending-error"))
      .toMatchObject({ deliveryIssue: null, deliveryStatus: "pending" });
    expect(response.body.every((message: Record<string, unknown>) => !("lastDeliveryError" in message))).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("private-provider-response");
    expect(JSON.stringify(response.body)).not.toContain("raw transient provider detail");
  });

  it("caps inbound WhatsApp links at the 90-day cutoff and returns expired media without a URL", async () => {
    const now = Date.now();
    const nearCutoffMessage = makeMessage(
      "near-cutoff",
      new Date(now - RETENTION_MS + 2 * 60 * 1000),
    );
    const expiredMessage = makeMessage(
      "past-cutoff",
      new Date(now - RETENTION_MS - 60 * 1000),
    );
    const cutoffMessage = makeMessage(
      "at-cutoff",
      new Date(now - RETENTION_MS),
    );
    const oldTextOnlyMessage = makeMessage(
      "old-text-only",
      new Date(now - RETENTION_MS - 60 * 1000),
      { mediaUrl: null, mediaMimeType: null, mediaFileName: null },
    );
    const { conversationQuery, messagesQuery } = configureDatabaseRows(
      { id: CONVERSATION_ID, tenantId: TENANT_ID, channel: "whatsapp" },
      [nearCutoffMessage, expiredMessage, cutoffMessage, oldTextOnlyMessage],
    );

    const response = await request(buildApp()).get(
      `/api/chatbot-conversations/${CONVERSATION_ID}/messages`,
    );

    expect(response.status).toBe(200);
    const nearCutoff = response.body.find(
      (message: { id: string }) => message.id === "near-cutoff",
    );
    const expired = response.body.find(
      (message: { id: string }) => message.id === "past-cutoff",
    );
    const atCutoff = response.body.find(
      (message: { id: string }) => message.id === "at-cutoff",
    );
    const oldTextOnly = response.body.find(
      (message: { id: string }) => message.id === "old-text-only",
    );
    expect(nearCutoff.mediaUrl).toContain("https://signed.example/near-cutoff");
    expect(nearCutoff.mediaExpiresAt).toBe(
      new Date(nearCutoffMessage.sentAt.getTime() + RETENTION_MS).toISOString(),
    );
    expect(expired).toMatchObject({
      content: "message-past-cutoff",
      mediaUrl: null,
      mediaMimeType: "audio/ogg",
      mediaFileName: "past-cutoff.ogg",
      mediaExpiredAt: new Date(
        expiredMessage.sentAt.getTime() + RETENTION_MS,
      ).toISOString(),
      mediaExpiresAt: new Date(
        expiredMessage.sentAt.getTime() + RETENTION_MS,
      ).toISOString(),
    });
    expect(atCutoff).toMatchObject({
      mediaUrl: null,
      mediaExpiredAt: new Date(
        cutoffMessage.sentAt.getTime() + RETENTION_MS,
      ).toISOString(),
    });
    expect(oldTextOnly).toMatchObject({
      mediaUrl: null,
      mediaMimeType: null,
      mediaFileName: null,
      mediaExpiredAt: null,
    });

    expect(mockState.generateSignedURL).toHaveBeenCalledTimes(1);
    const [signedKey, signOptions] = mockState.generateSignedURL.mock
      .calls[0] as [string, { expiresIn: number }];
    expect(signedKey).toBe("near-cutoff");
    expect(signOptions.expiresIn).toBeGreaterThan(0);
    expect(signOptions.expiresIn).toBeLessThanOrEqual(120);

    expect(conversationQuery.where).toHaveBeenCalledWith({
      operator: "and",
      conditions: [
        {
          operator: "eq",
          column: mockState.chatbotConversationsTable.id,
          value: CONVERSATION_ID,
        },
        {
          operator: "eq",
          column: mockState.chatbotConversationsTable.tenantId,
          value: TENANT_ID,
        },
      ],
    });
    expect(messagesQuery.where).toHaveBeenCalledWith({
      operator: "and",
      conditions: [
        {
          operator: "eq",
          column: mockState.chatbotMessagesTable.conversationId,
          value: CONVERSATION_ID,
        },
        {
          operator: "eq",
          column: mockState.chatbotMessagesTable.tenantId,
          value: TENANT_ID,
        },
      ],
    });
  });

  it("keeps the one-hour signed-link lifetime for outbound WhatsApp and non-WhatsApp messages", async () => {
    const oldSentAt = new Date(Date.now() - RETENTION_MS - 60 * 1000);
    configureDatabaseRows(
      { id: CONVERSATION_ID, tenantId: TENANT_ID, channel: "whatsapp" },
      [makeMessage("outbound-old", oldSentAt, { role: "assistant" })],
    );

    const outboundResponse = await request(buildApp()).get(
      `/api/chatbot-conversations/${CONVERSATION_ID}/messages`,
    );
    expect(outboundResponse.status).toBe(200);
    expect(mockState.generateSignedURL).toHaveBeenLastCalledWith(
      "outbound-old",
      {
        expiresIn: 60 * 60,
      },
    );

    mockState.generateSignedURL.mockClear();
    configureDatabaseRows(
      { id: CONVERSATION_ID, tenantId: TENANT_ID, channel: "webchat" },
      [makeMessage("webchat-old", oldSentAt)],
    );

    const webchatResponse = await request(buildApp()).get(
      `/api/chatbot-conversations/${CONVERSATION_ID}/messages`,
    );
    expect(webchatResponse.status).toBe(200);
    expect(mockState.generateSignedURL).toHaveBeenCalledTimes(1);
    expect(mockState.generateSignedURL).toHaveBeenCalledWith("webchat-old", {
      expiresIn: 60 * 60,
    });
  });

  it("does not sign files for a conversation outside the authenticated tenant", async () => {
    const { conversationQuery, messagesQuery } = configureDatabaseRows(null, [
      makeMessage("foreign-tenant-file", new Date()),
    ]);

    const response = await request(buildApp()).get(
      "/api/chatbot-conversations/foreign-whatsapp-conversation/messages",
    );

    expect(response.status).toBe(404);
    expect(conversationQuery.where).toHaveBeenCalledWith({
      operator: "and",
      conditions: [
        {
          operator: "eq",
          column: mockState.chatbotConversationsTable.id,
          value: "foreign-whatsapp-conversation",
        },
        {
          operator: "eq",
          column: mockState.chatbotConversationsTable.tenantId,
          value: TENANT_ID,
        },
      ],
    });
    expect(messagesQuery.orderBy).not.toHaveBeenCalled();
    expect(mockState.generateSignedURL).not.toHaveBeenCalled();
  });

  it("projects inbound and outbound entries together without duplicating linked messages or exposing raw errors", async () => {
    const sentAt = new Date("2026-10-15T12:00:00.000Z");
    const conversation = {
      id: CONVERSATION_ID,
      tenantId: TENANT_ID,
      clientId: "client-a",
      channel: "instagram",
    };
    const messages = [
      makeMessage("inbound-a", sentAt, { mediaUrl: null }),
      makeMessage("reply-a", new Date(sentAt.getTime() + 1000), {
        role: "assistant",
        deliveryStatus: "unknown",
        lastDeliveryError: "raw provider failure",
      }),
    ];
    const delivery = {
      id: "delivery-a",
      outboundMessageId: "outbound-a",
      channel: "instagram",
      content: "Resposta enviada",
      status: "unknown",
      attempts: 2,
      provider: "zernio",
      externalId: "provider-message-a",
      createdAt: sentAt,
      acceptedAt: null,
      origin: "instagram-attendance",
      metadata: { conversationId: CONVERSATION_ID, chatbotMessageId: "reply-a" },
    };
    const acceptedDelivery = {
      ...delivery,
      id: "delivery-accepted",
      outboundMessageId: "outbound-accepted",
      channel: "whatsapp",
      content: "Confirmação enviada",
      status: "accepted",
      attempts: 1,
      provider: "evolution",
      externalId: "provider-message-accepted",
      acceptedAt: new Date(sentAt.getTime() + 2000),
      origin: "whatsapp-attendance",
      metadata: { conversationId: CONVERSATION_ID },
    };
    const attempt = {
      deliveryId: "delivery-a",
      attemptNumber: 2,
      status: "unknown",
      provider: "zernio",
      externalId: "provider-message-a",
      error: "provider secret detail",
      startedAt: sentAt,
      completedAt: sentAt,
    };
    mockState.conversation = conversation;
    mockState.messages = messages;
    const makeBuilder = (result: unknown[], finalMethod: "limit" | "orderBy") => {
      const builder: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const method of ["from", "where", "innerJoin", "limit", "orderBy"]) {
        builder[method] = vi.fn().mockReturnValue(builder);
      }
      builder[finalMethod]!.mockResolvedValue(result);
      return builder;
    };
    const conversationQuery = makeBuilder([conversation], "limit");
    const messagesQuery = makeBuilder(messages, "orderBy");
    const outboundQuery = makeBuilder([delivery, acceptedDelivery], "orderBy");
    const attemptsQuery = makeBuilder([attempt], "orderBy");
    mockState.dbSelect.mockReset()
      .mockImplementationOnce(() => conversationQuery)
      .mockImplementationOnce(() => messagesQuery)
      .mockImplementationOnce(() => outboundQuery)
      .mockImplementationOnce(() => attemptsQuery);

    const response = await request(buildApp())
      .get(`/api/chatbot-conversations/${CONVERSATION_ID}/timeline`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(3);
    expect(response.body[0]).toMatchObject({ id: "inbound-a", direction: "inbound" });
    expect(response.body[1]).toMatchObject({
      id: "reply-a",
      direction: "outbound",
      deliveryStatus: "unknown",
      origin: "instagram-attendance",
      channel: "instagram",
      provider: "zernio",
      externalId: "provider-message-a",
      deliveryAttempts: 2,
      deliveryHistory: [{
        attemptNumber: 2,
        status: "unknown",
        error: "provider_error",
      }],
    });
    expect(response.body[2]).toMatchObject({
      id: "delivery:delivery-accepted",
      direction: "outbound",
      deliveryStatus: "sent",
      channel: "whatsapp",
      provider: "evolution",
      origin: "whatsapp-attendance",
      deliveryAttempts: 1,
    });
    expect(JSON.stringify(response.body)).not.toContain("provider secret detail");
    expect(JSON.stringify(response.body)).not.toContain("raw provider failure");
    expect(mockState.eq).toHaveBeenCalledWith(mockState.chatbotConversationsTable.tenantId, TENANT_ID);
    expect(mockState.eq).toHaveBeenCalledWith(mockState.outboundDeliveriesTable.tenantId, TENANT_ID);
    expect(mockState.eq).toHaveBeenCalledWith(mockState.outboundDeliveryAttemptsTable.tenantId, TENANT_ID);
  });

  it("returns not found for a conversation outside the authenticated tenant before reading either history table", async () => {
    const conversationQuery = createQueryBuilder();
    conversationQuery.limit.mockResolvedValue([]);
    mockState.dbSelect.mockReset().mockImplementationOnce(() => conversationQuery);

    const response = await request(buildApp())
      .get(`/api/chatbot-conversations/${CONVERSATION_ID}/timeline`);

    expect(response.status).toBe(404);
    expect(conversationQuery.where).toHaveBeenCalledWith(expect.objectContaining({
      operator: "and",
      conditions: expect.arrayContaining([
        expect.objectContaining({ column: mockState.chatbotConversationsTable.tenantId, value: TENANT_ID }),
      ]),
    }));
    expect(mockState.dbSelect).toHaveBeenCalledTimes(1);
  });
});

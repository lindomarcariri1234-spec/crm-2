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
  chatbotConversationsTable: {
    id: { table: "chatbot_conversations", column: "id" },
    tenantId: { table: "chatbot_conversations", column: "tenant_id" },
  },
  chatbotMessagesTable: {
    conversationId: { table: "chatbot_messages", column: "conversation_id" },
    tenantId: { table: "chatbot_messages", column: "tenant_id" },
    sentAt: { table: "chatbot_messages", column: "sent_at" },
  },
}));

vi.mock("@workspace/db", () => ({
  db: { select: mockState.dbSelect },
  chatbotConversationsTable: mockState.chatbotConversationsTable,
  chatbotMessagesTable: mockState.chatbotMessagesTable,
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
    eq: (column: unknown, value: unknown) => ({
      operator: "eq",
      column,
      value,
    }),
  };
});

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockState.requireAuth,
  ADMIN_ROLES: [],
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
    expect(expired).toMatchObject({
      content: "message-past-cutoff",
      mediaUrl: null,
      mediaMimeType: "audio/ogg",
      mediaFileName: "past-cutoff.ogg",
      mediaExpiredAt: new Date(
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
});

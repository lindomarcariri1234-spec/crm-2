import express from "express";
import pino from "pino";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  dbSelect: vi.fn(),
  dbInsert: vi.fn(),
  dbUpdate: vi.fn(),
  getInstagramMetaConfig: vi.fn(),
  isInstagramReplyWindowOpen: vi.fn<
    (lastInboundAt: Date | null, nowMs?: number) => boolean
  >(),
  readInstagramAccessToken: vi.fn(),
  sendInstagramText: vi.fn(),
  chatbotConversationsTable: {
    id: { table: "chatbot_conversations", column: "id" },
    tenantId: { table: "chatbot_conversations", column: "tenant_id" },
    clientId: { table: "chatbot_conversations", column: "client_id" },
    channel: { table: "chatbot_conversations", column: "channel" },
    sessionId: { table: "chatbot_conversations", column: "session_id" },
    status: { table: "chatbot_conversations", column: "status" },
    metadata: { table: "chatbot_conversations", column: "metadata" },
    assignedUserId: { table: "chatbot_conversations", column: "assigned_user_id" },
  },
  chatbotMessagesTable: {
    id: { table: "chatbot_messages", column: "id" },
    conversationId: { table: "chatbot_messages", column: "conversation_id" },
    tenantId: { table: "chatbot_messages", column: "tenant_id" },
    role: { table: "chatbot_messages", column: "role" },
    sentAt: { table: "chatbot_messages", column: "sent_at" },
    sourceMessageId: { table: "chatbot_messages", column: "source_message_id" },
    content: { table: "chatbot_messages", column: "content" },
    isBot: { table: "chatbot_messages", column: "is_bot" },
    deliveryStatus: { table: "chatbot_messages", column: "delivery_status" },
    deliveryAttempts: { table: "chatbot_messages", column: "delivery_attempts" },
    deliveryUpdatedAt: { table: "chatbot_messages", column: "delivery_updated_at" },
    lastDeliveryError: { table: "chatbot_messages", column: "last_delivery_error" },
  },
  clientsTable: {
    id: { table: "clients", column: "id" },
    tenantId: { table: "clients", column: "tenant_id" },
    whatsappOptIn: { table: "clients", column: "whatsapp_opt_in" },
  },
  tenantIntegrationsTable: {
    id: { table: "tenant_integrations", column: "id" },
    tenantId: { table: "tenant_integrations", column: "tenant_id" },
    type: { table: "tenant_integrations", column: "type" },
    enabled: { table: "tenant_integrations", column: "enabled" },
    status: { table: "tenant_integrations", column: "status" },
    config: { table: "tenant_integrations", column: "config" },
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockState.dbSelect,
    insert: mockState.dbInsert,
    update: mockState.dbUpdate,
  },
  chatbotConversationsTable: mockState.chatbotConversationsTable,
  chatbotMessagesTable: mockState.chatbotMessagesTable,
  clientsTable: mockState.clientsTable,
  tenantIntegrationsTable: mockState.tenantIntegrationsTable,
  usersTable: {},
  supportTicketsTable: {},
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: (...conditions: unknown[]) => ({ operator: "and", conditions }),
    desc: (column: unknown) => ({ operator: "desc", column }),
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

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "instagram-staff-reply-id"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/uploadthing.js", () => ({
  extractVerifiedUploadThingKey: vi.fn(),
  utapi: { generateSignedURL: vi.fn() },
}));

vi.mock("../services/whatsapp-attendance.js", () => ({
  deliverAttendanceReply: vi.fn(),
}));

vi.mock("../services/client-classification.js", () => ({
  recomputeClientClassification: vi.fn(),
  recordClientClassificationEvent: vi.fn(),
}));

vi.mock("../services/support-ticketing.js", () => ({
  ensureSupportTicketForConversation: vi.fn(),
  recordSupportTicketEvent: vi.fn(),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSupportTicketUpdate: vi.fn(),
}));

vi.mock("../services/instagram-messaging", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/instagram-messaging")>();
  mockState.isInstagramReplyWindowOpen.mockImplementation(
    actual.isInstagramReplyWindowOpen,
  );
  return {
    ...actual,
    getInstagramMetaConfig: mockState.getInstagramMetaConfig,
    isInstagramReplyWindowOpen: mockState.isInstagramReplyWindowOpen,
    readInstagramAccessToken: mockState.readInstagramAccessToken,
    sendInstagramText: mockState.sendInstagramText,
  };
});

import { errorHandler } from "../middlewares/errorHandler.js";
import { requireAuth } from "../lib/tenant.js";
import chatbotRouter from "../routes/chatbot.js";

const TENANT_ID = "tenant-instagram-reply-test";
const STAFF_ID = "staff-instagram-reply-test";
const CONVERSATION_ID = "instagram-conversation-test";
const INTEGRATION_ID = "instagram-integration-test";
const CUSTOMER_INSTAGRAM_ID = "customer-instagram-test";
const AGENCY_INSTAGRAM_ID = "agency-instagram-test";
const NOW = new Date("2026-10-06T12:00:00.000Z").getTime();
const REPLY_BODY = {
  content: "Obrigado por entrar em contato. Vamos ajudar você.",
  idempotencyKey: "c5d0e860-e98c-4f61-8a27-2678c64c54bc",
};

function createSelectQueryBuilder(rows: unknown[]) {
  const builder = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  builder.from.mockReturnValue(builder);
  builder.leftJoin.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.limit.mockResolvedValue(rows);
  return builder;
}

function configureSelectResults(...rows: unknown[][]) {
  const builders = rows.map(createSelectQueryBuilder);
  const pendingBuilders = [...builders];
  mockState.dbSelect.mockReset();
  mockState.dbSelect.mockImplementation(() => {
    const next = pendingBuilders.shift();
    if (!next) throw new Error("Unexpected database select in Instagram reply test");
    return next;
  });
  return builders;
}

function makeConversation() {
  return {
    id: CONVERSATION_ID,
    tenantId: TENANT_ID,
    clientId: null,
    channel: "instagram",
    sessionId: CUSTOMER_INSTAGRAM_ID,
    status: "open",
    metadata: { instagramIntegrationId: INTEGRATION_ID },
    clientWhatsappOptIn: null,
  };
}

function makeIntegration() {
  return {
    id: INTEGRATION_ID,
    tenantId: TENANT_ID,
    type: "instagram_messaging",
    enabled: true,
    status: "connected",
    config: { instagramUserId: AGENCY_INSTAGRAM_ID },
    secretsEncrypted: "encrypted-test-token",
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  requireAuthMock.mockResolvedValue({
    id: STAFF_ID,
    tenantId: TENANT_ID,
    role: "agency_admin",
  } as never);
  mockState.getInstagramMetaConfig.mockReturnValue({ appConfigured: true });
  mockState.readInstagramAccessToken.mockReturnValue("test-access-token");
  mockState.sendInstagramText.mockResolvedValue(undefined);

  const insertBuilder = {
    values: vi.fn(),
    onConflictDoNothing: vi.fn(),
    returning: vi.fn().mockResolvedValue([{ id: "instagram-staff-reply-id" }]),
  };
  insertBuilder.values.mockReturnValue(insertBuilder);
  insertBuilder.onConflictDoNothing.mockReturnValue(insertBuilder);
  mockState.dbInsert.mockReset().mockReturnValue(insertBuilder);

  mockState.dbUpdate.mockReset().mockImplementation(() => {
    const builder = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue([]),
    };
    builder.set.mockReturnValue(builder);
    return builder;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /chatbot-conversations/:id/reply for Instagram", () => {
  it("blocks an expired persisted inbound message before inserting or sending", async () => {
    const lastInboundAt = new Date(NOW - 24 * 60 * 60 * 1000);
    const [conversationQuery, integrationQuery, inboundQuery] =
      configureSelectResults(
        [makeConversation()],
        [makeIntegration()],
        [{ sentAt: lastInboundAt }],
      );

    const response = await request(buildApp())
      .post(`/api/chatbot-conversations/${CONVERSATION_ID}/reply`)
      .send(REPLY_BODY);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: "INSTAGRAM_REPLY_WINDOW_EXPIRED",
    });
    expect(mockState.isInstagramReplyWindowOpen).toHaveBeenCalledWith(
      lastInboundAt,
    );
    expect(inboundQuery.where).toHaveBeenCalledWith({
      operator: "and",
      conditions: [
        {
          operator: "eq",
          column: mockState.chatbotMessagesTable.tenantId,
          value: TENANT_ID,
        },
        {
          operator: "eq",
          column: mockState.chatbotMessagesTable.conversationId,
          value: CONVERSATION_ID,
        },
        {
          operator: "eq",
          column: mockState.chatbotMessagesTable.role,
          value: "user",
        },
      ],
    });
    expect(inboundQuery.orderBy).toHaveBeenCalledWith(
      { operator: "desc", column: mockState.chatbotMessagesTable.sentAt },
      { operator: "desc", column: mockState.chatbotMessagesTable.id },
    );
    expect(conversationQuery.limit).toHaveBeenCalledWith(1);
    expect(integrationQuery.limit).toHaveBeenCalledWith(1);
    expect(inboundQuery.limit).toHaveBeenCalledWith(1);
    expect(mockState.dbInsert).not.toHaveBeenCalled();
    expect(mockState.sendInstagramText).not.toHaveBeenCalled();
    expect(mockState.dbUpdate).not.toHaveBeenCalled();
  });

  it("sends and records a reply when the persisted inbound timestamp is recent", async () => {
    const lastInboundAt = new Date(NOW - 30 * 60 * 1000);
    const savedMessage = {
      id: "instagram-staff-reply-id",
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      role: "assistant",
      content: REPLY_BODY.content,
      deliveryStatus: "sent",
      deliveryAttempts: 1,
    };
    const [
      conversationQuery,
      integrationQuery,
      inboundQuery,
      savedMessageQuery,
    ] = configureSelectResults(
      [makeConversation()],
      [makeIntegration()],
      [{ sentAt: lastInboundAt }],
      [savedMessage],
    );
    const updateWrites: Array<Record<string, unknown>> = [];
    mockState.dbUpdate.mockImplementation(() => {
      const builder = {
        set: vi.fn((values: Record<string, unknown>) => {
          updateWrites.push(values);
          return builder;
        }),
        where: vi.fn().mockResolvedValue([]),
      };
      return builder;
    });

    const response = await request(buildApp())
      .post(`/api/chatbot-conversations/${CONVERSATION_ID}/reply`)
      .send(REPLY_BODY);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: "instagram-staff-reply-id",
      deliveryStatus: "sent",
      deliveryAttempts: 1,
    });
    expect(mockState.isInstagramReplyWindowOpen).toHaveBeenCalledWith(
      lastInboundAt,
    );
    expect(mockState.sendInstagramText).toHaveBeenCalledWith(
      { appConfigured: true },
      "test-access-token",
      AGENCY_INSTAGRAM_ID,
      CUSTOMER_INSTAGRAM_ID,
      REPLY_BODY.content,
    );
    expect(mockState.dbInsert).toHaveBeenCalledTimes(1);
    const insertBuilder = mockState.dbInsert.mock.results[0]?.value as {
      values: ReturnType<typeof vi.fn>;
    };
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        conversationId: CONVERSATION_ID,
        sourceMessageId: `instagram:staff:${REPLY_BODY.idempotencyKey}`,
        role: "assistant",
        content: REPLY_BODY.content,
        deliveryStatus: "pending",
      }),
    );
    expect(updateWrites).toHaveLength(2);
    expect(updateWrites[0]).toMatchObject({
      deliveryStatus: "sent",
      deliveryAttempts: 1,
      lastDeliveryError: null,
    });
    expect(updateWrites[0]?.deliveryUpdatedAt).toBeInstanceOf(Date);
    expect(updateWrites[1]).toMatchObject({
      status: "human_handoff",
      assignedUserId: STAFF_ID,
    });
    expect(conversationQuery.limit).toHaveBeenCalledWith(1);
    expect(integrationQuery.limit).toHaveBeenCalledWith(1);
    expect(inboundQuery.limit).toHaveBeenCalledWith(1);
    expect(savedMessageQuery.limit).toHaveBeenCalledWith(1);
  });
});

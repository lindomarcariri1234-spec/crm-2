import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbSelect,
  mockDbTransaction,
  mockDbUpdate,
  mockStoreEvolutionInboundMedia,
  mockGetAIClientForTenant,
  mockExtractEvolutionInboundMedia,
  mockConsentState,
  mockTxUpdateSets,
  mockInsertedMessages,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockStoreEvolutionInboundMedia: vi.fn(),
  mockGetAIClientForTenant: vi.fn(),
  mockExtractEvolutionInboundMedia: vi.fn(),
  mockConsentState: { clientOptIn: true, conversationStatus: "open" },
  mockTxUpdateSets: [] as Record<string, unknown>[],
  mockInsertedMessages: [] as Record<string, unknown>[],
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    transaction: mockDbTransaction,
    update: mockDbUpdate,
    insert: vi.fn(),
  },
  chatbotConversationsTable: {
    id: "chatbot_conversations.id",
    tenantId: "chatbot_conversations.tenant_id",
    channel: "chatbot_conversations.channel",
    sessionId: "chatbot_conversations.session_id",
    createdAt: "chatbot_conversations.created_at",
    clientId: "chatbot_conversations.client_id",
    metadata: "chatbot_conversations.metadata",
    status: "chatbot_conversations.status",
  },
  chatbotMessagesTable: {
    id: "chatbot_messages.id",
    tenantId: "chatbot_messages.tenant_id",
    conversationId: "chatbot_messages.conversation_id",
    sourceMessageId: "chatbot_messages.source_message_id",
    sentAt: "chatbot_messages.sent_at",
    role: "chatbot_messages.role",
    content: "chatbot_messages.content",
    mediaUrl: "chatbot_messages.media_url",
    mediaMimeType: "chatbot_messages.media_mime_type",
    mediaFileName: "chatbot_messages.media_file_name",
    isBot: "chatbot_messages.is_bot",
    deliveryStatus: "chatbot_messages.delivery_status",
    deliveryAttempts: "chatbot_messages.delivery_attempts",
  },
  clientsTable: {
    id: "clients.id",
    tenantId: "clients.tenant_id",
    whatsapp: "clients.whatsapp",
    phone: "clients.phone",
    whatsappOptIn: "clients.whatsapp_opt_in",
    name: "clients.name",
    email: "clients.email",
    classification: "clients.classification",
    origin: "clients.origin",
    createdById: "clients.created_by_id",
  },
  tenantIntegrationsTable: {
    type: "tenant_integrations.type",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  desc: vi.fn((column: unknown) => ({ desc: column })),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  isNull: vi.fn((column: unknown) => ({ isNull: column })),
  lt: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions })),
  sql: vi.fn(() => "sql"),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptOrPassthrough: vi.fn((value: string | null | undefined) => value),
}));
vi.mock("../lib/ai-client.js", () => ({
  getAIClientForTenant: mockGetAIClientForTenant,
  sanitizeProviderError: vi.fn(() => "provider error"),
}));
vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "generated-id"),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/uploadthing.js", () => ({
  deleteOrphanedFile: vi.fn(),
}));
vi.mock("./outbound-delivery.js", () => ({
  dispatchOutboundMessage: vi.fn(),
  updateOutboundDeliveryFromWebhook: vi.fn(),
}));
vi.mock("./client-classification.js", () => ({
  recomputeClientClassification: vi.fn(),
  recordClientClassificationEvent: vi.fn(),
}));
vi.mock("./whatsapp-media.js", () => ({
  extractEvolutionInboundMedia: mockExtractEvolutionInboundMedia,
  storeEvolutionInboundMedia: mockStoreEvolutionInboundMedia,
  unwrapEvolutionMessage: vi.fn((message: unknown) => message),
}));

import { processEvolutionInbound } from "./whatsapp-attendance.js";

function makeQuery<T>(result: T) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query["from"] = vi.fn(() => query);
  query["where"] = vi.fn(() => query);
  query["orderBy"] = vi.fn(() => query);
  query["limit"] = vi.fn(async () => result);
  return query;
}

function makeWhereQuery<T>(result: T) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query["from"] = vi.fn(() => query);
  query["where"] = vi.fn(async () => result);
  return query;
}

describe("Evolution inbound attendance consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsentState.clientOptIn = true;
    mockConsentState.conversationStatus = "open";
    mockTxUpdateSets.length = 0;
    mockInsertedMessages.length = 0;
    mockDbUpdate.mockReset();
    mockStoreEvolutionInboundMedia.mockReset();
    mockGetAIClientForTenant.mockReset();

    const integration = {
      tenantId: "tenant-1",
      enabled: true,
      config: { instanceName: "agency-instance", baseUrl: "https://evolution.example" },
      secretsEncrypted: JSON.stringify({ apiKey: "integration-api-key" }),
    };
    const client = {
      id: "client-1",
      tenantId: "tenant-1",
      whatsapp: "5511999999999",
      phone: "5511999999999",
      whatsappOptIn: mockConsentState.clientOptIn,
    };
    Object.defineProperty(client, "whatsappOptIn", {
      enumerable: true,
      get: () => mockConsentState.clientOptIn,
    });
    const conversation = {
      id: "conversation-1",
      tenantId: "tenant-1",
      clientId: "client-1",
      channel: "whatsapp",
      sessionId: "5511999999999",
      status: mockConsentState.conversationStatus,
      metadata: { source: "evolution", identityMatchStatus: "matched" },
      createdAt: new Date(),
    };
    Object.defineProperty(conversation, "status", {
      enumerable: true,
      get: () => mockConsentState.conversationStatus,
    });

    mockDbSelect.mockReturnValue(makeWhereQuery([integration]));
    const clientQuery = makeWhereQuery([client]);
    const conversationQuery = makeQuery([conversation]);
    const transaction = {
      execute: vi.fn(async () => undefined),
      select: vi.fn()
        .mockReturnValueOnce(clientQuery)
        .mockReturnValueOnce(conversationQuery),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          mockTxUpdateSets.push(values);
          return { where: vi.fn(async () => undefined) };
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          mockInsertedMessages.push(values);
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "message-row-1" }]),
            })),
          };
        }),
      })),
    };
    mockDbTransaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) =>
      await callback(transaction),
    );
    mockExtractEvolutionInboundMedia.mockReturnValue({
      kind: "image",
      mimeType: "image/jpeg",
      fileName: "image.jpg",
      caption: null,
      messageId: "provider-message-1",
      remoteJid: "5511999999999@s.whatsapp.net",
    });
  });

  it("records an opt-out before downloading or attaching media from that message", async () => {
    const result = await processEvolutionInbound({
      instanceName: "agency-instance",
      apiKey: "integration-api-key",
      payload: {
        data: {
          key: {
            id: "provider-message-1",
            remoteJid: "5511999999999@s.whatsapp.net",
            fromMe: false,
          },
          message: { imageMessage: { mimetype: "image/jpeg" } },
          text: "STOP",
        },
      },
    });

    expect(result).toBe("opted_out");
    expect(mockTxUpdateSets).toContainEqual({ whatsappOptIn: false });
    expect(mockTxUpdateSets).toContainEqual(expect.objectContaining({ status: "opted_out" }));
    expect(mockInsertedMessages[0]).toEqual(expect.objectContaining({
      mediaUrl: null,
      mediaMimeType: null,
      mediaFileName: null,
    }));
    expect(mockStoreEvolutionInboundMedia).not.toHaveBeenCalled();
  });

  it("skips media processing for a contact who had already opted out", async () => {
    mockConsentState.clientOptIn = false;

    const result = await processEvolutionInbound({
      instanceName: "agency-instance",
      apiKey: "integration-api-key",
      payload: {
        data: {
          key: {
            id: "provider-message-1",
            remoteJid: "5511999999999@s.whatsapp.net",
            fromMe: false,
          },
          message: { imageMessage: { mimetype: "image/jpeg" } },
        },
      },
    });

    expect(result).toBe("opted_out");
    expect(mockTxUpdateSets).toContainEqual(expect.objectContaining({ status: "opted_out" }));
    expect(mockInsertedMessages[0]).toEqual(expect.objectContaining({
      mediaUrl: null,
      mediaMimeType: null,
      mediaFileName: null,
    }));
    expect(mockStoreEvolutionInboundMedia).not.toHaveBeenCalled();
  });

  it("stores permitted media privately, then hands it to staff without calling AI", async () => {
    const uploadedMedia = {
      mediaUrl: "https://utfs.io/f/private-media-key",
      mimeType: "image/jpeg",
      fileName: "image.jpg",
    };
    mockStoreEvolutionInboundMedia.mockResolvedValue({ ok: true, media: uploadedMedia });
    const attachmentUpdate = {
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "message-row-1" }]),
        })),
      })),
    };
    const handoffUpdate = {
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    };
    mockDbUpdate
      .mockReturnValueOnce(attachmentUpdate)
      .mockReturnValueOnce(handoffUpdate);

    const result = await processEvolutionInbound({
      instanceName: "agency-instance",
      apiKey: "integration-api-key",
      payload: {
        data: {
          key: {
            id: "provider-message-1",
            remoteJid: "5511999999999@s.whatsapp.net",
            fromMe: false,
          },
          message: { imageMessage: { mimetype: "image/jpeg" } },
          text: "Veja esta imagem",
        },
      },
    });

    expect(result).toBe("human_handoff");
    expect(mockStoreEvolutionInboundMedia).toHaveBeenCalledOnce();
    expect(attachmentUpdate.set).toHaveBeenCalledWith({
      mediaUrl: uploadedMedia.mediaUrl,
      mediaMimeType: uploadedMedia.mimeType,
      mediaFileName: uploadedMedia.fileName,
    });
    expect(handoffUpdate.set).toHaveBeenCalledWith({ status: "human_handoff" });
    expect(mockGetAIClientForTenant).not.toHaveBeenCalled();
  });
});
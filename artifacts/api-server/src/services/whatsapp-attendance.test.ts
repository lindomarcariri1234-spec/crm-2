import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbSelect,
  mockDbTransaction,
  mockDbUpdate,
  mockUpdateSet,
  mockUpdateWhere,
  mockUpdateReturning,
  mockStoreEvolutionInboundMedia,
  mockGetAIClientForTenant,
  mockExtractEvolutionInboundMedia,
  mockDispatchOutboundMessage,
  mockConsentState,
  mockTxUpdateSets,
  mockInsertedMessages,
  mockInsertResults,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockStoreEvolutionInboundMedia: vi.fn(),
  mockGetAIClientForTenant: vi.fn(),
  mockExtractEvolutionInboundMedia: vi.fn(),
  mockDispatchOutboundMessage: vi.fn(),
  mockConsentState: { clientOptIn: true, conversationStatus: "open" },
  mockTxUpdateSets: [] as Record<string, unknown>[],
  mockInsertedMessages: [] as Record<string, unknown>[],
  mockInsertResults: [] as Array<Array<{ id: string }>>,
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
    id: "tenant_integrations.id",
    tenantId: "tenant_integrations.tenant_id",
    type: "tenant_integrations.type",
    enabled: "tenant_integrations.enabled",
    status: "tenant_integrations.status",
    config: "tenant_integrations.config",
    secretsEncrypted: "tenant_integrations.secrets_encrypted",
    lastSyncAt: "tenant_integrations.last_sync_at",
    lastError: "tenant_integrations.last_error",
    isDefault: "tenant_integrations.is_default",
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

vi.mock("./support-ticketing.js", () => ({
  ensureSupportTicketForConversation: vi.fn(async () => null),
  recordSupportTicketEvent: vi.fn(async () => undefined),
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
  dispatchOutboundMessage: mockDispatchOutboundMessage,
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

import {
  deliverAttendanceReply,
  evolutionInboundAdapter,
  processEvolutionConnectionUpdate,
  processEvolutionInbound,
} from "./whatsapp-attendance.js";

function makeQuery<T>(result: T) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query["from"] = vi.fn(() => query);
  query["leftJoin"] = vi.fn(() => query);
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
    mockInsertResults.length = 0;
    mockDbUpdate.mockReset();
    mockStoreEvolutionInboundMedia.mockReset();
    mockGetAIClientForTenant.mockReset();
    mockDispatchOutboundMessage.mockReset();

    const integration = {
      id: "integration-1",
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
      whatsappIntegrationId: "integration-1",
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
    mockDbTransaction.mockImplementation(async (callback: (tx: Record<string, unknown>) => unknown) => {
      const transaction = {
        execute: vi.fn(async () => undefined),
        select: vi.fn()
          .mockReturnValueOnce(makeWhereQuery([client]))
          .mockReturnValueOnce(makeQuery([conversation])),
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
                returning: vi.fn(async () =>
                  mockInsertResults.shift() ?? [{ id: "message-row-1" }],
                ),
              })),
            };
          }),
        })),
      };
      return await callback(transaction);
    });
    mockExtractEvolutionInboundMedia.mockReturnValue({
      kind: "image",
      mimeType: "image/jpeg",
      fileName: "image.jpg",
      caption: null,
      messageId: "provider-message-1",
      remoteJid: "5511999999999@s.whatsapp.net",
    });
  });

  it("normalizes Evolution messages to the shared inbound event contract", () => {
    mockExtractEvolutionInboundMedia.mockReturnValueOnce(null);
    const [event] = evolutionInboundAdapter.normalize({
      instanceName: "agency-connection",
      payload: {
        data: {
          messageTimestamp: 1_700_000_000,
          key: {
            remoteJid: "11987654321@s.whatsapp.net",
            id: "evolution-message-123",
            fromMe: false,
          },
          message: { conversation: "Olá" },
        },
      },
    });

    expect(event).toMatchObject({
      provider: "evolution",
      channel: "whatsapp",
      accountId: "agency-connection",
      conversationId: "5511987654321",
      senderId: "5511987654321",
      externalId: "evolution-message-123",
      content: "Olá",
      occurredAt: new Date(1_700_000_000_000),
    });
  });

  it("keeps provider identity stable when Evolution redelivers the same event", () => {
    const payload = {
      data: {
        key: {
          remoteJid: "5511999999999@s.whatsapp.net",
          id: "provider-message-duplicate",
          fromMe: false,
        },
        message: { conversation: "Oi" },
      },
    };
    const first = evolutionInboundAdapter.normalize({ instanceName: "agency-connection", payload })[0];
    const replay = evolutionInboundAdapter.normalize({ instanceName: "agency-connection", payload })[0];

    expect(first).toMatchObject({
      accountId: "agency-connection",
      senderId: "5511999999999",
      externalId: "provider-message-duplicate",
    });
    expect(replay?.externalId).toBe(first?.externalId);
  });

  it("keeps duplicate webhook inserts on the same provider message key", async () => {
    mockExtractEvolutionInboundMedia.mockReturnValue(null);
    mockInsertResults.push([{ id: "message-row-1" }], []);
    const payload = {
      data: {
        key: {
          remoteJid: "5511999999999@s.whatsapp.net",
          id: "provider-message-replayed",
          fromMe: false,
        },
        message: { conversation: "STOP" },
      },
    };
    const opts = {
      instanceName: "agency-instance",
      apiKey: "integration-api-key",
      payload,
    };

    await expect(processEvolutionInbound(opts)).resolves.toBe("opted_out");
    await expect(processEvolutionInbound(opts)).resolves.toBe("opted_out");

    expect(mockInsertedMessages).toHaveLength(2);
    expect(mockInsertedMessages.map((message) => message["sourceMessageId"])).toEqual([
      "provider-message-replayed",
      "provider-message-replayed",
    ]);
    expect(mockInsertResults).toHaveLength(0);
  });

  it("ignores malformed payloads only after authenticating the configured instance", async () => {
    expect(evolutionInboundAdapter.normalize({
      instanceName: "agency-instance",
      payload: { data: { key: {}, message: {} } },
    })).toEqual([]);

    await expect(processEvolutionInbound({
      instanceName: "agency-instance",
      apiKey: "integration-api-key",
      payload: { data: { key: {}, message: {} } },
    })).resolves.toBe("ignored");

    mockDbSelect.mockReturnValueOnce(makeWhereQuery([]));
    await expect(processEvolutionInbound({
      instanceName: "unknown-instance",
      apiKey: "wrong-key",
      payload: { data: { key: {}, message: {} } },
    })).resolves.toBe("unauthorized");
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
          messageTimestamp: 1_700_000_000,
          message: { imageMessage: { mimetype: "image/jpeg" } },
          text: "Veja esta imagem",
        },
      },
    });

    expect(result).toBe("human_handoff");
    expect(mockInsertedMessages[0]).toEqual(expect.objectContaining({
      sourceMessageId: "provider-message-1",
      content: "Veja esta imagem",
      sentAt: new Date(1_700_000_000_000),
      mediaMimeType: "image/jpeg",
      mediaFileName: "image.jpg",
    }));
    expect(mockStoreEvolutionInboundMedia).toHaveBeenCalledOnce();
    expect(attachmentUpdate.set).toHaveBeenCalledWith({
      mediaUrl: uploadedMedia.mediaUrl,
      mediaMimeType: uploadedMedia.mimeType,
      mediaFileName: uploadedMedia.fileName,
    });
    expect(handoffUpdate.set).toHaveBeenCalledWith({ status: "human_handoff" });
    expect(mockGetAIClientForTenant).not.toHaveBeenCalled();
  });

  it("uses the durable inline fallback when a staff reply cannot be queued", async () => {
    const claimedMessage = {
      id: "reply-1",
      conversationId: "conversation-1",
      ticketId: null,
      content: "Sua reserva está confirmada.",
      deliveryAttempts: 1,
    };
    const claimQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    claimQuery["set"] = vi.fn(() => claimQuery);
    claimQuery["where"] = vi.fn(() => claimQuery);
    claimQuery["returning"] = vi.fn(async () => [claimedMessage]);

    const finalizeQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    finalizeQuery["set"] = vi.fn(() => finalizeQuery);
    finalizeQuery["where"] = vi.fn(async () => undefined);
    mockDbUpdate
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(finalizeQuery);
    mockDbSelect.mockReturnValueOnce(makeQuery([{
      sessionId: "5511999999999",
      status: "human_handoff",
      clientId: "client-1",
      whatsappIntegrationId: "integration-1",
      clientWhatsappOptIn: true,
    }]));
    mockDispatchOutboundMessage.mockResolvedValue({
      deliveries: [{ channel: "whatsapp", status: "accepted" }],
    });

    await expect(deliverAttendanceReply({
      tenantId: "tenant-1",
      messageId: "reply-1",
      inlineOnQueueFailure: true,
    })).resolves.toBe(true);

    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        origin: "whatsapp-attendance",
      }),
      { inlineOnQueueFailure: true },
    );
  });

  it("keeps an unknown provider outcome out of the automatic attendance retry queue", async () => {
    const claimedMessage = {
      id: "reply-1",
      conversationId: "conversation-1",
      ticketId: null,
      content: "Sua reserva está confirmada.",
      deliveryAttempts: 1,
    };
    const claimQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    claimQuery["set"] = vi.fn(() => claimQuery);
    claimQuery["where"] = vi.fn(() => claimQuery);
    claimQuery["returning"] = vi.fn(async () => [claimedMessage]);

    const finalizeQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    finalizeQuery["set"] = vi.fn(() => finalizeQuery);
    finalizeQuery["where"] = vi.fn(async () => undefined);
    mockDbUpdate
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(finalizeQuery);
    mockDbSelect.mockReturnValueOnce(makeQuery([{
      sessionId: "5511999999999",
      status: "human_handoff",
      clientId: "client-1",
      whatsappIntegrationId: "integration-1",
      clientWhatsappOptIn: true,
    }]));
    mockDispatchOutboundMessage.mockResolvedValue({
      deliveries: [{
        channel: "whatsapp",
        status: "unknown",
        lastError: "delivery_result_unknown",
      }],
    });

    await expect(deliverAttendanceReply({
      tenantId: "tenant-1",
      messageId: "reply-1",
      inlineOnQueueFailure: true,
    })).resolves.toBe(false);

    expect(finalizeQuery["set"]).toHaveBeenCalledWith(expect.objectContaining({
      deliveryStatus: "unknown",
      lastDeliveryError: "delivery_result_unknown",
    }));
  });
});

describe("Evolution connection update webhooks", () => {
  const integration = {
    id: "integration-1",
    tenantId: "tenant-1",
    enabled: true,
    status: "disconnected",
    isDefault: true,
    config: { instanceName: "agency-instance", baseUrl: "https://evolution.example" },
    secretsEncrypted: JSON.stringify({ apiKey: "integration-api-key" }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue(makeWhereQuery([integration]));
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateReturning.mockResolvedValue([{ id: integration.id }]);
  });

  it("updates only the authenticated tenant instance when the session opens", async () => {
    const outcome = await processEvolutionConnectionUpdate({
      instanceName: "agency-instance",
      apiKey: "integration-api-key",
      payload: { event: "CONNECTION_UPDATE", data: { state: "open" } },
    });

    expect(outcome).toBe("updated");
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "connected",
      lastSyncAt: expect.any(Date),
      lastError: null,
    }));
    const whereArgument = mockUpdateWhere.mock.calls[0]?.[0] as {
      conditions: Array<{ column: string; value: unknown }>;
    };
    expect(whereArgument.conditions).toEqual(expect.arrayContaining([
      { column: "tenant_integrations.id", value: "integration-1" },
      { column: "tenant_integrations.tenant_id", value: "tenant-1" },
      { column: "tenant_integrations.type", value: "whatsapp_evolution" },
      { column: "tenant_integrations.enabled", value: true },
    ]));
  });

  it("clears the default when the session closes and does not rewrite duplicate or invalid states", async () => {
    mockDbSelect.mockReturnValue(makeWhereQuery([{ ...integration, status: "connected" }]));
    await expect(processEvolutionConnectionUpdate({
      instanceName: "agency-instance",
      apiKey: "integration-api-key",
      payload: { event: "connection.update", data: { state: "close" } },
    })).resolves.toBe("updated");
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "disconnected",
      isDefault: false,
    }));

    mockDbSelect.mockReturnValue(makeWhereQuery([{ ...integration, status: "connected" }]));
    await expect(processEvolutionConnectionUpdate({
      instanceName: "agency-instance",
      apiKey: "integration-api-key",
      payload: { event: "connection.update", data: { state: "open" } },
    })).resolves.toBe("unchanged");
    await expect(processEvolutionConnectionUpdate({
      instanceName: "agency-instance",
      apiKey: "integration-api-key",
      payload: { event: "connection.update", data: { state: "connecting" } },
    })).resolves.toBe("ignored");
    await expect(processEvolutionConnectionUpdate({
      instanceName: "agency-instance",
      apiKey: "wrong-key",
      payload: { event: "connection.update", data: { state: "open" } },
    })).resolves.toBe("unauthorized");
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
  });
});
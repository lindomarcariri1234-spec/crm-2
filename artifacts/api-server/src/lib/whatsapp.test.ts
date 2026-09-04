import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbSelect,
  mockDecryptCredential,
  mockSafeFetch,
  mockFetch,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDecryptCredential: vi.fn(),
  mockSafeFetch: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: mockDbSelect },
  tenantIntegrationsTable: {
    tenantId: "tenant_integrations.tenant_id",
    type: "tenant_integrations.type",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("./crypto", () => ({
  decryptCredential: mockDecryptCredential,
}));

vi.mock("./ssrf", () => ({
  ssrfSafeFetchBounded: mockSafeFetch,
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { reconcileTenantWhatsAppMessage, sendTenantWhatsAppMessage } from "./whatsapp";

function makeSelectQuery(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { from };
}

const evolutionIntegration = {
  enabled: true,
  status: "connected",
  secretsEncrypted: "encrypted",
  config: {
    baseUrl: "https://evolution.example.com/",
    instanceName: "agency-instance",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDbSelect.mockReset();
  mockDecryptCredential.mockReset();
  mockSafeFetch.mockReset();
  mockFetch.mockReset();
  vi.stubEnv("ZAPI_INSTANCE_ID", "instance-1");
  vi.stubEnv("ZAPI_TOKEN", "token-1");
  vi.stubGlobal("fetch", mockFetch);
  mockDecryptCredential.mockReturnValue(JSON.stringify({ apiKey: "evolution-key" }));
});

describe("WhatsApp transport contracts", () => {
  it("returns the Evolution external id from an accepted send", async () => {
    mockDbSelect.mockReturnValue(makeSelectQuery([evolutionIntegration]));
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 201,
      text: JSON.stringify({ key: { id: "evolution-message-1" } }),
    });

    await expect(sendTenantWhatsAppMessage("tenant-a", "+55 11 99999-0001", "Olá"))
      .resolves.toEqual({
        success: true,
        provider: "evolution",
        externalId: "evolution-message-1",
      });

    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://evolution.example.com/message/sendText/agency-instance",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: "evolution-key" },
        body: JSON.stringify({ number: "5511999990001", text: "Olá" }),
      }),
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not fall back to Z-API after an ambiguous Evolution timeout", async () => {
    mockDbSelect.mockReturnValue(makeSelectQuery([evolutionIntegration]));
    mockSafeFetch.mockRejectedValue(new Error("The operation was aborted"));

    await expect(sendTenantWhatsAppMessage("tenant-a", "+5511999990001", "Olá"))
      .resolves.toEqual({
        success: false,
        provider: "evolution",
        error: "The operation was aborted",
        outcome: "unknown",
      });

    expect(mockSafeFetch).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("marks a Z-API timeout as unknown instead of retryable failure", async () => {
    mockDbSelect.mockReturnValue(makeSelectQuery([]));
    mockFetch.mockRejectedValue(new Error("The operation was aborted"));

    await expect(sendTenantWhatsAppMessage("tenant-a", "+5511999990001", "Olá"))
      .resolves.toEqual({
        success: false,
        provider: "z-api",
        error: "The operation was aborted",
        outcome: "unknown",
      });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.z-api.io/instances/instance-1/token/token-1/send-text",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ phone: "5511999990001", message: "Olá" }),
      }),
    );
  });

  it("accepts a successful Z-API response and preserves its external id", async () => {
    mockDbSelect.mockReturnValue(makeSelectQuery([]));
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ messageId: "zapi-message-1" }), { status: 200 }));

    await expect(sendTenantWhatsAppMessage("tenant-a", "+5511999990001", "Olá"))
      .resolves.toEqual({
        success: true,
        provider: "z-api",
        externalId: "zapi-message-1",
      });
  });

  it("does not fall back after an accepted Evolution response without an object body", async () => {
    mockDbSelect.mockReturnValue(makeSelectQuery([evolutionIntegration]));
    mockSafeFetch.mockResolvedValue({ ok: true, status: 200, text: "null" });

    await expect(sendTenantWhatsAppMessage("tenant-a", "+5511999990001", "Olá"))
      .resolves.toEqual({
        success: true,
        provider: "evolution",
      });

    expect(mockSafeFetch).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("WhatsApp reconciliation contracts", () => {
  it("confirms an Evolution message found by its external id", async () => {
    mockDbSelect.mockReturnValue(makeSelectQuery([evolutionIntegration]));
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: JSON.stringify({
        messages: { records: [{ key: { id: "evolution-message-1" }, status: "SERVER_ACK" }] },
      }),
    });

    await expect(reconcileTenantWhatsAppMessage(
      "tenant-a",
      "evolution",
      "evolution-message-1",
      "+5511999990001",
    )).resolves.toEqual({
      outcome: "accepted",
      provider: "evolution",
      externalId: "evolution-message-1",
      providerStatus: "SERVER_ACK",
      detail: "provider_message_found",
    });

    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://evolution.example.com/chat/findMessages/agency-instance",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          where: {
            key: {
              id: "evolution-message-1",
              remoteJid: "5511999990001@s.whatsapp.net",
              fromMe: true,
            },
          },
          limit: 10,
        }),
      }),
    );
  });

  it("returns a provider-confirmed absence without treating a provider error as absence", async () => {
    mockDbSelect.mockReturnValue(makeSelectQuery([evolutionIntegration]));
    mockSafeFetch.mockResolvedValue({ ok: true, status: 200, text: JSON.stringify({ messages: { records: [] } }) });

    await expect(reconcileTenantWhatsAppMessage("tenant-a", "evolution", "missing-id", "+5511999990001"))
      .resolves.toMatchObject({ outcome: "not_found", detail: "provider_message_not_found" });

    mockSafeFetch.mockResolvedValue({ ok: false, status: 500, text: "provider failure" });
    await expect(reconcileTenantWhatsAppMessage("tenant-a", "evolution", "missing-id", "+5511999990001"))
      .resolves.toMatchObject({ outcome: "inconclusive", detail: "provider_http_500" });
  });

  it("never authorizes a Z-API resend because it has no message lookup", async () => {
    await expect(reconcileTenantWhatsAppMessage("tenant-a", "z-api", "zapi-message-1", "+5511999990001"))
      .resolves.toEqual({
        outcome: "unsupported",
        provider: "z-api",
        externalId: "zapi-message-1",
        detail: "provider_status_lookup_unsupported",
      });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockUpdateSets,
  mockSendReminderHtmlEmail,
  mockAnd,
  mockEq,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockUpdateSets: [] as unknown[],
  mockSendReminderHtmlEmail: vi.fn(),
  mockAnd: vi.fn((...conditions: unknown[]) => ({ conditions })),
  mockEq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  },
  clientsTable: {},
  tenantsTable: {},
  usersTable: {},
  emailLogsTable: {
    tenantId: "email_logs.tenant_id",
    outboundMessageId: "email_logs.outbound_message_id",
  },
  outboundDeliveriesTable: {
    id: "outbound_deliveries.id",
    tenantId: "outbound_deliveries.tenant_id",
    outboundMessageId: "outbound_deliveries.outbound_message_id",
    channel: "outbound_deliveries.channel",
    status: "outbound_deliveries.status",
    externalId: "outbound_deliveries.external_id",
    provider: "outbound_deliveries.provider",
    bounceType: "outbound_deliveries.bounce_type",
    attempts: "outbound_deliveries.attempts",
    nextAttemptAt: "outbound_deliveries.next_attempt_at",
    claimedAt: "outbound_deliveries.claimed_at",
  },
  outboundDeliveryAttemptsTable: {
    tenantId: "outbound_delivery_attempts.tenant_id",
    deliveryId: "outbound_delivery_attempts.delivery_id",
    attemptNumber: "outbound_delivery_attempts.attempt_number",
    externalId: "outbound_delivery_attempts.external_id",
  },
  outboundMessagesTable: {
    id: "outbound_messages.id",
    tenantId: "outbound_messages.tenant_id",
    createdAt: "outbound_messages.created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: mockAnd,
  eq: mockEq,
  desc: vi.fn(() => "desc"),
  exists: vi.fn(() => "exists"),
  inArray: vi.fn(() => "inArray"),
  isNull: vi.fn(() => "isNull"),
  lte: vi.fn(() => "lte"),
  or: vi.fn(() => "or"),
  sql: vi.fn(() => "sql"),
}));

vi.mock("@workspace/email", () => ({
  sendReminderHtmlEmail: mockSendReminderHtmlEmail,
}));

vi.mock("../queues", () => ({
  getOutboundDeliveryQueue: vi.fn(() => null),
}));

vi.mock("../lib/whatsapp", () => ({
  sendTenantWhatsAppMessage: vi.fn(),
}));

vi.mock("../lib/id", () => ({
  generateId: vi.fn(() => "generated-id"),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/outbound-sse", () => ({
  emitOutboundDeliveryUpdate: vi.fn(),
}));

import {
  htmlToWhatsAppText,
  processOutboundDelivery,
  resolveWebhookDeliveryState,
  updateOutboundDeliveryFromWebhook,
} from "./outbound-delivery";

function makeSelectQuery(result: unknown[]) {
  const limit = vi.fn().mockResolvedValue(result);
  const where = vi.fn(() => Object.assign(Promise.resolve(result), { limit }));
  const from = vi.fn(() => ({ where }));
  return { from };
}

function makeUpdateQuery(result: unknown[] | null = null) {
  const where = vi.fn(() => result
    ? { returning: vi.fn().mockResolvedValue(result) }
    : Promise.resolve([]));
  const set = vi.fn((values: unknown) => {
    mockUpdateSets.push(values);
    return { where };
  });
  return { set };
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: "delivery-1",
    tenantId: "tenant-a",
    outboundMessageId: "message-1",
    channel: "email",
    recipient: "client@example.com",
    subject: "Reserva confirmada",
    content: "<p>Olá</p>",
    status: "pending",
    attempts: 1,
    maxAttempts: 3,
    nextAttemptAt: new Date("2026-09-01T12:00:00.000Z"),
    claimedAt: null,
    skippedReason: null,
    externalId: null,
    provider: null,
    lastError: null,
    ...overrides,
  };
}

function mockProcessQueries(delivery: Record<string, unknown>, updated: Record<string, unknown>) {
  mockDbUpdate
    .mockReturnValueOnce(makeUpdateQuery([delivery]))
    .mockReturnValueOnce(makeUpdateQuery([updated]))
    .mockReturnValueOnce(makeUpdateQuery())
    .mockReturnValueOnce(makeUpdateQuery())
    .mockReturnValueOnce(makeUpdateQuery());
  mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
  mockDbSelect.mockReturnValue(makeSelectQuery([{ status: updated.status }]));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbSelect.mockReset();
  mockDbInsert.mockReset();
  mockDbUpdate.mockReset();
  mockSendReminderHtmlEmail.mockReset();
  mockUpdateSets.length = 0;
  mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
});

describe("multichannel rendering", () => {
  it("renders WhatsApp text independently and never forwards HTML tags", () => {
    expect(htmlToWhatsAppText("<p>Olá <strong>Maria</strong>!</p><p>Confira &amp; confirme.<br>Até breve.</p>"))
      .toBe("Olá Maria!\n\nConfira & confirme.\nAté breve.");
  });

  it("keeps list items readable", () => {
    expect(htmlToWhatsAppText("<ul><li>Passaporte</li><li>Documento</li></ul>"))
      .toBe("• Passaporte\n• Documento");
  });
});


describe("provider callback state", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  it("does not regress an accepted delivery when a delayed failure arrives", () => {
    expect(resolveWebhookDeliveryState("accepted", {
      status: "failed",
      providerStatus: "email.bounced",
      error: "late bounce",
    }, now)).toEqual({
      status: "accepted",
      failedAt: null,
      claimedAt: null,
      lastError: null,
    });
  });

  it("records a provider failure while the delivery is not finalized", () => {
    expect(resolveWebhookDeliveryState("processing", {
      status: "failed",
      providerStatus: "error",
      error: null,
    }, now)).toEqual({
      status: "failed",
      failedAt: now,
      claimedAt: null,
      lastError: "error",
    });
  });
});

describe("legacy email history synchronization", () => {
  it("marks the same legacy log as sent when the worker accepts the delivery", async () => {
    const delivery = makeDelivery();
    const updated = makeDelivery({
      status: "accepted",
      provider: "resend",
      externalId: "resend-message-1",
      lastError: null,
    });
    mockProcessQueries(delivery, updated);
    mockSendReminderHtmlEmail.mockResolvedValue({
      success: true,
      messageId: "resend-message-1",
    });

    await expect(processOutboundDelivery("delivery-1", "tenant-a")).resolves.toBe(true);

    expect(mockDbUpdate).toHaveBeenCalledTimes(5);
    expect(mockUpdateSets[3]).toEqual(expect.objectContaining({
      status: "sent",
      messageId: "resend-message-1",
      errorMessage: null,
    }));
    expect(mockUpdateSets[3]).not.toHaveProperty("outboundMessageId");
  });

  it("marks the same legacy log as failed for a definitive provider failure", async () => {
    const delivery = makeDelivery();
    const updated = makeDelivery({
      status: "skipped",
      skippedReason: "credentials_not_configured",
      lastError: "credentials_not_configured",
    });
    mockProcessQueries(delivery, updated);
    mockSendReminderHtmlEmail.mockResolvedValue({
      success: false,
      error: "credentials_not_configured",
    });

    await expect(processOutboundDelivery("delivery-1", "tenant-a")).resolves.toBe(false);

    expect(mockUpdateSets[3]).toEqual(expect.objectContaining({
      status: "failed",
      messageId: null,
      errorMessage: "credentials_not_configured",
    }));
  });

  it("leaves the legacy log queued while a transient failure can still retry", async () => {
    const delivery = makeDelivery();
    const updated = makeDelivery({
      status: "pending",
      lastError: "provider unavailable",
    });
    mockProcessQueries(delivery, updated);
    mockSendReminderHtmlEmail.mockResolvedValue({
      success: false,
      error: "provider unavailable",
    });

    await expect(processOutboundDelivery("delivery-1", "tenant-a")).resolves.toBe(false);

    expect(mockDbUpdate).toHaveBeenCalledTimes(4);
    expect(mockUpdateSets.some((values) =>
      values && typeof values === "object" && "messageId" in values,
    )).toBe(false);
  });

  it("applies repeated provider callbacks to one legacy log without inserting another", async () => {
    let deliveryStatus = "processing";
    let updateInvocation = 0;
    mockDbSelect.mockImplementation(() => {
      const isDeliveryLookup = mockDbSelect.mock.calls.length % 2 === 1;
      return makeSelectQuery(isDeliveryLookup
        ? [makeDelivery({ status: deliveryStatus, externalId: "resend-message-1", provider: "resend" })]
        : [{ status: deliveryStatus }]);
    });
    mockDbUpdate.mockImplementation(() => {
      updateInvocation += 1;
      const isDeliveryUpdate = updateInvocation % 4 === 1;
      const updated = makeDelivery({
        status: "accepted",
        externalId: "resend-message-1",
        provider: "resend",
      });
      if (isDeliveryUpdate) deliveryStatus = "accepted";
      return makeUpdateQuery(isDeliveryUpdate ? [updated] : null);
    });

    const callback = {
      tenantId: "tenant-a",
      provider: "resend",
      externalId: "resend-message-1",
      status: "accepted" as const,
      providerStatus: "email.delivered",
      error: null,
    };

    await expect(updateOutboundDeliveryFromWebhook(callback)).resolves.toEqual({
      updated: true,
      deliveryId: "delivery-1",
      messageId: "message-1",
    });
    await expect(updateOutboundDeliveryFromWebhook(callback)).resolves.toEqual({
      updated: true,
      deliveryId: "delivery-1",
      messageId: "message-1",
    });

    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockDbUpdate).toHaveBeenCalledTimes(8);
    expect(mockUpdateSets[2]).toEqual(expect.objectContaining({
      status: "sent",
      messageId: "resend-message-1",
      errorMessage: null,
    }));
    expect(mockUpdateSets[6]).toEqual(mockUpdateSets[2]);
  });

  it("marks the legacy log and message failed when a provider bounce arrives", async () => {
    const delivery = makeDelivery({
      status: "processing",
      provider: "resend",
      externalId: "resend-message-1",
    });
    const updated = makeDelivery({
      status: "failed",
      provider: "resend",
      externalId: "resend-message-1",
      bounceType: "permanent",
      lastError: "email.bounced",
      failedAt: new Date("2026-09-01T12:00:00.000Z"),
    });
    mockDbSelect
      .mockReturnValueOnce(makeSelectQuery([delivery]))
      .mockReturnValueOnce(makeSelectQuery([{ status: "failed" }]));
    mockDbUpdate
      .mockReturnValueOnce(makeUpdateQuery([updated]))
      .mockReturnValueOnce(makeUpdateQuery())
      .mockReturnValueOnce(makeUpdateQuery())
      .mockReturnValueOnce(makeUpdateQuery());

    await expect(updateOutboundDeliveryFromWebhook({
      tenantId: "tenant-a",
      provider: "resend",
      externalId: "resend-message-1",
      status: "failed",
      providerStatus: "email.bounced",
      error: "email.bounced",
      bounceType: "permanent",
    })).resolves.toEqual({
      updated: true,
      deliveryId: "delivery-1",
      messageId: "message-1",
    });

    expect(mockUpdateSets[0]).toEqual(expect.objectContaining({
      status: "failed",
      bounceType: "permanent",
      lastError: "email.bounced",
      claimedAt: null,
    }));
    expect(mockUpdateSets[1]).toEqual(expect.objectContaining({
      status: "failed",
      error: "email.bounced",
    }));
    expect(mockUpdateSets[2]).toEqual(expect.objectContaining({
      status: "failed",
      messageId: "resend-message-1",
      errorMessage: "email.bounced",
    }));
    expect(mockUpdateSets[3]).toEqual({ status: "failed" });
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("does not change the original history for a callback from another tenant", async () => {
    mockDbSelect.mockReturnValue(makeSelectQuery([]));

    await expect(updateOutboundDeliveryFromWebhook({
      tenantId: "tenant-b",
      provider: "resend",
      externalId: "resend-message-1",
      status: "accepted",
    })).resolves.toEqual({ updated: false });

    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockAnd).toHaveBeenCalledWith(
      { column: "outbound_deliveries.tenant_id", value: "tenant-b" },
      { column: "outbound_deliveries.external_id", value: "resend-message-1" },
      { column: "outbound_deliveries.provider", value: "resend" },
    );
  });
});
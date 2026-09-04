import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDispatchOutboundMessage,
  mockRetryOutboundDelivery,
  mockDbInsert,
} = vi.hoisted(() => ({
  mockDispatchOutboundMessage: vi.fn(),
  mockRetryOutboundDelivery: vi.fn(),
  mockDbInsert: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { insert: mockDbInsert },
  emailLogsTable: {},
  reservationsTable: {},
  tripsTable: {},
  clientsTable: {},
  referralSettingsTable: {},
  tenantsTable: {},
  storesTable: {},
  usersTable: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
}));

vi.mock("@workspace/email", () => ({
  sendWelcomeCredentialsEmail: vi.fn(),
  sendReferralBonusPaidEmail: vi.fn(),
  sendReferralConvertedEmail: vi.fn(),
  sendReferralExpiredEmail: vi.fn(),
  sendReferralExpiringSoonEmail: vi.fn(),
  sendReferralBonusReleasedEmail: vi.fn(),
  sendReferralWelcomeEmail: vi.fn(),
  sendReferralTierUpgradeEmail: vi.fn(),
  sendReferralReversedEmail: vi.fn(),
  sendReferralCodeSuspendedEmail: vi.fn(),
  sendAgencySuspendedEmail: vi.fn(),
  sendAgencyReactivatedEmail: vi.fn(),
  sendReferralLoyaltyPointsEmail: vi.fn(),
}));

vi.mock("@workspace/permissions", () => ({ ROLES: {} }));
vi.mock("@workspace/shared", () => ({ formatBRL: (value: number) => `R$ ${value.toFixed(2)}` }));
vi.mock("../queues/index.js", () => ({ getReferralEmailQueue: vi.fn() }));
vi.mock("../queues/whatsapp-helpers.js", () => ({ dispatchWhatsAppReferralReversed: vi.fn() }));
vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: mockDispatchOutboundMessage,
  retryOutboundDelivery: mockRetryOutboundDelivery,
}));
vi.mock("../lib/client-notifications.js", () => ({ insertClientNotification: vi.fn() }));
vi.mock("../lib/redis.js", () => ({ areWorkersEnabled: vi.fn(() => false) }));
vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "email-log-id") }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { enqueuePixOrderQr } from "../queues/email-helpers.js";

const baseOptions = {
  tenantId: "tenant-001",
  orderId: "order-001",
  orderNumber: "PED-001",
  customerName: "Maria",
  customerEmail: "maria@example.com",
  customerPhone: "85999990000",
  storeName: "Minha Agência",
  amount: 50,
  pixQrCodeUrl: "https://example.com/qr.png",
  pixCopyPaste: "000201PIX",
} as const;

function mockDispatchResult() {
  mockDispatchOutboundMessage.mockResolvedValue({
    message: { id: "outbound-message-001", status: "pending" },
    deliveries: [
      { channel: "email", status: "pending", externalId: null, lastError: null, skippedReason: null },
      { channel: "whatsapp", status: "skipped", externalId: null, lastError: null, skippedReason: "whatsapp_content_missing" },
    ],
    created: true,
  });
  mockRetryOutboundDelivery.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatchResult();
  mockDbInsert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });
});

describe("enqueuePixOrderQr", () => {
  it.each([
    ["email", true, false],
    ["whatsapp", false, true],
    ["all", true, true],
  ] as const)("enqueues only the selected channel(s) for %s", async (deliveryMode, hasEmail, hasWhatsapp) => {
    await enqueuePixOrderQr({ ...baseOptions, deliveryMode });

    const input = mockDispatchOutboundMessage.mock.calls[0][0];
    expect(input.idempotencyKey).toBe("order:order-001:pix-qr");
    expect(input.email).toEqual(hasEmail ? expect.objectContaining({
      subject: expect.stringContaining("PED-001"),
    }) : undefined);
    expect(input.whatsapp).toEqual(hasWhatsapp ? expect.objectContaining({
      text: expect.stringContaining("000201PIX"),
    }) : undefined);
    expect(input.metadata).toEqual({
      orderId: "order-001",
      orderNumber: "PED-001",
      deliveryMode,
    });
  });

  it("keeps the same event key when a replay observes a different channel setting", async () => {
    await enqueuePixOrderQr({ ...baseOptions, deliveryMode: "email" });
    await enqueuePixOrderQr({ ...baseOptions, deliveryMode: "all" });

    expect(mockDispatchOutboundMessage.mock.calls.map(([input]) => input.idempotencyKey))
      .toEqual(["order:order-001:pix-qr", "order:order-001:pix-qr"]);
  });

  it("retries only failed selected channels on an idempotent replay", async () => {
    mockDispatchOutboundMessage.mockResolvedValueOnce({
      message: { id: "outbound-message-001", status: "partial" },
      deliveries: [
        { id: "email-delivery-001", channel: "email", status: "failed", skippedReason: null },
        { id: "whatsapp-delivery-001", channel: "whatsapp", status: "accepted", skippedReason: null },
      ],
      created: false,
    });

    await enqueuePixOrderQr({ ...baseOptions, deliveryMode: "all" });

    expect(mockRetryOutboundDelivery).toHaveBeenCalledOnce();
    expect(mockRetryOutboundDelivery).toHaveBeenCalledWith("tenant-001", "email-delivery-001");
  });

  it("retries a provider-unavailable delivery but not a permanent skip", async () => {
    mockDispatchOutboundMessage.mockResolvedValueOnce({
      message: { id: "outbound-message-001", status: "failed" },
      deliveries: [
        { id: "email-delivery-001", channel: "email", status: "skipped", skippedReason: "provider_unavailable" },
        { id: "whatsapp-delivery-001", channel: "whatsapp", status: "skipped", skippedReason: "whatsapp_invalid_phone" },
      ],
      created: false,
    });

    await enqueuePixOrderQr({ ...baseOptions, deliveryMode: "all" });

    expect(mockRetryOutboundDelivery).toHaveBeenCalledOnce();
    expect(mockRetryOutboundDelivery).toHaveBeenCalledWith("tenant-001", "email-delivery-001");
  });

  it("uses the original selected mode when the agency setting changes before replay", async () => {
    mockDispatchOutboundMessage.mockResolvedValueOnce({
      message: {
        id: "outbound-message-001",
        status: "failed",
        metadata: { deliveryMode: "all" },
      },
      deliveries: [
        { id: "email-delivery-001", channel: "email", status: "failed", skippedReason: null },
        { id: "whatsapp-delivery-001", channel: "whatsapp", status: "failed", skippedReason: null },
      ],
      created: false,
    });

    await enqueuePixOrderQr({ ...baseOptions, deliveryMode: "email" });

    expect(mockRetryOutboundDelivery).toHaveBeenCalledTimes(2);
    expect(mockRetryOutboundDelivery).toHaveBeenCalledWith("tenant-001", "email-delivery-001");
    expect(mockRetryOutboundDelivery).toHaveBeenCalledWith("tenant-001", "whatsapp-delivery-001");
  });
});
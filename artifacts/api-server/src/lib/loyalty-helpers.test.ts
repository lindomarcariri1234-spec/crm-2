import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  clientsTable: {
    id: "id",
    tenantId: "tenantId",
    name: "name",
    email: "email",
    whatsapp: "whatsapp",
    whatsappOptIn: "whatsappOptIn",
    emailOptIn: "emailOptIn",
  },
  tenantsTable: { id: "id", name: "name" },
  loyaltyProgramsTable: {},
  loyaltyMembersTable: {},
  loyaltyTransactionsTable: {},
  systemConfigsTable: {
    tenantId: "tenantId",
    key: "key",
    value: "value",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

const mockDispatchOutboundMessage = vi.hoisted(() => vi.fn());

vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: mockDispatchOutboundMessage,
}));

vi.mock("./client-notifications", () => ({
  insertClientNotification: vi.fn(),
}));

vi.mock("./logger", () => ({
  logger: { warn: vi.fn() },
}));

import { db } from "@workspace/db";
import { insertClientNotification } from "./client-notifications";
import { sendLoyaltyTierUpgradeNotification } from "./loyalty-helpers";

const mockedDbSelect = vi.mocked(db.select);
const mockedDispatch = vi.mocked(mockDispatchOutboundMessage);
const mockedInsertNotification = vi.mocked(insertClientNotification);

function mockSelectRows(...rows: unknown[][]) {
  const limit = vi.fn();
  for (const row of rows) {
    limit.mockResolvedValueOnce(row);
  }

  mockedDbSelect.mockReturnValue({
    from: () => ({
      where: () => ({ limit }),
    }),
  } as never);
}

async function flushAsyncNotifications() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("sendLoyaltyTierUpgradeNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedInsertNotification.mockResolvedValue(undefined);
    mockedDispatch.mockResolvedValue({
      created: true,
      message: { status: "accepted" },
      deliveries: [
        { channel: "email", status: "accepted" },
        { channel: "whatsapp", status: "skipped", skippedReason: "whatsapp_opted_out" },
      ],
    });
  });

  it("preserves the tier-upgrade payload and retains the opted-out WhatsApp counterpart", async () => {
    mockSelectRows(
      [{
        name: "Ana Silva",
        email: "ana@example.com",
        whatsapp: "5599999999999",
        whatsappOptIn: false,
        emailOptIn: true,
      }],
      [{ name: "Agência Teste" }],
      [],
    );

    await sendLoyaltyTierUpgradeNotification({
      clientId: "client-1",
      tenantId: "tenant-1",
      newTier: "gold",
      totalPoints: 1800,
    });

    expect(mockedDispatch).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      eventType: "loyalty-tier-upgraded",
      recipient: { type: "client", id: "client-1" },
      email: expect.objectContaining({
        subject: "🎉 Você subiu de nível, Ana!",
        senderName: "Agência Teste",
        html: expect.stringContaining("Ouro"),
      }),
      whatsapp: expect.objectContaining({ text: expect.stringContaining("Ouro") }),
      metadata: { clientId: "client-1", newTier: "gold", totalPoints: 1800 },
    }));
    expect(mockedInsertNotification).toHaveBeenCalledWith(
      "client-1",
      "tenant-1",
      "loyalty_tier_upgraded",
      expect.objectContaining({ newTier: "gold" }),
    );
  });

  it("preserves a partial ledger outcome without issuing a fallback email", async () => {
    mockSelectRows(
      [{
        name: "Ana Silva",
        email: "ana@example.com",
        whatsapp: "5599999999999",
        whatsappOptIn: true,
        emailOptIn: true,
      }],
      [{ name: "Agência Teste" }],
      [],
    );
    mockedDispatch.mockResolvedValue({
      created: true,
      message: { status: "partial" },
      deliveries: [
        { channel: "email", status: "accepted" },
        { channel: "whatsapp", status: "skipped", skippedReason: "credentials_not_configured" },
      ],
    });

    await sendLoyaltyTierUpgradeNotification({
      clientId: "client-1",
      tenantId: "tenant-1",
      newTier: "silver",
      totalPoints: 700,
    });
    await flushAsyncNotifications();
    expect(mockedDispatch).toHaveBeenCalledOnce();
    expect(mockedDispatch).toHaveBeenCalledWith(expect.objectContaining({
      email: expect.objectContaining({ subject: "🎉 Você subiu de nível, Ana!" }),
      whatsapp: expect.objectContaining({ text: expect.stringContaining("Prata") }),
    }));
  });

  it("does not duplicate the email when WhatsApp is accepted", async () => {
    mockSelectRows(
      [{
        name: "Ana Silva",
        email: "ana@example.com",
        whatsapp: "5599999999999",
        whatsappOptIn: true,
        emailOptIn: true,
      }],
      [{ name: "Agência Teste" }],
      [],
    );
    mockedDispatch.mockResolvedValue({
      created: true,
      message: { status: "accepted" },
      deliveries: [
        { channel: "email", status: "skipped", skippedReason: "email_opted_out" },
        { channel: "whatsapp", status: "accepted" },
      ],
    });

    await sendLoyaltyTierUpgradeNotification({
      clientId: "client-1",
      tenantId: "tenant-1",
      newTier: "silver",
      totalPoints: 700,
    });
    await flushAsyncNotifications();

    expect(mockedDispatch).toHaveBeenCalledOnce();
    expect(mockedDispatch.mock.calls[0][0]).toEqual(expect.objectContaining({
      email: expect.any(Object),
      whatsapp: expect.any(Object),
    }));
  });

  it("resolves after recording the portal notice while dispatch remains fire-and-forget", async () => {
    mockSelectRows(
      [{
        name: "Ana Silva",
        email: "ana@example.com",
        whatsapp: "5599999999999",
        whatsappOptIn: false,
        emailOptIn: true,
      }],
      [{ name: "Agência Teste" }],
      [],
    );
    mockedDispatch.mockReturnValue(new Promise(() => {}));

    await expect(
      sendLoyaltyTierUpgradeNotification({
        clientId: "client-1",
        tenantId: "tenant-1",
        newTier: "silver",
        totalPoints: 700,
      }),
    ).resolves.toBeUndefined();

    expect(mockedDispatch).toHaveBeenCalledOnce();
  });

  it("uses the agency WhatsApp template and interpolates its variables", async () => {
    mockSelectRows(
      [{
        name: "Ana Silva",
        email: "ana@example.com",
        whatsapp: "5599999999999",
        whatsappOptIn: true,
        emailOptIn: true,
      }],
      [{ name: "Agência Teste" }],
      [{
        value: {
          tierUpgradeWhatsappMessage:
            "Oi, {nome}! Agora você é {nivel}, com {pontos} pontos. Próximo: {proximo_nivel}.",
        },
      }],
    );
    mockedDispatch.mockResolvedValue({
      created: true,
      message: { status: "accepted" },
      deliveries: [
        { channel: "email", status: "accepted" },
        { channel: "whatsapp", status: "accepted" },
      ],
    });

    await sendLoyaltyTierUpgradeNotification({
      clientId: "client-1",
      tenantId: "tenant-1",
      newTier: "silver",
      totalPoints: 700,
    });

    expect(mockedDispatch).toHaveBeenCalledWith(expect.objectContaining({
      whatsapp: { text: "Oi, Ana! Agora você é Prata, com 700 pontos. Próximo: Ouro." },
    }));
  });
});
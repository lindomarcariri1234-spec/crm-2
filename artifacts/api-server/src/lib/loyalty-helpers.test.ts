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

vi.mock("@workspace/email", () => ({
  sendLoyaltyTierUpgradeEmail: vi.fn(),
}));

vi.mock("./whatsapp", () => ({
  sendTenantWhatsAppMessage: vi.fn(),
}));

vi.mock("./client-notifications", () => ({
  insertClientNotification: vi.fn(),
}));

vi.mock("./logger", () => ({
  logger: { warn: vi.fn() },
}));

import { db } from "@workspace/db";
import { sendLoyaltyTierUpgradeEmail } from "@workspace/email";
import { insertClientNotification } from "./client-notifications";
import { sendLoyaltyTierUpgradeNotification } from "./loyalty-helpers";
import { sendTenantWhatsAppMessage } from "./whatsapp";

const mockedDbSelect = vi.mocked(db.select);
const mockedSendEmail = vi.mocked(sendLoyaltyTierUpgradeEmail);
const mockedSendWhatsApp = vi.mocked(sendTenantWhatsAppMessage);
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
    mockedSendEmail.mockResolvedValue({ success: true });
  });

  it("sends the tier-upgrade email when the client opted out of WhatsApp", async () => {
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

    expect(mockedSendWhatsApp).not.toHaveBeenCalled();
    expect(mockedSendEmail).toHaveBeenCalledWith({
      clientName: "Ana Silva",
      clientEmail: "ana@example.com",
      newTierLabel: "Ouro",
      totalPoints: 1800,
      nextTierLabel: "Diamante",
      pointsToNext: 3200,
      agencyName: "Agência Teste",
    });
    expect(mockedInsertNotification).toHaveBeenCalledWith(
      "client-1",
      "tenant-1",
      "loyalty_tier_upgraded",
      expect.objectContaining({ newTier: "gold" }),
    );
  });

  it("falls back to email when WhatsApp credentials are not configured", async () => {
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
    mockedSendWhatsApp.mockResolvedValue({
      success: false,
      error: "credentials_not_configured",
    });

    await sendLoyaltyTierUpgradeNotification({
      clientId: "client-1",
      tenantId: "tenant-1",
      newTier: "silver",
      totalPoints: 700,
    });
    await flushAsyncNotifications();

    expect(mockedSendWhatsApp).toHaveBeenCalledOnce();
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        newTierLabel: "Prata",
        totalPoints: 700,
        nextTierLabel: "Ouro",
        pointsToNext: 800,
      }),
    );
  });

  it("does not duplicate the notification by email after a successful WhatsApp send", async () => {
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
    mockedSendWhatsApp.mockResolvedValue({ success: true });

    await sendLoyaltyTierUpgradeNotification({
      clientId: "client-1",
      tenantId: "tenant-1",
      newTier: "silver",
      totalPoints: 700,
    });
    await flushAsyncNotifications();

    expect(mockedSendWhatsApp).toHaveBeenCalledOnce();
    expect(mockedSendWhatsApp).toHaveBeenCalledWith(
      "tenant-1",
      "5599999999999",
      expect.stringContaining("🎉 Parabéns, Ana! Você subiu para o nível *Prata*"),
    );
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("does not wait for the fallback email before resolving", async () => {
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
    mockedSendEmail.mockReturnValue(new Promise(() => {}));

    await expect(
      sendLoyaltyTierUpgradeNotification({
        clientId: "client-1",
        tenantId: "tenant-1",
        newTier: "silver",
        totalPoints: 700,
      }),
    ).resolves.toBeUndefined();

    expect(mockedSendEmail).toHaveBeenCalledOnce();
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
    mockedSendWhatsApp.mockResolvedValue({ success: true });

    await sendLoyaltyTierUpgradeNotification({
      clientId: "client-1",
      tenantId: "tenant-1",
      newTier: "silver",
      totalPoints: 700,
    });

    expect(mockedSendWhatsApp).toHaveBeenCalledWith(
      "tenant-1",
      "5599999999999",
      "Oi, Ana! Agora você é Prata, com 700 pontos. Próximo: Ouro.",
    );
  });
});
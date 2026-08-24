import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbSelect,
  mockDbInsert,
  mockSendReservationCancellationEmail,
  mockSendReminderHtmlEmail,
  mockGetCancellationEmailQueue,
  mockInsertClientNotification,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockSendReservationCancellationEmail: vi.fn(),
  mockSendReminderHtmlEmail: vi.fn(),
  mockGetCancellationEmailQueue: vi.fn(),
  mockInsertClientNotification: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
  },
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
  eq: vi.fn(() => "eq"),
  and: vi.fn(() => "and"),
  inArray: vi.fn(() => "inArray"),
  isNull: vi.fn(() => "isNull"),
}));

vi.mock("@workspace/email", () => ({
  sendReservationConfirmationEmail: vi.fn(),
  sendReservationCancellationEmail: mockSendReservationCancellationEmail,
  sendWelcomeCredentialsEmail: vi.fn(),
  sendNewBookingNotificationEmail: vi.fn(),
  sendReferralBonusPaidEmail: vi.fn(),
  sendReferralConvertedEmail: vi.fn(),
  sendReferralExpiredEmail: vi.fn(),
  sendReferralExpiringSoonEmail: vi.fn(),
  sendReferralBonusReleasedEmail: vi.fn(),
  sendReferralWelcomeEmail: vi.fn(),
  sendReferralTierUpgradeEmail: vi.fn(),
  sendReferralReversedEmail: vi.fn(),
  sendReminderHtmlEmail: mockSendReminderHtmlEmail,
  sendReferralCodeSuspendedEmail: vi.fn(),
  sendAgencySuspendedEmail: vi.fn(),
  sendAgencyReactivatedEmail: vi.fn(),
  sendReferralLoyaltyPointsEmail: vi.fn(),
  sendPixOrderAlertEmail: vi.fn(),
}));

vi.mock("../queues/index.js", () => ({
  getEmailQueue: vi.fn(),
  getCancellationEmailQueue: mockGetCancellationEmailQueue,
  getNewBookingNotificationEmailQueue: vi.fn(),
  getReferralEmailQueue: vi.fn(),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "email-log-1"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/redis.js", () => ({
  areWorkersEnabled: vi.fn(() => false),
}));

vi.mock("../lib/client-notifications.js", () => ({
  insertClientNotification: mockInsertClientNotification,
}));

vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppReferralReversed: vi.fn(),
}));

import {
  dispatchTripRestorationNotification,
  enqueueReservationCancellationEmail,
} from "../queues/email-helpers.js";

function makeSelectQuery(row: Record<string, unknown>) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };

  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue([row]);
  return query;
}

function setReservationRow(overrides: Record<string, unknown> = {}) {
  const row = {
    reservationNumber: "RES-2026-0042",
    voucherCode: "VCHR-0042",
    totalValue: "1250.50",
    clientName: "João da Silva",
    clientEmail: "joao@example.com",
    tripName: "Rota das Falésias",
    tripDestination: "Canoa Quebrada",
    departureDate: new Date("2026-08-01T12:00:00.000Z"),
    agencyName: "Cariri Turismo",
    agencyLogo: "https://cdn.example/logo.png",
    agencyPhone: "(88) 99999-1234",
    agencyPhoneVoice: "(88) 3333-1234",
    agencyEmail: "contato@cariri.example",
    agencyWebsite: "https://cariri.example",
    tenantSlug: "cariri-turismo",
    ...overrides,
  };

  mockDbSelect.mockReturnValue(makeSelectQuery(row));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCancellationEmailQueue.mockReturnValue(null);
  mockDbInsert.mockReturnValue({
    values: vi.fn().mockResolvedValue([]),
  });
});


describe("enqueueReservationCancellationEmail", () => {
  it("sends the cancellation email with Portuguese date formatting and agency details", async () => {
    setReservationRow();
    mockSendReservationCancellationEmail.mockResolvedValue({
      success: true,
      messageId: "message-1",
    });

    await enqueueReservationCancellationEmail("reservation-1", "tenant-1");

    expect(mockSendReservationCancellationEmail).toHaveBeenCalledWith({
      reservationNumber: "RES-2026-0042",
      voucherCode: "VCHR-0042",
      clientName: "João da Silva",
      clientEmail: "joao@example.com",
      tripTitle: "Rota das Falésias",
      destination: "Canoa Quebrada",
      departureDate: "01/08/2026",
      totalAmount: 1250.5,
      agencyName: "Cariri Turismo",
      agencyLogo: "https://cdn.example/logo.png",
      agencyPhone: "(88) 99999-1234",
      agencyEmail: "contato@cariri.example",
      agencyWebsite: "https://cariri.example",
      whatsappUrl: "https://wa.me/88999991234",
    });
    expect(mockDbInsert).toHaveBeenCalledWith(expect.anything());
  });

  it("skips sending and logging when the client has no email address", async () => {
    setReservationRow({ clientEmail: null });

    await expect(
      enqueueReservationCancellationEmail("reservation-without-email", "tenant-1"),
    ).resolves.toBeUndefined();

    expect(mockSendReservationCancellationEmail).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});

describe("dispatchTripRestorationNotification", () => {
  function setTripRestorationRow(overrides: Record<string, unknown> = {}) {
    const row = {
      reservationNumber: "RES-2026-0042",
      voucherCode: "VCHR-0042",
      clientId: "client-1",
      clientName: "João da Silva",
      clientEmail: "joao@example.com",
      tripName: "Rota das Falésias",
      destination: "Canoa Quebrada",
      departureDate: new Date("2026-08-01T12:00:00.000Z"),
      agencyName: "Cariri Turismo",
      ...overrides,
    };
    mockDbSelect.mockReturnValue(makeSelectQuery(row));
  }

  it("writes the portal notice and sends an email that says the old booking remains cancelled", async () => {
    setTripRestorationRow();
    mockSendReminderHtmlEmail.mockResolvedValue({ success: true, messageId: "message-2" });

    await dispatchTripRestorationNotification("reservation-1", "tenant-1");

    expect(mockInsertClientNotification).toHaveBeenCalledWith("client-1", "tenant-1", "trip_restored", {
      title: "Viagem retomada — faça uma nova reserva",
      tripName: "Rota das Falésias",
      destination: "Canoa Quebrada",
      departureDate: "01/08/2026",
      reservationNumber: "RES-2026-0042",
      agencyName: "Cariri Turismo",
    });
    expect(mockSendReminderHtmlEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "joao@example.com",
      subject: "Viagem retomada — Rota das Falésias",
      fromName: "Cariri Turismo",
      html: expect.stringContaining("continua cancelada e não foi reativada automaticamente"),
    }));
    expect(mockDbInsert).toHaveBeenCalledWith(expect.anything());
  });

  it("keeps the portal notice when the client has no email address", async () => {
    setTripRestorationRow({ clientEmail: null });

    await dispatchTripRestorationNotification("reservation-without-email", "tenant-1");

    expect(mockInsertClientNotification).toHaveBeenCalledOnce();
    expect(mockSendReminderHtmlEmail).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});
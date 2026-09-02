import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockDispatchOutboundMessage,
  mockRetryOutboundDelivery,
  mockGetCancellationEmailQueue,
  mockInsertClientNotification,
  mockInsertValues,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDispatchOutboundMessage: vi.fn(),
  mockRetryOutboundDelivery: vi.fn(),
  mockGetCancellationEmailQueue: vi.fn(),
  mockInsertClientNotification: vi.fn(),
  mockInsertValues: [] as unknown[],
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
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

vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: mockDispatchOutboundMessage,
  retryOutboundDelivery: mockRetryOutboundDelivery,
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
  dispatchReferralReversedEmail,
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
  mockInsertValues.length = 0;
  mockGetCancellationEmailQueue.mockReturnValue(null);
  mockDbInsert.mockImplementation(() => ({
    values: vi.fn((values: unknown) => {
      mockInsertValues.push(values);
      return Promise.resolve([]);
    }),
  }));
  mockDbUpdate.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
  });
  mockRetryOutboundDelivery.mockResolvedValue(undefined);
  mockDispatchOutboundMessage.mockResolvedValue({
    created: true,
    message: { status: "accepted" },
    deliveries: [
      { channel: "email", status: "accepted", externalId: "message-1" },
      { channel: "whatsapp", status: "skipped", skippedReason: "whatsapp_address_missing" },
    ],
  });
});

it("reopens a failed reversal delivery on a repeated callback without creating a second outbound message", async () => {
  const referrer = {
    name: "Indicador",
    email: "indicador@example.com",
    referralEarnings: "100.00",
  };
  const tenant = { name: "Agência", logoUrl: null };
  const referred = { name: "Viajante" };
  mockDbSelect
    .mockReturnValueOnce(makeSelectQuery(referrer))
    .mockReturnValueOnce(makeSelectQuery(tenant))
    .mockReturnValueOnce(makeSelectQuery(referred))
    .mockReturnValueOnce(makeSelectQuery(referrer))
    .mockReturnValueOnce(makeSelectQuery(tenant))
    .mockReturnValueOnce(makeSelectQuery(referred));
  mockDispatchOutboundMessage.mockResolvedValueOnce({
    created: true,
    message: { id: "message-reversal", status: "accepted" },
    deliveries: [
      { id: "delivery-reversal", channel: "email", status: "accepted", externalId: "message-1" },
      { id: "delivery-whatsapp", channel: "whatsapp", status: "skipped", skippedReason: "whatsapp_address_missing" },
    ],
  }).mockResolvedValueOnce({
    created: false,
    message: { status: "failed" },
    deliveries: [
      { id: "delivery-reversal", channel: "email", status: "failed" },
      { id: "delivery-whatsapp", channel: "whatsapp", status: "skipped" },
    ],
  });

  const callback = {
    referrerId: "client-referrer",
    referredId: "client-referred",
    bonusAmount: "25.00",
    tenantId: "tenant-1",
    reason: "payment_refunded",
    referralId: "referral-1",
    reservationId: "reservation-1",
  };
  await dispatchReferralReversedEmail(callback);
  await dispatchReferralReversedEmail(callback);

  expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(2);
  expect(mockDispatchOutboundMessage.mock.calls[0][0]).toEqual(expect.objectContaining({
    idempotencyKey: "referral:referral-1:reversed",
    metadata: expect.objectContaining({
      referralId: "referral-1",
      reservationId: "reservation-1",
    }),
  }));
  expect(mockDispatchOutboundMessage.mock.calls[1][0]).toEqual(expect.objectContaining({
    idempotencyKey: "referral:referral-1:reversed",
    metadata: expect.objectContaining({
      referralId: "referral-1",
      reservationId: "reservation-1",
    }),
  }));
  expect(mockRetryOutboundDelivery).toHaveBeenCalledWith("tenant-1", "delivery-reversal");
  expect(mockRetryOutboundDelivery).toHaveBeenCalledOnce();
  expect(mockDbInsert).toHaveBeenCalledOnce();
  expect(mockInsertValues).toEqual([expect.objectContaining({
    tenantId: "tenant-1",
    referralId: "referral-1",
    reservationId: "reservation-1",
    outboundMessageId: "message-reversal",
  })]);
  expect(mockDbUpdate).toHaveBeenCalledOnce();
});


describe("enqueueReservationCancellationEmail", () => {
  it("sends the cancellation email with Portuguese date formatting and agency details", async () => {
    setReservationRow();
    await enqueueReservationCancellationEmail("reservation-1", "tenant-1");

    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      eventType: "reservation_cancellation",
      idempotencyKey: "reservation:reservation-1:cancellation",
      recipient: { type: "direct", name: "João da Silva", email: "joao@example.com" },
      email: expect.objectContaining({
        subject: "Reserva Cancelada — RES-2026-0042",
        senderName: "Cariri Turismo",
        html: expect.stringContaining("Canoa Quebrada"),
      }),
      whatsapp: expect.objectContaining({ text: expect.stringContaining("RES-2026-0042") }),
      metadata: { reservationId: "reservation-1" },
    }));
    expect(mockDbInsert).toHaveBeenCalledWith(expect.anything());
  });

  it("skips sending and logging when the client has no email address", async () => {
    setReservationRow({ clientEmail: null });

    await expect(
      enqueueReservationCancellationEmail("reservation-without-email", "tenant-1"),
    ).resolves.toBeUndefined();

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
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
    await dispatchTripRestorationNotification("reservation-1", "tenant-1");

    expect(mockInsertClientNotification).toHaveBeenCalledWith("client-1", "tenant-1", "trip_restored", {
      title: "Viagem retomada — faça uma nova reserva",
      tripName: "Rota das Falésias",
      destination: "Canoa Quebrada",
      departureDate: "01/08/2026",
      reservationNumber: "RES-2026-0042",
      agencyName: "Cariri Turismo",
    });
    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      eventType: "trip_restoration",
      idempotencyKey: "reservation:reservation-1:trip-restoration",
      email: expect.objectContaining({
        subject: "Viagem retomada — Rota das Falésias",
        senderName: "Cariri Turismo",
        html: expect.stringContaining("continua cancelada e não foi reativada automaticamente"),
      }),
      whatsapp: expect.objectContaining({ text: expect.stringContaining("continua cancelada") }),
    }));
    expect(mockDbInsert).toHaveBeenCalledWith(expect.anything());
  });

  it("keeps the portal notice when the client has no email address", async () => {
    setTripRestorationRow({ clientEmail: null });

    await dispatchTripRestorationNotification("reservation-without-email", "tenant-1");

    expect(mockInsertClientNotification).toHaveBeenCalledOnce();
    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});
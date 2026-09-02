import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockLocalToday,
  mockDispatchOutboundMessage,
  mockNotificationSettings,
  mockGte,
  mockLt,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockLocalToday: vi.fn(),
  mockDispatchOutboundMessage: vi.fn(),
  mockNotificationSettings: vi.fn(),
  mockGte: vi.fn(),
  mockLt: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: { select: mockSelect },
  };
});

vi.mock("@workspace/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/shared")>();
  return { ...actual, localToday: mockLocalToday };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    gte: (column: unknown, value: unknown) => {
      mockGte(column, value);
      return actual.gte(column as never, value as never);
    },
    lt: (column: unknown, value: unknown) => {
      mockLt(column, value);
      return actual.lt(column as never, value as never);
    },
  };
});

vi.mock("../queues/whatsapp-helpers.js", () => ({
  getWhatsAppNotificationSettings: mockNotificationSettings,
}));

vi.mock("../services/checkout/reservation-confirmation-outbox.js", () => ({
  resetStaleReservationReminderClaims: vi.fn().mockResolvedValue(0),
  deliverReservationReminderOnce: vi.fn(async ({ deliver }: { deliver: () => Promise<unknown> }) => {
    await deliver();
    return "sent";
  }),
}));

vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: mockDispatchOutboundMessage,
  htmlToWhatsAppText: (html: string) => html.replace(/<[^>]+>/g, ""),
}));

import {
  processBoardingReminders,
  processWhatsAppPagamentoPendente,
} from "../workers/reminder.worker.js";

function selectRows(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockResolvedValue(rows);
  return chain;
}

const departureAtBrazilMidnight = new Date("2026-08-23T03:00:00.000Z");
const departureAtBrazilD7 = new Date("2026-08-29T03:00:00.000Z");

function outboundSnapshot(status: "accepted" | "pending" | "failed") {
  return {
    message: { id: "outbound-message-001", status },
    deliveries: [
      { id: "email-delivery-001", channel: "email", status },
      { id: "whatsapp-delivery-001", channel: "whatsapp", status },
    ],
    created: true,
  };
}

describe("reminder worker Brazil calendar dates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 02:59:59 UTC is still 22/08 at 23:59:59 in America/Sao_Paulo.
    vi.setSystemTime(new Date("2026-08-23T02:59:59.000Z"));
    vi.clearAllMocks();
    mockLocalToday.mockReturnValue("2026-08-22");
    mockDispatchOutboundMessage.mockResolvedValue(outboundSnapshot("accepted"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the D-1 boarding reminder for the next Brazil calendar day", async () => {
    mockSelect.mockReturnValueOnce(selectRows([{
      reservationId: "reservation-1",
      tenantId: "tenant-1",
      tripName: "Excursão",
      tripDestination: "Maceió",
      departureDate: departureAtBrazilMidnight,
      boardingPoints: [],
      clientEmail: null,
      agencyName: "Agência Teste",
    }]));
    mockNotificationSettings.mockResolvedValue({
      boardingReminderDaysBeforeTrip: [1],
    });

    await processBoardingReminders();

    expect(mockLocalToday).toHaveBeenCalled();
    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      eventType: "boarding_reminder",
      metadata: { reservationId: "reservation-1", daysUntilDeparture: 1 },
    }));
  });

  it("fires a D-7 boarding reminder when the tenant configures day 7", async () => {
    mockSelect.mockReturnValueOnce(selectRows([{
      reservationId: "reservation-d7",
      tenantId: "tenant-1",
      tripName: "Excursão",
      tripDestination: "Maceió",
      departureDate: departureAtBrazilD7,
      boardingPoints: [],
      clientEmail: null,
      agencyName: "Agência Teste",
    }]));
    mockNotificationSettings.mockResolvedValue({
      boardingReminderDaysBeforeTrip: [7],
    });

    await processBoardingReminders();

    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      eventType: "boarding_reminder",
      metadata: { reservationId: "reservation-d7", daysUntilDeparture: 7 },
    }));
  });

  it("skips a D-7 boarding reminder when the tenant only configures day 1", async () => {
    mockSelect.mockReturnValueOnce(selectRows([{
      reservationId: "reservation-d7-skipped",
      tenantId: "tenant-1",
      tripName: "Excursão",
      tripDestination: "Maceió",
      departureDate: departureAtBrazilD7,
      boardingPoints: [],
      clientEmail: null,
      agencyName: "Agência Teste",
    }]));
    mockNotificationSettings.mockResolvedValue({
      boardingReminderDaysBeforeTrip: [1],
    });

    await processBoardingReminders();

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });

  it("queries only the D-1 through D-14 window, excluding reservations from D-15 onward", async () => {
    mockSelect.mockReturnValueOnce(selectRows([]));

    await processBoardingReminders();

    expect(mockGte).toHaveBeenCalledWith(
      expect.anything(),
      new Date("2026-08-23T03:00:00.000Z"),
    );
    expect(mockLt).toHaveBeenCalledWith(
      expect.anything(),
      new Date("2026-09-06T03:00:00.000Z"),
    );
    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });

  it("fires the pending-payment reminder for the next Brazil calendar day", async () => {
    mockSelect.mockReturnValueOnce(selectRows([{
      reservationId: "reservation-2",
      tenantId: "tenant-1",
      balance: "175.50",
      tripName: "Excursão",
      tripDestination: "Maceió",
      departureDate: departureAtBrazilMidnight,
      agencyName: "Agência Teste",
    }]));
    mockNotificationSettings.mockResolvedValue({
      pagamentoPendente: true,
      pagamentoPendenteDaysBeforeTrip: 1,
    });

    await processWhatsAppPagamentoPendente();

    expect(mockLocalToday).toHaveBeenCalled();
    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      eventType: "payment_pending",
      metadata: { reservationId: "reservation-2", daysUntilDeparture: 1 },
      email: expect.objectContaining({ subject: expect.stringContaining("Maceió") }),
      whatsapp: expect.objectContaining({ text: expect.stringContaining("175,50") }),
    }));
  });

  it("does not dispatch a pending-payment reminder for a trip without a departure date", async () => {
    mockSelect.mockReturnValueOnce(selectRows([{
      reservationId: "reservation-without-departure",
      tenantId: "tenant-1",
      balance: "175.50",
      tripName: "Excursão em rascunho",
      tripDestination: "Maceió",
      departureDate: null,
      agencyName: "Agência Teste",
    }]));
    mockNotificationSettings.mockResolvedValue({
      pagamentoPendente: true,
      pagamentoPendenteDaysBeforeTrip: 1,
    });

    await processWhatsAppPagamentoPendente();

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });
});
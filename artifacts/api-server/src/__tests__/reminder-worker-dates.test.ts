import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockLocalToday,
  mockDispatchBoarding,
  mockDispatchPagamentoPendente,
  mockNotificationSettings,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockLocalToday: vi.fn(),
  mockDispatchBoarding: vi.fn(),
  mockDispatchPagamentoPendente: vi.fn(),
  mockNotificationSettings: vi.fn(),
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

vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppBoardingReminder: mockDispatchBoarding,
  dispatchWhatsAppPagamentoPendente: mockDispatchPagamentoPendente,
  getWhatsAppNotificationSettings: mockNotificationSettings,
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

describe("reminder worker Brazil calendar dates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 02:59:59 UTC is still 22/08 at 23:59:59 in America/Sao_Paulo.
    vi.setSystemTime(new Date("2026-08-23T02:59:59.000Z"));
    vi.clearAllMocks();
    mockLocalToday.mockReturnValue("2026-08-22");
    mockDispatchBoarding.mockResolvedValue(undefined);
    mockDispatchPagamentoPendente.mockResolvedValue(undefined);
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
    expect(mockDispatchBoarding).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: "reservation-1",
      tenantId: "tenant-1",
      tripName: "Maceió",
      departureDate: "23/08/2026",
    }));
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
    expect(mockDispatchPagamentoPendente).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: "reservation-2",
      tenantId: "tenant-1",
      tripName: "Maceió",
      departureDate: "23/08/2026",
      remainingBalance: 175.5,
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

    expect(mockDispatchPagamentoPendente).not.toHaveBeenCalled();
  });
});
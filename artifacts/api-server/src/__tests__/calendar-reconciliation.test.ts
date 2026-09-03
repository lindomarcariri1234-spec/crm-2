import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  tables,
  rowsByTable,
  mockListEvents,
  mockInsertValues,
  mockInsertConflict,
  mockUpdateWhere,
} = vi.hoisted(() => {
  const makeTable = (columns: string[]) => Object.fromEntries(columns.map((column) => [column, `${column}.column`]));
  const tables = {
    usersTable: makeTable(["id", "tenantId", "googleCalendarEnabled"]),
    calendarEventsTable: makeTable(["tenantId", "userId", "googleEventId"]),
    calendarReconciliationsTable: makeTable(["id", "tenantId", "userId", "googleEventId", "eventType", "status", "candidateMatches"]),
    tripsTable: makeTable(["id", "tenantId"]),
    paymentsTable: makeTable(["id", "tenantId"]),
    clientsTable: makeTable(["id", "tenantId"]),
  };
  const rowsByTable = new Map<object, unknown[]>();
  const mockListEvents = vi.fn();
  const mockInsertValues = vi.fn(() => ({ onConflictDoNothing: mockInsertConflict }));
  const mockInsertConflict = vi.fn().mockResolvedValue([]);
  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  return { tables, rowsByTable, mockListEvents, mockInsertValues, mockInsertConflict, mockUpdateWhere };
});

vi.mock("@workspace/db", () => {
  const queryFor = (table: object) => {
    const promise = Promise.resolve(rowsByTable.get(table) ?? []);
    return Object.assign(promise, {
      limit: vi.fn(() => promise),
      orderBy: vi.fn(() => promise),
    });
  };
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: object) => ({
          where: vi.fn(() => queryFor(table)),
        })),
      })),
      insert: vi.fn(() => ({ values: mockInsertValues })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: mockUpdateWhere })) })),
    },
    ...tables,
  };
});

vi.mock("../lib/google-calendar/calendar-service.js", () => ({
  GoogleCalendarService: vi.fn(function (this: { listEvents: typeof mockListEvents }) {
    this.listEvents = mockListEvents;
  }),
  refreshTokenIfNeeded: vi.fn().mockResolvedValue("calendar-token"),
  withCalendarRetry: vi.fn((fn: () => unknown) => fn()),
}));

import {
  CalendarSyncService,
  legacyMatchesForEvent,
} from "../lib/google-calendar/sync-service.js";

const departure = new Date("2026-09-15T13:00:00.000Z");
const trip = {
  id: "trip-1",
  name: "Chapada",
  description: null,
  destination: "Lençóis",
  originCity: "Cariri",
  departureDate: departure,
  returnDate: new Date("2026-09-18T13:00:00.000Z"),
};

function markedTripEvent(id: string) {
  return {
    id,
    summary: "🚌 Chapada",
    description: "🚌 VIAGEM: Chapada\n\nDetalhes antigos",
    location: "Cariri → Lençóis",
    startDateTime: departure,
    endDateTime: trip.returnDate,
  };
}

describe("legacy calendar event matching", () => {
  it("does not treat an unmarked user event as a candidate", () => {
    expect(legacyMatchesForEvent({
      ...markedTripEvent("manual"),
      description: "Reunião sobre Chapada",
    }, [trip], [], [])).toEqual([]);
  });

  it("returns every exact match when the legacy event is ambiguous", () => {
    const secondTrip = { ...trip, id: "trip-2" };
    expect(legacyMatchesForEvent(markedTripEvent("legacy"), [trip, secondTrip], [], [])).toEqual([
      { id: "trip-1", type: "trip", label: "Chapada" },
      { id: "trip-2", type: "trip", label: "Chapada" },
    ]);
  });

  it("matches a birthday by month and day, not by the birth year", () => {
    const client = { id: "client-1", name: "Maria", birthDate: new Date("1990-09-15T13:00:00.000Z") };
    expect(legacyMatchesForEvent({
      id: "birthday-legacy",
      summary: "🎂 Aniversário: Maria",
      description: "Aniversário de Maria\n\nLembre-se de enviar felicitações!",
      startDateTime: new Date("2026-09-15T13:00:00.000Z"),
    }, [], [], [client])).toEqual([
      { id: "client-1", type: "birthday", label: "Aniversário de Maria" },
    ]);
  });
});

describe("CalendarSyncService.scanLegacyEvents", () => {
  beforeEach(() => {
    rowsByTable.clear();
    mockListEvents.mockReset();
    mockInsertValues.mockClear();
    mockUpdateWhere.mockClear();
  });

  it("queues ambiguous candidates and leaves an already resolved event untouched", async () => {
    const resolvedEvent = markedTripEvent("already-resolved");
    mockListEvents.mockResolvedValue([markedTripEvent("ambiguous"), resolvedEvent]);
    rowsByTable.set(tables.usersTable, [{ tenantId: "tenant-1", googleCalendarEnabled: true }]);
    rowsByTable.set(tables.calendarEventsTable, []);
    rowsByTable.set(tables.calendarReconciliationsTable, [{
      id: "reconciliation-1",
      googleEventId: "already-resolved",
      status: "associated",
      candidateMatches: [{ id: "trip-1", type: "trip", label: "Chapada" }],
    }]);
    rowsByTable.set(tables.tripsTable, [trip, { ...trip, id: "trip-2" }]);
    rowsByTable.set(tables.paymentsTable, []);
    rowsByTable.set(tables.clientsTable, []);

    const candidates = await CalendarSyncService.scanLegacyEvents("user-1");

    expect(candidates).toHaveLength(2);
    expect(candidates.find((candidate) => candidate.googleEventId === "ambiguous")?.candidateMatches).toHaveLength(2);
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    expect(mockUpdateWhere).not.toHaveBeenCalled();
  });
});
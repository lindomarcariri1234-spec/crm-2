/**
 * Unit tests for getDriftSnapshot() in lib/seat-reconciliation.ts
 *
 * getDriftSnapshot() is a read-only function that compares stored trip seat
 * counters (reservedSeats / confirmedSeats / availableSeats) against the
 * values computed from the actual reservation rows.  It never throws — it
 * swallows errors and returns { tripsChecked: 0, tripsWithDrift: 0 }.
 *
 * All DB calls use the chain  db.select(…).from(table).where(cond)
 * which is directly awaitable (no .limit()).  We queue responses so that
 * successive awaits consume the next item.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any import of the module under test
// ---------------------------------------------------------------------------

const { responseQueue, mockWhere, mockSelect } = vi.hoisted(() => {
  const responseQueue: unknown[][] = [];

  const mockWhere = vi.fn().mockImplementation(() =>
    Promise.resolve(responseQueue.shift() ?? []),
  );
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return { responseQueue, mockWhere, mockSelect };
});

vi.mock("@workspace/db", () => ({
  db: { select: mockSelect },
  reservationsTable: {},
  tripsTable: {},
  clientsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  ne: vi.fn(),
  lt: vi.fn(),
  inArray: vi.fn(),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getDriftSnapshot } from "../lib/seat-reconciliation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "trip-001",
    tenantId: "tenant-001",
    totalCapacity: 10,
    reservedSeats: 0,
    confirmedSeats: 0,
    availableSeats: 10,
    freePassengers: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getDriftSnapshot()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseQueue.length = 0;
    mockWhere.mockImplementation(() =>
      Promise.resolve(responseQueue.shift() ?? []),
    );
  });

  it("returns tripsChecked=0 and tripsWithDrift=0 when no active trips exist", async () => {
    responseQueue.push([]); // activeTrips query

    const result = await getDriftSnapshot();

    expect(result.tripsChecked).toBe(0);
    expect(result.tripsWithDrift).toBe(0);
  });

  it("returns tripsWithDrift=0 when stored counters match the computed values", async () => {
    const trip = makeTrip({ reservedSeats: 2, confirmedSeats: 1, availableSeats: 7 });
    responseQueue.push([trip]); // activeTrips
    // reservations: 2 pending (reserved) + 1 confirmed  → computed matches stored
    responseQueue.push([
      { status: "pending", seats: ["A1", "A2"] },
      { status: "confirmed", seats: ["B1"] },
    ]);

    const result = await getDriftSnapshot();

    expect(result.tripsChecked).toBe(1);
    expect(result.tripsWithDrift).toBe(0);
  });

  it("detects drift when stored reservedSeats differs from computed", async () => {
    // stored says 5 reserved, but only 2 reservation seats exist
    const trip = makeTrip({ reservedSeats: 5, confirmedSeats: 0, availableSeats: 5 });
    responseQueue.push([trip]);
    responseQueue.push([{ status: "pending", seats: ["A1", "A2"] }]);

    const result = await getDriftSnapshot();

    expect(result.tripsChecked).toBe(1);
    expect(result.tripsWithDrift).toBe(1);
  });

  it("detects drift when stored confirmedSeats differs from computed", async () => {
    // stored says 3 confirmed, but only 1 confirmed reservation exists
    const trip = makeTrip({ reservedSeats: 0, confirmedSeats: 3, availableSeats: 7 });
    responseQueue.push([trip]);
    responseQueue.push([{ status: "confirmed", seats: ["C1"] }]);

    const result = await getDriftSnapshot();

    expect(result.tripsChecked).toBe(1);
    expect(result.tripsWithDrift).toBe(1);
  });

  it("detects drift when stored availableSeats differs from computed", async () => {
    // capacity=10, 0 pending, 0 confirmed, 0 free → available should be 10
    // stored availableSeats=8 → drift
    const trip = makeTrip({ reservedSeats: 0, confirmedSeats: 0, availableSeats: 8 });
    responseQueue.push([trip]);
    responseQueue.push([]); // no active reservations

    const result = await getDriftSnapshot();

    expect(result.tripsChecked).toBe(1);
    expect(result.tripsWithDrift).toBe(1);
  });

  it("correctly counts drift across multiple trips", async () => {
    const cleanTrip = makeTrip({
      id: "trip-clean",
      reservedSeats: 2,
      confirmedSeats: 0,
      availableSeats: 8,
    });
    const driftTrip = makeTrip({
      id: "trip-drift",
      reservedSeats: 99,
      confirmedSeats: 0,
      availableSeats: 1,
    });

    responseQueue.push([cleanTrip, driftTrip]); // activeTrips
    responseQueue.push([{ status: "pending", seats: ["X1", "X2"] }]); // clean trip reservations
    responseQueue.push([{ status: "pending", seats: ["Y1"] }]);       // drift trip reservations

    const result = await getDriftSnapshot();

    expect(result.tripsChecked).toBe(2);
    expect(result.tripsWithDrift).toBe(1);
  });

  it("counts freePassengers when computing available seats", async () => {
    // capacity=10, 2 free passengers, 0 reservations → computed available = 8
    // stored availableSeats=10 → drift
    const trip = makeTrip({
      reservedSeats: 0,
      confirmedSeats: 0,
      availableSeats: 10,
      freePassengers: [{ seatNumber: "F1" }, { seatNumber: "F2" }],
    });
    responseQueue.push([trip]);
    responseQueue.push([]); // no reservations

    const result = await getDriftSnapshot();

    expect(result.tripsChecked).toBe(1);
    expect(result.tripsWithDrift).toBe(1);
  });

  it("swallows a DB error and returns { tripsChecked: 0, tripsWithDrift: 0 }", async () => {
    mockWhere.mockRejectedValueOnce(new Error("db connection failed"));

    const result = await getDriftSnapshot();

    expect(result.tripsChecked).toBe(0);
    expect(result.tripsWithDrift).toBe(0);
  });
});

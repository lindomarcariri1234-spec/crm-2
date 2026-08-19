/**
 * Commission revival regression tests — syncReservationCommission
 *
 * Verifies that when a previously cancelled commission exists for a seller
 * on a reservation that is subsequently reopened, syncReservationCommission
 * revives it back to "pending" with updated amounts instead of silently
 * leaving it in "cancelled" state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockUpdate,
  mockInsert,
  mockDelete,
  selectQueue,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const mockUpdate = vi.fn();
  const mockInsert = vi.fn();
  const mockDelete = vi.fn();
  return { mockUpdate, mockInsert, mockDelete, selectQueue };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => {
  function makeSelect() {
    const value = (selectQueue as unknown[][]).shift() ?? [];
    const limitFn = vi.fn().mockResolvedValue(value.slice(0, 1));
    return {
      from: vi.fn(() => ({
        where: vi.fn(() =>
          Object.assign(Promise.resolve(value), { limit: limitFn }),
        ),
        limit: limitFn,
      })),
    };
  }

  const setFn = vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) }));
  mockUpdate.mockReturnValue({ set: setFn });
  mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
  mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

  return {
    db: {
      select: vi.fn(makeSelect),
      update: mockUpdate,
      insert: mockInsert,
      delete: mockDelete,
    },
    reservationsTable: { id: "id", tenantId: "tenantId", status: "status" },
    usersTable: { id: "id", tenantId: "tenantId", role: "role" },
    commissionsTable: {
      id: "id",
      tenantId: "tenantId",
      reservationId: "reservationId",
      userId: "userId",
      status: "status",
    },
    commissionRulesTable: { tenantId: "tenantId", isActive: "isActive", appliesTo: "appliesTo", tripId: "tripId" },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col, val) => `eq:${String(val)}`),
  and: vi.fn((...args) => args),
  inArray: vi.fn(() => "inArray"),
}));

vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "new-commission-id") }));

vi.mock("../routes/loyalty.js", () => ({ syncMonthlyGoalProgress: vi.fn().mockResolvedValue(undefined) }));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { syncReservationCommission } from "../routes/payments.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = "tenant-001";
const RESERVATION_ID = "res-001";
const SELLER_ID = "seller-001";

function makeReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: RESERVATION_ID,
    tenantId: TENANT_ID,
    status: "confirmed",
    totalValue: "1000.00",
    paidValue: "1000.00",
    commissionAmount: "100.00",  // direct commission path
    sellerId: SELLER_ID,
    createdById: "creator-001",
    tripId: "trip-001",
    ...overrides,
  };
}

function makeSeller() {
  return { id: SELLER_ID };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncReservationCommission — commission revival", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    vi.clearAllMocks();

    // Re-bind mocks after clearAllMocks
    const setFn = vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) }));
    mockUpdate.mockReturnValue({ set: setFn });
    mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  });

  it("revives a cancelled commission to pending when the reservation is reopened", async () => {
    // Select queue: [reservation], [seller], [existing commissions]
    selectQueue.push(
      [makeReservation()],              // reservation fetch
      [makeSeller()],                   // seller validation
      [{ id: "comm-001", status: "cancelled", userId: SELLER_ID }], // existing commissions
    );

    await syncReservationCommission(RESERVATION_ID, TENANT_ID);

    // update should have been called (to revive cancelled → pending)
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // Verify the set payload includes status: "pending"
    const setArg = mockUpdate.mock.results[0].value.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.status).toBe("pending");
    expect(setArg.commissionAmount).toBe("100.00");

    // insert must NOT be called (we revived the existing row, not inserted a new one)
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("creates a new commission when none exists (normal path unaffected)", async () => {
    selectQueue.push(
      [makeReservation()],  // reservation fetch
      [makeSeller()],        // seller validation
      [],                    // no existing commissions
    );

    await syncReservationCommission(RESERVATION_ID, TENANT_ID);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does NOT touch an approved commission when the reservation is reopened", async () => {
    selectQueue.push(
      [makeReservation()],
      [makeSeller()],
      [{ id: "comm-001", status: "approved", userId: SELLER_ID }],
    );

    await syncReservationCommission(RESERVATION_ID, TENANT_ID);

    // Neither insert nor update should be called for an approved commission
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does NOT touch a paid commission when the reservation is reopened", async () => {
    selectQueue.push(
      [makeReservation()],
      [makeSeller()],
      [{ id: "comm-001", status: "paid", userId: SELLER_ID }],
    );

    await syncReservationCommission(RESERVATION_ID, TENANT_ID);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

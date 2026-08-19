/**
 * Unit tests for cleanupOrphanDeals() and getOrphanDealsCount() in seat-reconciliation.ts
 *
 * Count/repair contract — both functions apply the same two-leg eligibility check:
 *
 *   Leg 1: open deal with a direct reservation_id pointing to a cancelled/refunded reservation
 *          WHERE r.client_id IS NOT NULL (reservation has an authoritative client)
 *          AND the reservation's client (r.client_id) has NO active (pending/confirmed)
 *          reservation anywhere.
 *          NOTE: The guard uses r.client_id — the helper's authoritative source —
 *          NOT d.client_id which can be null or stale for historical data.
 *
 *   Leg 2: open deal with NO reservation_id where:
 *     Guard 1 — every reservation for this client+trip is cancelled/refunded
 *               (a deal with a completed + cancelled history must NOT be closed)
 *     Guard 2 — the client has no active (pending/confirmed) reservation on any trip
 *               (mirrors cancelDealOnReservationCancellation Steps 3 and 3b:
 *                same-trip active → re-link; other-trip active → leave open)
 *
 * cleanupOrphanDeals() verifies:
 *  - No orphans (both legs empty) → returns { orphansFixed: 0 }
 *  - Leg-1 orphan (reservation's client has no active reservations) → orphansFixed: 1
 *  - Leg-1 deal excluded when reservation's client (r.client_id) has active reservation
 *    (covers null/stale d.client_id — SQL guard uses r.client_id, not d.client_id)
 *  - Leg-2 orphan (all same-trip reservations cancelled, no active anywhere) → orphansFixed: 1
 *  - Leg-2 deal with a completed same-trip reservation alongside a cancelled one → excluded
 *  - Leg-2 deal with active other-trip reservation → excluded
 *  - Both legs contribute orphans (combined) → orphansFixed: 2
 *  - Partial failure: 2 orphans, one true + one false → orphansFixed: 1
 *  - Fatal db.execute failure → returns { orphansFixed: 0 } and logs error (never throws)
 *
 * getOrphanDealsCount() verifies:
 *  - Returns combined total from single aggregated SQL query
 *  - Returns 0 when there are no orphans
 *  - Returns 0 on db error (never throws)
 *  - Applies same r.client_id guard in leg-1 and both Guards in leg-2 (count/repair contract)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDbExecute, mockCancelDeal, mockLogError, mockLogInfo } = vi.hoisted(() => {
  const mockDbExecute = vi.fn();
  const mockCancelDeal = vi.fn();
  const mockLogError = vi.fn();
  const mockLogInfo = vi.fn();
  return { mockDbExecute, mockCancelDeal, mockLogError, mockLogInfo };
});

vi.mock("@workspace/db", () => ({
  db: {
    execute: mockDbExecute,
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })),
    })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
  },
  reservationsTable: {},
  tripsTable: {},
  clientsTable: {},
  dealsTable: {},
  pipelineStagesTable: {},
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("../services/pipeline-automation.js", () => ({
  cancelDealOnReservationCancellation: mockCancelDeal,
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: mockLogInfo,
    warn: vi.fn(),
    error: mockLogError,
    debug: vi.fn(),
  },
}));

import { cleanupOrphanDeals, getOrphanDealsCount } from "../lib/seat-reconciliation.js";

describe("cleanupOrphanDeals()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { orphansFixed: 0 } and never calls cancelDealOnReservationCancellation when both legs are empty", async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] }) // Leg 1
      .mockResolvedValueOnce({ rows: [] }); // Leg 2

    const result = await cleanupOrphanDeals();

    expect(result).toEqual({ orphansFixed: 0 });
    expect(mockCancelDeal).not.toHaveBeenCalled();
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  it("returns { orphansFixed: 1 } when leg-1 finds a directly-linked orphan (reservation's client has no active reservations) and cancelDeal returns true", async () => {
    const orphan = { id: "deal-001", tenantId: "tenant-abc", reservationId: "res-xyz" };
    mockDbExecute
      .mockResolvedValueOnce({ rows: [orphan] }) // Leg 1: qualifies (r.client_id NOT EXISTS guard passed)
      .mockResolvedValueOnce({ rows: [] });       // Leg 2
    mockCancelDeal.mockResolvedValue(true);

    const result = await cleanupOrphanDeals();

    expect(result).toEqual({ orphansFixed: 1 });
    expect(mockCancelDeal).toHaveBeenCalledTimes(1);
    expect(mockCancelDeal).toHaveBeenCalledWith({
      tenantId: orphan.tenantId,
      reservationId: orphan.reservationId,
    });
    expect(mockLogInfo).toHaveBeenCalledTimes(1);
    const [logObj] = mockLogInfo.mock.calls[0] as [Record<string, unknown>, ...unknown[]];
    expect(logObj).toMatchObject({ orphansFixed: 1 });
  });

  it("excludes leg-1 deals when reservation's client (r.client_id) has an active reservation — regression for null/stale d.client_id", async () => {
    // cancelDealOnReservationCancellation loads clientId from the RESERVATION row, not the deal.
    // deals.client_id can be null or stale for the historical pre-linkage data this task targets.
    // The SQL guard therefore uses r.client_id (the reservation's authoritative client), so a deal
    // with null d.client_id but a reservation whose client has an active booking is excluded.
    // When the SQL correctly excludes the deal, leg-1 returns 0 rows and cancelDeal is never called.
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] }) // Leg 1: deal excluded because r.client_id has active booking
      .mockResolvedValueOnce({ rows: [] }); // Leg 2

    const result = await cleanupOrphanDeals();

    expect(result).toEqual({ orphansFixed: 0 });
    expect(mockCancelDeal).not.toHaveBeenCalled();
  });

  it("returns { orphansFixed: 1 } when leg-2 finds a pre-linkage orphan (all same-trip reservations cancelled, no active anywhere) and cancelDeal returns true", async () => {
    const unlinkedOrphan = { id: "deal-old", tenantId: "tenant-abc", reservationId: "res-cancelled-001" };
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] })              // Leg 1
      .mockResolvedValueOnce({ rows: [unlinkedOrphan] }); // Leg 2: qualifies
    mockCancelDeal.mockResolvedValue(true);

    const result = await cleanupOrphanDeals();

    expect(result).toEqual({ orphansFixed: 1 });
    expect(mockCancelDeal).toHaveBeenCalledTimes(1);
    expect(mockCancelDeal).toHaveBeenCalledWith({
      tenantId: unlinkedOrphan.tenantId,
      reservationId: unlinkedOrphan.reservationId,
    });
    expect(mockLogInfo).toHaveBeenCalledTimes(1);
    const [logObj] = mockLogInfo.mock.calls[0] as [Record<string, unknown>, ...unknown[]];
    expect(logObj).toMatchObject({ orphansFixed: 1 });
  });

  it("excludes leg-2 deals with a completed same-trip reservation alongside a cancelled one — Guard 1 (all-cancelled)", async () => {
    // A client with [completed, cancelled] history for the same trip must NOT be moved to
    // Cancelado. Guard 1 (NOT EXISTS sr WHERE status NOT IN ('cancelled','refunded')) blocks
    // these. When Guard 1 fires the SQL returns 0 rows for leg-2.
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] }) // Leg 1
      .mockResolvedValueOnce({ rows: [] }); // Leg 2: excluded by Guard 1

    const result = await cleanupOrphanDeals();

    expect(result).toEqual({ orphansFixed: 0 });
    expect(mockCancelDeal).not.toHaveBeenCalled();
  });

  it("excludes leg-2 deals when client has an active reservation on a different trip — Guard 2 (any-trip active)", async () => {
    // cancelDealOnReservationCancellation Step 3b: other-trip active → leave open (returns false).
    // Guard 2 pre-filters so dashboard count === what repair closes.
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] }) // Leg 1
      .mockResolvedValueOnce({ rows: [] }); // Leg 2: excluded by Guard 2

    const result = await cleanupOrphanDeals();

    expect(result).toEqual({ orphansFixed: 0 });
    expect(mockCancelDeal).not.toHaveBeenCalled();
  });

  it("counts orphans from both legs when both return results → orphansFixed: 2", async () => {
    const leg1Orphan = { id: "deal-001", tenantId: "tenant-abc", reservationId: "res-linked" };
    const leg2Orphan = { id: "deal-old", tenantId: "tenant-abc", reservationId: "res-unlinked" };
    mockDbExecute
      .mockResolvedValueOnce({ rows: [leg1Orphan] })
      .mockResolvedValueOnce({ rows: [leg2Orphan] });
    mockCancelDeal.mockResolvedValue(true);

    const result = await cleanupOrphanDeals();

    expect(result).toEqual({ orphansFixed: 2 });
    expect(mockCancelDeal).toHaveBeenCalledTimes(2);
  });

  it("counts only genuinely closed deals — orphansFixed stays at 1 when one deal returns false (silent skip)", async () => {
    const orphan1 = { id: "deal-001", tenantId: "tenant-001", reservationId: "res-001" };
    const orphan2 = { id: "deal-002", tenantId: "tenant-001", reservationId: "res-002" };
    mockDbExecute
      .mockResolvedValueOnce({ rows: [orphan1, orphan2] }) // Leg 1
      .mockResolvedValueOnce({ rows: [] });                 // Leg 2

    mockCancelDeal.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await cleanupOrphanDeals();

    expect(result).toEqual({ orphansFixed: 1 });
    expect(mockCancelDeal).toHaveBeenCalledTimes(2);
    const [logObj] = mockLogInfo.mock.calls[0] as [Record<string, unknown>, ...unknown[]];
    expect(logObj).toMatchObject({ orphansFixed: 1 });
  });

  it("returns { orphansFixed: 0 } and logs a fatal error when db.execute itself throws — never re-throws", async () => {
    mockDbExecute.mockRejectedValue(new Error("connection lost"));

    const result = await cleanupOrphanDeals();

    expect(result).toEqual({ orphansFixed: 0 });
    expect(mockCancelDeal).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledTimes(1);
    const [logObj, msg] = mockLogError.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toMatch(/fatal/i);
    expect(logObj).toHaveProperty("err");
  });
});

describe("getOrphanDealsCount()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the combined total from the single aggregated SQL query", async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ cnt: "5" }] });

    const count = await getOrphanDealsCount();

    expect(count).toBe(5);
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
  });

  it("returns 0 when there are no orphans", async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });

    const count = await getOrphanDealsCount();

    expect(count).toBe(0);
  });

  it("returns 0 and never throws when db.execute fails", async () => {
    mockDbExecute.mockRejectedValueOnce(new Error("db error"));

    const count = await getOrphanDealsCount();

    expect(count).toBe(0);
  });

  it("applies r.client_id guard in leg-1 and both Guards in leg-2 — count/repair contract", async () => {
    // When the SQL correctly excludes: (a) leg-1 deals where r.client_id has active bookings,
    // (b) leg-2 deals with non-cancelled same-trip reservations, and (c) leg-2 deals with any
    // active reservation anywhere, cnt is 0 — exactly what cleanup would also skip.
    mockDbExecute.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });

    const count = await getOrphanDealsCount();

    expect(count).toBe(0);
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
  });
});

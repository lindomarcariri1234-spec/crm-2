/**
 * Unit tests for cancelDealOnReservationCancellation() in pipeline-automation.ts
 *
 * Verifies:
 *  - Returns true when the "Cancelado" stage exists and the deal is moved to it + marked LOST
 *  - Returns true when the "Cancelado" stage is MISSING — auto-creates it, moves deal, marks LOST
 *  - Returns false (never throws) when an internal DB call fails — error logged for audit trail
 *  - Returns false without writing anything when no open deal is linked to the reservation
 *
 * db.select() calls are mocked with a per-test queue so each sequential call receives
 * the correct fixture regardless of query shape (.limit() vs direct .where() await).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted capture variables — must be in vi.hoisted so they resolve before mocks
// ---------------------------------------------------------------------------
const { mockInsertValues, mockUpdateSet, mockLogError, mockLogInfo } = vi.hoisted(() => {
  // Typed parameters give TS visibility into calls[0][0] without using Mock<A,B> generics.
  const mockInsertValues = vi.fn(async (_v: Record<string, unknown>) => [] as unknown[]);
  const mockUpdateSet = vi.fn((_payload: Record<string, unknown>) => ({
    where: vi.fn().mockResolvedValue([]),
  }));
  const mockLogError = vi.fn();
  const mockLogInfo = vi.fn();
  return { mockInsertValues, mockUpdateSet, mockLogError, mockLogInfo };
});

// ---------------------------------------------------------------------------
// db mock with queue-based select
// ---------------------------------------------------------------------------
interface FullChain extends Promise<unknown[]> {
  from(...args: unknown[]): FullChain;
  where(...args: unknown[]): FullChain;
  limit(n?: number): Promise<unknown[]>;
  orderBy(...args: unknown[]): Promise<unknown[]>;
}

function makeFullChain(data: unknown[]): FullChain {
  const p = Promise.resolve(data) as FullChain;
  p.from = vi.fn(() => makeFullChain(data));
  p.where = vi.fn(() => makeFullChain(data));
  p.limit = vi.fn().mockResolvedValue(data);
  p.orderBy = vi.fn().mockResolvedValue(data);
  return p;
}

let _selectQueue: unknown[][] = [];

function resetSelectQueue(responses: unknown[][]) {
  _selectQueue = [...responses];
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn((_fields?: unknown) => makeFullChain(_selectQueue.shift() ?? [])),
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({ set: mockUpdateSet })),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
  dealsTable: {},
  pipelineStagesTable: {},
  reservationsTable: {},
  tripsTable: {},
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: mockLogInfo,
    warn: vi.fn(),
    error: mockLogError,
    debug: vi.fn(),
  },
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "new-stage-id"),
}));

import { cancelDealOnReservationCancellation } from "../services/pipeline-automation.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TENANT_ID = "tenant-001";
const RESERVATION_ID = "res-cancelled-001";
const CLIENT_ID = "client-001";
const TRIP_ID = "trip-001";
const DEAL_ID = "deal-001";
const STAGE_ID = "stage-open-001";
const PIPELINE_ID = "pipeline-001";

/**
 * Select queue for the happy path where "Cancelado" stage already exists.
 *
 * Call order inside cancelDealOnReservationCancellation:
 *  1. Fetch cancelled reservation → { clientId, tripId }
 *  2. Find deal by reservationId → [deal]
 *  3. Active same-trip reservation check → [] (none)
 *  4. Active other-trip reservation check → [] (none)
 *  5. Get current stage → { pipelineId }
 *  6. Get "Cancelado" stage by name → found
 */
function selectQueueStageExists(): unknown[][] {
  return [
    [{ clientId: CLIENT_ID, tripId: TRIP_ID }],
    [{ id: DEAL_ID, stageId: STAGE_ID }],
    [],
    [],
    [{ pipelineId: PIPELINE_ID }],
    [{ id: "stage-cancelled-existing" }],
  ];
}

/**
 * Select queue for when "Cancelado" stage is missing.
 *  7. Max order query → { maxOrder: 30 } → new stage order = 40
 */
function selectQueueStageMissing(): unknown[][] {
  return [
    [{ clientId: CLIENT_ID, tripId: TRIP_ID }],
    [{ id: DEAL_ID, stageId: STAGE_ID }],
    [],
    [],
    [{ pipelineId: PIPELINE_ID }],
    [],                      // Cancelado stage not found
    [{ maxOrder: 30 }],     // max order for new stage creation
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("cancelDealOnReservationCancellation()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertValues.mockResolvedValue([]);
    mockUpdateSet.mockImplementation((_payload) => ({
      where: vi.fn().mockResolvedValue([]),
    }));
  });

  // ─── Cancelado stage exists ───────────────────────────────────────────────

  it("returns true and moves deal to existing 'Cancelado' stage marked LOST", async () => {
    resetSelectQueue(selectQueueStageExists());

    const result = await cancelDealOnReservationCancellation({ tenantId: TENANT_ID, reservationId: RESERVATION_ID });

    expect(result).toBe(true);
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      stageId: "stage-cancelled-existing",
      status: "lost",
    });
  });

  it("emits an audit log entry when a deal is moved to Cancelado", async () => {
    resetSelectQueue(selectQueueStageExists());

    await cancelDealOnReservationCancellation({ tenantId: TENANT_ID, reservationId: RESERVATION_ID });

    const infoCalls = mockLogInfo.mock.calls as [Record<string, unknown>, string][];
    const auditCall = infoCalls.find(([obj]) => obj.dealId === DEAL_ID && obj.reservationId === RESERVATION_ID);
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toMatch(/Cancelado/i);
  });

  // ─── Cancelado stage missing → auto-creation ─────────────────────────────

  it("returns true, auto-creates 'Cancelado' stage, then moves deal to it marked LOST", async () => {
    resetSelectQueue(selectQueueStageMissing());

    const result = await cancelDealOnReservationCancellation({ tenantId: TENANT_ID, reservationId: RESERVATION_ID });

    expect(result).toBe(true);

    // Stage was inserted with correct values
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      id: "new-stage-id",
      tenantId: TENANT_ID,
      pipelineId: PIPELINE_ID,
      name: "Cancelado",
      order: 40, // maxOrder 30 + 10
    });

    // Deal moved to new stage, marked LOST
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      stageId: "new-stage-id",
      status: "lost",
    });
  });

  it("logs audit entries for both the stage creation and the deal move", async () => {
    resetSelectQueue(selectQueueStageMissing());

    await cancelDealOnReservationCancellation({ tenantId: TENANT_ID, reservationId: RESERVATION_ID });

    const infoCalls = mockLogInfo.mock.calls as [Record<string, unknown>, string][];
    const creationLog = infoCalls.find(([obj]) => obj.stageId === "new-stage-id" && !obj.dealId);
    expect(creationLog).toBeDefined();
    expect(creationLog![1]).toMatch(/Created.*Cancelado/i);

    const moveLog = infoCalls.find(([obj]) => obj.dealId === DEAL_ID);
    expect(moveLog).toBeDefined();
  });

  // ─── Nested-error path: returns false + audit trail ──────────────────────

  it("returns false and logs the error when an internal DB call fails — never throws", async () => {
    // Make db.select throw on its first call (reservation lookup)
    const { db } = await import("@workspace/db");
    vi.mocked(db.select).mockImplementationOnce(() => {
      throw new Error("DB connection timeout");
    });

    const result = await cancelDealOnReservationCancellation({ tenantId: TENANT_ID, reservationId: RESERVATION_ID });

    // Returns false — caller (cleanupOrphanDeals) will not count this as fixed
    expect(result).toBe(false);
    // Audit trail: error logged with context
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError.mock.calls[0][0]).toMatchObject({
      err: expect.any(Error),
      tenantId: TENANT_ID,
      reservationId: RESERVATION_ID,
    });
    // Nothing was written
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  // ─── No open deal linked → early return false ─────────────────────────────

  it("returns false without writing anything when no open deal is linked to the reservation", async () => {
    resetSelectQueue([
      [{ clientId: CLIENT_ID, tripId: TRIP_ID }], // reservation found
      [],                                           // deal by reservationId → none
      [],                                           // deal by client+trip → none
    ]);

    const result = await cancelDealOnReservationCancellation({ tenantId: TENANT_ID, reservationId: RESERVATION_ID });

    expect(result).toBe(false);
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});

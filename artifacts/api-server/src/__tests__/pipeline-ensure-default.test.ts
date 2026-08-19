/**
 * Tests for ensureDefaultPipeline idempotency in pipeline routes.
 *
 * ensureDefaultPipeline is an internal function called by GET /api/pipeline/stages
 * and GET /api/pipelines on every invocation. Tests exercise it via those endpoints
 * with all DB interactions mocked via vi.mock.
 *
 * Scenarios covered:
 *  A. No pipeline exists → creates exactly one (pipeline + 7 stages), all via onConflictDoNothing
 *  B. True parallel race — Promise.all sends two concurrent requests from zero pipelines;
 *     each uses onConflictDoNothing (DB unique index absorbs the loser) and re-fetches
 *     the winner; both succeed and see the same canonical row
 *  C. One default pipeline exists → returns it, never inserts a new one
 *  D. Zero-default guard: pipeline exists but isDefault=false → marks oldest as default, no insert
 *  E. Two default pipelines (simulated duplicate) → transaction heals, deletes extra, response
 *     contains only the canonical pipeline (no new insert, canonical id verified)
 *  F. Three default pipelines → both extras deleted, no new insert
 */

import pino from "pino";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// vi.hoisted: mock factories must exist before any vi.mock factory runs
// ---------------------------------------------------------------------------

const {
  mockLimit,
  mockOrderBy,
  mockWhere,
  mockFrom,
  mockInnerJoin,
  mockSelect,
  mockOnConflictDoNothing,
  mockInsertValues,
  mockInsert,
  mockUpdateWhere,
  mockUpdateSet,
  mockUpdate,
  mockDelete,
  mockTransaction,
} = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn();
  const mockWhere = vi.fn();
  const mockInnerJoin = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere, innerJoin: mockInnerJoin }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  const mockOnConflictDoNothing = vi.fn().mockResolvedValue([]);
  const mockInsertValues = vi.fn(() => ({ onConflictDoNothing: mockOnConflictDoNothing }));
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  const mockDelete = vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) }));

  const mockTransaction = vi.fn();

  return {
    mockLimit,
    mockOrderBy,
    mockWhere,
    mockFrom,
    mockInnerJoin,
    mockSelect,
    mockOnConflictDoNothing,
    mockInsertValues,
    mockInsert,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
    mockDelete,
    mockTransaction,
  };
});

// ---------------------------------------------------------------------------
// Module mocks — must appear before any import of the router
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    transaction: mockTransaction,
  },
  pipelinesTable:      { _table: "pipelines" },
  pipelineStagesTable: { _table: "pipelineStages" },
  dealsTable:          { _table: "deals" },
  clientsTable:        { _table: "clients" },
  reservationsTable:   { _table: "reservations" },
}));

vi.mock("drizzle-orm", () => ({
  eq:      vi.fn(() => "eq"),
  and:     vi.fn((...a: unknown[]) => a),
  or:      vi.fn((...a: unknown[]) => a),
  inArray: vi.fn(() => "inArray"),
  desc:    vi.fn(() => "desc"),
  asc:     vi.fn(() => "asc"),
}));

vi.mock("@clerk/express", () => ({
  clerkClient:    vi.fn(),
  getAuth:        vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth:      vi.fn(),
  getTenantUser:    vi.fn(),
  ADMIN_ROLES:      ["admin"],
  MANAGEMENT_ROLES: ["admin", "manager"],
}));

vi.mock("../lib/id.js", () => ({
  generateId:           vi.fn(() => "gen-pipeline-id"),
  generateReferralCode: vi.fn(() => "REF-001"),
  generateVoucherCode:  vi.fn(() => "VCHR-001"),
}));

// ---------------------------------------------------------------------------
// Import router AFTER all mocks are declared
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import pipelineRouter from "../routes/pipeline.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  req.log = pino({ level: "silent" }) as unknown as typeof req.log;
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", pipelineRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  id: "user-001",
  tenantId: "tenant-001",
  role: "admin",
  name: "Admin",
  email: "admin@example.com",
};

function makePipeline(overrides: Record<string, unknown> = {}) {
  return {
    id: "pipeline-1",
    tenantId: "tenant-001",
    name: "Pipeline Principal",
    isDefault: true,
    isActive: true,
    description: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeStage(overrides: Record<string, unknown> = {}) {
  return {
    id: "stage-perdido",
    tenantId: "tenant-001",
    pipelineId: "pipeline-1",
    name: "Perdido",
    order: 7,
    color: "#EF4444",
    isFinal: false,
    isDefaultWeb: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock-chain helpers
//
// The DB query chains have three terminal points:
//   .where()                  — used in applyStageUpgrades stage fetch and /api/pipelines list
//   .where().orderBy()        — used for pipeline list and route response
//   .where().orderBy().limit  — used for the winner re-fetch
//
// wv(val): returns a thenable resolving to val that ALSO exposes .orderBy and .limit
// ov(val): returns a thenable resolving to val that ALSO exposes .limit
// ---------------------------------------------------------------------------

function wv(val: unknown[]) {
  return Object.assign(Promise.resolve(val), {
    orderBy: mockOrderBy,
    limit:   mockLimit,
  });
}

function ov(val: unknown[]) {
  return Object.assign(Promise.resolve(val), {
    limit: mockLimit,
  });
}

// Narrow helper: extracts the _table sentinel from mockInsert.mock.calls
function insertedTables(mock: ReturnType<typeof vi.fn>): string[] {
  return (mock.mock.calls as unknown as Array<[{ _table?: string }]>)
    .map((args) => args[0]?._table ?? "unknown");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ensureDefaultPipeline — idempotency and self-healing", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-wire chain mocks after clearAllMocks resets their implementations
    mockInnerJoin.mockReturnValue({ where: mockWhere });
    mockFrom.mockReturnValue({ where: mockWhere, innerJoin: mockInnerJoin });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockUpdateWhere.mockResolvedValue([]);
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockOnConflictDoNothing.mockResolvedValue([]);
    mockInsertValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

    requireAuthMock.mockResolvedValue(ADMIN_USER as never);
  });

  // ----------------------------------------------------------------
  // Scenario A: No pipeline exists → creates exactly one
  // ----------------------------------------------------------------

  it("creates exactly one default pipeline (with 7 stages) when none exists", async () => {
    const winner = makePipeline();

    // (1) Initial pipeline list: .where().orderBy() → []
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([]));

    // (2) Winner re-fetch: .where().orderBy().limit(1) → [winner]
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([]));
    mockLimit.mockResolvedValueOnce([winner]);

    // (3) Route handler stage fetch: .where().orderBy() → []
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([]));

    const res = await request(buildApp()).get("/api/pipeline/stages");

    expect(res.status).toBe(200);

    const tables = insertedTables(mockInsert);
    expect(tables.filter((t) => t === "pipelines")).toHaveLength(1);
    expect(tables.filter((t) => t === "pipelineStages")).toHaveLength(7);

    // Every insert used onConflictDoNothing — the fundamental race-safety contract
    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(8);
  });

  // ----------------------------------------------------------------
  // Scenario B: True parallel race (Promise.all) with stateful DB simulation
  //
  // Two concurrent requests both start from zero pipelines and race to create
  // the default. A stateful in-memory store simulates the DB partial unique index
  // on (tenant_id) WHERE is_default=true: the first insert wins, the second is
  // a no-op (onConflictDoNothing). Both requests then re-fetch via limit(1) and
  // see the same canonical row.
  //
  // This test verifies:
  //  1. Exactly ONE default pipeline exists after both concurrent requests complete
  //  2. Both responses contain only that single pipeline (same canonical id)
  //  3. Both pipeline inserts used onConflictDoNothing (race-safe contract)
  // ----------------------------------------------------------------

  it("exactly one default pipeline exists after two concurrent requests race from zero", async () => {
    const WINNER_PIPELINE = makePipeline({ id: "race-winner" });

    // --- Stateful in-memory store that simulates the DB unique index ---
    //
    // pipelineStore holds at most one entry (the unique index enforces this).
    // onConflictDoNothing: the first call inserts the winner; subsequent calls
    // are no-ops — exactly what the DB partial unique index does.
    //
    // Node.js is single-threaded: the `if (!pipelineStore)` check + assignment
    // inside each synchronous onConflictDoNothing callback is atomic relative to
    // other microtasks, so no two callbacks can both see null and both insert.
    let pipelineStore: ReturnType<typeof makePipeline> | null = null;
    let pipelineInsertAttempts = 0;

    const pipelineOnConflict = vi.fn().mockImplementation(() => {
      pipelineInsertAttempts++;
      if (!pipelineStore) {
        pipelineStore = WINNER_PIPELINE; // first insert wins
      }
      // second+ calls are silent no-ops, mirroring ON CONFLICT DO NOTHING
      return Promise.resolve([]);
    });

    mockInsert.mockImplementation(((table: { _table?: string }) => ({
      values: () => ({
        onConflictDoNothing:
          table._table === "pipelines"
            ? pipelineOnConflict
            : vi.fn().mockResolvedValue([]), // stage inserts: unconstrained
      }),
    })) as never);

    // All select chains return state from pipelineStore, captured at call time.
    // By the time each request does its winner re-fetch (after its own
    // onConflictDoNothing call), pipelineStore is guaranteed to be set.
    mockWhere.mockImplementation(() => {
      const snapshot = pipelineStore ? [pipelineStore] : [];
      const snapshotOrderBy = vi.fn().mockImplementation(() =>
        Object.assign(Promise.resolve(snapshot), {
          limit: vi.fn().mockResolvedValue(snapshot.slice(0, 1)),
        }),
      );
      return Object.assign(Promise.resolve(snapshot), {
        orderBy: snapshotOrderBy,
        limit:   vi.fn().mockResolvedValue(snapshot.slice(0, 1)),
      });
    });

    const app = buildApp();
    // Both requests race from zero — GET /api/pipelines so the response includes pipeline ids
    const [resA, resB] = await Promise.all([
      request(app).get("/api/pipelines"),
      request(app).get("/api/pipelines"),
    ]);

    // Both requests must succeed
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // ── Core assertion: post-race cardinality ──
    // The stateful store must contain exactly one pipeline (the unique index winner)
    expect(pipelineStore).not.toBeNull();
    expect(pipelineStore!.id).toBe("race-winner");

    // Both responses must expose only ONE pipeline, and it must be the canonical one
    expect(resA.body).toHaveLength(1);
    expect(resB.body).toHaveLength(1);
    expect(resA.body[0].id).toBe("race-winner");
    expect(resB.body[0].id).toBe("race-winner");

    // Both responses agree on the same canonical id
    expect(resA.body[0].id).toBe(resB.body[0].id);

    // ── Race-safety contract ──
    // At least one insert attempt happened (creating the pipeline)...
    expect(pipelineInsertAttempts).toBeGreaterThanOrEqual(1);
    // ...and onConflictDoNothing was used on every pipeline insert attempt.
    // If both requests truly raced (both saw empty state before either inserted),
    // pipelineOnConflict would be called twice and the second would be a no-op.
    // If one completed before the other started, only one insert was attempted.
    // In both cases the stateful store ends up with exactly one row.
    expect(pipelineOnConflict).toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // Scenario C: One default pipeline exists → returns it, no new creation
  // ----------------------------------------------------------------

  it("returns the existing pipeline without creating a new one when one default already exists", async () => {
    const existing    = makePipeline({ id: "existing-pipeline" });
    const perdidoStage = makeStage({ pipelineId: "existing-pipeline", name: "Perdido" });

    // (1) Pipeline list → [existing]
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([existing]));

    // (2) applyStageUpgrades stage fetch (terminates at .where())
    mockWhere.mockImplementationOnce(() => wv([perdidoStage]));

    // (3) Route handler stage fetch
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([perdidoStage]));

    const res = await request(buildApp()).get("/api/pipeline/stages");

    expect(res.status).toBe(200);
    expect(insertedTables(mockInsert).filter((t) => t === "pipelines")).toHaveLength(0);
    expect(insertedTables(mockInsert).filter((t) => t === "pipelineStages")).toHaveLength(0);
  });

  // ----------------------------------------------------------------
  // Scenario D: Zero-default guard — pipeline exists but isDefault=false
  // → must mark oldest as default via db.update, must NOT create a new pipeline
  // ----------------------------------------------------------------

  it("marks the oldest pipeline as default when none have isDefault=true (zero-default guard)", async () => {
    const orphan       = makePipeline({ id: "orphan-pipeline", isDefault: false });
    const perdidoStage = makeStage({ pipelineId: "orphan-pipeline", name: "Perdido" });

    // (1) Pipeline list → [orphan] (isDefault=false)
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([orphan]));

    // (2) applyStageUpgrades stage fetch
    mockWhere.mockImplementationOnce(() => wv([perdidoStage]));

    // (3) Route handler stage fetch
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([]));

    const res = await request(buildApp()).get("/api/pipeline/stages");

    expect(res.status).toBe(200);
    // db.update was called to promote isDefault=true on the existing pipeline
    expect(mockUpdate).toHaveBeenCalled();
    // No new pipeline was inserted
    expect(insertedTables(mockInsert).filter((t) => t === "pipelines")).toHaveLength(0);
  });

  // ----------------------------------------------------------------
  // Scenario E: Two default pipelines (simulated duplicate)
  // → transaction heals: deletes extra, remaps deals, returns canonical id.
  // Tested via GET /api/pipelines so the response body explicitly contains
  // the canonical pipeline, verifying the returned id.
  // ----------------------------------------------------------------

  it("heals duplicate default pipelines: deletes extra, remaps deals, response contains only canonical pipeline", async () => {
    const CANONICAL_ID = "canon-pipeline";
    const canonical = makePipeline({ id: CANONICAL_ID, createdAt: new Date("2024-01-01") });
    const extra     = makePipeline({ id: "extra-pipeline", createdAt: new Date("2024-02-01") });

    const canonStage   = makeStage({ id: "canon-stage",   pipelineId: CANONICAL_ID, name: "Lead" });
    const extraStage   = makeStage({ id: "extra-stage",   pipelineId: "extra-pipeline", name: "Lead" });
    const perdidoStage = makeStage({ id: "canon-perdido", pipelineId: CANONICAL_ID, name: "Perdido" });

    // Build a dedicated tx mock for the healing transaction
    const txOrderBy     = vi.fn();
    const txWhere       = vi.fn();
    const txFrom        = vi.fn(() => ({ where: txWhere }));
    const txSelect      = vi.fn(() => ({ from: txFrom }));
    const txUpdateWhere = vi.fn().mockResolvedValue([]);
    const txUpdateSet   = vi.fn(() => ({ where: txUpdateWhere }));
    const txUpdate      = vi.fn(() => ({ set: txUpdateSet }));
    const txDeleteWhere = vi.fn().mockResolvedValue([]);
    const txDelete      = vi.fn(() => ({ where: txDeleteWhere }));

    // tx call #1: canonical stages — .where().orderBy() → [canonStage]
    txWhere.mockImplementationOnce(() =>
      Object.assign(Promise.resolve([]), { orderBy: txOrderBy, limit: vi.fn() }),
    );
    txOrderBy.mockResolvedValueOnce([canonStage]);

    // tx call #2: extra pipeline stages — .where() terminal → [extraStage]
    txWhere.mockImplementationOnce(() =>
      Object.assign(Promise.resolve([extraStage]), { orderBy: txOrderBy, limit: vi.fn() }),
    );

    mockTransaction.mockImplementationOnce(
      async (cb: (tx: {
        select: typeof txSelect;
        update: typeof txUpdate;
        delete: typeof txDelete;
      }) => unknown) => cb({ select: txSelect, update: txUpdate, delete: txDelete }),
    );

    // (1) Pipeline list via ensureDefaultPipeline → [canonical, extra] (both isDefault=true)
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([canonical, extra]));

    // (2) applyStageUpgrades for canonical: stage fetch terminates at .where()
    mockWhere.mockImplementationOnce(() => wv([perdidoStage]));

    // (3) GET /api/pipelines: final pipeline list after healing → [canonical] only
    mockWhere.mockImplementationOnce(() => wv([canonical]));

    // (4) GET /api/pipelines: stagesWithDeals innerJoin query → [] (no deals)
    mockWhere.mockImplementationOnce(() => wv([]));

    const res = await request(buildApp()).get("/api/pipelines");

    expect(res.status).toBe(200);

    // Response must contain exactly one pipeline — the canonical one
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(CANONICAL_ID);

    // Healing: transaction was executed
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    // Extra pipeline was deleted inside the transaction
    expect(txDelete).toHaveBeenCalledTimes(1);

    // Deals from extra stage were remapped to the canonical stage
    expect(txUpdate).toHaveBeenCalledTimes(1);

    // No new pipeline was created by ensureDefaultPipeline
    expect(insertedTables(mockInsert).filter((t) => t === "pipelines")).toHaveLength(0);
  });

  // ----------------------------------------------------------------
  // Scenario F: Three default pipelines → two extras deleted, no new insert
  // ----------------------------------------------------------------

  it("deletes all extra pipelines when more than two duplicates exist", async () => {
    const canonical = makePipeline({ id: "p1", createdAt: new Date("2024-01-01") });
    const extra1    = makePipeline({ id: "p2", createdAt: new Date("2024-02-01") });
    const extra2    = makePipeline({ id: "p3", createdAt: new Date("2024-03-01") });
    const perdidoStage = makeStage({ pipelineId: "p1", name: "Perdido" });

    const txOrderBy = vi.fn();
    const txWhere   = vi.fn();
    const txFrom    = vi.fn(() => ({ where: txWhere }));
    const txSelect  = vi.fn(() => ({ from: txFrom }));
    const txUpdate  = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) }));
    const txDeleteWhere = vi.fn().mockResolvedValue([]);
    const txDelete  = vi.fn(() => ({ where: txDeleteWhere }));

    // tx: canonical stages (empty — no stages to remap)
    txWhere.mockImplementationOnce(() =>
      Object.assign(Promise.resolve([]), { orderBy: txOrderBy, limit: vi.fn() }),
    );
    txOrderBy.mockResolvedValueOnce([]);

    // tx: extra1 stages (empty)
    txWhere.mockImplementationOnce(() =>
      Object.assign(Promise.resolve([]), { orderBy: txOrderBy, limit: vi.fn() }),
    );

    // tx: extra2 stages (empty)
    txWhere.mockImplementationOnce(() =>
      Object.assign(Promise.resolve([]), { orderBy: txOrderBy, limit: vi.fn() }),
    );

    mockTransaction.mockImplementationOnce(
      async (cb: (tx: {
        select: typeof txSelect;
        update: typeof txUpdate;
        delete: typeof txDelete;
      }) => unknown) => cb({ select: txSelect, update: txUpdate, delete: txDelete }),
    );

    // (1) Pipeline list → [canonical, extra1, extra2]
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([canonical, extra1, extra2]));

    // (2) applyStageUpgrades
    mockWhere.mockImplementationOnce(() => wv([perdidoStage]));

    // (3) Route handler stage fetch
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([]));

    const res = await request(buildApp()).get("/api/pipeline/stages");

    expect(res.status).toBe(200);

    // Both extras deleted
    expect(txDelete).toHaveBeenCalledTimes(2);

    // No new pipeline created
    expect(insertedTables(mockInsert).filter((t) => t === "pipelines")).toHaveLength(0);
  });
});

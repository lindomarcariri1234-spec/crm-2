/**
 * pipeline-deal-sync.test.ts
 *
 * Regression guard for the "Novo Cliente + viagem → duplicate Pipeline card" bug.
 *
 * syncClientDeal is called fire-and-forget from POST/PUT /reservations. Its invariant
 * is: for any given (clientId, tenantId), either update the existing open deal OR
 * insert exactly one new deal — never both, never zero when a stage exists.
 *
 * Scenarios:
 *  A. No existing open deal → inserts exactly ONE deal in "Reserva Criada" stage
 *  B. Existing open deal found → updates deal, calls moveDealToStage, ZERO inserts
 *  C. No pipeline stages configured → inserts nothing (graceful early return)
 *  D. "Reserva Criada" stage missing → falls back to first stage and inserts ONE deal
 *  E. reservationId propagated → inserted deal carries reservationId
 *  F. Names fall back to defaults when client/trip rows are absent
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted: all mock factories must be declared before any vi.mock factory
// ---------------------------------------------------------------------------

const {
  mockLimit,
  mockOrderBy,
  mockWhere,
  mockFrom,
  mockSelect,
  mockUpdateWhere,
  mockUpdateSet,
  mockUpdate,
  mockInsertValues,
  mockInsert,
  mockMoveDealToStage,
} = vi.hoisted(() => {
  const mockLimit       = vi.fn();
  const mockOrderBy     = vi.fn();
  const mockWhere       = vi.fn();
  const mockFrom        = vi.fn(() => ({ where: mockWhere }));
  const mockSelect      = vi.fn(() => ({ from: mockFrom }));
  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdateSet   = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate      = vi.fn(() => ({ set: mockUpdateSet }));
  const mockInsertValues = vi.fn().mockResolvedValue([]);
  const mockInsert       = vi.fn(() => ({ values: mockInsertValues }));
  const mockMoveDealToStage = vi.fn().mockResolvedValue(undefined);
  return {
    mockLimit, mockOrderBy, mockWhere, mockFrom, mockSelect,
    mockUpdateWhere, mockUpdateSet, mockUpdate,
    mockInsertValues, mockInsert,
    mockMoveDealToStage,
  };
});

// ---------------------------------------------------------------------------
// Module mocks — must appear before any import of the module under test
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
  },
  clientsTable:        { _table: "clients" },
  tripsTable:          { _table: "trips" },
  dealsTable:          { _table: "deals" },
  pipelineStagesTable: { _table: "pipelineStages" },
}));

vi.mock("drizzle-orm", () => ({
  eq:   vi.fn(() => "eq"),
  and:  vi.fn((...a: unknown[]) => a),
  desc: vi.fn(() => "desc"),
  asc:  vi.fn(() => "asc"),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "new-deal-id"),
}));

vi.mock("@workspace/permissions", () => ({
  DEAL_STATUS: { OPEN: "open" },
}));

vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: mockMoveDealToStage,
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER all mocks
// ---------------------------------------------------------------------------

import { syncClientDeal } from "../services/pipeline-deal-sync.js";

// ---------------------------------------------------------------------------
// Mock-chain helpers
//
// Every db.select().from().where() chain terminates at one of:
//   .where().limit(1)                   → simple select (client, trip, "Reserva Criada" stage)
//   .where().orderBy().limit(1)         → select with ordering (existing deal, first stage)
//
// wv(): makes mockWhere return a thenable that also exposes .orderBy and .limit
// ov(): makes mockOrderBy return a thenable that also exposes .limit
// ---------------------------------------------------------------------------

function wv() {
  return Object.assign(Promise.resolve([]), {
    orderBy: mockOrderBy,
    limit:   mockLimit,
  });
}

function ov() {
  return Object.assign(Promise.resolve([]), {
    limit: mockLimit,
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = "tenant-001";
const CLIENT_ID = "client-001";
const TRIP_ID   = "trip-001";
const OWNER_ID  = "user-001";

const FAKE_CLIENT = { name: "João Silva" };
const FAKE_TRIP   = { name: "Excursão ao Nordeste" };
const RESERVA_CRIADA_STAGE = { id: "stage-reserva-criada" };
const FIRST_STAGE          = { id: "stage-lead" };
const EXISTING_DEAL        = { id: "deal-existing", clientId: CLIENT_ID, tenantId: TENANT_ID };

// ---------------------------------------------------------------------------
// Setup: re-wire chain mocks after each vi.clearAllMocks()
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockUpdateWhere.mockResolvedValue([]);
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
  mockInsertValues.mockResolvedValue([]);
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockMoveDealToStage.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Helper: queue the shared select calls
//
// syncClientDeal now performs TWO deal lookups:
//   1) trip-scoped:   (clientId, tenantId, tripId, status=OPEN)
//   2) client-scoped: (clientId, tenantId, status=OPEN)  — fallback when #1 misses
//
// When existingDeal is non-null, the trip-scoped lookup finds it and the
// fallback is skipped. When existingDeal is null, both lookups return [].
// ---------------------------------------------------------------------------

function queueSharedSelects(existingDeal: unknown) {
  // 1. client name select: .where().limit(1)
  mockWhere.mockImplementationOnce(() => wv());
  mockLimit.mockResolvedValueOnce([FAKE_CLIENT]);

  // 2. trip name select: .where().limit(1)
  mockWhere.mockImplementationOnce(() => wv());
  mockLimit.mockResolvedValueOnce([FAKE_TRIP]);

  // 3. trip-scoped open deal: .where().orderBy(desc).limit(1)
  mockWhere.mockImplementationOnce(() => wv());
  mockOrderBy.mockImplementationOnce(() => ov());
  mockLimit.mockResolvedValueOnce(existingDeal === null ? [] : [existingDeal]);

  // 4. fallback open deal (only when trip-scoped missed)
  if (existingDeal === null) {
    mockWhere.mockImplementationOnce(() => wv());
    mockOrderBy.mockImplementationOnce(() => ov());
    mockLimit.mockResolvedValueOnce([]);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncClientDeal — exactly one deal, no duplicates", () => {

  // ── Scenario A ──────────────────────────────────────────────────────────
  it("A — inserts exactly ONE deal in 'Reserva Criada' when no open deal exists", async () => {
    queueSharedSelects(null);

    // 4. "Reserva Criada" stage: .where().limit(1) → found
    mockWhere.mockImplementationOnce(() => wv());
    mockLimit.mockResolvedValueOnce([RESERVA_CRIADA_STAGE]);

    // 5. first stage (fallback): .where().orderBy(asc).limit(1) → also resolved (not used)
    mockWhere.mockImplementationOnce(() => wv());
    mockOrderBy.mockImplementationOnce(() => ov());
    mockLimit.mockResolvedValueOnce([FIRST_STAGE]);

    await syncClientDeal(CLIENT_ID, TENANT_ID, TRIP_ID, 1000, OWNER_ID);

    // Core invariant: exactly one insert, no update
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();

    // The insert must target dealsTable and use the "Reserva Criada" stage
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id:       "new-deal-id",
        stageId:  RESERVA_CRIADA_STAGE.id,
        clientId: CLIENT_ID,
        tripId:   TRIP_ID,
        tenantId: TENANT_ID,
        ownerId:  OWNER_ID,
        value:    "1000",
        status:   "open",
        title:    `${FAKE_CLIENT.name} — ${FAKE_TRIP.name}`,
      }),
    );

    // moveDealToStage must NOT be called (there is no existing deal to advance)
    expect(mockMoveDealToStage).not.toHaveBeenCalled();
  });

  // ── Scenario B ──────────────────────────────────────────────────────────
  it("B — updates existing deal and calls moveDealToStage, ZERO new inserts", async () => {
    const existingDeal = { id: "deal-existing-001" };
    queueSharedSelects(existingDeal);

    await syncClientDeal(CLIENT_ID, TENANT_ID, TRIP_ID, 1500, OWNER_ID, "res-001");

    // Core invariant: no insert, exactly one update
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // Update must carry the new value and reservationId
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        value:         "1500",
        tripId:        TRIP_ID,
        reservationId: "res-001",
      }),
    );

    // moveDealToStage must advance the deal to "Reserva Criada"
    expect(mockMoveDealToStage).toHaveBeenCalledTimes(1);
    expect(mockMoveDealToStage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId:        TENANT_ID,
        dealId:          existingDeal.id,
        targetStageName: "Reserva Criada",
        forwardOnly:     true,
      }),
    );
  });

  // ── Scenario C ──────────────────────────────────────────────────────────
  it("C — inserts nothing when no pipeline stages are configured", async () => {
    queueSharedSelects(null);

    // "Reserva Criada" stage: not found
    mockWhere.mockImplementationOnce(() => wv());
    mockLimit.mockResolvedValueOnce([]);

    // first stage: also not found
    mockWhere.mockImplementationOnce(() => wv());
    mockOrderBy.mockImplementationOnce(() => ov());
    mockLimit.mockResolvedValueOnce([]);

    await syncClientDeal(CLIENT_ID, TENANT_ID, TRIP_ID, 800, OWNER_ID);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── Scenario D ──────────────────────────────────────────────────────────
  it("D — falls back to first stage when 'Reserva Criada' stage is missing", async () => {
    queueSharedSelects(null);

    // "Reserva Criada" stage: not found
    mockWhere.mockImplementationOnce(() => wv());
    mockLimit.mockResolvedValueOnce([]);

    // first stage: found
    mockWhere.mockImplementationOnce(() => wv());
    mockOrderBy.mockImplementationOnce(() => ov());
    mockLimit.mockResolvedValueOnce([FIRST_STAGE]);

    await syncClientDeal(CLIENT_ID, TENANT_ID, TRIP_ID, 600, OWNER_ID);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: FIRST_STAGE.id }),
    );
  });

  // ── Scenario E ──────────────────────────────────────────────────────────
  it("E — propagates reservationId to the inserted deal row", async () => {
    queueSharedSelects(null);

    mockWhere.mockImplementationOnce(() => wv());
    mockLimit.mockResolvedValueOnce([RESERVA_CRIADA_STAGE]);

    mockWhere.mockImplementationOnce(() => wv());
    mockOrderBy.mockImplementationOnce(() => ov());
    mockLimit.mockResolvedValueOnce([FIRST_STAGE]);

    await syncClientDeal(CLIENT_ID, TENANT_ID, TRIP_ID, 500, OWNER_ID, "res-xyz");

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: "res-xyz" }),
    );
  });

  // ── Scenario F ──────────────────────────────────────────────────────────
  it("F — falls back to default names when client/trip rows are missing", async () => {
    // client: not found
    mockWhere.mockImplementationOnce(() => wv());
    mockLimit.mockResolvedValueOnce([]);

    // trip: not found
    mockWhere.mockImplementationOnce(() => wv());
    mockLimit.mockResolvedValueOnce([]);

    // trip-scoped deal: not found
    mockWhere.mockImplementationOnce(() => wv());
    mockOrderBy.mockImplementationOnce(() => ov());
    mockLimit.mockResolvedValueOnce([]);

    // fallback client-scoped deal: not found
    mockWhere.mockImplementationOnce(() => wv());
    mockOrderBy.mockImplementationOnce(() => ov());
    mockLimit.mockResolvedValueOnce([]);

    // "Reserva Criada" stage
    mockWhere.mockImplementationOnce(() => wv());
    mockLimit.mockResolvedValueOnce([RESERVA_CRIADA_STAGE]);

    // first stage (fallback)
    mockWhere.mockImplementationOnce(() => wv());
    mockOrderBy.mockImplementationOnce(() => ov());
    mockLimit.mockResolvedValueOnce([FIRST_STAGE]);

    await syncClientDeal(CLIENT_ID, TENANT_ID, TRIP_ID, 200, OWNER_ID);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Cliente — Viagem" }),
    );
  });

  // ── Scenario H ──────────────────────────────────────────────────────────
  // PATCH path: when the handler updates totalValue on an existing reservation,
  // syncClientDeal is called with the NEW value.  The service must update the
  // existing deal (not insert a second one) and reflect the new totalValue.
  it("H — PATCH path: existing deal updated with new totalValue, no duplicate insert", async () => {
    const existingDeal = { id: "deal-patch-001" };
    // The PATCH handler passes the updated totalValue (1200 → 1800).
    queueSharedSelects(existingDeal);

    await syncClientDeal(CLIENT_ID, TENANT_ID, TRIP_ID, 1800, OWNER_ID, "res-patch-001");

    // Invariant: no new insert, exactly one update carrying the new value
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        value:         "1800",   // updated totalValue from the PATCH body
        tripId:        TRIP_ID,
        reservationId: "res-patch-001",
      }),
    );

    // Deal must be advanced to (or kept at) "Reserva Criada" stage
    expect(mockMoveDealToStage).toHaveBeenCalledTimes(1);
    expect(mockMoveDealToStage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId:        TENANT_ID,
        dealId:          existingDeal.id,
        targetStageName: "Reserva Criada",
        forwardOnly:     true,
      }),
    );
  });

  // ── Scenario I ──────────────────────────────────────────────────────────
  // PATCH path: if no deal exists yet (edge case — reservation existed before
  // the pipeline feature was enabled, or the POST path skipped deal creation),
  // a PATCH that updates totalValue must create exactly ONE deal with the new
  // value and carry the reservationId.
  it("I — PATCH path: no prior open deal → inserts exactly one deal with updated totalValue", async () => {
    queueSharedSelects(null);

    // "Reserva Criada" stage found
    mockWhere.mockImplementationOnce(() => wv());
    mockLimit.mockResolvedValueOnce([RESERVA_CRIADA_STAGE]);

    // first-stage fallback (queued but not consumed when "Reserva Criada" exists)
    mockWhere.mockImplementationOnce(() => wv());
    mockOrderBy.mockImplementationOnce(() => ov());
    mockLimit.mockResolvedValueOnce([FIRST_STAGE]);

    await syncClientDeal(CLIENT_ID, TENANT_ID, TRIP_ID, 2500, OWNER_ID, "res-patch-002");

    // Exactly one insert, no update
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        stageId:       RESERVA_CRIADA_STAGE.id,
        clientId:      CLIENT_ID,
        tripId:        TRIP_ID,
        tenantId:      TENANT_ID,
        ownerId:       OWNER_ID,
        value:         "2500",        // updated totalValue from the PATCH body
        reservationId: "res-patch-002",
        status:        "open",
      }),
    );

    // No stage movement — the deal was just created, not advanced
    expect(mockMoveDealToStage).not.toHaveBeenCalled();
  });

  // ── Scenario G ──────────────────────────────────────────────────────────
  it("G — reuses a client-scoped 'Lead' deal (no tripId) when reservation is created later", async () => {
    // This covers the case where the frontend "Novo Cliente" form created a
    // deal in "Lead" stage WITHOUT a tripId, and later a reservation for the
    // same client+trip is created. The service must find the existing deal
    // via the fallback lookup, update it with tripId, and move it to
    // "Reserva Criada" — not insert a second deal.

    // client lookup
    mockWhere.mockImplementationOnce(() => wv());
    mockLimit.mockResolvedValueOnce([{ name: "João" }]);

    // trip lookup
    mockWhere.mockImplementationOnce(() => wv());
    mockLimit.mockResolvedValueOnce([{ title: "Férias 2025" }]);

    // trip-scoped deal: not found (no deal with tripId yet)
    mockWhere.mockImplementationOnce(() => wv());
    mockOrderBy.mockImplementationOnce(() => ov());
    mockLimit.mockResolvedValueOnce([]);

    // fallback client-scoped deal: FOUND (the "Lead" deal created earlier)
    mockWhere.mockImplementationOnce(() => wv());
    mockOrderBy.mockImplementationOnce(() => ov());
    mockLimit.mockResolvedValueOnce([EXISTING_DEAL]);

    // stage lookup: "Reserva Criada"
    mockWhere.mockImplementationOnce(() => wv());
    mockLimit.mockResolvedValueOnce([RESERVA_CRIADA_STAGE]);

    await syncClientDeal(CLIENT_ID, TENANT_ID, TRIP_ID, 500, OWNER_ID, "res-new");

    // Should UPDATE the existing deal (set tripId + reservationId) and move it
    expect(mockMoveDealToStage).toHaveBeenCalledTimes(1);
    expect(mockMoveDealToStage).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: EXISTING_DEAL.id,
        targetStageName: "Reserva Criada",
        tenantId: TENANT_ID,
      }),
    );

    // Should NOT insert a new deal
    expect(mockInsert).not.toHaveBeenCalled();
  });

});

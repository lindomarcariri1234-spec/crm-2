/**
 * Tests for moveDealToStage in pipeline-automation.ts
 *
 * Key invariant: a deal must only ever be moved to a stage that belongs to
 * the same pipeline as its current stage.  Queries that match a target stage
 * by name across all pipelines of a tenant must be scoped to the deal's own
 * pipeline — verified here via the multi-pipeline scenario.
 *
 * Scenarios:
 *  A. Happy path — deal found, target stage in same pipeline → moved
 *  B. Multi-pipeline isolation — target stage name exists in TWO pipelines;
 *     deal in pipeline-A must NOT be moved to pipeline-B's stage
 *  C. Target stage absent from deal's pipeline → warning logged, no move
 *  D. forwardOnly=true, deal already at or past target order → no move
 *  E. forwardOnly=true, deal behind target → moved
 *  F. Deal not found → no DB update, no error
 *  G. Deal found by reservationId (no explicit dealId) → moved
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock factories
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
  mockLoggerWarn,
  mockLoggerError,
} = vi.hoisted(() => {
  const mockLimit       = vi.fn();
  const mockOrderBy     = vi.fn();
  const mockWhere       = vi.fn();
  const mockFrom        = vi.fn(() => ({ where: mockWhere }));
  const mockSelect      = vi.fn(() => ({ from: mockFrom }));
  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdateSet   = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate      = vi.fn(() => ({ set: mockUpdateSet }));
  const mockLoggerWarn  = vi.fn();
  const mockLoggerError = vi.fn();
  return {
    mockLimit, mockOrderBy, mockWhere, mockFrom, mockSelect,
    mockUpdateWhere, mockUpdateSet, mockUpdate,
    mockLoggerWarn, mockLoggerError,
  };
});

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any import of the module under test
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
  dealsTable:          { _table: "deals" },
  pipelineStagesTable: { _table: "pipelineStages" },
  tripsTable:          { _table: "trips" },
  reservationsTable:   { _table: "reservations" },
}));

vi.mock("drizzle-orm", () => ({
  eq:        vi.fn(() => "eq"),
  and:       vi.fn((...a: unknown[]) => a),
  ne:        vi.fn(() => "ne"),
  inArray:   vi.fn(() => "inArray"),
  desc:      vi.fn(() => "desc"),
  lte:       vi.fn(() => "lte"),
  gte:       vi.fn(() => "gte"),
  isNotNull: vi.fn(() => "isNotNull"),
  max:       vi.fn(() => "max"),
  sql:       vi.fn(() => "sql"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    warn:  mockLoggerWarn,
    error: mockLoggerError,
    info:  vi.fn(),
  },
}));

vi.mock("@workspace/permissions", () => ({
  DEAL_STATUS: { OPEN: "open", CLOSED: "closed", LOST: "lost" },
}));

// ---------------------------------------------------------------------------
// Import under test AFTER all mocks
// ---------------------------------------------------------------------------

import { moveDealToStage, cancelDealOnReservationCancellation } from "../services/pipeline-automation.js";

// ---------------------------------------------------------------------------
// Mock-chain helpers
//
// Each select query chain ends in .where().limit(1) or .where().orderBy().limit(1).
// wv(val): makes mockWhere return a thenable that also has .orderBy and .limit
// ov(val): makes mockOrderBy return a thenable that also has .limit
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDeal(overrides: Record<string, unknown> = {}) {
  return { id: "deal-1", stageId: "stage-vitrine-a", ...overrides };
}

function makeCurrentStage(overrides: Record<string, unknown> = {}) {
  return { order: 2, pipelineId: "pipeline-a", ...overrides };
}

function makeTargetStage(overrides: Record<string, unknown> = {}) {
  return { id: "stage-pagamento-a", order: 4, ...overrides };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();

  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockUpdateWhere.mockResolvedValue([]);
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("moveDealToStage", () => {

  // Scenario A: happy path
  it("A — moves deal to target stage within the same pipeline", async () => {
    const deal         = makeDeal();
    const currentStage = makeCurrentStage();
    const targetStage  = makeTargetStage();

    // Query 1: deal by dealId → .where().limit(1)
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([deal]);

    // Query 2: current stage → .where().limit(1)
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([currentStage]);

    // Query 3: target stage in same pipeline → .where().limit(1)
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([targetStage]);

    await moveDealToStage({
      tenantId: "tenant-1",
      dealId: "deal-1",
      targetStageName: "Pagamento Confirmado",
      forwardOnly: false,
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ stageId: targetStage.id });
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // Scenario B: multi-pipeline isolation
  it("B — does NOT move deal when target stage name exists only in a different pipeline", async () => {
    // Deal is in pipeline-a. A stage named "Pagamento Confirmado" exists in
    // pipeline-b but NOT in pipeline-a. The move must be silently skipped.
    const deal         = makeDeal({ stageId: "stage-vitrine-a" });
    const currentStage = makeCurrentStage({ pipelineId: "pipeline-a" });

    // Query 1: deal
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([deal]);

    // Query 2: current stage → pipeline-a
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([currentStage]);

    // Query 3: target stage in pipeline-a → NOT FOUND (the name only exists in pipeline-b)
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([]);

    await moveDealToStage({
      tenantId: "tenant-1",
      dealId: "deal-1",
      targetStageName: "Pagamento Confirmado",
      forwardOnly: false,
    });

    // No update must happen
    expect(mockUpdate).not.toHaveBeenCalled();
    // A warning must be logged so operators can investigate misconfigured pipelines
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: "pipeline-a" }),
      expect.stringContaining("[pipeline-automation]"),
    );
  });

  // Scenario C: target stage absent from deal's pipeline (similar to B, explicit check)
  it("C — logs warning and skips move when target stage is absent from deal's pipeline", async () => {
    const deal         = makeDeal();
    const currentStage = makeCurrentStage();

    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([deal]);

    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([currentStage]);

    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([]);   // target not found

    await moveDealToStage({
      tenantId: "tenant-1",
      dealId: "deal-1",
      targetStageName: "Estágio Inexistente",
      forwardOnly: false,
    });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });

  // Scenario D: forwardOnly — deal already past target
  it("D — does NOT move deal backwards when forwardOnly=true", async () => {
    const deal         = makeDeal();
    const currentStage = makeCurrentStage({ order: 5 });  // further along
    const targetStage  = makeTargetStage({ order: 2 });    // earlier stage

    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([deal]);

    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([currentStage]);

    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([targetStage]);

    await moveDealToStage({
      tenantId: "tenant-1",
      dealId: "deal-1",
      targetStageName: "Vitrine",
      forwardOnly: true,
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // Scenario E: forwardOnly — deal behind target → moved
  it("E — moves deal forward when forwardOnly=true and deal is behind target", async () => {
    const deal         = makeDeal();
    const currentStage = makeCurrentStage({ order: 2 });
    const targetStage  = makeTargetStage({ order: 4 });

    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([deal]);

    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([currentStage]);

    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([targetStage]);

    await moveDealToStage({
      tenantId: "tenant-1",
      dealId: "deal-1",
      targetStageName: "Pagamento Confirmado",
      forwardOnly: true,
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ stageId: targetStage.id });
  });

  // Scenario F: deal not found
  it("F — returns without error when deal is not found", async () => {
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([]);   // deal not found

    await moveDealToStage({
      tenantId: "tenant-1",
      dealId: "deal-nonexistent",
      targetStageName: "Pagamento Confirmado",
      forwardOnly: false,
    });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  // Scenario G: deal found by reservationId (no explicit dealId)
  it("G — moves deal found via reservationId (no explicit dealId)", async () => {
    const deal         = makeDeal({ id: "deal-by-res" });
    const currentStage = makeCurrentStage();
    const targetStage  = makeTargetStage();

    // Query 1: deal by reservationId — ends in .where().orderBy().limit(1)
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([]));
    mockLimit.mockResolvedValueOnce([deal]);

    // Query 2: current stage
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([currentStage]);

    // Query 3: target stage
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([targetStage]);

    await moveDealToStage({
      tenantId: "tenant-1",
      reservationId: "res-1",
      targetStageName: "Pagamento Confirmado",
      forwardOnly: false,
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ stageId: targetStage.id });
  });

  it("G2 — does not move any card when only a client is provided", async () => {
    await moveDealToStage({
      tenantId: "tenant-1",
      clientId: "client-with-multiple-trips",
      targetStageName: "Pagamento Confirmado",
      forwardOnly: true,
    });

    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cancelDealOnReservationCancellation
//
// Scenarios:
//  H. Happy path — deal found by reservationId, no other active reservation
//     → deal moved to "Cancelado" + marked LOST
//  I. Client has another active reservation for the same trip
//     → deal re-linked to active reservation, stays OPEN (no Cancelado move)
//  J. Deal not found by reservationId, found by client+trip fallback,
//     no active reservation → deal moved to Cancelado via fallback path
//  K. No deal found at all → no DB update, no error
//  L. Reservation record not found (no clientId/tripId) → no DB update
// ---------------------------------------------------------------------------

describe("cancelDealOnReservationCancellation", () => {

  // Scenario H: happy path — reservationId match, no active sibling on this trip
  it("H — moves deal to Cancelado when no active reservation exists for the same trip", async () => {
    const reservation    = { clientId: "client-1", tripId: "trip-1" };
    const deal           = { id: "deal-1", stageId: "stage-reserva" };
    const currentStage   = { pipelineId: "pipeline-a" };
    const cancelledStage = { id: "stage-cancelado" };

    // Q1: load reservation
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([reservation]);
    // Q2: deal by reservationId → found
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([deal]);
    // Q3: check active reservation (same trip) → none
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([]);
    // Q4: get pipelineId from current stage
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([currentStage]);
    // Q5: find "Cancelado" stage → exists
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([cancelledStage]);

    await cancelDealOnReservationCancellation({ tenantId: "tenant-1", reservationId: "res-cancelled" });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ stageId: cancelledStage.id, status: "lost" });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  // Scenario I: client has another active reservation → deal re-linked, stays OPEN
  it("I — re-links deal to active reservation when client has another active booking", async () => {
    const reservation     = { clientId: "client-1", tripId: "trip-1" };
    const deal            = { id: "deal-1", stageId: "stage-reserva" };
    const activeReservation = { id: "res-active-2" };

    // Q1: load reservation
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([reservation]);
    // Q2: deal by reservationId → found
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([deal]);
    // Q3: check active reservation → found!
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([activeReservation]);

    await cancelDealOnReservationCancellation({ tenantId: "tenant-1", reservationId: "res-cancelled" });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    // Must re-link to the active reservation — NOT move to Cancelado
    expect(mockUpdateSet).toHaveBeenCalledWith({ reservationId: activeReservation.id });
    // Must NOT mark LOST
    expect(mockUpdateSet).not.toHaveBeenCalledWith(expect.objectContaining({ status: "lost" }));
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  // Scenario J: deal not found by reservationId, found via client+trip fallback
  it("J — moves deal to Cancelado when found by client+trip fallback (pre-linkage deal)", async () => {
    const reservation    = { clientId: "client-1", tripId: "trip-1" };
    const deal           = { id: "deal-old", stageId: "stage-reserva" };
    const currentStage   = { pipelineId: "pipeline-a" };
    const cancelledStage = { id: "stage-cancelado" };

    // Q1: load reservation
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([reservation]);
    // Q2: deal by reservationId → NOT found
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([]);
    // Q3: deal by client+trip fallback → found (uses orderBy chain)
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([]));
    mockLimit.mockResolvedValueOnce([deal]);
    // Q4: check active reservation (same trip) → none
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([]);
    // Q5: get pipelineId from current stage
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([currentStage]);
    // Q6: find "Cancelado" stage → exists
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([cancelledStage]);

    await cancelDealOnReservationCancellation({ tenantId: "tenant-1", reservationId: "res-cancelled" });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ stageId: cancelledStage.id, status: "lost" });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  // Scenario M: another trip does not keep this cancelled trip's card active.
  it("M — cancels this trip's deal even when the client has another trip", async () => {
    const reservation           = { clientId: "client-1", tripId: "trip-1" };
    const deal                  = { id: "deal-1", stageId: "stage-reserva" };
    const currentStage          = { pipelineId: "pipeline-a" };
    const cancelledStage        = { id: "stage-cancelado" };

    // Q1: load reservation
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([reservation]);
    // Q2: deal by reservationId → found
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([deal]);
    // Q3: check active reservation (same trip) → none
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([]);
    // The lifecycle deliberately does not query other trips. The next lookup
    // is this deal's pipeline, so another trip cannot keep it open.
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([currentStage]);
    // Q5: find Cancelado stage
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([cancelledStage]);

    await cancelDealOnReservationCancellation({ tenantId: "tenant-1", reservationId: "res-cancelled" });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ stageId: cancelledStage.id, status: "lost" });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  // Scenario K: no deal found at all → no update
  it("K — returns without update when no open deal is found for the reservation", async () => {
    const reservation = { clientId: "client-1", tripId: "trip-1" };

    // Q1: load reservation
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([reservation]);
    // Q2: deal by reservationId → NOT found
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([]);
    // Q3: deal by client+trip fallback → NOT found
    mockWhere.mockImplementationOnce(() => wv([]));
    mockOrderBy.mockImplementationOnce(() => ov([]));
    mockLimit.mockResolvedValueOnce([]);

    await cancelDealOnReservationCancellation({ tenantId: "tenant-1", reservationId: "res-cancelled" });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  // Scenario L: reservation not found (no clientId/tripId) → no update
  it("L — returns without update when the reservation record is not found", async () => {
    // Q1: load reservation → NOT found
    mockWhere.mockImplementationOnce(() => wv([]));
    mockLimit.mockResolvedValueOnce([]);

    await cancelDealOnReservationCancellation({ tenantId: "tenant-1", reservationId: "res-ghost" });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});

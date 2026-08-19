/**
 * trip-cancellation-pipeline.test.ts
 *
 * Regression guard for Task #112:
 * When a trip is cancelled (PATCH /trips/:id { status: "cancelled" }), all
 * active (pending/confirmed) reservations must be bulk-cancelled atomically,
 * and cancelDealOnReservationCancellation must be called fire-and-forget for
 * every reservation that has a clientId — so Pipeline deals are moved to
 * "Cancelado" rather than remaining stuck in an open column.
 *
 * Scenarios:
 *  A. Two active reservations both with clientId → cancels both deals
 *  B. One reservation with clientId=null → no deal cancellation for that one
 *  C. No active reservations → no deal cancellation at all
 *  D. Mix: one with clientId, one without → only the one with clientId triggers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted shared mock state
// ---------------------------------------------------------------------------

const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockTransaction,
  mockCancelDeal,
  mockCancellationEmail,
  capturedTxUpdates,
} = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockTransaction = vi.fn();
  const mockCancelDeal = vi.fn().mockResolvedValue(undefined);
  const mockCancellationEmail = vi.fn().mockResolvedValue(undefined);
  const capturedTxUpdates: Array<{ table: unknown; set: unknown }> = [];
  return { mockLimit, mockWhere, mockFrom, mockSelect, mockTransaction, mockCancelDeal, mockCancellationEmail, capturedTxUpdates };
});

// ---------------------------------------------------------------------------
// Module mocks — must precede all imports of modules under test
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    transaction: mockTransaction,
  },
  reservationsTable: { _: "reservations" },
  tripsTable:        { _: "trips" },
  clientsTable:      { _: "clients" },
  tenantsTable:      { _: "tenants" },
  plansTable:        { _: "plans" },
  passengersTable:   { _: "passengers" },
  referralsTable:    { _: "referrals" },
  dealsTable:        { _: "deals" },
  pipelineStagesTable: { _: "pipelineStages" },
  auditLogsTable:    { _: "auditLogs" },
  vehicleLayoutsTable: { _: "vehicleLayouts" },
  tripMediaTable:    { _: "tripMedia" },
  tripCheckinsTable: { _: "tripCheckins" },
  tripGuideLocationsTable: { _: "tripGuideLocations" },
  boardingLocationsTable: { _: "boardingLocations" },
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return {
    ...makeDrizzleOrmMock(),
    // Serialize tagged template so captured values include actual strings.
    sql: Object.assign(
      (strings: TemplateStringsArray, ...vals: unknown[]): string => {
        let r = "";
        strings.forEach((s, i) => { r += s; if (i < vals.length) r += String(vals[i]); });
        return r;
      },
      { raw: vi.fn() },
    ),
  };
});

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_clerk" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["superadmin", "agencia"],
  MANAGEMENT_ROLES: ["superadmin", "agencia", "gerente"],
}));

vi.mock("../lib/seat-sse.js", () => ({
  addSeatClient:    vi.fn(),
  removeSeatClient: vi.fn(),
  emitSeatUpdate:   vi.fn(),
}));

vi.mock("../lib/boarding-sse.js", () => ({
  tryAddBoardingClient: vi.fn(),
  removeBoardingClient: vi.fn(),
  emitBoardingUpdate:   vi.fn(),
}));

vi.mock("../lib/get-client-ip.js", () => ({ getClientIp: vi.fn(() => "127.0.0.1") }));

vi.mock("../lib/uploadthing.js", () => ({
  deleteOrphanedFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/plan-features.js", () => ({
  hasSeatMapFeature: vi.fn(() => false),
}));

vi.mock("../lib/passenger.js", () => ({
  deriveAgeCategory: vi.fn(() => "adult"),
  getAgeYears: vi.fn(() => 30),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: { syncTrip: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../lib/google-calendar/schedule-sync.js", () => ({
  scheduleCalendarSyncTrip: vi.fn().mockResolvedValue(undefined),
  scheduleCalendarDeleteEventsForTrip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/email", () => ({
  sendManifestEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/email-helpers.js", () => ({
  dispatchReferralReversedEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationCancellationEmail: mockCancellationEmail,
}));

vi.mock("../queues/index.js", () => ({
  getPdfQueue: vi.fn(() => null),
}));

vi.mock("../lib/redis.js", () => ({
  areWorkersEnabled: vi.fn(() => false),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/pipeline-automation.js", () => ({
  cancelDealOnReservationCancellation: mockCancelDeal,
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/manifest-helpers.js", () => ({
  escapeHtmlServer: vi.fn((v: string) => v),
  formatCpfServer: vi.fn((v: string) => v),
  seatWithPosition: vi.fn((s: string) => s),
  AGE_CATEGORY_LABELS_SERVER: {},
  generateManifestHtml: vi.fn(() => "<html/>"),
  generateManifestPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
  generateVoucherCode: vi.fn(() => "VCHR-001"),
}));

vi.mock("../lib/status-validators.js", () => ({
  parseTripStatus: vi.fn((v: string) => v),
}));

vi.mock("../lib/planLimits.js", () => ({
  checkPlanLimit: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import tripsRouter from "../routes/trips.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const ME = { id: "usr-1", tenantId: "tenant-1", role: "agencia" as const };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(tripsRouter);
  app.use(errorHandler);
  return app;
}

// Minimal trip row returned after update.
// formatTrip calls .toISOString() on departureDate, createdAt, updatedAt —
// all must be real Date objects (not null/undefined) to avoid TypeError → 500.
const TRIP_ROW = {
  id: "trip-1",
  tenantId: "tenant-1",
  slug: "excursao-nordeste",
  name: "Excursão Nordeste",
  status: "cancelled",
  totalCapacity: 40,
  availableSeats: 0,
  reservedSeats: 0,
  confirmedSeats: 0,
  departureDate: new Date("2026-08-01"),
  returnDate: null,
  departureTime: null,
  returnTime: null,
  priceAdult: "300",
  priceChild: null,
  priceSenior: null,
  description: null,
  coverImage: null,
  isPublic: false,
  isFeatured: false,
  seatLayout: "2x2",
  layoutId: null,
  seatMap: {},
  boardingPoints: [],
  freePassengers: [],
  freeOrganizers: null,
  freeGuides: null,
  fixedCosts: [],
  variableCosts: [],
  gallery: [],
  inclusions: [],
  exclusions: [],
  itinerary: null,
  vehiclePlate: null,
  vehicleType: null,
  driverName: null,
  tourGuide: null,
  tripOrganizer: null,
  driver1Cpf: null,
  driver1Cnh: null,
  driver1CnhCategory: null,
  driver1CnhExpiry: null,
  driver2Name: null,
  driver2Cpf: null,
  driver2Cnh: null,
  driver2CnhCategory: null,
  driver2CnhExpiry: null,
  tourGuideCpf: null,
  tourGuideRegistration: null,
  manifestNumber: null,
  destination: "Fortaleza",
  destinationCity: "Fortaleza",
  destinationState: "CE",
  originCity: null,
  originState: null,
  category: "",
  type: "",
  showSeatMap: true,
  createdAt: new Date("2026-07-01"),
  updatedAt: new Date("2026-07-20"),
};

/**
 * Queue up mockSelect slots for the standard trip-cancellation PATCH path.
 * Slots (in order of db.select() calls in the handler):
 *   1. tenantsTable   → plan lookup
 *   2. plansTable     → features lookup
 *   3. reservationsTable → allActiveReservations
 *   4. (optional) referralsTable → only queued when reservations have referral codes
 *   5. tripsTable     → final read after transaction
 */
function queueSelectSlots(activeReservations: Array<{ id: string; clientId: string | null; discountReferralCode: string | null }>) {
  // Slot 1: tenantsTable
  mockSelect.mockImplementationOnce(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ planId: "starter" }]) })),
    })),
  }));
  // Slot 2: plansTable
  mockSelect.mockImplementationOnce(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ supportedFeatures: [] }]) })),
    })),
  }));
  // Slot 3: reservationsTable (allActiveReservations — no .limit())
  mockSelect.mockImplementationOnce(() => ({
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(activeReservations),
    })),
  }));
  // Slot 5 (final): tripsTable after transaction
  mockSelect.mockImplementationOnce(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([TRIP_ROW]) })),
    })),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedTxUpdates.length = 0;

  // Default requireAuth
  vi.mocked(requireAuth).mockImplementation(async (_req, res) => {
    res.locals.auth = ME;
    return ME as never;
  });

  // Default transaction: runs the callback with a tx that records updates
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    const txUpdateWhere = vi.fn().mockResolvedValue([]);
    const txUpdateSet = vi.fn((setArg: unknown) => {
      capturedTxUpdates[capturedTxUpdates.length - 1].set = setArg;
      return { where: txUpdateWhere };
    });
    const txUpdate = vi.fn((table: unknown) => {
      capturedTxUpdates.push({ table, set: null });
      return { set: txUpdateSet };
    });
    const txExecute = vi.fn().mockResolvedValue([]);
    await cb({ update: txUpdate, execute: txExecute });
  });
});

// ---------------------------------------------------------------------------
// Scenario A — two active reservations both with clientId
// ---------------------------------------------------------------------------

describe("PATCH /trips/:id status=cancelled — Pipeline deal cancellation", () => {
  it("A. calls cancelDealOnReservationCancellation for each reservation with clientId", async () => {
    const activeReservations = [
      { id: "res-1", clientId: "cli-1", discountReferralCode: null },
      { id: "res-2", clientId: "cli-2", discountReferralCode: null },
    ];
    queueSelectSlots(activeReservations);

    const app = makeApp();
    const res = await request(app)
      .patch("/trips/trip-1")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // Allow fire-and-forget to settle
    await new Promise(r => setImmediate(r));

    expect(mockCancelDeal).toHaveBeenCalledTimes(2);
    expect(mockCancelDeal).toHaveBeenCalledWith({ tenantId: "tenant-1", reservationId: "res-1" });
    expect(mockCancelDeal).toHaveBeenCalledWith({ tenantId: "tenant-1", reservationId: "res-2" });
  });

  // ---------------------------------------------------------------------------
  // Scenario B — reservation with clientId=null is skipped
  // ---------------------------------------------------------------------------

  it("B. does NOT call cancelDealOnReservationCancellation for reservations without clientId", async () => {
    const activeReservations = [
      { id: "res-null", clientId: null, discountReferralCode: null },
    ];
    queueSelectSlots(activeReservations);

    const app = makeApp();
    const res = await request(app)
      .patch("/trips/trip-1")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(mockCancelDeal).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario C — no active reservations
  // ---------------------------------------------------------------------------

  it("C. does NOT call cancelDealOnReservationCancellation when there are no active reservations", async () => {
    queueSelectSlots([]);

    const app = makeApp();
    const res = await request(app)
      .patch("/trips/trip-1")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(mockCancelDeal).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario D — mixed: one with clientId, one without
  // ---------------------------------------------------------------------------

  it("D. calls cancelDealOnReservationCancellation only for reservation that has clientId", async () => {
    const activeReservations = [
      { id: "res-with-client",    clientId: "cli-1",  discountReferralCode: null },
      { id: "res-without-client", clientId: null,     discountReferralCode: null },
    ];
    queueSelectSlots(activeReservations);

    const app = makeApp();
    const res = await request(app)
      .patch("/trips/trip-1")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(mockCancelDeal).toHaveBeenCalledTimes(1);
    expect(mockCancelDeal).toHaveBeenCalledWith({ tenantId: "tenant-1", reservationId: "res-with-client" });
    expect(mockCancelDeal).not.toHaveBeenCalledWith(expect.objectContaining({ reservationId: "res-without-client" }));
  });

  // ---------------------------------------------------------------------------
  // Scenario E — bulk reservation update happens inside the transaction
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Scenario F — cancellation email enqueued for every active reservation
  // ---------------------------------------------------------------------------

  it("F. enqueues a cancellation email for each active reservation", async () => {
    const activeReservations = [
      { id: "res-1", clientId: "cli-1", discountReferralCode: null },
      { id: "res-2", clientId: "cli-2", discountReferralCode: null },
    ];
    queueSelectSlots(activeReservations);

    const app = makeApp();
    const res = await request(app)
      .patch("/trips/trip-1")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(mockCancellationEmail).toHaveBeenCalledTimes(2);
    expect(mockCancellationEmail).toHaveBeenCalledWith("res-1", "tenant-1");
    expect(mockCancellationEmail).toHaveBeenCalledWith("res-2", "tenant-1");
  });

  it("F2. does NOT enqueue a cancellation email when there are no active reservations", async () => {
    queueSelectSlots([]);

    const app = makeApp();
    const res = await request(app)
      .patch("/trips/trip-1")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(mockCancellationEmail).not.toHaveBeenCalled();
  });

  it("E. bulk-cancels active reservations inside the transaction", async () => {
    const { reservationsTable } = await import("@workspace/db");
    const activeReservations = [
      { id: "res-1", clientId: "cli-1", discountReferralCode: null },
    ];
    queueSelectSlots(activeReservations);

    const app = makeApp();
    await request(app)
      .patch("/trips/trip-1")
      .send({ status: "cancelled" });

    // The transaction must have been invoked
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    // At least one update inside the tx should target reservationsTable
    const reservationUpdate = capturedTxUpdates.find(u => u.table === reservationsTable);
    expect(reservationUpdate).toBeDefined();

    // And the SET payload should include status: "cancelled"
    const setPayload = reservationUpdate?.set as Record<string, unknown> | undefined;
    expect(setPayload?.status).toBe("cancelled");
  });
});

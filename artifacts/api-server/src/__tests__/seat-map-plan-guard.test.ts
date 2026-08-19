/**
 * Seat-map API route plan guard tests
 *
 * Verifies that:
 *   - GET /trips/:id/seat-map returns 403 FEATURE_NOT_IN_PLAN when the
 *     tenant's plan does not include "seatMap" in supportedFeatures
 *   - POST /trips/:id/regenerate-seat-map returns 403 FEATURE_NOT_IN_PLAN
 *     for admin users on a plan without the feature
 *   - GET /trips/:id/seats/stream (SSE) returns 403 FEATURE_NOT_IN_PLAN
 *     when the plan does not include "seatMap"
 *   - All three routes succeed (2xx) when the plan includes "seatMap"
 *
 * All DB calls are intercepted via vi.mock so no real database is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";

// ---------------------------------------------------------------------------
// vi.hoisted: shared mock factories must exist before any vi.mock factory runs
// ---------------------------------------------------------------------------

const { mockLimit, mockWhere, mockFrom, mockSelect, mockRequireAuth, mockAddSeatClient } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere: ReturnType<typeof vi.fn> = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockRequireAuth = vi.fn();
  const mockAddSeatClient = vi.fn();
  return { mockLimit, mockWhere, mockFrom, mockSelect, mockRequireAuth, mockAddSeatClient };
});

// ---------------------------------------------------------------------------
// Module mocks (must appear before router import)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    transaction: vi.fn(),
  },
  tripsTable: {},
  reservationsTable: {},
  tenantsTable: {},
  plansTable: {},
  passengersTable: {},
  clientsTable: {},
  usersTable: {},
  vehicleLayoutsTable: {},
  auditLogsTable: {},
  referralsTable: {},
  tripMediaTable: {},
  tripCheckinsTable: {},
  tripGuideLocationsTable: {},
  storesTable: {},
  storeOrdersTable: {},
  storeOrderItemsTable: {},
  storeProductsTable: {},
  storeProductVariantsTable: {},
  storeCouponsTable: {},
  storeReviewsTable: {},
  storeCategoriesTable: {},
  loyaltyMembersTable: {},
  loyaltyTransactionsTable: {},
  loyaltyProgramsTable: {},
  referralSettingsTable: {},
  dealsTable: {},
  pipelineStagesTable: {},
  emailLogsTable: {},
  referralTrackingTable: {},
  paymentsTable: {},
  commissionsTable: {},
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("@workspace/permissions", () => ({
  ROLES: {
    SUPER_ADMIN: "superadmin",
    AGENCY_ADMIN: "admin",
    MANAGER: "manager",
  },
  RESERVATION_STATUS: { PENDING: "pending", CONFIRMED: "confirmed" },
  REFERRAL_STATUS: {},
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin", "superadmin"],
  MANAGEMENT_ROLES: ["admin", "superadmin", "manager"],
}));

vi.mock("../lib/seat-sse.js", () => ({
  addSeatClient: mockAddSeatClient,
  removeSeatClient: vi.fn(),
  emitSeatUpdate: vi.fn(),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/boarding-sse.js", () => ({
  tryAddBoardingClient: vi.fn(),
  removeBoardingClient: vi.fn(),
  emitBoardingUpdate: vi.fn(),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
    deleteEventsForTrip: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/google-calendar/schedule-sync.js", () => ({
  scheduleCalendarSyncTrip: vi.fn().mockResolvedValue(undefined),
  scheduleCalendarDeleteEventsForTrip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/uploadthing.js", () => ({
  deleteOrphanedFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/plan-features.js", () => ({
  hasSeatMapFeature: (features: string[]) => features.includes("seatMap"),
}));

vi.mock("../lib/passenger.js", () => ({
  deriveAgeCategory: vi.fn(() => "adult"),
  getAgeYears: vi.fn(() => 30),
}));

vi.mock("../lib/planLimits.js", () => ({
  checkPlanLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
}));

vi.mock("../lib/status-validators.js", () => ({
  parseTripStatus: vi.fn((s: string) => s),
}));

vi.mock("../lib/redis.js", () => ({
  areWorkersEnabled: vi.fn(() => false),
}));

vi.mock("../lib/get-client-ip.js", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@workspace/email", () => ({
  sendManifestEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/index.js", () => ({
  getPdfQueue: vi.fn(() => ({ add: vi.fn().mockResolvedValue(undefined) })),
  getCalendarSyncQueue: vi.fn(() => null),
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralReversedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/commission-sync-helper.js", () => ({
  enqueueCommissionSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../routes/payments.js", () => ({
  syncReservationCommission: vi.fn().mockResolvedValue(undefined),
  recalculateClientFinancials: vi.fn().mockResolvedValue(undefined),
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), use: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------

import tripsRouter from "../routes/trips.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Minimal Express app
// ---------------------------------------------------------------------------

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  const noop = (..._args: unknown[]) => {};
  req.log = {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
  } as never;
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", tripsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const TENANT_ID = "tenant-001";
const TRIP_ID = "trip-001";

const FAKE_TRIP = {
  id: TRIP_ID,
  tenantId: TENANT_ID,
  layoutId: null,
  seatLayout: "2x2",
  totalCapacity: 2,
  freePassengers: [],
  seatMap: {
    "1": { row: 1, col: 1, floor: 1, status: "available", type: "seat" },
    "2": { row: 1, col: 2, floor: 1, status: "available", type: "seat" },
  },
};

// Fixture for regenerate-seat-map: needs a layoutId and Date objects for formatTrip
const FAKE_TRIP_WITH_LAYOUT = {
  id: TRIP_ID,
  tenantId: TENANT_ID,
  layoutId: "layout-001",
  name: "Test Trip",
  slug: "test-trip-t001",
  description: null,
  destination: "São Paulo",
  destinationCity: "São Paulo",
  destinationState: "SP",
  type: "nacional",
  category: "turismo",
  departureDate: new Date("2026-08-01"),
  returnDate: null,
  totalCapacity: 0,
  availableSeats: 0,
  reservedSeats: 0,
  confirmedSeats: 0,
  priceAdult: "500",
  priceChild: null,
  priceSenior: null,
  inclusions: [],
  exclusions: [],
  coverImage: null,
  gallery: [],
  itinerary: [],
  boardingPoints: [],
  status: "active",
  isPublic: true,
  isFeatured: false,
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
  freePassengers: [],
  seatMap: {},
  seatLayout: "2x2",
  showSeatMap: false,
  manifestNumber: null,
  fixedCosts: [],
  variableCosts: [],
  notes: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const FAKE_LAYOUT = {
  id: "layout-001",
  tenantId: TENANT_ID,
  cells: [],
  numberingType: "sequential",
};

// ---------------------------------------------------------------------------
// Helpers: configure requireAuth mock per test
// ---------------------------------------------------------------------------

function asAgencyAdmin() {
  mockRequireAuth.mockImplementation(async () => ({
    id: "user-001",
    tenantId: TENANT_ID,
    role: "admin",
  }));
}

// ---------------------------------------------------------------------------
// beforeEach: reset mocks and rebuild DB mock chain
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLimit.mockReset();

  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue(
    Object.assign(Promise.resolve([]), { limit: mockLimit, orderBy: mockOrderBy }),
  );
  mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit, orderBy: mockOrderBy });
  mockSelect.mockReturnValue({ from: mockFrom });
});

// ---------------------------------------------------------------------------
// Tests: GET /trips/:id/seat-map — plan guard
// ---------------------------------------------------------------------------

describe("GET /trips/:id/seat-map — seatMap plan guard", () => {
  it("returns 403 FEATURE_NOT_IN_PLAN when plan has no seatMap feature", async () => {
    asAgencyAdmin();

    // getTenantSupportedFeatures makes 2 .limit() calls:
    //   1 → tenant row (planId)
    //   2 → plan row (supportedFeatures — empty, no seatMap)
    mockLimit
      .mockResolvedValueOnce([{ planId: "plan-starter" }])
      .mockResolvedValueOnce([{ supportedFeatures: [] }]);

    const res = await request(buildApp()).get(`/api/trips/${TRIP_ID}/seat-map`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_NOT_IN_PLAN");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it("returns 403 when plan row is not found (defaults to no features)", async () => {
    asAgencyAdmin();

    // Both lookups return empty — defaults to [] → no seatMap
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp()).get(`/api/trips/${TRIP_ID}/seat-map`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_NOT_IN_PLAN");
  });

  it("returns 403 when plan has other features but not seatMap", async () => {
    asAgencyAdmin();

    mockLimit
      .mockResolvedValueOnce([{ planId: "plan-starter" }])
      .mockResolvedValueOnce([{ supportedFeatures: ["referrals", "coupons"] }]);

    const res = await request(buildApp()).get(`/api/trips/${TRIP_ID}/seat-map`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_NOT_IN_PLAN");
  });

  it("returns 200 and seat data when plan includes seatMap feature", async () => {
    asAgencyAdmin();

    // getTenantSupportedFeatures: 2 .limit() calls (tenant, plan)
    // Trip lookup: 1 .limit() call
    // Reservations query awaits .where() directly → resolves to [] (default)
    mockLimit
      .mockResolvedValueOnce([{ planId: "plan-pro" }])
      .mockResolvedValueOnce([{ supportedFeatures: ["seatMap"] }])
      .mockResolvedValueOnce([FAKE_TRIP]);

    const res = await request(buildApp()).get(`/api/trips/${TRIP_ID}/seat-map`);

    expect(res.status).toBe(200);
    expect(res.body.tripId).toBe(TRIP_ID);
    expect(Array.isArray(res.body.seats)).toBe(true);
    expect(res.body.seats).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /trips/:id/regenerate-seat-map — plan guard
// ---------------------------------------------------------------------------

describe("POST /trips/:id/regenerate-seat-map — seatMap plan guard", () => {
  it("returns 403 FEATURE_NOT_IN_PLAN for admin on plan without seatMap", async () => {
    asAgencyAdmin();

    // Role check passes (admin ∈ ADMIN_ROLES).
    // getTenantSupportedFeatures: 2 .limit() calls → no seatMap
    mockLimit
      .mockResolvedValueOnce([{ planId: "plan-starter" }])
      .mockResolvedValueOnce([{ supportedFeatures: [] }]);

    const res = await request(buildApp())
      .post(`/api/trips/${TRIP_ID}/regenerate-seat-map`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_NOT_IN_PLAN");
  });

  it("returns 403 FORBIDDEN_ROLE before even checking the plan for a non-admin", async () => {
    mockRequireAuth.mockImplementation(async () => ({
      id: "user-002",
      tenantId: TENANT_ID,
      role: "viewer",
    }));

    // No DB calls needed — role check fires first
    const res = await request(buildApp())
      .post(`/api/trips/${TRIP_ID}/regenerate-seat-map`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
  });

  it("returns 200 and formatted trip when admin has seatMap feature in plan", async () => {
    asAgencyAdmin();

    // DB call sequence:
    //   mockLimit #1 → tenant row (getTenantSupportedFeatures)
    //   mockLimit #2 → plan row with seatMap (getTenantSupportedFeatures)
    //   mockLimit #3 → trip row (needs layoutId ≠ null)
    //   mockLimit #4 → layout row (cells: [] → generates empty seatMap)
    //   mockWhere direct await → [] (no active reservations, from beforeEach default)
    //   db.transaction → vi.fn() resolves void (callback not invoked in mock)
    //   mockLimit #5 → trip row (final refetch for response)
    mockLimit
      .mockResolvedValueOnce([{ planId: "plan-pro" }])
      .mockResolvedValueOnce([{ supportedFeatures: ["seatMap"] }])
      .mockResolvedValueOnce([FAKE_TRIP_WITH_LAYOUT])
      .mockResolvedValueOnce([FAKE_LAYOUT])
      .mockResolvedValueOnce([FAKE_TRIP_WITH_LAYOUT]);

    const res = await request(buildApp())
      .post(`/api/trips/${TRIP_ID}/regenerate-seat-map`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TRIP_ID);
    expect(res.body.departureDate).toBe(new Date("2026-08-01").toISOString());
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /trips/:id/seats/stream — seatMap plan guard
// ---------------------------------------------------------------------------

describe("GET /trips/:id/seats/stream — seatMap plan guard", () => {
  it("returns 403 FEATURE_NOT_IN_PLAN when plan has no seatMap feature", async () => {
    asAgencyAdmin();

    // getTenantSupportedFeatures: 2 .limit() calls → no seatMap
    mockLimit
      .mockResolvedValueOnce([{ planId: "plan-starter" }])
      .mockResolvedValueOnce([{ supportedFeatures: [] }]);

    const res = await request(buildApp())
      .get(`/api/trips/${TRIP_ID}/seats/stream`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_NOT_IN_PLAN");
  });

  it("returns 200 with text/event-stream content-type when plan includes seatMap", async () => {
    asAgencyAdmin();

    // DB call sequence:
    //   mockLimit #1 → tenant row (getTenantSupportedFeatures)
    //   mockLimit #2 → plan row with seatMap (getTenantSupportedFeatures)
    //   mockLimit #3 → trip row (only { id } is selected)
    // addSeatClient mock calls res.end() so supertest can resolve the SSE response.
    mockLimit
      .mockResolvedValueOnce([{ planId: "plan-pro" }])
      .mockResolvedValueOnce([{ supportedFeatures: ["seatMap"] }])
      .mockResolvedValueOnce([{ id: TRIP_ID }]);

    mockAddSeatClient.mockImplementationOnce((_tripId: string, res: import("express").Response) => {
      res.end();
    });

    const res = await request(buildApp())
      .get(`/api/trips/${TRIP_ID}/seats/stream`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
  });
});

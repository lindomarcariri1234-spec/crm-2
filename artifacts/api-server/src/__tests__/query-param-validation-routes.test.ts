/**
 * #740 — Zod validation nos query params de rotas adicionais
 *
 * Verifies that the Zod schema guards on query parameters in the four
 * new routes return 400 VALIDATION_ERROR for invalid values, and
 * return a non-400 response for valid/omitted values.
 *
 * Strategy: mock requireAuth + minimal DB/deps stub so every test
 * exercises only the validation layer.
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Shared auth mock
// ---------------------------------------------------------------------------

const { mockRequireAuth, mockSelect } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER],
  MANAGEMENT_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER],
}));

// ---------------------------------------------------------------------------
// Minimal DB stub
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => {
  const noop = vi.fn();
  const chain = {
    from: noop,
    where: noop,
    limit: noop,
    offset: noop,
    leftJoin: noop,
    orderBy: noop,
    $dynamic: noop,
    innerJoin: noop,
    groupBy: noop,
  };
  noop.mockReturnValue(chain);
  Object.keys(chain).forEach(k => {
    (chain as Record<string, unknown>)[k] = vi.fn().mockReturnValue(chain);
  });

  const db = {
    select: mockSelect.mockImplementation(() => chain),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    transaction: vi.fn(),
  };

  return {
    db,
    clientsTable: {},
    tripsTable: {},
    reservationsTable: {},
    paymentsTable: {},
    dealsTable: {},
    pipelinesTable: {},
    pipelineStagesTable: {},
    npsResponsesTable: {},
    expensesTable: {},
    passengersTable: {},
    loyaltyMembersTable: {},
    usersTable: {},
    notesTable: {},
    referralsTable: {},
    storeOrdersTable: {},
    storeReviewsTable: {},
    clientScoresTable: {},
    tenantsTable: {},
    referralAttemptLogsTable: {},
    calendarEventsTable: {},
    campaignSendsTable: {},
    clientNpsResponsesTable: {},
    auditLogsTable: {},
  };
});

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return {
    ...makeDrizzleOrmMock(),
  };
});

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Route dependencies
vi.mock("../lib/pricing.js", () => ({ roundMoney: vi.fn((v: number) => v) }));
vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "test-id") }));
vi.mock("../lib/list-limits.js", () => ({ LIST_SAFETY_CAP: 500 }));
vi.mock("../lib/ai-client.js", () => ({ getAIClientForTenant: vi.fn() }));
vi.mock("../lib/status-validators.js", () => ({
  parseDealStatus: vi.fn((v: string) => v),
  parseTripStatus: vi.fn((v: string) => v),
  parseReservationStatus: vi.fn((v: string) => v),
}));
vi.mock("../lib/cpf.js", () => ({ validateCPF: vi.fn(() => true), cleanCPF: vi.fn((v: string) => v) }));
vi.mock("../lib/referral-code.js", () => ({ generateAndAssignReferralCode: vi.fn() }));
vi.mock("../lib/client-scores.js", () => ({ calculateScoresForClient: vi.fn() }));
vi.mock("../lib/redis.js", () => ({ getRedisConnection: vi.fn(), areWorkersEnabled: vi.fn(() => false) }));
vi.mock("../lib/planLimits.js", () => ({ checkPlanLimit: vi.fn() }));
vi.mock("../lib/plan-features.js", () => ({ hasSeatMapFeature: vi.fn(() => false) }));
vi.mock("../lib/passenger.js", () => ({ deriveAgeCategory: vi.fn(), getAgeYears: vi.fn() }));
vi.mock("../lib/seat-sse.js", () => ({ addSeatClient: vi.fn(), removeSeatClient: vi.fn() }));
vi.mock("../lib/boarding-sse.js", () => ({
  tryAddBoardingClient: vi.fn(),
  removeBoardingClient: vi.fn(),
  emitBoardingUpdate: vi.fn(),
}));
vi.mock("../lib/get-client-ip.js", () => ({ getClientIp: vi.fn(() => "127.0.0.1") }));
vi.mock("../lib/birthday.js", () => ({ processBirthdayForClient: vi.fn(), getBirthdaySettings: vi.fn() }));
vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: vi.fn(() => ({ syncTripToCalendar: vi.fn(), deleteEventsForTrip: vi.fn() })),
}));
vi.mock("../lib/google-calendar/schedule-sync.js", () => ({
  scheduleCalendarSyncTrip: vi.fn(),
  scheduleCalendarDeleteEventsForTrip: vi.fn(),
  scheduleCalendarSyncBirthday: vi.fn(),
}));
vi.mock("../queues/email-helpers.js", () => ({
  dispatchReferralWelcomeEmail: vi.fn(),
  dispatchReferralCodeSuspendedEmail: vi.fn(),
  dispatchReferralReversedEmail: vi.fn(),
}));
vi.mock("../queues/index.js", () => ({ getPdfQueue: vi.fn(() => ({ add: vi.fn() })) }));
vi.mock("@workspace/email", () => ({ sendManifestEmail: vi.fn() }));
vi.mock("sanitize-html", () => ({ default: vi.fn((v: string) => v) }));
vi.mock("pdfkit", () => ({ default: vi.fn(() => ({ pipe: vi.fn(), end: vi.fn(), on: vi.fn(), text: vi.fn(), addPage: vi.fn() })) }));

// ---------------------------------------------------------------------------
// Import routes + error handler AFTER mocks
// ---------------------------------------------------------------------------

import dashboardRouter from "../routes/dashboard.js";
import tripsRouter from "../routes/trips.js";
import clientsRouter from "../routes/clients.js";
import pipelineRouter from "../routes/pipeline.js";
import { errorHandler, requestId } from "../middlewares/errorHandler.js";

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  const noop = (..._args: unknown[]) => {};
  req.log = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop } as never;
  next();
}

function buildApp() {
  const app = express();
  app.use(requestId);
  app.use(stubLogger);
  app.use(express.json());
  app.use(dashboardRouter);
  app.use(tripsRouter);
  app.use(clientsRouter);
  app.use(pipelineRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

const agencyAdmin = {
  id: "user-1",
  tenantId: "tenant-1",
  role: ROLES.AGENCY_ADMIN,
};

// ---------------------------------------------------------------------------
// GET /dashboard/revenue-chart — period enum validation
// ---------------------------------------------------------------------------

describe("GET /dashboard/revenue-chart — period query param validation", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(agencyAdmin);
  });

  it("rejects invalid period value with 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .get("/dashboard/revenue-chart")
      .query({ period: "invalid" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects 'daily' as unsupported period with 400", async () => {
    const res = await request(app)
      .get("/dashboard/revenue-chart")
      .query({ period: "daily" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts '7d' as a valid period", async () => {
    const res = await request(app)
      .get("/dashboard/revenue-chart")
      .query({ period: "7d" });

    expect(res.status).not.toBe(400);
  });

  it("accepts '30d' as a valid period", async () => {
    const res = await request(app)
      .get("/dashboard/revenue-chart")
      .query({ period: "30d" });

    expect(res.status).not.toBe(400);
  });

  it("accepts '90d' as a valid period", async () => {
    const res = await request(app)
      .get("/dashboard/revenue-chart")
      .query({ period: "90d" });

    expect(res.status).not.toBe(400);
  });

  it("accepts '12m' as a valid period", async () => {
    const res = await request(app)
      .get("/dashboard/revenue-chart")
      .query({ period: "12m" });

    expect(res.status).not.toBe(400);
  });

  it("defaults to '30d' when period is omitted (no 400)", async () => {
    const res = await request(app).get("/dashboard/revenue-chart");
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /dashboard/charts — period enum validation
// ---------------------------------------------------------------------------

describe("GET /dashboard/charts — period query param validation", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(agencyAdmin);
  });

  it("rejects invalid period value with 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .get("/dashboard/charts")
      .query({ period: "30d" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts '3m' as a valid period", async () => {
    const res = await request(app)
      .get("/dashboard/charts")
      .query({ period: "3m" });

    expect(res.status).not.toBe(400);
  });

  it("accepts '6m' as a valid period", async () => {
    const res = await request(app)
      .get("/dashboard/charts")
      .query({ period: "6m" });

    expect(res.status).not.toBe(400);
  });

  it("accepts '12m' as a valid period", async () => {
    const res = await request(app)
      .get("/dashboard/charts")
      .query({ period: "12m" });

    expect(res.status).not.toBe(400);
  });

  it("defaults to '12m' when period is omitted (no 400)", async () => {
    const res = await request(app).get("/dashboard/charts");
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /trips — page/limit/status validation
// ---------------------------------------------------------------------------

describe("GET /trips — page, limit, status query param validation", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(agencyAdmin);
  });

  it("rejects page=0 with 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .get("/trips")
      .query({ page: "0" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects page=-1 with 400", async () => {
    const res = await request(app)
      .get("/trips")
      .query({ page: "-1" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects limit=0 with 400", async () => {
    const res = await request(app)
      .get("/trips")
      .query({ limit: "0" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects limit=501 (above max) with 400", async () => {
    const res = await request(app)
      .get("/trips")
      .query({ limit: "501" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid status value with 400", async () => {
    const res = await request(app)
      .get("/trips")
      .query({ status: "unknown_status" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts valid status 'draft'", async () => {
    const res = await request(app)
      .get("/trips")
      .query({ status: "draft" });

    expect(res.status).not.toBe(400);
  });

  it("accepts valid status 'published'", async () => {
    const res = await request(app)
      .get("/trips")
      .query({ status: "published" });

    expect(res.status).not.toBe(400);
  });

  it("accepts valid status 'cancelled'", async () => {
    const res = await request(app)
      .get("/trips")
      .query({ status: "cancelled" });

    expect(res.status).not.toBe(400);
  });

  it("accepts page=1 limit=20 (defaults)", async () => {
    const res = await request(app).get("/trips");
    expect(res.status).not.toBe(400);
  });

  it("accepts limit=100 (max boundary)", async () => {
    const res = await request(app)
      .get("/trips")
      .query({ limit: "100" });

    expect(res.status).not.toBe(400);
  });

  it("returns tenant-wide indicators even when the requested page is empty", async () => {
    type QueryChain = Promise<unknown[]> & {
      from: () => QueryChain;
      where: () => QueryChain;
      orderBy: () => QueryChain;
      limit: () => QueryChain;
      offset: () => QueryChain;
    };
    const result = (rows: unknown[]): QueryChain => {
      const chain = Promise.resolve(rows) as QueryChain;
      chain.from = () => chain;
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => chain;
      chain.offset = () => chain;
      return chain;
    };

    mockSelect
      .mockImplementationOnce(() => result([]))
      .mockImplementationOnce(() => result([{ count: 501 }]))
      .mockImplementationOnce(() => result([{
        total: 501,
        active: 400,
        totalCapacity: 20_000,
        occupiedSeats: 15_000,
        totalRevenue: 4_500_000,
      }]));

    const res = await request(app).get("/trips").query({ page: 42, limit: 12 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: [],
      total: 501,
      page: 42,
      limit: 12,
      stats: {
        total: 501,
        active: 400,
        totalCapacity: 20_000,
        occupiedSeats: 15_000,
        totalRevenue: 4_500_000,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// GET /trips/export — complete tenant backup
// ---------------------------------------------------------------------------

type ExportQueryChain = {
  from: () => ExportQueryChain;
  where: () => ExportQueryChain;
  orderBy: () => ExportQueryChain;
  limit: (value: number) => ExportQueryChain;
  offset: (value: number) => ExportQueryChain;
  then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => unknown;
};

function makeExportQuery(rows: Record<string, unknown>[]): ExportQueryChain {
  let filteredRows = rows;
  let limitValue = rows.length;
  let offsetValue = 0;
  const chain = {} as ExportQueryChain;
  Object.assign(chain, {
    from: () => chain,
    where: () => {
      // Simulate the database applying the tenant predicate that the route
      // must provide, while keeping .limit() observable to this regression test.
      filteredRows = rows.filter((row) => row.tenantId === agencyAdmin.tenantId);
      return chain;
    },
    orderBy: () => chain,
    limit: (value: number) => {
      limitValue = value;
      return chain;
    },
    offset: (value: number) => {
      offsetValue = value;
      return chain;
    },
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(filteredRows.slice(offsetValue, offsetValue + limitValue)).then(resolve, reject),
  });
  return chain;
}

function makeExportTrip(id: string, tenantId: string): Record<string, unknown> {
  return {
    id,
    tenantId,
    name: `Viagem ${id}`,
    slug: `viagem-${id}`,
    description: null,
    destination: "Fortaleza",
    destinationCity: "Fortaleza",
    destinationState: "CE",
    type: "excursao",
    category: "standard",
    departureDate: new Date("2026-09-01T12:00:00.000Z"),
    returnDate: null,
    totalCapacity: 46,
    availableSeats: 46,
    reservedSeats: 0,
    confirmedSeats: 0,
    priceAdult: "100",
    priceChild: null,
    priceSenior: null,
    inclusions: [],
    exclusions: [],
    coverImage: null,
    gallery: [],
    videos: [],
    itinerary: [],
    boardingPoints: [],
    status: "draft",
    isPublic: false,
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
    tourGuideCpf: null,
    tourGuideRegistration: null,
    manifestNumber: null,
    seatLayout: "2x2",
    layoutId: null,
    showSeatMap: true,
    fixedCosts: [],
    variableCosts: [],
    freeOrganizers: null,
    freeGuides: null,
    originCity: null,
    originState: null,
    departureTime: null,
    returnTime: null,
    createdAt: new Date("2026-01-01T12:00:00.000Z"),
    updatedAt: new Date("2026-01-01T12:00:00.000Z"),
  };
}

describe("GET /trips/export — complete tenant backup", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(agencyAdmin);
    mockSelect.mockClear();
  });

  it("streams every tenant trip in batches without leaking another tenant", async () => {
    const ownTrips = Array.from({ length: 1_251 }, (_, index) =>
      makeExportTrip(`tenant-trip-${index + 1}`, agencyAdmin.tenantId),
    );
    const otherTenantTrips = [
      makeExportTrip("other-tenant-trip-1", "tenant-other"),
      makeExportTrip("other-tenant-trip-2", "tenant-other"),
    ];
    const allTrips = [...ownTrips, ...otherTenantTrips];
    mockSelect
      .mockImplementationOnce(() => makeExportQuery(allTrips))
      .mockImplementationOnce(() => makeExportQuery(allTrips))
      .mockImplementationOnce(() => makeExportQuery(allTrips));

    const res = await request(app).get("/trips/export").query({ format: "ndjson" });
    const lines = res.text.trim().split("\n");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    expect(mockSelect).toHaveBeenCalledTimes(3);
    expect(lines).toHaveLength(1_251);
    expect(JSON.parse(lines[0])).toMatchObject({ id: "tenant-trip-1" });
    expect(JSON.parse(lines[1_250])).toMatchObject({ id: "tenant-trip-1251" });
    expect(lines.some((line) => line.includes("other-tenant-trip"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /clients — page/limit/sortBy/sortOrder validation
// ---------------------------------------------------------------------------

describe("GET /clients — page, limit, sortBy, sortOrder validation", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(agencyAdmin);
  });

  it("rejects page=0 with 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .get("/clients")
      .query({ page: "0" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects limit=501 (above max 500) with 400", async () => {
    const res = await request(app)
      .get("/clients")
      .query({ limit: "501" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid sortBy value with 400", async () => {
    const res = await request(app)
      .get("/clients")
      .query({ sortBy: "unknown_field" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid sortOrder value with 400", async () => {
    const res = await request(app)
      .get("/clients")
      .query({ sortOrder: "random" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects search longer than 200 chars with 400", async () => {
    const res = await request(app)
      .get("/clients")
      .query({ search: "a".repeat(201) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts defaults (all params omitted)", async () => {
    const res = await request(app).get("/clients");
    expect(res.status).not.toBe(400);
  });

  it("accepts valid sortBy 'name'", async () => {
    const res = await request(app)
      .get("/clients")
      .query({ sortBy: "name" });

    expect(res.status).not.toBe(400);
  });

  it("accepts valid sortBy 'purchaseScore'", async () => {
    const res = await request(app)
      .get("/clients")
      .query({ sortBy: "purchaseScore" });

    expect(res.status).not.toBe(400);
  });

  it("accepts valid sortOrder 'asc'", async () => {
    const res = await request(app)
      .get("/clients")
      .query({ sortOrder: "asc" });

    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /deals — status enum validation
// ---------------------------------------------------------------------------

describe("GET /deals — status query param validation", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(agencyAdmin);
  });

  it("rejects invalid status value with 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .get("/deals")
      .query({ status: "invalid_status" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects status 'closed' (not in enum) with 400", async () => {
    const res = await request(app)
      .get("/deals")
      .query({ status: "closed" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts status 'open'", async () => {
    const res = await request(app)
      .get("/deals")
      .query({ status: "open" });

    expect(res.status).not.toBe(400);
  });

  it("accepts status 'won'", async () => {
    const res = await request(app)
      .get("/deals")
      .query({ status: "won" });

    expect(res.status).not.toBe(400);
  });

  it("accepts status 'lost'", async () => {
    const res = await request(app)
      .get("/deals")
      .query({ status: "lost" });

    expect(res.status).not.toBe(400);
  });

  it("accepts all params omitted (no filters)", async () => {
    const res = await request(app).get("/deals");
    expect(res.status).not.toBe(400);
  });
});

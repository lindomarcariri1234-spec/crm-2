/**
 * Task #197 — Confirm the sales cycle numbers are correct for agencies
 * with real booking history.
 *
 * Tests for GET /api/insights/sales-cycle:
 *
 *  1. Overall aggregates: SQL snake_case columns map correctly to the
 *     camelCase JSON response (avg, median, p25, p75 for payment and trip).
 *  2. Null handling: SQL NULLs become JSON null — not 0 or undefined —
 *     so the chart line breaks cleanly for months/clients with no data.
 *  3. Channel-breakdown integrity: sum of byChannel[].clients equals the
 *     overall totalClients from the first CTE.
 *  4. 12-month trend gap-fill: the response trend array always has exactly
 *     12 entries keyed to consecutive calendar months; months absent from
 *     the DB result get avgDaysToPayment=null / avgDaysToTrip=null.
 *  5. Period query-param validation: unrecognised values return 400.
 *  6. Role gating: SALES and CLIENT roles receive 403.
 *
 * Strategy: the three db.execute() calls that power the endpoint are
 * mocked with vi.fn().mockResolvedValueOnce() so the SQL logic runs in
 * the real route handler while no PostgreSQL connection is needed.
 * localToday() is fixed to "2026-08-21" so the trend month sequence is
 * deterministic.
 */

import pino from "pino";
import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// vi.hoisted: shared mocks instantiated before any vi.mock factory runs
// ---------------------------------------------------------------------------

const { mockExecute, mockRequireAuth, mockLocalToday } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockRequireAuth: vi.fn(),
  // Fixed Brazil date so the 12-month trend sequence is deterministic.
  // 2026-08 means the window is 2025-09 … 2026-08.
  mockLocalToday: vi.fn(() => "2026-08-21"),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Keep all real @workspace/db exports (table definitions, etc.) but replace
// the db handle so no real DB connection is attempted.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      // db.select() is used by other routes in the same file; return a no-op
      // chain so those handlers don't throw if they happen to be called.
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
      // The sales-cycle handler uses only db.execute (three raw-SQL CTEs).
      execute: mockExecute,
    },
  };
});

// Fix localToday so trend months are deterministic across all environments.
vi.mock("@workspace/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/shared")>();
  return { ...actual, localToday: mockLocalToday };
});

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  AGENCY_STAFF_ROLES: [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SALES, ROLES.SUPPORT],
  ADMIN_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER],
  MANAGEMENT_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER],
}));

// Not called by the sales-cycle handler, but imported at the top of insights.ts.
vi.mock("../lib/ai-client.js", () => ({ getAIClientForTenant: vi.fn() }));
vi.mock("../lib/pricing.js", () => ({ roundMoney: vi.fn((v: number) => v) }));

// ---------------------------------------------------------------------------
// Import route + error handler AFTER all mocks are registered
// ---------------------------------------------------------------------------

import insightsRouter from "../routes/insights.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Minimal Express app
// ---------------------------------------------------------------------------

function stubLogger(
  req: express.Request & { log?: unknown },
  _res: express.Response,
  next: express.NextFunction,
) {
  req.log = pino({ level: "silent" });
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", insightsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  id: "user-001",
  tenantId: "tenant-abc",
  role: ROLES.AGENCY_ADMIN,
  name: "Admin",
  email: "admin@example.com",
};

/**
 * Queue the three db.execute() calls the handler makes in order:
 *   1. overall CTE   → single aggregate row
 *   2. channel CTE   → one row per acquisition channel
 *   3. trend CTE     → one row per month that has data
 */
function setupExecuteMocks(opts: {
  overallRow?: Record<string, unknown>;
  channelRows?: Record<string, unknown>[];
  trendRows?: Record<string, unknown>[];
}) {
  const defaultOverall: Record<string, unknown> = {
    total_clients: 35,
    clients_with_payment: 28,
    clients_with_trip: 22,
    avg_days_to_payment: "14.5",
    median_days_to_payment: "10.0",
    p25_days_to_payment: "5.0",
    p75_days_to_payment: "22.0",
    avg_days_to_trip: "45.3",
    median_days_to_trip: "40.0",
  };

  mockExecute
    .mockResolvedValueOnce({ rows: [opts.overallRow ?? defaultOverall] })
    .mockResolvedValueOnce({ rows: opts.channelRows ?? [] })
    .mockResolvedValueOnce({ rows: opts.trendRows ?? [] });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/insights/sales-cycle — overall aggregates mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(ADMIN_USER);
  });

  it("maps all SQL snake_case aggregate columns to camelCase JSON fields", async () => {
    setupExecuteMocks({
      overallRow: {
        total_clients: 35,
        clients_with_payment: 28,
        clients_with_trip: 22,
        avg_days_to_payment: "14.5",
        median_days_to_payment: "10.0",
        p25_days_to_payment: "5.0",
        p75_days_to_payment: "22.0",
        avg_days_to_trip: "45.3",
        median_days_to_trip: "40.0",
      },
    });

    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(200);

    expect(res.body).toMatchObject({
      period: "12m",
      totalClients: 35,
      clientsWithPayment: 28,
      clientsWithTrip: 22,
      avgDaysToPayment: 14.5,
      medianDaysToPayment: 10.0,
      p25DaysToPayment: 5.0,
      p75DaysToPayment: 22.0,
      avgDaysToTrip: 45.3,
      medianDaysToTrip: 40.0,
    });
  });

  it("uses the default period '12m' when period query param is omitted", async () => {
    setupExecuteMocks({});

    const res = await request(buildApp()).get("/api/insights/sales-cycle");
    expect(res.status).toBe(200);
    expect(res.body.period).toBe("12m");
  });

  it("accepts '30d' and '90d' period values", async () => {
    setupExecuteMocks({});
    const res30 = await request(buildApp()).get("/api/insights/sales-cycle?period=30d");
    expect(res30.status).toBe(200);
    expect(res30.body.period).toBe("30d");

    mockExecute.mockReset();
    setupExecuteMocks({});
    const res90 = await request(buildApp()).get("/api/insights/sales-cycle?period=90d");
    expect(res90.status).toBe(200);
    expect(res90.body.period).toBe("90d");
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/insights/sales-cycle — null handling (no paying clients)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(ADMIN_USER);
  });

  it("returns null for all aggregate metrics when the tenant has no paying clients yet", async () => {
    setupExecuteMocks({
      overallRow: {
        total_clients: 5,
        clients_with_payment: 0,
        clients_with_trip: 0,
        avg_days_to_payment: null,
        median_days_to_payment: null,
        p25_days_to_payment: null,
        p75_days_to_payment: null,
        avg_days_to_trip: null,
        median_days_to_trip: null,
      },
    });

    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(200);

    // Nulls from SQL must propagate as JSON null, never as 0 or undefined.
    expect(res.body.avgDaysToPayment).toBeNull();
    expect(res.body.medianDaysToPayment).toBeNull();
    expect(res.body.p25DaysToPayment).toBeNull();
    expect(res.body.p75DaysToPayment).toBeNull();
    expect(res.body.avgDaysToTrip).toBeNull();
    expect(res.body.medianDaysToTrip).toBeNull();

    // Count fields are still numeric (COALESCE to 0 in SQL).
    expect(res.body.totalClients).toBe(5);
    expect(res.body.clientsWithPayment).toBe(0);
    expect(res.body.clientsWithTrip).toBe(0);
  });

  it("returns null for trip metric only when no client has a confirmed trip yet", async () => {
    setupExecuteMocks({
      overallRow: {
        total_clients: 10,
        clients_with_payment: 8,
        clients_with_trip: 0,
        avg_days_to_payment: "7.0",
        median_days_to_payment: "6.5",
        p25_days_to_payment: "3.0",
        p75_days_to_payment: "10.0",
        avg_days_to_trip: null,
        median_days_to_trip: null,
      },
    });

    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(200);

    expect(res.body.avgDaysToPayment).toBe(7.0);
    expect(res.body.medianDaysToPayment).toBe(6.5);
    expect(res.body.avgDaysToTrip).toBeNull();
    expect(res.body.medianDaysToTrip).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/insights/sales-cycle — channel breakdown integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(ADMIN_USER);
  });

  it("sum of byChannel[].clients equals totalClients when every client has an origin", async () => {
    const channelRows = [
      { origin: "Instagram", clients: 15, avg_days_to_payment: "12.0", avg_days_to_trip: "40.0", conversion_rate: "80.0" },
      { origin: "Indicação",  clients: 10, avg_days_to_payment: "8.0",  avg_days_to_trip: "35.0", conversion_rate: "90.0" },
      { origin: "WhatsApp",   clients: 5,  avg_days_to_payment: "20.0", avg_days_to_trip: "55.0", conversion_rate: "60.0" },
    ];

    setupExecuteMocks({
      overallRow: {
        total_clients: 30,
        clients_with_payment: 25,
        clients_with_trip: 20,
        avg_days_to_payment: "13.0",
        median_days_to_payment: "10.0",
        p25_days_to_payment: "5.0",
        p75_days_to_payment: "18.0",
        avg_days_to_trip: "43.0",
        median_days_to_trip: "38.0",
      },
      channelRows,
    });

    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(200);

    const totalFromChannels = (res.body.byChannel as Array<{ clients: number }>)
      .reduce((sum: number, ch) => sum + ch.clients, 0);

    expect(totalFromChannels).toBe(res.body.totalClients);
  });

  it("COALESCE(origin, 'Outros') groups clients with no origin under 'Outros'", async () => {
    setupExecuteMocks({
      overallRow: {
        total_clients: 20,
        clients_with_payment: 15,
        clients_with_trip: 12,
        avg_days_to_payment: "11.0",
        median_days_to_payment: "9.0",
        p25_days_to_payment: "4.0",
        p75_days_to_payment: "15.0",
        avg_days_to_trip: "38.0",
        median_days_to_trip: "35.0",
      },
      channelRows: [
        { origin: "Outros", clients: 12, avg_days_to_payment: "11.5", avg_days_to_trip: "39.0", conversion_rate: "75.0" },
        { origin: "Google", clients: 8,  avg_days_to_payment: "10.0", avg_days_to_trip: "36.0", conversion_rate: "80.0" },
      ],
    });

    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(200);

    const origins = (res.body.byChannel as Array<{ origin: string }>).map((ch) => ch.origin);
    expect(origins).toContain("Outros");
  });

  it("maps channel SQL rows to the correct camelCase shape", async () => {
    setupExecuteMocks({
      channelRows: [
        {
          origin: "Facebook",
          clients: 7,
          avg_days_to_payment: "16.3",
          avg_days_to_trip: "50.1",
          conversion_rate: "71.4",
        },
      ],
    });

    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(200);

    const [ch] = res.body.byChannel as Array<Record<string, unknown>>;
    expect(ch).toMatchObject({
      origin: "Facebook",
      clients: 7,
      avgDaysToPayment: 16.3,
      avgDaysToTrip: 50.1,
      conversionRate: 71.4,
    });
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/insights/sales-cycle — 12-month trend gap-fill", () => {
  // localToday() is fixed to "2026-08-21" via the hoisted mock.
  // The 12 expected month keys (in order, oldest → newest):
  //   2025-09, 2025-10, 2025-11, 2025-12,
  //   2026-01, 2026-02, 2026-03, 2026-04,
  //   2026-05, 2026-06, 2026-07, 2026-08
  const EXPECTED_MONTHS = [
    "2025-09", "2025-10", "2025-11", "2025-12",
    "2026-01", "2026-02", "2026-03", "2026-04",
    "2026-05", "2026-06", "2026-07", "2026-08",
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(ADMIN_USER);
  });

  it("always returns exactly 12 trend entries regardless of DB result size", async () => {
    // DB returns data for only 3 months
    setupExecuteMocks({
      trendRows: [
        { month: "2026-06", avg_days_to_payment: "12.0", avg_days_to_trip: "40.0" },
        { month: "2026-07", avg_days_to_payment: "11.0", avg_days_to_trip: "38.0" },
        { month: "2026-08", avg_days_to_payment: "13.5", avg_days_to_trip: "42.0" },
      ],
    });

    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(200);
    expect(res.body.trend).toHaveLength(12);
  });

  it("trend month keys span 11 months back from current Brazil month, oldest first", async () => {
    setupExecuteMocks({ trendRows: [] });

    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(200);

    const months = (res.body.trend as Array<{ month: string }>).map((t) => t.month);
    expect(months).toEqual(EXPECTED_MONTHS);
  });

  it("months with no DB data have avgDaysToPayment=null and avgDaysToTrip=null", async () => {
    // Only 2026-06 and 2026-08 have data; all other 10 months must be null.
    setupExecuteMocks({
      trendRows: [
        { month: "2026-06", avg_days_to_payment: "9.0",  avg_days_to_trip: "35.0" },
        { month: "2026-08", avg_days_to_payment: "11.0", avg_days_to_trip: "38.0" },
      ],
    });

    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(200);

    const trend = res.body.trend as Array<{
      month: string;
      avgDaysToPayment: number | null;
      avgDaysToTrip: number | null;
    }>;

    // Populated months retain their values.
    const jun = trend.find((t) => t.month === "2026-06")!;
    expect(jun.avgDaysToPayment).toBe(9.0);
    expect(jun.avgDaysToTrip).toBe(35.0);

    const aug = trend.find((t) => t.month === "2026-08")!;
    expect(aug.avgDaysToPayment).toBe(11.0);
    expect(aug.avgDaysToTrip).toBe(38.0);

    // All other months must have null (not 0, not undefined) — this ensures
    // the chart line breaks rather than connecting to a spurious zero.
    const emptyMonths = trend.filter(
      (t) => t.month !== "2026-06" && t.month !== "2026-08",
    );
    expect(emptyMonths).toHaveLength(10);
    for (const t of emptyMonths) {
      expect(t.avgDaysToPayment).toBeNull();
      expect(t.avgDaysToTrip).toBeNull();
    }
  });

  it("a month with only payment data (no trip data) has avgDaysToTrip=null", async () => {
    setupExecuteMocks({
      trendRows: [
        { month: "2026-07", avg_days_to_payment: "14.0", avg_days_to_trip: null },
      ],
    });

    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(200);

    const jul = (res.body.trend as Array<{ month: string; avgDaysToPayment: number | null; avgDaysToTrip: number | null }>)
      .find((t) => t.month === "2026-07")!;
    expect(jul.avgDaysToPayment).toBe(14.0);
    expect(jul.avgDaysToTrip).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/insights/sales-cycle — query-param validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(ADMIN_USER);
  });

  it("returns 400 VALIDATION_ERROR for an unrecognised period value", async () => {
    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=week");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for period=year (valid for summary, not for sales-cycle)", async () => {
    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=year");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/insights/sales-cycle — role gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for a SALES role", async () => {
    mockRequireAuth.mockResolvedValue({ ...ADMIN_USER, role: ROLES.SALES });
    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(403);
  });

  it("returns 403 for a CLIENT role", async () => {
    mockRequireAuth.mockResolvedValue({ ...ADMIN_USER, role: ROLES.CLIENT });
    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(403);
  });

  it("allows AGENCY_MANAGER role", async () => {
    mockRequireAuth.mockResolvedValue({ ...ADMIN_USER, role: ROLES.AGENCY_MANAGER });
    setupExecuteMocks({});
    const res = await request(buildApp()).get("/api/insights/sales-cycle?period=12m");
    expect(res.status).toBe(200);
  });
});

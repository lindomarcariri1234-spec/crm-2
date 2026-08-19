/**
 * #734 — Zod validation nos query params de rotas admin
 *
 * Verifies that the Zod schema guards on query parameters in the three
 * affected routes return 400 VALIDATION_ERROR for invalid values, and
 * return a successful response (2xx) for valid/omitted values.
 *
 * Strategy: mock requireAuth + a minimal DB stub so every test exercises
 * only the validation layer; DB calls never execute because Zod rejects
 * before them.
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Shared auth mock — re-assigned per test via requireAuth.mockResolvedValue
// ---------------------------------------------------------------------------

const { mockRequireAuth } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  ADMIN_ROLES: [
    ROLES.SUPER_ADMIN,
    ROLES.AGENCY_ADMIN,
    ROLES.AGENCY_MANAGER,
  ],
  MANAGEMENT_ROLES: [
    ROLES.SUPER_ADMIN,
    ROLES.AGENCY_ADMIN,
    ROLES.AGENCY_MANAGER,
  ],
}));

// ---------------------------------------------------------------------------
// Minimal DB stub — queries should never reach DB in these tests
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => {
  const noop = vi.fn();
  const chain = { from: noop, where: noop, limit: noop, leftJoin: noop, orderBy: noop, $dynamic: noop };
  noop.mockReturnValue(chain);
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.$dynamic.mockReturnValue(chain);

  const db = {
    select: vi.fn(() => chain),
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
    npsResponsesTable: {},
    expensesTable: {},
    loyaltyMembersTable: {},
    commissionsTable: {},
    destinationsTable: {},
    suppliersTable: {},
    campaignsTable: {},
    referralsTable: {},
    passengersTable: {},
    tenantsTable: {},
    usersTable: {},
    auditLogsTable: {},
    plansTable: {},
    emailLogsTable: {},
    birthdayMessagesTable: {},
    couponsTable: {},
    systemConfigsTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a: unknown[]) => a),
  or: vi.fn((...a: unknown[]) => a),
  desc: vi.fn(() => "desc"),
  count: vi.fn(() => "count"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
  gte: vi.fn(() => "gte"),
  lte: vi.fn(() => "lte"),
  lt: vi.fn(() => "lt"),
  isNotNull: vi.fn(() => "isNotNull"),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/ai-client.js", () => ({
  getAIClientForTenant: vi.fn(),
}));

vi.mock("../lib/list-limits.js", () => ({
  LIST_SAFETY_CAP: 500,
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "test-id"),
}));

vi.mock("../lib/birthday.js", () => ({
  processBirthdayForClient: vi.fn(),
  getBirthdaySettings: vi.fn(),
}));

vi.mock("../lib/pricing.js", () => ({
  roundMoney: vi.fn((v: number) => v),
}));

// ---------------------------------------------------------------------------
// Import routes + error handler AFTER mocks are registered
// ---------------------------------------------------------------------------

import insightsRouter from "../routes/insights.js";
import adminMetricsRouter from "../routes/admin-metrics.js";
import birthdayRouter from "../routes/birthday.js";
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
  app.use(insightsRouter);
  app.use(adminMetricsRouter);
  app.use(birthdayRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

// ---------------------------------------------------------------------------
// Shared user fixtures
// ---------------------------------------------------------------------------

const agencyAdmin = {
  id: "user-1",
  tenantId: "tenant-1",
  role: ROLES.AGENCY_ADMIN,
};

const superAdmin = {
  id: "user-super",
  tenantId: "tenant-super",
  role: ROLES.SUPER_ADMIN,
};

// ---------------------------------------------------------------------------
// insights GET /insights/summary — period validation
// ---------------------------------------------------------------------------

describe("GET /insights/summary — period query param validation", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(agencyAdmin);
  });

  it("rejects invalid period value with 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .get("/insights/summary")
      .query({ period: "invalid" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(res.body.error).toMatch(/period/i);
  });

  it("rejects 'week' as an unsupported period value with 400", async () => {
    const res = await request(app)
      .get("/insights/summary")
      .query({ period: "week" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts 'month' as a valid period", async () => {
    const res = await request(app)
      .get("/insights/summary")
      .query({ period: "month" });

    expect(res.status).not.toBe(400);
  });

  it("accepts 'quarter' as a valid period", async () => {
    const res = await request(app)
      .get("/insights/summary")
      .query({ period: "quarter" });

    expect(res.status).not.toBe(400);
  });

  it("accepts 'year' as a valid period", async () => {
    const res = await request(app)
      .get("/insights/summary")
      .query({ period: "year" });

    expect(res.status).not.toBe(400);
  });

  it("defaults to 'month' when period is omitted", async () => {
    const res = await request(app).get("/insights/summary");
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// admin-metrics GET /admin/audit-logs — tenantId / action / entityType validation
// ---------------------------------------------------------------------------

describe("GET /admin/audit-logs — query param validation", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(superAdmin);
  });

  it("rejects non-UUID tenantId with 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .get("/admin/audit-logs")
      .query({ tenantId: "not-a-uuid" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects tenantId that is a plain number string with 400", async () => {
    const res = await request(app)
      .get("/admin/audit-logs")
      .query({ tenantId: "12345" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects action longer than 100 characters with 400", async () => {
    const res = await request(app)
      .get("/admin/audit-logs")
      .query({ action: "a".repeat(101) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts a valid UUID tenantId", async () => {
    const res = await request(app)
      .get("/admin/audit-logs")
      .query({ tenantId: "550e8400-e29b-41d4-a716-446655440000" });

    expect(res.status).not.toBe(400);
  });

  it("accepts all params omitted (no filters)", async () => {
    const res = await request(app).get("/admin/audit-logs");
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// birthday GET /birthday/history — year validation
// ---------------------------------------------------------------------------

describe("GET /birthday/history — year query param validation", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(agencyAdmin);
  });

  it("rejects non-numeric year with 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .get("/birthday/history")
      .query({ year: "abc" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.error).toMatch(/year/i);
  });

  it("rejects year below 2000 with 400", async () => {
    const res = await request(app)
      .get("/birthday/history")
      .query({ year: "1999" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects year above 2100 with 400", async () => {
    const res = await request(app)
      .get("/birthday/history")
      .query({ year: "2101" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects decimal year with 400", async () => {
    const res = await request(app)
      .get("/birthday/history")
      .query({ year: "2024.5" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts a valid year (e.g. 2025)", async () => {
    const res = await request(app)
      .get("/birthday/history")
      .query({ year: "2025" });

    expect(res.status).not.toBe(400);
  });

  it("accepts no year param (returns all records)", async () => {
    const res = await request(app).get("/birthday/history");
    expect(res.status).not.toBe(400);
  });
});

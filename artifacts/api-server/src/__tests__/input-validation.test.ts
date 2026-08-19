import pino from "pino";
/**
 * Endpoint-level input-validation tests: verifies that body-cast endpoints
 * hardened in Task #41 reject invalid payloads with HTTP 400 / VALIDATION_ERROR
 * before performing any mutation.
 *
 * Covers:
 *   - POST   /api/trips/:id/costs              (trip-costs.ts)
 *   - PUT    /api/admin/platform-settings/:key (platform-settings.ts)
 *   - POST   /api/reports/export               (reports.ts)
 *
 * Uses supertest to drive the real Express route handlers while mocking the DB
 * and tenant auth. Real permission logic from @workspace/permissions is used so
 * role enforcement is exercised end-to-end.
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// vi.hoisted: shared db mock chain
// ---------------------------------------------------------------------------

const { mockLimit, mockWhere, mockFrom, mockSelect, mockInsertValues, mockInsert, mockUpdate } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockInsertValues = vi.fn().mockResolvedValue([]);
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
  const mockUpdate = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) }));
  return { mockLimit, mockWhere, mockFrom, mockSelect, mockInsertValues, mockInsert, mockUpdate };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: { select: mockSelect, insert: mockInsert, update: mockUpdate },
  tripsTable: {},
  tripCostsTable: {},
  platformSettingsTable: {},
  redisAlertLogTable: {},
  reservationsTable: {},
  clientsTable: {},
  paymentsTable: {},
  dealsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a) => a),
  or: vi.fn((...a) => a),
  not: vi.fn(() => "not"),
  gt: vi.fn(() => "gt"),
  lt: vi.fn(() => "lt"),
  gte: vi.fn(() => "gte"),
  lte: vi.fn(() => "lte"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  inArray: vi.fn(() => "inArray"),
  notInArray: vi.fn(() => "notInArray"),
  isNull: vi.fn(() => "isNull"),
  isNotNull: vi.fn(() => "isNotNull"),
  between: vi.fn(() => "between"),
  ilike: vi.fn(() => "ilike"),
  like: vi.fn(() => "like"),
  count: vi.fn(() => "count"),
  sum: vi.fn(() => "sum"),
  avg: vi.fn(() => "avg"),
  min: vi.fn(() => "min"),
  max: vi.fn(() => "max"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("../lib/tenant", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: [ROLES.AGENCY_ADMIN],
  MANAGEMENT_ROLES: [ROLES.AGENCY_ADMIN, ROLES.SALES],
}));

// ---------------------------------------------------------------------------
// Import routers + middleware AFTER mocks
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant";
import tripCostsRouter from "../routes/trip-costs.js";
import platformSettingsRouter from "../routes/platform-settings.js";
import reportsRouter from "../routes/reports.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const requireAuthMock = vi.mocked(requireAuth);

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

function buildApp(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", router);
  app.use(errorHandler);
  return app;
}

const AGENCY_USER = { id: "user-001", tenantId: "tenant-001", role: ROLES.AGENCY_ADMIN };
const SUPERADMIN_USER = { id: "user-002", tenantId: "tenant-001", role: ROLES.SUPER_ADMIN };

// ---------------------------------------------------------------------------
// POST /api/trips/:id/costs
// ---------------------------------------------------------------------------

describe("POST /api/trips/:id/costs — body validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(AGENCY_USER as never);
    // Trip lookup must succeed so we reach the body-validation step.
    mockLimit.mockResolvedValue([{ id: "trip-001" }]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("returns 400 VALIDATION_ERROR when required fields are missing", async () => {
    const app = buildApp(tripCostsRouter);
    const res = await request(app).post("/api/trips/trip-001/costs").send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("returns 400 when category is not one of the allowed enum values", async () => {
    const app = buildApp(tripCostsRouter);
    const res = await request(app)
      .post("/api/trips/trip-001/costs")
      .send({ category: "NotARealCategory", description: "Almoço", amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("returns 400 when amount is not a finite number", async () => {
    const app = buildApp(tripCostsRouter);
    const res = await request(app)
      .post("/api/trips/trip-001/costs")
      .send({ category: "Transporte", description: "Ônibus", amount: "abc" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("returns 400 when amount is null (must not be coerced to 0)", async () => {
    const app = buildApp(tripCostsRouter);
    const res = await request(app)
      .post("/api/trips/trip-001/costs")
      .send({ category: "Transporte", description: "Ônibus", amount: null });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("returns 400 when amount is an empty string (must not be coerced to 0)", async () => {
    const app = buildApp(tripCostsRouter);
    const res = await request(app)
      .post("/api/trips/trip-001/costs")
      .send({ category: "Transporte", description: "Ônibus", amount: "" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PUT /api/trips/:id/costs/:costId
// ---------------------------------------------------------------------------

describe("PUT /api/trips/:id/costs/:costId — body validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(AGENCY_USER as never);
    // Existing-cost lookup must succeed so we reach the body-validation step.
    mockLimit.mockResolvedValue([{ id: "cost-001", tripId: "trip-001", paidAt: null }]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("returns 400 when amount is null (must not be coerced to 0)", async () => {
    const app = buildApp(tripCostsRouter);
    const res = await request(app)
      .put("/api/trips/trip-001/costs/cost-001")
      .send({ amount: null });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when status is not one of the allowed enum values", async () => {
    const app = buildApp(tripCostsRouter);
    const res = await request(app)
      .put("/api/trips/trip-001/costs/cost-001")
      .send({ status: "NotARealStatus" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/platform-settings/:key
// ---------------------------------------------------------------------------

describe("PUT /api/admin/platform-settings/:key — body validation & role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(SUPERADMIN_USER as never);
    mockLimit.mockResolvedValue([{ key: "some_key", value: "old" }]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("returns 400 VALIDATION_ERROR when value is not a string or null", async () => {
    const app = buildApp(platformSettingsRouter);
    const res = await request(app)
      .put("/api/admin/platform-settings/some_key")
      .send({ value: 123 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns 400 when redis_alert_email value is not a valid email", async () => {
    const app = buildApp(platformSettingsRouter);
    const res = await request(app)
      .put("/api/admin/platform-settings/redis_alert_email")
      .send({ value: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns 403 when the caller is not a superadmin", async () => {
    requireAuthMock.mockResolvedValue(AGENCY_USER as never);
    const app = buildApp(platformSettingsRouter);
    const res = await request(app)
      .put("/api/admin/platform-settings/some_key")
      .send({ value: "valid" });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/reports/export
// ---------------------------------------------------------------------------

describe("POST /api/reports/export — body validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(AGENCY_USER as never);
  });

  it("returns 400 VALIDATION_ERROR when reportType is invalid", async () => {
    const app = buildApp(reportsRouter);
    const res = await request(app)
      .post("/api/reports/export")
      .send({ reportType: "invalid", format: "csv" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns 400 when format is not csv/xlsx/pdf", async () => {
    const app = buildApp(reportsRouter);
    const res = await request(app)
      .post("/api/reports/export")
      .send({ reportType: "financial", format: "docx" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns 400 when required fields are missing", async () => {
    const app = buildApp(reportsRouter);
    const res = await request(app).post("/api/reports/export").send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

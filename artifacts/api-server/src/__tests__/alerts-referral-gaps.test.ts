import pino from "pino";
/**
 * Endpoint-level tests for GET /api/alerts/referral-reversal-skipped/gaps —
 * the paginated "Reversões de bônus pendentes" list backing /indicacoes.
 *
 * Verifies role gating (403 for non-staff), tenant scoping (the caller's own
 * tenantId is passed to the gap lookups), limit/offset sanitization (NaN,
 * negative, and over-100 values are clamped before reaching the DB layer), and
 * the exact response shape `{ gaps[], total, limit, offset }`.
 *
 * Uses supertest with vi.mock to drive the real Express route handler while
 * isolating external dependencies (DB, Clerk, the referral-reversal-gaps lib).
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// vi.hoisted: shared mock builders must exist before any vi.mock factory runs
// ---------------------------------------------------------------------------

const { mockFindGaps, mockCountGaps } = vi.hoisted(() => ({
  mockFindGaps: vi.fn(),
  mockCountGaps: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks (resolved relative to THIS test file: src/__tests__/)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn(),
  },
  paymentsTable: {},
  tripsTable: {},
  dealsTable: {},
  clientsTable: {},
  emailLogsTable: {},
  reservationsTable: {},
  referralsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a) => a),
  lt: vi.fn(() => "lt"),
  lte: vi.fn(() => "lte"),
  gte: vi.fn(() => "gte"),
  gt: vi.fn(() => "gt"),
  isNotNull: vi.fn(() => "isNotNull"),
  isNull: vi.fn(() => "isNull"),
  notLike: vi.fn(() => "notLike"),
  inArray: vi.fn(() => "inArray"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  AGENCY_STAFF_ROLES: [
    ROLES.AGENCY_ADMIN,
    ROLES.AGENCY_MANAGER,
    ROLES.SALES,
    ROLES.SUPPORT,
  ],
}));

vi.mock("../lib/referral-reversal-gaps.js", () => ({
  findReferralReversalGaps: mockFindGaps,
  countReferralReversalGaps: mockCountGaps,
}));

// ---------------------------------------------------------------------------
// Import router and middleware AFTER all mocks
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import { findReferralReversalGaps, countReferralReversalGaps } from "../lib/referral-reversal-gaps.js";
import alertsRouter from "../routes/alerts.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Minimal Express app builder
// ---------------------------------------------------------------------------

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  req.log = pino({ level: "silent" }) as unknown as typeof req.log;
  next();
}

function buildAlertsApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", alertsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_GAP = {
  reservation_id: "res-001",
  reservation_number: "AG-EX-202507-0001",
  referral_code: "REF-0001",
  referrer_name: "Maria Indicadora",
};

function makeUser(role: string, tenantId = "tenant-001") {
  return {
    id: "user-001",
    tenantId,
    role,
    name: "Test User",
    email: "test@example.com",
  };
}

const GAPS_PATH = "/api/alerts/referral-reversal-skipped/gaps";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/alerts/referral-reversal-skipped/gaps", () => {
  const requireAuthMock = vi.mocked(requireAuth);
  const findGapsMock = vi.mocked(findReferralReversalGaps);
  const countGapsMock = vi.mocked(countReferralReversalGaps);

  beforeEach(() => {
    vi.clearAllMocks();
    findGapsMock.mockResolvedValue([]);
    countGapsMock.mockResolvedValue(0);
  });

  // --- Role gating -------------------------------------------------------

  it("returns 403 for a non-staff role (cliente)", async () => {
    requireAuthMock.mockResolvedValue(makeUser(ROLES.CLIENT) as never);
    const app = buildAlertsApp();

    const res = await request(app).get(GAPS_PATH);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
    // Must not touch the data layer when access is denied
    expect(findGapsMock).not.toHaveBeenCalled();
    expect(countGapsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["agencia", ROLES.AGENCY_ADMIN],
    ["gerente", ROLES.AGENCY_MANAGER],
    ["vendedor", ROLES.SALES],
    ["suporte", ROLES.SUPPORT],
    ["superadmin", ROLES.SUPER_ADMIN],
  ])("allows the %s role (200)", async (_label, role) => {
    requireAuthMock.mockResolvedValue(makeUser(role) as never);
    const app = buildAlertsApp();

    const res = await request(app).get(GAPS_PATH);

    expect(res.status).toBe(200);
    expect(findGapsMock).toHaveBeenCalledTimes(1);
    expect(countGapsMock).toHaveBeenCalledTimes(1);
  });

  // --- Tenant scoping ----------------------------------------------------

  it("scopes both lookups to the caller's own tenantId", async () => {
    requireAuthMock.mockResolvedValue(makeUser(ROLES.AGENCY_ADMIN, "tenant-XYZ") as never);
    const app = buildAlertsApp();

    await request(app).get(GAPS_PATH);

    expect(findGapsMock).toHaveBeenCalledWith("tenant-XYZ", expect.any(Object));
    expect(countGapsMock).toHaveBeenCalledWith("tenant-XYZ");
  });

  // --- limit/offset sanitization ----------------------------------------

  it("uses defaults (limit 20, offset 0) when no params are supplied", async () => {
    requireAuthMock.mockResolvedValue(makeUser(ROLES.AGENCY_ADMIN) as never);
    const app = buildAlertsApp();

    const res = await request(app).get(GAPS_PATH);

    expect(findGapsMock).toHaveBeenCalledWith("tenant-001", { limit: 20, offset: 0 });
    expect(res.body.limit).toBe(20);
    expect(res.body.offset).toBe(0);
  });

  it("clamps an over-100 limit down to 100", async () => {
    requireAuthMock.mockResolvedValue(makeUser(ROLES.AGENCY_ADMIN) as never);
    const app = buildAlertsApp();

    const res = await request(app).get(`${GAPS_PATH}?limit=5000`);

    expect(findGapsMock).toHaveBeenCalledWith("tenant-001", { limit: 100, offset: 0 });
    expect(res.body.limit).toBe(100);
  });

  it("clamps a below-1 limit up to 1", async () => {
    requireAuthMock.mockResolvedValue(makeUser(ROLES.AGENCY_ADMIN) as never);
    const app = buildAlertsApp();

    const res = await request(app).get(`${GAPS_PATH}?limit=0`);

    expect(findGapsMock).toHaveBeenCalledWith("tenant-001", { limit: 1, offset: 0 });
    expect(res.body.limit).toBe(1);
  });

  it("falls back to the default limit when limit is NaN (non-numeric)", async () => {
    requireAuthMock.mockResolvedValue(makeUser(ROLES.AGENCY_ADMIN) as never);
    const app = buildAlertsApp();

    const res = await request(app).get(`${GAPS_PATH}?limit=abc`);

    expect(findGapsMock).toHaveBeenCalledWith("tenant-001", { limit: 20, offset: 0 });
    expect(res.body.limit).toBe(20);
  });

  it("clamps a negative offset up to 0", async () => {
    requireAuthMock.mockResolvedValue(makeUser(ROLES.AGENCY_ADMIN) as never);
    const app = buildAlertsApp();

    const res = await request(app).get(`${GAPS_PATH}?offset=-50`);

    expect(findGapsMock).toHaveBeenCalledWith("tenant-001", { limit: 20, offset: 0 });
    expect(res.body.offset).toBe(0);
  });

  it("falls back to offset 0 when offset is NaN (non-numeric)", async () => {
    requireAuthMock.mockResolvedValue(makeUser(ROLES.AGENCY_ADMIN) as never);
    const app = buildAlertsApp();

    const res = await request(app).get(`${GAPS_PATH}?offset=xyz`);

    expect(findGapsMock).toHaveBeenCalledWith("tenant-001", { limit: 20, offset: 0 });
    expect(res.body.offset).toBe(0);
  });

  it("passes through valid in-range limit and offset unchanged", async () => {
    requireAuthMock.mockResolvedValue(makeUser(ROLES.AGENCY_ADMIN) as never);
    const app = buildAlertsApp();

    const res = await request(app).get(`${GAPS_PATH}?limit=50&offset=40`);

    expect(findGapsMock).toHaveBeenCalledWith("tenant-001", { limit: 50, offset: 40 });
    expect(res.body.limit).toBe(50);
    expect(res.body.offset).toBe(40);
  });

  // --- Response shape ----------------------------------------------------

  it("returns the { gaps[], total, limit, offset } shape with mapped camelCase gaps", async () => {
    requireAuthMock.mockResolvedValue(makeUser(ROLES.AGENCY_ADMIN) as never);
    findGapsMock.mockResolvedValue([FAKE_GAP]);
    countGapsMock.mockResolvedValue(7);
    const app = buildAlertsApp();

    const res = await request(app).get(`${GAPS_PATH}?limit=10&offset=0`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      gaps: [
        {
          reservationId: "res-001",
          reservationNumber: "AG-EX-202507-0001",
          referralCode: "REF-0001",
          referrerName: "Maria Indicadora",
        },
      ],
      total: 7,
      limit: 10,
      offset: 0,
    });
  });
});

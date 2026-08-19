/**
 * Endpoint tests for POST /admin/system-health/repair
 *
 * Verifies:
 *  - 403 for any role other than SUPER_ADMIN
 *  - 200 with { orphansFixed: N } for SUPER_ADMIN
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { ROLES } from "@workspace/permissions";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockRequireAuth, mockCleanupOrphanDeals, mockRepairSeatDriftOnly } = vi.hoisted(() => {
  const mockRequireAuth = vi.fn();
  const mockCleanupOrphanDeals = vi.fn();
  const mockRepairSeatDriftOnly = vi.fn();
  return { mockRequireAuth, mockCleanupOrphanDeals, mockRepairSeatDriftOnly };
});

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin"],
  MANAGEMENT_ROLES: ["admin", "gerente"],
}));

vi.mock("../lib/seat-reconciliation.js", () => ({
  cleanupOrphanDeals: mockCleanupOrphanDeals,
  getDriftSnapshot: vi.fn().mockResolvedValue({ tripsChecked: 0, tripsWithDrift: 0 }),
  getOrphanDealsCount: vi.fn().mockResolvedValue(0),
  getClientFinancialDriftCount: vi.fn().mockResolvedValue(0),
  repairSeatDriftOnly: mockRepairSeatDriftOnly,
}));

vi.mock("../lib/redis.js", () => ({
  getRedisStatus: vi.fn(() => ({ status: "ok" })),
  fetchUpstashDailyStats: vi.fn().mockResolvedValue(null),
  areWorkersEnabled: vi.fn(() => false),
}));

vi.mock("../lib/stripeSync.js", () => ({
  getWebhookAuditStatus: vi.fn(() => ({
    status: "ok",
    duplicateCount: 0,
    endpoints: [],
    checkedAt: null,
  })),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import router and error handler AFTER mocks are registered
// ---------------------------------------------------------------------------
import systemHealthRouter from "../routes/system-health.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------
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
  app.use(express.json());
  app.use(stubLogger);
  app.use(systemHealthRouter);
  app.use(errorHandler);
  return app;
}

function makeSuperAdmin() {
  return {
    id: "user-super",
    tenantId: "tenant-001",
    role: ROLES.SUPER_ADMIN,
    name: "Super Admin",
    email: "super@example.com",
  };
}

function makeAgencyAdmin() {
  return {
    id: "user-agency",
    tenantId: "tenant-001",
    role: ROLES.AGENCY_ADMIN,
    name: "Agency Admin",
    email: "agency@example.com",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /admin/system-health/repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when the caller is not SUPER_ADMIN (AGENCY_ADMIN role)", async () => {
    mockRequireAuth.mockResolvedValue(makeAgencyAdmin());

    const res = await request(buildApp()).post("/admin/system-health/repair");

    expect(res.status).toBe(403);
    expect(mockCleanupOrphanDeals).not.toHaveBeenCalled();
    expect(mockRepairSeatDriftOnly).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not SUPER_ADMIN (manager role)", async () => {
    mockRequireAuth.mockResolvedValue({
      id: "user-mgr",
      tenantId: "tenant-001",
      role: ROLES.AGENCY_MANAGER,
      name: "Manager",
      email: "mgr@example.com",
    });

    const res = await request(buildApp()).post("/admin/system-health/repair");

    expect(res.status).toBe(403);
    expect(mockCleanupOrphanDeals).not.toHaveBeenCalled();
    expect(mockRepairSeatDriftOnly).not.toHaveBeenCalled();
  });

  it("returns 200 with { orphansFixed: 0, tripsCorrected: 0 } for SUPER_ADMIN when nothing needs fixing", async () => {
    mockRequireAuth.mockResolvedValue(makeSuperAdmin());
    mockCleanupOrphanDeals.mockResolvedValue({ orphansFixed: 0 });
    mockRepairSeatDriftOnly.mockResolvedValue({ fixed: 0, skipped: 0 });

    const res = await request(buildApp()).post("/admin/system-health/repair");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orphansFixed: 0, tripsCorrected: 0 });
    expect(mockCleanupOrphanDeals).toHaveBeenCalledTimes(1);
    expect(mockRepairSeatDriftOnly).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with correct counts for SUPER_ADMIN when both orphans and drift exist", async () => {
    mockRequireAuth.mockResolvedValue(makeSuperAdmin());
    mockCleanupOrphanDeals.mockResolvedValue({ orphansFixed: 3 });
    mockRepairSeatDriftOnly.mockResolvedValue({ fixed: 5, skipped: 1 });

    const res = await request(buildApp()).post("/admin/system-health/repair");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orphansFixed: 3, tripsCorrected: 5 });
    expect(mockCleanupOrphanDeals).toHaveBeenCalledTimes(1);
    expect(mockRepairSeatDriftOnly).toHaveBeenCalledTimes(1);
  });

  it("propagates errors to the error handler when cleanupOrphanDeals throws unexpectedly", async () => {
    mockRequireAuth.mockResolvedValue(makeSuperAdmin());
    mockCleanupOrphanDeals.mockRejectedValue(new Error("unexpected failure"));
    mockRepairSeatDriftOnly.mockResolvedValue({ fixed: 0, skipped: 0 });

    const res = await request(buildApp()).post("/admin/system-health/repair");

    // Error handler converts unhandled errors to 500
    expect(res.status).toBe(500);
  });

  it("propagates errors to the error handler when repairSeatDriftOnly throws unexpectedly", async () => {
    mockRequireAuth.mockResolvedValue(makeSuperAdmin());
    mockCleanupOrphanDeals.mockResolvedValue({ orphansFixed: 0 });
    mockRepairSeatDriftOnly.mockRejectedValue(new Error("seat repair failure"));

    const res = await request(buildApp()).post("/admin/system-health/repair");

    expect(res.status).toBe(500);
  });
});

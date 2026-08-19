/**
 * Plan restriction enforcement tests for PATCH /tenants/:id
 *
 * Verifies that the plan-tier check in the tenant PATCH handler:
 *   - Blocks a Starter-plan tenant from enabling referralsEnabled (403)
 *   - Allows a Pro/Enterprise-plan tenant to enable referralsEnabled (200)
 *   - Blocks a Starter-plan tenant from enabling seatMapEnabled (403)
 *   - Allows a Pro/Enterprise-plan tenant to enable seatMapEnabled (200)
 *   - Allows any plan to set couponsEnabled (no restriction)
 *   - Allows superadmin to bypass the plan check entirely
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

const { mockLimit, mockWhere, mockFrom, mockSelect, mockRequireAuth } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere: ReturnType<typeof vi.fn> = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockRequireAuth = vi.fn();
  return { mockLimit, mockWhere, mockFrom, mockSelect, mockRequireAuth };
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
    transaction: vi.fn(),
  },
  tenantsTable: {},
  usersTable: {},
  plansTable: {},
  referralSettingsTable: {},
  tripsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a) => a),
  or: vi.fn((...a) => a),
  inArray: vi.fn(() => "inArray"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  count: vi.fn(() => "count"),
  ilike: vi.fn(() => "ilike"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

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
  RESERVATION_STATUS: {},
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin"],
  MANAGEMENT_ROLES: ["admin", "manager"],
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
}));

vi.mock("../lib/uploadthing.js", () => ({
  deleteOrphanedFile: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------

import tenantsRouter from "../routes/tenants.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Minimal Express app
// ---------------------------------------------------------------------------

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  req.log = pino({ level: "silent" }) as unknown as typeof req.log;
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", tenantsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const TENANT_ID = "tenant-001";

const EXISTING_TENANT = {
  id: TENANT_ID,
  name: "Agência Teste",
  planId: "plan-starter",
  logoUrl: null,
  settings: {},
};

const PLAN_STARTER = { slug: "starter" };
const PLAN_PRO = { slug: "pro" };
const PLAN_ENTERPRISE = { slug: "enterprise" };

const UPDATED_TENANT = { ...EXISTING_TENANT };

// ---------------------------------------------------------------------------
// Helpers: configure requireAuth mock per test
// ---------------------------------------------------------------------------

function asAgencyAdmin() {
  mockRequireAuth.mockImplementation(async (req: express.Request, res: express.Response) => {
    (req as express.Request & { auth?: unknown }).auth = {};
    return { id: "user-001", tenantId: TENANT_ID, role: "admin" };
  });
}

function asSuperAdmin() {
  mockRequireAuth.mockImplementation(async (req: express.Request, res: express.Response) => {
    (req as express.Request & { auth?: unknown }).auth = {};
    return { id: "user-superadmin", tenantId: TENANT_ID, role: "superadmin" };
  });
}

// ---------------------------------------------------------------------------
// beforeEach: reset mocks and configure DB chain
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
// Tests: Starter plan — restricted features must be blocked
// ---------------------------------------------------------------------------

describe("Starter plan — plan-restricted features are blocked", () => {
  it("PATCH /tenants/:id with referralsEnabled=true returns 403 for a Starter-plan tenant", async () => {
    asAgencyAdmin();

    // Call 1: select existing tenant (planId = plan-starter)
    // Call 2: select plan row (slug = "starter")
    // Plan check fails → 403 returned before further DB calls
    mockLimit
      .mockResolvedValueOnce([EXISTING_TENANT])
      .mockResolvedValueOnce([PLAN_STARTER]);

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ referralsEnabled: true });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_UPGRADE_REQUIRED");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it("PATCH error body mentions a plan upgrade when referralsEnabled is blocked", async () => {
    asAgencyAdmin();

    mockLimit
      .mockResolvedValueOnce([EXISTING_TENANT])
      .mockResolvedValueOnce([PLAN_STARTER]);

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ referralsEnabled: true });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_UPGRADE_REQUIRED");
    // The error message should guide the user towards an upgrade
    expect(res.body.error.toLowerCase()).toMatch(/plano|upgrade/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: Pro / Enterprise plans — restricted features are allowed
// ---------------------------------------------------------------------------

describe("Pro plan — plan-restricted features are allowed", () => {
  it("PATCH /tenants/:id with referralsEnabled=true returns 200 for a Pro-plan tenant", async () => {
    asAgencyAdmin();

    // Call 1: select existing tenant
    // Call 2: select plan row (slug = "pro")
    // Plan check passes → update → final select
    mockLimit
      .mockResolvedValueOnce([{ ...EXISTING_TENANT, planId: "plan-pro" }])
      .mockResolvedValueOnce([PLAN_PRO])
      .mockResolvedValueOnce([UPDATED_TENANT]);

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ referralsEnabled: true });

    expect(res.status).toBe(200);
  });
});

describe("Enterprise plan — plan-restricted features are allowed", () => {
  it("PATCH /tenants/:id with referralsEnabled=true returns 200 for an Enterprise-plan tenant", async () => {
    asAgencyAdmin();

    mockLimit
      .mockResolvedValueOnce([{ ...EXISTING_TENANT, planId: "plan-enterprise" }])
      .mockResolvedValueOnce([PLAN_ENTERPRISE])
      .mockResolvedValueOnce([UPDATED_TENANT]);

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ referralsEnabled: true });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests: seatMapEnabled is restricted to Pro+ (minTier=1)
// ---------------------------------------------------------------------------

describe("Starter plan — seatMapEnabled is blocked (minTier=1)", () => {
  it("PATCH /tenants/:id with seatMapEnabled=true returns 403 for a Starter-plan tenant", async () => {
    asAgencyAdmin();

    // Call 1: select existing tenant (planId = plan-starter)
    // Call 2: select plan row (slug = "starter")
    // Plan check fails (seatMap minTier=1 > starter tier=0) → 403
    mockLimit
      .mockResolvedValueOnce([EXISTING_TENANT])
      .mockResolvedValueOnce([PLAN_STARTER]);

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ seatMapEnabled: true });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_UPGRADE_REQUIRED");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it("PATCH error body mentions a plan upgrade when seatMapEnabled is blocked", async () => {
    asAgencyAdmin();

    mockLimit
      .mockResolvedValueOnce([EXISTING_TENANT])
      .mockResolvedValueOnce([PLAN_STARTER]);

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ seatMapEnabled: true });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_UPGRADE_REQUIRED");
    expect(res.body.error.toLowerCase()).toMatch(/plano|upgrade/i);
  });
});

describe("Pro plan — seatMapEnabled is allowed (minTier=1)", () => {
  it("PATCH /tenants/:id with seatMapEnabled=true returns 200 for a Pro-plan tenant", async () => {
    asAgencyAdmin();

    // Call 1: select existing tenant (planId = plan-pro)
    // Call 2: select plan row (slug = "pro") — passes tier check
    // Call 3: final tenant select
    mockLimit
      .mockResolvedValueOnce([{ ...EXISTING_TENANT, planId: "plan-pro" }])
      .mockResolvedValueOnce([PLAN_PRO])
      .mockResolvedValueOnce([UPDATED_TENANT]);

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ seatMapEnabled: true });

    expect(res.status).toBe(200);
  });
});

describe("Enterprise plan — seatMapEnabled is allowed (minTier=1)", () => {
  it("PATCH /tenants/:id with seatMapEnabled=true returns 200 for an Enterprise-plan tenant", async () => {
    asAgencyAdmin();

    mockLimit
      .mockResolvedValueOnce([{ ...EXISTING_TENANT, planId: "plan-enterprise" }])
      .mockResolvedValueOnce([PLAN_ENTERPRISE])
      .mockResolvedValueOnce([UPDATED_TENANT]);

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ seatMapEnabled: true });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests: couponsEnabled is unrestricted (available on all plans)
// ---------------------------------------------------------------------------

describe("couponsEnabled — no plan restriction on any tier", () => {
  it("Starter-plan tenant can enable couponsEnabled without a 403", async () => {
    asAgencyAdmin();

    // No referralsEnabled → only couponsEnabled; canEnableFeature("couponsEnabled","starter") = true
    mockLimit
      .mockResolvedValueOnce([EXISTING_TENANT])
      .mockResolvedValueOnce([PLAN_STARTER])
      .mockResolvedValueOnce([UPDATED_TENANT]);

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ couponsEnabled: true });

    expect(res.status).toBe(200);
  });

  it("Starter-plan tenant can disable couponsEnabled without a 403", async () => {
    asAgencyAdmin();

    mockLimit
      .mockResolvedValueOnce([EXISTING_TENANT])
      .mockResolvedValueOnce([PLAN_STARTER])
      .mockResolvedValueOnce([UPDATED_TENANT]);

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ couponsEnabled: false });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests: Superadmin bypasses plan check entirely
// ---------------------------------------------------------------------------

describe("Superadmin — plan check is bypassed", () => {
  it("Superadmin can enable referralsEnabled on a Starter-plan tenant without restriction", async () => {
    asSuperAdmin();

    // Superadmin path skips the plan-tier check block entirely.
    // DB calls: update → final select (no plan lookup)
    mockLimit
      .mockResolvedValueOnce([EXISTING_TENANT])  // existing tenant (logoUrl / settings)
      .mockResolvedValueOnce([UPDATED_TENANT]);   // final tenant fetch

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ referralsEnabled: true });

    expect(res.status).toBe(200);
  });

  it("Superadmin can change planId (non-superadmin cannot)", async () => {
    asSuperAdmin();

    mockLimit
      .mockResolvedValueOnce([EXISTING_TENANT])
      .mockResolvedValueOnce([])               // plan sync lookup (no seat-map plan found)
      .mockResolvedValueOnce([UPDATED_TENANT]);

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ planId: "plan-pro" });

    expect(res.status).toBe(200);
  });

  it("Non-superadmin cannot change planId — returns 403 FORBIDDEN_ROLE", async () => {
    asAgencyAdmin();

    const res = await request(buildApp())
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ planId: "plan-pro" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
  });
});

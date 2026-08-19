/**
 * Regression tests for GET /api/admin/plans/stripe-health
 *
 * Covers:
 *  - Superadmin-only access (401 for unauthenticated, 403 for non-superadmin)
 *  - stripeConfigured: false when no Stripe key is available
 *  - Free plans (monthlyPrice=0, annualPrice=0) always reported healthy (isFree: true)
 *  - A paid plan with a matching Stripe price reported healthy (monthlyOk/annualOk: true)
 *  - A paid plan with no matching Stripe price reported unhealthy (monthlyOk/annualOk: false)
 *  - Graceful handling of a Stripe API error for a plan (error field present, monthlyOk/annualOk: false)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";
import { ROLES } from "@workspace/permissions";

// ---------------------------------------------------------------------------
// vi.hoisted: mock factories must exist before any vi.mock factory runs
// ---------------------------------------------------------------------------

const { mockOrderBy, mockWhere, mockFrom, mockSelect, mockGetStripeSecretKey, MockStripe } =
  vi.hoisted(() => {
    // The endpoint queries: db.select().from(plansTable).orderBy(...)
    // The result is awaited directly at the .orderBy() call, so mockOrderBy
    // must return a thenable that resolves to the plan rows.
    const mockOrderBy = vi.fn();
    const mockWhere = vi.fn();
    const mockFrom = vi.fn(() => ({ where: mockWhere, orderBy: mockOrderBy }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));

    const mockGetStripeSecretKey = vi.fn<[], Promise<string | null>>();

    // Mock Stripe constructor — each test can override the returned instance
    const MockStripe = vi.fn();

    return { mockOrderBy, mockWhere, mockFrom, mockSelect, mockGetStripeSecretKey, MockStripe };
  });

// ---------------------------------------------------------------------------
// Module mocks (must appear before router import)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    transaction: vi.fn(),
  },
  plansTable: {},
  tenantsTable: {},
  usersTable: {},
  auditLogsTable: {},
  invoicesTable: {},
  featureFlagsTable: {},
  storesTable: {},
  storeProductsTable: {},
  storeCategoriesTable: {},
  storeOrderItemsTable: {},
  storeReviewsTable: {},
  tripsTable: {},
  productCategoriesTable: {},
  productImagesTable: {},
  vehiclesTable: {},
  accommodationsTable: {},
  destinationsTable: {},
  clientsTable: {},
  documentsTable: {},
  storeOrdersTable: {},
  referralsTable: {},
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

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin"],
  MANAGEMENT_ROLES: ["admin", "manager"],
}));

vi.mock("../lib/stripeClient.js", () => ({
  getStripeSecretKey: mockGetStripeSecretKey,
}));

// Mock the Stripe SDK so no real HTTP calls are made
vi.mock("stripe", () => ({
  default: MockStripe,
}));

// Stub out UploadThing (imported transitively by admin.ts)
vi.mock("../lib/uploadthing.js", () => ({
  utapi: {},
  extractVerifiedUploadThingKey: vi.fn(() => null),
  deleteOrphanedFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/collectReferencedUploadThingKeys.js", () => ({
  collectReferencedUploadThingKeys: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
}));

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------

import adminRouter from "../routes/admin.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { requireAuth } from "../lib/tenant.js";

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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", adminRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const SUPER_ADMIN_USER = {
  id: "user-super",
  tenantId: "tenant-platform",
  role: ROLES.SUPER_ADMIN,
  name: "Super Admin",
  email: "super@example.com",
};

const AGENCY_USER = {
  id: "user-agency",
  tenantId: "tenant-001",
  role: ROLES.AGENCY_ADMIN,
  name: "Agency Admin",
  email: "agency@example.com",
};

const FREE_PLAN = {
  id: "plan-free",
  slug: "starter",
  name: "Starter",
  isActive: true,
  monthlyPrice: "0",
  annualPrice: "0",
  sortOrder: 1,
  createdAt: new Date("2024-01-01"),
};

const PAID_PLAN = {
  id: "plan-pro",
  slug: "pro",
  name: "Pro",
  isActive: true,
  monthlyPrice: "297",
  annualPrice: "2970",
  sortOrder: 2,
  createdAt: new Date("2024-01-01"),
};

// A Stripe price that matches PAID_PLAN monthly (297 BRL/month)
const STRIPE_MONTHLY_PRICE = {
  id: "price_monthly",
  unit_amount: 29700, // 297.00 BRL in cents
  currency: "brl",
  recurring: { interval: "month" },
  active: true,
  metadata: { planSlug: "pro" },
};

// A Stripe price that matches PAID_PLAN annual (2970 BRL/year)
const STRIPE_ANNUAL_PRICE = {
  id: "price_annual",
  unit_amount: 297000, // 2970.00 BRL in cents
  currency: "brl",
  recurring: { interval: "year" },
  active: true,
  metadata: { planSlug: "pro" },
};

// ---------------------------------------------------------------------------
// Helper: make a mock Stripe instance with a controllable prices.search
// ---------------------------------------------------------------------------

function makeStripeInstance(searchImpl: () => Promise<{ data: unknown[] }>) {
  const instance = { prices: { search: vi.fn(searchImpl) } };
  MockStripe.mockImplementationOnce(() => instance);
  return instance;
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Rebuild the select chain after clearAllMocks wipes implementations.
  // The endpoint calls db.select().from(plansTable).orderBy(...) and awaits the result,
  // so mockOrderBy must be configured per-test to resolve the desired plan rows.
  mockFrom.mockReturnValue({ orderBy: mockOrderBy, where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/admin/plans/stripe-health
// ---------------------------------------------------------------------------

describe("GET /api/admin/plans/stripe-health — access control", () => {
  it("returns 401 when not authenticated", async () => {
    // The real requireAuth sends a 401 response and returns null.
    // Mirror that here so the route doesn't hang waiting for a response.
    vi.mocked(requireAuth).mockImplementation(async (_req, res) => {
      (res as express.Response).status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return null as never;
    });

    const res = await request(buildApp()).get("/api/admin/plans/stripe-health");

    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a non-superadmin (agency admin)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENCY_USER as never);

    const res = await request(buildApp()).get("/api/admin/plans/stripe-health");

    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/plans/stripe-health — Stripe not configured", () => {
  it("returns stripeConfigured: false and empty plans when no Stripe key is available", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SUPER_ADMIN_USER as never);
    mockGetStripeSecretKey.mockResolvedValue(null);

    const res = await request(buildApp()).get("/api/admin/plans/stripe-health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stripeConfigured: false, plans: [] });
  });
});

describe("GET /api/admin/plans/stripe-health — plan health checks", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(SUPER_ADMIN_USER as never);
    mockGetStripeSecretKey.mockResolvedValue("sk_test_fake");
  });

  it("reports free plan as healthy (isFree: true, monthlyOk: true, annualOk: true) without calling Stripe", async () => {
    // The endpoint: const plans = await db.select().from(plansTable).orderBy(...)
    // mockOrderBy is the terminal call that is awaited
    mockOrderBy.mockResolvedValueOnce([FREE_PLAN]);
    const stripeInstance = makeStripeInstance(() => Promise.resolve({ data: [] }));

    const res = await request(buildApp()).get("/api/admin/plans/stripe-health");

    expect(res.status).toBe(200);
    expect(res.body.stripeConfigured).toBe(true);
    expect(res.body.plans).toHaveLength(1);

    const plan = res.body.plans[0];
    expect(plan.slug).toBe("starter");
    expect(plan.isFree).toBe(true);
    expect(plan.monthlyOk).toBe(true);
    expect(plan.annualOk).toBe(true);

    // Stripe prices.search must NOT be called for a free plan
    expect(stripeInstance.prices.search).not.toHaveBeenCalled();
  });

  it("reports paid plan as healthy when matching monthly and annual prices exist in Stripe", async () => {
    mockOrderBy.mockResolvedValueOnce([PAID_PLAN]);
    makeStripeInstance(() => Promise.resolve({ data: [STRIPE_MONTHLY_PRICE, STRIPE_ANNUAL_PRICE] }));

    const res = await request(buildApp()).get("/api/admin/plans/stripe-health");

    expect(res.status).toBe(200);
    expect(res.body.stripeConfigured).toBe(true);
    expect(res.body.plans).toHaveLength(1);

    const plan = res.body.plans[0];
    expect(plan.slug).toBe("pro");
    expect(plan.isFree).toBe(false);
    expect(plan.monthlyOk).toBe(true);
    expect(plan.annualOk).toBe(true);
  });

  it("reports paid plan as unhealthy when no matching prices exist in Stripe", async () => {
    mockOrderBy.mockResolvedValueOnce([PAID_PLAN]);
    makeStripeInstance(() => Promise.resolve({ data: [] }));

    const res = await request(buildApp()).get("/api/admin/plans/stripe-health");

    expect(res.status).toBe(200);
    expect(res.body.stripeConfigured).toBe(true);
    expect(res.body.plans).toHaveLength(1);

    const plan = res.body.plans[0];
    expect(plan.slug).toBe("pro");
    expect(plan.isFree).toBe(false);
    expect(plan.monthlyOk).toBe(false);
    expect(plan.annualOk).toBe(false);
    expect(plan).not.toHaveProperty("error");
  });

  it("reports unhealthy with error field when Stripe API throws for a plan", async () => {
    mockOrderBy.mockResolvedValueOnce([PAID_PLAN]);
    makeStripeInstance(() => Promise.reject(new Error("Stripe network error")));

    const res = await request(buildApp()).get("/api/admin/plans/stripe-health");

    expect(res.status).toBe(200);
    expect(res.body.stripeConfigured).toBe(true);
    expect(res.body.plans).toHaveLength(1);

    const plan = res.body.plans[0];
    expect(plan.slug).toBe("pro");
    expect(plan.isFree).toBe(false);
    expect(plan.monthlyOk).toBe(false);
    expect(plan.annualOk).toBe(false);
    expect(plan.error).toBeTruthy();
  });

  it("handles mixed free and paid plans correctly — free healthy, paid missing annual unhealthy", async () => {
    mockOrderBy.mockResolvedValueOnce([FREE_PLAN, PAID_PLAN]);
    // Only monthly price exists for the paid plan — annual is missing
    makeStripeInstance(() => Promise.resolve({ data: [STRIPE_MONTHLY_PRICE] }));

    const res = await request(buildApp()).get("/api/admin/plans/stripe-health");

    expect(res.status).toBe(200);
    expect(res.body.stripeConfigured).toBe(true);
    expect(res.body.plans).toHaveLength(2);

    const free = res.body.plans.find((p: { slug: string }) => p.slug === "starter");
    expect(free?.isFree).toBe(true);
    expect(free?.monthlyOk).toBe(true);
    expect(free?.annualOk).toBe(true);

    const paid = res.body.plans.find((p: { slug: string }) => p.slug === "pro");
    expect(paid?.isFree).toBe(false);
    expect(paid?.monthlyOk).toBe(true);   // monthly price found
    expect(paid?.annualOk).toBe(false);   // annual price missing
  });
});

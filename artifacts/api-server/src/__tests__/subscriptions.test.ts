/**
 * subscriptions/upgrade — focused tests for the STRIPE_PRICE_NOT_FOUND
 * early-return guard.
 *
 * In subscriptions.ts, requireAuth is called as an async FUNCTION inside the
 * handler body:
 *   const me = await requireAuth(req, res, { skipTenantStatusCheck: true });
 * NOT as a route-level middleware. The mock must therefore return a resolved
 * user object, not a middleware function.
 *
 * Verifies:
 *   - Returns HTTP 400 with code STRIPE_PRICE_NOT_FOUND when Stripe returns
 *     no recurring price matching the requested plan + billing cycle.
 *   - No DB write (insert/update) is executed before returning 400, so invoice,
 *     tenant, and subscription tables remain untouched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// vi.hoisted — values that must exist before vi.mock factories run
// ---------------------------------------------------------------------------

const {
  mockRequireAuth,
  mockSelect,
  mockInsert,
  mockInsertValues,
  mockUpdate,
  mockGetUncachableStripeClient,
  mockGetStripePublishableKey,
} = vi.hoisted(() => {
  const ME = { id: "user-1", tenantId: "tenant-1", role: "agencia" };

  const mockRequireAuth = vi.fn(async () => ME);

  const mockInsertValues = vi.fn().mockResolvedValue([]);
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  const mockSelect = vi.fn();

  const mockGetUncachableStripeClient = vi.fn();
  const mockGetStripePublishableKey = vi.fn(async () => "pk_test_mocked_environment_key");

  return {
    mockRequireAuth,
    mockSelect,
    mockInsert,
    mockInsertValues,
    mockUpdate,
    mockGetUncachableStripeClient,
    mockGetStripePublishableKey,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    transaction: vi.fn(),
  },
  plansTable: {},
  tenantsTable: {},
  invoicesTable: {},
  subscriptionsTable: {},
  usersTable: {},
  clientsTable: {},
  tripsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a: unknown[]) => a),
  or: vi.fn((...a: unknown[]) => a),
  count: vi.fn(() => "count"),
  desc: vi.fn(() => "desc"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkClient: vi.fn(),
}));

// requireAuth is called as an async function: await requireAuth(req, res, opts)
// It must return the user object, not a middleware function.
// The mock ignores req/res/opts args — mockRequireAuth() returns the user object.
// This matches how subscriptions.ts calls: await requireAuth(req, res, opts).
vi.mock("../lib/tenant.js", () => ({
  requireAuth: () => mockRequireAuth(),
  ADMIN_ROLES: ["agencia"],
  MANAGEMENT_ROLES: ["agencia", "vendedor"],
}));

vi.mock("../lib/stripeClient.js", () => ({
  getUncachableStripeClient: () => mockGetUncachableStripeClient(),
  getStripePublishableKey: () => mockGetStripePublishableKey(),
}));

vi.mock("../lib/stripeWebhookHandler.js", () => ({
  handleStripeWebhook: vi.fn(),
}));

vi.mock("../lib/planLimits.js", () => ({
  persistUsageSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/invoiceNumber.js", () => ({
  generateInvoiceNumber: vi.fn().mockResolvedValue("INV-2026-0001"),
}));

vi.mock("../lib/pix.js", () => ({
  generatePixEMV: vi.fn(() => "pix-emv"),
  generatePixQrCodeUrl: vi.fn(() => "https://pix.example.com/qr"),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
}));

vi.mock("../lib/plan-features.js", () => ({
  hasSeatMapFeature: vi.fn(() => true),
}));

vi.mock("../middlewares/errorHandler.js", async (importOriginal) => {
  return await importOriginal();
});

// ---------------------------------------------------------------------------
// Imports AFTER all mocks
// ---------------------------------------------------------------------------

import subscriptionsRouter from "../routes/subscriptions.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Helper: build minimal Express app
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", subscriptionsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Helper: install DB select result queue
//
// All builder methods (from, where, orderBy) return the same chain so any
// combination is supported without consuming extra queue slots.
// Only .limit() resolves and pops the next result set from the queue.
// All queries in subscriptions.ts upgrade path end with .limit().
// ---------------------------------------------------------------------------

let selectResults: object[][] = [];

function installSelectQueue(results: object[][]) {
  selectResults = [...results];
  mockSelect.mockImplementation(() => {
    const resolveNext = (): Promise<object[]> =>
      Promise.resolve(selectResults.shift() ?? []);
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(resolveNext);
    return chain;
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ME = { id: "user-1", tenantId: "tenant-1", role: "agencia" };

const PLAN = {
  id: "plan-pro",
  slug: "pro",
  name: "Pro",
  monthlyPrice: "99",
  annualPrice: "970",
  trialDays: 0,
  supportedFeatures: [],
};

const TENANT = {
  id: "tenant-1",
  status: "active",
  planId: "starter",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // requireAuth returns the ME user object (not a middleware function)
  mockRequireAuth.mockResolvedValue(ME);

  // Stripe: configured client that returns no matching recurring price
  mockGetUncachableStripeClient.mockResolvedValue({
    prices: {
      search: vi.fn().mockResolvedValue({ data: [] }),
    },
    customers: {
      create: vi.fn().mockResolvedValue({ id: "cus_new" }),
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/subscriptions/upgrade — STRIPE_PRICE_NOT_FOUND guard", () => {
  it("returns 400 STRIPE_PRICE_NOT_FOUND when no recurring Stripe price matches the plan + billing cycle", async () => {
    // Select queue for the upgrade path:
    // 1. plansTable  → plan found
    // 2. tenantsTable → tenant found
    // 3. subscriptionsTable (ordered, limit 10) → existing sub with stripeCustomerId
    installSelectQueue([
      [PLAN],
      [TENANT],
      [{ id: "sub-old", stripeCustomerId: "cus_existing", createdAt: new Date() }],
    ]);

    const res = await request(buildApp())
      .post("/api/subscriptions/upgrade")
      .send({ planSlug: "pro", billingCycle: "monthly" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "STRIPE_PRICE_NOT_FOUND" });
  });

  it("does NOT insert an invoice, update tenant, or insert a subscription before returning 400", async () => {
    installSelectQueue([
      [PLAN],
      [TENANT],
      [{ id: "sub-old", stripeCustomerId: "cus_existing", createdAt: new Date() }],
    ]);

    await request(buildApp())
      .post("/api/subscriptions/upgrade")
      .send({ planSlug: "pro", billingCycle: "monthly" })
      .set("Content-Type", "application/json");

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Annual billing cycle — regression guard for the production mischarge where
// annual checkout silently fell back to a one-time `payment` session because
// no annual recurring Stripe price existed. Asserts:
//   1. When an annual recurring price IS found, the checkout session is
//      created with mode: "subscription" (never "payment") using that price.
//   2. When NO annual recurring price matches (e.g. only monthly exists),
//      the request fails loudly with 400 STRIPE_PRICE_NOT_FOUND and no
//      checkout session is ever created.
// ---------------------------------------------------------------------------

const ANNUAL_PRICE = {
  id: "price_annual_pro",
  unit_amount: 97000, // R$970.00 — matches PLAN.annualPrice
  currency: "brl",
  recurring: { interval: "year" },
};

const MONTHLY_PRICE = {
  id: "price_monthly_pro",
  unit_amount: 9900, // R$99.00 — matches PLAN.monthlyPrice
  currency: "brl",
  recurring: { interval: "month" },
};

describe("POST /api/subscriptions/upgrade — annual billing cycle creates a recurring subscription", () => {
  it("creates a Stripe checkout session with mode 'subscription' using the matched annual recurring price", async () => {
    const mockPricesSearch = vi
      .fn()
      .mockResolvedValue({ data: [MONTHLY_PRICE, ANNUAL_PRICE] });
    const mockSessionsCreate = vi.fn().mockResolvedValue({
      id: "cs_test_annual",
      url: "https://checkout.stripe.com/c/pay/cs_test_annual",
      payment_intent: null,
      subscription: null,
    });

    mockGetUncachableStripeClient.mockResolvedValue({
      prices: { search: mockPricesSearch },
      customers: {
        create: vi.fn().mockResolvedValue({ id: "cus_new" }),
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
      checkout: { sessions: { create: mockSessionsCreate } },
    });

    const CREATED_INVOICE = {
      id: "gen-id",
      invoiceNumber: "INV-2026-0001",
      amount: "970",
      status: "pending",
    };

    // Select queue for the annual upgrade path:
    // 1. plansTable   → plan found
    // 2. tenantsTable → tenant found
    // 3. subscriptionsTable (limit 10) → existing sub with stripeCustomerId
    // 4. invoicesTable (limit 1)       → created invoice re-read for response
    installSelectQueue([
      [PLAN],
      [TENANT],
      [{ id: "sub-old", stripeCustomerId: "cus_existing", createdAt: new Date() }],
      [CREATED_INVOICE],
    ]);

    const res = await request(buildApp())
      .post("/api/subscriptions/upgrade")
      .send({ planSlug: "pro", billingCycle: "annual" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      upgraded: false,
      pendingInvoice: true,
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_annual",
    });

    // The checkout session MUST be a recurring subscription, never a one-time payment
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    const sessionArgs = mockSessionsCreate.mock.calls[0]![0];
    expect(sessionArgs.mode).toBe("subscription");
    expect(sessionArgs.mode).not.toBe("payment");

    // ...and it must use the ANNUAL recurring price, not the monthly one
    expect(sessionArgs.line_items).toEqual([
      { price: "price_annual_pro", quantity: 1 },
    ]);

    // Price resolution searched by planSlug metadata
    expect(mockPricesSearch).toHaveBeenCalledWith({
      query: "metadata['planSlug']:'pro' AND active:'true'",
    });
  });

  it("fails loudly with 400 STRIPE_PRICE_NOT_FOUND when only a monthly price exists for the plan (no annual match)", async () => {
    const mockSessionsCreate = vi.fn();
    mockGetUncachableStripeClient.mockResolvedValue({
      prices: {
        // Only a monthly recurring price — no annual match
        search: vi.fn().mockResolvedValue({ data: [MONTHLY_PRICE] }),
      },
      customers: {
        create: vi.fn().mockResolvedValue({ id: "cus_new" }),
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
      checkout: { sessions: { create: mockSessionsCreate } },
    });

    installSelectQueue([
      [PLAN],
      [TENANT],
      [{ id: "sub-old", stripeCustomerId: "cus_existing", createdAt: new Date() }],
    ]);

    const res = await request(buildApp())
      .post("/api/subscriptions/upgrade")
      .send({ planSlug: "pro", billingCycle: "annual" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "STRIPE_PRICE_NOT_FOUND" });

    // No checkout session (of any mode) may be created, and no DB writes occur
    expect(mockSessionsCreate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /invoices/:id/stripe/checkout — regression guard for the live/test
// Stripe key mismatch bug on the settings-page card form. The frontend used
// to hardcode VITE_STRIPE_PUBLIC_KEY (always the live key) to load Stripe
// Elements while this endpoint's clientSecret was created against whatever
// key getUncachableStripeClient() resolves to (test key in dev). Mixing a
// live publishable key with a test-mode clientSecret breaks card entry.
//
// The fix: this endpoint now also returns `publishableKey`, sourced from
// getStripePublishableKey() (the SAME environment-aware resolver used to
// build the Stripe client), so the frontend can never load Elements with a
// mismatched key. This test locks that contract in place.
// ---------------------------------------------------------------------------

const CARD_INVOICE = {
  id: "invoice-1",
  tenantId: "tenant-1",
  status: "pending",
  amount: "99",
  description: "Assinatura VisiteCRM — Pro",
};

describe("POST /invoices/:id/stripe/checkout — publishableKey must match the environment-resolved key", () => {
  it("returns publishableKey from getStripePublishableKey() alongside clientSecret, not a hardcoded value", async () => {
    const mockPaymentIntentsCreate = vi.fn().mockResolvedValue({
      id: "pi_test_123",
      client_secret: "pi_test_123_secret_abc",
    });

    mockGetUncachableStripeClient.mockResolvedValue({
      customers: {
        create: vi.fn().mockResolvedValue({ id: "cus_new" }),
      },
      paymentIntents: { create: mockPaymentIntentsCreate },
    });

    // Select queue for the checkout path:
    // 1. invoicesTable          → invoice found
    // 2. subscriptionsTable (limit 10) → existing sub, no stripeCustomerId yet
    // 3. usersTable (limit 1)   → admin user for new Stripe customer
    installSelectQueue([
      [CARD_INVOICE],
      [{ id: "sub-old", stripeCustomerId: null, createdAt: new Date() }],
      [{ email: "admin@example.com", name: "Admin" }],
    ]);

    const res = await request(buildApp())
      .post("/api/invoices/invoice-1/stripe/checkout")
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      clientSecret: "pi_test_123_secret_abc",
      paymentIntentId: "pi_test_123",
      publishableKey: "pk_test_mocked_environment_key",
    });

    // Must come from the environment-aware resolver, never a hardcoded literal
    expect(res.body.publishableKey).not.toBe("");
    expect(res.body.publishableKey).not.toMatch(/^pk_live_/);
  });

  it("reflects a live publishableKey in production without any code change (same resolver, different environment)", async () => {
    mockGetStripePublishableKey.mockResolvedValueOnce("pk_live_prod_environment_key");

    const mockPaymentIntentsCreate = vi.fn().mockResolvedValue({
      id: "pi_live_456",
      client_secret: "pi_live_456_secret_def",
    });

    mockGetUncachableStripeClient.mockResolvedValue({
      customers: {
        create: vi.fn().mockResolvedValue({ id: "cus_new" }),
      },
      paymentIntents: { create: mockPaymentIntentsCreate },
    });

    installSelectQueue([
      [CARD_INVOICE],
      [{ id: "sub-old", stripeCustomerId: "cus_existing", createdAt: new Date() }],
    ]);

    const res = await request(buildApp())
      .post("/api/invoices/invoice-1/stripe/checkout")
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body.publishableKey).toBe("pk_live_prod_environment_key");
  });
});

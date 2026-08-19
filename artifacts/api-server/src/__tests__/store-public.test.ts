import pino from "pino";
/**
 * HTTP integration tests for POST /api/public/store/:slug/orders
 *
 * Tests the checkout endpoint in isolation by mocking the DB layer (vi.mock)
 * so no real database is required.  The real Express route handlers run against
 * a supertest HTTP client so all middleware and error-handler paths are exercised.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// vi.hoisted: shared mock factories must exist before any vi.mock factory runs
// ---------------------------------------------------------------------------

const { mockLimit, mockWhere, mockFrom, mockSelect, mockTransaction, mockEnqueueConfirmation } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere: ReturnType<typeof vi.fn> = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockTransaction = vi.fn();
  const mockEnqueueConfirmation = vi.fn().mockResolvedValue(undefined);

  return { mockLimit, mockWhere, mockFrom, mockSelect, mockTransaction, mockEnqueueConfirmation };
});

// ---------------------------------------------------------------------------
// Module mocks (must appear before router import)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    transaction: mockTransaction,
  },
  storesTable: {},
  storeOrdersTable: {},
  storeOrderItemsTable: {},
  storeProductsTable: {},
  storeProductVariantsTable: {},
  storeCouponsTable: {},
  storeReviewsTable: {},
  storeCategoriesTable: {},
  reservationsTable: {},
  tripsTable: {},
  clientsTable: {},
  usersTable: {},
  referralsTable: {},
  referralSettingsTable: {},
  referralTrackingTable: {},
  referralCampaignsTable: {},
  loyaltyMembersTable: {},
  loyaltyProgramsTable: {},
  loyaltyTransactionsTable: {},
  partnersTable: {},
  partnerProductsTable: {},
  partnerCommissionsTable: {},
  dealsTable: {},
  pipelineStagesTable: {},
  tenantsTable: {},
  vehicleLayoutsTable: {},
  partnerAvailabilityTable: {},
  priceAlertSubscriptionsTable: {},
  referralAttemptLogsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  ne: vi.fn(() => "ne"),
  and: vi.fn((...a) => a),
  or: vi.fn((...a) => a),
  inArray: vi.fn(() => "inArray"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  ilike: vi.fn(() => "ilike"),
  isNull: vi.fn(() => "isNull"),
  isNotNull: vi.fn(() => "isNotNull"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/seat-sse.js", () => ({
  addSeatClient: vi.fn(),
  removeSeatClient: vi.fn(),
  emitSeatUpdate: vi.fn(),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin"],
  MANAGEMENT_ROLES: ["admin", "manager"],
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReservationConfirmationEmail: mockEnqueueConfirmation,
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralConvertedEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralExpiredEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralBonusReleasedEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReferralBonusPaidEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReferralConvertedEmail: vi.fn().mockResolvedValue(undefined),
  buildEmailPropsFromReservation: vi.fn().mockResolvedValue({}),
}));

vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppReferralConverted: vi.fn().mockResolvedValue(undefined),
  dispatchWhatsAppReferralExpired: vi.fn().mockResolvedValue(undefined),
  dispatchWhatsAppReferralExpiringSoon: vi.fn().mockResolvedValue(undefined),
  dispatchWhatsAppReferralBonusReleased: vi.fn().mockResolvedValue(undefined),
}));

// Post-payment side effects are not invoked from the checkout route under test,
// so this is a no-op stub that simply prevents the real module (and its Clerk
// imports) from loading.
vi.mock("../services/checkout/post-booking.js", () => ({
  runPostPaymentSideEffects: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
  generateVoucherCode: vi.fn(() => "VCHR-0001"),
  generateReferralCode: vi.fn(() => "REF-0001"),
}));

vi.mock("../lib/referral-code.js", () => ({
  generateAndAssignReferralCode: vi.fn().mockResolvedValue("REF-CODE-001"),
}));

vi.mock("../lib/reservation-number.js", () => ({
  getTenantReservationPrefix: vi.fn().mockResolvedValue("AG"),
  nextReservationSequence: vi.fn().mockResolvedValue(1),
  buildReservationNumber: vi.fn(() => "AG-EX-202507-0001"),
  getYearMonth: vi.fn(() => "202507"),
  tripTypeToCode: vi.fn(() => "EX"),
}));

vi.mock("../lib/pricing.js", () => ({
  normalizeOrderEmail: vi.fn((e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : null)),
  roundMoney: vi.fn((v: number) => Math.round(v * 100) / 100),
}));

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------

import storePublicRouter from "../routes/store-public.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Minimal Express app
// ---------------------------------------------------------------------------

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  const noop = () => {};
  req.log = pino({ level: "silent" }) as unknown as typeof req.log;
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", storePublicRouter);
  app.use((err: Error, _req: express.Request, _res: express.Response, next: express.NextFunction) => {
    console.error("[TEST_ERR]", err.message, err.stack?.split("\n").slice(0, 3).join(" | "));
    next(err);
  });
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const FAKE_STORE = {
  id: "store-001",
  tenantId: "tenant-001",
  slug: "minha-loja",
  name: "Minha Loja",
  isActive: true,
  maintenanceMode: false,
  logo: null,
  contactWhatsapp: null,
  contactPhone: null,
  contactEmail: null,
  customDomain: null,
};

const FAKE_PRODUCT = {
  id: "prod-001",
  storeId: "store-001",
  name: "Excursão Nordeste",
  type: "trip",
  price: "150.00",
  salePrice: null,
  onSale: false,
  trackInventory: false,
  allowBackorder: false,
  stockQuantity: null,
  salesCount: 0,
  status: "active",
  thumbnail: null,
  tripId: null,
};

const FAKE_ORDER = {
  id: "gen-id",
  storeId: "store-001",
  tenantId: "tenant-001",
  orderNumber: "#2026-00001",
  customerName: "Maria Souza",
  customerEmail: "maria@example.com",
  subtotal: "150.00",
  discountAmount: "0.00",
  totalAmount: "150.00",
  status: "pending",
  paymentMethod: "pending",
  paymentProvider: "manual",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VALID_BODY = {
  customerName: "Maria Souza",
  customerEmail: "maria@example.com",
  items: [{ productId: "prod-001", quantity: 1 }],
};

function buildTxMock() {
  return {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    select: vi.fn(() => ({ from: mockFrom })),
  };
}

// ---------------------------------------------------------------------------
// Tests: POST /api/public/store/:slug/orders
// ---------------------------------------------------------------------------

describe("POST /api/public/store/:slug/orders — checkout endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default `where()` is a thenable that ALSO exposes `.limit` so both
    // patterns work without extra setup:
    //   `await db.select().from(t).where(...)`           → resolves to []
    //   `await db.select().from(t).where(...).limit(1)`  → calls mockLimit
    // mockWhere must expose both .limit() and .orderBy().limit() so queries
    // like `.where(...).orderBy(desc(...)).limit(1)` (used in referral-campaigns
    // and referral-conversion) chain correctly through mockLimit.
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    mockWhere.mockReturnValue(
      Object.assign(Promise.resolve([]), { limit: mockLimit, orderBy: mockOrderBy }),
    );
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit, orderBy: mockOrderBy } as unknown as { where: typeof mockWhere; limit: typeof mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });

    // Reset once-queues so leaked mockImplementationOnce / mockResolvedValueOnce
    // from early-returning tests don't corrupt subsequent tests.
    // vi.clearAllMocks() only clears call records, NOT the once-implementation queues.
    mockTransaction.mockReset();
    mockLimit.mockReset();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(buildTxMock()),
    );
  });

  // ── 1. Validation errors (400) ────────────────────────────────────────────

  it("returns 400 when customerName is missing", async () => {
    mockLimit.mockResolvedValueOnce([FAKE_STORE]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ customerEmail: "maria@example.com", items: [{ productId: "p1", quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when customerEmail is missing", async () => {
    mockLimit.mockResolvedValueOnce([FAKE_STORE]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ customerName: "Maria", items: [{ productId: "p1", quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when customerEmail is not a valid email address", async () => {
    mockLimit.mockResolvedValueOnce([FAKE_STORE]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ customerName: "Maria", customerEmail: "not-an-email", items: [{ productId: "p1", quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when items array is empty", async () => {
    mockLimit.mockResolvedValueOnce([FAKE_STORE]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ customerName: "Maria", customerEmail: "maria@example.com", items: [] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when items field is missing entirely", async () => {
    mockLimit.mockResolvedValueOnce([FAKE_STORE]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ customerName: "Maria", customerEmail: "maria@example.com" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  // ── 2. Store not found (404) ──────────────────────────────────────────────

  it("returns 404 when store slug does not exist", async () => {
    mockLimit.mockResolvedValueOnce([]); // store not found

    const res = await request(buildApp())
      .post("/api/public/store/nonexistent-store/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  // ── 3. Out-of-stock product ───────────────────────────────────────────────

  it("returns 409 with INSUFFICIENT_STOCK when product stock is exhausted", async () => {
    const outOfStockProduct = {
      ...FAKE_PRODUCT,
      trackInventory: true,
      allowBackorder: false,
      stockQuantity: 0,
    };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])     // getActiveStore
      .mockResolvedValueOnce([outOfStockProduct]); // product fetch

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INSUFFICIENT_STOCK");
  });

  it("returns 409 with INSUFFICIENT_STOCK when requested quantity exceeds available stock", async () => {
    const lowStockProduct = {
      ...FAKE_PRODUCT,
      trackInventory: true,
      allowBackorder: false,
      stockQuantity: 1,
    };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([lowStockProduct]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({
        ...VALID_BODY,
        items: [{ productId: "prod-001", quantity: 5 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INSUFFICIENT_STOCK");
  });

  // ── 4. Coupon validation ──────────────────────────────────────────────────

  it("returns 400 with COUPON_EXPIRED when coupon date range has passed", async () => {
    const expiredCoupon = {
      id: "coupon-001",
      storeId: "store-001",
      code: "EXPIRED10",
      type: "percentage",
      value: "10.00",
      isActive: true,
      startsAt: new Date("2020-01-01"),
      expiresAt: new Date("2020-12-31"),
      usageLimit: null,
      usageCount: 0,
      maxDiscountAmount: null,
    };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([FAKE_PRODUCT])
      .mockResolvedValueOnce([{ settings: {} }])   // tenant feature flags (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([expiredCoupon]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, couponCode: "EXPIRED10" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("COUPON_EXPIRED");
  });

  it("returns 400 with COUPON_USAGE_LIMIT_EXCEEDED when coupon has reached its usage cap", async () => {
    const maxedCoupon = {
      id: "coupon-002",
      storeId: "store-001",
      code: "MAXED20",
      type: "fixed",
      value: "20.00",
      isActive: true,
      startsAt: new Date("2020-01-01"),
      expiresAt: new Date("2099-12-31"),
      usageLimit: 5,
      usageCount: 5,
      maxDiscountAmount: null,
    };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([FAKE_PRODUCT])
      .mockResolvedValueOnce([{ settings: {} }])   // tenant feature flags (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([maxedCoupon]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, couponCode: "MAXED20" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("COUPON_USAGE_LIMIT_EXCEEDED");
  });

  it("returns 200 and applies fixed discount when coupon is valid (type=fixed)", async () => {
    const fixedCoupon = {
      id: "coupon-003",
      storeId: "store-001",
      code: "SAVE20",
      type: "fixed",
      value: "20.00",
      isActive: true,
      startsAt: new Date("2020-01-01"),
      expiresAt: new Date("2099-12-31"),
      usageLimit: null,
      usageCount: 0,
      maxDiscountAmount: null,
    };
    const discountedOrder = { ...FAKE_ORDER, discountAmount: "20.00", totalAmount: "130.00" };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])            // getActiveStore
      .mockResolvedValueOnce([FAKE_PRODUCT])           // product fetch (no tripId)
      .mockResolvedValueOnce([{ settings: {} }])       // tenant feature flags (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([fixedCoupon])            // coupon lookup (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([discountedOrder])        // post-tx order re-fetch
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, couponCode: "SAVE20" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("orderId");
    expect(parseFloat(res.body.totalAmount)).toBe(130);
  });

  it("returns 200 and applies percentage discount when coupon is valid (type=percentage)", async () => {
    const percentCoupon = {
      id: "coupon-004",
      storeId: "store-001",
      code: "PERC10",
      type: "percentage",
      value: "10.00",
      isActive: true,
      startsAt: new Date("2020-01-01"),
      expiresAt: new Date("2099-12-31"),
      usageLimit: null,
      usageCount: 0,
      maxDiscountAmount: null,
    };
    const discountedOrder = { ...FAKE_ORDER, discountAmount: "15.00", totalAmount: "135.00" };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])            // getActiveStore
      .mockResolvedValueOnce([FAKE_PRODUCT])           // product fetch (no tripId)
      .mockResolvedValueOnce([{ settings: {} }])       // tenant feature flags (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([percentCoupon])          // coupon lookup (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([discountedOrder])        // post-tx order re-fetch
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, couponCode: "PERC10" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("orderId");
    expect(parseFloat(res.body.totalAmount)).toBe(135);
  });

  // ── 5. Trip seat availability ─────────────────────────────────────────────

  it("returns 409 with INSUFFICIENT_SEATS when trip has 0 available seats", async () => {
    const tripProduct = { ...FAKE_PRODUCT, tripId: "trip-001" };
    const fullTrip = { availableSeats: 0 };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])   // getActiveStore
      .mockResolvedValueOnce([tripProduct])  // product fetch
      .mockResolvedValueOnce([fullTrip]);    // trip seat check

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INSUFFICIENT_SEATS");
  });

  it("returns 400 with SEATS_PER_ORDER_EXCEEDED when a single order requests more than the per-trip cap", async () => {
    // tripProduct.id must match the productId sent in the body so that
    // quantityByProductId and fetchedProducts share the same key ("prod-001")
    // and tripLinkedProducts is correctly populated with totalQty=21.
    const tripProduct = { ...FAKE_PRODUCT, tripId: "trip-001" };
    // Phase 1.5 sees plenty of seats, but the per-order cap (default 20) fires after.
    const bigTrip = { availableSeats: 500 };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])   // getActiveStore
      .mockResolvedValueOnce([tripProduct])  // product fetch (id="prod-001")
      .mockResolvedValueOnce([bigTrip])      // Phase 1.5 seat check (500 seats, passes)
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      // productId must match FAKE_PRODUCT.id so quantityByProductId key aligns with fetchedProducts.
      // 21 seats exceeds the default cap of 20 — cap check fires before any reservation context loads.
      .send({ ...VALID_BODY, items: [{ productId: "prod-001", quantity: 21 }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SEATS_PER_ORDER_EXCEEDED");
  });

  it("returns 200 with orderId when trip has enough available seats", async () => {
    const tripProduct = { ...FAKE_PRODUCT, tripId: "trip-001" };
    const availableTrip = { availableSeats: 10 };

    // Default mockWhere (thenable+limit) handles both `await .where()` and
    // `await .where().limit()`. Sequential `.limit()` calls consume mockLimit
    // in order; the admin-user lookup is now inside the tx callback,
    // which we skip below — so it does NOT consume from mockLimit.
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])           // getActiveStore (db)
      .mockResolvedValueOnce([tripProduct])           // product fetch (db)
      .mockResolvedValueOnce([availableTrip])         // Phase 1.5 trip seat check (db)
      .mockResolvedValueOnce([FAKE_ORDER])            // post-tx order re-fetch (db)
      .mockResolvedValue([]);                         // remaining selects

    // Skip executing the transaction callback to avoid mocking the FOR UPDATE
    // SQL lock path; the preliminary seat check (Phase 1.5) is what we are testing.
    mockTransaction.mockImplementationOnce(async (_cb: unknown) => {});

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("orderId");
    expect(res.body).toHaveProperty("totalAmount");
  });

  // ── 6. Referral code validation ───────────────────────────────────────────

  it("does not apply discount when referral code is blocked (referralCodeStatus=blocked)", async () => {
    const blockedReferrer = {
      id: "client-ref-001",
      name: "João Referrer",
      email: "referrer@example.com",
      referralCodeStatus: "blocked",
      successfulReferrals: 0,
    };
    const refSettings = {
      discountValue: "10.00",
      discountType: "percentage",
      isEnabled: true,
      allowSelfReferral: true,
      requireFirstPurchase: false,
      bonusValue: "10.00",
      minPurchaseAmount: null,
      maxReferralsPerUser: null,
    };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])            // getActiveStore
      .mockResolvedValueOnce([FAKE_PRODUCT])           // product fetch (no tripId)
      .mockResolvedValueOnce([{ settings: {} }])       // tenant feature flags (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([blockedReferrer])        // referrer lookup (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([refSettings])            // referral settings (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([FAKE_ORDER])             // post-tx order re-fetch
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, referralCode: "BLOCKED-REF" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("orderId");
    expect(parseFloat(res.body.totalAmount)).toBe(150);
  });

  it("does not apply discount when customer self-refers and allowSelfReferral is false", async () => {
    const selfReferrer = {
      id: "client-ref-002",
      name: "Maria Souza",
      email: "maria@example.com",
      referralCodeGeneratedAt: new Date(),
    };
    const refSettings = {
      discountValue: "10.00",
      discountType: "percentage",
      isEnabled: true,
      expirationDays: 365,
      allowSelfReferral: false,
      requireFirstPurchase: false,
      bonusValue: "10.00",
    };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])            // getActiveStore
      .mockResolvedValueOnce([FAKE_PRODUCT])           // product fetch (no tripId)
      .mockResolvedValueOnce([{ settings: {} }])       // tenant feature flags (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([selfReferrer])           // referrer lookup (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([refSettings])            // referral settings (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([FAKE_ORDER])             // post-tx order re-fetch
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, referralCode: "SELF-REF" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("orderId");
    expect(parseFloat(res.body.totalAmount)).toBe(150);
  });

  it("does not apply discount when requireFirstPurchase is true and a prior completed order exists", async () => {
    const referrer = {
      id: "client-ref-003",
      name: "João Referrer",
      email: "referrer@example.com",
      referralCodeGeneratedAt: new Date(),
    };
    const refSettings = {
      discountValue: "10.00",
      discountType: "percentage",
      isEnabled: true,
      expirationDays: 365,
      allowSelfReferral: true,
      requireFirstPurchase: true,
      bonusValue: "10.00",
    };
    const priorOrder = { id: "order-prior-001" };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])            // getActiveStore
      .mockResolvedValueOnce([FAKE_PRODUCT])           // product fetch (no tripId)
      .mockResolvedValueOnce([{ settings: {} }])       // tenant feature flags (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([referrer])               // referrer lookup (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([refSettings])            // referral settings (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([priorOrder])             // prior completed order check (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([FAKE_ORDER])             // post-tx order re-fetch
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, referralCode: "FIRSTPURCH" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("orderId");
    expect(parseFloat(res.body.totalAmount)).toBe(150);
  });

  it("applies referral discount and reduces totalAmount when referral code is valid", async () => {
    const referrer = {
      id: "client-ref-004",
      name: "João Referrer",
      email: "referrer@example.com",
      referralCodeGeneratedAt: new Date(),
    };
    const refSettings = {
      discountValue: "10.00",
      discountType: "percentage",
      isEnabled: true,
      expirationDays: 365,
      allowSelfReferral: true,
      requireFirstPurchase: false,
      bonusValue: "10.00",
    };
    const discountedOrder = { ...FAKE_ORDER, discountAmount: "15.00", totalAmount: "135.00" };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])            // getActiveStore
      .mockResolvedValueOnce([FAKE_PRODUCT])           // product fetch (no tripId)
      .mockResolvedValueOnce([{ settings: {} }])       // tenant feature flags (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([referrer])               // referrer lookup (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([refSettings])            // referral settings (resolveCheckoutDiscounts)
      .mockResolvedValueOnce([discountedOrder])        // post-tx order re-fetch
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, referralCode: "VALID-REF" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("orderId");
    expect(parseFloat(res.body.totalAmount)).toBeLessThan(150);
  });

  // ── 7. Feature-flag gates (referralsEnabled / couponsEnabled) ───────────

  it("does not apply referral discount when tenant has referralsEnabled: false", async () => {
    // When referralsEnabled is false the discount service must skip the referral
    // lookup entirely — no referrer or settings DB call should be made — and the
    // order must succeed at full price (no discount applied).
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])                                         // getActiveStore
      .mockResolvedValueOnce([FAKE_PRODUCT])                                        // product fetch
      .mockResolvedValueOnce([{ settings: { referralsEnabled: false } }])          // tenant feature flags
      .mockResolvedValueOnce([FAKE_ORDER])                                          // post-tx order re-fetch
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, referralCode: "ANY-REF" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("orderId");
    // Full price — no referral discount applied
    expect(parseFloat(res.body.totalAmount)).toBe(150);
  });

  it("does not apply coupon discount when tenant has couponsEnabled: false", async () => {
    // When couponsEnabled is false the discount service must skip the coupon
    // lookup entirely — the order must succeed at full price with no discount,
    // and no COUPON_* error must be raised.
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])                                         // getActiveStore
      .mockResolvedValueOnce([FAKE_PRODUCT])                                        // product fetch
      .mockResolvedValueOnce([{ settings: { couponsEnabled: false } }])            // tenant feature flags
      .mockResolvedValueOnce([FAKE_ORDER])                                          // post-tx order re-fetch
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, couponCode: "ANY-COUPON" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("orderId");
    // Full price — no coupon discount applied
    expect(parseFloat(res.body.totalAmount)).toBe(150);
  });

  // ── 8. Valid order (200) ──────────────────────────────────────────────────

  it("returns 200 with orderId when all fields are valid and product is in stock", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])    // getActiveStore
      .mockResolvedValueOnce([FAKE_PRODUCT])  // product fetch (no tripId, no inventory)
      .mockResolvedValueOnce([FAKE_ORDER])    // post-tx order re-fetch
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("orderId");
    expect(res.body).toHaveProperty("orderNumber");
    expect(res.body).toHaveProperty("totalAmount");
  });

  // ── 9. Post-booking side effects are deferred to payment (task #17 hardening) ──

  it("does not enqueue the reservation confirmation email at checkout (deferred to payment)", async () => {
    const tripProduct = { ...FAKE_PRODUCT, tripId: "trip-001" };
    const availableTrip = { availableSeats: 10 };

    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])           // getActiveStore
      .mockResolvedValueOnce([tripProduct])           // product fetch
      .mockResolvedValueOnce([availableTrip])         // seat availability check
      .mockResolvedValueOnce([{ id: "admin-001" }])  // admin user (inside tx)
      .mockResolvedValueOnce([])                      // upsertCheckoutClient – no existing client (inside tx)
      .mockResolvedValueOnce([FAKE_ORDER])            // post-tx order re-fetch
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(200);

    // Allow any fire-and-forget async to settle, then assert no confirmation email
    // was enqueued during checkout — it is deferred to the payment-confirmation path.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockEnqueueConfirmation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/public/store/:slug — seatMapEnabled tenant toggle
// ---------------------------------------------------------------------------

describe("GET /api/public/store/:slug — seatMapEnabled in response", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    mockWhere.mockReturnValue(
      Object.assign(Promise.resolve([]), { limit: mockLimit, orderBy: mockOrderBy }),
    );
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit, orderBy: mockOrderBy } as unknown as { where: typeof mockWhere; limit: typeof mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockTransaction.mockReset();
    mockLimit.mockReset();
  });

  it("returns seatMapEnabled: false when tenantSettings.seatMapEnabled is explicitly false", async () => {
    // DB call #1 (mockLimit): getActiveStore → store row
    // DB call #2 (mockLimit): tenant settings row with seatMapEnabled=false
    // db.update: mocked to resolve; no mockLimit consumed
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([{ settings: { seatMapEnabled: false } }]);

    const res = await request(buildApp()).get("/api/public/store/minha-loja");

    expect(res.status).toBe(200);
    expect(res.body.seatMapEnabled).toBe(false);
  });

  it("returns seatMapEnabled: true when tenantSettings.seatMapEnabled is explicitly true", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([{ settings: { seatMapEnabled: true } }]);

    const res = await request(buildApp()).get("/api/public/store/minha-loja");

    expect(res.status).toBe(200);
    expect(res.body.seatMapEnabled).toBe(true);
  });

  it("defaults seatMapEnabled to true when the field is absent from tenant settings", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([{ settings: {} }]); // seatMapEnabled not set

    const res = await request(buildApp()).get("/api/public/store/minha-loja");

    expect(res.status).toBe(200);
    expect(res.body.seatMapEnabled).toBe(true);
  });

  it("defaults seatMapEnabled to true when the tenant row is missing entirely", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([]); // no tenant row found

    const res = await request(buildApp()).get("/api/public/store/minha-loja");

    expect(res.status).toBe(200);
    expect(res.body.seatMapEnabled).toBe(true);
  });

  it("returns 404 when the store slug does not exist", async () => {
    mockLimit.mockResolvedValueOnce([]); // store not found

    const res = await request(buildApp()).get("/api/public/store/nonexistent");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns couponsEnabled and referralsEnabled alongside seatMapEnabled", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([{
        settings: { seatMapEnabled: false, couponsEnabled: false, referralsEnabled: true },
      }]);

    const res = await request(buildApp()).get("/api/public/store/minha-loja");

    expect(res.status).toBe(200);
    expect(res.body.seatMapEnabled).toBe(false);
    expect(res.body.couponsEnabled).toBe(false);
    expect(res.body.referralsEnabled).toBe(true);
  });
});

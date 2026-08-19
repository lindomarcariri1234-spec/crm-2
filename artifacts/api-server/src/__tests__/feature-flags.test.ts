/**
 * Feature-flag guard tests for store-public routes.
 *
 * Verifies that referral and coupon endpoints are blocked (correct 4xx status
 * and error code) when the corresponding tenant feature flag is disabled, and
 * that each endpoint responds normally when the feature is enabled.
 *
 * Uses the same mock infrastructure as store-public.test.ts: all DB calls are
 * intercepted via vi.mock so no real database is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";

// ---------------------------------------------------------------------------
// vi.hoisted: shared mock factories must exist before any vi.mock factory runs
// ---------------------------------------------------------------------------

const { mockLimit, mockWhere, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere: ReturnType<typeof vi.fn> = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockLimit, mockWhere, mockFrom, mockSelect };
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
  storesTable: {},
  tenantsTable: {},
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
  partnerAvailabilityTable: {},
  dealsTable: {},
  pipelineStagesTable: {},
  vehicleLayoutsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a) => a),
  or: vi.fn((...a) => a),
  inArray: vi.fn(() => "inArray"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  ilike: vi.fn(() => "ilike"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("@workspace/permissions", () => ({
  RESERVATION_STATUS: {},
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

vi.mock("../lib/pricing.js", () => ({
  normalizeOrderEmail: vi.fn((e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : null)),
  roundMoney: vi.fn((v: number) => Math.round(v * 100) / 100),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
  generateVoucherCode: vi.fn(() => "VCHR-0001"),
  generateReferralCode: vi.fn(() => "REF-0001"),
}));

vi.mock("../lib/reservation-number.js", () => ({
  getTenantReservationPrefix: vi.fn().mockResolvedValue("AG"),
  nextReservationSequence: vi.fn().mockResolvedValue(1),
  buildReservationNumber: vi.fn(() => "AG-EX-202507-0001"),
  getYearMonth: vi.fn(() => "202507"),
  tripTypeToCode: vi.fn(() => "EX"),
}));

vi.mock("../lib/get-client-ip.js", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/client-notifications.js", () => ({
  insertClientNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptOrPassthrough: vi.fn((v: unknown) => v),
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../services/checkout/post-booking.js", () => ({
  runPostPaymentSideEffects: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/checkout/discounts.js", () => ({
  resolveCheckoutDiscounts: vi.fn().mockResolvedValue({ discountAmount: 0, appliedCouponId: null, appliedReferralCode: null }),
}));

vi.mock("../services/checkout/items.js", () => ({
  prepareCheckoutItems: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/checkout/reservation-context.js", () => ({
  loadReservationContext: vi.fn().mockResolvedValue({}),
}));

vi.mock("../services/checkout/persist-order.js", () => ({
  persistCheckoutOrder: vi.fn().mockResolvedValue({ orderId: "gen-id", orderNumber: "#001" }),
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
  req.log = pino({ level: "silent" }) as unknown as typeof req.log;
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", storePublicRouter);
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

const TENANT_REFERRALS_DISABLED = { settings: { referralsEnabled: false } };
const TENANT_COUPONS_DISABLED = { settings: { couponsEnabled: false } };
const TENANT_ALL_ENABLED = { settings: {} };

const FAKE_REFERRER = {
  id: "client-ref-001",
  name: "João Referrer",
  email: "referrer@test.com",
  referralCode: "REF123",
  referralCodeStatus: "active",
  successfulReferrals: 0,
  referralCodeGeneratedAt: null,
};

const FAKE_REF_SETTINGS = {
  discountValue: "5.00",
  discountType: "percentage",
  isEnabled: true,
  isActive: true,
  expirationDays: 30,
  allowSelfReferral: false,
  requireFirstPurchase: false,
};

const FAKE_COUPON = {
  id: "coupon-enabled-001",
  storeId: "store-001",
  code: "VALID10",
  type: "percentage",
  value: "10.00",
  isActive: true,
  startsAt: new Date("2020-01-01"),
  expiresAt: new Date("2099-12-31"),
  usageLimit: null,
  usageCount: 0,
  maxDiscountAmount: null,
  minPurchaseAmount: null,
};

// ---------------------------------------------------------------------------
// beforeEach: reset mocks and configure DB chain
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks does NOT flush the mockResolvedValueOnce queue; reset explicitly
  // so unconsumed one-time values from previous tests don't bleed through.
  mockLimit.mockReset();

  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue(
    Object.assign(Promise.resolve([]), { limit: mockLimit, orderBy: mockOrderBy }),
  );
  mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit, orderBy: mockOrderBy });
  mockSelect.mockReturnValue({ from: mockFrom });
});

// ---------------------------------------------------------------------------
// Tests: feature flag disabled — endpoints must be blocked
// ---------------------------------------------------------------------------

describe("Feature flag disabled — endpoints return the correct error", () => {
  it("GET /referral/info returns 404 when referralsEnabled = false", async () => {
    // Seed a valid referrer and active settings AFTER the tenant row so that
    // if the feature-flag guard were ever removed, the route would reach the
    // referrer lookup, find data, and return 200 — causing this test to fail.
    // The 404 here must be caused by the flag check, not by missing referral data.
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([TENANT_REFERRALS_DISABLED])
      .mockResolvedValueOnce([{ id: FAKE_REFERRER.id, name: FAKE_REFERRER.name }]) // referrer (never reached)
      .mockResolvedValueOnce([FAKE_REF_SETTINGS])                                  // settings  (never reached)
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .get("/api/public/store/minha-loja/referral/info")
      .query({ code: "REF123" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("POST /referral/track returns 404 when referralsEnabled = false", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([TENANT_REFERRALS_DISABLED])
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/referral/track")
      .send({ code: "REF123" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("POST /referral/validate returns 4xx with REFERRAL_PROGRAM_INACTIVE when referralsEnabled = false", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([TENANT_REFERRALS_DISABLED])
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/referral/validate")
      .send({ code: "REF123" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code).toBe("REFERRAL_PROGRAM_INACTIVE");
  });

  it("POST /coupons/validate returns 4xx with COUPONS_DISABLED when couponsEnabled = false", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([TENANT_COUPONS_DISABLED])
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/coupons/validate")
      .send({ code: "SAVE10" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code).toBe("COUPONS_DISABLED");
  });
});

// ---------------------------------------------------------------------------
// Tests: feature flag enabled — endpoints respond normally
// ---------------------------------------------------------------------------

describe("Feature flag enabled — endpoints return normal responses", () => {
  it("GET /referral/info returns 200 with referrer details when referralsEnabled is not set to false", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([TENANT_ALL_ENABLED])
      .mockResolvedValueOnce([{ id: FAKE_REFERRER.id, name: FAKE_REFERRER.name, referralCodeStatus: FAKE_REFERRER.referralCodeStatus }])
      .mockResolvedValueOnce([FAKE_REF_SETTINGS])
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .get("/api/public/store/minha-loja/referral/info")
      .query({ code: "REF123" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("referrerName");
    expect(res.body).toHaveProperty("discountValue");
  });

  it("POST /referral/track returns 200 with cookieId when referralsEnabled is not set to false", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([TENANT_ALL_ENABLED])
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/referral/track")
      .send({ code: "REF123" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("cookieId");
    expect(res.body.tracked).toBe(true);
  });

  it("POST /referral/validate returns 200 with valid=true when referralsEnabled is not set to false", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([TENANT_ALL_ENABLED])
      .mockResolvedValueOnce([FAKE_REFERRER])
      .mockResolvedValueOnce([FAKE_REF_SETTINGS])
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/referral/validate")
      .send({ code: "REF123" });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.code).toBe("REF123");
  });

  it("POST /coupons/validate returns 200 with valid=true when couponsEnabled is not set to false", async () => {
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([TENANT_ALL_ENABLED])
      .mockResolvedValueOnce([FAKE_COUPON])
      .mockResolvedValue([]);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/coupons/validate")
      .send({ code: "VALID10", cartTotal: 100 });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.code).toBe("VALID10");
  });
});

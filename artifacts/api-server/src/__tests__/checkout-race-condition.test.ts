/**
 * Race-condition guard tests for POST /api/public/store/:slug/orders
 *
 * Verifies that when two customers simultaneously checkout for the same
 * client+trip, the PostgreSQL 23505 unique-constraint violation on
 * `reservations_active_client_trip_unique` is converted to a 409
 * DUPLICATE_RESERVATION instead of surfacing as a confusing 500 or 502.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";

// ---------------------------------------------------------------------------
// vi.hoisted: shared mock factories must exist before any vi.mock factory runs
// ---------------------------------------------------------------------------

const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockPrepareItems,
  mockResolveDiscounts,
  mockPersistOrder,
  mockCreateReservations,
} = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere: ReturnType<typeof vi.fn> = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  const mockPrepareItems = vi.fn();
  const mockResolveDiscounts = vi.fn();
  const mockPersistOrder = vi.fn();
  const mockCreateReservations = vi.fn();

  return {
    mockLimit,
    mockWhere,
    mockFrom,
    mockSelect,
    mockPrepareItems,
    mockResolveDiscounts,
    mockPersistOrder,
    mockCreateReservations,
  };
});

// ---------------------------------------------------------------------------
// Module mocks (must appear before router import)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
        select: vi.fn(() => ({ from: mockFrom })),
      }),
    ),
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

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: null })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/seat-sse.js", () => ({
  addSeatClient: vi.fn(),
  removeSeatClient: vi.fn(),
  emitSeatUpdate: vi.fn(),
  tryAddSeatClient: vi.fn(),
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
  sendPriceAlertConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  enqueuePixOrderAlertEmail: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../lib/client-notifications.js", () => ({
  insertClientNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/shared", () => ({
  localToday: vi.fn(() => "2026-07-20"),
}));

vi.mock("../services/checkout/items.js", () => ({
  prepareCheckoutItems: mockPrepareItems,
}));

vi.mock("../services/checkout/discounts.js", () => ({
  resolveCheckoutDiscounts: mockResolveDiscounts,
}));

vi.mock("../services/checkout/persist-order.js", () => ({
  persistCheckoutOrder: mockPersistOrder,
}));

vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: mockCreateReservations,
}));

vi.mock("../services/checkout/portal-account.js", () => ({
  ensurePortalAccount: vi.fn().mockResolvedValue(undefined),
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
  pixEnabled: false,
  pixKey: null,
  minDepositAmount: null,
};

const FAKE_ORDER_ROW = {
  id: "gen-id",
  storeId: "store-001",
  tenantId: "tenant-001",
  orderNumber: "#2026-ABC123",
  customerName: "Maria Souza",
  customerEmail: "maria@example.com",
  subtotal: "150.00",
  discountAmount: "0.00",
  totalAmount: "150.00",
  status: "pending",
  paymentMethod: "boleto",
  paymentProvider: "manual",
  pixQrCode: null,
  pixQrCodeUrl: null,
  pixCopyPaste: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VALID_BODY = {
  customerName: "Maria Souza",
  customerEmail: "maria@example.com",
  items: [{ productId: "prod-001", quantity: 1 }],
};

const TRIP_ITEMS_RESULT = {
  subtotal: 150,
  orderItemsData: [{ productId: "prod-001", quantity: 1, unitPrice: 150, productName: "Excursão Nordeste" }],
  fetchedProducts: new Map([["prod-001", { id: "prod-001", name: "Excursão Nordeste", tripId: "trip-001" }]]),
  quantityByProductId: new Map([["prod-001", 1]]),
  tripLinkedProducts: new Map([["trip-001", { totalQty: 1, products: [] }]]),
};

const NO_DISCOUNT = {
  discountAmount: 0,
  couponId: null,
  appliedReferralCode: null,
  appliedReferralReferrerId: null,
  appliedReferralDiscountValue: null,
  appliedReferralDiscountType: null,
};

const FAKE_CREATE_RESULT = {
  reservationIds: ["res-001"],
  reservationClientId: "client-001",
  tripIds: ["trip-001"],
};

// ---------------------------------------------------------------------------
// Helpers for setting up db.select mock chain
// ---------------------------------------------------------------------------

function setupStoreAndOrderLookup() {
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue(
    Object.assign(Promise.resolve([]), { limit: mockLimit, orderBy: mockOrderBy }),
  );
  mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit, orderBy: mockOrderBy } as unknown as {
    where: typeof mockWhere;
    limit: typeof mockLimit;
  });
  mockSelect.mockReturnValue({ from: mockFrom });

  mockLimit.mockReset();
  mockLimit
    .mockResolvedValueOnce([FAKE_STORE])    // getActiveStore
    .mockResolvedValueOnce([FAKE_ORDER_ROW]); // order fetch after persistCheckoutOrder
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/public/store/:slug/orders — reservation race-condition guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 409 DUPLICATE_RESERVATION (not 500/502) when PG 23505 fires on reservations_active_client_trip_unique during checkout", async () => {
    setupStoreAndOrderLookup();
    mockPrepareItems.mockResolvedValueOnce(TRIP_ITEMS_RESULT);
    mockResolveDiscounts.mockResolvedValueOnce(NO_DISCOUNT);
    mockPersistOrder.mockResolvedValueOnce(undefined);

    const pgErr = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "reservations_active_client_trip_unique",
    });
    mockCreateReservations.mockRejectedValueOnce(pgErr);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_RESERVATION");
  });

  it("response body contains a user-friendly Portuguese message (not a raw PG error)", async () => {
    setupStoreAndOrderLookup();
    mockPrepareItems.mockResolvedValueOnce(TRIP_ITEMS_RESULT);
    mockResolveDiscounts.mockResolvedValueOnce(NO_DISCOUNT);
    mockPersistOrder.mockResolvedValueOnce(undefined);

    const pgErr = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "reservations_active_client_trip_unique",
    });
    mockCreateReservations.mockRejectedValueOnce(pgErr);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.body.message).toMatch(/reserva ativa/i);
    expect(res.body.message).not.toMatch(/duplicate key/i);
  });

  it("returns 502 RESERVATION_SYNC_FAILED for non-constraint reservation errors (unrelated DB failure)", async () => {
    setupStoreAndOrderLookup();
    mockPrepareItems.mockResolvedValueOnce(TRIP_ITEMS_RESULT);
    mockResolveDiscounts.mockResolvedValueOnce(NO_DISCOUNT);
    mockPersistOrder.mockResolvedValueOnce(undefined);

    mockCreateReservations.mockRejectedValueOnce(new Error("Connection timeout"));

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("RESERVATION_SYNC_FAILED");
  });

  it("does not treat a 23505 on a different constraint as DUPLICATE_RESERVATION", async () => {
    setupStoreAndOrderLookup();
    mockPrepareItems.mockResolvedValueOnce(TRIP_ITEMS_RESULT);
    mockResolveDiscounts.mockResolvedValueOnce(NO_DISCOUNT);
    mockPersistOrder.mockResolvedValueOnce(undefined);

    const pgErr = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "some_other_unique_index",
    });
    mockCreateReservations.mockRejectedValueOnce(pgErr);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("RESERVATION_SYNC_FAILED");
  });
});

// ---------------------------------------------------------------------------
// Cross-tab / concurrent-request tests (no idempotencyKey)
// ---------------------------------------------------------------------------

/**
 * Sets up the db.select mock chain for N concurrent requests.
 *
 * Each request needs exactly two `.limit()` calls that return a real value:
 *   1. getActiveStore  → FAKE_STORE
 *   2. order row fetch → FAKE_ORDER_ROW  (only on the request that reaches 200)
 *
 * The request that fails with 409 exits before the order row fetch, so for
 * two concurrent requests we queue: [STORE, STORE, ORDER_ROW, ORDER_ROW].
 * The extra ORDER_ROW slot is unused but prevents a spurious `undefined` if
 * mock ordering shifts under different event-loop schedules.
 */
function setupForTwoConcurrentRequests() {
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue(
    Object.assign(Promise.resolve([]), { limit: mockLimit, orderBy: mockOrderBy }),
  );
  mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit, orderBy: mockOrderBy } as unknown as {
    where: typeof mockWhere;
    limit: typeof mockLimit;
  });
  mockSelect.mockReturnValue({ from: mockFrom });

  mockLimit.mockReset();
  mockLimit
    .mockResolvedValueOnce([FAKE_STORE])     // request A — getActiveStore
    .mockResolvedValueOnce([FAKE_STORE])     // request B — getActiveStore
    .mockResolvedValueOnce([FAKE_ORDER_ROW]) // winning request — order row lookup
    .mockResolvedValueOnce([FAKE_ORDER_ROW]); // safety slot (may not be consumed)
}

describe("POST /api/public/store/:slug/orders — cross-tab race (same client, no idempotencyKey)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 for the winner and 409 DUPLICATE_RESERVATION for the loser when two tabs race without idempotencyKey", async () => {
    setupForTwoConcurrentRequests();

    // Both tabs send the same customer email / trip — no idempotencyKey
    mockPrepareItems
      .mockResolvedValueOnce(TRIP_ITEMS_RESULT)
      .mockResolvedValueOnce(TRIP_ITEMS_RESULT);
    mockResolveDiscounts
      .mockResolvedValueOnce(NO_DISCOUNT)
      .mockResolvedValueOnce(NO_DISCOUNT);
    mockPersistOrder
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    // First createReservations call wins; second hits the PG unique-constraint
    // violation — simulating the real race between two concurrent transactions.
    let createCallCount = 0;
    const pgDuplicate = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      { code: "23505", constraint: "reservations_active_client_trip_unique" },
    );
    mockCreateReservations.mockImplementation(async () => {
      createCallCount++;
      if (createCallCount === 1) return FAKE_CREATE_RESULT;
      throw pgDuplicate;
    });

    const app = buildApp();
    const [resA, resB] = await Promise.all([
      request(app).post("/api/public/store/minha-loja/orders").send({ ...VALID_BODY }),
      request(app).post("/api/public/store/minha-loja/orders").send({ ...VALID_BODY }),
    ]);

    // Exactly one 200 and one 409 — regardless of which tab "won"
    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const loser = [resA, resB].find((r) => r.status === 409)!;
    expect(loser.body.code).toBe("DUPLICATE_RESERVATION");
    expect(loser.body.message).toMatch(/reserva ativa/i);
    expect(loser.body.message).not.toMatch(/duplicate key/i);

    // The winning tab receives a valid checkout response (has orderId + items array)
    const winner = [resA, resB].find((r) => r.status === 200)!;
    expect(winner.body).toHaveProperty("orderId");
    expect(Array.isArray(winner.body.items)).toBe(true);

    // Guard fired exactly twice — once per tab
    expect(createCallCount).toBe(2);
  });
});

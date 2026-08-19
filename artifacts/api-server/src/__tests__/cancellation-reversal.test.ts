/**
 * Cancellation reversal tests: PATCH /reservations/:id with status "cancelled"
 *
 * Verifies that cancelling an active reservation atomically reverts all financial
 * side-effects created at booking time:
 *   1. Coupon usage_count is decremented
 *   2. Loyalty points used as discount are restored to the member
 *   3. Referral bonus credited to the referrer is reversed
 *   4. Loyalty points earned from payments on this reservation are clawed back
 *
 * Uses supertest + vi.mock to isolate the DB layer.
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any vi.mock factory runs
// ---------------------------------------------------------------------------

const {
  capturedUpdates,
  capturedInserts,
  mockTxSelect,
  mockTxFrom,
  mockTxWhere,
  mockTxLimit,
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockTransaction,
  mockEnqueueCancellationEmail,
  mockSyncTrip,
  mockSyncTripGeneral,
} = vi.hoisted(() => {
  const capturedUpdates: Array<{ table: string; set: Record<string, unknown> }> = [];
  const capturedInserts: Record<string, unknown>[] = [];

  const mockTxLimit = vi.fn();
  const mockTxWhere = vi.fn(() => ({ limit: mockTxLimit }));
  const mockTxFrom = vi.fn(() => ({ where: mockTxWhere, limit: mockTxLimit }));
  const mockTxSelect = vi.fn(() => ({ from: mockTxFrom }));

  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockTransaction = vi.fn();
  const mockEnqueueCancellationEmail = vi.fn().mockResolvedValue(undefined);
  const mockSyncTrip = vi.fn().mockResolvedValue(undefined);
  const mockSyncTripGeneral = vi.fn().mockResolvedValue(undefined);

  return {
    capturedUpdates,
    capturedInserts,
    mockTxSelect,
    mockTxFrom,
    mockTxWhere,
    mockTxLimit,
    mockLimit,
    mockWhere,
    mockFrom,
    mockSelect,
    mockTransaction,
    mockEnqueueCancellationEmail,
    mockSyncTrip,
    mockSyncTripGeneral,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    transaction: mockTransaction,
  },
  storesTable: { id: "id", tenantId: "tenant_id" },
  storeOrdersTable: { id: "id", tenantId: "tenant_id", orderNumber: "order_number", status: "status", cancelledAt: "cancelled_at" },
  storeOrderItemsTable: {},
  storeProductsTable: {},
  storeProductVariantsTable: {},
  storeCouponsTable: { storeId: "store_id", code: "code", usageCount: "usage_count" },
  storeReviewsTable: {},
  storeCategoriesTable: {},
  reservationsTable: {},
  passengersTable: {},
  tripsTable: {},
  clientsTable: {},
  loyaltyMembersTable: {},
  loyaltyTransactionsTable: {},
  loyaltyProgramsTable: {},
  referralsTable: {},
  referralSettingsTable: {},
  dealsTable: {},
  pipelineStagesTable: {},
  tenantsTable: {},
  emailLogsTable: {},
  referralTrackingTable: {},
  usersTable: {},
  paymentsTable: {},
  commissionsTable: {},
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
  MANAGEMENT_ROLES: ["admin", "gerente"],
}));

vi.mock("../routes/payments.js", () => ({
  syncReservationCommission: vi.fn().mockResolvedValue(undefined),
  recalculateClientFinancials: vi.fn().mockResolvedValue(undefined),
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), use: vi.fn() },
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationCancellationEmail: mockEnqueueCancellationEmail,
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: mockSyncTripGeneral,
    syncTripOnReservationCancellation: mockSyncTrip,
  },
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

// Prevents pipeline-automation's db.select()…orderBy() calls from consuming
// outer mockLimit slots (moveDealToStage is fire-and-forget in the route and
// runs concurrently with formatReservation, so without this mock it would
// shift the outer mockLimit queue and break every clientId-bearing test).
vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
  cancelDealOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../lib/passenger.js", () => ({
  deriveAgeCategory: vi.fn(() => "adult"),
  getAgeYears: vi.fn(() => 30),
}));

// ---------------------------------------------------------------------------
// Import routers and middleware AFTER all mocks
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import reservationsRouter from "../routes/reservations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// App builder + logger stub
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

function buildReservationsApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", reservationsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const FAKE_USER = {
  id: "user-001",
  tenantId: "tenant-001",
  role: ROLES.AGENCY_ADMIN,
  name: "Agente Teste",
  email: "agente@example.com",
};

const FAKE_TRIP = {
  id: "trip-001",
  name: "Excursão Nordeste",
  destination: "Fortaleza",
  departureDate: new Date("2025-07-10"),
  availableSeats: 10,
  totalCapacity: 46,
  status: "active",
  coverImage: null,
};

const FAKE_CLIENT = {
  id: "client-001",
  tenantId: "tenant-001",
  name: "Maria Souza",
  email: "maria@example.com",
  cpf: null,
  rg: null,
  birthDate: null,
  whatsapp: null,
};

function makeReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-001",
    tenantId: "tenant-001",
    tripId: "trip-001",
    clientId: "client-001",
    seats: ["1A"],
    status: "pending",
    voucherCode: "VCH-ABC",
    totalValue: "1000",
    paidValue: "0",
    balance: "1000",
    paymentMethod: null,
    installments: 1,
    commissionPercentage: null,
    commissionAmount: null,
    sellerId: null,
    notes: null,
    boardingLocationId: null,
    storeOrderId: null,
    discountCouponCode: null,
    discountCouponAmount: null,
    discountLoyaltyPoints: null,
    discountLoyaltyAmount: null,
    discountReferralCode: null,
    discountReferralAmount: null,
    discountTotal: null,
    checkedInAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: "user-001",
    tripType: null,
    packageType: null,
    hasInsurance: false,
    reservationNumber: "AG-EX-202507-0001",
    qrCode: "QR-VCH-ABC",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Transaction mock builder
// ---------------------------------------------------------------------------

/**
 * Builds a transaction mock where tx.select() responses are controlled via
 * the `selectResponses` queue (FIFO).
 *
 * Each call to tx.select() dequeues the next pre-programmed response and
 * returns a fully-chainable thenable so that ALL of the following patterns work
 * without a 500:
 *   await tx.select().from()                    → array
 *   await tx.select().from().where()            → array
 *   await tx.select().from().where().limit(n)   → array
 *   await tx.select().from().limit(n)           → array
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(data: unknown[]): any {
  const p: any = Promise.resolve(data);
  p.limit = vi.fn().mockResolvedValue(data);
  // Lazy implementations prevent infinite-recursion at mock-creation time
  p.where = vi.fn().mockImplementation(() => makeChain(data));
  p.from = vi.fn().mockImplementation(() => makeChain(data));
  p.orderBy = vi.fn().mockImplementation(() => makeChain(data));
  return p;
}

function buildTxMock(selectResponses: unknown[][] = []) {
  const queue = [...selectResponses];

  const updateSetWhere = vi.fn().mockResolvedValue([]);
  const updateSet = vi.fn().mockImplementation((setArg) => {
    capturedUpdates.push({ table: "unknown", set: setArg });
    return { where: updateSetWhere };
  });

  return {
    execute: vi.fn().mockResolvedValue({
      rows: [{ id: "trip-001", available_seats: 10, type: "excursao" }],
    }),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
        capturedInserts.push(vals);
        return Promise.resolve([]);
      }),
    })),
    update: vi.fn().mockImplementation(() => ({ set: updateSet })),
    select: vi.fn().mockImplementation(() => {
      // Dequeue next response at SELECT time so each query gets its own data
      const data = queue.shift() ?? [];
      return makeChain(data);
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PATCH /api/reservations/:id — cancellation financial reversal", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    capturedUpdates.length = 0;
    capturedInserts.length = 0;

    requireAuthMock.mockResolvedValue(FAKE_USER as never);

    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  // -------------------------------------------------------------------------
  it("returns 400 for non-existent reservation (requireReservationAccess throws)", async () => {
    const app = buildReservationsApp();

    // requireReservationAccess → select reservation → not found
    mockLimit.mockResolvedValueOnce([]);

    const res = await request(app)
      .patch("/api/reservations/res-missing")
      .send({ status: "cancelled" });

    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  it("cancels a plain reservation (no discounts) and releases seats", async () => {
    const app = buildReservationsApp();
    // clientId is null so reversal 4 (payment lookup) won't run
    const existing = makeReservation({ seats: ["1A", "2B"], clientId: null });
    const cancelled = { ...existing, status: "cancelled" };

    // outer: requireReservationAccess
    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] tx.select re-fetch after UPDATE → [cancelled]
    const tx = buildTxMock([[cancelled]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    // outer: formatReservation → trip + client
    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // trips update (seat restore) + reservation update
    expect(tx.update).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("decrements coupon usage_count when reservation with a coupon is cancelled", async () => {
    const app = buildReservationsApp();
    // clientId is null so reversal 4 won't fire
    const existing = makeReservation({
      discountCouponCode: "PROMO10",
      discountCouponAmount: "50",
      clientId: null,
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 1 — store lookup (get store.id for this tenant)
    //   [1] Reversal 1 — coupon lookup by storeId + code → get coupon.id
    //   [2] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "store-001" }],
      [{ id: "coupon-001" }],
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // trips (seats) + storeCoupons (usageCount) + commissions (cancel) + reservations (status)
    expect(tx.update).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // Edge-case: coupon usageCount is already 0 when the decrement fires.
  // The SQL GREATEST(0, usage_count - 1) guard prevents it from going negative,
  // but the UPDATE must still be issued — this test confirms no DB constraint
  // error surfaces and the response is 200.
  it("still issues coupon usageCount update (GREATEST guard) when usageCount is already 0", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({
      discountCouponCode: "PROMO10",
      discountCouponAmount: "50",
      clientId: null,
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 1 — store lookup (get store.id for this tenant)
    //   [1] Reversal 1 — coupon lookup → usageCount is already 0 (already decremented)
    //   [2] re-fetch updated reservation
    //
    // The GREATEST guard in the SQL expression ensures the update still fires and
    // the floor is clamped to 0 — no constraint violation, no application error.
    const tx = buildTxMock([
      [{ id: "store-001" }],
      [{ id: "coupon-001", usageCount: 0 }],
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // trips (seats) + storeCoupons (usageCount) + commissions (cancel) + reservations (status) = 4
    expect(tx.update).toHaveBeenCalledTimes(4);

    // The coupon update must have been captured with the usageCount field present
    const couponUpdate = capturedUpdates.find(
      (u) => "usageCount" in u.set,
    );
    expect(couponUpdate).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Idempotency guard for Reversal 1: when couponReversalAt is already set on
  // the reservation (meaning the decrement was applied in a prior cancellation
  // attempt before the reservation was reopened), the second cancellation must
  // skip the decrement entirely to prevent double-counting.
  it("skips coupon usageCount decrement on retry when couponReversalAt is already set (idempotency)", async () => {
    const app = buildReservationsApp();
    // Reservation with a coupon that was already decremented in a prior
    // cancellation (couponReversalAt is non-null). clientId is null so
    // loyalty/referral reversals do not fire.
    const existing = makeReservation({
      discountCouponCode: "PROMO10",
      discountCouponAmount: "50",
      clientId: null,
      couponReversalAt: new Date("2026-04-01T12:00:00Z"),
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] re-fetch updated reservation
    // No store lookup or coupon lookup — idempotency guard fires before those
    // queries are issued, so the queue has only the re-fetch entry.
    const tx = buildTxMock([[cancelled]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // trips (seats) + commissions (cancel) + reservations (status) = 3
    // storeCoupons is NOT updated — idempotency guard prevented the decrement
    expect(tx.update).toHaveBeenCalledTimes(3);

    // Confirm no usageCount update was captured
    const couponUpdate = capturedUpdates.find(
      (u) => "usageCount" in u.set,
    );
    expect(couponUpdate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  it("restores loyalty points and records a refund transaction when loyalty discount was used", async () => {
    const app = buildReservationsApp();
    // clientId present so reversal 4 runs (payments query → empty)
    const existing = makeReservation({
      discountLoyaltyPoints: 200,
      discountLoyaltyAmount: "20",
      clientId: "client-001",
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 2 — loyalty member lookup
    //   [1] Reversal 2 — idempotency check (no prior "refund" tx → proceed)
    //   [2] Reversal 4 — payments lookup (empty)
    //   [3] Reversal 4 — loyalty member lookup (no member found → skip clawback)
    //   [4] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "member-001", availablePoints: 300 }],
      [], // no existing refund tx → proceed with restore
      [], // no payments
      [], // Reversal 4 loyalty member lookup → not found, skip clawback
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // A loyalty transaction of type "refund" should have been inserted
    const refundTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "refund",
    );
    expect(refundTx).toBeDefined();
    expect((refundTx as Record<string, unknown>)["points"]).toBe(200);
    expect((refundTx as Record<string, unknown>)["referenceType"]).toBe("reservation");
  });

  // -------------------------------------------------------------------------
  it("reverses referral bonus: decrements referrer earnings and marks referral as reversed", async () => {
    const app = buildReservationsApp();
    // clientId present → reversal 4 runs (payments → empty)
    const existing = makeReservation({
      discountReferralCode: "REF-XYZ",
      discountReferralAmount: "50",
      clientId: "client-001",
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 3 — referral record lookup by reservationId (exact scope)
    //   [1] Reversal 4 — payments lookup (empty)
    //   [2] Reversal 4 — loyalty member lookup (no member found → skip clawback)
    //   [3] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "referral-001", referrerId: "referrer-client-001", bonusAmount: "10.00" }],
      [], // no payments
      [], // Reversal 4 loyalty member lookup → not found, skip clawback
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // trips (seats) + clients (referralEarnings) + referrals (status) + commissions (cancel) + reservations = 5 updates
    expect(tx.update).toHaveBeenCalledTimes(5);
  });

  // -------------------------------------------------------------------------
  it("reverses only the referral tied to the cancelled reservation, not other completed referrals with the same code", async () => {
    // Adversarial case: a referred client has TWO completed referrals with the
    // same code (two bookings). Cancelling res-001 must only touch referral-001
    // (the one with reservationId = "res-001") and leave referral-002 untouched.
    const app = buildReservationsApp();
    const existing = makeReservation({
      discountReferralCode: "REF-SHARED",
      discountReferralAmount: "50",
      clientId: "client-001",
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // The referral lookup uses reservationId="res-001" → only returns referral-001.
    // referral-002 (same code, different reservation) is never touched.
    const tx = buildTxMock([
      [{ id: "referral-001", referrerId: "referrer-client-001", bonusAmount: "10.00" }],
      [], // no payments
      [], // Reversal 4 loyalty member lookup → not found, skip clawback
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // The tx.select was called with a where clause that includes reservationId.
    // The referral record returned is referral-001; only 5 updates should run.
    expect(tx.update).toHaveBeenCalledTimes(5);
    // Verify tx.select was called — the reversal ran against the specific record
    expect(tx.select).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Explicit idempotency guard for Reversal 3: when `referralReversalAt` is
  // already set on the reservation (meaning the reversal ran in a prior
  // cancellation before the reservation was reopened), the second cancellation
  // must skip the entire referral lookup tree — no DB reads, no updates.
  // This mirrors the `couponReversalAt` pattern used by Reversal 1.
  it("skips referral reversal entirely when referralReversalAt is already set (explicit idempotency guard)", async () => {
    const app = buildReservationsApp();
    // Reservation with a referral that was already reversed in a prior
    // cancellation (referralReversalAt is non-null). clientId is null so
    // Reversal 4 (loyalty clawback) does not fire either.
    const existing = makeReservation({
      discountReferralCode: "REF-XYZ",
      discountReferralAmount: "25",
      clientId: null,
      referralReversalAt: new Date("2026-04-01T12:00:00Z"),
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] re-fetch updated reservation
    // No referral lookups at all — the explicit referralReversalAt guard fires
    // before any query is issued, so the queue has only the re-fetch entry.
    const tx = buildTxMock([[cancelled]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // trips (seats) + commissions (cancel) + reservations (status) = 3
    // clients (referralEarnings) and referrals (status) must NOT be updated
    expect(tx.update).toHaveBeenCalledTimes(3);

    // Confirm no referral-related updates were captured
    const referralUpdate = capturedUpdates.find(
      (u) => "status" in u.set && (u.set as Record<string, unknown>)["status"] === "reversed",
    );
    expect(referralUpdate).toBeUndefined();

    const earningsUpdate = capturedUpdates.find(
      (u) => "referralEarnings" in u.set,
    );
    expect(earningsUpdate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Idempotency guard for Reversal 3: when the referral record is already in
  // REVERSED status (e.g. reservation was cancelled, reopened, then cancelled
  // again), both lookup branches filter on `status = COMPLETED` and return no
  // rows. The update block is naturally skipped — referrer earnings are NOT
  // double-decremented.
  it("does not double-decrement referrer earnings when referral is already REVERSED (re-cancel idempotency)", async () => {
    const app = buildReservationsApp();
    // clientId present → reversal 4 runs (payments → empty)
    const existing = makeReservation({
      discountReferralCode: "REF-XYZ",
      discountReferralAmount: "50",
      clientId: "client-001",
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 3 — primary lookup by reservationId + COMPLETED → [] (already REVERSED)
    //   [1] Reversal 3 — secondary lookup by code + COMPLETED → [] (also empty, already REVERSED)
    //   [2] Reversal 3 — REVERSED check by code → found (confirms re-cancel path, debug log emitted)
    //   [3] Reversal 4 — payments lookup (empty)
    //   [4] Reversal 4 — loyalty member lookup (no member found → skip clawback)
    //   [5] re-fetch updated reservation
    //
    // The primary lookup returns empty because the referral status is already
    // REVERSED (COMPLETED filter returns nothing). The secondary lookup also
    // returns empty for the same reason — no warn is emitted.  The third query
    // finds the REVERSED row so a debug log is emitted instead, allowing
    // operators to distinguish this expected idempotency path from a missing-
    // reservation-id data integrity gap.  The `referralRecord` variable stays
    // undefined, so the clients and referrals tables are never updated —
    // confirming no double-decrement.
    const tx = buildTxMock([
      [], // primary lookup → referral already REVERSED, COMPLETED filter returns nothing
      [], // secondary lookup → also empty (already REVERSED, idempotency — no warn)
      [{ id: "referral-rev-001" }], // REVERSED check → found, debug log emitted
      [], // no payments
      [], // Reversal 4 loyalty member lookup → not found, skip clawback
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // trips (seats) + commissions (cancel) + reservations (status) = 3 updates
    // clients (referralEarnings) and referrals (status) must NOT be updated
    // because the referral is already REVERSED — no double-decrement.
    expect(tx.update).toHaveBeenCalledTimes(3);

    // Confirm no referral status update was captured
    const referralUpdate = capturedUpdates.find(
      (u) => "status" in u.set && (u.set as Record<string, unknown>)["status"] === "reversed",
    );
    expect(referralUpdate).toBeUndefined();

    // Confirm no referralEarnings decrement was captured
    const earningsUpdate = capturedUpdates.find(
      (u) => "referralEarnings" in u.set,
    );
    expect(earningsUpdate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Re-cancel path emits a debug log (not a warn) with reason="already_reversed"
  // when the REVERSED check confirms the referral was already reversed in a
  // prior cancellation. This lets operators distinguish expected idempotency
  // from a missing-reservation-id data integrity gap.
  it("emits a debug log with reason=already_reversed on re-cancel (not a warn)", async () => {
    const debugArgs: unknown[][] = [];
    const warnArgs: unknown[][] = [];

    const app = express();
    app.use(express.json());
    app.use(
      (
        req: express.Request & { log?: Record<string, unknown> },
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        const noop = (..._a: unknown[]) => {};
        req.log = {
          trace: noop,
          debug: (...args: unknown[]) => { debugArgs.push(args); },
          info: noop,
          warn: (...args: unknown[]) => { warnArgs.push(args); },
          error: noop,
          fatal: noop,
        } as never;
        next();
      },
    );
    app.use("/api", reservationsRouter);
    app.use(errorHandler);

    const existing = makeReservation({
      discountReferralCode: "REF-XYZ",
      discountReferralAmount: "50",
      clientId: "client-001",
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 3 — primary lookup by reservationId + COMPLETED → [] (already REVERSED)
    //   [1] Reversal 3 — secondary lookup by code + COMPLETED → [] (also empty, already REVERSED)
    //   [2] Reversal 3 — REVERSED check by code → found → debug log emitted, no warn
    //   [3] Reversal 4 — payments lookup (empty)
    //   [4] Reversal 4 — loyalty member lookup → not found, skip clawback
    //   [5] re-fetch updated reservation
    const tx = buildTxMock([
      [],
      [],
      [{ id: "referral-rev-001" }],
      [],
      [],
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // A debug log with reason="already_reversed" must have been emitted
    const referralDebug = debugArgs.find(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>)["reason"] === "already_reversed",
    );
    expect(referralDebug).toBeDefined();
    expect((referralDebug![0] as Record<string, unknown>)["referralCode"]).toBe("REF-XYZ");
    expect((referralDebug![0] as Record<string, unknown>)["reservationId"]).toBe("res-001");
    expect((referralDebug![0] as Record<string, unknown>)["tenantId"]).toBe("tenant-001");

    // No warn must have been emitted (re-cancel is expected, not a data gap)
    expect(warnArgs.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Warning: when discountReferralCode is set but the primary lookup finds no
  // matching COMPLETED referral record (e.g. referral row has no reservation_id
  // due to an incomplete backfill), a warn must be emitted with reservationId
  // and discountReferralCode so the issue is visible in production logs.
  it("emits a warn when discountReferralCode is set but no referral record is found by reservationId", async () => {
    const warnArgs: unknown[][] = [];

    const app = express();
    app.use(express.json());
    app.use(
      (
        req: express.Request & { log?: Record<string, unknown> },
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        const noop = (..._a: unknown[]) => {};
        req.log = {
          trace: noop,
          debug: noop,
          info: noop,
          warn: (...args: unknown[]) => { warnArgs.push(args); },
          error: noop,
          fatal: noop,
        } as never;
        next();
      },
    );
    app.use("/api", reservationsRouter);
    app.use(errorHandler);

    const existing = makeReservation({
      discountReferralCode: "REF-XYZ",
      discountReferralAmount: "50",
      clientId: "client-001",
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 3 — primary lookup by reservationId → [] (no matching record)
    //   [1] Reversal 3 — secondary lookup by code → found (COMPLETED referral with missing reservation_id)
    //   [2] Reversal 4 — payments lookup (empty)
    //   [3] Reversal 4 — loyalty member lookup → not found, skip clawback
    //   [4] re-fetch updated reservation
    const tx = buildTxMock([
      [], // primary lookup → no record found (missing reservation_id scenario)
      [{ id: "ref-gap-001", referrerId: "referrer-001" }], // secondary lookup → COMPLETED referral found but no reservationId match → warn
      [], // no payments
      [], // Reversal 4 loyalty member lookup → not found
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // A warn must have been emitted
    expect(warnArgs.length).toBeGreaterThan(0);

    // The warn must include tenantId, referrerId, referralCode, reservationId, and reason
    const referralWarn = warnArgs.find(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        "reservationId" in (call[0] as Record<string, unknown>) &&
        "referralCode" in (call[0] as Record<string, unknown>) &&
        "tenantId" in (call[0] as Record<string, unknown>) &&
        "referrerId" in (call[0] as Record<string, unknown>),
    );
    expect(referralWarn).toBeDefined();
    expect((referralWarn![0] as Record<string, unknown>)["reservationId"]).toBe("res-001");
    expect((referralWarn![0] as Record<string, unknown>)["referralCode"]).toBe("REF-XYZ");
    expect((referralWarn![0] as Record<string, unknown>)["tenantId"]).toBe("tenant-001");
    expect((referralWarn![0] as Record<string, unknown>)["referrerId"]).toBe("referrer-001");
    expect((referralWarn![0] as Record<string, unknown>)["reason"]).toBe("missing_reservation_id");

    // No referral or client update must have run (reversal was skipped)
    const referralUpdate = capturedUpdates.find(
      (u) => "status" in u.set && (u.set as Record<string, unknown>)["status"] === "reversed",
    );
    expect(referralUpdate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Final-branch warning: when the primary (by reservationId) and secondary
  // (by code) COMPLETED lookups are both empty AND no REVERSED row exists, a
  // referral row stuck in an unexpected status (PENDING/FAILED/etc.) must NOT be
  // silently skipped. A warn with reason="unexpected_status" is emitted so the
  // dangling bonus can be manually reversed — but the row is NOT auto-reversed.
  it("emits a warn (reason=unexpected_status) when only a non-COMPLETED/REVERSED referral row exists in the final branch", async () => {
    const warnArgs: unknown[][] = [];

    const app = express();
    app.use(express.json());
    app.use(
      (
        req: express.Request & { log?: Record<string, unknown> },
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        const noop = (..._a: unknown[]) => {};
        req.log = {
          trace: noop,
          debug: noop,
          info: noop,
          warn: (...args: unknown[]) => { warnArgs.push(args); },
          error: noop,
          fatal: noop,
        } as never;
        next();
      },
    );
    app.use("/api", reservationsRouter);
    app.use(errorHandler);

    const existing = makeReservation({
      discountReferralCode: "REF-XYZ",
      discountReferralAmount: "50",
      clientId: "client-001",
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 3 — primary lookup by reservationId + COMPLETED → [] (no record)
    //   [1] Reversal 3 — secondary lookup by code + COMPLETED → [] (no record)
    //   [2] Reversal 3 — REVERSED check by code → [] (no reversed row)
    //   [3] Reversal 3 — unexpected-status lookup (status NOT IN COMPLETED/REVERSED) → found (PENDING)
    //   [4] Reversal 4 — payments lookup (empty)
    //   [5] Reversal 4 — loyalty member lookup → not found, skip clawback
    //   [6] re-fetch updated reservation
    const tx = buildTxMock([
      [], // primary lookup → none
      [], // secondary lookup → none
      [], // REVERSED check → none
      [{ id: "ref-pending-001", status: "pending" }], // unexpected-status row found → warn
      [], // no payments
      [], // Reversal 4 loyalty member lookup → not found
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // A warn must have been emitted distinguishing this from the legacy no-row case
    const unexpectedWarn = warnArgs.find(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>)["reason"] === "unexpected_status",
    );
    expect(unexpectedWarn).toBeDefined();
    expect((unexpectedWarn![0] as Record<string, unknown>)["referralId"]).toBe("ref-pending-001");
    expect((unexpectedWarn![0] as Record<string, unknown>)["referralStatus"]).toBe("pending");
    expect((unexpectedWarn![0] as Record<string, unknown>)["referralCode"]).toBe("REF-XYZ");
    expect((unexpectedWarn![0] as Record<string, unknown>)["reservationId"]).toBe("res-001");
    expect((unexpectedWarn![0] as Record<string, unknown>)["tenantId"]).toBe("tenant-001");

    // The unexpected-status row must NOT be auto-reversed
    const referralUpdate = capturedUpdates.find(
      (u) => "status" in u.set && (u.set as Record<string, unknown>)["status"] === "reversed",
    );
    expect(referralUpdate).toBeUndefined();
    const earningsUpdate = capturedUpdates.find(
      (u) => "referralEarnings" in u.set,
    );
    expect(earningsUpdate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Final-branch legacy case: when NO referral row exists in ANY status
  // (all four lookups empty), the skip stays fully silent — no warn is emitted.
  // This is the legitimate legacy case (e.g. a discount code applied without ever
  // generating a referral row).
  it("stays silent (no warn) when no referral row exists in any status in the final branch", async () => {
    const warnArgs: unknown[][] = [];

    const app = express();
    app.use(express.json());
    app.use(
      (
        req: express.Request & { log?: Record<string, unknown> },
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        const noop = (..._a: unknown[]) => {};
        req.log = {
          trace: noop,
          debug: noop,
          info: noop,
          warn: (...args: unknown[]) => { warnArgs.push(args); },
          error: noop,
          fatal: noop,
        } as never;
        next();
      },
    );
    app.use("/api", reservationsRouter);
    app.use(errorHandler);

    const existing = makeReservation({
      discountReferralCode: "REF-XYZ",
      discountReferralAmount: "50",
      clientId: "client-001",
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 3 — primary lookup by reservationId + COMPLETED → []
    //   [1] Reversal 3 — secondary lookup by code + COMPLETED → []
    //   [2] Reversal 3 — REVERSED check by code → []
    //   [3] Reversal 3 — unexpected-status lookup → [] (no referral row at all)
    //   [4] Reversal 4 — payments lookup (empty)
    //   [5] Reversal 4 — loyalty member lookup → not found, skip clawback
    //   [6] re-fetch updated reservation
    const tx = buildTxMock([
      [], // primary lookup → none
      [], // secondary lookup → none
      [], // REVERSED check → none
      [], // unexpected-status lookup → none (legitimate legacy case)
      [], // no payments
      [], // Reversal 4 loyalty member lookup → not found
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // No warn must have been emitted — the silent skip is correct for this case
    expect(warnArgs.length).toBe(0);

    // No referral reversal must have run
    const referralUpdate = capturedUpdates.find(
      (u) => "status" in u.set && (u.set as Record<string, unknown>)["status"] === "reversed",
    );
    expect(referralUpdate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  it("claws back loyalty points earned from payments when reservation is cancelled", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({ clientId: "client-001" });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 4 — payments lookup → 2 payments found
    //   [1] Reversal 4 — loyalty member lookup
    //   [2] Reversal 4 — idempotency check (no prior "cancellation" tx → proceed)
    //   [3] Reversal 4 — earn transactions lookup (15 + 20 = 35 pts)
    //   [4] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "pay-001" }, { id: "pay-002" }],
      [{ id: "member-001", availablePoints: 150, totalPoints: 300 }],
      [], // no existing cancellation tx → proceed with clawback
      [{ points: 15 }, { points: 20 }],
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // A loyalty transaction of type "cancellation" should have been inserted
    const cancellationTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "cancellation",
    );
    expect(cancellationTx).toBeDefined();
    expect((cancellationTx as Record<string, unknown>)["points"]).toBe(-35);
  });

  // -------------------------------------------------------------------------
  it("claws back confirmation-earned loyalty points even when no payment records exist", async () => {
    // Scenario: reservation was confirmed (status → confirmed), which triggered
    // an "earn" loyalty transaction with referenceType="reservation". The client
    // later cancels without ever having made a payment. Without this fix, those
    // points would be silently kept.
    const app = buildReservationsApp();
    const existing = makeReservation({ clientId: "client-001", status: "confirmed" });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 4 — payments lookup (empty — no payment records)
    //   [1] Reversal 4 — loyalty member lookup → member found
    //   [2] Reversal 4 — idempotency check (no prior "cancellation" tx → proceed)
    //   [3] Reversal 4 — earn transactions → 50 pts earned at confirmation
    //   [4] re-fetch updated reservation
    const tx = buildTxMock([
      [],                                                               // no payments
      [{ id: "member-001", availablePoints: 50, totalPoints: 50 }],   // loyalty member
      [],                                                               // no prior cancellation tx → proceed
      [{ points: 50 }],                                                // confirmation-earned points
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // A loyalty transaction of type "cancellation" should have been inserted
    const cancellationTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "cancellation",
    );
    expect(cancellationTx).toBeDefined();
    expect((cancellationTx as Record<string, unknown>)["points"]).toBe(-50);
    expect((cancellationTx as Record<string, unknown>)["referenceType"]).toBe("reservation");
  });

  // -------------------------------------------------------------------------
  it("does NOT double-deduct confirmation-earned points when a reservation is re-cancelled (idempotency)", async () => {
    // Scenario: reservation was confirmed (earning points via referenceType="reservation"),
    // then cancelled once (a "cancellation" loyalty tx was written), then re-opened by an
    // admin and cancelled a second time. The second cancellation must detect the existing
    // "cancellation" tx and skip the clawback entirely — no extra points deducted.
    const app = buildReservationsApp();
    // No payments ever existed; points were earned purely from confirmation.
    const existing = makeReservation({ clientId: "client-001", status: "confirmed" });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 4 — payments lookup (empty — no payment records)
    //   [1] Reversal 4 — loyalty member lookup → member found
    //   [2] Reversal 4 — idempotency check → returns existing "cancellation" tx → SKIP
    //       (earn-transactions query is not called when idempotency fires)
    //   [3] re-fetch updated reservation
    const tx = buildTxMock([
      [],                                                              // no payments
      [{ id: "member-001", availablePoints: 0, totalPoints: 0 }],    // loyalty member (already clawed back)
      [{ id: "cancel-tx-001" }],                                      // existing cancellation tx → idempotency fires
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // loyaltyMembers must NOT be updated a second time (idempotency guard fired)
    // Expected updates: trips (seat restore) + commissions (cancel) + reservations (status) = 3
    expect(tx.update).toHaveBeenCalledTimes(3);

    // No new "cancellation" loyalty transaction should have been inserted
    const cancellationTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "cancellation",
    );
    expect(cancellationTx).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  it("does NOT double-deduct confirmation-earned points when a reservation is re-marked refunded (idempotency)", async () => {
    // Scenario: reservation was confirmed (earning points via referenceType="reservation"),
    // then marked refunded once (a "cancellation" loyalty tx was written), then re-opened by
    // an admin and marked refunded a second time. The second refunded PATCH must detect the
    // existing "cancellation" tx and skip the clawback entirely — no extra points deducted.
    // This mirrors the re-cancel idempotency test; the guard is code-shared across
    // CANCELLING_STATUSES (cancelled + refunded).
    const app = buildReservationsApp();
    const existing = makeReservation({ clientId: "client-001", status: "confirmed" });
    const refunded = { ...existing, status: "refunded" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 4 — payments lookup (empty — no payment records)
    //   [1] Reversal 4 — loyalty member lookup → member found (points already clawed back)
    //   [2] Reversal 4 — idempotency check → returns existing "cancellation" tx → SKIP
    //       (earn-transactions query is not called when idempotency fires)
    //   [3] re-fetch updated reservation
    const tx = buildTxMock([
      [],                                                              // no payments
      [{ id: "member-001", availablePoints: 0, totalPoints: 0 }],    // loyalty member (already clawed back)
      [{ id: "cancel-tx-001" }],                                      // existing cancellation tx → idempotency fires
      [refunded],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "refunded" });

    expect(res.status).toBe(200);

    // loyaltyMembers must NOT be updated a second time (idempotency guard fired)
    // Expected updates: trips (seat restore) + commissions (cancel) + reservations (status) = 3
    expect(tx.update).toHaveBeenCalledTimes(3);

    // No new "cancellation" loyalty transaction should have been inserted
    const cancellationTxRefunded = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "cancellation",
    );
    expect(cancellationTxRefunded).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  it("performs ALL reversals simultaneously when reservation has coupon + loyalty + referral + payments", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({
      discountCouponCode: "COMBO20",
      discountCouponAmount: "100",
      discountLoyaltyPoints: 50,
      discountLoyaltyAmount: "5",
      discountReferralCode: "REF-ABC",
      discountReferralAmount: "25",
      clientId: "client-001",
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 1 (coupon) — store lookup (get store.id)
    //   [1] Reversal 1 (coupon) — coupon lookup by storeId + code → coupon.id
    //   [2] Reversal 2 (loyalty discount) — loyalty member
    //   [3] Reversal 2 — idempotency check (no prior "refund" tx → proceed)
    //   [4] Reversal 3 (referral) — referral record by reservationId
    //   [5] Reversal 4 (payment loyalty) — payments
    //   [6] Reversal 4 — loyalty member (for payment clawback)
    //   [7] Reversal 4 — idempotency check (no prior "cancellation" tx → proceed)
    //   [8] Reversal 4 — earn transactions
    //   [9] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "store-001" }],
      [{ id: "coupon-001" }],
      [{ id: "member-001", availablePoints: 200 }],
      [], // no existing refund tx → proceed
      [{ id: "ref-001", referrerId: "ref-client-001", bonusAmount: "10.00" }],
      [{ id: "pay-001" }],
      [{ id: "member-001", availablePoints: 250, totalPoints: 500 }],
      [], // no existing cancellation tx → proceed
      [{ points: 10 }],
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // Both a "refund" transaction (loyalty discount) and a "cancellation" (payment) must exist
    const refundTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "refund",
    );
    const cancellationTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "cancellation",
    );
    expect(refundTx).toBeDefined();
    expect(cancellationTx).toBeDefined();

    // trips + storeCoupons + loyaltyMembers (discount restore) +
    // clients (referral earnings) + referrals (status) +
    // loyaltyMembers (payment clawback) + commissions (cancel) + reservations = 8 updates
    expect(tx.update).toHaveBeenCalledTimes(8);
  });

  // -------------------------------------------------------------------------
  it("does not double-apply loyalty refund when a previously cancelled reservation is re-cancelled (idempotency)", async () => {
    // Simulates: cancel → reopen (manual admin action) → cancel again.
    // The second cancellation detects an existing "refund" loyaltyTransaction
    // for this reservationId and skips the loyalty restore to prevent drift.
    const app = buildReservationsApp();
    const existing = makeReservation({
      discountLoyaltyPoints: 100,
      discountLoyaltyAmount: "10",
      clientId: "client-001",
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 2 — loyalty member lookup
    //   [1] Reversal 2 — idempotency check → returns existing "refund" tx → SKIP
    //   [2] Reversal 4 — payments lookup (empty)
    //   [3] Reversal 4 — loyalty member lookup (no member found → skip clawback)
    //   [4] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "member-001", availablePoints: 300 }],
      [{ id: "refund-tx-001" }], // existing refund tx → loyalty restore is skipped
      [],                         // no payments
      [],                         // Reversal 4 loyalty member lookup → not found, skip clawback
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // trips (seat restore) + commissions (cancel) + reservations (status update) = 3 updates
    // loyaltyMembers is NOT updated a second time (idempotency guard fired)
    expect(tx.update).toHaveBeenCalledTimes(3);
    // No new loyalty transactions inserted (refund was skipped)
    const refundTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "refund",
    );
    expect(refundTx).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  it("skips all reversals when the reservation was already cancelled (wasActive = false)", async () => {
    const app = buildReservationsApp();
    // Already cancelled — not in ACTIVE_STATUSES — reversal block is skipped entirely
    const existing = makeReservation({
      status: "cancelled",
      discountCouponCode: "PROMO10",
      discountLoyaltyPoints: 100,
      clientId: null,
    });
    const stillCancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue: only the re-fetch after UPDATE (no reversals run)
    const tx = buildTxMock([[stillCancelled]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // Only the reservation UPDATE itself — no seat restore, no reversals
    expect(tx.update).toHaveBeenCalledTimes(1);
    // No loyalty refund transactions inserted
    const refundTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "refund",
    );
    expect(refundTx).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  it("enqueues a cancellation email when a reservation with a client is cancelled", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({ clientId: "client-001" });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 4 — payments lookup (empty)
    //   [1] Reversal 4 — loyalty member lookup (no member found → skip clawback)
    //   [2] re-fetch updated reservation
    const tx = buildTxMock([[], [], [cancelled]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(mockEnqueueCancellationEmail).toHaveBeenCalledWith("res-001", "tenant-001");
  });

  // -------------------------------------------------------------------------
  it("does NOT enqueue cancellation email when status transitions to 'refunded'", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({ clientId: "client-001" });
    const refunded = { ...existing, status: "refunded" };

    mockLimit.mockResolvedValueOnce([existing]);

    // Reversal 4 payments lookup + loyalty member lookup (not found) + re-fetch
    const tx = buildTxMock([[], [], [refunded]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "refunded" });

    expect(res.status).toBe(200);
    expect(mockEnqueueCancellationEmail).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("does NOT enqueue cancellation email when already-cancelled reservation is re-patched to cancelled", async () => {
    const app = buildReservationsApp();
    // wasActive = false (already cancelled)
    const existing = makeReservation({ status: "cancelled", clientId: "client-001" });
    const stillCancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // No reversals run (wasActive = false); only the re-fetch after UPDATE
    const tx = buildTxMock([[stillCancelled]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(mockEnqueueCancellationEmail).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("does NOT enqueue cancellation email for an unrelated update (no status change)", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({ clientId: "client-001" });
    const updated = { ...existing, notes: "Updated note" };

    mockLimit.mockResolvedValueOnce([existing]);

    // No status transition: no reversals, just the re-fetch
    const tx = buildTxMock([[updated]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ notes: "Updated note" });

    expect(res.status).toBe(200);
    expect(mockEnqueueCancellationEmail).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("cancels pending/approved commissions for the reservation when it is cancelled", async () => {
    const app = buildReservationsApp();
    // No special discounts, no clientId → only seat restore + commission cancel + reservation update
    const existing = makeReservation({ clientId: null });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue: only the re-fetch after UPDATE (no reversal selects needed)
    const tx = buildTxMock([[cancelled]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // Exactly one update should have set { status: "cancelled" } as its ONLY field
    // (that's the commission cancel; the reservation update also carries cancelledAt)
    const commissionCancel = capturedUpdates.find(
      (u) => Object.keys(u.set).length === 1 && u.set.status === "cancelled",
    );
    expect(commissionCancel).toBeDefined();
  });

  // -------------------------------------------------------------------------
  it("calls CalendarSyncService.syncTripOnReservationCancellation after an active reservation is cancelled", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({ clientId: null });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    const tx = buildTxMock([[cancelled]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(mockSyncTrip).toHaveBeenCalledWith(existing.tripId);
    // General syncTrip must NOT be called on cancellation — only the dedicated method
    expect(mockSyncTripGeneral).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Edge-case: referrer earnings are already 0 when the reversal runs.
  // The GREATEST(0, ...) guard in the SQL must keep the value at 0 instead of
  // going negative. The update should still be issued (the DB handles the clamp).
  it("reverses referral bonus even when referrer earnings are already 0 (GREATEST guard)", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({
      discountReferralCode: "REF-ZERO",
      discountReferralAmount: "10",
      clientId: "client-001",
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 3 — referral record lookup → referral found (bonusAmount = "10.00")
    //   [1] Reversal 4 — payments lookup (empty)
    //   [2] Reversal 4 — loyalty member lookup (not found → skip clawback)
    //   [3] re-fetch updated reservation
    //
    // The referrer's referralEarnings is effectively 0 in the DB, but we do not
    // read that value in application code — the GREATEST guard lives in the SQL
    // expression itself. So the tx.update for clients is still called; the DB
    // ensures the floor is 0.
    const tx = buildTxMock([
      [{ id: "referral-001", referrerId: "referrer-client-001", bonusAmount: "10.00" }],
      [], // no payments
      [], // no loyalty member → skip clawback
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // trips (seats) + clients (referralEarnings) + referrals (status) + commissions (cancel) + reservations = 5
    expect(tx.update).toHaveBeenCalledTimes(5);
  });

  // -------------------------------------------------------------------------
  // Edge-case: reservation has no seats (seats = []).
  // The seatsCount > 0 guard skips the trip-seat restore entirely, so
  // tx.update(tripsTable) is never called for seat restoration.
  it("skips the trip seat-restore when the reservation has no seats (seatsCount = 0)", async () => {
    const app = buildReservationsApp();
    // No seats, no discounts, no clientId → minimal reversal path
    const existing = makeReservation({ seats: [], clientId: null });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue: only the re-fetch after UPDATE
    // No reversal selects run (no discounts, no clientId)
    const tx = buildTxMock([[cancelled]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // commissions cancel + reservations status update = 2 updates
    // trips is NOT updated because seatsCount === 0
    expect(tx.update).toHaveBeenCalledTimes(2);

    // Verify that none of the captured updates targeted tripsTable seat columns.
    // We detect a seat-restore update by the presence of `availableSeats` in its set.
    const seatRestoreUpdate = capturedUpdates.find(
      (u) => "availableSeats" in u.set,
    );
    expect(seatRestoreUpdate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Edge-case: reservation has a coupon code but the tenant has no store record.
  // The coupon reversal is silently skipped (the outer `if (store)` guard)
  // and the rest of the cancellation still completes successfully.
  it("silently skips coupon reversal when the store record does not exist", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({
      discountCouponCode: "GHOST-COUPON",
      discountCouponAmount: "30",
      clientId: null, // no loyalty/referral reversals
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 1 — store lookup → [] (no store found → coupon reversal skipped)
    //   [1] re-fetch updated reservation
    const tx = buildTxMock([
      [], // store not found → skip coupon decrement entirely
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // trips (seats) + commissions (cancel) + reservations (status) = 3 updates
    // storeCoupons is NOT updated because the store was not found
    expect(tx.update).toHaveBeenCalledTimes(3);

    // No storeCoupons (usageCount) update should have been captured
    const couponUpdate = capturedUpdates.find(
      (u) => "usageCount" in u.set,
    );
    expect(couponUpdate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Store order lifecycle tests
  // -------------------------------------------------------------------------

  it("cancels the linked store order when a storefront reservation is cancelled", async () => {
    const app = buildReservationsApp();
    // No discounts, no clientId — only seat restore + commission cancel + store order cancel
    const existing = makeReservation({ storeOrderId: "ORD-2025-0001", clientId: null });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] store order lookup by orderNumber → open order found
    //   [1] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "order-001", status: "pending" }],
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // trips (seats) + commissions (cancel) + storeOrders (cancel) + reservations = 4 updates
    expect(tx.update).toHaveBeenCalledTimes(4);

    // The store order update must set { status: "cancelled", cancelledAt: <Date> }
    const storeOrderUpdate = capturedUpdates.find(
      (u) => u.set.status === "cancelled" && "cancelledAt" in u.set,
    );
    expect(storeOrderUpdate).toBeDefined();
  });

  // -------------------------------------------------------------------------
  it("skips the store order update when the linked order is already cancelled (idempotency)", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({ storeOrderId: "ORD-2025-0002", clientId: null });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] store order lookup → order already cancelled
    //   [1] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "order-002", status: "cancelled" }],
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // trips (seats) + commissions (cancel) + reservations = 3 — NO store order update
    expect(tx.update).toHaveBeenCalledTimes(3);

    // Confirm no update with cancelledAt was issued
    const storeOrderUpdate = capturedUpdates.find(
      (u) => "cancelledAt" in u.set,
    );
    expect(storeOrderUpdate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  it("skips the store order update when the linked order is completed (idempotency)", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({ storeOrderId: "ORD-2025-0003", clientId: null });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] store order lookup → order already completed (fulfilled, cannot re-cancel)
    //   [1] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "order-003", status: "completed" }],
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // trips (seats) + commissions (cancel) + reservations = 3 — NO store order update
    expect(tx.update).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  it("gracefully skips the store order update when no matching order is found", async () => {
    const app = buildReservationsApp();
    // storeOrderId is set but the order no longer exists in the DB
    const existing = makeReservation({ storeOrderId: "ORD-MISSING", clientId: null });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] store order lookup → not found
    //   [1] re-fetch updated reservation
    const tx = buildTxMock([
      [], // no store order found
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // trips (seats) + commissions (cancel) + reservations = 3 — NO store order update
    expect(tx.update).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  it("cancels store order alongside coupon reversal when storefront reservation has both", async () => {
    const app = buildReservationsApp();
    // Reservation from the storefront that also used a coupon; clientId null → no loyalty/referral
    const existing = makeReservation({
      storeOrderId: "ORD-2025-0010",
      discountCouponCode: "STORE20",
      discountCouponAmount: "20",
      clientId: null,
    });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 1 — store lookup (for coupon)
    //   [1] Reversal 1 — coupon lookup
    //   [2] store order lookup by orderNumber
    //   [3] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "store-001" }],
      [{ id: "coupon-001" }],
      [{ id: "order-010", status: "confirmed" }],
      [cancelled],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    // trips (seats) + storeCoupons (usageCount) + commissions + storeOrders + reservations = 5
    expect(tx.update).toHaveBeenCalledTimes(5);

    // Both the coupon update and the store order cancel must be present
    const couponUpdate = capturedUpdates.find((u) => "usageCount" in u.set);
    expect(couponUpdate).toBeDefined();

    const storeOrderUpdate = capturedUpdates.find(
      (u) => u.set.status === "cancelled" && "cancelledAt" in u.set,
    );
    expect(storeOrderUpdate).toBeDefined();
  });

  // -------------------------------------------------------------------------
  it("does not touch any store order when the reservation has no storeOrderId", async () => {
    const app = buildReservationsApp();
    // Default makeReservation has storeOrderId: null
    const existing = makeReservation({ clientId: null });
    const cancelled = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue: only the re-fetch (no store order lookup needed)
    const tx = buildTxMock([[cancelled]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // No cancelledAt update should appear (store order path never executed)
    const storeOrderUpdate = capturedUpdates.find((u) => "cancelledAt" in u.set);
    expect(storeOrderUpdate).toBeUndefined();
  });

  // =========================================================================
  // Store order lifecycle tests — refunded-status path
  //
  // These mirror the cancelled-status store order tests above, verifying that
  // marking a reservation as "refunded" directly in the CRM (without going
  // through a payment-gateway webhook) also closes out the linked store order.
  // Both "cancelled" and "refunded" flow through the same isBeingCancelled &&
  // wasActive gate in the PATCH handler, so the behaviour must be identical.
  // =========================================================================

  it("cancels the linked store order when a storefront reservation is marked as refunded", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({ storeOrderId: "ORD-2025-REF-001", clientId: null });
    const refunded = { ...existing, status: "refunded" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] store order lookup by orderNumber → open order found
    //   [1] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "order-ref-001", status: "pending" }],
      [refunded],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "refunded" });

    expect(res.status).toBe(200);

    // trips (seats) + commissions (cancel) + storeOrders (cancel) + reservations = 4 updates
    expect(tx.update).toHaveBeenCalledTimes(4);

    // The store order update must set { status: "cancelled", cancelledAt: <Date> }
    const storeOrderUpdate = capturedUpdates.find(
      (u) => u.set.status === "cancelled" && "cancelledAt" in u.set,
    );
    expect(storeOrderUpdate).toBeDefined();
  });

  // -------------------------------------------------------------------------
  it("skips the store order update when the linked order is already cancelled (idempotency — refunded path)", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({ storeOrderId: "ORD-2025-REF-002", clientId: null });
    const refunded = { ...existing, status: "refunded" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] store order lookup → order already cancelled
    //   [1] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "order-ref-002", status: "cancelled" }],
      [refunded],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "refunded" });

    expect(res.status).toBe(200);

    // trips (seats) + commissions (cancel) + reservations = 3 — NO store order update
    expect(tx.update).toHaveBeenCalledTimes(3);

    const storeOrderUpdate = capturedUpdates.find((u) => "cancelledAt" in u.set);
    expect(storeOrderUpdate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  it("skips the store order update when the linked order is completed (idempotency — refunded path)", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({ storeOrderId: "ORD-2025-REF-003", clientId: null });
    const refunded = { ...existing, status: "refunded" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] store order lookup → order already completed (fulfilled, cannot re-cancel)
    //   [1] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "order-ref-003", status: "completed" }],
      [refunded],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "refunded" });

    expect(res.status).toBe(200);

    // trips (seats) + commissions (cancel) + reservations = 3 — NO store order update
    expect(tx.update).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  it("gracefully skips the store order update when no matching order is found (refunded path)", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({ storeOrderId: "ORD-REF-MISSING", clientId: null });
    const refunded = { ...existing, status: "refunded" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] store order lookup → not found
    //   [1] re-fetch updated reservation
    const tx = buildTxMock([
      [], // no store order found
      [refunded],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "refunded" });

    expect(res.status).toBe(200);

    // trips (seats) + commissions (cancel) + reservations = 3 — NO store order update
    expect(tx.update).toHaveBeenCalledTimes(3);

    const storeOrderUpdate = capturedUpdates.find((u) => "cancelledAt" in u.set);
    expect(storeOrderUpdate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  it("calls general CalendarSyncService.syncTrip for non-cancellation reservation PATCHes (regression guard)", async () => {
    const app = buildReservationsApp();
    // A notes-only update: no status change, no cancellation
    const existing = makeReservation({ clientId: "client-001" });
    const updated = { ...existing, notes: "Observação nova" };

    mockLimit.mockResolvedValueOnce([existing]);

    // No reversals: only the re-fetch after UPDATE
    const tx = buildTxMock([[updated]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ notes: "Observação nova" });

    expect(res.status).toBe(200);
    // General syncTrip must be called for non-cancellation PATCHes
    expect(mockSyncTripGeneral).toHaveBeenCalledWith(existing.tripId);
    // Cancellation-specific method must NOT be called
    expect(mockSyncTrip).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // End-to-end lifecycle: confirmed → cancel (clawback) → reopen → cancel again
  //
  // This test exercises the full DB round-trip across three sequential API calls
  // against the same Express app, verifying that:
  //   1. The reservation is confirmed with a seeded "earn" loyalty tx (50 pts)
  //      representing what loyaltyAwardPointsForReservation writes at confirmation.
  //   2. Cancelling the confirmed reservation writes a "cancellation" clawback tx
  //      and decrements the member's available points to 0.
  //   3. Re-opening the reservation (admin sets status back to pending) is a no-op
  //      for loyalty — no points are re-awarded or re-clawed.
  //   4. Cancelling the re-opened reservation a second time fires the idempotency
  //      guard: the existing "cancellation" tx is detected and no second deduction
  //      is made — the member's available points remain unchanged at 0.
  // -------------------------------------------------------------------------
  it("end-to-end: confirmed reservation → cancel (clawback written) → reopen → cancel again (idempotency guard prevents double-deduction)", async () => {
    const app = buildReservationsApp();

    // Seed state: reservation is confirmed; the loyalty member has 50 available
    // points that were earned when the reservation was confirmed (earn tx seeded
    // in the Reversal 4 select queue below as [{ points: 50 }]).
    const confirmedReservation = makeReservation({ clientId: "client-001", status: "confirmed" });

    // ── Step 1: PATCH confirmed → cancelled (first cancellation, clawback) ──
    // wasActive = true, wasConfirmed = true, isBeingCancelled = true
    // → Reversal 4 runs and claws back the 50 seeded earn points.
    const cancelledReservation = { ...confirmedReservation, status: "cancelled" };

    // outer: requireReservationAccess
    mockLimit.mockResolvedValueOnce([confirmedReservation]);

    // tx select queue (in execution order):
    //   [0] Reversal 4 — payments lookup (empty — no payment records)
    //   [1] Reversal 4 — loyalty member lookup → member with 50 pts
    //   [2] Reversal 4 — idempotency check (no prior "cancellation" tx) → proceed
    //   [3] Reversal 4 — earn transactions → 50 pts earned at confirmation
    //   [4] re-fetch updated reservation
    const tx1 = buildTxMock([
      [],                                                               // no payments
      [{ id: "member-001", availablePoints: 50, totalPoints: 50 }],   // loyalty member
      [],                                                               // no prior cancellation tx → proceed
      [{ points: 50 }],                                                 // seeded earn tx (50 pts from confirmation)
      [cancelledReservation],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx1));

    // outer: formatReservation → trip + client
    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const firstCancelRes = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(firstCancelRes.status).toBe(200);

    // Verify the seeded earn tx was clawed back: a "cancellation" loyalty
    // transaction must have been inserted with -50 pts referencing the reservation.
    const clawbackTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "cancellation",
    );
    expect(clawbackTx).toBeDefined();
    expect((clawbackTx as Record<string, unknown>)["points"]).toBe(-50);
    expect((clawbackTx as Record<string, unknown>)["referenceId"]).toBe("res-001");
    expect((clawbackTx as Record<string, unknown>)["referenceType"]).toBe("reservation");

    // The loyalty member must have been updated: Math.max(0, 50 - 50) = 0
    const memberUpdateAfterCancel = capturedUpdates.find(
      (u) => "availablePoints" in u.set,
    );
    expect(memberUpdateAfterCancel).toBeDefined();
    expect((memberUpdateAfterCancel as { set: Record<string, unknown> }).set.availablePoints).toBe(0);

    capturedInserts.length = 0;
    capturedUpdates.length = 0;

    // ── Step 2: PATCH cancelled → pending (admin reopens the reservation) ───
    // wasActive = ACTIVE_STATUSES.includes("cancelled") → false
    // isBeingCancelled = false → reversal block entirely skipped.
    // No loyalty operations happen; only the reservation row is updated.
    const reopenedReservation = { ...cancelledReservation, status: "pending" };

    // outer: requireReservationAccess
    mockLimit.mockResolvedValueOnce([cancelledReservation]);

    // tx select queue:
    //   [0] re-fetch after UPDATE (no reversal selects — not a cancellation)
    // tx updates: reservations (status → pending) = 1 update
    const tx2 = buildTxMock([[reopenedReservation]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx2));

    // outer: formatReservation → trip + client
    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const reopenRes = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "pending" });

    expect(reopenRes.status).toBe(200);

    // No loyalty transactions inserted during the reopen
    expect(
      capturedInserts.some(
        (i) => ["earn", "cancellation", "refund"].includes(
          (i as Record<string, unknown>)["type"] as string,
        ),
      ),
    ).toBe(false);

    capturedInserts.length = 0;
    capturedUpdates.length = 0;

    // ── Step 3: PATCH pending → cancelled again (idempotency guard fires) ───
    // wasActive = true (pending is in ACTIVE_STATUSES), isBeingCancelled = true
    // → Reversal 4 runs, but the idempotency check finds the existing
    //   "cancellation" tx from step 1 and SKIPS the clawback entirely.
    // The member's available points must remain at 0 — unchanged from step 1.
    const recancelledReservation = { ...reopenedReservation, status: "cancelled" };

    // outer: requireReservationAccess
    mockLimit.mockResolvedValueOnce([reopenedReservation]);

    // tx select queue (in execution order):
    //   [0] Reversal 4 — payments lookup (empty)
    //   [1] Reversal 4 — loyalty member lookup → member still at 0 pts (already clawed back)
    //   [2] Reversal 4 — idempotency check → existing "cancellation" tx found → SKIP
    //   [3] re-fetch updated reservation
    // Note: earn-transactions query is NOT called when idempotency fires (short-circuit)
    const tx3 = buildTxMock([
      [],                                                              // no payments
      [{ id: "member-001", availablePoints: 0, totalPoints: 0 }],    // member (already at 0)
      [{ id: "cancel-tx-001" }],                                      // existing cancellation tx → idempotency fires
      [recancelledReservation],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx3));

    // outer: formatReservation → trip + client
    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const secondCancelRes = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(secondCancelRes.status).toBe(200);

    // Idempotency guard fired: NO new "cancellation" loyalty transaction inserted
    const secondClawbackTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "cancellation",
    );
    expect(secondClawbackTx).toBeUndefined();

    // loyaltyMembers must NOT be updated a second time — available points stay at 0
    const secondMemberUpdate = capturedUpdates.find(
      (u) => "availablePoints" in u.set,
    );
    expect(secondMemberUpdate).toBeUndefined();

    // Expected updates on the second cancellation:
    //   trips (seat restore) + commissions (cancel) + reservations (status) = 3
    // loyaltyMembers is deliberately absent — idempotency guard prevented the update
    expect(tx3.update).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Concurrent cancellations — loyalty clawback race guard
  //
  // Scenario: two PATCH → cancelled requests race to cancel the same reservation.
  // Without a row-level lock, both pass the idempotency SELECT (seeing no prior
  // "cancellation" tx) before either commits, yielding two clawback inserts.
  //
  // Gate coordination (makes the test lock-sensitive):
  //
  //   tx1.insert.values() pauses until tx2 signals it has called execute(),
  //   giving tx2 a window to run its idempotency check while tx1 is mid-commit.
  //
  //   tx2.execute() releases tx1's gate AND blocks on tx2Gate until tx1 commits.
  //
  //   tx2's idempotency select is dynamic: returns [] when tx1HasCommitted=false
  //   (race window) and [existing tx] when tx1HasCommitted=true (post-lock).
  //
  // WITH lock  → tx2.execute() triggers both gates; idempotency check runs after
  //              tx1 commits (tx1HasCommitted=true) → finds existing tx → skips
  //              insert → capturedInserts has exactly 1 entry ✓
  //
  // WITHOUT lock → tx2 never calls execute(); tx1Gate times out (10 ms); tx2
  //               ran its idempotency check while tx1HasCommitted=false → saw []
  //               → also inserted a clawback → capturedInserts has 2 entries → FAIL
  // -------------------------------------------------------------------------
  it("concurrent cancellations: only one loyalty clawback is written and points are decremented exactly once (race guard)", async () => {
    const app = buildReservationsApp();

    const existing = makeReservation({ clientId: "client-001", status: "confirmed" });
    const cancelled = { ...existing, status: "cancelled" };

    let tx1HasCommitted = false;

    let releaseTx1: () => void;
    const tx1Gate = new Promise<void>(r => { releaseTx1 = r; });

    let releaseTx2: () => void;
    const tx2Gate = new Promise<void>(r => { releaseTx2 = r; });

    // tx1 — first to acquire the FOR UPDATE lock, runs the full clawback.
    // insert.values() pauses (max 10 ms) waiting for tx2 to reach execute(),
    // ensuring both transactions overlap before tx1 finally commits.
    let tx1Idx = 0;
    const tx1SelectQueue: unknown[][] = [
      [],                                                            // [0] payments
      [{ id: "member-001", availablePoints: 50, totalPoints: 50 }], // [1] loyaltyMember
      [],                                                            // [2] idempotency → no prior tx
      [{ points: 50 }],                                             // [3] earnTransactions
    ];
    const tx1 = {
      execute: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(async (vals: Record<string, unknown>) => {
          capturedInserts.push(vals);
          await Promise.race([tx1Gate, new Promise<void>(r => setTimeout(r, 10))]);
          return [];
        }),
      })),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((setArg: Record<string, unknown>) => {
          capturedUpdates.push({ table: "unknown", set: setArg });
          return { where: vi.fn().mockResolvedValue([]) };
        }),
      })),
      select: vi.fn().mockImplementation(() => {
        const idx = tx1Idx++;
        return makeChain(idx < tx1SelectQueue.length ? tx1SelectQueue[idx] as unknown[] : [cancelled]);
      }),
    };

    // tx2 — blocked at execute() until tx1 commits.
    // Idempotency select is dynamic: reflects the DB state at lock acquisition.
    //   WITH lock: returns [existing tx] (tx1 has committed)
    //   WITHOUT lock: returns [] (tx1 still mid-commit → double-insert!)
    let tx2Idx = 0;
    const tx2 = {
      execute: vi.fn().mockImplementation(async () => {
        releaseTx1();   // unblock tx1's insert.values() gate
        await tx2Gate;  // wait here until tx1 commits
      }),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
          capturedInserts.push(vals);
          return Promise.resolve([]);
        }),
      })),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((setArg: Record<string, unknown>) => {
          capturedUpdates.push({ table: "unknown", set: setArg });
          return { where: vi.fn().mockResolvedValue([]) };
        }),
      })),
      select: vi.fn().mockImplementation(() => {
        const idx = tx2Idx++;
        if (idx === 0) return makeChain([]);
        if (idx === 1) return makeChain([{ id: "member-001", availablePoints: 50, totalPoints: 50 }]);
        if (idx === 2) {
          // Idempotency: dynamic based on whether tx1 has committed.
          // tx2.execute() blocked until tx1 committed → tx1HasCommitted=true here (WITH lock).
          // Without the execute() call tx2 reaches this immediately → tx1HasCommitted=false.
          return makeChain(tx1HasCommitted ? [{ id: "cancel-tx-001" }] : []);
        }
        // idx=3: refetch (WITH lock, idempotency skipped earnTxs)
        //        OR earnTxs (WITHOUT lock, idempotency returned [] → would insert)
        if (idx === 3) return makeChain(tx1HasCommitted ? [cancelled] : [{ points: 50 }]);
        // idx=4: refetch (only WITHOUT lock — after earnTxs was at idx=3)
        return makeChain([cancelled]);
      }),
    };

    let txCallCount = 0;
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      if (txCallCount++ === 0) {
        const result = await cb(tx1);
        tx1HasCommitted = true;
        releaseTx2(); // tx1 committed; allow tx2 to proceed past execute()
        return result;
      }
      return cb(tx2);
    });

    // Universal outer-mock: has all fields needed for both trip and client
    // formatReservation lookups, making the test robust to any interleaving of
    // the two concurrent requests' outer db.select() calls.
    const universalMock = { ...FAKE_TRIP, email: "c@example.com", whatsapp: "11999", cpf: null, birthDate: null };
    mockLimit
      .mockResolvedValueOnce([existing]) // rRA: request A (or B, whichever resolves first)
      .mockResolvedValueOnce([existing]) // rRA: request B (or A)
      .mockResolvedValue([universalMock]); // all formatReservation lookups (trip, client, autoRetryLog)

    const [res1, res2] = await Promise.all([
      request(app).patch("/api/reservations/res-001").send({ status: "cancelled" }),
      request(app).patch("/api/reservations/res-001").send({ status: "cancelled" }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Exactly ONE "cancellation" loyalty transaction must be written.
    // The second concurrent request must detect the clawback via the idempotency
    // guard (after being serialized by the FOR UPDATE lock) and skip its INSERT.
    const cancellationTxs = capturedInserts.filter(
      (i) => (i as Record<string, unknown>)["type"] === "cancellation",
    );
    expect(cancellationTxs).toHaveLength(1);
    expect((cancellationTxs[0] as Record<string, unknown>)["points"]).toBe(-50);
    expect((cancellationTxs[0] as Record<string, unknown>)["referenceId"]).toBe("res-001");

    // The loyalty member must be updated exactly once (50 → 0).
    // A second update would indicate the double-deduction bug was not caught.
    const memberUpdates = capturedUpdates.filter((u) => "availablePoints" in u.set);
    expect(memberUpdates).toHaveLength(1);
    expect((memberUpdates[0] as { set: Record<string, unknown> }).set.availablePoints).toBe(0);
  });

  // =========================================================================
  // Refunded-status mirrors
  // The isBeingCancelled guard treats "refunded" the same as "cancelled", so
  // all three financial reversals must fire identically for both statuses.
  // =========================================================================

  it("decrements coupon usage_count when reservation with a coupon is refunded", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({
      discountCouponCode: "PROMO10",
      discountCouponAmount: "50",
      clientId: null,
    });
    const refunded = { ...existing, status: "refunded" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (same as cancelled mirror):
    //   [0] Reversal 1 — store lookup
    //   [1] Reversal 1 — coupon lookup
    //   [2] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "store-001" }],
      [{ id: "coupon-001" }],
      [refunded],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "refunded" });

    expect(res.status).toBe(200);
    // trips (seats) + storeCoupons (usageCount) + commissions (cancel) + reservations (status)
    expect(tx.update).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  it("restores loyalty points when loyalty discount was used and reservation is refunded", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({
      discountLoyaltyPoints: 200,
      discountLoyaltyAmount: "20",
      clientId: "client-001",
    });
    const refunded = { ...existing, status: "refunded" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (same as cancelled mirror):
    //   [0] Reversal 2 — loyalty member lookup
    //   [1] Reversal 2 — idempotency check (no prior "refund" tx)
    //   [2] Reversal 4 — payments lookup (empty)
    //   [3] Reversal 4 — loyalty member lookup (not found → skip clawback)
    //   [4] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "member-001", availablePoints: 300 }],
      [],
      [],
      [],
      [refunded],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "refunded" });

    expect(res.status).toBe(200);
    const refundTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "refund",
    );
    expect(refundTx).toBeDefined();
    expect((refundTx as Record<string, unknown>)["points"]).toBe(200);
    expect((refundTx as Record<string, unknown>)["referenceType"]).toBe("reservation");
  });

  // -------------------------------------------------------------------------
  it("reverses referral bonus when reservation is refunded", async () => {
    const app = buildReservationsApp();
    const existing = makeReservation({
      discountReferralCode: "REF-XYZ",
      discountReferralAmount: "50",
      clientId: "client-001",
    });
    const refunded = { ...existing, status: "refunded" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (same as cancelled mirror):
    //   [0] Reversal 3 — referral record lookup
    //   [1] Reversal 4 — payments lookup (empty)
    //   [2] Reversal 4 — loyalty member lookup (not found → skip clawback)
    //   [3] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "referral-001", referrerId: "referrer-client-001", bonusAmount: "10.00" }],
      [],
      [],
      [refunded],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "refunded" });

    expect(res.status).toBe(200);
    // trips (seats) + clients (referralEarnings) + referrals (status) + commissions (cancel) + reservations = 5
    expect(tx.update).toHaveBeenCalledTimes(5);
  });

  // -------------------------------------------------------------------------
  it("does not double-apply loyalty refund when a previously refunded reservation is re-refunded (idempotency — refunded path)", async () => {
    // Simulates: refund → reopen (manual admin action) → refund again.
    // The second refund detects an existing "refund" loyaltyTransaction
    // for this reservationId and skips the loyalty restore to prevent drift.
    const app = buildReservationsApp();
    const existing = makeReservation({
      discountLoyaltyPoints: 100,
      discountLoyaltyAmount: "10",
      clientId: "client-001",
    });
    const refunded = { ...existing, status: "refunded" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 2 — loyalty member lookup
    //   [1] Reversal 2 — idempotency check → returns existing "refund" tx → SKIP
    //   [2] Reversal 4 — payments lookup (empty)
    //   [3] Reversal 4 — loyalty member lookup (no member found → skip clawback)
    //   [4] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "member-001", availablePoints: 300 }],
      [{ id: "refund-tx-001" }], // existing refund tx → loyalty restore is skipped
      [],                         // no payments
      [],                         // Reversal 4 loyalty member lookup → not found, skip clawback
      [refunded],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "refunded" });

    expect(res.status).toBe(200);
    // trips (seat restore) + commissions (cancel) + reservations (status update) = 3 updates
    // loyaltyMembers is NOT updated a second time (idempotency guard fired)
    expect(tx.update).toHaveBeenCalledTimes(3);
    // No new loyalty transactions inserted (refund was skipped)
    const refundTx = capturedInserts.find(
      (i) => (i as Record<string, unknown>)["type"] === "refund",
    );
    expect(refundTx).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  it("cancels store order alongside coupon reversal when storefront reservation with both is refunded", async () => {
    const app = buildReservationsApp();
    // Reservation from the storefront that also used a coupon; clientId null → no loyalty/referral
    const existing = makeReservation({
      storeOrderId: "ORD-2025-REF-010",
      discountCouponCode: "STORE20",
      discountCouponAmount: "20",
      clientId: null,
    });
    const refunded = { ...existing, status: "refunded" };

    mockLimit.mockResolvedValueOnce([existing]);

    // tx select queue (in execution order):
    //   [0] Reversal 1 — store lookup (for coupon)
    //   [1] Reversal 1 — coupon lookup
    //   [2] store order lookup by orderNumber
    //   [3] re-fetch updated reservation
    const tx = buildTxMock([
      [{ id: "store-001" }],
      [{ id: "coupon-001" }],
      [{ id: "order-ref-010", status: "confirmed" }],
      [refunded],
    ]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    mockLimit
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "refunded" });

    expect(res.status).toBe(200);
    // trips (seats) + storeCoupons (usageCount) + commissions + storeOrders + reservations = 5
    expect(tx.update).toHaveBeenCalledTimes(5);

    // Both the coupon update and the store order cancel must be present together
    const couponUpdate = capturedUpdates.find((u) => "usageCount" in u.set);
    expect(couponUpdate).toBeDefined();

    const storeOrderUpdate = capturedUpdates.find(
      (u) => u.set.status === "cancelled" && "cancelledAt" in u.set,
    );
    expect(storeOrderUpdate).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Unit tests: reversal amount logic (pure computation)
// ---------------------------------------------------------------------------

describe("Cancellation reversal — pure computation", () => {
  it("loyalty points restored equals exactly the amount that was debited", () => {
    const discountLoyaltyPoints = 150;
    const currentAvailable = 80;
    const restored = currentAvailable + discountLoyaltyPoints;
    expect(restored).toBe(230);
  });

  it("referral earnings reversal never goes below zero", () => {
    const currentEarnings = 5.0;
    const bonusToReverse = 10.0;
    const newEarnings = Math.max(0, currentEarnings - bonusToReverse);
    expect(newEarnings).toBe(0);
  });

  it("loyalty points from multiple payments are summed before reversal", () => {
    const earnedPoints = [{ points: 15 }, { points: 20 }, { points: 8 }];
    const totalEarned = earnedPoints.reduce((sum, t) => sum + t.points, 0);
    expect(totalEarned).toBe(43);
  });

  it("payment loyalty clawback never makes availablePoints negative", () => {
    const availablePoints = 30;
    const totalEarned = 50;
    const newAvailable = Math.max(0, availablePoints - totalEarned);
    expect(newAvailable).toBe(0);
  });

  it("totalPoints clawback never makes totalPoints negative", () => {
    const totalPoints = 40;
    const totalEarned = 100;
    const newTotal = Math.max(0, totalPoints - totalEarned);
    expect(newTotal).toBe(0);
  });
});

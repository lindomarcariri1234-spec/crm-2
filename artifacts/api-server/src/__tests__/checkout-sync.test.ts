/**
 * Checkout synchronisation tests — POST /api/public/store/:slug/orders
 *
 * Reservations, the CRM client, and the pipeline deal are now created
 * synchronously at checkout time (via createReservationsForOrder), not
 * deferred to payment confirmation. The portal account is also provisioned
 * at checkout so "Acessar Meu Perfil" works immediately. This suite mocks
 * createReservationsForOrder / ensurePortalAccount at the service-function
 * level (rather than mocking every internal db.select they perform) and
 * verifies the checkout route wires them up correctly:
 *
 * (a) broadcastSeatUpdate is called with the correct tripId + tenantId after a
 *     successful trip-linked checkout.
 * (b) createReservationsForOrder is invoked at checkout; writeClientActivity
 *     (a post-payment-only side effect) is not.
 * (c) ensurePortalAccount + the agency booking notification are dispatched
 *     at checkout when new reservations were created; both are skipped on an
 *     idempotent re-call that created no reservations.
 * (d) enqueueReservationConfirmationEmail is not called directly from the
 *     checkout route.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  selectQueue,
  mockTransaction,
  mockBroadcastSeatUpdate,
  mockWriteClientActivity,
  mockEnqueueConfirmationEmail,
  mockSendWelcomeEmail,
  mockCreateReservationsForOrder,
  mockEnsurePortalAccount,
  mockEnqueueNewBookingNotificationEmail,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const mockTransaction = vi.fn();
  const mockBroadcastSeatUpdate = vi.fn().mockResolvedValue(undefined);
  const mockWriteClientActivity = vi.fn().mockResolvedValue(undefined);
  const mockEnqueueConfirmationEmail = vi.fn().mockResolvedValue(undefined);
  const mockSendWelcomeEmail = vi.fn().mockResolvedValue(undefined);
  // createReservationsForOrder and ensurePortalAccount are mocked directly at
  // the service-function level (instead of mocking every internal db.select
  // call) because their internal query sequence is an implementation detail
  // this route test should not need to track.
  const mockCreateReservationsForOrder = vi.fn();
  const mockEnsurePortalAccount = vi.fn().mockResolvedValue({});
  const mockEnqueueNewBookingNotificationEmail = vi.fn().mockResolvedValue(undefined);
  return {
    selectQueue,
    mockTransaction,
    mockBroadcastSeatUpdate,
    mockWriteClientActivity,
    mockEnqueueConfirmationEmail,
    mockSendWelcomeEmail,
    mockCreateReservationsForOrder,
    mockEnsurePortalAccount,
    mockEnqueueNewBookingNotificationEmail,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => {
  function makeDbSelect() {
    const value = (selectQueue as unknown[][]).shift() ?? [];
    const limitFn = vi.fn().mockResolvedValue(value);
    const thenableResult = Object.assign(Promise.resolve(value), { limit: limitFn });
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => thenableResult),
        limit: limitFn,
        innerJoin: vi.fn(() => ({
          innerJoin: vi.fn(() => ({ where: vi.fn(() => thenableResult) })),
          where: vi.fn(() => thenableResult),
        })),
      })),
    };
  }

  return {
    db: {
      select: vi.fn(makeDbSelect),
      insert: vi.fn(() => ({
        values: vi.fn(() =>
          Object.assign(Promise.resolve([]), {
            onConflictDoNothing: vi.fn().mockResolvedValue([]),
          }),
        ),
      })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
      transaction: mockTransaction,
    },
    storesTable: {},
    storeProductsTable: {},
    storeProductVariantsTable: {},
    storeCategoriesTable: {},
    storeOrdersTable: {},
    storeOrderItemsTable: {},
    storeCouponsTable: {},
    storeReviewsTable: {},
    storeReferralTrackingTable: {},
    reservationsTable: {},
    passengersTable: {},
    tripsTable: {},
    clientsTable: {},
    usersTable: {},
    referralsTable: {},
    settlementItemsTable: {},
    referralTrackingTable: {},
    referralSettingsTable: {},
    pipelineStagesTable: {},
    dealsTable: {},
    loyaltyMembersTable: {},
    loyaltyTransactionsTable: {},
    loyaltyProgramsTable: {},
    tenantsTable: {},
    emailLogsTable: {},
  };
});

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: {
      createUser: vi.fn().mockRejectedValue(new Error("clerk unavailable in tests")),
    },
    signInTokens: {
      createSignInToken: vi.fn().mockRejectedValue(new Error("clerk unavailable in tests")),
    },
  },
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/seat-sse.js", () => ({
  addSeatClient: vi.fn(),
  removeSeatClient: vi.fn(),
  emitSeatUpdate: vi.fn(),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: mockBroadcastSeatUpdate,
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: mockWriteClientActivity,
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReservationConfirmationEmail: mockEnqueueConfirmationEmail,
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNewBookingNotificationEmail: mockEnqueueNewBookingNotificationEmail,
  sendWelcomeEmail: mockSendWelcomeEmail,
}));

vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: mockCreateReservationsForOrder,
  confirmReservationsForOrder: vi.fn().mockResolvedValue({ reservationIds: [] }),
}));

vi.mock("../services/checkout/portal-account.js", () => ({
  ensurePortalAccount: mockEnsurePortalAccount,
}));

vi.mock("../lib/reservation-number.js", () => ({
  getTenantReservationPrefix: vi.fn().mockResolvedValue("AG"),
  nextReservationSequence: vi.fn().mockResolvedValue(1),
  buildReservationNumber: vi.fn(() => "AG-EX-202507-0001"),
  getYearMonth: vi.fn(() => "202507"),
  tripTypeToCode: vi.fn(() => "EX"),
}));

vi.mock("../lib/client-notifications.js", () => ({
  insertClientNotification: vi.fn().mockResolvedValue(undefined),
  getRecentNotifications: vi.fn().mockResolvedValue([]),
  getUnreadCount: vi.fn().mockResolvedValue(0),
  markAllRead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
  generateVoucherCode: vi.fn(() => "VCHR-0001"),
  generateReferralCode: vi.fn(() => "REF-0001"),
}));

vi.mock("../lib/referral-code.js", () => ({
  generateAndAssignReferralCode: vi.fn().mockResolvedValue("REF-CODE-001"),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import storePublicRouter from "../routes/store-public.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { clerkClient } from "@clerk/express";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  const noop = (..._args: unknown[]) => {};
  req.log = {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
  } as never;
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

function buildTxMock() {
  function makeTxSelect() {
    const value = (selectQueue as unknown[][]).shift() ?? [];
    const limitFn = vi.fn().mockResolvedValue(value);
    const thenableResult = Object.assign(Promise.resolve(value), { limit: limitFn });
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => thenableResult),
        limit: limitFn,
      })),
    };
  }
  return {
    execute: vi.fn().mockResolvedValue({
      rows: [{ id: "trip-001", available_seats: 10, type: "excursao" }],
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() =>
        Object.assign(Promise.resolve([]), {
          onConflictDoNothing: vi.fn().mockResolvedValue([]),
        }),
      ),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    select: vi.fn(makeTxSelect),
  };
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

const FAKE_RESERVATION = {
  reservationId: "res-001",
  reservationNumber: "AG-EX-202507-0001",
  voucherCode: "VCH-001",
  seats: [],
  totalValue: "150.00",
  tripName: "Excursão Nordeste",
  tripDestination: "Fortaleza",
  tripDepartureDate: new Date("2027-06-01"),
  tripReturnDate: null,
};

const FAKE_TRIP_PRODUCT = {
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
  tripId: "trip-001",
};

const FAKE_ORDER = {
  id: "order-001",
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
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VALID_BODY = {
  customerName: "Maria Souza",
  customerEmail: "maria@example.com",
  items: [{ productId: "prod-001", quantity: 1 }],
};

// ---------------------------------------------------------------------------
// Queue setup
// ---------------------------------------------------------------------------

// createReservationsForOrder and ensurePortalAccount are mocked at the
// service-function level (see vi.mock calls above), so these queues only
// need to cover the checkout route's own db.select calls: getActiveStore,
// prepareCheckoutItems' product/seat lookups, and persistCheckoutOrder's
// post-commit order/items re-fetch.
function setupTripLinkedCheckoutQueue() {
  selectQueue.length = 0;
  selectQueue.push(
    [FAKE_STORE],                                                 // 1. getActiveStore (db)
    [FAKE_TRIP_PRODUCT],                                          // 2. product fetch (db, prepareCheckoutItems)
    [{ availableSeats: 10 }],                                     // 3. trip seats check (db, prepareCheckoutItems)
    [FAKE_ORDER],                                                 // 4. post-tx order (db)
    [],                                                           // 5. post-tx items (db)
  );
}

function setupNewUserCheckoutQueue() {
  setupTripLinkedCheckoutQueue();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/public/store/:slug/orders — checkout sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBroadcastSeatUpdate.mockResolvedValue(undefined);
    mockWriteClientActivity.mockResolvedValue(undefined);
    mockEnqueueConfirmationEmail.mockResolvedValue(undefined);
    mockCreateReservationsForOrder.mockResolvedValue({
      reservationIds: ["res-001"],
      tripIds: ["trip-001"],
    });
    mockEnsurePortalAccount.mockResolvedValue({});
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(buildTxMock()),
    );
  });

  // ── (a) broadcastSeatUpdate ──────────────────────────────────────────────

  it("(a) calls broadcastSeatUpdate with the correct tripId and tenantId after a trip-linked checkout", async () => {
    setupTripLinkedCheckoutQueue();

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(mockBroadcastSeatUpdate).toHaveBeenCalledOnce();
    expect(mockBroadcastSeatUpdate).toHaveBeenCalledWith("trip-001", "tenant-001");
  });

  // ── (b) createReservationsForOrder IS called at checkout (sync design) ──
  //
  // Reservations, CRM client, and pipeline deal creation are triggered
  // synchronously at checkout time (not deferred to payment confirmation),
  // so the agency sees a pending reservation immediately for PIX/boleto
  // orders. writeClientActivity itself remains a post-payment side effect
  // (see post-booking.ts), so it is still not invoked from this route.

  it("(b) calls createReservationsForOrder at checkout but not writeClientActivity", async () => {
    setupTripLinkedCheckoutQueue();

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    // The order id used at insert time comes from the mocked generateId() helper.
    expect(mockCreateReservationsForOrder).toHaveBeenCalledWith("gen-id");
    expect(mockWriteClientActivity).not.toHaveBeenCalled();
  });

  // ── Reservation sync failure must NOT be reported as checkout success ──
  //
  // If createReservationsForOrder throws (e.g. seat contention, DB error),
  // the customer must see an error, not a 200 confirming a reservation that
  // does not actually exist yet. The order row itself may still be
  // persisted — createReservationsForOrder is idempotent by orderId, so a
  // retry (customer resubmit or the later payment-confirmation call) can
  // safely pick up where this left off.

  it("returns a non-2xx error (does not report success) when createReservationsForOrder throws", async () => {
    setupTripLinkedCheckoutQueue();
    mockCreateReservationsForOrder.mockRejectedValueOnce(new Error("seat lock timeout"));

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);
    expect(mockEnsurePortalAccount).not.toHaveBeenCalled();
    expect(mockEnqueueNewBookingNotificationEmail).not.toHaveBeenCalled();
  });

  // ── Non-trip products — no seat update, no reservation creation ────────

  it("does not call broadcastSeatUpdate, createReservationsForOrder, or writeClientActivity for non-trip products", async () => {
    selectQueue.length = 0;
    selectQueue.push(
      [FAKE_STORE],                                // 1. getActiveStore
      [{ ...FAKE_TRIP_PRODUCT, tripId: null }],   // 2. product fetch (non-trip product, no trip seats check)
      [FAKE_ORDER],                                // 3. post-tx order
      [],                                          // 4. post-tx items
    );

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(mockBroadcastSeatUpdate).not.toHaveBeenCalled();
    expect(mockCreateReservationsForOrder).not.toHaveBeenCalled();
    expect(mockWriteClientActivity).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Welcome e-mail + reservation confirmation credentials — new user happy path
// ---------------------------------------------------------------------------

describe("POST /api/public/store/:slug/orders — portal account provisioning at checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendWelcomeEmail.mockResolvedValue(undefined);
    mockEnqueueConfirmationEmail.mockResolvedValue(undefined);
    mockEnsurePortalAccount.mockResolvedValue({});
    mockEnqueueNewBookingNotificationEmail.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(buildTxMock()),
    );
    vi.mocked(clerkClient.users.createUser).mockResolvedValue({
      id: "clerk-user-new",
    } as never);
    vi.mocked(clerkClient.signInTokens.createSignInToken).mockResolvedValue({
      url: "https://clerk.test/magic",
    } as never);
  });

  // ── (c) account provisioning IS done at checkout (sync design) ──────────
  //
  // ensurePortalAccount (Clerk account + welcome email with a temporary
  // password) now runs at checkout time — right after a trip-linked
  // checkout creates its reservation(s) — so "Acessar Meu Perfil" works
  // immediately, without waiting for payment confirmation. This mirrors the
  // agency-facing booking-notification email, which is also dispatched at
  // checkout. ensurePortalAccount is idempotent, so the later post-payment
  // call for the same customer is a safe no-op.

  it("(c) calls ensurePortalAccount and enqueues a booking notification at checkout when reservations were created", async () => {
    mockCreateReservationsForOrder.mockResolvedValue({
      reservationIds: ["res-001"],
      tripIds: ["trip-001"],
    });
    setupNewUserCheckoutQueue();

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(200);

    // Allow any fire-and-forget async to settle.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(mockEnsurePortalAccount).toHaveBeenCalledOnce();
    expect(mockEnsurePortalAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "maria@example.com",
        name: "Maria Souza",
        tenantId: "tenant-001",
      }),
    );
    expect(mockEnqueueNewBookingNotificationEmail).toHaveBeenCalledWith("res-001", "tenant-001");
  });

  // ── (c2) idempotent re-call: no reservations created → no provisioning ──
  //
  // createReservationsForOrder returns an empty tripIds array when the
  // order's reservations already exist (idempotent re-invocation). In that
  // case the checkout route must not re-provision the portal account or
  // re-send the booking notification.

  it("(c2) does not call ensurePortalAccount when createReservationsForOrder created no new reservations", async () => {
    mockCreateReservationsForOrder.mockResolvedValue({ reservationIds: [], tripIds: [] });
    setupNewUserCheckoutQueue();

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(mockEnsurePortalAccount).not.toHaveBeenCalled();
    expect(mockEnqueueNewBookingNotificationEmail).not.toHaveBeenCalled();
  });

  // ── (d) enqueueReservationConfirmationEmail is NOT sent from this route ──
  //
  // The reservation-confirmation email is dispatched from inside
  // createReservationsForOrder itself (mocked here), not from the checkout
  // route directly — the route only enqueues the agency-facing new-booking
  // notification and provisions the portal account.

  it("(d) enqueueReservationConfirmationEmail is not called directly by the checkout route", async () => {
    mockCreateReservationsForOrder.mockResolvedValue({
      reservationIds: ["res-001"],
      tripIds: ["trip-001"],
    });
    setupNewUserCheckoutQueue();

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(200);

    // Allow any async fire-and-forget to settle
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(mockEnqueueConfirmationEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Idempotency-key dedup — prevents duplicate orders/seat holds on retry
// ---------------------------------------------------------------------------
//
// The Vitrine checkout page generates one client-side idempotencyKey per
// checkout attempt (persisted across resubmits, cleared on success). The
// route dedupes on (storeId, idempotencyKey) two ways: (1) an upfront lookup
// before doing any work, and (2) a fallback that catches the
// store_orders_store_idempotency_key_unique Postgres unique-violation if two
// requests race past the upfront check concurrently.

const EXISTING_ORDER_WITH_KEY = {
  ...FAKE_ORDER,
  id: "order-existing-001",
  idempotencyKey: "idem-key-001",
};

describe("POST /api/public/store/:slug/orders — idempotency key dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateReservationsForOrder.mockResolvedValue({ reservationIds: [], tripIds: [] });
  });

  it("replays the existing order when the same idempotencyKey is submitted again, without opening a new transaction", async () => {
    selectQueue.length = 0;
    selectQueue.push(
      [FAKE_STORE], // 1. getActiveStore
      [EXISTING_ORDER_WITH_KEY], // 2. idempotency-key upfront lookup — found
      [], // 3. existing order's items lookup
    );

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, idempotencyKey: "idem-key-001" });

    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe("order-existing-001");
    expect(mockCreateReservationsForOrder).toHaveBeenCalledWith("order-existing-001");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("creates a fresh order when no order with that idempotencyKey exists yet", async () => {
    selectQueue.length = 0;
    selectQueue.push(
      [FAKE_STORE], // 1. getActiveStore
      [], // 2. idempotency-key upfront lookup — none found
      [FAKE_TRIP_PRODUCT], // 3. product fetch
      [{ availableSeats: 10 }], // 4. trip seats check
      [FAKE_ORDER], // 5. post-tx order
      [], // 6. post-tx items
    );
    mockCreateReservationsForOrder.mockResolvedValue({
      reservationIds: ["res-001"],
      tripIds: ["trip-001"],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(buildTxMock()),
    );

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, idempotencyKey: "idem-key-002" });

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("replays the winning order when two concurrent retries race past the upfront check and hit the unique-violation", async () => {
    selectQueue.length = 0;
    selectQueue.push(
      [FAKE_STORE], // 1. getActiveStore
      [], // 2. idempotency-key upfront lookup — not found yet (lost the race)
      [FAKE_TRIP_PRODUCT], // 3. product fetch
      [{ availableSeats: 10 }], // 4. trip seats check
      [EXISTING_ORDER_WITH_KEY], // 5. idempotency-key lookup after the unique-violation (winner's row)
      [], // 6. winner's order items lookup
    );
    const raceError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "store_orders_store_idempotency_key_unique"',
      ),
      { code: "23505", constraint: "store_orders_store_idempotency_key_unique" },
    );
    mockTransaction.mockRejectedValueOnce(raceError);

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, idempotencyKey: "idem-key-003" });

    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe("order-existing-001");
    expect(mockCreateReservationsForOrder).toHaveBeenCalledWith("order-existing-001");
  });

  it("does not dedupe across requests without an idempotencyKey (legacy clients still work)", async () => {
    setupTripLinkedCheckoutQueue();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(buildTxMock()),
    );
    mockCreateReservationsForOrder.mockResolvedValue({
      reservationIds: ["res-001"],
      tripIds: ["trip-001"],
    });

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Referral PENDING row inserted at checkout time
// ---------------------------------------------------------------------------
//
// When a valid referralCode is included in the checkout body, persistCheckoutOrder
// must insert a PENDING referral row inside the checkout transaction — before
// the order row itself — so the referral is visible immediately (not deferred
// to payment confirmation). At payment time, applyDeferredOrderCredits reads
// the row id from pendingReferral.referralId and UPDATEs it to 'completed'
// instead of inserting a duplicate. This test confirms:
//   (e) tx.insert is called with status='pending' when a referralCode resolves
//       to an active referrer, producing exactly ONE row at checkout.

describe("POST /api/public/store/:slug/orders — referral PENDING row at checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateReservationsForOrder.mockResolvedValue({
      reservationIds: ["res-001"],
      tripIds: ["trip-001"],
    });
    mockEnsurePortalAccount.mockResolvedValue({});
  });

  it("(e) inserts a PENDING referral row into referralsTable when referralCode resolves to an active referrer", async () => {
    // Queue for a trip-linked checkout that also carries a referralCode.
    // resolveCheckoutDiscounts performs 3 extra db.selects when referralCode is
    // present (no couponCode): tenantsTable feature flags, clientsTable referrer
    // lookup, and referralSettingsTable — all happen before the transaction opens.
    selectQueue.length = 0;
    selectQueue.push(
      [FAKE_STORE],                         // 1. getActiveStore
      [FAKE_TRIP_PRODUCT],                  // 2. product fetch (prepareCheckoutItems)
      [{ availableSeats: 10 }],             // 3. trip seats check (prepareCheckoutItems)
      [{ settings: {} }],                   // 4. tenantsTable — feature flags (resolveCheckoutDiscounts)
      [{                                    // 5. clientsTable — referrer lookup
        id: "referrer-001",
        name: "Referrer Name",
        email: "ref@example.com",
        referralCodeStatus: "active",
        successfulReferrals: 0,
      }],
      [{                                    // 6. referralSettingsTable
        discountValue: "5",
        discountType: "percentage",
        isEnabled: true,
        allowSelfReferral: false,
        requireFirstPurchase: false,
        bonusValue: "10",
        minPurchaseAmount: null,
        maxReferralsPerUser: null,
      }],
      [FAKE_ORDER],                         // 7. post-tx order re-fetch
      [],                                   // 8. post-tx items re-fetch
    );

    // Override the transaction mock for this test so we can capture the tx
    // instance and inspect every tx.insert call made during the checkout.
    const insertValueCaptures: unknown[] = [];
    mockTransaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => {
      function makeTxSelect() {
        const value = (selectQueue as unknown[][]).shift() ?? [];
        const limitFn = vi.fn().mockResolvedValue(value);
        const thenableResult = Object.assign(Promise.resolve(value), { limit: limitFn });
        return { from: vi.fn(() => ({ where: vi.fn(() => thenableResult), limit: limitFn })) };
      }
      const tx = {
        execute: vi.fn().mockResolvedValue({
          rows: [{ id: "trip-001", available_seats: 10, type: "excursao" }],
        }),
        select: vi.fn(makeTxSelect),
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
        insert: vi.fn(() => {
          const valuesFn = vi.fn((vals: unknown) => {
            insertValueCaptures.push(vals);
            return Object.assign(Promise.resolve([]), {
              onConflictDoNothing: vi.fn().mockResolvedValue([]),
            });
          });
          return { values: valuesFn };
        }),
      };
      return cb(tx);
    });

    const res = await request(buildApp())
      .post("/api/public/store/minha-loja/orders")
      .send({ ...VALID_BODY, referralCode: "VALID-REF" });

    expect(res.status).toBe(200);

    // Exactly one of the tx.insert calls must be for the PENDING referral row.
    // persistCheckoutOrder inserts the referral row BEFORE the order row so the
    // referralId is available to store in pendingReferral.referralId.
    const pendingReferralInsert = insertValueCaptures.find(
      (v) => (v as Record<string, unknown>)?.status === "pending",
    );
    expect(pendingReferralInsert).toBeDefined();
    expect(pendingReferralInsert).toMatchObject({
      status: "pending",
      // referralCode is uppercased by resolveCheckoutDiscounts
      code: "VALID-REF",
      referrerId: "referrer-001",
      tenantId: "tenant-001",
    });

    // Only ONE PENDING referral row must be inserted per checkout — not two.
    const allPendingInserts = insertValueCaptures.filter(
      (v) => (v as Record<string, unknown>)?.status === "pending",
    );
    expect(allPendingInserts).toHaveLength(1);
  });
});

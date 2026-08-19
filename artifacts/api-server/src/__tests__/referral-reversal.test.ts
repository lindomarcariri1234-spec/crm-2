/**
 * referral-reversal.test.ts
 *
 * Covers four acceptance criteria:
 * 1. Trip cancellation batch-reverses all COMPLETED referrals linked via reservationId,
 *    setting reversalReason="trip_cancelled" and decrementing client counters.
 * 2. Trip cancellation: reservations without a discountReferralCode (or no COMPLETED
 *    referral) are silently skipped — no reversal updates issued.
 * 3. Reservation cancellation reverses the linked COMPLETED referral,
 *    setting reversalReason="reservation_cancelled" and decrementing client counters.
 * 4. Re-cancelling a reservation whose referral is already REVERSED is a no-op
 *    (idempotency — no extra update to the referrals or clients tables).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";

// ---------------------------------------------------------------------------
// vi.hoisted: all mocks that must exist before vi.mock() factory calls run
// ---------------------------------------------------------------------------

const { mockLimit, mockWhere, mockFrom, mockSelect, mockTransaction } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockTransaction = vi.fn();
  return { mockLimit, mockWhere, mockFrom, mockSelect, mockTransaction };
});

// ---------------------------------------------------------------------------
// Module mocks — must appear before any import that transitively loads them
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    transaction: mockTransaction,
  },
  tripsTable: {},
  reservationsTable: {},
  clientsTable: {},
  referralsTable: {},
  tenantsTable: {},
  plansTable: {},
  passengersTable: {},
  vehicleLayoutsTable: {},
  auditLogsTable: {},
  tripMediaTable: {},
  tripCheckinsTable: {},
  tripGuideLocationsTable: {},
  storesTable: {},
  storeCouponsTable: {},
  storeOrdersTable: {},
  storeProductsTable: {},
  loyaltyMembersTable: {},
  loyaltyTransactionsTable: {},
  loyaltyProgramsTable: {},
  paymentsTable: {},
  commissionsTable: {},
  referralSettingsTable: {},
  referralCampaignsTable: {},
  dealsTable: {},
  pipelineStagesTable: {},
  emailLogsTable: {},
  reservationInstallmentsTable: {},
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
  // "agencia" = ROLES.AGENCY_ADMIN; list must include it so both trips and
  // reservations permission guards pass with the FAKE_USER below.
  ADMIN_ROLES: ["agencia", "superadmin"],
  MANAGEMENT_ROLES: ["agencia", "superadmin", "gerente"],
}));

vi.mock("../lib/seat-sse.js", () => ({
  addSeatClient: vi.fn(),
  removeSeatClient: vi.fn(),
  emitSeatUpdate: vi.fn(),
}));

vi.mock("../lib/boarding-sse.js", () => ({
  tryAddBoardingClient: vi.fn(() => true),
  removeBoardingClient: vi.fn(),
  emitBoardingUpdate: vi.fn(),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralReversedEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralCodeSuspendedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
    syncTripOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/google-calendar/schedule-sync.js", () => ({
  scheduleCalendarSyncTrip: vi.fn().mockResolvedValue(undefined),
  scheduleCalendarDeleteEventsForTrip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
  generateVoucherCode: vi.fn(() => "VCHR-0001"),
  generateReferralCode: vi.fn(() => "REF-0001"),
  generateAndAssignReferralCode: vi.fn().mockResolvedValue("REF-0001"),
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

vi.mock("../lib/uploadthing.js", () => ({
  deleteOrphanedFile: vi.fn().mockResolvedValue(undefined),
  utapi: { deleteFiles: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../lib/planLimits.js", () => ({
  checkPlanLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("../lib/plan-features.js", () => ({
  hasSeatMapFeature: vi.fn(() => false),
}));

vi.mock("../lib/status-validators.js", () => ({
  parseTripStatus: vi.fn((s: string) => s),
  parseReservationStatus: vi.fn((s: string) => s),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/redis.js", () => ({
  areWorkersEnabled: vi.fn(() => false),
}));

vi.mock("../queues/index.js", () => ({
  getPdfQueue: vi.fn(() => null),
  getEmailQueue: vi.fn(() => null),
  getCalendarSyncQueue: vi.fn(() => null),
}));

vi.mock("@workspace/email", () => ({
  sendManifestEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/client-notifications.js", () => ({
  insertClientNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/commission-sync-helper.js", () => ({
  enqueueCommissionSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/push-notifications.js", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/referral-campaigns.js", () => ({
  applyActiveCampaignBonus: vi.fn((x: number) => x),
}));

vi.mock("../lib/loyalty-helpers.js", () => ({
  calculateTier: vi.fn(() => "bronze"),
  loyaltyAwardPointsForReservation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
  syncClientDeal: vi.fn().mockResolvedValue(undefined),
  cancelDealOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/get-client-ip.js", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

// ---------------------------------------------------------------------------
// Import route modules AFTER all mocks are registered
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import tripsRouter from "../routes/trips.js";
import reservationsRouter from "../routes/reservations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ROLES.AGENCY_ADMIN = "agencia" (real value from @workspace/permissions)
const FAKE_USER = {
  id: "user-001",
  tenantId: "tenant-001",
  role: "agencia",
  clerkUserId: "user_test",
};

// Attaches a silent pino logger to req.log so route handlers can call
// req.log.error/warn/info/debug without throwing.
function stubLogger(
  req: express.Request & { log?: unknown },
  _res: express.Response,
  next: express.NextFunction,
) {
  req.log = pino({ level: "silent" });
  next();
}

const FAKE_TRIP_CANCELLED = {
  id: "trip-001",
  tenantId: "tenant-001",
  name: "Excursão Nordeste",
  slug: "excursao-nordeste",
  description: null,
  status: "cancelled",
  destination: "Fortaleza, CE",
  destinationCity: "Fortaleza",
  destinationState: "CE",
  type: "excursao",
  category: null,
  departureDate: new Date("2025-07-10"),
  returnDate: null,
  availableSeats: 40,
  reservedSeats: 0,
  confirmedSeats: 0,
  totalCapacity: 46,
  priceAdult: "200.00",
  priceChild: null,
  priceSenior: null,
  coverImage: null,
  layoutId: null,
  boardingPoints: [],
  seatMap: {},
  seatLayout: "2x2",
  showSeatMap: false,
  gallery: [],
  itinerary: [],
  fixedCosts: [],
  variableCosts: [],
  inclusions: [],
  exclusions: [],
  freePassengers: [],
  freeOrganizers: 0,
  freeGuides: 0,
  isPublic: false,
  isFeatured: false,
  vehiclePlate: null,
  vehicleType: null,
  driverName: null,
  tourGuide: null,
  tripOrganizer: null,
  driver1Cpf: null,
  driver1Cnh: null,
  driver1CnhCategory: null,
  driver1CnhExpiry: null,
  driver2Name: null,
  driver2Cpf: null,
  driver2Cnh: null,
  driver2CnhCategory: null,
  driver2CnhExpiry: null,
  tourGuideCpf: null,
  tourGuideRegistration: null,
  manifestNumber: null,
  originCity: null,
  originState: null,
  departureTime: null,
  returnTime: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const FAKE_REFERRAL = {
  id: "ref-001",
  referrerId: "client-referrer",
  referredId: "client-referred",
  bonusAmount: "50.00",
  code: "JOAO2024",
};

// Second distinct referral for batch-reversal tests (different reservation).
const FAKE_REFERRAL_2 = {
  id: "ref-002",
  referrerId: "client-referrer-2",
  referredId: "client-referred-2",
  bonusAmount: "30.00",
  code: "MARIA2024",
};

const EXISTING_RESERVATION = {
  id: "res-001",
  tenantId: "tenant-001",
  tripId: "trip-001",
  clientId: null,
  seats: [],
  status: "confirmed",
  discountReferralCode: "JOAO2024",
  discountReferralAmount: "50.00",
  discountCouponCode: null,
  discountCouponAmount: null,
  discountLoyaltyPoints: null,
  discountLoyaltyAmount: null,
  discountTotal: null,
  storeOrderId: null,
  voucherCode: "VCHR-0001",
  reservationNumber: "AG-EX-202507-0001",
  qrCode: "QR-VCHR-0001",
  totalValue: "500.00",
  paidValue: "500.00",
  balance: "0.00",
  paymentMethod: null,
  installments: 1,
  commissionPercentage: null,
  commissionAmount: null,
  commissionSyncStatus: null,
  sellerId: null,
  boardingLocationId: null,
  hasInsurance: false,
  tripType: null,
  packageType: null,
  notes: null,
  checkedInAt: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  createdById: "user-001",
};

const UPDATED_RESERVATION = {
  ...EXISTING_RESERVATION,
  status: "cancelled",
  updatedAt: new Date(),
};

const FAKE_TRIP_FOR_FORMAT = {
  id: "trip-001",
  name: "Excursão Nordeste",
  destination: "Fortaleza, CE",
  departureDate: new Date("2025-07-10"),
  availableSeats: 40,
  totalCapacity: 46,
  status: "cancelled",
  coverImage: null,
  layoutId: null,
  boardingPoints: [],
  seatMap: {},
};

/**
 * Makes a value that can be:
 * - awaited directly (resolves to `items`)
 * - chained with `.limit(n)` which calls the shared `mockLimit` fn
 */
function makeThenable<T>(items: T[]) {
  const p = Promise.resolve(items);
  Object.assign(p, { limit: mockLimit });
  return p as typeof p & { limit: typeof mockLimit };
}

/**
 * Creates a transaction mock whose `.update().set()` calls are captured
 * in the provided array for assertion.
 */
function buildTxMock(capturedSetData: Record<string, unknown>[]) {
  return {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    update: vi.fn(() => ({
      set: vi.fn((data: Record<string, unknown>) => {
        capturedSetData.push(data);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    })),
    select: vi.fn(() => ({ from: mockFrom })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
  };
}

function buildTripsApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", tripsRouter);
  app.use(errorHandler);
  return app;
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
// Tests — PATCH /api/trips/:id — referral reversal on trip cancellation
// ---------------------------------------------------------------------------

describe("PATCH /api/trips/:id — cancellation reverses referrals (trip_cancelled)", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    // Default: where() returns { limit: mockLimit } (for normal limited selects)
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("batch-reverses ALL COMPLETED referrals across multiple trip reservations", async () => {
    // Criterion: trip cancellation must reverse every COMPLETED referral whose
    // reservationId appears in the trip's reservation set — not just the first one.
    const capturedSetData: Record<string, unknown>[] = [];

    // mockWhere queue (in call order):
    // 1. tenant planId select   → { limit: mockLimit }
    // 2. plan features select   → { limit: mockLimit }
    // 3. reservations (no .limit()) → thenable [{id:"res-001"},{id:"res-002"}]
    // 4. referrals (no .limit())    → thenable [FAKE_REFERRAL, FAKE_REFERRAL_2]
    // 5. final trip select      → { limit: mockLimit } (default)
    mockWhere
      .mockReturnValueOnce({ limit: mockLimit })
      .mockReturnValueOnce({ limit: mockLimit })
      .mockReturnValueOnce(makeThenable([
        { id: "res-001", clientId: "client-referrer", discountReferralCode: "JOAO2024" },
        { id: "res-002", clientId: "client-referrer-2", discountReferralCode: "MARIA2024" },
      ]))
      .mockReturnValueOnce(makeThenable([FAKE_REFERRAL, FAKE_REFERRAL_2]))
      .mockReturnValue({ limit: mockLimit });

    // mockLimit queue:
    // 1. tenant planId
    // 2. plan features
    // 3. final trip (after transaction)
    mockLimit
      .mockResolvedValueOnce([{ planId: "starter" }])
      .mockResolvedValueOnce([{ supportedFeatures: [] }])
      .mockResolvedValueOnce([FAKE_TRIP_CANCELLED]);

    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(buildTxMock(capturedSetData)),
    );

    const app = buildTripsApp();
    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // Both referrals must be reversed with the correct reason.
    const reversalUpdates = capturedSetData.filter(
      (d) => d.reversalReason !== undefined,
    );
    expect(reversalUpdates).toHaveLength(2);
    expect(reversalUpdates[0].reversalReason).toBe("trip_cancelled");
    expect(reversalUpdates[1].reversalReason).toBe("trip_cancelled");

    // Both clients must have their counters decremented.
    const clientUpdates = capturedSetData.filter(
      (d) => d.successfulReferrals !== undefined,
    );
    expect(clientUpdates).toHaveLength(2);
    expect(clientUpdates[0].referralEarnings).toBeDefined();
    expect(clientUpdates[1].referralEarnings).toBeDefined();
  });

  it("does not reverse referrals that are not linked to any of the trip's reservations", async () => {
    // Criterion: referrals whose reservationId does NOT appear in the trip's
    // reservation set must not be reversed. This is enforced by the `inArray`
    // WHERE clause in the DB query. In the mock we simulate the scenario by
    // having the trip carry reservations but the referrals query returning []
    // (i.e., no referral matched those reservation IDs).
    const capturedSetData: Record<string, unknown>[] = [];

    // mockWhere queue:
    // 1. tenant planId select    → { limit: mockLimit }
    // 2. plan features select    → { limit: mockLimit }
    // 3. reservations (no .limit()) → thenable [{id:"res-001"}]  (trip HAS a reservation with a referral code)
    // 4. referrals (no .limit())    → thenable [] (orphan referral not in this trip)
    // 5. final trip select       → { limit: mockLimit } (default)
    mockWhere
      .mockReturnValueOnce({ limit: mockLimit })
      .mockReturnValueOnce({ limit: mockLimit })
      .mockReturnValueOnce(makeThenable([{ id: "res-001", clientId: "client-referrer", discountReferralCode: "JOAO2024" }]))
      .mockReturnValueOnce(makeThenable([]))
      .mockReturnValue({ limit: mockLimit });

    mockLimit
      .mockResolvedValueOnce([{ planId: "starter" }])
      .mockResolvedValueOnce([{ supportedFeatures: [] }])
      .mockResolvedValueOnce([FAKE_TRIP_CANCELLED]);

    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(buildTxMock(capturedSetData)),
    );

    const app = buildTripsApp();
    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    // No referral or client update must have been issued.
    const referralUpdate = capturedSetData.find(
      (d) => d.reversalReason !== undefined,
    );
    expect(referralUpdate).toBeUndefined();

    const clientUpdate = capturedSetData.find(
      (d) => d.successfulReferrals !== undefined,
    );
    expect(clientUpdate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — PATCH /api/reservations/:id — referral reversal on reservation cancel
// ---------------------------------------------------------------------------

describe("PATCH /api/reservations/:id — cancellation reverses linked referral (reservation_cancelled)", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("reverses the linked COMPLETED referral and decrements client counters", async () => {
    const capturedSetData: Record<string, unknown>[] = [];

    // mockLimit queue (shared by db.select and tx.select via mockFrom/mockWhere):
    // 1. requireReservationAccess → existing reservation
    // 2. tx.select(referrals WHERE reservationId AND status=COMPLETED).limit(1) → FAKE_REFERRAL (byReservation)
    // 3. tx.select(reservations after update).limit(1) → UPDATED_RESERVATION
    // 4. formatReservation: db.select(trips).limit(1) → FAKE_TRIP_FOR_FORMAT
    // 5. formatReservation: db.select(emailLogs).limit(1) → []
    mockLimit
      .mockResolvedValueOnce([EXISTING_RESERVATION])
      .mockResolvedValueOnce([FAKE_REFERRAL])
      .mockResolvedValueOnce([UPDATED_RESERVATION])
      .mockResolvedValueOnce([FAKE_TRIP_FOR_FORMAT])
      .mockResolvedValueOnce([]);

    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(buildTxMock(capturedSetData)),
    );

    const app = buildReservationsApp();
    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    const referralUpdate = capturedSetData.find(
      (d) => d.reversalReason !== undefined,
    );
    expect(referralUpdate?.reversalReason).toBe("reservation_cancelled");

    const clientUpdate = capturedSetData.find(
      (d) => d.successfulReferrals !== undefined,
    );
    expect(clientUpdate).toBeDefined();
    expect(clientUpdate?.referralEarnings).toBeDefined();
  });

  it("is a no-op when the referral is already REVERSED (idempotency)", async () => {
    const capturedSetData: Record<string, unknown>[] = [];

    // mockLimit queue for the already-reversed path:
    // 1. requireReservationAccess → existing reservation
    // 2. tx.select(referrals WHERE reservationId AND status=COMPLETED).limit(1) → [] (byReservation: none)
    // 3. tx.select(referrals WHERE code AND status=COMPLETED).limit(1) → [] (byCode: none)
    // 4. tx.select(referrals WHERE code AND status=REVERSED).limit(1) → [{id:"ref-001"}] (alreadyReversed)
    // 5. tx.select(reservations after update).limit(1) → UPDATED_RESERVATION
    // 6. formatReservation: db.select(trips).limit(1) → FAKE_TRIP_FOR_FORMAT
    // 7. formatReservation: db.select(emailLogs).limit(1) → []
    mockLimit
      .mockResolvedValueOnce([EXISTING_RESERVATION])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "ref-001" }])
      .mockResolvedValueOnce([UPDATED_RESERVATION])
      .mockResolvedValueOnce([FAKE_TRIP_FOR_FORMAT])
      .mockResolvedValueOnce([]);

    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(buildTxMock(capturedSetData)),
    );

    const app = buildReservationsApp();
    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);

    const referralUpdate = capturedSetData.find(
      (d) => d.reversalReason !== undefined,
    );
    expect(referralUpdate).toBeUndefined();

    const clientUpdate = capturedSetData.find(
      (d) => d.successfulReferrals !== undefined,
    );
    expect(clientUpdate).toBeUndefined();
  });
});

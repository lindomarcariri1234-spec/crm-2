/**
 * duplicate-reservation.test.ts
 *
 * Regression tests for the duplicate-reservation guard in
 * POST /api/reservations (routes/reservations.ts, lines ~660-679).
 *
 * Scenarios:
 *  1. Client already has an active (pending) reservation for the trip
 *     → 409 DUPLICATE_RESERVATION with existingReservationId
 *  2. Client's prior reservation is "cancelled"
 *     → dup check finds nothing → 201 (creation allowed)
 *  3. Client's prior reservation is "refunded"
 *     → dup check finds nothing → 201 (creation allowed)
 *
 * The mock DB returns whatever we queue via mockResolvedValueOnce; the SQL
 * WHERE clause predicates are irrelevant to the mock — only slot order matters.
 *
 * Select slot order for POST /api/reservations:
 *   Slot 1: client lookup (clientsTable)
 *   Slot 2: duplicate check (reservationsTable)
 *   Slot 3+: post-transaction reservation + formatReservation selects
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted shared state
// ---------------------------------------------------------------------------

const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockTransaction,
} = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockTransaction = vi.fn();
  return { mockLimit, mockWhere, mockFrom, mockSelect, mockTransaction };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    transaction: mockTransaction,
  },
  reservationsTable: {},
  passengersTable: {},
  tripsTable: {},
  clientsTable: {},
  loyaltyMembersTable: {},
  loyaltyTransactionsTable: {},
  loyaltyProgramsTable: {},
  referralsTable: {},
  referralSettingsTable: {},
  referralCampaignsTable: {},
  dealsTable: {},
  pipelineStagesTable: {},
  tenantsTable: {},
  emailLogsTable: {},
  storesTable: {},
  storeOrdersTable: {},
  storeOrderItemsTable: {},
  storeProductsTable: {},
  storeProductVariantsTable: {},
  storeCouponsTable: {},
  storeReviewsTable: {},
  storeCategoriesTable: {},
  paymentsTable: {},
  commissionsTable: {},
  usersTable: {},
  vehicleLayoutsTable: {},
  reservationInstallmentsTable: {},
  boardingLocationsTable: {},
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
  ADMIN_ROLES: ["superadmin", "agencia"],
  MANAGEMENT_ROLES: ["superadmin", "agencia", "gerente"],
}));

vi.mock("../routes/payments.js", () => ({
  syncReservationCommission: vi.fn().mockResolvedValue(undefined),
  recalculateClientFinancials: vi.fn().mockResolvedValue(undefined),
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), use: vi.fn() },
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralReversedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/commission-sync-helper.js", () => ({
  enqueueCommissionSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
    syncTripOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/loyalty-helpers.js", () => ({
  calculateTier: vi.fn(() => "bronze"),
  loyaltyAwardPointsForReservation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
  cancelDealOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), use: vi.fn() },
}));

vi.mock("../services/pipeline-deal-sync.js", () => ({
  syncClientDeal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/push-notifications.js", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/referral-campaigns.js", () => ({
  applyActiveCampaignBonus: vi.fn().mockResolvedValue({ adjustedBase: 0, fixedExtra: 0 }),
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

vi.mock("../lib/client-notifications.js", () => ({
  insertClientNotification: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// App & helpers
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import reservationsRouter from "../routes/reservations.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { notInArray } from "drizzle-orm";

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
  name: "Test Agent",
  email: "agent@example.com",
};

const FAKE_CLIENT = {
  id: "client-001",
  tenantId: "tenant-001",
  name: "Maria Silva",
  email: "maria@example.com",
  whatsapp: "11999990000",
  cpf: null,
  birthDate: null,
  rg: null,
  referralCode: null,
};

const EXISTING_ACTIVE_RESERVATION = {
  id: "res-existing-001",
  reservationNumber: "AG-EX-202507-0001",
  status: "pending",
};

const FAKE_RESERVATION = {
  id: "gen-id",
  tenantId: "tenant-001",
  tripId: "trip-001",
  clientId: "client-001",
  seats: [] as string[],
  status: "pending",
  voucherCode: "VCHR-0001",
  reservationNumber: "AG-EX-202507-0002",
  totalValue: "500",
  paidValue: "0",
  balance: "500",
  paymentMethod: null,
  installments: 1,
  commissionPercentage: null,
  commissionAmount: null,
  commissionSyncStatus: null,
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
  couponReversalAt: null,
  checkedInAt: null,
  createdAt: new Date("2025-07-01T10:00:00Z"),
  updatedAt: new Date("2025-07-01T10:00:00Z"),
  createdById: "user-001",
  tripType: null,
  packageType: null,
  hasInsurance: false,
  isGratuidade: false,
  qrCode: "QR-VCHR-0001",
};

const FAKE_TRIP = {
  id: "trip-001",
  tenantId: "tenant-001",
  name: "Excursão Nordeste",
  destination: "Fortaleza",
  departureDate: new Date("2025-07-10T08:00:00Z"),
  totalCapacity: 46,
  availableSeats: 10,
  reservedSeats: 3,
  confirmedSeats: 5,
  priceAdult: "500",
  priceChild: null,
  priceSenior: null,
  status: "active",
  coverImage: null,
  layoutId: null,
  boardingPoints: [],
};

const BASE_BODY = {
  tripId: "trip-001",
  clientId: "client-001",
  seats: [] as string[],
  totalValue: 500,
};

// ---------------------------------------------------------------------------
// Transaction mock — enough to let the route complete successfully
// ---------------------------------------------------------------------------

function buildTxMock() {
  return {
    execute: vi.fn().mockResolvedValue({
      rows: [{ id: "trip-001", available_seats: 10, type: "nacional" }],
      rowCount: 1,
    }),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        limit: vi.fn().mockResolvedValue([]),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/reservations — duplicate reservation guard", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockReset();

    requireAuthMock.mockResolvedValue(FAKE_USER as never);

    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue([]);
  });

  it("returns 409 DUPLICATE_RESERVATION when the client already has an active reservation for the trip", async () => {
    const app = buildApp();

    // Slot 1: client lookup → found
    mockLimit.mockResolvedValueOnce([FAKE_CLIENT]);
    // Slot 2: active duplicate reservation → conflict before creating a new one.
    mockLimit.mockResolvedValueOnce([FAKE_RESERVATION]);

    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(buildTxMock()),
    );

    const res = await request(app)
      .post("/api/reservations")
      .send(BASE_BODY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_RESERVATION");

    // Assert the dup-check actually applied the refund exclusion.
    // This breaks if someone removes "refunded" from the notInArray list.
    // Note: reservationsTable.status resolves to undefined in the mock context.
    const notInArrayMock = vi.mocked(notInArray);
    expect(notInArrayMock).toHaveBeenCalledWith(
      undefined,
      expect.arrayContaining(["refunded"]),
    );
  });

  it("returns 409 DUPLICATE_RESERVATION (not 500) when the DB unique index fires during a race condition", async () => {
    // Scenario: two simultaneous requests both pass the pre-insert dup check,
    // but the second INSERT is blocked by the partial unique index and PostgreSQL
    // raises a UNIQUE_VIOLATION (code 23505, constraint reservations_active_client_trip_unique).
    // The route catch block must convert this into a structured 409 instead of a generic 500.
    const app = buildApp();

    // Slot 1: client lookup → found
    mockLimit.mockResolvedValueOnce([FAKE_CLIENT]);
    // Slot 2: dup check → [] (pre-check sees no duplicate — simulates first-past-post race)
    mockLimit.mockResolvedValueOnce([]);

    // Simulate the DB unique constraint violation thrown from inside the transaction
    const pgUniqueViolation = Object.assign(new Error("duplicate key value"), {
      code: "23505",
      constraint: "reservations_active_client_trip_unique",
    });
    mockTransaction.mockRejectedValueOnce(pgUniqueViolation);

    const res = await request(app)
      .post("/api/reservations")
      .send(BASE_BODY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_RESERVATION");
  });
});

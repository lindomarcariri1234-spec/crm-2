/**
 * Lap-child (isOnLap) reservation tests — POST /api/reservations
 *
 * Verifies that when isOnLap=true is submitted:
 * 1. The primary passenger is created with ageCategory="baby", seatNumber=null,
 *    isChildUnder7=true (and isPrimary=true).
 * 2. No placeholder passengers are created for additional seats (seatsCount=0).
 * 3. The trip counters are not decremented — reserved_seats and available_seats
 *    are updated with a delta of 0, so no capacity is consumed.
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted shared state — must be created before any vi.mock() calls
// ---------------------------------------------------------------------------

const {
  capturedPassengerInserts,
  capturedTripUpdates,
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockTransaction,
} = vi.hoisted(() => {
  const capturedPassengerInserts: unknown[] = [];
  const capturedTripUpdates: Record<string, unknown>[] = [];
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockTransaction = vi.fn();
  return {
    capturedPassengerInserts,
    capturedTripUpdates,
    mockLimit,
    mockWhere,
    mockFrom,
    mockSelect,
    mockTransaction,
  };
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
  return {
    ...makeDrizzleOrmMock(),
    // Serialize tagged template so captured SET values carry numeric deltas.
    // e.g. sql`reserved_seats + ${0}` → "reserved_seats + 0"
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]): string => {
        let r = "";
        strings.forEach((s, i) => {
          r += s;
          if (i < values.length) r += String(values[i]);
        });
        return r;
      },
      { raw: vi.fn() },
    ),
  };
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

interface QueryChain extends Promise<unknown[]> {
  limit(n?: number): Promise<unknown[]>;
  where(cond?: unknown): QueryChain;
  from(table?: unknown): QueryChain;
  orderBy(...args: unknown[]): Promise<unknown[]>;
}

function makeChain(data: unknown[]): QueryChain {
  return Object.assign(Promise.resolve(data), {
    limit: vi.fn().mockResolvedValue(data),
    where: vi.fn().mockImplementation(() => makeChain(data)),
    from: vi.fn().mockImplementation(() => makeChain(data)),
    orderBy: vi.fn().mockResolvedValue(data),
  }) as QueryChain;
}

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  const noop = (..._args: unknown[]) => {};
  req.log = {
    trace: noop, debug: noop, info: noop,
    warn: noop, error: noop, fatal: noop,
  } as never;
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
  name: "Bebê Silva",
  email: "mae@example.com",
  whatsapp: "11999990000",
  cpf: null,
  birthDate: null,
  rg: null,
  referralCode: null,
};

const FAKE_RESERVATION = {
  id: "gen-id",
  tenantId: "tenant-001",
  tripId: "trip-001",
  clientId: "client-001",
  seats: [] as string[],
  status: "pending",
  voucherCode: "VCHR-0001",
  reservationNumber: "AG-EX-202507-0001",
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

// ---------------------------------------------------------------------------
// Transaction mock builder
//
// Captures:
//  • passenger inserts: values with an "ageCategory" field
//  • trip counter updates: SET payloads with "reservedSeats" or "availableSeats"
// ---------------------------------------------------------------------------

function buildTxMock() {
  return {
    execute: vi.fn().mockResolvedValue({
      rows: [{ id: "trip-001", available_seats: 10, type: "nacional" }],
      rowCount: 1,
    }),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals: unknown) => {
        if (vals && typeof vals === "object" && "ageCategory" in (vals as Record<string, unknown>)) {
          capturedPassengerInserts.push(vals);
        }
        return Promise.resolve([]);
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((setArg: Record<string, unknown>) => {
        if ("reservedSeats" in setArg || "availableSeats" in setArg) {
          capturedTripUpdates.push(setArg);
        }
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
    select: vi.fn().mockImplementation(() => makeChain([])),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/reservations — isOnLap=true (criança de colo)", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockReset();
    capturedPassengerInserts.length = 0;
    capturedTripUpdates.length = 0;

    requireAuthMock.mockResolvedValue(FAKE_USER as never);

    // Default chain: db.select().from().where().limit() returns []
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue([]);
  });

  function arrangeSelectSequence() {
    // Slot 1: pre-transaction client lookup
    mockLimit.mockResolvedValueOnce([FAKE_CLIENT]);
    // Slot 2: duplicate reservation check → no duplicate found
    mockLimit.mockResolvedValueOnce([]);
    // Slot 3: post-transaction reservation select (after db.transaction resolves)
    mockLimit.mockResolvedValueOnce([FAKE_RESERVATION]);
    // Slot 4: formatReservation → trip
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]);
    // Slot 5: formatReservation → client
    mockLimit.mockResolvedValueOnce([FAKE_CLIENT]);
    // Slot 6+: formatReservation → emailLog and any fire-and-forget selects → [] (default)
  }

  const LAP_CHILD_BODY = {
    tripId: "trip-001",
    clientId: "client-001",
    seats: [] as string[],
    totalValue: 500,
    isOnLap: true,
  };

  it("creates the primary passenger with ageCategory='baby', seatNumber=null, isChildUnder7=true", async () => {
    const app = buildApp();
    arrangeSelectSequence();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(buildTxMock()),
    );

    const res = await request(app)
      .post("/api/reservations")
      .send(LAP_CHILD_BODY);

    expect(res.status).toBe(201);

    // Exactly one passenger insert (no placeholder passengers for additional seats)
    expect(capturedPassengerInserts).toHaveLength(1);

    const pax = capturedPassengerInserts[0] as Record<string, unknown>;
    expect(pax.ageCategory).toBe("baby");
    expect(pax.seatNumber).toBeNull();
    expect(pax.isChildUnder7).toBe(true);
    expect(pax.isPrimary).toBe(true);
  });

  it("does not decrement trip available_seats or increment reserved_seats (seatsCount=0)", async () => {
    const app = buildApp();
    arrangeSelectSequence();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(buildTxMock()),
    );

    const res = await request(app)
      .post("/api/reservations")
      .send(LAP_CHILD_BODY);

    expect(res.status).toBe(201);

    // One trip counter update must exist
    expect(capturedTripUpdates).toHaveLength(1);

    const tripSet = capturedTripUpdates[0];
    // Both counters are updated with delta 0 — no capacity consumed
    expect(String(tripSet.reservedSeats)).toContain("+ 0");
    expect(String(tripSet.availableSeats)).toContain("- 0");
  });

  it("returns 201 with seats=[] and isOnLap=true (no seating conflicts)", async () => {
    const app = buildApp();
    arrangeSelectSequence();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(buildTxMock()),
    );

    const res = await request(app)
      .post("/api/reservations")
      .send(LAP_CHILD_BODY);

    expect(res.status).toBe(201);
    // Response includes the reservation id
    expect(res.body.id).toBeDefined();
  });
});

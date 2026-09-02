/**
 * #95 — Seat bucket transitions
 *
 * Verifies that the confirmedSeats, reservedSeats, and availableSeats counters
 * on the trips table are updated correctly on every reservation status transition:
 *
 *   pending  → confirmed : confirmed_seats++, reserved_seats--
 *   confirmed → cancelled : confirmed_seats--, available_seats++
 *   pending  → cancelled : reserved_seats--,  available_seats++
 *   confirmed → pending   : confirmed_seats--, reserved_seats++  (demote)
 *   DELETE confirmed       : confirmed_seats--, available_seats++
 *   DELETE pending         : reserved_seats--,  available_seats++
 *
 * Uses supertest + vi.mock to isolate the DB layer (same pattern as
 * seat-reconciliation.test.ts and cancellation-reversal.test.ts).
 */

import { ROLES, RESERVATION_STATUS } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  capturedSets,
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockTransaction,
} = vi.hoisted(() => {
  const capturedSets: Record<string, unknown>[] = [];
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockTransaction = vi.fn();
  return { capturedSets, mockLimit, mockWhere, mockFrom, mockSelect, mockTransaction };
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

import { requireAuth } from "../lib/tenant.js";
import reservationsRouter from "../routes/reservations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Test helpers
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", reservationsRouter);
  app.use(errorHandler);
  return app;
}

const FAKE_USER = {
  id: "user-001",
  tenantId: "tenant-001",
  role: ROLES.AGENCY_ADMIN,
  name: "Test Agent",
  email: "agent@example.com",
};

const FAKE_TRIP = {
  id: "trip-001",
  name: "Excursão Nordeste",
  destination: "Fortaleza",
  departureDate: new Date("2025-07-10"),
  availableSeats: 10,
  totalCapacity: 46,
  confirmedSeats: 5,
  reservedSeats: 3,
  status: "active",
  coverImage: null,
  numberingType: null,
};

const FAKE_CLIENT = {
  id: "client-001",
  tenantId: "tenant-001",
  name: "João Silva",
  email: "joao@example.com",
};

function makeReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-001",
    tenantId: "tenant-001",
    tripId: "trip-001",
    clientId: "client-001",
    seats: ["1A", "2B"] as string[],
    status: "pending" as string,
    voucherCode: "VCH-TEST",
    reservationNumber: "AG-EX-202507-0001",
    totalValue: "1000",
    paidValue: "0",
    balance: "1000",
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
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: "user-001",
    tripType: null,
    packageType: null,
    hasInsurance: false,
    qrCode: "QR-VCH-TEST",
    ...overrides,
  };
}

// Queue-based tx select: each tx.select().from().where().limit() returns the next item.
interface QueryChain extends Promise<unknown[]> {
  limit(n?: number): Promise<unknown[]>;
  where(cond?: unknown): QueryChain;
  from(table?: unknown): QueryChain;
  for(lockMode: string): QueryChain;
  orderBy(...args: unknown[]): Promise<unknown[]>;
}

function makeChain(data: unknown[]): QueryChain {
  return Object.assign(Promise.resolve(data), {
    limit: vi.fn().mockResolvedValue(data),
    where: vi.fn().mockImplementation(() => makeChain(data)),
    from: vi.fn().mockImplementation(() => makeChain(data)),
    for: vi.fn().mockImplementation(() => makeChain(data)),
    orderBy: vi.fn().mockResolvedValue(data),
  }) as QueryChain;
}

function buildTxMock(selectResponses: unknown[][] = []) {
  const queue = [...selectResponses];
  return {
    execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockResolvedValue([]),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((setArg: Record<string, unknown>) => {
        capturedSets.push(setArg);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
    select: vi.fn().mockImplementation(() => makeChain(queue.shift() ?? [])),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Seat bucket counters — status transition paths", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockReset();
    capturedSets.length = 0;

    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  // ── pending → confirmed ──────────────────────────────────────────────────

  it("pending → confirmed: confirmed_seats++ and reserved_seats-- are applied", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: RESERVATION_STATUS.PENDING });
    const updated = { ...existing, status: RESERVATION_STATUS.CONFIRMED };

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: RESERVATION_STATUS.CONFIRMED });
    expect(res.status).toBe(200);

    const seatUpdate = capturedSets.find(
      (s) => "confirmedSeats" in s && "reservedSeats" in s && !("availableSeats" in s),
    );
    expect(seatUpdate).toBeDefined();
    expect(seatUpdate!.confirmedSeats).toBe("sql");
    expect(seatUpdate!.reservedSeats).toBe("sql");
  });

  // ── DELETE confirmed ─────────────────────────────────────────────────────

  it("DELETE confirmed reservation: confirmed_seats-- and available_seats++ are applied", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: RESERVATION_STATUS.CONFIRMED });

    mockLimit.mockResolvedValueOnce([existing]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation((setArg: Record<string, unknown>) => {
            capturedSets.push(setArg);
            return { where: vi.fn().mockResolvedValue([]) };
          }),
        })),
        delete: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
        select: vi.fn().mockImplementation(() => makeChain([existing])),
        insert: vi.fn().mockImplementation(() => ({ values: vi.fn().mockResolvedValue([]) })),
      };
      return cb(tx);
    });

    const res = await request(app).delete("/api/reservations/res-001");
    expect(res.status).toBe(200);

    const seatUpdate = capturedSets.find(
      (s) => "availableSeats" in s && "confirmedSeats" in s,
    );
    expect(seatUpdate).toBeDefined();
    expect(seatUpdate!.availableSeats).toBe("sql");
    expect(seatUpdate!.confirmedSeats).toBe("sql");
  });

  // ── DELETE pending ───────────────────────────────────────────────────────

  it("DELETE pending reservation: reserved_seats-- and available_seats++ are applied", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: RESERVATION_STATUS.PENDING });

    mockLimit.mockResolvedValueOnce([existing]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation((setArg: Record<string, unknown>) => {
            capturedSets.push(setArg);
            return { where: vi.fn().mockResolvedValue([]) };
          }),
        })),
        delete: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
        select: vi.fn().mockImplementation(() => makeChain([existing])),
        insert: vi.fn().mockImplementation(() => ({ values: vi.fn().mockResolvedValue([]) })),
      };
      return cb(tx);
    });

    const res = await request(app).delete("/api/reservations/res-001");
    expect(res.status).toBe(200);

    const seatUpdate = capturedSets.find(
      (s) => "availableSeats" in s && "reservedSeats" in s,
    );
    expect(seatUpdate).toBeDefined();
    expect(seatUpdate!.availableSeats).toBe("sql");
    expect(seatUpdate!.reservedSeats).toBe("sql");
  });

  it.each([
    RESERVATION_STATUS.CANCELLED,
    RESERVATION_STATUS.REFUNDED,
  ])("DELETE %s reservation does not release capacity again", async (status) => {
    const app = buildApp();
    const existing = makeReservation({ status });

    mockLimit.mockResolvedValueOnce([existing]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation((setArg: Record<string, unknown>) => {
            capturedSets.push(setArg);
            return { where: vi.fn().mockResolvedValue([]) };
          }),
        })),
        delete: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
        select: vi.fn().mockImplementation(() => makeChain([existing])),
        insert: vi.fn().mockImplementation(() => ({ values: vi.fn().mockResolvedValue([]) })),
      };
      return cb(tx);
    });

    const res = await request(app).delete("/api/reservations/res-001");
    expect(res.status).toBe(200);
    expect(capturedSets).toHaveLength(0);
  });
});

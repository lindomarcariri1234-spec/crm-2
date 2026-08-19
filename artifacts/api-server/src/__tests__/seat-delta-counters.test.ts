/**
 * Seat counter delta tests — PATCH /reservations/:id
 *
 * Verifies that when the seats ARRAY SIZE changes (Gap 1 fix) the correct
 * trip counter bucket is updated via SQL expressions, even when the
 * reservation STATUS does not change.  This is distinct from the status-
 * transition paths already covered in seat-bucket-transitions.test.ts.
 *
 * Covered cases:
 *   confirmed + seats 2→3  : confirmedSeats += delta, availableSeats -= delta
 *   confirmed + seats 3→2  : confirmedSeats -= delta, availableSeats += delta
 *   pending   + seats 2→3  : reservedSeats  += delta, availableSeats -= delta
 *   pending   + seats 3→2  : reservedSeats  -= delta, availableSeats += delta
 *   any       + same count : no extra trip counter update
 *   cancelled (any)        : seat delta block skipped entirely
 */

import { ROLES, RESERVATION_STATUS } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks — identical setup to seat-bucket-transitions.test.ts
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
// Module mocks — same table list as seat-bucket-transitions.test.ts
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
  reservationInstallmentsTable: {},
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return {
    ...makeDrizzleOrmMock(),
    // Serialize the tagged template so captured SET values include the actual numeric delta.
    // e.g. sql`confirmed_seats + ${1}` → "confirmed_seats + 1"
    // This lets assertions verify direction (+/-) not just presence of a SQL expression.
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

// ---------------------------------------------------------------------------
// App & helpers
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import reservationsRouter from "../routes/reservations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

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
  totalCapacity: 46,
  confirmedSeats: 5,
  reservedSeats: 3,
  availableSeats: 10,
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
    status: RESERVATION_STATUS.PENDING as string,
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

function makePassenger(
  id: string,
  isPrimary: boolean,
  seatNumber: string,
  name = "A preencher",
  cpf: string | null = null,
) {
  return {
    id,
    reservationId: "res-001",
    name,
    cpf,
    rg: null,
    birthDate: null,
    ageCategory: "adult",
    seatNumber,
    isChildUnder7: false,
    isPrimary,
    checkedInAt: null,
  };
}

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

describe("PATCH /api/reservations/:id — seat COUNT delta updates correct bucket", () => {
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

  // ── confirmed + seats increase (2 → 3) ──────────────────────────────────

  it("confirmed + seats 2→3: confirmedSeats incremented, availableSeats decremented", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: RESERVATION_STATUS.CONFIRMED, seats: ["1A", "2B"] });
    const updated = { ...existing, seats: ["1A", "2B", "3C"] };
    const pax1 = makePassenger("pax-1", true, "1A", "João Silva", "111");
    const pax2 = makePassenger("pax-2", false, "2B");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [pax1, pax2]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ seats: ["1A", "2B", "3C"] });

    expect(res.status).toBe(200);

    // Seat delta fires on confirmed → confirmedSeats + availableSeats, no reservedSeats.
    // seatDelta = 3 - 2 = +1: confirmed_seats + 1 (increase), available_seats - 1 (decrease).
    const tripDelta = capturedSets.find(
      (s) => "confirmedSeats" in s && "availableSeats" in s && !("reservedSeats" in s) && !("seats" in s),
    );
    expect(tripDelta).toBeDefined();
    // Verify direction: bucket grows (+1) and available shrinks (-1)
    expect(String(tripDelta!.confirmedSeats)).toContain("+ 1");
    expect(String(tripDelta!.availableSeats)).toContain("- 1");
  });

  // ── confirmed + seats decrease (3 → 1) ──────────────────────────────────

  it("confirmed + seats 3→1: confirmedSeats decremented, availableSeats incremented", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: RESERVATION_STATUS.CONFIRMED, seats: ["1A", "2B", "3C"] });
    const updated = { ...existing, seats: ["1A"] };
    const pax1 = makePassenger("pax-1", true, "1A", "João Silva", "111");
    const pax2 = makePassenger("pax-2", false, "2B");
    const pax3 = makePassenger("pax-3", false, "3C");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [pax1, pax2, pax3]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ seats: ["1A"] });

    expect(res.status).toBe(200);

    // seatDelta = 1 - 3 = -2: confirmed_seats + (-2) (shrinks), available_seats - (-2) (grows).
    const tripDelta = capturedSets.find(
      (s) => "confirmedSeats" in s && "availableSeats" in s && !("reservedSeats" in s) && !("seats" in s),
    );
    expect(tripDelta).toBeDefined();
    // Verify direction: bucket shrinks (+ negative delta) and available grows (- negative delta)
    expect(String(tripDelta!.confirmedSeats)).toContain("+ -2");
    expect(String(tripDelta!.availableSeats)).toContain("- -2");
  });

  // ── pending + seats increase (2 → 3) ────────────────────────────────────

  it("pending + seats 2→3: reservedSeats incremented, availableSeats decremented", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: RESERVATION_STATUS.PENDING, seats: ["1A", "2B"] });
    const updated = { ...existing, seats: ["1A", "2B", "3C"] };
    const pax1 = makePassenger("pax-1", true, "1A", "João Silva", "111");
    const pax2 = makePassenger("pax-2", false, "2B");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [pax1, pax2]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ seats: ["1A", "2B", "3C"] });

    expect(res.status).toBe(200);

    // seatDelta = 3 - 2 = +1: reserved_seats + 1 (increase), available_seats - 1 (decrease).
    const tripDelta = capturedSets.find(
      (s) => "reservedSeats" in s && "availableSeats" in s && !("confirmedSeats" in s) && !("seats" in s),
    );
    expect(tripDelta).toBeDefined();
    // Verify direction: bucket grows (+1) and available shrinks (-1)
    expect(String(tripDelta!.reservedSeats)).toContain("+ 1");
    expect(String(tripDelta!.availableSeats)).toContain("- 1");
  });

  // ── pending + seats decrease (3 → 1) ────────────────────────────────────

  it("pending + seats 3→1: reservedSeats decremented, availableSeats incremented", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: RESERVATION_STATUS.PENDING, seats: ["1A", "2B", "3C"] });
    const updated = { ...existing, seats: ["1A"] };
    const pax1 = makePassenger("pax-1", true, "1A", "João Silva", "111");
    const pax2 = makePassenger("pax-2", false, "2B");
    const pax3 = makePassenger("pax-3", false, "3C");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [pax1, pax2, pax3]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ seats: ["1A"] });

    expect(res.status).toBe(200);

    // seatDelta = 1 - 3 = -2: reserved_seats + (-2) (shrinks), available_seats - (-2) (grows).
    const tripDelta = capturedSets.find(
      (s) => "reservedSeats" in s && "availableSeats" in s && !("confirmedSeats" in s) && !("seats" in s),
    );
    expect(tripDelta).toBeDefined();
    // Verify direction: bucket shrinks (+ negative delta) and available grows (- negative delta)
    expect(String(tripDelta!.reservedSeats)).toContain("+ -2");
    expect(String(tripDelta!.availableSeats)).toContain("- -2");
  });

  // ── no delta when seat COUNT stays the same ──────────────────────────────

  it("seats replaced but count unchanged (2→2): no extra trip counter update", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: RESERVATION_STATUS.CONFIRMED, seats: ["1A", "2B"] });
    const updated = { ...existing, seats: ["5F", "6G"] };
    const pax1 = makePassenger("pax-1", true, "1A", "João Silva", "111");
    const pax2 = makePassenger("pax-2", false, "2B");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [pax1, pax2]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ seats: ["5F", "6G"] });

    expect(res.status).toBe(200);

    // Only the reservation row itself is updated; no separate trip counter update
    const tripCounterUpdate = capturedSets.find(
      (s) => ("confirmedSeats" in s || "reservedSeats" in s) && !("seats" in s),
    );
    expect(tripCounterUpdate).toBeUndefined();
  });

  // ── no extra delta when isBeingCancelled ─────────────────────────────────

  it("cancellation path: seat delta block is skipped, only one trip counter update fires", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: RESERVATION_STATUS.PENDING, seats: ["1A", "2B"] });
    const updated = { ...existing, status: RESERVATION_STATUS.CANCELLED, seats: [] as string[] };

    mockLimit.mockResolvedValueOnce([existing]);
    // cancellation tx path: payments → [], loyaltyMember → [null], re-fetch → [updated]
    const tx = buildTxMock([[], [null], [updated]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app)
      .patch("/api/reservations/res-001")
      .send({ status: RESERVATION_STATUS.CANCELLED, seats: [] });

    expect(res.status).toBe(200);

    // Exactly one trip counter update from the cancellation block — the delta block must NOT fire
    const tripAvailableUpdates = capturedSets.filter((s) => "availableSeats" in s);
    expect(tripAvailableUpdates).toHaveLength(1);
  });
});

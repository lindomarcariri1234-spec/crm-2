import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const {
  capturedPassengerInserts,
  capturedSets,
  capturedDeletes,
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockTransaction,
} = vi.hoisted(() => {
  const capturedPassengerInserts: Record<string, unknown>[] = [];
  const capturedSets: Record<string, unknown>[] = [];
  const capturedDeletes: unknown[] = [];
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockTransaction = vi.fn();
  return { capturedPassengerInserts, capturedSets, capturedDeletes, mockLimit, mockWhere, mockFrom, mockSelect, mockTransaction };
});

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
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
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

import { inArray } from "drizzle-orm";
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
  availableSeats: 10,
  totalCapacity: 46,
  status: "active",
  coverImage: null,
};

const FAKE_CLIENT = {
  id: "client-001",
  tenantId: "tenant-001",
  name: "João Silva",
  email: "joao@example.com",
  cpf: "111.222.333-44",
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
    seats: ["1A", "2B"] as string[],
    status: "pending",
    voucherCode: "VCH-TEST",
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
    checkedInAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: "user-001",
    tripType: null,
    packageType: null,
    hasInsurance: false,
    reservationNumber: "AG-EX-202507-0001",
    qrCode: "QR-VCH-TEST",
    ...overrides,
  };
}

function makePassenger(id: string, isPrimary: boolean, seatNumber: string, name = "A preencher", cpf: string | null = null) {
  return { id, reservationId: "res-001", name, cpf, rg: null, birthDate: null, ageCategory: "adult", seatNumber, isChildUnder7: false, isPrimary, checkedInAt: null };
}

// Builds a chainable thenable where every link in the chain resolves to `data`.
// Supports: .from().where().limit(), .from().where().orderBy(), etc.
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

// InsertResult supports both `await values()` and `await values().onConflictDoNothing()`.
interface InsertResult extends Promise<unknown[]> {
  onConflictDoNothing(): Promise<unknown[]>;
}

function buildTxMock(selectResponses: unknown[][] = []) {
  const queue = [...selectResponses];
  return {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
        capturedPassengerInserts.push(vals);
        return Object.assign(Promise.resolve([]), {
          onConflictDoNothing: vi.fn().mockResolvedValue([]),
        }) as InsertResult;
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((setArg: Record<string, unknown>) => {
        capturedSets.push(setArg);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation((whereArg: unknown) => {
        capturedDeletes.push(whereArg);
        return Promise.resolve([]);
      }),
    })),
    select: vi.fn().mockImplementation(() => makeChain(queue.shift() ?? [])),
  };
}

describe("PATCH /api/reservations/:id — seat-to-passenger reconciliation", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    capturedPassengerInserts.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;

    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("adds placeholder passengers when seat count increases", async () => {
    const app = buildApp();
    const existing = makeReservation({ seats: ["1A", "2B"] });
    const updated = { ...existing, seats: ["1A", "2B", "3C"] };
    const primaryPax = makePassenger("pax-primary", true, "1A", "João Silva", "111");
    const placeholder = makePassenger("pax-ph1", false, "2B");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [primaryPax, placeholder]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app).patch("/api/reservations/res-001").send({ seats: ["1A", "2B", "3C"] });
    expect(res.status).toBe(200);

    const paxInserts = capturedPassengerInserts.filter((i) => i.reservationId !== undefined);
    expect(paxInserts).toHaveLength(1);
    expect(paxInserts[0].seatNumber).toBe("3C");
    expect(paxInserts[0].name).toBe("A preencher");
    expect(paxInserts[0].isPrimary).toBe(false);

    const seatUpdates = capturedSets.filter((s) => Object.prototype.hasOwnProperty.call(s, "seatNumber"));
    expect(seatUpdates).toHaveLength(2);
    expect(seatUpdates[0].seatNumber).toBe("1A");
    expect(seatUpdates[1].seatNumber).toBe("2B");

    expect(capturedDeletes).toHaveLength(0);
  });

  it("removes only non-primary passengers and preserves the primary when seat count decreases", async () => {
    const app = buildApp();
    const existing = makeReservation({ seats: ["1A", "2B", "3C"] });
    const updated = { ...existing, seats: ["1A"] };
    const primaryPax = makePassenger("pax-primary", true, "1A", "João Silva", "111");
    const ph1 = makePassenger("pax-ph1", false, "2B");
    const ph2 = makePassenger("pax-ph2", false, "3C");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [primaryPax, ph1, ph2]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app).patch("/api/reservations/res-001").send({ seats: ["1A"] });
    expect(res.status).toBe(200);

    // One delete call for the two non-primary passengers
    expect(capturedDeletes).toHaveLength(1);

    // inArray was called with the non-primary IDs only — primary must not be in the set
    const inArrayMock = vi.mocked(inArray);
    const deleteCall = inArrayMock.mock.calls.find((c) => Array.isArray(c[1]));
    expect(deleteCall).toBeDefined();
    const deletedIds = deleteCall![1] as string[];
    expect(deletedIds).toContain("pax-ph1");
    expect(deletedIds).toContain("pax-ph2");
    expect(deletedIds).not.toContain("pax-primary");

    // No new inserts
    expect(capturedPassengerInserts.filter((i) => i.reservationId !== undefined)).toHaveLength(0);

    // Primary's seat is remapped to the surviving seat
    const seatUpdates = capturedSets.filter((s) => Object.prototype.hasOwnProperty.call(s, "seatNumber"));
    expect(seatUpdates).toHaveLength(1);
    expect(seatUpdates[0].seatNumber).toBe("1A");
  });

  it("updates seat numbers in order when seat map changes but count stays the same", async () => {
    const app = buildApp();
    const existing = makeReservation({ seats: ["1A", "2B"] });
    const updated = { ...existing, seats: ["5F", "6G"] };
    const primaryPax = makePassenger("pax-primary", true, "1A", "João Silva", "111");
    const placeholder = makePassenger("pax-ph1", false, "2B");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [primaryPax, placeholder]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app).patch("/api/reservations/res-001").send({ seats: ["5F", "6G"] });
    expect(res.status).toBe(200);

    expect(capturedPassengerInserts.filter((i) => i.reservationId !== undefined)).toHaveLength(0);
    expect(capturedDeletes).toHaveLength(0);

    const seatUpdates = capturedSets.filter((s) => Object.prototype.hasOwnProperty.call(s, "seatNumber"));
    expect(seatUpdates).toHaveLength(2);
    expect(seatUpdates[0].seatNumber).toBe("5F");
    expect(seatUpdates[1].seatNumber).toBe("6G");
  });

  it("returns 409 PASSENGERS_FILLED when reducing seats would remove a non-primary passenger with filled details", async () => {
    const app = buildApp();
    const existing = makeReservation({ seats: ["1A", "2B", "3C"] });
    const updated = { ...existing, seats: ["1A"] };
    const primaryPax = makePassenger("pax-primary", true, "1A", "João Silva", "111.222.333-44");
    const filledPax = makePassenger("pax-filled", false, "2B", "Maria Souza", "999.888.777-66");
    const ph = makePassenger("pax-ph1", false, "3C");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [primaryPax, filledPax, ph]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await request(app).patch("/api/reservations/res-001").send({ seats: ["1A"] });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PASSENGERS_FILLED");
    expect(Array.isArray(res.body.affectedPassengers)).toBe(true);
    const affected = res.body.affectedPassengers as { id: string }[];
    expect(affected.some((p) => p.id === "pax-filled")).toBe(true);
    expect(affected.every((p) => p.id !== "pax-primary")).toBe(true);

    expect(capturedDeletes).toHaveLength(0);
  });

  it("returns 409 PASSENGERS_FILLED when clearing all seats (newCount=0) with filled passengers", async () => {
    const app = buildApp();
    const existing = makeReservation({ seats: ["1A", "2B"] });
    const updated = { ...existing, seats: [] as string[] };
    const primaryPax = makePassenger("pax-primary", true, "1A", "João Silva", "111.222.333-44");
    const filledPax = makePassenger("pax-filled", false, "2B", "Carlos Lima", "555.444.333-22");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [primaryPax, filledPax]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await request(app).patch("/api/reservations/res-001").send({ seats: [] });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PASSENGERS_FILLED");
    expect(Array.isArray(res.body.affectedPassengers)).toBe(true);

    expect(capturedDeletes).toHaveLength(0);
  });

  it("allows reducing seats when only blank placeholder passengers are removed", async () => {
    const app = buildApp();
    const existing = makeReservation({ seats: ["1A", "2B", "3C"] });
    const updated = { ...existing, seats: ["1A", "2B"] };
    const primaryPax = makePassenger("pax-primary", true, "1A", "João Silva", "111.222.333-44");
    const ph1 = makePassenger("pax-ph1", false, "2B");
    const ph2 = makePassenger("pax-ph2", false, "3C");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [primaryPax, ph1, ph2]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app).patch("/api/reservations/res-001").send({ seats: ["1A", "2B"] });

    expect(res.status).toBe(200);
    expect(capturedDeletes).toHaveLength(1);
  });

  it("bootstraps primary from client data and creates placeholders when no passengers exist", async () => {
    const app = buildApp();
    const existing = makeReservation({ seats: [] as string[] });
    const updated = { ...existing, seats: ["1A", "2B"] };

    mockLimit.mockResolvedValueOnce([existing]);
    // tx selects: [0] re-fetch reservation, [1] current passengers (empty), [2] client lookup
    const tx = buildTxMock([[updated], [], [FAKE_CLIENT]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app).patch("/api/reservations/res-001").send({ seats: ["1A", "2B"] });
    expect(res.status).toBe(200);

    const paxInserts = capturedPassengerInserts.filter((i) => i.reservationId !== undefined);
    expect(paxInserts).toHaveLength(2);

    const primary = paxInserts.find((p) => p.isPrimary === true);
    expect(primary).toBeDefined();
    expect(primary!.name).toBe(FAKE_CLIENT.name);
    expect(primary!.seatNumber).toBe("1A");

    const placeholder = paxInserts.find((p) => p.isPrimary !== true);
    expect(placeholder).toBeDefined();
    expect(placeholder!.name).toBe("A preencher");
    expect(placeholder!.seatNumber).toBe("2B");

    expect(capturedDeletes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Seat bucket counter tests — status transitions (task #95)
// ---------------------------------------------------------------------------

describe("PATCH /api/reservations/:id — seat bucket transitions", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    capturedPassengerInserts.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;

    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("pending → confirmed: moves seats from reservedSeats to confirmedSeats", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: "pending", seats: ["1A", "2B"] });
    const updated = { ...existing, status: "confirmed" };
    const primaryPax = makePassenger("pax-1", true, "1A", "João Silva", "111.222.333-44");
    const placeholder = makePassenger("pax-2", false, "2B");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [primaryPax, placeholder]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app).patch("/api/reservations/res-001").send({ status: "confirmed" });
    expect(res.status).toBe(200);

    const tripUpdate = capturedSets.find(
      (s) => Object.prototype.hasOwnProperty.call(s, "confirmedSeats") && Object.prototype.hasOwnProperty.call(s, "reservedSeats"),
    );
    expect(tripUpdate).toBeDefined();
    expect(tripUpdate).toMatchObject({ confirmedSeats: expect.anything(), reservedSeats: expect.anything() });
  });

  it("confirmed → pending: reverts seats from confirmedSeats back to reservedSeats", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: "confirmed", seats: ["1A", "2B"] });
    const updated = { ...existing, status: "pending" };
    const primaryPax = makePassenger("pax-1", true, "1A", "João Silva", "111.222.333-44");
    const placeholder = makePassenger("pax-2", false, "2B");

    mockLimit.mockResolvedValueOnce([existing]);
    const tx = buildTxMock([[updated], [primaryPax, placeholder]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app).patch("/api/reservations/res-001").send({ status: "pending" });
    expect(res.status).toBe(200);

    const tripUpdate = capturedSets.find(
      (s) => Object.prototype.hasOwnProperty.call(s, "confirmedSeats") && Object.prototype.hasOwnProperty.call(s, "reservedSeats"),
    );
    expect(tripUpdate).toBeDefined();
    expect(tripUpdate).toMatchObject({ confirmedSeats: expect.anything(), reservedSeats: expect.anything() });
  });

  it("pending → cancelled: releases seats back to availableSeats", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: "pending", seats: ["1A", "2B"] });
    const updated = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);
    // Reversal 4 always runs when clientId exists: (1) paymentsTable select → [],
    // (2) loyaltyMembersTable.limit(1) → null (skip clawback), then reservation re-fetch.
    const tx = buildTxMock([[], [null], [updated]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app).patch("/api/reservations/res-001").send({ status: "cancelled" });
    expect(res.status).toBe(200);

    const tripUpdate = capturedSets.find(
      (s) => Object.prototype.hasOwnProperty.call(s, "availableSeats"),
    );
    expect(tripUpdate).toBeDefined();
  });

  it("confirmed → cancelled: releases seats back to availableSeats", async () => {
    const app = buildApp();
    const existing = makeReservation({ status: "confirmed", seats: ["1A", "2B"] });
    const updated = { ...existing, status: "cancelled" };

    mockLimit.mockResolvedValueOnce([existing]);
    // Reversal 4 always runs when clientId exists: (1) paymentsTable select → [],
    // (2) loyaltyMembersTable.limit(1) → null (skip clawback), then reservation re-fetch.
    const tx = buildTxMock([[], [null], [updated]]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]).mockResolvedValueOnce([FAKE_CLIENT]);

    const res = await request(app).patch("/api/reservations/res-001").send({ status: "cancelled" });
    expect(res.status).toBe(200);

    const tripUpdate = capturedSets.find(
      (s) => Object.prototype.hasOwnProperty.call(s, "availableSeats"),
    );
    expect(tripUpdate).toBeDefined();
  });
});

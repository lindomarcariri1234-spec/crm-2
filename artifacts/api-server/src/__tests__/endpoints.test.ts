import pino from "pino";
/**
 * Endpoint-level tests: reservation creation (POST /reservations) and
 * store order lookup email validation (GET /public/store/:slug/orders/:orderNumber).
 *
 * Uses supertest with vi.mock to drive real Express route handlers while
 * isolating external dependencies (DB, Clerk, queues).
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// vi.hoisted: shared mock builders must exist before any vi.mock factory runs
// ---------------------------------------------------------------------------

const {
  mockLimit,
  mockOrderBy,
  mockWhere,
  mockFrom,
  mockSelect,
  mockTransaction,
  capturedInserts,
  mockUpdate,
  mockUpdateSet,
  mockUpdateExecute,
  mockInsert,
  mockInsertValues,
} = vi.hoisted(() => {
  const capturedInserts: Record<string, unknown>[] = [];

  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
  const mockWhere = vi.fn(() => ({ limit: mockLimit, orderBy: mockOrderBy }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  const mockTransaction = vi.fn();

  // db.update(...).set(...).where(...) chain. The result of `.where()` must be
  // both awaitable (some handlers do `.where(...).catch(...)`) AND expose an
  // `.execute()` method (the suspended-referral-attempt fire-and-forget update
  // does `.where(...).execute().catch(...)`).
  const mockUpdateExecute = vi.fn(() => Promise.resolve([]));
  const mockUpdateWhere = vi.fn(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const thenable: any = Promise.resolve([]);
    thenable.execute = mockUpdateExecute;
    return thenable;
  });
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  // db.insert(...).values(...) chain. A single `mockInsertValues` mock is
  // shared so tests can assert on which values were passed.
  const mockInsertValues = vi.fn().mockResolvedValue([]);
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

  return {
    mockLimit,
    mockOrderBy,
    mockWhere,
    mockFrom,
    mockSelect,
    mockTransaction,
    capturedInserts,
    mockUpdate,
    mockUpdateSet,
    mockUpdateExecute,
    mockInsert,
    mockInsertValues,
  };
});

// ---------------------------------------------------------------------------
// Module mocks (resolved relative to THIS test file: src/__tests__/)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
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
  reservationInstallmentsTable: {},
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
  referralAttemptLogsTable: {},
}));

// Single source of truth for the drizzle-orm mock.  To add a new operator,
// edit helpers/drizzle-mock.ts — changes propagate here automatically.
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
  tryAddSeatClient: vi.fn(() => true),
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

// Mocks ../routes/payments.js (the "syncReservationCommission" + "recalculateClientFinancials" imports in reservations.ts)
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

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
    syncTripOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
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
  syncIsChildUnder7: vi.fn((ageCategory: string) => ageCategory === "child" || ageCategory === "baby"),
}));

// ---------------------------------------------------------------------------
// Import routers and middleware AFTER all mocks
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import { tryAddSeatClient, removeSeatClient } from "../lib/seat-sse.js";
import reservationsRouter from "../routes/reservations.js";
import storePublicRouter from "../routes/store-public.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Minimal Express app builders
// ---------------------------------------------------------------------------

// Stub middleware that attaches a no-op pino-compatible logger to req
// (the route handlers use req.log.error/info for fire-and-forget error logging)
function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  const noop = () => {};
  req.log = pino({ level: "silent" }) as unknown as typeof req.log;
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

function buildStorePublicApp() {
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

const FAKE_USER = {
  id: "user-001",
  tenantId: "tenant-001",
  role: ROLES.AGENCY_ADMIN,
  name: "Test User",
  email: "test@example.com",
};

const FAKE_CLIENT = {
  id: "client-001",
  tenantId: "tenant-001",
  name: "João Silva",
  email: "joao@example.com",
  cpf: null,
  rg: null,
  birthDate: null,
  whatsapp: null,
};

const FAKE_TRIP = {
  id: "trip-001",
  name: "Excursão ao Nordeste",
  destination: "Fortaleza, CE",
  departureDate: new Date("2025-07-10"),
  availableSeats: 10,
  totalCapacity: 46,
  status: "active",
  coverImage: null,
};

function makeFakeReservation(totalValue: string, paidValue: string, balance: string) {
  return {
    id: "gen-id",
    tenantId: FAKE_USER.tenantId,
    tripId: "trip-001",
    clientId: FAKE_CLIENT.id,
    seats: ["1A", "2B"],
    tripType: null,
    packageType: null,
    hasInsurance: false,
    totalValue,
    paidValue,
    balance,
    paymentMethod: null,
    installments: 1,
    commissionPercentage: null,
    commissionAmount: null,
    sellerId: null,
    status: "pending",
    voucherCode: "VCHR-0001",
    reservationNumber: "AG-EX-202507-0001",
    qrCode: "QR-VCHR-0001",
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
    createdById: FAKE_USER.id,
  };
}

const FAKE_STORE = {
  id: "store-001",
  tenantId: "tenant-001",
  slug: "minha-loja",
  isActive: true,
  name: "Minha Loja de Viagens",
};

const FAKE_ORDER = {
  id: "order-001",
  orderNumber: "ORD-001",
  customerEmail: "cliente@example.com",
  totalAmount: "500.00",
  status: "pending",
  items: [],
};

// ---------------------------------------------------------------------------
// Helpers for building the transaction mock
// ---------------------------------------------------------------------------

function buildTxMock() {
  return {
    execute: vi.fn().mockResolvedValue({
      rows: [{ id: "trip-001", available_seats: 10, type: "excursao" }],
    }),
    insert: vi.fn(() => ({
      values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
        capturedInserts.push(vals);
        return Promise.resolve([]);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    })),
    select: vi.fn(() => ({ from: mockFrom })),
  };
}

// ---------------------------------------------------------------------------
// Tests: POST /api/reservations
// ---------------------------------------------------------------------------

describe("POST /api/reservations — endpoint pricing computation", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    capturedInserts.length = 0;

    requireAuthMock.mockResolvedValue(FAKE_USER as never);

    // mockResolvedValueOnce queues survive clearAllMocks() — reset explicitly
    // so leftover unconsumed slots from previous tests don't corrupt the next test.
    mockLimit.mockReset();
    mockLimit.mockResolvedValue([]);
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });

    // Re-initialize insert chain after vi.clearAllMocks() wipes implementations.
    // Needed so syncClientDeal's fire-and-forget db.insert call has a working chain.
    mockInsertValues.mockResolvedValue([]);
    mockInsert.mockReturnValue({ values: mockInsertValues });

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(buildTxMock()),
    );
  });

  it("returns 400 when required body fields are missing", async () => {
    const app = buildReservationsApp();
    const res = await request(app)
      .post("/api/reservations")
      .send({ tripId: "trip-001" }); // missing clientId, seats, totalValue

    expect(res.status).toBe(400);
  });

  it("returns 400 when client is not found in tenant", async () => {
    const app = buildReservationsApp();
    mockLimit.mockResolvedValueOnce([]); // client lookup → not found

    const res = await request(app)
      .post("/api/reservations")
      .send({ tripId: "trip-001", clientId: "missing", seats: ["1A"], totalValue: 500 });

    expect(res.status).toBe(400);
  });

  it("inserts reservation with correct totalValue and balance (partial payment)", async () => {
    const app = buildReservationsApp();
    const fakeReservation = makeFakeReservation("1000", "300", "700");

    // Calls to mockLimit in order:
    // 1. client select
    // 2. duplicate reservation check → no duplicate (getTenantReservationPrefix is mocked)
    // 3. reservation re-fetch after transaction
    // 4. trip select inside formatReservation
    // 5. client select inside formatReservation
    // 6. autoRetryLog select inside formatReservation
    mockLimit
      .mockResolvedValueOnce([FAKE_CLIENT])     // client lookup
      .mockResolvedValueOnce([])                // duplicate reservation check → none
      .mockResolvedValueOnce([fakeReservation]) // post-tx reservation re-fetch
      .mockResolvedValueOnce([FAKE_TRIP])       // formatReservation: trip
      .mockResolvedValueOnce([FAKE_CLIENT])     // formatReservation: client
      .mockResolvedValueOnce([]);              // formatReservation: autoRetryLog

    const res = await request(app)
      .post("/api/reservations")
      .send({ tripId: "trip-001", clientId: FAKE_CLIENT.id, seats: ["1A", "2B"], totalValue: 1000, paidValue: 300 });

    expect(res.status).toBe(201);

    // Verify the INSERT captured inside the transaction has the computed balance
    const reservationInsert = capturedInserts[0] as Record<string, string>;
    expect(reservationInsert).toBeDefined();
    expect(reservationInsert["totalValue"]).toBe("1000");
    expect(reservationInsert["paidValue"]).toBe("300");
    expect(reservationInsert["balance"]).toBe("700"); // computeBalance(1000, 300)
  });

  it("inserts zero balance when reservation is fully paid", async () => {
    const app = buildReservationsApp();
    const fakeReservation = makeFakeReservation("500", "500", "0");

    mockLimit
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([])                // duplicate reservation check → none
      .mockResolvedValueOnce([fakeReservation])
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([]);              // formatReservation: autoRetryLog

    const res = await request(app)
      .post("/api/reservations")
      .send({ tripId: "trip-001", clientId: FAKE_CLIENT.id, seats: ["1A"], totalValue: 500, paidValue: 500 });

    expect(res.status).toBe(201);

    const reservationInsert = capturedInserts[0] as Record<string, string>;
    expect(reservationInsert["balance"]).toBe("0"); // computeBalance(500, 500)
  });

  it("balance is clamped to zero when paidValue exceeds totalValue (no negative balance)", async () => {
    const app = buildReservationsApp();
    const fakeReservation = makeFakeReservation("200", "300", "0");

    mockLimit
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([])                // duplicate reservation check → none
      .mockResolvedValueOnce([fakeReservation])
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([]);              // formatReservation: autoRetryLog

    await request(app)
      .post("/api/reservations")
      .send({ tripId: "trip-001", clientId: FAKE_CLIENT.id, seats: ["1A"], totalValue: 200, paidValue: 300 });

    const reservationInsert = capturedInserts[0] as Record<string, string>;
    // computeBalance(200, 300) = Math.max(0, -100) = 0
    expect(Number(reservationInsert["balance"])).toBeGreaterThanOrEqual(0);
    expect(reservationInsert["balance"]).toBe("0");
  });

  it("response body contains totalValue and balance from the created reservation", async () => {
    const app = buildReservationsApp();
    const fakeReservation = makeFakeReservation("800", "200", "600");

    mockLimit
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([])                // duplicate reservation check → none
      .mockResolvedValueOnce([fakeReservation])
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([]);              // formatReservation: autoRetryLog

    const res = await request(app)
      .post("/api/reservations")
      .send({ tripId: "trip-001", clientId: FAKE_CLIENT.id, seats: ["1A", "2B"], totalValue: 800, paidValue: 200 });

    expect(res.status).toBe(201);
    expect(res.body.totalValue).toBe(800);
    expect(res.body.balance).toBe(600);
  });

  it("creates a placeholder passenger for each additional seat when more than 1 seat is booked", async () => {
    const app = buildReservationsApp();
    const fakeReservation = { ...makeFakeReservation("1500", "0", "1500"), seats: ["1A", "2B", "3C"] };

    mockLimit
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([])                // duplicate reservation check → none
      .mockResolvedValueOnce([fakeReservation])
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([]);              // formatReservation: autoRetryLog

    const res = await request(app)
      .post("/api/reservations")
      .send({ tripId: "trip-001", clientId: FAKE_CLIENT.id, seats: ["1A", "2B", "3C"], totalValue: 1500 });

    expect(res.status).toBe(201);

    // capturedInserts contains: [0]=reservation, [1]=primary passenger, [2..N]=placeholder passengers
    const passengerInserts = capturedInserts.filter(
      (i) => (i as Record<string, unknown>).reservationId !== undefined,
    );
    // 3 seats → 1 primary + 2 placeholders = 3 passenger rows
    expect(passengerInserts).toHaveLength(3);

    const primary = passengerInserts.find(
      (p) => (p as Record<string, unknown>).isPrimary === true,
    );
    expect(primary).toBeDefined();
    expect((primary as Record<string, unknown>).name).toBe(FAKE_CLIENT.name);

    const placeholders = passengerInserts.filter(
      (p) => (p as Record<string, unknown>).isPrimary !== true,
    );
    expect(placeholders).toHaveLength(2);
    expect((placeholders[0] as Record<string, unknown>).name).toBe("A preencher");
    expect((placeholders[1] as Record<string, unknown>).name).toBe("A preencher");
  });

  // NOTE: The duplicate Pipeline card regression is now covered by the
  // dedicated unit tests in pipeline-deal-sync.test.ts (Scenarios A-F plus
  // the new fallback logic). The endpoint-level mock chain is too brittle
  // to reliably test a fire-and-forget that calls a service which in turn
  // calls pipeline-automation — three layers of async mocks, each with their
  // own select chains. Keep the unit tests as the source of truth.
});

// ---------------------------------------------------------------------------
// Tests: POST /api/reservations/import-manifest
//
// The import endpoint must never guess when a manifest reference is unsafe.
// These endpoint tests exercise the real matching loop and inspect the update
// payload so fields omitted from the manifest (especially check-in state) are
// not silently overwritten.
// ---------------------------------------------------------------------------

describe("POST /api/reservations/import-manifest — safe passenger matching", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  const manifestTrip = {
    id: "trip-manifest",
    name: "Excursão ao Nordeste",
    departureDate: new Date("2025-07-10T12:00:00.000Z"),
    boardingPoints: [],
  };

  const manifestReservation = {
    id: "reservation-manifest",
    tripId: manifestTrip.id,
    reservationNumber: "AG-EX-202507-0001",
  };

  function makePassenger(overrides: Record<string, unknown> = {}) {
    return {
      id: "passenger-manifest",
      reservationId: manifestReservation.id,
      name: "Maria de Fátima",
      cpf: "123.456.789-00",
      rg: "RG-ORIGINAL",
      birthDate: new Date("1990-04-12T12:00:00.000Z"),
      ageCategory: "adult",
      seatNumber: "1A",
      checkedInAt: new Date("2025-07-10T10:00:00.000Z"),
      phone: "85999990000",
      boardingLocationId: "boarding-original",
      ...overrides,
    };
  }

  function queueManifestDb(
    reservations: Array<{ reservation: typeof manifestReservation; trip: typeof manifestTrip }>,
    passengers: Array<Record<string, unknown>>,
  ) {
    const manifestWhere = mockWhere as unknown as {
      mockResolvedValueOnce(value: unknown): void;
    };
    const manifestFrom = mockFrom as unknown as {
      mockReset(): {
        mockReturnValueOnce(value: unknown): {
          mockReturnValue(value: unknown): void;
        };
      };
      mockReturnValueOnce(value: unknown): {
        mockReturnValue(value: unknown): void;
      };
    };

    mockLimit.mockReset();
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReset();
    mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
    manifestWhere.mockResolvedValueOnce(reservations);
    manifestFrom
      .mockReset()
      .mockReturnValueOnce({
        innerJoin: vi.fn(() => ({ where: mockWhere })),
      })
      .mockReturnValue({ where: mockWhere, limit: mockLimit });
    if (reservations.length > 0) {
      manifestWhere.mockResolvedValueOnce(passengers);
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    capturedInserts.length = 0;
    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    mockLimit.mockReset();
    mockLimit.mockResolvedValue([]);
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockWhere.mockReset();
    mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("skips duplicate rows in one file after processing the first row once", async () => {
    const passenger = makePassenger();
    queueManifestDb(
      [{ reservation: manifestReservation, trip: manifestTrip }],
      [passenger],
    );

    const row = {
      line: 2,
      reservationNumber: manifestReservation.reservationNumber,
      tripName: manifestTrip.name,
      departureDate: "2025-07-10",
      name: "Maria de Fátima Atualizada",
      cpf: "123.456.789-00",
      seatNumber: "2B",
    };
    const res = await request(buildReservationsApp())
      .post("/api/reservations/import-manifest")
      .send({ rows: [row, { ...row, line: 3 }] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 0, updated: 1, skipped: 1 });
    expect(res.body.errors).toEqual([
      "Linha 3: passageiro duplicado no arquivo para a mesma reserva.",
    ]);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({
      name: "Maria de Fátima Atualizada",
      cpf: "123.456.789-00",
      seatNumber: "2B",
    });
  });

  it("skips missing reservation references without attempting a passenger update", async () => {
    queueManifestDb([], []);

    const res = await request(buildReservationsApp())
      .post("/api/reservations/import-manifest")
      .send({
        rows: [{
          line: 2,
          reservationNumber: "AG-MISSING",
          tripName: "Excursão ao Nordeste",
          departureDate: "2025-07-10",
          name: "Pessoa Ausente",
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(res.body.errors[0]).toContain("não foi encontrada nesta agência");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("skips ambiguous reservation references instead of choosing one record", async () => {
    const secondReservation = {
      ...manifestReservation,
      id: "reservation-manifest-duplicate",
    };
    queueManifestDb(
      [
        { reservation: manifestReservation, trip: manifestTrip },
        { reservation: secondReservation, trip: manifestTrip },
      ],
      [makePassenger(), makePassenger({ id: "passenger-manifest-duplicate", reservationId: secondReservation.id })],
    );

    const res = await request(buildReservationsApp())
      .post("/api/reservations/import-manifest")
      .send({
        rows: [{
          line: 2,
          reservationNumber: manifestReservation.reservationNumber,
          tripName: manifestTrip.name,
          departureDate: "2025-07-10",
          name: "Maria de Fátima Atualizada",
          cpf: "123.456.789-00",
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(res.body.errors[0]).toContain("a referência da reserva AG-EX-202507-0001 é ambígua");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("matches CPF and name independently, preserves check-in, and leaves absent fields unchanged", async () => {
    const cpfPassenger = makePassenger({
      id: "passenger-cpf",
      name: "Pessoa CPF Original",
      cpf: "111.222.333-44",
      seatNumber: "1A",
    });
    const namePassenger = makePassenger({
      id: "passenger-name",
      name: "José da Silva",
      cpf: null,
      birthDate: new Date("1985-02-03T12:00:00.000Z"),
      seatNumber: "2B",
      checkedInAt: new Date("2025-07-10T11:00:00.000Z"),
    });
    queueManifestDb(
      [{ reservation: manifestReservation, trip: manifestTrip }],
      [cpfPassenger, namePassenger],
    );

    const res = await request(buildReservationsApp())
      .post("/api/reservations/import-manifest")
      .send({
        rows: [
          {
            line: 2,
            reservationNumber: manifestReservation.reservationNumber,
            tripName: manifestTrip.name,
            departureDate: "2025-07-10",
            name: "Pessoa CPF Atualizada",
            cpf: "11122233344",
          },
          {
            line: 3,
            reservationNumber: manifestReservation.reservationNumber,
            tripName: "EXCURSAO AO NORDESTE",
            departureDate: "2025-07-10",
            name: "JOSE DA SILVA",
            birthDate: "1985-02-03",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 0, updated: 2, skipped: 0 });
    expect(mockUpdate).toHaveBeenCalledTimes(2);

    expect(mockUpdateSet).toHaveBeenNthCalledWith(1, {
      name: "Pessoa CPF Atualizada",
      cpf: "11122233344",
    });
    expect(mockUpdateSet).toHaveBeenNthCalledWith(2, {
      name: "JOSE DA SILVA",
      birthDate: new Date("1985-02-03T12:00:00.000Z"),
    });

    const updateCalls = mockUpdateSet.mock.calls as unknown as Array<[Record<string, unknown>]>;
    for (const [values] of updateCalls) {
      expect(values).not.toHaveProperty("checkedInAt");
      expect(values).not.toHaveProperty("rg");
      expect(values).not.toHaveProperty("phone");
      expect(values).not.toHaveProperty("boardingLocationId");
      expect(values).not.toHaveProperty("seatNumber");
    }
  });

  it("continues with valid rows after a bad row in the same request", async () => {
    const passenger = makePassenger();
    queueManifestDb(
      [{ reservation: manifestReservation, trip: manifestTrip }],
      [passenger],
    );

    const res = await request(buildReservationsApp())
      .post("/api/reservations/import-manifest")
      .send({
        rows: [
          {
            line: 2,
            reservationNumber: "AG-NOT-FOUND",
            tripName: manifestTrip.name,
            departureDate: "2025-07-10",
            name: "Linha Inválida",
          },
          {
            line: 3,
            reservationNumber: manifestReservation.reservationNumber,
            tripName: manifestTrip.name,
            departureDate: "2025-07-10",
            name: "Maria de Fátima Atualizada",
            cpf: "12345678900",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 0, updated: 1, skipped: 1 });
    expect(res.body.errors[0]).toContain("Linha 2");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({
      name: "Maria de Fátima Atualizada",
      cpf: "12345678900",
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/public/store/:slug/orders/:orderNumber
// ---------------------------------------------------------------------------

describe("GET /api/public/store/:slug/orders/:orderNumber — email validation at endpoint level", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue([FAKE_STORE]);
    mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("returns 400 with VALIDATION_ERROR when email query param is absent", async () => {
    const app = buildStorePublicApp();
    const res = await request(app).get("/api/public/store/minha-loja/orders/ORD-001");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns 400 with VALIDATION_ERROR when email is an empty string", async () => {
    const app = buildStorePublicApp();
    const res = await request(app).get("/api/public/store/minha-loja/orders/ORD-001?email=");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns 400 with VALIDATION_ERROR when email is whitespace only", async () => {
    const app = buildStorePublicApp();
    const res = await request(app).get("/api/public/store/minha-loja/orders/ORD-001?email=   ");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns 404 (not 400) when token is provided but order is not found", async () => {
    const app = buildStorePublicApp();
    // First call: store found. Second call: order not found.
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .get("/api/public/store/minha-loja/orders/ORD-001?token=validtoken123");

    // Token passed validation → got past the 400, now 404 (order not found)
    expect(res.status).toBe(404);
    expect(res.body.code).not.toBe("VALIDATION_ERROR");
  });

  it("returns 404 when the store slug does not exist", async () => {
    const app = buildStorePublicApp();
    mockLimit.mockResolvedValueOnce([]); // store not found

    const res = await request(app)
      .get("/api/public/store/nonexistent/orders/ORD-001?token=validtoken123");

    expect(res.status).toBe(404);
  });

  it("returns non-400 when token is present and non-empty (order found but token mismatch → 404)", async () => {
    const app = buildStorePublicApp();
    // Order is found; token mismatch causes 404, not a validation 400
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])
      .mockResolvedValueOnce([{ ...FAKE_ORDER, paymentToken: "correct-token", items: [] }]);

    const res = await request(app)
      .get("/api/public/store/minha-loja/orders/ORD-001?token=wrong-token");

    // Token present → got past the 400 check; mismatch gives 404
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/public/store/:slug/trips/:tripId/seats/stream (public SSE)
// ---------------------------------------------------------------------------

describe("GET /api/public/store/:slug/trips/:tripId/seats/stream — public seat-availability SSE", () => {
  const tryAddSeatClientMock = vi.mocked(tryAddSeatClient);
  const removeSeatClientMock = vi.mocked(removeSeatClient);

  beforeEach(() => {
    vi.clearAllMocks();
    tryAddSeatClientMock.mockReturnValue(true);
    // mockResolvedValueOnce queues survive clearAllMocks, so reset explicitly
    // (see memory: vitest-mock-queue) and rebuild the select() chain.
    mockLimit.mockReset();
    mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("returns 404 (not an SSE upgrade) and registers no client when the store slug does not exist", async () => {
    const app = buildStorePublicApp();
    mockLimit.mockResolvedValue([]); // getActiveStore → not found

    const res = await request(app)
      .get("/api/public/store/nonexistent/trips/trip-001/seats/stream");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(tryAddSeatClientMock).not.toHaveBeenCalled();
  });

  it("returns 404 and registers no client when the store exists but the trip does not", async () => {
    const app = buildStorePublicApp();
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE]) // getActiveStore → found
      .mockResolvedValueOnce([]);          // trip lookup → not found

    const res = await request(app)
      .get("/api/public/store/minha-loja/trips/missing/seats/stream");

    expect(res.status).toBe(404);
    expect(tryAddSeatClientMock).not.toHaveBeenCalled();
  });

  it("returns 429 (not an SSE upgrade) when the connection cap is reached", async () => {
    const app = buildStorePublicApp();
    tryAddSeatClientMock.mockReturnValue(false); // limit reached
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])          // getActiveStore → found
      .mockResolvedValueOnce([{ id: "trip-001" }]); // trip lookup → found

    const res = await request(app)
      .get("/api/public/store/minha-loja/trips/trip-001/seats/stream");

    expect(res.status).toBe(429);
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(tryAddSeatClientMock).toHaveBeenCalledTimes(1);
    expect(removeSeatClientMock).not.toHaveBeenCalled();
  });

  it("upgrades to SSE, registers the client via tryAddSeatClient, and removes it on req close", async () => {
    const app = buildStorePublicApp();
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])        // getActiveStore → found
      .mockResolvedValueOnce([{ id: "trip-001" }]); // trip lookup → found

    // SSE handler never ends the response, so supertest would hang. Drive a
    // real http client against a listening server and close the socket to
    // trigger the req "close" cleanup path.
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;

    await new Promise<void>((resolve) => {
      const clientReq = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/public/store/minha-loja/trips/trip-001/seats/stream",
          method: "GET",
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers["content-type"]).toContain("text/event-stream");
          res.on("data", () => {});
          // Headers flushed → client is registered; now close the connection.
          setImmediate(() => clientReq.destroy());
        },
      );
      clientReq.on("error", () => {}); // ignore ECONNRESET from destroy()
      clientReq.end();

      // Resolve as soon as the cleanup path runs (avoids fixed-timeout flake).
      const poll = setInterval(() => {
        if (removeSeatClientMock.mock.calls.length > 0) {
          clearInterval(poll);
          resolve();
        }
      }, 10);
      setTimeout(() => {
        clearInterval(poll);
        resolve();
      }, 2000);
    });

    expect(tryAddSeatClientMock).toHaveBeenCalledTimes(1);
    expect(tryAddSeatClientMock).toHaveBeenCalledWith("trip-001", expect.anything(), expect.anything());
    expect(removeSeatClientMock).toHaveBeenCalledTimes(1);
    expect(removeSeatClientMock).toHaveBeenCalledWith("trip-001", expect.anything());

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/public/store/:slug/referral/validate — suspended attempt tracking
//
// When a referral code whose status is not "active" is validated, the handler
// fires a best-effort `db.update(clientsTable).set({ referralSuspendedAttemptAt })`
// and rejects with REFERRAL_CODE_SUSPENDED. These tests assert that the
// fire-and-forget timestamp update is actually triggered.
// ---------------------------------------------------------------------------

describe("POST /api/public/store/:slug/referral/validate — suspended attempt tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockReset();
    mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("records referralSuspendedAttemptAt and returns REFERRAL_CODE_SUSPENDED for a blocked code", async () => {
    const app = buildStorePublicApp();
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])                       // getActiveStore
      .mockResolvedValueOnce([{ settings: {} }])                 // tenant settings
      .mockResolvedValueOnce([{                                  // referrer lookup
        id: "client-001",
        name: "Maria Souza",
        email: "maria@example.com",
        referralCode: "MARIA2026",
        referralCodeStatus: "blocked",
        successfulReferrals: 0,
      }]);

    const res = await request(app)
      .post("/api/public/store/minha-loja/referral/validate")
      .send({ code: "MARIA2026" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "REFERRAL_CODE_SUSPENDED", valid: false });

    // The fire-and-forget suspended-attempt update must have been triggered,
    // recording the timestamp AND incrementing the attempt count.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        referralSuspendedAttemptAt: expect.any(Date),
        referralSuspendedAttemptCount: expect.anything(),
      }),
    );
    expect(mockUpdateExecute).toHaveBeenCalledTimes(1);

    // The fire-and-forget attempt-log insert must also have been triggered
    // with the correct tenant, client, and store context.
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-001",
        tenantId: "tenant-001",
        storeSlug: "minha-loja",
      }),
    );
  });

  it("does NOT record a suspended attempt for an active code (passes the status gate)", async () => {
    const app = buildStorePublicApp();
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])                       // getActiveStore
      .mockResolvedValueOnce([{ settings: {} }])                 // tenant settings
      .mockResolvedValueOnce([{                                  // referrer lookup
        id: "client-001",
        name: "Maria Souza",
        email: "maria@example.com",
        referralCode: "MARIA2026",
        referralCodeStatus: "active",
        successfulReferrals: 0,
      }])
      .mockResolvedValueOnce([]);                                // referral settings lookup

    const res = await request(app)
      .post("/api/public/store/minha-loja/referral/validate")
      .send({ code: "MARIA2026" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ valid: true });
    // No suspended-attempt timestamp update for active codes.
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ referralSuspendedAttemptAt: expect.any(Date) }),
    );
    // No attempt-log insert for active codes.
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/public/store/:slug/referral/info — suspended attempt tracking
//
// The public referral-info lookup writes the same best-effort
// `db.update(clientsTable).set({ referralSuspendedAttemptAt })` and rejects with
// REFERRAL_CODE_SUSPENDED when the referrer's code is not "active". This mirrors
// the POST /referral/validate path; both write paths must stay covered so a
// regression in either is caught.
// ---------------------------------------------------------------------------

describe("GET /api/public/store/:slug/referral/info — suspended attempt tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockReset();
    mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("records referralSuspendedAttemptAt and returns REFERRAL_CODE_SUSPENDED for a blocked code", async () => {
    const app = buildStorePublicApp();
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])                       // getActiveStore
      .mockResolvedValueOnce([{ settings: {} }])                 // tenant settings
      .mockResolvedValueOnce([{                                  // referrer lookup
        id: "client-001",
        name: "Maria Souza",
        referralCodeStatus: "blocked",
      }]);

    const res = await request(app)
      .get("/api/public/store/minha-loja/referral/info?code=MARIA2026");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "REFERRAL_CODE_SUSPENDED", valid: false });

    // The fire-and-forget suspended-attempt update must have been triggered.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ referralSuspendedAttemptAt: expect.any(Date) }),
    );
    expect(mockUpdateExecute).toHaveBeenCalledTimes(1);

    // The fire-and-forget attempt-log insert must also have been triggered
    // with the correct tenant, client, and store context.
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-001",
        tenantId: "tenant-001",
        storeSlug: "minha-loja",
      }),
    );
  });

  it("does NOT record a suspended attempt for an active code (passes the status gate)", async () => {
    const app = buildStorePublicApp();
    mockLimit
      .mockResolvedValueOnce([FAKE_STORE])                       // getActiveStore
      .mockResolvedValueOnce([{ settings: {} }])                 // tenant settings
      .mockResolvedValueOnce([{                                  // referrer lookup
        id: "client-001",
        name: "Maria Souza",
        referralCodeStatus: "active",
      }])
      .mockResolvedValueOnce([]);                                // referral settings lookup

    const res = await request(app)
      .get("/api/public/store/minha-loja/referral/info?code=MARIA2026");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ code: "MARIA2026", referrerName: "Maria Souza" });
    // No suspended-attempt timestamp update for active codes.
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ referralSuspendedAttemptAt: expect.any(Date) }),
    );
    // No attempt-log insert for active codes.
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: reservation/passenger mutation authorization (RBAC)
//
// The `suporte` (SUPPORT) role has RESERVATIONS: [VIEW] only in the permissions
// matrix, so every reservation/passenger mutation handler must reject it. These
// gates short-circuit (via hasPermission) before any DB access, so the 403 path
// needs no DB mocking. Positive controls confirm EDIT/CREATE-capable roles
// (e.g. SALES) pass the gate and proceed to the handler's normal logic.
// ---------------------------------------------------------------------------

describe("Reservation mutation authorization — support role is view-only", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  function authAs(role: string) {
    requireAuthMock.mockResolvedValue({ ...FAKE_USER, role } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockReset();
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("blocks SUPPORT from creating a reservation (POST /reservations)", async () => {
    authAs(ROLES.SUPPORT);
    const res = await request(buildReservationsApp())
      .post("/api/reservations")
      .send({ tripId: "trip-001", clientId: FAKE_CLIENT.id, seats: ["1A"], totalValue: 500 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN_ROLE" });
  });

  it("blocks SUPPORT from updating a reservation (PATCH /reservations/:id)", async () => {
    authAs(ROLES.SUPPORT);
    const res = await request(buildReservationsApp())
      .patch("/api/reservations/res-001")
      .send({ status: "confirmed" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN_ROLE" });
  });

  it("blocks SUPPORT from updating an installment (PATCH /reservations/installments/:id)", async () => {
    authAs(ROLES.SUPPORT);
    const res = await request(buildReservationsApp())
      .patch("/api/reservations/installments/inst-001")
      .send({ paidAmount: 100 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN_ROLE" });
  });

  it("blocks SUPPORT from adding a passenger (POST /reservations/:id/passengers)", async () => {
    authAs(ROLES.SUPPORT);
    const res = await request(buildReservationsApp())
      .post("/api/reservations/res-001/passengers")
      .send({ name: "Fulano", ageCategory: "adult" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN_ROLE" });
  });

  it("blocks SUPPORT from editing a passenger (PATCH /reservations/:id/passengers/:id)", async () => {
    authAs(ROLES.SUPPORT);
    const res = await request(buildReservationsApp())
      .patch("/api/reservations/res-001/passengers/pax-001")
      .send({ name: "Beltrano" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN_ROLE" });
  });

  it("blocks SUPPORT from removing a passenger (DELETE /reservations/:id/passengers/:id)", async () => {
    authAs(ROLES.SUPPORT);
    const res = await request(buildReservationsApp())
      .delete("/api/reservations/res-001/passengers/pax-001");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN_ROLE" });
  });

  it("blocks CLIENT from updating a reservation (PATCH /reservations/:id)", async () => {
    // CLIENT also has RESERVATIONS: [VIEW] only — the matrix gate closes the
    // older 'cliente'-specific bypass that predated this fix.
    authAs(ROLES.CLIENT);
    const res = await request(buildReservationsApp())
      .patch("/api/reservations/res-001")
      .send({ status: "confirmed" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN_ROLE" });
  });

  it("allows SALES past the CREATE gate (POST /reservations) — reaches client lookup, not 403", async () => {
    authAs(ROLES.SALES);
    mockLimit.mockResolvedValueOnce([]); // client not found → 400 (proves the gate was passed)
    const res = await request(buildReservationsApp())
      .post("/api/reservations")
      .send({ tripId: "trip-001", clientId: "missing", seats: ["1A"], totalValue: 500 });
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(403);
  });

  it("allows SALES past the EDIT gate (PATCH installments) — reaches installment lookup, not 403", async () => {
    authAs(ROLES.SALES);
    mockLimit.mockResolvedValueOnce([]); // installment not found → 404 (proves the gate was passed)
    const res = await request(buildReservationsApp())
      .patch("/api/reservations/installments/inst-001")
      .send({ paidAmount: 100 });
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });
});

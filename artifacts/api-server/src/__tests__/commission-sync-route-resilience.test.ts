import pino from "pino";
import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockLimit, mockWhere, mockFrom, mockSelect, mockTransaction, mockEnqueueCommissionSync } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockTransaction = vi.fn();
  const mockEnqueueCommissionSync = vi.fn();
  return { mockLimit, mockWhere, mockFrom, mockSelect, mockTransaction, mockEnqueueCommissionSync };
});

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
  dealsTable: {},
  pipelineStagesTable: {},
  tenantsTable: {},
  emailLogsTable: {},
  referralTrackingTable: {},
  usersTable: {},
  paymentsTable: {},
  commissionsTable: {},
  storeCouponsTable: {},
  storesTable: {},
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
  ALL_STAFF_ROLES: ["admin", "manager", "vendedor"],
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
  enqueueCommissionSync: mockEnqueueCommissionSync,
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
}));

import { requireAuth } from "../lib/tenant.js";
import { broadcastSeatUpdate } from "../lib/realtime.js";
import reservationsRouter from "../routes/reservations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

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

function makeFakeReservation() {
  return {
    id: "gen-id",
    tenantId: FAKE_USER.tenantId,
    tripId: "trip-001",
    clientId: FAKE_CLIENT.id,
    seats: ["1A"],
    tripType: null,
    packageType: null,
    hasInsurance: false,
    totalValue: "500",
    paidValue: "500",
    balance: "0",
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

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  const noop = () => {};
  req.log = pino({ level: "silent" }) as unknown as typeof req.log;
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

function buildTxMock() {
  return {
    execute: vi.fn().mockResolvedValue({
      rows: [{ id: "trip-001", available_seats: 10, type: "excursao" }],
    }),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    select: vi.fn(() => ({ from: mockFrom })),
  };
}

describe("POST /api/reservations — commission sync resilience", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(buildTxMock()),
    );
  });

  it("returns 201 even when enqueueCommissionSync rejects — commission failure must never produce a 500", async () => {
    mockEnqueueCommissionSync.mockRejectedValue(new Error("Queue crashed"));
    const fakeReservation = makeFakeReservation();
    mockLimit
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([])                // duplicate reservation check → none
      .mockResolvedValueOnce([fakeReservation])
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([]);              // formatReservation: autoRetryLog

    const app = buildApp();
    const res = await request(app)
      .post("/api/reservations")
      .send({ tripId: "trip-001", clientId: FAKE_CLIENT.id, seats: ["1A"], totalValue: 500 });

    expect(res.status).toBe(201);
    expect(mockEnqueueCommissionSync).toHaveBeenCalledWith("gen-id", FAKE_USER.tenantId);
  });

  it("returns 201 when enqueueCommissionSync resolves normally", async () => {
    mockEnqueueCommissionSync.mockResolvedValue(undefined);
    const fakeReservation = makeFakeReservation();
    mockLimit
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([])                // duplicate reservation check → none
      .mockResolvedValueOnce([fakeReservation])
      .mockResolvedValueOnce([FAKE_TRIP])
      .mockResolvedValueOnce([FAKE_CLIENT])
      .mockResolvedValueOnce([]);              // formatReservation: autoRetryLog

    const app = buildApp();
    const res = await request(app)
      .post("/api/reservations")
      .send({ tripId: "trip-001", clientId: FAKE_CLIENT.id, seats: ["1A"], totalValue: 500 });

    expect(res.status).toBe(201);
    expect(mockEnqueueCommissionSync).toHaveBeenCalledWith("gen-id", FAKE_USER.tenantId);
  });
});

describe("PATCH /api/reservations/:reservationId/passengers/:id — seat update broadcast", () => {
  const requireAuthMock = vi.mocked(requireAuth);
  const broadcastSeatUpdateMock = vi.mocked(broadcastSeatUpdate);

  const fakeReservation = makeFakeReservation();
  const fakePassenger = {
    id: "passenger-001",
    reservationId: fakeReservation.id,
    name: "João Silva",
    cpf: null,
    rg: null,
    birthDate: null,
    ageCategory: "adult",
    seatNumber: "1A",
    isChildUnder7: false,
    checkedInAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("broadcasts the trip seat update when seatNumber is included", async () => {
    mockLimit
      .mockResolvedValueOnce([fakeReservation])
      .mockResolvedValueOnce([fakePassenger]);

    const res = await request(buildApp())
      .patch(`/api/reservations/${fakeReservation.id}/passengers/${fakePassenger.id}`)
      .send({ seatNumber: "2B" });

    expect(res.status).toBe(200);
    expect(broadcastSeatUpdateMock).toHaveBeenCalledOnce();
    expect(broadcastSeatUpdateMock).toHaveBeenCalledWith(fakeReservation.tripId, FAKE_USER.tenantId);
  });

  it("does not broadcast when only passenger profile fields are updated", async () => {
    mockLimit
      .mockResolvedValueOnce([fakeReservation])
      .mockResolvedValueOnce([{ ...fakePassenger, name: "Maria Silva" }]);

    const res = await request(buildApp())
      .patch(`/api/reservations/${fakeReservation.id}/passengers/${fakePassenger.id}`)
      .send({ name: "Maria Silva" });

    expect(res.status).toBe(200);
    expect(broadcastSeatUpdateMock).not.toHaveBeenCalled();
  });
});

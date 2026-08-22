import { ROLES, RESERVATION_STATUS } from "@workspace/permissions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockSelect, mockSelectDistinct, mockNotInArray, selectQueue, selectDistinctQueue } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockSelectDistinct: vi.fn(),
  mockNotInArray: vi.fn((column: unknown, values: unknown[]) => ({ column, values })),
  selectQueue: [] as unknown[][],
  selectDistinctQueue: [] as unknown[][],
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    selectDistinct: mockSelectDistinct,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    transaction: vi.fn(),
  },
  reservationsTable: {},
  passengersTable: {},
  tripsTable: {},
  clientsTable: {},
  storeCouponsTable: {},
  storesTable: {},
  storeOrdersTable: {},
  storeOrderItemsTable: {},
  storeProductsTable: {},
  storeProductVariantsTable: {},
  loyaltyMembersTable: {},
  loyaltyTransactionsTable: {},
  loyaltyProgramsTable: {},
  referralsTable: {},
  referralSettingsTable: {},
  referralCampaignsTable: {},
  dealsTable: {},
  tenantsTable: {},
  emailLogsTable: {},
  paymentsTable: {},
  commissionsTable: {},
  vehicleLayoutsTable: {},
  reservationInstallmentsTable: {},
  boardingLocationsTable: {},
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return { ...makeDrizzleOrmMock(), notInArray: mockNotInArray };
});

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["superadmin", "agencia"],
  MANAGEMENT_ROLES: ["superadmin", "agencia", "gerente"],
}));

vi.mock("../lib/seat-sse.js", () => ({
  addSeatClient: vi.fn(),
  removeSeatClient: vi.fn(),
  emitSeatUpdate: vi.fn(),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppReservationConfirmed: vi.fn().mockResolvedValue(undefined),
  dispatchWhatsAppCadastroRealizado: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../lib/client-notifications.js", () => ({
  insertClientNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/push-notifications.js", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/referral-campaigns.js", () => ({
  applyActiveCampaignBonus: vi.fn().mockResolvedValue({ adjustedBase: 0, fixedExtra: 0 }),
}));

vi.mock("../lib/trip-overlap-notify.js", () => ({
  detectAndNotifyTripOverlap: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
  cancelDealOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/pipeline-deal-sync.js", () => ({
  syncClientDeal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "generated-id"),
  generateVoucherCode: vi.fn(() => "VCHR-0001"),
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
  resolveChildAgeCategory: vi.fn(() => "adult"),
  syncIsChildUnder7: vi.fn(() => false),
}));

import { requireAuth } from "../lib/tenant.js";
import reservationsRouter, { batchFormatReservations } from "../routes/reservations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

type QueryChain = Promise<unknown[]> & {
  from: (...args: unknown[]) => QueryChain;
  innerJoin: (...args: unknown[]) => QueryChain;
  where: (...args: unknown[]) => QueryChain;
  limit: (...args: unknown[]) => QueryChain;
  orderBy: (...args: unknown[]) => QueryChain;
};

function makeChain(data: unknown[]): QueryChain {
  const chain = Promise.resolve(data) as QueryChain;
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.orderBy = () => chain;
  return chain;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { warn: vi.fn(), error: vi.fn() } as never;
    next();
  });
  app.use("/api", reservationsRouter);
  app.use(errorHandler);
  return app;
}

const USER = {
  id: "user-001",
  tenantId: "tenant-001",
  role: ROLES.AGENCY_ADMIN,
  name: "Test Agent",
  email: "agent@example.com",
};

const CLIENT_ID = "client-001";

function makeTrip(id: string, departureDate: string, returnDate: string | null = null) {
  return {
    id,
    tenantId: USER.tenantId,
    name: `Trip ${id}`,
    destination: "Destination",
    departureDate: new Date(departureDate),
    returnDate: returnDate ? new Date(returnDate) : null,
  };
}

function makeConflict(
  id: string,
  trip: ReturnType<typeof makeTrip>,
  status: string = "confirmed",
) {
  return {
    reservationId: id,
    reservationNumber: `RES-${id}`,
    tripId: trip.id,
    tripName: trip.name,
    departureDate: trip.departureDate,
    returnDate: trip.returnDate,
    status,
  };
}

function queueOverlapQuery(targetTrip: ReturnType<typeof makeTrip>, conflicts: unknown[]) {
  selectQueue.push([targetTrip], conflicts);
}

function makeReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-target",
    tenantId: USER.tenantId,
    tripId: "trip-target",
    clientId: CLIENT_ID,
    seats: ["1A"],
    tripType: null,
    packageType: null,
    hasInsurance: false,
    isGratuidade: false,
    totalValue: "1000",
    paidValue: "0",
    balance: "1000",
    paymentMethod: null,
    installments: 1,
    commissionPercentage: null,
    commissionAmount: null,
    commissionSyncStatus: null,
    sellerId: null,
    status: "confirmed",
    voucherCode: "VCHR-001",
    reservationNumber: "RES-001",
    qrCode: "QR-001",
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
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    createdById: USER.id,
    ...overrides,
  };
}

function makeBatchTrip(id: string, departureDate: string, returnDate: string | null = null) {
  return {
    ...makeTrip(id, departureDate, returnDate),
    slug: id,
    description: null,
    shortDescription: null,
    destinationCity: "Destination",
    destinationState: "ST",
    destinationCountry: "Brasil",
    originCity: null,
    originState: null,
    type: "excursao",
    category: "tour",
    registrationDeadline: null,
    departureTime: null,
    returnTime: null,
    totalCapacity: 40,
    availableSeats: 40,
    reservedSeats: 0,
    confirmedSeats: 0,
    seatMap: {},
    seatLayout: "2x2",
    priceAdult: "1000",
    priceChild: null,
    priceInfant: null,
    priceSenior: null,
    reservationFee: null,
    inclusions: [],
    exclusions: [],
    itinerary: null,
    boardingPoints: [],
    coverImage: null,
    gallery: [],
    videos: [],
    status: "active",
    isPublic: false,
    isFeatured: false,
    isAvailableInShop: false,
    vehiclePlate: null,
    vehicleId: null,
    vehicleType: null,
    driverName: null,
    tourGuide: null,
    tripOrganizer: null,
    driverCnh: null,
    driverPhone: null,
    driver1Cpf: null,
    driver1Cnh: null,
    driver1CnhExpiry: null,
    driver2Name: null,
    driver2Cpf: null,
    driver2Cnh: null,
    driver2CnhCategory: null,
    driver2CnhExpiry: null,
    tourGuideCpf: null,
    tourGuideRegistration: null,
    manifestNumber: null,
    fixedCosts: [],
    variableCosts: [],
    freeOrganizers: null,
    freeGuides: null,
    freePassengers: [],
    cancellationPolicy: null,
    metaTitle: null,
    metaDescription: null,
    layoutId: null,
    showSeatMap: true,
    createdById: USER.id,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  selectDistinctQueue.length = 0;
  mockSelect.mockImplementation(() => makeChain(selectQueue.shift() ?? []));
  mockSelectDistinct.mockImplementation(() => makeChain(selectDistinctQueue.shift() ?? []));
  vi.mocked(requireAuth).mockResolvedValue(USER as never);
});

describe("GET /api/reservations/trip-overlap", () => {
  it("returns a conflict when two trips have truly overlapping dates", async () => {
    const target = makeTrip("trip-target", "2025-09-10", "2025-09-15");
    const other = makeTrip("trip-other", "2025-09-12", "2025-09-18");
    queueOverlapQuery(target, [makeConflict("res-other", other)]);

    const response = await request(buildApp())
      .get(`/api/reservations/trip-overlap?clientId=${CLIENT_ID}&tripId=${target.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{
      reservationId: "res-other",
      reservationNumber: "RES-res-other",
      tripId: "trip-other",
      tripName: "Trip trip-other",
      departureDate: "2025-09-12T00:00:00.000Z",
      returnDate: "2025-09-18T00:00:00.000Z",
    }]);
  });

  it("counts a trip whose departure is the other trip's return date as an overlap", async () => {
    const target = makeTrip("trip-target", "2025-09-15", "2025-09-20");
    const other = makeTrip("trip-other", "2025-09-10", "2025-09-15");
    queueOverlapQuery(target, [makeConflict("res-other", other)]);

    const response = await request(buildApp())
      .get(`/api/reservations/trip-overlap?clientId=${CLIENT_ID}&tripId=${target.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].tripId).toBe(other.id);
  });

  it("returns no conflicts when two trips do not overlap", async () => {
    const target = makeTrip("trip-target", "2025-09-20", "2025-09-25");
    queueOverlapQuery(target, []);

    const response = await request(buildApp())
      .get(`/api/reservations/trip-overlap?clientId=${CLIENT_ID}&tripId=${target.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("does not return a reservation in the same trip", async () => {
    const target = makeTrip("trip-target", "2025-09-10", "2025-09-15");
    queueOverlapQuery(target, []);

    const response = await request(buildApp())
      .get(`/api/reservations/trip-overlap?clientId=${CLIENT_ID}&tripId=${target.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(mockNotInArray.mock.calls.some(([, values]) =>
      Array.isArray(values) && values.includes(target.id),
    )).toBe(true);
  });

  it.each([RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.REFUNDED])(
    "does not return a %s reservation",
    async (status) => {
      const target = makeTrip("trip-target", "2025-09-10", "2025-09-15");
      // The real database applies the status predicate before returning rows.
      // Keep the fixture out of the mocked result and assert that the route
      // asks Drizzle to exclude this status.
      queueOverlapQuery(target, []);

      const response = await request(buildApp())
        .get(`/api/reservations/trip-overlap?clientId=${CLIENT_ID}&tripId=${target.id}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(mockNotInArray.mock.calls.some(([, values]) =>
        Array.isArray(values)
        && values.includes(status)
        && values.includes(RESERVATION_STATUS.CANCELLED)
        && values.includes(RESERVATION_STATUS.REFUNDED),
      )).toBe(true);
    },
  );
});

describe("batchFormatReservations conflict detection", () => {
  it("sets conflictingTrips when a client has overlapping trips on the same page", async () => {
    const targetTrip = makeBatchTrip("trip-target", "2025-09-10", "2025-09-15");
    const otherTrip = makeBatchTrip("trip-other", "2025-09-12", "2025-09-18");
    const targetReservation = makeReservation({ id: "res-target", tripId: targetTrip.id });
    const otherReservation = makeReservation({ id: "res-other", tripId: otherTrip.id });

    selectQueue.push(
      [targetTrip, otherTrip], // related trips
      [{ id: CLIENT_ID, tenantId: USER.tenantId, name: "Client", email: "client@example.com", whatsapp: "5511999999999", cpf: null, birthDate: null }], // clients
      [], // boarding locations
      [{
        id: "res-other",
        clientId: CLIENT_ID,
        tripId: otherTrip.id,
        reservationNumber: "RES-OTHER",
        tripName: otherTrip.name,
        departureDate: otherTrip.departureDate,
        returnDate: otherTrip.returnDate,
      }], // all active reservations for the page's clients
    );

    // Both reservations are in the page, so each should identify the other
    // as a conflict rather than only flagging a reservation outside the page.
    selectQueue[3].push({
      id: "res-target",
      clientId: CLIENT_ID,
      tripId: targetTrip.id,
      reservationNumber: "RES-001",
      tripName: targetTrip.name,
      departureDate: targetTrip.departureDate,
      returnDate: targetTrip.returnDate,
    });

    const formatted = await batchFormatReservations([targetReservation, otherReservation] as never, USER.tenantId);

    expect(formatted[0].conflictingTrips).toEqual([{
      reservationId: "res-other",
      reservationNumber: "RES-OTHER",
      tripId: otherTrip.id,
      tripName: otherTrip.name,
      departureDate: "2025-09-12T00:00:00.000Z",
      returnDate: "2025-09-18T00:00:00.000Z",
    }]);
    expect(formatted[1].conflictingTrips).toEqual([{
      reservationId: "res-target",
      reservationNumber: "RES-001",
      tripId: targetTrip.id,
      tripName: targetTrip.name,
      departureDate: "2025-09-10T00:00:00.000Z",
      returnDate: "2025-09-15T00:00:00.000Z",
    }]);
  });

  it("does not flag a same-trip reservation in the batch", async () => {
    const targetTrip = makeBatchTrip("trip-target", "2025-09-10", "2025-09-15");
    const reservation = makeReservation({ tripId: targetTrip.id });

    selectQueue.push(
      [targetTrip],
      [{ id: CLIENT_ID, tenantId: USER.tenantId, name: "Client", email: "client@example.com", whatsapp: "5511999999999", cpf: null, birthDate: null }],
      [],
      [{
        id: "res-same-trip",
        clientId: CLIENT_ID,
        tripId: targetTrip.id,
        reservationNumber: "RES-SAME",
        tripName: targetTrip.name,
        departureDate: targetTrip.departureDate,
        returnDate: targetTrip.returnDate,
      }],
    );

    const [formatted] = await batchFormatReservations([reservation] as never, USER.tenantId);

    expect(formatted.conflictingTrips).toEqual([]);
  });
});
import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import http from "node:http";
import type { AddressInfo } from "node:net";

const { selectQueue, mockSelect, mockUpdate, mockDispatchTripRestorationNotification } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const mockSelect = vi.fn();
  const mockUpdate = vi.fn();
  const mockDispatchTripRestorationNotification = vi.fn().mockResolvedValue(undefined);
  return { selectQueue, mockSelect, mockUpdate, mockDispatchTripRestorationNotification };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    transaction: vi.fn(),
  },
  tripsTable: { id: "tripsTable.id", tenantId: "tripsTable.tenantId" },
  reservationsTable: {},
  tenantsTable: {},
  plansTable: {},
  passengersTable: {},
  clientsTable: {},
  usersTable: {},
  storesTable: {},
  storeOrdersTable: {},
  storeOrderItemsTable: {},
  storeProductsTable: {},
  storeProductVariantsTable: {},
  storeCouponsTable: {},
  storeReviewsTable: {},
  storeCategoriesTable: {},
  loyaltyMembersTable: {},
  loyaltyTransactionsTable: {},
  loyaltyProgramsTable: {},
  referralsTable: {},
  referralSettingsTable: {},
  dealsTable: {},
  pipelineStagesTable: {},
  emailLogsTable: {},
  referralTrackingTable: {},
  paymentsTable: {},
  commissionsTable: {},
  vehicleLayoutsTable: {},
  auditLogsTable: {},
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

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
    deleteEventsForTrip: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/uploadthing.js", () => ({
  deleteOrphanedFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/plan-features.js", () => ({
  hasSeatMapFeature: vi.fn(() => true),
}));

vi.mock("../lib/passenger.js", () => ({
  deriveAgeCategory: vi.fn(() => "adult"),
  getAgeYears: vi.fn(() => 30),
}));

vi.mock("../lib/planLimits.js", () => ({
  checkPlanLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
  generateVoucherCode: vi.fn(() => "VCHR-0001"),
  generateReferralCode: vi.fn(() => "REF-0001"),
}));

vi.mock("../lib/status-validators.js", () => ({
  parseTripStatus: vi.fn((s: string) => s),
}));

vi.mock("@workspace/email", () => ({
  sendManifestEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/index.js", () => ({
  getPdfQueue: vi.fn(() => ({ add: vi.fn().mockResolvedValue(undefined) })),
  getCalendarSyncQueue: vi.fn(() => null),
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
  dispatchTripRestorationNotification: mockDispatchTripRestorationNotification,
}));

vi.mock("../queues/commission-sync-helper.js", () => ({
  enqueueCommissionSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../routes/payments.js", () => ({
  syncReservationCommission: vi.fn().mockResolvedValue(undefined),
  recalculateClientFinancials: vi.fn().mockResolvedValue(undefined),
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), use: vi.fn() },
}));

import { requireAuth } from "../lib/tenant.js";
import { addSeatClient, removeSeatClient } from "../lib/seat-sse.js";
import { broadcastSeatUpdate } from "../lib/realtime.js";
import { dispatchTripRestorationNotification } from "../queues/email-helpers.js";
import { eq } from "drizzle-orm";
import tripsRouter from "../routes/trips.js";
import { errorHandler } from "../middlewares/errorHandler.js";

interface QueryChain extends Promise<unknown[]> {
  from(t?: unknown): QueryChain;
  where(c?: unknown): QueryChain;
  limit(n?: number): Promise<unknown[]>;
  orderBy(...args: unknown[]): Promise<unknown[]>;
  offset(n?: number): QueryChain;
}

function makeChain(data: unknown[]): QueryChain {
  return Object.assign(Promise.resolve(data), {
    from: vi.fn().mockImplementation(() => makeChain(data)),
    where: vi.fn().mockImplementation(() => makeChain(data)),
    limit: vi.fn().mockResolvedValue(data),
    orderBy: vi.fn().mockResolvedValue(data),
    offset: vi.fn().mockImplementation(() => makeChain(data)),
  }) as QueryChain;
}

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
  app.use("/api", tripsRouter);
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
  slug: "excursao-nordeste-t001",
  description: null,
  destination: "Fortaleza",
  destinationCity: "Fortaleza",
  destinationState: "CE",
  type: "nacional",
  category: "turismo",
  departureDate: new Date("2025-07-10"),
  returnDate: null,
  totalCapacity: 46,
  availableSeats: 44,
  reservedSeats: 1,
  confirmedSeats: 1,
  priceAdult: "500",
  priceChild: null,
  priceSenior: null,
  inclusions: [],
  exclusions: [],
  coverImage: null,
  gallery: [],
  itinerary: [],
  boardingPoints: [],
  status: "active",
  isPublic: true,
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
  seatLayout: "2x2",
  layoutId: null,
  showSeatMap: true,
  fixedCosts: [],
  variableCosts: [],
  freeOrganizers: null,
  freeGuides: null,
  freePassengers: [],
  originCity: null,
  originState: null,
  departureTime: null,
  returnTime: null,
  seatMap: null,
  tenantId: "tenant-001",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const TENANT_ROW = { planId: "starter" };
const PLAN_ROW = { supportedFeatures: [] };

describe("PATCH /api/trips/:id — free passenger seat conflict rule", () => {
  const requireAuthMock = vi.mocked(requireAuth);
  const broadcastSeatUpdateMock = vi.mocked(broadcastSeatUpdate);
  const tripRestorationNotificationMock = vi.mocked(dispatchTripRestorationNotification);

  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    mockSelect.mockImplementation(() => makeChain(selectQueue.shift() ?? []));
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
  });

  it("returns 422 with code SEAT_CONFLICT when a free passenger seat overlaps a pending reservation", async () => {
    const app = buildApp();

    selectQueue.push(
      [TENANT_ROW],
      [PLAN_ROW],
      [{ seats: ["5", "6"] }],
    );

    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({
        freePassengers: [
          { id: "fp-001", name: "João Guia", cpf: "111.222.333-44", whatsapp: "11999990000", role: "guide", seatNumber: "5" },
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("SEAT_CONFLICT");
    expect(Array.isArray(res.body.conflictingSeats)).toBe(true);
    expect(res.body.conflictingSeats).toContain("5");
  });

  it("returns 422 with code SEAT_CONFLICT when a free passenger seat overlaps a confirmed reservation", async () => {
    const app = buildApp();

    selectQueue.push(
      [TENANT_ROW],
      [PLAN_ROW],
      [{ seats: ["10"] }, { seats: ["12"] }],
    );

    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({
        freePassengers: [
          { id: "fp-002", name: "Ana Organizadora", cpf: "555.666.777-88", whatsapp: "11988880000", role: "organizer", seatNumber: "12" },
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("SEAT_CONFLICT");
    expect(res.body.conflictingSeats).toContain("12");
  });

  it("returns 422 when two free passengers are assigned the same seat", async () => {
    const app = buildApp();

    selectQueue.push(
      [TENANT_ROW],
      [PLAN_ROW],
    );

    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({
        freePassengers: [
          { id: "fp-duplicate-1", name: "João Guia", cpf: "111.222.333-44", whatsapp: "11999990000", role: "guide", seatNumber: "12" },
          { id: "fp-duplicate-2", name: "Ana Organizadora", cpf: "555.666.777-88", whatsapp: "11988880000", role: "organizer", seatNumber: " 12 " },
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("DUPLICATE_FREE_PASSENGER_SEAT");
    expect(res.body.conflictingSeats).toEqual(["12"]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 200 when free passenger seats are clear of all active reservations", async () => {
    const app = buildApp();

    selectQueue.push(
      [TENANT_ROW],
      [PLAN_ROW],
      [{ seats: ["1", "2"] }],
      [FAKE_TRIP],
      [FAKE_TRIP],
    );

    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({
        freePassengers: [
          { id: "fp-003", name: "Pedro Guia", cpf: "222.333.444-55", whatsapp: "11977770000", role: "guide", seatNumber: "45" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("trip-001");
  });

  it("returns 200 when there are no active reservations at all", async () => {
    const app = buildApp();

    selectQueue.push(
      [TENANT_ROW],
      [PLAN_ROW],
      [],
      [FAKE_TRIP],
      [FAKE_TRIP],
    );

    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({
        freePassengers: [
          { id: "fp-004", name: "Maria Organizadora", cpf: "333.444.555-66", whatsapp: "11966660000", role: "organizer", seatNumber: "3" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("trip-001");
    expect(broadcastSeatUpdateMock).toHaveBeenCalledOnce();
    expect(broadcastSeatUpdateMock).toHaveBeenCalledWith("trip-001", FAKE_USER.tenantId);
  });

  it("does not broadcast when an unrelated trip field is updated", async () => {
    const app = buildApp();

    selectQueue.push(
      [TENANT_ROW],
      [PLAN_ROW],
      [FAKE_TRIP],
    );

    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({ name: "Nova excursão" });

    expect(res.status).toBe(200);
    expect(broadcastSeatUpdateMock).not.toHaveBeenCalled();
  });

  it("notifies clients with cancelled reservations when a cancelled trip is restored", async () => {
    const app = buildApp();

    selectQueue.push(
      [{ status: "cancelled" }],
      [{ id: "res-cancelled-1", clientId: "client-001" }, { id: "res-cancelled-2", clientId: null }],
      [TENANT_ROW],
      [PLAN_ROW],
      [{ ...FAKE_TRIP, status: "active" }],
    );

    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({ status: "active" });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(tripRestorationNotificationMock).toHaveBeenCalledOnce();
    });
    expect(tripRestorationNotificationMock).toHaveBeenCalledWith("res-cancelled-1", FAKE_USER.tenantId);
  });

  it("also notifies clients when a cancelled trip is restored as confirmed", async () => {
    const app = buildApp();

    selectQueue.push(
      [{ status: "cancelled" }],
      [{ id: "res-cancelled-1", clientId: "client-001" }],
      [TENANT_ROW],
      [PLAN_ROW],
      [{ ...FAKE_TRIP, status: "confirmed" }],
    );

    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({ status: "confirmed" });

    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      expect(tripRestorationNotificationMock).toHaveBeenCalledOnce();
    });
    expect(tripRestorationNotificationMock).toHaveBeenCalledWith("res-cancelled-1", FAKE_USER.tenantId);
  });

  it("does not notify clients when a trip was already live", async () => {
    const app = buildApp();

    selectQueue.push(
      [{ status: "active" }],
      [TENANT_ROW],
      [PLAN_ROW],
      [FAKE_TRIP],
    );

    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({ status: "published" });

    expect(res.status).toBe(200);
    expect(tripRestorationNotificationMock).not.toHaveBeenCalled();
  });

  it("returns 200 when freePassengers have no seatNumber set (null)", async () => {
    const app = buildApp();

    selectQueue.push(
      [TENANT_ROW],
      [PLAN_ROW],
      [FAKE_TRIP],
      [FAKE_TRIP],
    );

    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({
        freePassengers: [
          { id: "fp-005", name: "Carlos Guia", cpf: "444.555.666-77", whatsapp: "11955550000", role: "guide", seatNumber: null },
          { id: "fp-006", name: "Rita Organizadora", cpf: "555.666.777-88", whatsapp: "11944440000", role: "organizer", seatNumber: null },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("trip-001");
  });

  it("returns 200 when freePassengers array is empty", async () => {
    const app = buildApp();

    selectQueue.push(
      [TENANT_ROW],
      [PLAN_ROW],
      [FAKE_TRIP],
      [FAKE_TRIP],
    );

    const res = await request(app)
      .patch("/api/trips/trip-001")
      .send({ freePassengers: [] });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("trip-001");
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/trips/:id/seats/stream (admin seat-availability SSE)
//
// The authenticated admin seat map subscribes to this stream so staff see seats
// fill in live. Task #38 covered the public storefront stream and Task #40 the
// broadcast itself (emitSeatUpdate); this covers the admin endpoint's HTTP
// lifecycle: it must reject unauthenticated callers, scope the trip lookup to
// the caller's tenant, register the client only on success, and clean up on
// disconnect. A regression here would either leak the stream to anonymous
// callers or strand dead connections / stop staff from seeing live updates.
// ---------------------------------------------------------------------------

describe("GET /api/trips/:id/seats/stream — admin seat-availability SSE", () => {
  const requireAuthMock = vi.mocked(requireAuth);
  const addSeatClientMock = vi.mocked(addSeatClient);
  const removeSeatClientMock = vi.mocked(removeSeatClient);
  const eqMock = vi.mocked(eq);

  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    mockSelect.mockImplementation(() => makeChain(selectQueue.shift() ?? []));
  });

  it("rejects an unauthenticated request with 401 and registers no client", async () => {
    const app = buildApp();
    // Model requireAuth's real unauthenticated behavior: it sends the 401 itself
    // and returns null, after which the handler returns before any registration.
    requireAuthMock.mockImplementationOnce(async (_req, res) => {
      res.status(401).json({ code: "UNAUTHORIZED" });
      return null;
    });

    const res = await request(app).get("/api/trips/trip-001/seats/stream");

    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(addSeatClientMock).not.toHaveBeenCalled();
  });

  it("returns 404 and registers no client when the trip does not exist", async () => {
    const app = buildApp();
    // getTenantSupportedFeatures makes 2 DB queries (tenant + plan) before the
    // trip lookup; push placeholder slots so the queue drains in the right order.
    selectQueue.push(
      [],  // getTenantSupportedFeatures: tenant row
      [],  // getTenantSupportedFeatures: plan row
      [],  // trip lookup → no row
    );

    const res = await request(app).get("/api/trips/missing/seats/stream");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(addSeatClientMock).not.toHaveBeenCalled();
  });

  it("scopes the trip lookup to the caller's tenant so cross-tenant trips are not streamable", async () => {
    const app = buildApp();
    // A trip owned by another tenant is filtered out by the WHERE clause, so the
    // tenant-scoped lookup returns no row → 404, never an SSE upgrade.
    // getTenantSupportedFeatures makes 2 DB queries before the trip lookup.
    selectQueue.push(
      [],  // getTenantSupportedFeatures: tenant row
      [],  // getTenantSupportedFeatures: plan row
      [],  // tenant-scoped lookup → no row for a foreign trip
    );

    const res = await request(app).get("/api/trips/foreign-trip/seats/stream");

    expect(res.status).toBe(404);
    expect(addSeatClientMock).not.toHaveBeenCalled();
    // What makes this a *cross-tenant* guard (not just a missing-trip one): the
    // handler must have filtered by the caller's tenantId. If the tenant
    // predicate were dropped, eq would never be called with this value and a
    // foreign trip could be streamed.
    expect(eqMock).toHaveBeenCalledWith("tripsTable.tenantId", FAKE_USER.tenantId);
  });

  it("upgrades to SSE, registers the client via addSeatClient, and removes it on req close", async () => {
    const app = buildApp();
    // getTenantSupportedFeatures makes 2 DB queries before the trip lookup.
    selectQueue.push(
      [],                 // getTenantSupportedFeatures: tenant row (planId absent → "starter")
      [],                 // getTenantSupportedFeatures: plan row (no features → [])
      [{ id: "trip-001" }], // tenant-scoped trip lookup → found
    );

    // The SSE handler never ends the response, so supertest would hang. Drive a
    // real http client against a listening server and close the socket to
    // trigger the req "close" cleanup path.
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;

    try {
      await new Promise<void>((resolve) => {
        let poll: ReturnType<typeof setInterval> | undefined;
        let fallback: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          if (poll) clearInterval(poll);
          if (fallback) clearTimeout(fallback);
          resolve();
        };

        const clientReq = http.request(
          {
            host: "127.0.0.1",
            port,
            path: "/api/trips/trip-001/seats/stream",
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

        // Resolve as soon as the cleanup path runs (avoids fixed-timeout flake);
        // the fallback bounds the wait if cleanup never fires.
        poll = setInterval(() => {
          if (removeSeatClientMock.mock.calls.length > 0) finish();
        }, 10);
        fallback = setTimeout(finish, 2000);
      });

      expect(addSeatClientMock).toHaveBeenCalledTimes(1);
      expect(addSeatClientMock).toHaveBeenCalledWith("trip-001", expect.anything());
      expect(removeSeatClientMock).toHaveBeenCalledTimes(1);
      expect(removeSeatClientMock).toHaveBeenCalledWith("trip-001", expect.anything());
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

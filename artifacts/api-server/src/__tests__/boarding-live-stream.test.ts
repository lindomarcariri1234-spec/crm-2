/**
 * Endpoint tests for the live boarding-control stream and its emit triggers.
 *
 * Task #47 added frontend tests proving the boarding-control screen reloads when
 * it receives a `{ type: "refresh" }` SSE event. This file covers the *backend*
 * that pushes those events:
 *
 *   1. GET /api/trips/:id/boarding-live/stream — the SSE endpoint staff connect
 *      to. It must require auth, scope the trip lookup to the caller's tenant,
 *      register the client only on success, and clean it up on disconnect.
 *   2. POST /api/trips/:id/checkins, DELETE /api/trips/:id/checkins/:passengerId
 *      — the boarding-state changes that must call emitBoardingUpdate so every
 *      connected client gets a refresh. If these stopped emitting, staff would
 *      silently stop seeing live boarding updates with no error.
 *
 * boarding-sse is mocked so we can assert the route wiring (registration,
 * cleanup, emit) without touching the real module-level client registry; the
 * registry itself is unit-tested separately in boarding-sse.test.ts.
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import http from "node:http";
import type { AddressInfo } from "node:net";

const { selectQueue, mockSelect, mockUpdate, mockInsert } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const mockSelect = vi.fn();
  const mockUpdate = vi.fn();
  const mockInsert = vi.fn();
  return { selectQueue, mockSelect, mockUpdate, mockInsert };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
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
  tripCheckinsTable: { tripId: "tripCheckinsTable.tripId", passengerId: "tripCheckinsTable.passengerId" },
  tripGuideLocationsTable: {},
  tripMediaTable: {},
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

vi.mock("../lib/boarding-sse.js", () => ({
  tryAddBoardingClient: vi.fn(() => true),
  removeBoardingClient: vi.fn(),
  emitBoardingUpdate: vi.fn(),
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
  hasSeatMapFeature: vi.fn(() => false),
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
import { tryAddBoardingClient, removeBoardingClient, emitBoardingUpdate } from "../lib/boarding-sse.js";
import { eq } from "drizzle-orm";
import tripsRouter from "../routes/trips.js";
import { errorHandler } from "../middlewares/errorHandler.js";

interface QueryChain extends Promise<unknown[]> {
  from(t?: unknown): QueryChain;
  innerJoin(t?: unknown, c?: unknown): QueryChain;
  where(c?: unknown): QueryChain;
  limit(n?: number): Promise<unknown[]>;
  orderBy(...args: unknown[]): Promise<unknown[]>;
  offset(n?: number): QueryChain;
}

function makeChain(data: unknown[]): QueryChain {
  return Object.assign(Promise.resolve(data), {
    from: vi.fn().mockImplementation(() => makeChain(data)),
    innerJoin: vi.fn().mockImplementation(() => makeChain(data)),
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

// ---------------------------------------------------------------------------
// GET /api/trips/:id/boarding-live/stream — the staff SSE subscription
// ---------------------------------------------------------------------------

describe("GET /api/trips/:id/boarding-live/stream — boarding-control live SSE", () => {
  const requireAuthMock = vi.mocked(requireAuth);
  const tryAddBoardingClientMock = vi.mocked(tryAddBoardingClient);
  const removeBoardingClientMock = vi.mocked(removeBoardingClient);
  const emitBoardingUpdateMock = vi.mocked(emitBoardingUpdate);
  const eqMock = vi.mocked(eq);

  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    mockSelect.mockImplementation(() => makeChain(selectQueue.shift() ?? []));
    tryAddBoardingClientMock.mockReturnValue(true);
  });

  it("rejects an unauthenticated request with 401 and registers no client", async () => {
    const app = buildApp();
    requireAuthMock.mockImplementation(async (_req, res) => {
      (res as express.Response).status(401).json({ error: "Not authenticated", code: "UNAUTHORIZED" });
      return null as never;
    });

    const res = await request(app).get("/api/trips/trip-001/boarding-live/stream");

    expect(res.status).toBe(401);
    expect(tryAddBoardingClientMock).not.toHaveBeenCalled();
    expect(emitBoardingUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the trip does not belong to the caller's tenant", async () => {
    const app = buildApp();
    selectQueue.push([]); // trip lookup → not found in tenant

    const res = await request(app).get("/api/trips/trip-999/boarding-live/stream");

    expect(res.status).toBe(404);
    expect(tryAddBoardingClientMock).not.toHaveBeenCalled();
    expect(removeBoardingClientMock).not.toHaveBeenCalled();
  });

  it("registers and cleans up the SSE client on connect and disconnect", async () => {
    const app = buildApp();
    selectQueue.push([{ id: "trip-001" }]); // tenant-scoped lookup → found

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
            path: "/api/trips/trip-001/boarding-live/stream",
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

        poll = setInterval(() => {
          if (removeBoardingClientMock.mock.calls.length > 0) finish();
        }, 10);
        fallback = setTimeout(finish, 2000);
      });

      expect(tryAddBoardingClientMock).toHaveBeenCalledTimes(1);
      expect(tryAddBoardingClientMock).toHaveBeenCalledWith("trip-001", expect.anything(), expect.anything());
      expect(removeBoardingClientMock).toHaveBeenCalledTimes(1);
      expect(removeBoardingClientMock).toHaveBeenCalledWith("trip-001", expect.anything());
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns 429 (not an SSE upgrade) and registers no client when the connection cap is reached", async () => {
    const app = buildApp();
    selectQueue.push([{ id: "trip-001" }]); // trip lookup → found in tenant
    tryAddBoardingClientMock.mockReturnValue(false); // cap reached

    const res = await request(app).get("/api/trips/trip-001/boarding-live/stream");

    expect(res.status).toBe(429);
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(tryAddBoardingClientMock).toHaveBeenCalledTimes(1);
    expect(removeBoardingClientMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Boarding-state changes must emit a refresh to connected staff clients
// ---------------------------------------------------------------------------

describe("boarding-state changes emit a live refresh", () => {
  const requireAuthMock = vi.mocked(requireAuth);
  const emitBoardingUpdateMock = vi.mocked(emitBoardingUpdate);

  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    mockSelect.mockImplementation(() => makeChain(selectQueue.shift() ?? []));
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([]),
      }),
    });
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });
  });

  it("emits a refresh for the trip after a passenger check-in (POST /checkins)", async () => {
    const app = buildApp();
    selectQueue.push([{ id: "trip-001" }]); // trip lookup → found in tenant
    selectQueue.push([{ id: "pax-001" }]);  // passenger ownership check → belongs to trip

    const res = await request(app)
      .post("/api/trips/trip-001/checkins")
      .send({ passengerId: "pax-001", status: "present" });

    expect(res.status).toBe(201);
    expect(emitBoardingUpdateMock).toHaveBeenCalledTimes(1);
    expect(emitBoardingUpdateMock).toHaveBeenCalledWith("trip-001");
  });

  it("returns 404 when the passenger does not belong to the trip (POST /checkins)", async () => {
    const app = buildApp();
    selectQueue.push([{ id: "trip-001" }]); // trip lookup → found in tenant
    selectQueue.push([]);                    // passenger lookup → not found

    const res = await request(app)
      .post("/api/trips/trip-001/checkins")
      .send({ passengerId: "pax-999", status: "present" });

    expect(res.status).toBe(404);
    expect(emitBoardingUpdateMock).not.toHaveBeenCalled();
  });

  it("emits a refresh for the trip after a check-in is removed (DELETE /checkins/:passengerId)", async () => {
    const app = buildApp();
    selectQueue.push([{ id: "trip-001" }]); // trip lookup → found in tenant
    selectQueue.push([{ id: "pax-001" }]);  // passenger ownership check → belongs to trip

    const res = await request(app).delete("/api/trips/trip-001/checkins/pax-001");

    expect(res.status).toBe(204);
    expect(emitBoardingUpdateMock).toHaveBeenCalledTimes(1);
    expect(emitBoardingUpdateMock).toHaveBeenCalledWith("trip-001");
  });
});

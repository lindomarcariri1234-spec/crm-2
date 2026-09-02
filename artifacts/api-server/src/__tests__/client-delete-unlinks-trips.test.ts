import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { ROLES } from "@workspace/permissions";

const {
  mockSelect,
  mockTxSelect,
  mockTransaction,
  mockTxUpdate,
  mockTxSet,
  mockTxWhere,
  mockTxDelete,
  mockTxDeleteWhere,
  mockRequireAuth,
  mockDeleteUser,
  mockBroadcastSeatUpdate,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockTxSelect: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockTxSet: vi.fn(),
  mockTxWhere: vi.fn(),
  mockTxDelete: vi.fn(),
  mockTxDeleteWhere: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockDeleteUser: vi.fn(),
  mockBroadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => {
  const clientsTable = { id: "clients.id", tenantId: "clients.tenantId", userId: "clients.userId" };
  const reservationsTable = {
    id: "reservations.id",
    tenantId: "reservations.tenantId",
    clientId: "reservations.clientId",
    tripId: "reservations.tripId",
    status: "reservations.status",
    seats: "reservations.seats",
  };
  return {
    db: {
      select: mockSelect,
      transaction: mockTransaction,
    },
    clientsTable,
    reservationsTable,
    notesTable: {},
    tripsTable: { id: "trips.id", tenantId: "trips.tenantId" },
    npsResponsesTable: {},
    clientNpsResponsesTable: {},
    referralsTable: {},
    usersTable: {},
    paymentsTable: { clientId: "payments.clientId" },
    dealsTable: { clientId: "deals.clientId" },
    storeOrdersTable: { clientId: "storeOrders.clientId" },
    storeReviewsTable: { clientId: "storeReviews.clientId" },
    clientScoresTable: {},
    loyaltyMembersTable: {},
    tenantsTable: {},
    referralAttemptLogsTable: {},
    calendarEventsTable: {},
    campaignSendsTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  eq: vi.fn((column: unknown, value: unknown) => ({ type: "eq", column, value })),
  ilike: vi.fn(),
  or: vi.fn(),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
  asc: vi.fn(),
  desc: vi.fn(),
  inArray: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: { users: { deleteUser: mockDeleteUser } },
  getAuth: vi.fn(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: [ROLES.AGENCY_ADMIN],
  MANAGEMENT_ROLES: [ROLES.AGENCY_ADMIN],
}));

vi.mock("../lib/client-identity.js", () => ({
  reconcileClientIdentity: vi.fn(),
}));

vi.mock("../lib/referral-code.js", () => ({
  generateAndAssignReferralCode: vi.fn(),
}));

vi.mock("../queues/email-helpers.js", () => ({
  dispatchReferralWelcomeEmail: vi.fn(),
  dispatchReferralCodeSuspendedEmail: vi.fn(),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: { syncTrip: vi.fn().mockResolvedValue(undefined), syncBirthday: vi.fn() },
}));

vi.mock("../lib/google-calendar/schedule-sync.js", () => ({
  scheduleCalendarSyncBirthday: vi.fn(),
}));

vi.mock("../lib/client-scores.js", () => ({
  calculateScoresForClient: vi.fn(),
}));

vi.mock("../lib/redis.js", () => ({
  getRedisConnection: vi.fn(),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: mockBroadcastSeatUpdate,
}));

vi.mock("../lib/ai-client.js", () => ({
  getAIClientForTenant: vi.fn(),
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn(),
}));

import clientsRouter from "../routes/clients.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { clientsTable, reservationsTable } from "@workspace/db";

function chain<T>(result: T) {
  const promise = Promise.resolve(result);
  const current: Record<string, unknown> = {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  for (const method of ["from", "where", "orderBy", "limit", "offset", "returning", "for"]) {
    current[method] = () => current;
  }
  return current;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
    } as never;
    next();
  });
  app.use("/api", clientsRouter);
  app.use(errorHandler);
  return app;
}

describe("DELETE /api/clients/:id", () => {
  it("keeps the reservation, passengers and seats while removing its client link", async () => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      id: "agency-admin",
      tenantId: "tenant-1",
      role: ROLES.AGENCY_ADMIN,
    });
    mockSelect.mockReturnValueOnce(chain([{
      id: "client-1",
      tenantId: "tenant-1",
      userId: null,
    }]));
    mockTxUpdate.mockReturnValue({ set: mockTxSet });
    mockTxSet.mockReturnValue({ where: mockTxWhere });
    mockTxWhere.mockResolvedValue([]);
    mockTxSelect.mockReturnValue(chain([]));
    mockTxDelete.mockReturnValue({ where: mockTxDeleteWhere });
    mockTxDeleteWhere.mockResolvedValue([]);
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ select: mockTxSelect, update: mockTxUpdate, delete: mockTxDelete }),
    );

    const res = await request(buildApp()).delete("/api/clients/client-1");

    expect(res.status).toBe(200);
    expect(mockTxUpdate).toHaveBeenCalledWith(reservationsTable);
    expect(mockTxSet).toHaveBeenCalledWith({ clientId: null });
    expect(mockTxSet.mock.calls).toContainEqual([{ clientId: null }]);
    expect(mockTxDelete).toHaveBeenCalledWith(clientsTable);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("cancels linked active reservations and broadcasts every affected trip", async () => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      id: "agency-admin",
      tenantId: "tenant-1",
      role: ROLES.AGENCY_ADMIN,
    });
    mockSelect.mockReturnValueOnce(chain([{
      id: "client-1",
      tenantId: "tenant-1",
      userId: null,
    }]));
    mockTxSelect.mockReturnValue(chain([{
      id: "reservation-1",
      tripId: "trip-1",
      status: "confirmed",
      seats: ["1", "2"],
    }, {
      id: "reservation-2",
      tripId: "trip-2",
      status: "pending",
      seats: ["3"],
    }]));
    mockTxUpdate.mockReturnValue({ set: mockTxSet });
    mockTxSet.mockReturnValue({ where: mockTxWhere });
    mockTxWhere.mockResolvedValue([]);
    mockTxDelete.mockReturnValue({ where: mockTxDeleteWhere });
    mockTxDeleteWhere.mockResolvedValue([]);
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ select: mockTxSelect, update: mockTxUpdate, delete: mockTxDelete }),
    );

    const res = await request(buildApp()).delete("/api/clients/client-1");

    expect(res.status).toBe(200);
    expect(mockTxSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "cancelled",
      cancelledAt: expect.any(Date),
      clientId: null,
    }));
    expect(mockTxUpdate).toHaveBeenCalledWith(expect.anything());
    expect(mockBroadcastSeatUpdate).toHaveBeenCalledTimes(2);
    expect(mockBroadcastSeatUpdate).toHaveBeenCalledWith("trip-1", "tenant-1");
    expect(mockBroadcastSeatUpdate).toHaveBeenCalledWith("trip-2", "tenant-1");
  });
});
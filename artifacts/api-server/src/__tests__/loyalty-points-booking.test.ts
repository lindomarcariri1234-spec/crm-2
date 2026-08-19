import pino from "pino";
/**
 * POST /reservations — loyalty points deduction (real DB integration)
 *
 * Seeds a tenant, user, trip, client, loyalty program, and member into the
 * real database, then issues POST /reservations via supertest.  After each
 * request the test queries loyalty_members.available_points directly to
 * assert the exact decrement.
 *
 * External services (calendar, email, realtime, commissions) are mocked so
 * the test is self-contained. @workspace/db and drizzle-orm are NOT mocked.
 */

import { ROLES } from "@workspace/permissions";
import { randomUUID } from "crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  usersTable,
  tripsTable,
  clientsTable,
  loyaltyProgramsTable,
  loyaltyMembersTable,
  loyaltyTransactionsTable,
  reservationsTable,
  passengersTable,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// External-service mocks — DB layer intentionally unmocked
// ---------------------------------------------------------------------------

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "test_clerk" })),
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

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: { syncTrip: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

import { requireAuth } from "../lib/tenant.js";
import reservationsRouter from "../routes/reservations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Unique IDs per test run — prevents DB collisions on repeated runs
// ---------------------------------------------------------------------------

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const TENANT_ID = `tst-${RUN}`;
const USER_ID   = `tstu-${RUN}`;
const TRIP_ID   = `tstt-${RUN}`;
const CLIENT_ID = `tstc-${RUN}`;
const PROG_ID   = `tstp-${RUN}`;
const MEMBER_ID = `tstm-${RUN}`;

const INITIAL_POINTS = 500;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { log?: unknown; id?: string }, _res, next) => {
    const noop = () => {};
    req.log = pino({ level: "silent" }) as unknown as typeof req.log;
    req.id = "test-req";
    next();
  });
  app.use("/api", reservationsRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();
const requireAuthMock = vi.mocked(requireAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readAvailablePoints(memberId: string): Promise<number> {
  const [row] = await db
    .select({ availablePoints: loyaltyMembersTable.availablePoints })
    .from(loyaltyMembersTable)
    .where(eq(loyaltyMembersTable.id, memberId));
  return row.availablePoints;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POST /api/reservations — loyalty points deducted in real DB", () => {
  beforeAll(async () => {
    await db.insert(tenantsTable).values({
      id: TENANT_ID,
      name: "Test Agency",
      slug: `test-agency-${RUN}`,
      email: "test@agency.com",
      planId: "starter",
      status: "trial",
    });

    await db.insert(usersTable).values({
      id: USER_ID,
      clerkId: `clerk_${RUN}`,
      tenantId: TENANT_ID,
      name: "Test Agent",
      email: "agent@agency.com",
      role: ROLES.AGENCY_ADMIN,
      referralCode: `REF${RUN.toUpperCase()}`,
    });

    await db.insert(tripsTable).values({
      id: TRIP_ID,
      tenantId: TENANT_ID,
      name: "Test Trip",
      slug: `trip-${RUN}`,
      destination: "Fortaleza",
      destinationCity: "Fortaleza",
      destinationState: "CE",
      type: "excursao",
      category: "standard",
      departureDate: new Date("2026-07-10"),
      totalCapacity: 46,
      availableSeats: 46,
      priceAdult: "200",
      createdById: USER_ID,
    });

    await db.insert(clientsTable).values({
      id: CLIENT_ID,
      tenantId: TENANT_ID,
      name: "Ana Lima",
      email: "ana@example.com",
      whatsapp: "11999999999",
      createdById: USER_ID,
    });

    await db.insert(loyaltyProgramsTable).values({
      id: PROG_ID,
      tenantId: TENANT_ID,
      name: "Fidelidade Test",
      realPerPoint: "0.50",
      pointsPerReal: "2",
      minRedeemPoints: 1,
      isActive: true,
    });

    await db.insert(loyaltyMembersTable).values({
      id: MEMBER_ID,
      tenantId: TENANT_ID,
      programId: PROG_ID,
      clientId: CLIENT_ID,
      availablePoints: INITIAL_POINTS,
      totalPoints: INITIAL_POINTS,
    });
  });

  afterAll(async () => {
    await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, TENANT_ID));
    await db.delete(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.tenantId, TENANT_ID));
    await db.delete(loyaltyMembersTable).where(eq(loyaltyMembersTable.tenantId, TENANT_ID));
    await db.delete(loyaltyProgramsTable).where(eq(loyaltyProgramsTable.tenantId, TENANT_ID));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
    await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({
      id: USER_ID,
      clerkId: `clerk_${RUN}`,
      tenantId: TENANT_ID,
      role: ROLES.AGENCY_ADMIN,
      name: "Test Agent",
      email: "agent@agency.com",
    } as never);
    // Clean up reservations from previous test to avoid DUPLICATE_RESERVATION (unique index).
    // Passengers are deleted via CASCADE on reservationId FK.
    await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, TENANT_ID));
    await db
      .update(loyaltyMembersTable)
      .set({ availablePoints: INITIAL_POINTS })
      .where(eq(loyaltyMembersTable.id, MEMBER_ID));
  });

  it("decreases available_points by effectiveLoyaltyPoints when the discount maps 1-for-1 to requested points", async () => {
    // baseValue=800, requested=200 pts × R$0.50 = R$100 discount
    // effectivePts = min(200, ceil(100 / 0.50)) = 200  →  500 − 200 = 300
    const res = await request(app).post("/api/reservations").send({
      tripId: TRIP_ID,
      clientId: CLIENT_ID,
      seats: ["1A"],
      totalValue: 800,
      paidValue: 0,
      discountLoyaltyPoints: 200,
    });

    expect(res.status).toBe(201);
    expect(await readAvailablePoints(MEMBER_ID)).toBe(300);
  });

  it("caps the deduction at effectiveLoyaltyPoints when the discount is limited by the remaining total", async () => {
    // baseValue=100, requested=300 pts × R$0.50 = R$150 potential, capped at R$100 remaining
    // appliedLoyalty = 100;  effectivePts = min(300, ceil(100 / 0.50)) = 200
    // 500 − 200 = 300  (NOT 500 − 300 = 200)
    const res = await request(app).post("/api/reservations").send({
      tripId: TRIP_ID,
      clientId: CLIENT_ID,
      seats: ["1A"],
      totalValue: 100,
      paidValue: 0,
      discountLoyaltyPoints: 300,
    });

    expect(res.status).toBe(201);
    const points = await readAvailablePoints(MEMBER_ID);
    expect(points).toBe(300);
    expect(points).not.toBe(200);
  });
});

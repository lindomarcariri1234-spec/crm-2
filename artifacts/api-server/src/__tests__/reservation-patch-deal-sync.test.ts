/**
 * reservation-patch-deal-sync.test.ts
 *
 * Endpoint-level regression guard: PATCH /reservations/:id must invoke
 * `syncClientDeal` exactly once (fire-and-forget) when `totalValue` is
 * present in the request body and the reservation has a `clientId`.
 *
 * Strategy
 * --------
 *  • Real DB rows (tenant / user / trip / client / reservation) so the
 *    route handler has genuine data to work with.
 *  • `syncClientDeal` is vi.mock'd → captured as a spy so we can assert
 *    call count and arguments without running the full pipeline logic.
 *  • All fire-and-forget side-effects are stubbed out so the test does not
 *    depend on email queues, Clerk, calendar sync, etc.
 *
 * Scenarios
 * ---------
 *  1. PATCH with totalValue → syncClientDeal called exactly once with
 *     the new value and the reservation's ID.
 *  2. PATCH WITHOUT totalValue (status-only update) → syncClientDeal NOT
 *     called (guard condition `parsed.data.totalValue != null` is false).
 */

import { randomUUID } from "crypto";
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  usersTable,
  tripsTable,
  clientsTable,
  reservationsTable,
} from "@workspace/db";
import { ROLES, RESERVATION_STATUS } from "@workspace/permissions";

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------

const { mockSyncClientDeal } = vi.hoisted(() => ({
  mockSyncClientDeal: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Module mocks — must appear before any import of the module under test
// ---------------------------------------------------------------------------

vi.mock("../services/pipeline-deal-sync.js", () => ({
  syncClientDeal: mockSyncClientDeal,
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: { createUser: vi.fn(), getUserList: vi.fn() },
    signInTokens: { createSignInToken: vi.fn() },
  },
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
  ADMIN_ROLES: ["admin", "agency_admin"],
  MANAGEMENT_ROLES: ["admin", "agency_admin", "gerente"],
}));

vi.mock("../routes/payments.js", () => ({
  syncReservationCommission: vi.fn().mockResolvedValue(undefined),
  recalculateClientFinancials: vi.fn().mockResolvedValue(undefined),
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    use: vi.fn(),
  },
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralReversedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppReservationConfirmed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/commission-sync-helper.js", () => ({
  enqueueCommissionSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: { syncTrip: vi.fn().mockResolvedValue(undefined) },
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

vi.mock("../lib/trip-overlap-notify.js", () => ({
  detectAndNotifyTripOverlap: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/loyalty-helpers.js", () => ({
  loyaltyAwardPointsForReservation: vi.fn().mockResolvedValue(undefined),
  calculateTier: vi.fn().mockReturnValue("bronze"),
}));

vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
  cancelDealOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/reservation-number.js", () => ({
  getTenantReservationPrefix: vi.fn().mockResolvedValue("AG"),
  nextReservationSequence: vi.fn().mockResolvedValue(1),
  buildReservationNumber: vi.fn(() => "AG-EX-202507-0001"),
  getYearMonth: vi.fn(() => "202507"),
  tripTypeToCode: vi.fn(() => "EX"),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => randomUUID()),
  generateVoucherCode: vi.fn(() => `VCH-${randomUUID().slice(0, 8).toUpperCase()}`),
}));

// ---------------------------------------------------------------------------
// Imports that must come AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import reservationsRouter from "../routes/reservations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Test fixtures — unique per test run to avoid cross-test pollution
// ---------------------------------------------------------------------------

const RUN          = randomUUID().replace(/-/g, "").slice(0, 8);
const TENANT_ID    = `pdstest-${RUN}`;
const USER_ID      = `pdsu-${RUN}`;
const TRIP_ID      = `pdst-${RUN}`;
const CLIENT_ID    = `pdsc-${RUN}`;
const RES_ID       = `pdsr-${RUN}`;

// ---------------------------------------------------------------------------
// Express app factory
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request, _res, next) => {
    const noop = () => {};
    (req as unknown as Record<string, unknown>).log = {
      trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    };
    (req as unknown as Record<string, unknown>).id = "test-req";
    next();
  });
  app.use("/api", reservationsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// DB setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Provide a mock user for requireAuth across all tests in this file
  vi.mocked(requireAuth).mockResolvedValue({
    id:       USER_ID,
    tenantId: TENANT_ID,
    role:     ROLES.AGENCY_ADMIN,
    clerkId:  `pds_clerk_${RUN}`,
    name:     "Test Admin",
    email:    `admin-${RUN}@test.com`,
  } as never);

  await db.insert(tenantsTable).values({
    id:     TENANT_ID,
    name:   "PDS Test Agency",
    slug:   `pds-agency-${RUN}`,
    email:  `pds-${RUN}@agency.com`,
    planId: "starter",
    status: "trial",
  });

  await db.insert(usersTable).values({
    id:           USER_ID,
    clerkId:      `pds_clerk_${RUN}`,
    tenantId:     TENANT_ID,
    name:         "Test Admin",
    email:        `admin-${RUN}@agency.com`,
    role:         ROLES.AGENCY_ADMIN,
    referralCode: `PDS${RUN.toUpperCase()}`,
  });

  await db.insert(tripsTable).values({
    id:               TRIP_ID,
    tenantId:         TENANT_ID,
    name:             "PDS Test Trip",
    slug:             `pds-trip-${RUN}`,
    destination:      "Salvador",
    destinationCity:  "Salvador",
    destinationState: "BA",
    type:             "excursao",
    category:         "standard",
    departureDate:    new Date("2028-03-15"),
    totalCapacity:    40,
    availableSeats:   40,
    reservedSeats:    0,
    priceAdult:       "1200",
    createdById:      USER_ID,
  });

  await db.insert(clientsTable).values({
    id:        CLIENT_ID,
    tenantId:  TENANT_ID,
    name:      "PDS Test Client",
    email:     `client-${RUN}@test.com`,
    whatsapp:  "71999990000",
    createdById: USER_ID,
  });

  await db.insert(reservationsTable).values({
    id:           RES_ID,
    tenantId:     TENANT_ID,
    tripId:       TRIP_ID,
    clientId:     CLIENT_ID,
    createdById:  USER_ID,
    status:       RESERVATION_STATUS.PENDING,
    totalValue:   "1200",
    paidValue:    "0",
    balance:      "1200",
    seats:        [],
    tripType:     "excursao",
    voucherCode:  `VCH${RUN.toUpperCase()}`,
    qrCode:       `QR${RUN.toUpperCase()}`,
  });
});

afterAll(async () => {
  // Allow fire-and-forget promises to settle before tearing down rows
  await new Promise((resolve) => setTimeout(resolve, 200));

  await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, TENANT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(tripsTable).where(eq(tripsTable.tenantId, TENANT_ID));
  await db.delete(usersTable).where(eq(usersTable.tenantId, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

afterEach(() => {
  mockSyncClientDeal.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PATCH /reservations/:id — syncClientDeal call-site guard", () => {

  it("1 — calls syncClientDeal exactly once with the updated totalValue and reservationId", async () => {
    const app = buildApp();

    const res = await request(app)
      .patch(`/api/reservations/${RES_ID}`)
      .send({ totalValue: 1500 });

    // Route should succeed (200)
    expect(res.status).toBe(200);

    // Allow the fire-and-forget Promise to flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    // syncClientDeal must be called exactly once
    expect(mockSyncClientDeal).toHaveBeenCalledTimes(1);
    expect(mockSyncClientDeal).toHaveBeenCalledWith(
      CLIENT_ID,   // clientId from existing reservation
      TENANT_ID,   // tenantId from authenticated user
      TRIP_ID,     // tripId from existing reservation
      1500,        // the UPDATED totalValue from PATCH body
      USER_ID,     // ownerId = me.id
      RES_ID,      // reservationId = req.params.id
    );
  });

  it("2 — does NOT call syncClientDeal when totalValue is absent from the PATCH body", async () => {
    const app = buildApp();

    const res = await request(app)
      .patch(`/api/reservations/${RES_ID}`)
      .send({ notes: "Updated notes only — no totalValue change" });

    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Guard condition: `parsed.data.totalValue != null` must be false → no call
    expect(mockSyncClientDeal).not.toHaveBeenCalled();
  });

});

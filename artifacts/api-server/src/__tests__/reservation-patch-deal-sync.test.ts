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
  passengersTable,
  calendarEventsTable,
} from "@workspace/db";
import { ROLES, RESERVATION_STATUS, TRIP_STATUS } from "@workspace/permissions";

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------

const {
  mockSyncClientDeal,
  mockBroadcastSeatUpdate,
  mockSyncTrip,
  mockSyncTrips,
  mockEventsInsert,
  mockEventsPatch,
  mockEventsDelete,
} = vi.hoisted(() => ({
  mockSyncClientDeal: vi.fn().mockResolvedValue(undefined),
  mockBroadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
  mockSyncTrip: vi.fn().mockResolvedValue(undefined),
  mockSyncTrips: vi.fn(async (tripIds: Iterable<string>) => {
    for (const tripId of tripIds) {
      await mockSyncTrip(tripId);
    }
  }),
  mockEventsInsert: vi.fn(),
  mockEventsPatch: vi.fn(),
  mockEventsDelete: vi.fn(),
}));

const mockGoogleCalendar = {
  events: {
    insert: mockEventsInsert,
    patch: mockEventsPatch,
    delete: mockEventsDelete,
  },
};

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
  broadcastSeatUpdate: mockBroadcastSeatUpdate,
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
  CalendarSyncService: {
    syncTrip: mockSyncTrip,
    syncTrips: mockSyncTrips,
    syncTripOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("googleapis", () => ({
  google: {
    calendar: vi.fn(() => mockGoogleCalendar),
    auth: {
      OAuth2: vi.fn(() => ({
        setCredentials: vi.fn(),
        refreshAccessToken: vi.fn(),
      })),
    },
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
const DESTINATION_TRIP_ID = `pds-destination-trip-${RUN}`;
const CLIENT_ID    = `pdsc-${RUN}`;
const RES_ID       = `pdsr-${RUN}`;
const SELLER_ID    = `pdss-${RUN}`;
const OTHER_CLIENT_ID = `pdsc-other-${RUN}`;
const OTHER_RES_ID = `pdsr-other-${RUN}`;

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

  await db.insert(usersTable).values({
    id:           SELLER_ID,
    clerkId:      `pds_seller_clerk_${RUN}`,
    tenantId:     TENANT_ID,
    name:         "Test Seller",
    email:        `seller-${RUN}@agency.com`,
    role:         ROLES.SALES,
    referralCode: `PDSS${RUN.toUpperCase()}`,
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

  await db.insert(tripsTable).values({
    id:               DESTINATION_TRIP_ID,
    tenantId:         TENANT_ID,
    name:             "PDS Destination Trip",
    slug:             `pds-destination-trip-${RUN}`,
    destination:      "Recife",
    destinationCity:  "Recife",
    destinationState: "PE",
    type:             "excursao",
    category:         "standard",
    departureDate:    new Date("2028-04-15"),
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

  await db.insert(clientsTable).values({
    id:        OTHER_CLIENT_ID,
    tenantId:  TENANT_ID,
    name:      "Other Seller Client",
    email:     `other-client-${RUN}@test.com`,
    whatsapp:  "71999990001",
    createdById: USER_ID,
  });

  await db.insert(reservationsTable).values({
    id:           OTHER_RES_ID,
    tenantId:     TENANT_ID,
    tripId:       TRIP_ID,
    clientId:     OTHER_CLIENT_ID,
    createdById:  USER_ID,
    status:       RESERVATION_STATUS.PENDING,
    totalValue:   "1200",
    paidValue:    "0",
    balance:      "1200",
    seats:        [],
    tripType:     "excursao",
    voucherCode:  `OTHER${RUN.toUpperCase()}`,
    qrCode:       `QR-OTHER${RUN.toUpperCase()}`,
  });

  await db.insert(passengersTable).values({
    id: `pdsp-${RUN}`,
    reservationId: RES_ID,
    name: "Visible Passenger",
    ageCategory: "adult",
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
  mockBroadcastSeatUpdate.mockClear();
  mockSyncTrip.mockClear();
  mockSyncTrips.mockClear();
  vi.mocked(requireAuth).mockResolvedValue({
    id: USER_ID, tenantId: TENANT_ID, role: ROLES.AGENCY_ADMIN,
    clerkId: `pds_clerk_${RUN}`, name: "Test Admin", email: `admin-${RUN}@test.com`,
  } as never);
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

  it("3 — keeps the responsible seller when a reservation total is synchronized to the pipeline", async () => {
    const app = buildApp();

    const res = await request(app)
      .patch(`/api/reservations/${RES_ID}`)
      .send({ sellerId: SELLER_ID, totalValue: 1600 });

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockSyncClientDeal).toHaveBeenCalledWith(
      CLIENT_ID, TENANT_ID, TRIP_ID, 1600, SELLER_ID, RES_ID,
    );
  });

  it("4 — broadcasts seat updates for both trips when a reservation changes trips", async () => {
    const app = buildApp();

    const res = await request(app)
      .patch(`/api/reservations/${RES_ID}`)
      .send({ tripId: DESTINATION_TRIP_ID });

    expect(res.status).toBe(200);
    expect(res.body.tripId).toBe(DESTINATION_TRIP_ID);
    expect(mockBroadcastSeatUpdate).toHaveBeenCalledTimes(2);
    expect(mockBroadcastSeatUpdate.mock.calls.map(([tripId, tenantId]) => [tripId, tenantId]))
      .toEqual([
        [TRIP_ID, TENANT_ID],
        [DESTINATION_TRIP_ID, TENANT_ID],
      ]);
  });

  it("5 — syncs the origin and destination calendars once when a reservation changes trips", async () => {
    const app = buildApp();

    // Scenario 4 leaves this reservation on the destination trip, so move it
    // back and assert that this single move synchronizes both affected trips.
    const move = await request(app)
      .patch(`/api/reservations/${RES_ID}`)
      .send({ tripId: TRIP_ID });

    expect(move.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockSyncTrips).toHaveBeenCalledTimes(1);
    expect(mockSyncTrips).toHaveBeenCalledWith([DESTINATION_TRIP_ID, TRIP_ID]);
    expect(mockSyncTrip).toHaveBeenCalledTimes(2);
    expect(mockSyncTrip.mock.calls.map(([tripId]) => tripId))
      .toEqual([DESTINATION_TRIP_ID, TRIP_ID]);
  });

  it("6 — removes the old seller event and keeps one event per trip after a reservation move", async () => {
    const { CalendarSyncService: realCalendarSyncService } =
      await vi.importActual<typeof import("../lib/google-calendar/sync-service.js")>(
        "../lib/google-calendar/sync-service.js",
      );
    const originGoogleEventId = `gcal-origin-${RUN}`;
    const destinationGoogleEventId = `gcal-destination-${RUN}`;

    mockEventsInsert.mockReset();
    mockEventsPatch.mockReset().mockResolvedValue({});
    mockEventsDelete.mockReset().mockResolvedValue({});

    await db.update(tripsTable).set({ status: TRIP_STATUS.PUBLISHED })
      .where(eq(tripsTable.id, TRIP_ID));
    await db.update(tripsTable).set({ status: TRIP_STATUS.PUBLISHED })
      .where(eq(tripsTable.id, DESTINATION_TRIP_ID));
    await db.update(usersTable).set({
      googleCalendarEnabled: true,
      googleAccessToken: `calendar-token-${RUN}`,
    }).where(eq(usersTable.id, SELLER_ID));
    await db.update(reservationsTable).set({
      tripId: DESTINATION_TRIP_ID,
      sellerId: SELLER_ID,
      status: RESERVATION_STATUS.CONFIRMED,
    }).where(eq(reservationsTable.id, RES_ID));

    await db.insert(calendarEventsTable).values([
      {
        id: `pds-calendar-origin-${RUN}`,
        tenantId: TENANT_ID,
        userId: SELLER_ID,
        tripId: TRIP_ID,
        googleEventId: originGoogleEventId,
        eventType: "trip",
        title: "🚌 PDS Test Trip",
        startDate: new Date("2028-03-15T00:00:00Z"),
      },
      {
        id: `pds-calendar-destination-${RUN}`,
        tenantId: TENANT_ID,
        userId: SELLER_ID,
        tripId: DESTINATION_TRIP_ID,
        googleEventId: destinationGoogleEventId,
        eventType: "trip",
        title: "🚌 PDS Destination Trip",
        startDate: new Date("2028-04-15T00:00:00Z"),
      },
    ]);

    await realCalendarSyncService.syncTrips([TRIP_ID, DESTINATION_TRIP_ID]);

    expect(mockEventsDelete).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: originGoogleEventId,
      sendUpdates: "none",
    });
    expect(mockEventsPatch).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: "primary",
      eventId: destinationGoogleEventId,
      sendUpdates: "none",
    }));
    expect(mockEventsInsert).not.toHaveBeenCalled();

    const remainingEvents = await db.select({
      tripId: calendarEventsTable.tripId,
      userId: calendarEventsTable.userId,
      googleEventId: calendarEventsTable.googleEventId,
    }).from(calendarEventsTable).where(eq(calendarEventsTable.tenantId, TENANT_ID));
    const eventsForTrip = (tripId: string) =>
      remainingEvents.filter((event) => event.tripId === tripId && event.userId === SELLER_ID);

    expect(eventsForTrip(TRIP_ID)).toHaveLength(0);
    expect(eventsForTrip(DESTINATION_TRIP_ID)).toEqual([{
      tripId: DESTINATION_TRIP_ID,
      userId: SELLER_ID,
      googleEventId: destinationGoogleEventId,
    }]);
    expect(eventsForTrip(TRIP_ID).length).toBeLessThanOrEqual(1);
    expect(eventsForTrip(DESTINATION_TRIP_ID).length).toBeLessThanOrEqual(1);
  });

  it("7 — creates the seller event on the destination when no local event exists", async () => {
    const { CalendarSyncService: realCalendarSyncService } =
      await vi.importActual<typeof import("../lib/google-calendar/sync-service.js")>(
        "../lib/google-calendar/sync-service.js",
      );
    const originGoogleEventId = `gcal-origin-create-${RUN}`;
    const destinationGoogleEventId = `gcal-destination-create-${RUN}`;

    mockEventsInsert.mockReset().mockResolvedValue({ data: { id: destinationGoogleEventId } });
    mockEventsPatch.mockReset().mockResolvedValue({});
    mockEventsDelete.mockReset().mockResolvedValue({});

    await db.delete(calendarEventsTable).where(eq(calendarEventsTable.tenantId, TENANT_ID));
    await db.update(tripsTable).set({ status: TRIP_STATUS.PUBLISHED })
      .where(eq(tripsTable.id, TRIP_ID));
    await db.update(tripsTable).set({ status: TRIP_STATUS.PUBLISHED })
      .where(eq(tripsTable.id, DESTINATION_TRIP_ID));
    await db.update(usersTable).set({
      googleCalendarEnabled: true,
      googleAccessToken: `calendar-token-${RUN}`,
    }).where(eq(usersTable.id, SELLER_ID));
    await db.update(reservationsTable).set({
      tripId: DESTINATION_TRIP_ID,
      sellerId: SELLER_ID,
      status: RESERVATION_STATUS.CONFIRMED,
    }).where(eq(reservationsTable.id, RES_ID));
    await db.insert(calendarEventsTable).values({
      id: `pds-calendar-origin-create-${RUN}`,
      tenantId: TENANT_ID,
      userId: SELLER_ID,
      tripId: TRIP_ID,
      googleEventId: originGoogleEventId,
      eventType: "trip",
      title: "🚌 PDS Test Trip",
      startDate: new Date("2028-03-15T00:00:00Z"),
    });

    const eventsBeforeSync = await db.select({
      tripId: calendarEventsTable.tripId,
      googleEventId: calendarEventsTable.googleEventId,
    }).from(calendarEventsTable).where(eq(calendarEventsTable.tenantId, TENANT_ID));
    expect(eventsBeforeSync).toEqual([{
      tripId: TRIP_ID,
      googleEventId: originGoogleEventId,
    }]);

    await realCalendarSyncService.syncTrips([TRIP_ID, DESTINATION_TRIP_ID]);

    expect(mockEventsInsert).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: "primary",
      requestBody: expect.objectContaining({
        summary: "🚌 PDS Destination Trip",
      }),
      sendUpdates: "none",
    }));
    expect(mockEventsDelete).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: originGoogleEventId,
      sendUpdates: "none",
    });

    const remainingEvents = await db.select({
      tripId: calendarEventsTable.tripId,
      userId: calendarEventsTable.userId,
      googleEventId: calendarEventsTable.googleEventId,
    }).from(calendarEventsTable).where(eq(calendarEventsTable.tenantId, TENANT_ID));
    expect(remainingEvents).toEqual([{
      tripId: DESTINATION_TRIP_ID,
      userId: SELLER_ID,
      googleEventId: destinationGoogleEventId,
    }]);
    expect(remainingEvents.some((event) => event.tripId === TRIP_ID)).toBe(false);
  });

  it("8 — concurrent syncs create and persist at most one seller event for a trip", async () => {
    const { CalendarSyncService: realCalendarSyncService } =
      await vi.importActual<typeof import("../lib/google-calendar/sync-service.js")>(
        "../lib/google-calendar/sync-service.js",
      );
    const googleEventId = `gcal-concurrent-${RUN}`;

    mockEventsInsert.mockReset().mockResolvedValue({ data: { id: googleEventId } });
    mockEventsPatch.mockReset().mockResolvedValue({});
    mockEventsDelete.mockReset().mockResolvedValue({});

    await db.delete(calendarEventsTable).where(eq(calendarEventsTable.tenantId, TENANT_ID));
    await db.update(tripsTable).set({ status: TRIP_STATUS.PUBLISHED })
      .where(eq(tripsTable.id, TRIP_ID));
    await db.update(usersTable).set({
      googleCalendarEnabled: true,
      googleAccessToken: `calendar-token-${RUN}`,
    }).where(eq(usersTable.id, SELLER_ID));
    await db.update(reservationsTable).set({
      tripId: TRIP_ID,
      sellerId: SELLER_ID,
      status: RESERVATION_STATUS.CONFIRMED,
    }).where(eq(reservationsTable.id, RES_ID));

    await Promise.all([
      realCalendarSyncService.syncTrips([TRIP_ID]),
      realCalendarSyncService.syncTrips([TRIP_ID]),
    ]);

    expect(mockEventsInsert).toHaveBeenCalledTimes(1);
    expect(mockEventsPatch).toHaveBeenCalledTimes(1);

    const persistedEvents = await db.select({
      tripId: calendarEventsTable.tripId,
      userId: calendarEventsTable.userId,
      eventType: calendarEventsTable.eventType,
      googleEventId: calendarEventsTable.googleEventId,
    }).from(calendarEventsTable).where(eq(calendarEventsTable.tenantId, TENANT_ID));
    expect(persistedEvents).toEqual([{
      tripId: TRIP_ID,
      userId: SELLER_ID,
      eventType: "trip",
      googleEventId,
    }]);
  });

  it("9 — recovers an external event after local persistence was lost without creating a duplicate", async () => {
    const { CalendarSyncService: realCalendarSyncService } =
      await vi.importActual<typeof import("../lib/google-calendar/sync-service.js")>(
        "../lib/google-calendar/sync-service.js",
      );
    let externalGoogleEventId: string | undefined;

    mockEventsInsert.mockReset().mockImplementation(async ({ requestBody }: {
      requestBody: { id?: string; summary?: string };
    }) => {
      if (!externalGoogleEventId) {
        externalGoogleEventId = requestBody.id;
        return { data: { id: externalGoogleEventId } };
      }

      const conflict = new Error("Event already exists");
      (conflict as unknown as { response: { status: number } }).response = { status: 409 };
      throw conflict;
    });
    mockEventsPatch.mockReset().mockResolvedValue({});
    mockEventsDelete.mockReset().mockResolvedValue({});

    await db.delete(calendarEventsTable).where(eq(calendarEventsTable.tenantId, TENANT_ID));
    await db.update(tripsTable).set({ status: TRIP_STATUS.PUBLISHED })
      .where(eq(tripsTable.id, TRIP_ID));
    await db.update(usersTable).set({
      googleCalendarEnabled: true,
      googleAccessToken: `calendar-token-${RUN}`,
    }).where(eq(usersTable.id, SELLER_ID));
    await db.update(reservationsTable).set({
      tripId: TRIP_ID,
      sellerId: SELLER_ID,
      status: RESERVATION_STATUS.CONFIRMED,
    }).where(eq(reservationsTable.id, RES_ID));

    // First run models Google succeeding before the local write. Removing the
    // row models a process/network failure in the persistence window.
    await realCalendarSyncService.syncTrips([TRIP_ID]);
    await db.delete(calendarEventsTable).where(eq(calendarEventsTable.tenantId, TENANT_ID));

    await realCalendarSyncService.syncTrips([TRIP_ID]);

    expect(mockEventsInsert).toHaveBeenCalledTimes(2);
    expect(mockEventsInsert.mock.calls[0][0].requestBody.id).toBe(externalGoogleEventId);
    expect(mockEventsInsert.mock.calls[1][0].requestBody.id).toBe(externalGoogleEventId);

    const persistedEvents = await db.select({
      tripId: calendarEventsTable.tripId,
      userId: calendarEventsTable.userId,
      eventType: calendarEventsTable.eventType,
      googleEventId: calendarEventsTable.googleEventId,
    }).from(calendarEventsTable).where(eq(calendarEventsTable.tenantId, TENANT_ID));
    expect(persistedEvents).toEqual([{
      tripId: TRIP_ID,
      userId: SELLER_ID,
      eventType: "trip",
      googleEventId: externalGoogleEventId,
    }]);
  });

  it("10 — scopes list, stats, details and passengers to reservations assigned to the seller", async () => {
    await db.update(reservationsTable).set({ sellerId: SELLER_ID })
      .where(eq(reservationsTable.id, RES_ID));
    vi.mocked(requireAuth).mockResolvedValue({
      id: SELLER_ID, tenantId: TENANT_ID, role: ROLES.SALES,
      clerkId: `pds_seller_clerk_${RUN}`, name: "Test Seller", email: `seller-${RUN}@agency.com`,
    } as never);
    const app = buildApp();

    const [list, stats, detail, passengers, outside] = await Promise.all([
      request(app).get("/api/reservations"),
      request(app).get("/api/reservations/stats"),
      request(app).get(`/api/reservations/${RES_ID}`),
      request(app).get(`/api/reservations/${RES_ID}/passengers`),
      request(app).get(`/api/reservations/${OTHER_RES_ID}`),
    ]);

    expect(list.status).toBe(200);
    expect(list.body.data.map((reservation: { id: string }) => reservation.id)).toEqual([RES_ID]);
    expect(stats.status).toBe(200);
    expect(stats.body.total).toBe(1);
    expect(detail.status).toBe(200);
    expect(passengers.status).toBe(200);
    expect(passengers.body).toHaveLength(1);
    expect(outside.status).toBe(404);
  });

  it("9 — does not reveal overlap metadata for another seller's client", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: SELLER_ID, tenantId: TENANT_ID, role: ROLES.SALES,
      clerkId: `pds_seller_clerk_${RUN}`, name: "Test Seller", email: `seller-${RUN}@agency.com`,
    } as never);

    const response = await request(buildApp())
      .get(`/api/reservations/trip-overlap?clientId=${OTHER_CLIENT_ID}&tripId=${TRIP_ID}`);

    expect(response.status).toBe(404);
  });

});

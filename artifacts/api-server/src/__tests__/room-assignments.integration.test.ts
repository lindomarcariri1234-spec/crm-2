import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  usersTable,
  accommodationsTable,
  accommodationRoomsTable,
  tripsTable,
  reservationsTable,
  passengersTable,
  reservationRoomAssignmentsTable,
} from "@workspace/db";
import { ROLES, RESERVATION_STATUS } from "@workspace/permissions";

const authTenant = vi.hoisted(() => ({ id: "", tenantId: "", role: "agencia" }));

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "room-test-user" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(async () => ({
    id: authTenant.id,
    tenantId: authTenant.tenantId,
    role: authTenant.role,
  })),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["superadmin", "agencia"],
  MANAGEMENT_ROLES: ["superadmin", "agencia", "gerente"],
}));

vi.mock("../lib/realtime.js", () => ({ broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/seat-sse.js", () => ({
  addSeatClient: vi.fn(),
  removeSeatClient: vi.fn(),
  emitSeatUpdate: vi.fn(),
}));
vi.mock("../lib/boarding-sse.js", () => ({
  tryAddBoardingClient: vi.fn(),
  removeBoardingClient: vi.fn(),
  emitBoardingUpdate: vi.fn(),
}));
vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
    syncTripOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
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
  dispatchWhatsAppCadastroRealizado: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/activities.js", () => ({ writeClientActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/client-notifications.js", () => ({ insertClientNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/push-notifications.js", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/trip-overlap-notify.js", () => ({ detectAndNotifyTripOverlap: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/loyalty-helpers.js", () => ({
  calculateTier: vi.fn().mockReturnValue("bronze"),
  loyaltyAwardPointsForReservation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
  cancelDealOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/pipeline-deal-sync.js", () => ({ syncClientDeal: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../routes/payments.js", () => ({
  syncReservationCommission: vi.fn().mockResolvedValue(undefined),
  recalculateClientFinancials: vi.fn().mockResolvedValue(undefined),
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), use: vi.fn() },
}));
vi.mock("../lib/uploadthing.js", () => ({
  deleteOrphanedImages: vi.fn().mockResolvedValue(undefined),
  deleteOrphanedFile: vi.fn().mockResolvedValue(undefined),
}));

import { requireAuth } from "../lib/tenant.js";
import reservationsRouter from "../routes/reservations.js";
import registrationsRouter from "../routes/registrations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const run = randomUUID().replace(/-/g, "").slice(0, 10);
const tenantA = `room-tenant-a-${run}`;
const tenantB = `room-tenant-b-${run}`;
const userA = `room-user-a-${run}`;
const userB = `room-user-b-${run}`;
const accommodationA = `room-accommodation-a-${run}`;
const accommodationB = `room-accommodation-b-${run}`;
const roomA = `room-a-${run}`;
const roomLarge = `room-large-${run}`;
const roomInactive = `room-inactive-${run}`;
const roomB = `room-b-${run}`;
const tripA = `room-trip-a-${run}`;
const tripA2 = `room-trip-a2-${run}`;
const tripB = `room-trip-b-${run}`;
const reservationIds = ["one", "two", "three", "four"].map(s => `room-res-${s}-${run}`);
const passengerIds = ["one", "two", "three", "four"].map(s => `room-passenger-${s}-${run}`);
const reservationB = `room-res-b-${run}`;
const passengerB = `room-passenger-b-${run}`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", reservationsRouter);
  app.use("/api", registrationsRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

async function assign(reservationId: string, roomId: string | null) {
  return request(app)
    .put(`/api/reservations/${reservationId}/room-assignments`)
    .send({ assignments: [{ passengerId: passengerIds[reservationIds.indexOf(reservationId)] ?? passengerB, roomId }] });
}

async function clearAssignments() {
  await db.delete(reservationRoomAssignmentsTable).where(
    inArray(reservationRoomAssignmentsTable.tenantId, [tenantA, tenantB]),
  );
  await db.update(reservationsTable).set({ status: RESERVATION_STATUS.PENDING, tripId: tripA })
    .where(inArray(reservationsTable.id, reservationIds));
}

beforeAll(async () => {
  await db.insert(tenantsTable).values([
    { id: tenantA, name: "Room Test A", slug: `room-test-a-${run}`, email: `room-a-${run}@test.com` },
    { id: tenantB, name: "Room Test B", slug: `room-test-b-${run}`, email: `room-b-${run}@test.com` },
  ]);
  await db.insert(usersTable).values([
    { id: userA, clerkId: `room-clerk-a-${run}`, tenantId: tenantA, name: "Room Admin A", email: `room-admin-a-${run}@test.com`, role: ROLES.AGENCY_ADMIN, referralCode: `ROOMA${run}` },
    { id: userB, clerkId: `room-clerk-b-${run}`, tenantId: tenantB, name: "Room Admin B", email: `room-admin-b-${run}@test.com`, role: ROLES.AGENCY_ADMIN, referralCode: `ROOMB${run}` },
  ]);
  await db.insert(accommodationsTable).values([
    { id: accommodationA, tenantId: tenantA, name: "Hotel A", type: "hotel" },
    { id: accommodationB, tenantId: tenantB, name: "Hotel B", type: "hotel" },
  ]);
  await db.insert(accommodationRoomsTable).values([
    { id: roomA, tenantId: tenantA, accommodationId: accommodationA, name: "A-1", category: "standard", capacity: 1 },
    { id: roomLarge, tenantId: tenantA, accommodationId: accommodationA, name: "A-2", category: "standard", capacity: 2 },
    { id: roomInactive, tenantId: tenantA, accommodationId: accommodationA, name: "A-3", category: "standard", capacity: 2, status: "inactive" },
    { id: roomB, tenantId: tenantB, accommodationId: accommodationB, name: "B-1", category: "standard", capacity: 1 },
  ]);
  await db.insert(tripsTable).values([
    {
      id: tripA, tenantId: tenantA, name: "Trip A", slug: `room-trip-a-${run}`,
      destination: "A", destinationCity: "A", destinationState: "CE", type: "excursao", category: "standard",
      departureDate: new Date("2030-01-01"), totalCapacity: 20, availableSeats: 20, priceAdult: "100", createdById: userA,
      accommodationId: accommodationA,
    },
    {
      id: tripA2, tenantId: tenantA, name: "Trip A2", slug: `room-trip-a2-${run}`,
      destination: "A2", destinationCity: "A2", destinationState: "CE", type: "excursao", category: "standard",
      departureDate: new Date("2030-02-01"), totalCapacity: 20, availableSeats: 20, priceAdult: "100", createdById: userA,
      accommodationId: accommodationA,
    },
    {
      id: tripB, tenantId: tenantB, name: "Trip B", slug: `room-trip-b-${run}`,
      destination: "B", destinationCity: "B", destinationState: "CE", type: "excursao", category: "standard",
      departureDate: new Date("2030-03-01"), totalCapacity: 20, availableSeats: 20, priceAdult: "100", createdById: userB,
      accommodationId: accommodationB,
    },
  ]);
  await db.insert(reservationsTable).values([
    ...reservationIds.map((id, index) => ({
      id, tenantId: tenantA, tripId: tripA, createdById: userA, status: RESERVATION_STATUS.PENDING,
      totalValue: "100", paidValue: "0", balance: "100", seats: [], tripType: "excursao",
      voucherCode: `ROOM-VOUCHER-${index}-${run}`, qrCode: `ROOM-QR-${index}-${run}`,
    })),
    {
      id: reservationB, tenantId: tenantB, tripId: tripB, createdById: userB, status: RESERVATION_STATUS.PENDING,
      totalValue: "100", paidValue: "0", balance: "100", seats: [], tripType: "excursao",
      voucherCode: `ROOM-VOUCHER-B-${run}`, qrCode: `ROOM-QR-B-${run}`,
    },
  ]);
  await db.insert(passengersTable).values([
    ...passengerIds.map((id, index) => ({ id, reservationId: reservationIds[index], name: `Passenger ${index}`, ageCategory: "adult" })),
    { id: passengerB, reservationId: reservationB, name: "Passenger B", ageCategory: "adult" },
  ]);
});

beforeEach(async () => {
  await clearAssignments();
  authTenant.id = userA;
  authTenant.tenantId = tenantA;
  vi.mocked(requireAuth).mockImplementation(async () => ({
    id: authTenant.id,
    tenantId: authTenant.tenantId,
    role: authTenant.role,
  }) as never);
  await db.update(accommodationRoomsTable).set({ capacity: 1, status: "active" }).where(eq(accommodationRoomsTable.id, roomA));
  await db.update(accommodationRoomsTable).set({ capacity: 2, status: "active" }).where(eq(accommodationRoomsTable.id, roomLarge));
  await db.update(accommodationRoomsTable).set({ status: "inactive" }).where(eq(accommodationRoomsTable.id, roomInactive));
});

afterAll(async () => {
  await db.delete(reservationRoomAssignmentsTable).where(inArray(reservationRoomAssignmentsTable.tenantId, [tenantA, tenantB]));
  await db.delete(reservationsTable).where(inArray(reservationsTable.tenantId, [tenantA, tenantB]));
  await db.delete(tripsTable).where(inArray(tripsTable.tenantId, [tenantA, tenantB]));
  await db.delete(accommodationRoomsTable).where(inArray(accommodationRoomsTable.tenantId, [tenantA, tenantB]));
  await db.delete(accommodationsTable).where(inArray(accommodationsTable.tenantId, [tenantA, tenantB]));
  await db.delete(usersTable).where(inArray(usersTable.tenantId, [tenantA, tenantB]));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [tenantA, tenantB]));
});

describe("room assignments", () => {
  it("serializes concurrent assignments and rejects the one that exceeds capacity", async () => {
    const results = await Promise.all([
      assign(reservationIds[0], roomA),
      assign(reservationIds[1], roomA),
    ]);

    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(results.find(result => result.status === 409)?.body.code).toBe("ROOM_CAPACITY_EXCEEDED");
    const assignments = await db.select().from(reservationRoomAssignmentsTable)
      .where(and(eq(reservationRoomAssignmentsTable.tenantId, tenantA), eq(reservationRoomAssignmentsTable.roomId, roomA)));
    expect(assignments).toHaveLength(1);
  });

  it("does not expose or mutate another agency's reservation or room", async () => {
    authTenant.id = userB;
    authTenant.tenantId = tenantB;

    const getResponse = await request(app).get(`/api/reservations/${reservationIds[0]}/room-assignments`);
    expect(getResponse.status).toBe(404);

    const putResponse = await request(app)
      .put(`/api/reservations/${reservationIds[0]}/room-assignments`)
      .send({ assignments: [{ passengerId: passengerIds[0], roomId: roomB }] });
    expect(putResponse.status).toBe(404);

    const leaked = await db.select().from(reservationRoomAssignmentsTable)
      .where(eq(reservationRoomAssignmentsTable.reservationId, reservationIds[0]));
    expect(leaked).toHaveLength(0);
  });

  it("does not expose, edit, or delete another agency's accommodation rooms", async () => {
    authTenant.id = userB;
    authTenant.tenantId = tenantB;

    const listResponse = await request(app).get(`/api/accommodations/${accommodationA}/rooms`);
    expect(listResponse.status).toBe(404);

    const patchResponse = await request(app)
      .patch(`/api/accommodation-rooms/${roomA}`)
      .send({ capacity: 9, status: "inactive" });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await request(app)
      .delete(`/api/accommodation-rooms/${roomA}`);
    expect(deleteResponse.status).toBe(404);

    const [room] = await db.select().from(accommodationRoomsTable)
      .where(eq(accommodationRoomsTable.id, roomA));
    expect(room).toMatchObject({ tenantId: tenantA, capacity: 1, status: "active" });
  });

  it("rejects inactive rooms and refuses to lower capacity below active occupancy", async () => {
    const inactive = await assign(reservationIds[0], roomInactive);
    expect(inactive.status).toBe(400);
    expect(inactive.body.code).toBe("ROOM_INACTIVE");

    expect((await assign(reservationIds[0], roomLarge)).status).toBe(200);
    expect((await assign(reservationIds[1], roomLarge)).status).toBe(200);

    const response = await request(app)
      .patch(`/api/accommodation-rooms/${roomLarge}`)
      .send({ capacity: 1 });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("ROOM_CAPACITY_CONFLICT");
  });

  it("releases a room when the assignment is removed with roomId null", async () => {
    expect((await assign(reservationIds[0], roomA)).status).toBe(200);
    expect((await assign(reservationIds[0], null)).status).toBe(200);
    expect((await assign(reservationIds[1], roomA)).status).toBe(200);
  });

  it("releases a room after cancellation and after moving to another trip", async () => {
    expect((await assign(reservationIds[0], roomA)).status).toBe(200);
    const cancelled = await request(app)
      .patch(`/api/reservations/${reservationIds[0]}`)
      .send({ status: RESERVATION_STATUS.CANCELLED });
    expect(cancelled.status).toBe(200);
    expect((await assign(reservationIds[1], roomA)).status).toBe(200);

    await db.delete(reservationRoomAssignmentsTable).where(eq(reservationRoomAssignmentsTable.tenantId, tenantA));
    await db.update(reservationsTable).set({ status: RESERVATION_STATUS.PENDING, tripId: tripA })
      .where(eq(reservationsTable.id, reservationIds[0]));
    expect((await assign(reservationIds[0], roomA)).status).toBe(200);

    const moved = await request(app)
      .patch(`/api/reservations/${reservationIds[0]}`)
      .send({ tripId: tripA2 });
    expect(moved.status).toBe(200);
    expect((await assign(reservationIds[1], roomA)).status).toBe(200);
  });

  it("releases the room when the assigned passenger is deleted", async () => {
    expect((await assign(reservationIds[0], roomA)).status).toBe(200);

    const deleted = await request(app)
      .delete(`/api/reservations/${reservationIds[0]}/passengers/${passengerIds[0]}`);
    expect(deleted.status).toBe(200);

    expect((await assign(reservationIds[1], roomA)).status).toBe(200);
    const remaining = await db.select().from(reservationRoomAssignmentsTable)
      .where(eq(reservationRoomAssignmentsTable.passengerId, passengerIds[0]));
    expect(remaining).toHaveLength(0);
  });
});
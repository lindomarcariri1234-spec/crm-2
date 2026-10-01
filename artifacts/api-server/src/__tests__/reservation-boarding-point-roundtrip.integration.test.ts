/**
 * Real PostgreSQL integration test for reservation boarding-point persistence.
 * It creates reservations through the API and reloads each one through the
 * detail and batched list endpoints, covering both supported ID namespaces.
 */
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  boardingLocationsTable,
  clientsTable,
  db,
  reservationsTable,
  tenantsTable,
  tripsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { ROLES } from "@workspace/permissions";

const { mockRequireAuth } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: [ROLES.AGENCY_ADMIN, ROLES.SUPER_ADMIN],
  MANAGEMENT_ROLES: [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPER_ADMIN],
  ALL_STAFF_ROLES: [
    ROLES.AGENCY_ADMIN,
    ROLES.AGENCY_MANAGER,
    ROLES.SUPPORT,
    ROLES.SALES,
    ROLES.SUPER_ADMIN,
  ],
}));
vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../queues/commission-sync-helper.js", () => ({
  enqueueCommissionSync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/pipeline-deal-sync.js", () => ({
  syncClientDeal: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/trip-overlap-notify.js", () => ({
  detectAndNotifyTripOverlap: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../routes/payments.js", () => ({
  recalculateClientFinancials: vi.fn().mockResolvedValue(undefined),
}));

import reservationsRouter from "../routes/reservations.js";

const RUN = randomUUID().replaceAll("-", "").slice(0, 10);
const TENANT_ID = `boarding-roundtrip-tenant-${RUN}`;
const USER_ID = `boarding-roundtrip-user-${RUN}`;
const TRIP_ID = `boarding-roundtrip-trip-${RUN}`;
const TRIP_CLIENT_ID = `boarding-roundtrip-trip-client-${RUN}`;
const CATALOG_CLIENT_ID = `boarding-roundtrip-catalog-client-${RUN}`;
const TRIP_POINT_ID = `trip-point-${RUN}`;
const CATALOG_POINT_ID = `catalog-point-${RUN}`;

const TRIP_POINT = {
  id: TRIP_POINT_ID,
  name: "Praça das Mangueiras",
  time: "06:15",
  address: "Rua das Mangueiras, 10",
};
const CATALOG_POINT = {
  id: CATALOG_POINT_ID,
  name: "Terminal Regional",
  time: "06:45",
  address: "Avenida Central, 200",
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { log: Record<string, () => void> }).log = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  };
  next();
});
app.use("/api", reservationsRouter);

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run the reservation boarding-point integration test");
  }

  mockRequireAuth.mockResolvedValue({
    id: USER_ID,
    tenantId: TENANT_ID,
    role: ROLES.AGENCY_ADMIN,
    name: "Boarding point integration tester",
    email: `boarding-roundtrip-${RUN}@example.com`,
  });

  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Reservation Boarding Point Test",
    slug: `boarding-roundtrip-${RUN}`,
    email: `boarding-roundtrip-tenant-${RUN}@example.com`,
  });
  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: `boarding-roundtrip-clerk-${RUN}`,
    tenantId: TENANT_ID,
    name: "Boarding point integration tester",
    email: `boarding-roundtrip-user-${RUN}@example.com`,
    role: ROLES.AGENCY_ADMIN,
    referralCode: `BOARDING-${RUN}`,
  });
  await db.insert(clientsTable).values([
    {
      id: TRIP_CLIENT_ID,
      tenantId: TENANT_ID,
      name: "Trip-point reservation client",
      email: `boarding-trip-${RUN}@example.com`,
      whatsapp: "85999990001",
      createdById: USER_ID,
    },
    {
      id: CATALOG_CLIENT_ID,
      tenantId: TENANT_ID,
      name: "Catalog-point reservation client",
      email: `boarding-catalog-${RUN}@example.com`,
      whatsapp: "85999990002",
      createdById: USER_ID,
    },
  ]);
  await db.insert(tripsTable).values({
    id: TRIP_ID,
    tenantId: TENANT_ID,
    name: "Boarding Point Roundtrip",
    slug: `boarding-roundtrip-trip-${RUN}`,
    destination: "Fortaleza",
    destinationCity: "Fortaleza",
    destinationState: "CE",
    type: "excursao",
    category: "standard",
    departureDate: new Date("2027-02-10T12:00:00.000Z"),
    totalCapacity: 10,
    availableSeats: 10,
    reservedSeats: 0,
    priceAdult: "100.00",
    createdById: USER_ID,
    boardingPoints: [TRIP_POINT],
  });
  await db.insert(boardingLocationsTable).values({
    id: CATALOG_POINT_ID,
    tenantId: TENANT_ID,
    name: CATALOG_POINT.name,
    address: CATALOG_POINT.address,
    city: "Fortaleza",
    state: "CE",
    departureTime: CATALOG_POINT.time,
  });
});

afterAll(async () => {
  await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, TENANT_ID));
  await db.delete(boardingLocationsTable).where(eq(boardingLocationsTable.tenantId, TENANT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(tripsTable).where(eq(tripsTable.tenantId, TENANT_ID));
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

describe("reservation boarding point persistence — real PostgreSQL", () => {
  it("keeps trip-specific and catalog IDs and details in detail and list responses", async () => {
    const cases = [
      {
        clientId: TRIP_CLIENT_ID,
        seat: "1",
        selectedId: TRIP_POINT_ID,
        expectedPoint: TRIP_POINT,
      },
      {
        clientId: CATALOG_CLIENT_ID,
        seat: "2",
        selectedId: CATALOG_POINT_ID,
        expectedPoint: CATALOG_POINT,
      },
    ];
    const reservationIdsByClient = new Map<string, string>();

    for (const testCase of cases) {
      const created = await request(app)
        .post("/api/reservations")
        .set("x-visitecrm-import", "reservation-csv")
        .send({
          tripId: TRIP_ID,
          clientId: testCase.clientId,
          seats: [testCase.seat],
          totalValue: 100,
          paidValue: 0,
          boardingLocationId: testCase.selectedId,
        });

      expect(created.status).toBe(201);
      reservationIdsByClient.set(testCase.clientId, created.body.id);
      expect(created.body.boardingLocationId).toBe(testCase.selectedId);
      expect(created.body.boardingLocation).toEqual({
        name: testCase.expectedPoint.name,
        time: testCase.expectedPoint.time,
        address: testCase.expectedPoint.address,
      });

      const [persisted] = await db
        .select({ boardingLocationId: reservationsTable.boardingLocationId })
        .from(reservationsTable)
        .where(eq(reservationsTable.id, created.body.id))
        .limit(1);
      expect(persisted?.boardingLocationId).toBe(testCase.selectedId);

      const reopened = await request(app).get(`/api/reservations/${created.body.id}`);
      expect(reopened.status).toBe(200);
      expect(reopened.body.boardingLocationId).toBe(testCase.selectedId);
      expect(reopened.body.boardingLocation).toEqual({
        name: testCase.expectedPoint.name,
        time: testCase.expectedPoint.time,
        address: testCase.expectedPoint.address,
      });
    }

    const listed = await request(app)
      .get(`/api/reservations?tripId=${encodeURIComponent(TRIP_ID)}&limit=20`);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(listed.body.total).toBe(cases.length);
    expect(listed.body.data).toHaveLength(cases.length);

    for (const testCase of cases) {
      const reservationId = reservationIdsByClient.get(testCase.clientId);
      const listedReservation = listed.body.data.find(
        (reservation: { id: string }) => reservation.id === reservationId,
      );
      expect(listedReservation).toMatchObject({
        id: reservationId,
        boardingLocationId: testCase.selectedId,
        boardingLocation: {
          name: testCase.expectedPoint.name,
          time: testCase.expectedPoint.time,
          address: testCase.expectedPoint.address,
        },
      });
    }
  });
});
/**
 * Database-backed regression coverage for the trip type/date filters and
 * pagination. Only authentication is stubbed; list, count, and stats queries
 * execute against PostgreSQL.
 */
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  db,
  pool,
  tenantsTable,
  tripsTable,
  storesTable,
  storeProductsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { ROLES } from "@workspace/permissions";

const { mockRequireAuth } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN],
  MANAGEMENT_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER],
}));

import tripsRouter from "../routes/trips.js";

const RUN_ID = randomUUID().replaceAll("-", "").slice(0, 12);
const TENANT_ID = `trips-filter-${RUN_ID}`;
const OTHER_TENANT_ID = `trips-filter-other-${RUN_ID}`;
const STORE_ID = `trips-filter-store-${RUN_ID}`;

const tripFixture = ({
  id,
  tenantId = TENANT_ID,
  name,
  type = "excursao",
  departureDate,
  destinationCity = "Fortaleza",
  destinationState = "CE",
  originCity = null,
  originState = null,
  status = "active",
  totalCapacity = 10,
  reservedSeats = 0,
  confirmedSeats = 0,
  priceAdult = "100.00",
}: {
  id: string;
  tenantId?: string;
  name: string;
  type?: string;
  departureDate: Date;
  destinationCity?: string;
  destinationState?: string;
  originCity?: string | null;
  originState?: string | null;
  status?: "active" | "confirmed" | "draft";
  totalCapacity?: number;
  reservedSeats?: number;
  confirmedSeats?: number;
  priceAdult?: string;
}) => ({
  id,
  tenantId,
  name,
  slug: id,
  destination: "Fortaleza",
  destinationCity,
  destinationState,
  originCity,
  originState,
  type,
  category: "standard",
  departureDate,
  totalCapacity,
  availableSeats: totalCapacity - reservedSeats - confirmedSeats,
  reservedSeats,
  confirmedSeats,
  priceAdult,
  status,
  createdById: `trip-filter-test-${RUN_ID}`,
});

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
app.use(tripsRouter);

const selectedDayTrips = [
  tripFixture({
    id: `before-${RUN_ID}`,
    name: "Before São Paulo midnight",
    departureDate: new Date("2026-09-15T02:59:59.999Z"),
    totalCapacity: 50,
    reservedSeats: 5,
  }),
  tripFixture({
    id: `at-start-a-${RUN_ID}`,
    name: "At selected day start — first trip",
    departureDate: new Date("2026-09-15T03:00:00.000Z"),
    status: "active",
    totalCapacity: 10,
    reservedSeats: 2,
    confirmedSeats: 1,
    priceAdult: "100.00",
  }),
  tripFixture({
    id: `at-start-b-${RUN_ID}`,
    name: "At selected day start — second trip",
    departureDate: new Date("2026-09-15T03:00:00.000Z"),
    status: "active",
    totalCapacity: 15,
    reservedSeats: 1,
    priceAdult: "100.00",
  }),
  tripFixture({
    id: `same-day-${RUN_ID}`,
    name: "Later on selected day",
    departureDate: new Date("2026-09-15T15:00:00.000Z"),
    status: "confirmed",
    totalCapacity: 20,
    reservedSeats: 1,
    confirmedSeats: 2,
    priceAdult: "50.00",
  }),
  tripFixture({
    id: `following-day-${RUN_ID}`,
    name: "On the following day",
    departureDate: new Date("2026-09-16T03:00:00.000Z"),
    status: "draft",
    totalCapacity: 30,
  }),
  tripFixture({
    id: `other-type-${RUN_ID}`,
    name: "Different trip type",
    type: "pacote",
    departureDate: new Date("2026-09-15T03:00:00.000Z"),
    totalCapacity: 100,
    reservedSeats: 5,
    priceAdult: "1000.00",
  }),
  tripFixture({
    id: `other-tenant-${RUN_ID}`,
    tenantId: OTHER_TENANT_ID,
    name: "Different tenant",
    departureDate: new Date("2026-09-15T03:00:00.000Z"),
    totalCapacity: 90,
    reservedSeats: 4,
    priceAdult: "900.00",
  }),
  tripFixture({
    id: `store-active-trip-${RUN_ID}`,
    name: "Trip with active storefront product",
    departureDate: new Date("2026-08-17T03:00:00.000Z"),
  }),
  tripFixture({
    id: `store-draft-trip-${RUN_ID}`,
    name: "Trip with draft storefront product",
    departureDate: new Date("2026-08-18T03:00:00.000Z"),
  }),
  tripFixture({
    id: `origin-city-${RUN_ID}`,
    name: "Origin city match",
    originCity: "Crato",
    originState: "CE",
    departureDate: new Date("2026-08-01T03:00:00.000Z"),
  }),
  tripFixture({
    id: `origin-state-${RUN_ID}`,
    name: "Origin state match",
    originCity: "Recife",
    originState: "PE",
    departureDate: new Date("2026-08-02T03:00:00.000Z"),
  }),
  tripFixture({
    id: `destination-city-${RUN_ID}`,
    name: "Destination city match",
    destinationCity: "Campinas",
    destinationState: "SP",
    departureDate: new Date("2026-08-03T03:00:00.000Z"),
  }),
  tripFixture({
    id: `destination-state-${RUN_ID}`,
    name: "Destination state match",
    destinationCity: "Rio de Janeiro",
    destinationState: "RJ",
    departureDate: new Date("2026-08-04T03:00:00.000Z"),
  }),
];

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must point to a disposable database for this integration test");
  }

  mockRequireAuth.mockResolvedValue({
    id: `trip-filter-user-${RUN_ID}`,
    tenantId: TENANT_ID,
    role: ROLES.AGENCY_ADMIN,
    name: "Trip filter integration tester",
    email: `trip-filter-${RUN_ID}@example.com`,
  });

  await db.insert(tenantsTable).values([
    {
      id: TENANT_ID,
      name: "Trip Filter Integration Tenant",
      slug: TENANT_ID,
      email: `${TENANT_ID}@example.com`,
    },
    {
      id: OTHER_TENANT_ID,
      name: "Trip Filter Other Tenant",
      slug: OTHER_TENANT_ID,
      email: `${OTHER_TENANT_ID}@example.com`,
    },
  ]);
  await db.insert(tripsTable).values(selectedDayTrips);
  await db.insert(storesTable).values({
    id: STORE_ID,
    tenantId: TENANT_ID,
    name: "Trip Filter Store",
    slug: STORE_ID,
    email: `${STORE_ID}@example.com`,
  });
  await db.insert(storeProductsTable).values([
    {
      id: `store-active-product-${RUN_ID}`,
      storeId: STORE_ID,
      tripId: `store-active-trip-${RUN_ID}`,
      type: "trip",
      name: "Published trip",
      slug: `published-${RUN_ID}`,
      price: "100.00",
      status: "active",
    },
    {
      id: `store-draft-product-${RUN_ID}`,
      storeId: STORE_ID,
      tripId: `store-draft-trip-${RUN_ID}`,
      type: "trip",
      name: "Draft trip",
      slug: `draft-${RUN_ID}`,
      price: "100.00",
      status: "draft",
    },
  ]);
});

afterAll(async () => {
  try {
    await db.delete(storeProductsTable).where(eq(storeProductsTable.storeId, STORE_ID));
    await db.delete(storesTable).where(eq(storesTable.id, STORE_ID));
    await db.delete(tripsTable).where(eq(tripsTable.tenantId, TENANT_ID));
    await db.delete(tripsTable).where(eq(tripsTable.tenantId, OTHER_TENANT_ID));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, OTHER_TENANT_ID));
  } finally {
    await pool.end();
  }
});

describe("GET /trips — real database type/date filtering and pagination", () => {
  it("filters storefront visibility by active linked products, independently of trip status", async () => {
    const published = await request(app)
      .get("/trips")
      .query({ storePublication: "published", limit: 100 });
    const unpublished = await request(app)
      .get("/trips")
      .query({ storePublication: "unpublished", limit: 100 });

    expect(published.status).toBe(200);
    expect(published.body.total).toBe(1);
    expect(published.body.data.map((trip: { id: string }) => trip.id))
      .toEqual([`store-active-trip-${RUN_ID}`]);

    expect(unpublished.status).toBe(200);
    const unpublishedIds = unpublished.body.data.map((trip: { id: string }) => trip.id);
    expect(unpublished.body.total).toBe(
      selectedDayTrips.filter((trip) => trip.tenantId === TENANT_ID).length - 1,
    );
    expect(unpublishedIds).toContain(`store-draft-trip-${RUN_ID}`);
    expect(unpublishedIds).not.toContain(`store-active-trip-${RUN_ID}`);
  });

  it("keeps the Sao Paulo midnight boundary, tied pages, totals, and filtered stats aligned", async () => {
    const getPage = (page: number) =>
      request(app)
        .get("/trips")
        .query({ type: "excursao", date: "2026-09-15", page, limit: 1 });

    const [page1, page2, page3, page4, page5] = await Promise.all([
      getPage(1),
      getPage(2),
      getPage(3),
      getPage(4),
      getPage(5),
    ]);

    for (const response of [page1, page2, page3, page4, page5]) {
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        total: 4,
        limit: 1,
        stats: {
          total: 4,
          active: 3,
          totalCapacity: 45,
          occupiedSeats: 7,
          totalRevenue: 550,
        },
      });
    }

    expect(page1.body).toMatchObject({
      page: 1,
      data: [{ id: `at-start-a-${RUN_ID}`, name: "At selected day start — first trip" }],
    });
    expect(page2.body).toMatchObject({
      page: 2,
      data: [{ id: `at-start-b-${RUN_ID}`, name: "At selected day start — second trip" }],
    });
    expect(page3.body).toMatchObject({
      page: 3,
      data: [{ id: `same-day-${RUN_ID}`, name: "Later on selected day" }],
    });
    expect(page4.body).toMatchObject({
      page: 4,
      data: [{ id: `following-day-${RUN_ID}`, name: "On the following day" }],
    });
    expect(page5.body).toMatchObject({ page: 5, data: [] });
  });

  it("matches location case-insensitively across origin and destination city/state", async () => {
    const cases = [
      { location: "cRaTo", id: `origin-city-${RUN_ID}` },
      { location: "pe", id: `origin-state-${RUN_ID}` },
      { location: "Campinas", id: `destination-city-${RUN_ID}` },
      { location: "rj", id: `destination-state-${RUN_ID}` },
    ];

    for (const testCase of cases) {
      const response = await request(app).get("/trips").query({ location: testCase.location });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ total: 1, page: 1 });
      expect(response.body.data.map((trip: { id: string }) => trip.id)).toEqual([testCase.id]);
    }
  });
});
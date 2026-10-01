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

const tripFixture = ({
  id,
  tenantId = TENANT_ID,
  name,
  type = "excursao",
  departureDate,
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
  destinationCity: "Fortaleza",
  destinationState: "CE",
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
});

afterAll(async () => {
  try {
    await db.delete(tripsTable).where(eq(tripsTable.tenantId, TENANT_ID));
    await db.delete(tripsTable).where(eq(tripsTable.tenantId, OTHER_TENANT_ID));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, OTHER_TENANT_ID));
  } finally {
    await pool.end();
  }
});

describe("GET /trips — real database type/date filtering and pagination", () => {
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
});
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => {
  const selectRows: unknown[][] = [];
  const mockLimit = vi.fn(() => Promise.resolve(selectRows.shift() ?? []));
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockInsertValues = vi.fn().mockResolvedValue([]);
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  return {
    selectRows,
    mockLimit,
    mockWhere,
    mockFrom,
    mockSelect,
    mockInsertValues,
    mockInsert,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
  };
});

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy(
    { _table: name },
    {
      get(target, property, receiver) {
        if (property === "_table") return target._table;
        if (typeof property === "string") return `${name}.${property}`;
        return Reflect.get(target, property, receiver);
      },
    },
  );

  return {
    db: {
      select: mocks.mockSelect,
      insert: mocks.mockInsert,
      update: mocks.mockUpdate,
    },
    pipelinesTable: table("pipelines"),
    pipelineStagesTable: table("pipelineStages"),
    dealsTable: table("deals"),
    clientsTable: table("clients"),
    reservationsTable: table("reservations"),
    tripsTable: table("trips"),
    storeOrdersTable: table("storeOrders"),
    referralsTable: table("referrals"),
    linkedDataReconciliationRunsTable: table("linkedDataReconciliationRuns"),
    paymentsTable: table("payments"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...conditions: unknown[]) => conditions),
  or: vi.fn((...conditions: unknown[]) => conditions),
  inArray: vi.fn(() => "inArray"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  count: vi.fn(() => "count"),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin"],
  MANAGEMENT_ROLES: ["admin", "manager"],
}));

import { requireAuth } from "../lib/tenant.js";
import pipelineRouter from "../routes/pipeline.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const adminUser = {
  id: "user-1",
  tenantId: "tenant-1",
  role: "admin",
  name: "Admin",
  email: "admin@example.com",
};

function makeDeal(overrides: Record<string, unknown> = {}) {
  return {
    id: "deal-1",
    tenantId: "tenant-1",
    clientId: "client-1",
    stageId: "stage-1",
    title: "Lead de teste",
    description: null,
    value: "100",
    ownerId: "user-1",
    status: "open",
    leadName: null,
    leadEmail: null,
    leadWhatsapp: null,
    tripId: null,
    reservationId: null,
    expectedCloseDate: null,
    travelReason: null,
    lostReason: null,
    followUpNote: null,
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    updatedAt: new Date("2026-09-01T12:00:00.000Z"),
    ...overrides,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { log?: unknown }).log = pino({ level: "silent" });
    next();
  });
  app.use("/api", pipelineRouter);
  app.use(errorHandler);
  return app;
}

function queueSelectRows(...rows: unknown[][]) {
  mocks.selectRows.push(...rows);
}

describe("pipeline deal linkage", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows.length = 0;
    requireAuthMock.mockResolvedValue(adminUser as never);
  });

  it("rejects a reservation from another tenant without creating a deal", async () => {
    queueSelectRows([]);

    const response = await request(buildApp())
      .post("/api/deals")
      .send({ stageId: "stage-1", title: "Lead", reservationId: "foreign-reservation" });

    expect(response.status).toBe(400);
    expect(mocks.mockInsert).not.toHaveBeenCalled();
  });

  it("rejects a reservation whose client does not match the deal", async () => {
    queueSelectRows([{ clientId: "client-2", tripId: "trip-1" }]);

    const response = await request(buildApp())
      .post("/api/deals")
      .send({
        clientId: "client-1",
        stageId: "stage-1",
        title: "Lead",
        tripId: "trip-1",
        reservationId: "reservation-1",
      });

    expect(response.status).toBe(400);
    expect(mocks.mockInsert).not.toHaveBeenCalled();
  });

  it("rejects a reservation whose trip does not match the deal", async () => {
    queueSelectRows([{ clientId: null, tripId: "trip-2" }]);

    const response = await request(buildApp())
      .post("/api/deals")
      .send({
        stageId: "stage-1",
        title: "Lead",
        tripId: "trip-1",
        reservationId: "reservation-1",
      });

    expect(response.status).toBe(400);
    expect(mocks.mockInsert).not.toHaveBeenCalled();
  });

  it("derives a reservation-backed deal's client and trip from the matching reservation", async () => {
    const reservation = { clientId: "client-1", tripId: "trip-1" };
    const createdDeal = makeDeal({
      clientId: "client-1",
      tripId: "trip-1",
      reservationId: "reservation-1",
    });
    queueSelectRows(
      [reservation],
      [{ id: "client-1" }],
      [{ id: "trip-1" }],
      [{ id: "stage-1" }],
      [createdDeal],
    );

    const response = await request(buildApp())
      .post("/api/deals")
      .send({ stageId: "stage-1", title: "Lead", reservationId: "reservation-1" });

    expect(response.status).toBe(201);
    expect(mocks.mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "client-1",
      tripId: "trip-1",
      reservationId: "reservation-1",
    }));
  });

  it("continues to allow an unlinked manual lead", async () => {
    queueSelectRows([{ id: "stage-1" }], [makeDeal({ clientId: null })]);

    const response = await request(buildApp())
      .post("/api/deals")
      .send({ stageId: "stage-1", title: "Lead sem reserva" });

    expect(response.status).toBe(201);
    expect(mocks.mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      clientId: null,
      tripId: null,
      reservationId: null,
    }));
  });

  it("rejects changing a deal to a reservation from a different trip", async () => {
    const existingDeal = makeDeal({ tripId: "trip-1", reservationId: "reservation-1" });
    queueSelectRows(
      [existingDeal],
      [{ clientId: "client-1", tripId: "trip-2" }],
    );

    const response = await request(buildApp())
      .patch("/api/deals/deal-1")
      .send({ reservationId: "reservation-2" });

    expect(response.status).toBe(400);
    expect(mocks.mockUpdate).not.toHaveBeenCalled();
  });

  it("adopts a reservation's client and trip when linking an unbound lead", async () => {
    const existingDeal = makeDeal({ clientId: null, tripId: null, reservationId: null });
    const updatedDeal = makeDeal({
      clientId: "client-1",
      tripId: "trip-1",
      reservationId: "reservation-1",
    });
    queueSelectRows(
      [existingDeal],
      [{ clientId: "client-1", tripId: "trip-1" }],
      [{ id: "client-1" }],
      [{ id: "trip-1" }],
      [updatedDeal],
    );

    const response = await request(buildApp())
      .patch("/api/deals/deal-1")
      .send({ reservationId: "reservation-1" });

    expect(response.status).toBe(200);
    expect(mocks.mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "client-1",
      tripId: "trip-1",
      reservationId: "reservation-1",
    }));
  });
});
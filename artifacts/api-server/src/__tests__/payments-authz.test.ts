import pino from "pino";
/**
 * Authorization tests for financial endpoints across routes/payments.ts and
 * routes/trip-costs.ts.
 *
 * Verifies that roles WITHOUT the FINANCIAL permission (per the real permission
 * matrix in @workspace/permissions) cannot read or mutate tenant financial
 * data:
 *   - GET  /payments/summary
 *   - GET  /trips/:tripId/financial-report
 *   - GET  /payments               (unscoped list)
 *   - GET  /payments/:id
 *   - GET  /expenses               (FINANCIAL view)
 *   - POST /expenses               (FINANCIAL create — managers have view-only)
 *   - GET  /trips/:id/costs        (FINANCIAL view — leaks profit/margin)
 *
 * Uses supertest to drive the real Express routers. The DB and heavy service
 * deps are mocked, but @workspace/permissions (hasPermission) is REAL so the
 * guard logic is exercised end-to-end. The 403 paths short-circuit before any
 * DB query; positive controls use a chainable thenable DB mock.
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { dbState, makeChain, mockInsertValues } = vi.hoisted(() => {
  const dbState = { rows: [] as unknown[] };
  const makeChain = () => {
    const chain = {} as Record<string, unknown>;
    const ret = () => chain;
    chain.from = ret;
    chain.where = ret;
    chain.orderBy = ret;
    chain.limit = ret;
    chain.offset = ret;
    chain.groupBy = ret;
    chain.leftJoin = ret;
    chain.innerJoin = ret;
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(dbState.rows);
    return chain;
  };
  const mockInsertValues = vi.fn().mockResolvedValue(undefined);
  return { dbState, makeChain, mockInsertValues };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) })),
    delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
    transaction: vi.fn(),
  },
  paymentsTable: {},
  expensesTable: {},
  reservationsTable: {},
  clientsTable: {},
  commissionRulesTable: {},
  commissionsTable: {},
  usersTable: {},
  salesGoalsTable: {},
  tripCostsTable: {},
  tripsTable: {},
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: [ROLES.AGENCY_ADMIN, ROLES.SUPER_ADMIN],
  MANAGEMENT_ROLES: [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPER_ADMIN],
  ALL_STAFF_ROLES: [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPPORT, ROLES.SALES, ROLES.SUPER_ADMIN],
}));

vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "gen-id") }));
vi.mock("../lib/activities.js", () => ({ writeClientActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/loyalty-helpers.js", () => ({
  loyaltyAwardPoints: vi.fn().mockResolvedValue(undefined),
  loyaltyAwardPointsForReservation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: { syncTrip: vi.fn(), syncPayment: vi.fn() },
}));
vi.mock("../lib/reservation-payments.js", () => ({
  syncReservationPaymentStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../queues/email-helpers.js", () => ({
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
}));

import { requireAuth } from "../lib/tenant.js";
import paymentsRouter from "../routes/payments.js";
import tripCostsRouter from "../routes/trip-costs.js";
import { errorHandler } from "../middlewares/errorHandler.js";

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  req.log = pino({ level: "silent" }) as unknown as typeof req.log;
  next();
}

function buildApp(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", router);
  app.use(errorHandler);
  return app;
}

const FAKE_PAYMENT = {
  id: "pay-001",
  tenantId: "tenant-001",
  reservationId: null,
  clientId: null,
  tripId: "trip-001",
  type: "receivable",
  category: "Transporte",
  amount: "500.00",
  supplierName: null,
  paymentMethod: null,
  installmentNumber: null,
  totalInstallments: null,
  dueDate: new Date("2025-07-10"),
  paidAt: null,
  status: "pending",
  receiptUrl: null,
  description: "Custo teste",
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const user = (role: string) => ({ id: "user-001", tenantId: "tenant-001", role });

const requireAuthMock = vi.mocked(requireAuth);

beforeEach(() => {
  vi.clearAllMocks();
  dbState.rows = [FAKE_PAYMENT];
});

describe("payments authorization — FINANCIAL permission enforcement", () => {
  it("GET /payments/summary → 403 for SUPPORT (no FINANCIAL view)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SUPPORT) as never);
    const res = await request(buildApp(paymentsRouter)).get("/api/payments/summary");
    expect(res.status).toBe(403);
  });

  it("GET /payments/summary → 403 for SALES (no FINANCIAL view)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SALES) as never);
    const res = await request(buildApp(paymentsRouter)).get("/api/payments/summary");
    expect(res.status).toBe(403);
  });

  it("GET /trips/:tripId/financial-report → 403 for SUPPORT", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SUPPORT) as never);
    const res = await request(buildApp(paymentsRouter)).get("/api/trips/trip-001/financial-report");
    expect(res.status).toBe(403);
  });

  it("GET /payments (no clientId) → 403 for SUPPORT (blocks tenant-wide enumeration)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SUPPORT) as never);
    const res = await request(buildApp(paymentsRouter)).get("/api/payments");
    expect(res.status).toBe(403);
  });

  it("GET /payments/:id → 403 for SUPPORT (cannot fetch arbitrary payment by id)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SUPPORT) as never);
    const res = await request(buildApp(paymentsRouter)).get("/api/payments/pay-001");
    expect(res.status).toBe(403);
  });

  it("GET /payments/:id → 200 for AGENCY_ADMIN (positive control)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    const res = await request(buildApp(paymentsRouter)).get("/api/payments/pay-001");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("pay-001");
  });

  it("POST /payments → 403 for SUPPORT (non-finance cannot create payments)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SUPPORT) as never);
    const res = await request(buildApp(paymentsRouter))
      .post("/api/payments")
      .send({ clientId: "client-001", amount: 100 });
    expect(res.status).toBe(403);
  });

  it("POST /payments → 403 for SALES (non-finance cannot create payments)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SALES) as never);
    const res = await request(buildApp(paymentsRouter))
      .post("/api/payments")
      .send({ clientId: "client-001", amount: 100 });
    expect(res.status).toBe(403);
  });

  it("POST /payments rejects a received reservation payment above its remaining balance", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    dbState.rows = [{
      id: "reservation-001",
      clientId: "client-001",
      totalValue: "500.00",
      balance: "410.00",
    }];

    const res = await request(buildApp(paymentsRouter))
      .post("/api/payments")
      .send({
        reservationId: "reservation-001",
        type: "receivable",
        category: "reservation",
        amount: 410.01,
        paymentMethod: "pix",
        dueDate: "2026-08-23",
        status: "paid",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("saldo devedor");
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});

describe("expenses authorization — FINANCIAL permission enforcement", () => {
  it("GET /expenses → 403 for SUPPORT", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SUPPORT) as never);
    const res = await request(buildApp(paymentsRouter)).get("/api/expenses");
    expect(res.status).toBe(403);
  });

  it("GET /expenses → 403 for SALES", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SALES) as never);
    const res = await request(buildApp(paymentsRouter)).get("/api/expenses");
    expect(res.status).toBe(403);
  });

  it("GET /expenses → 403 for CLIENT", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.CLIENT) as never);
    const res = await request(buildApp(paymentsRouter)).get("/api/expenses");
    expect(res.status).toBe(403);
  });

  it("GET /expenses → 200 for AGENCY_ADMIN (positive control)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    const res = await request(buildApp(paymentsRouter)).get("/api/expenses");
    expect(res.status).toBe(200);
  });

  it("POST /expenses → 403 for SUPPORT", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SUPPORT) as never);
    const res = await request(buildApp(paymentsRouter)).post("/api/expenses").send({});
    expect(res.status).toBe(403);
  });

  it("POST /expenses → 403 for AGENCY_MANAGER (view-only, lacks FINANCIAL create)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_MANAGER) as never);
    const res = await request(buildApp(paymentsRouter)).post("/api/expenses").send({});
    expect(res.status).toBe(403);
  });
});

describe("trip costs authorization — FINANCIAL permission enforcement", () => {
  it("GET /trips/:id/costs → 403 for SUPPORT (leaks profit/margin)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SUPPORT) as never);
    const res = await request(buildApp(tripCostsRouter)).get("/api/trips/trip-001/costs");
    expect(res.status).toBe(403);
  });

  it("GET /trips/:id/costs → 403 for SALES", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SALES) as never);
    const res = await request(buildApp(tripCostsRouter)).get("/api/trips/trip-001/costs");
    expect(res.status).toBe(403);
  });

  it("GET /trips/:id/costs → 200 for AGENCY_ADMIN (positive control)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    const res = await request(buildApp(tripCostsRouter)).get("/api/trips/trip-001/costs");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.costs)).toBe(true);
  });

  it("POST /trips/:id/costs → 403 for SUPPORT (cannot tamper with cost rows)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SUPPORT) as never);
    const res = await request(buildApp(tripCostsRouter))
      .post("/api/trips/trip-001/costs")
      .send({ category: "Transporte", description: "x", amount: 100 });
    expect(res.status).toBe(403);
  });

  it("POST /trips/:id/costs → 403 for SALES", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SALES) as never);
    const res = await request(buildApp(tripCostsRouter))
      .post("/api/trips/trip-001/costs")
      .send({ category: "Transporte", description: "x", amount: 100 });
    expect(res.status).toBe(403);
  });

  it("POST /trips/:id/costs → 403 for AGENCY_MANAGER (view-only, lacks FINANCIAL create)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_MANAGER) as never);
    const res = await request(buildApp(tripCostsRouter))
      .post("/api/trips/trip-001/costs")
      .send({ category: "Transporte", description: "x", amount: 100 });
    expect(res.status).toBe(403);
  });

  it("POST /trips/:id/costs → 201 for AGENCY_ADMIN (positive control)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    const res = await request(buildApp(tripCostsRouter))
      .post("/api/trips/trip-001/costs")
      .send({ category: "Transporte", description: "Custo", amount: 100 });
    expect(res.status).toBe(201);
  });

  it("PUT /trips/:id/costs/:costId → 403 for SUPPORT", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.SUPPORT) as never);
    const res = await request(buildApp(tripCostsRouter))
      .put("/api/trips/trip-001/costs/cost-001")
      .send({ description: "upd" });
    expect(res.status).toBe(403);
  });

  it("PUT /trips/:id/costs/:costId → 403 for AGENCY_MANAGER (view-only, lacks FINANCIAL edit)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_MANAGER) as never);
    const res = await request(buildApp(tripCostsRouter))
      .put("/api/trips/trip-001/costs/cost-001")
      .send({ description: "upd" });
    expect(res.status).toBe(403);
  });

  it("PUT /trips/:id/costs/:costId → 200 for AGENCY_ADMIN (positive control)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    const res = await request(buildApp(tripCostsRouter))
      .put("/api/trips/trip-001/costs/cost-001")
      .send({ description: "upd" });
    expect(res.status).toBe(200);
  });
});

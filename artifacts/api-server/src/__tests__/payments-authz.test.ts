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

const { dbState, makeChain, makeUpdate, mockSelect, mockInsertValues, mockTransaction, mockExpensesTable, mockTripCostsTable, mockSumPaidReservationPayments } = vi.hoisted(() => {
  const dbState = {
    rows: [] as unknown[],
    rowsByTable: new Map<unknown, unknown[]>(),
    selectRowsQueue: [] as unknown[][],
  };
  const mockExpensesTable = {};
  const mockTripCostsTable = {};
  const makeChain = () => {
    const chain = {} as Record<string, unknown>;
    const ret = () => chain;
    let rows: unknown[] = dbState.selectRowsQueue.shift() ?? dbState.rows;
    chain.from = (table: unknown) => {
      rows = dbState.rowsByTable.get(table) ?? rows;
      return chain;
    };
    chain.where = ret;
    chain.orderBy = ret;
    chain.limit = ret;
    chain.offset = ret;
    chain.groupBy = ret;
    chain.leftJoin = ret;
    chain.innerJoin = ret;
    chain.for = ret;
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(rows);
    return chain;
  };
  const mockSelect = vi.fn(() => makeChain());
  const mockInsertValues = vi.fn().mockResolvedValue(undefined);
  const mockTransaction = vi.fn();
  const mockSumPaidReservationPayments = vi.fn().mockResolvedValue(0);
  const makeUpdate = () => ({
    set: () => ({
      where: () => ({
        then: (resolve: (value: unknown) => unknown) => resolve(undefined),
        returning: async () => [{ id: "expense-001" }],
      }),
    }),
  });
  return { dbState, makeChain, makeUpdate, mockSelect, mockInsertValues, mockTransaction, mockExpensesTable, mockTripCostsTable, mockSumPaidReservationPayments };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => makeUpdate()),
    delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
    transaction: mockTransaction,
  },
  paymentsTable: {},
  expensesTable: mockExpensesTable,
  reservationsTable: {},
  clientsTable: {},
  commissionRulesTable: {},
  commissionsTable: {},
  usersTable: {},
  salesGoalsTable: {},
  tripCostsTable: mockTripCostsTable,
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
  sumPaidReservationPayments: mockSumPaidReservationPayments,
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
vi.mock("../services/settlements/financial-ledger.js", () => ({
  createClientBenefitEntry: vi.fn(),
  expireClientBenefits: vi.fn(),
  getClientBenefitBalances: vi.fn(),
}));

import { requireAuth } from "../lib/tenant.js";
import paymentsRouter from "../routes/payments.js";
import tripCostsRouter from "../routes/trip-costs.js";
import settlementsRouter from "../routes/settlements.js";
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
  dbState.rowsByTable.clear();
  dbState.selectRowsQueue = [];
  mockTransaction.mockReset();
  mockSumPaidReservationPayments.mockResolvedValue(0);
  mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => makeUpdate()),
    delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
  }));
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

  it("GET /payments → rejects impossible due-date filters before querying", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);

    const res = await request(buildApp(paymentsRouter))
      .get("/api/payments?dueDateFrom=2026-02-30");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockSelect).not.toHaveBeenCalled();
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

  it("POST /payments → rejects a client that does not own the selected reservation", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    dbState.rows = [{
      id: "reservation-001",
      clientId: "client-owner",
      totalValue: "500.00",
      status: "confirmed",
      storeOrderId: null,
      expiresAt: null,
      isGratuidade: false,
    }];
    dbState.selectRowsQueue = [
      [{ storeOrderId: null }],
      [{ id: "client-other" }],
    ];

    const res = await request(buildApp(paymentsRouter))
      .post("/api/payments")
      .send({
        type: "receivable",
        category: "reservation",
        amount: 100,
        paymentMethod: "pix",
        dueDate: "2026-10-15",
        installments: 1,
        reservationId: "reservation-001",
        clientId: "client-other",
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "PAYMENT_CLIENT_RESERVATION_MISMATCH" });
    expect(mockInsertValues).not.toHaveBeenCalled();
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

  it("POST /payments → 403 for AGENCY_MANAGER (financial view does not grant create)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_MANAGER) as never);
    const res = await request(buildApp(paymentsRouter))
      .post("/api/payments")
      .send({ clientId: "client-001", amount: 100 });
    expect(res.status).toBe(403);
  });

  it("DELETE /payments/:id → 403 for AGENCY_MANAGER (financial view does not grant delete)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_MANAGER) as never);
    const res = await request(buildApp(paymentsRouter)).delete("/api/payments/pay-001");
    expect(res.status).toBe(403);
  });

  it("POST /financial/benefits → 403 for AGENCY_MANAGER (financial view does not grant create)", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_MANAGER) as never);
    const res = await request(buildApp(settlementsRouter))
      .post("/api/financial/benefits")
      .send({
        clientId: "client-001",
        category: "wallet",
        operation: "credit",
        amount: 10,
        description: "Ajuste manual",
        idempotencyKey: "benefit-test-001",
        consentConfirmed: true,
      });
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
    mockSumPaidReservationPayments.mockResolvedValue(90);

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
    expect(res.body.code).toBe("PAYMENT_EXCEEDS_BALANCE");
    expect(res.body.message).toContain("saldo devedor");
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("POST /payments rejects an isGratuidade reservation", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    dbState.rows = [{
      id: "reservation-gratuity-001",
      clientId: "client-001",
      totalValue: "0.00",
      storeOrderId: null,
      isGratuidade: true,
    }];

    const res = await request(buildApp(paymentsRouter))
      .post("/api/payments")
      .send({
        reservationId: "reservation-gratuity-001",
        type: "receivable",
        category: "reservation",
        amount: 100,
        paymentMethod: "pix",
        dueDate: "2026-08-23",
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GRATUITY_PAYMENT_FORBIDDEN");
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("PATCH /payments/:id rejects approving a cancelled payment for an isGratuidade reservation", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    const txUpdate = vi.fn(() => makeUpdate());
    mockTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      select: vi.fn(() => makeChain()),
      insert: vi.fn(() => ({ values: mockInsertValues })),
      update: txUpdate,
      delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
    }));
    dbState.selectRowsQueue = [
      [{
        id: "payment-gratuity-001",
        tenantId: "tenant-001",
        type: "receivable",
        reservationId: "reservation-gratuity-001",
        orderId: null,
      }],
      [{ storeOrderId: null }],
      [{
        id: "payment-gratuity-001",
        tenantId: "tenant-001",
        type: "receivable",
        reservationId: "reservation-gratuity-001",
        orderId: null,
        status: "cancelled",
        amount: "100.00",
      }],
      [{
        totalValue: "0.00",
        status: "confirmed",
        storeOrderId: null,
        expiresAt: null,
        isGratuidade: true,
      }],
    ];

    const res = await request(buildApp(paymentsRouter))
      .patch("/api/payments/payment-gratuity-001")
      .send({ status: "approved" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GRATUITY_PAYMENT_FORBIDDEN");
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it("POST /payments rolls back earlier installments when a later insert fails", async () => {
    const committedRows: unknown[] = [];
    let insertCount = 0;
    mockTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      try {
        return await callback({
          insert: vi.fn(() => ({
            values: vi.fn(async (values: unknown) => {
              insertCount += 1;
              if (insertCount === 2) throw new Error("injected installment insert failure");
              committedRows.push(values);
            }),
          })),
        });
      } catch (err) {
        committedRows.length = 0;
        throw err;
      }
    });

    const res = await request(buildApp(paymentsRouter))
      .post("/api/payments")
      .send({
        type: "receivable",
        category: "reservation",
        amount: 300,
        installments: 3,
        paymentMethod: "pix",
        dueDate: "2026-08-23",
      });

    expect(res.status).toBe(500);
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(insertCount).toBe(2);
    expect(committedRows).toHaveLength(0);
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

  it("GET /expenses?includeTripCosts=true returns each financial source once", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    const dueDate = new Date("2026-08-23T12:00:00Z");
    const agencyExpense = {
      id: "agency-expense-001",
      tenantId: "tenant-001",
      tripId: "trip-001",
      category: "transport",
      description: "Seguro do ônibus",
      amount: "500.00",
      supplierId: "supplier-001",
      paymentMethod: "pix",
      paymentDate: null,
      dueDate,
      status: "pending",
      notes: null,
      createdAt: new Date("2026-08-20T12:00:00Z"),
    };
    const tripCost = {
      id: "trip-cost-001",
      tenantId: "tenant-001",
      tripId: "trip-001",
      category: "transporte",
      description: "Custo direto do transporte",
      supplierId: null,
      supplierName: "Fornecedor da viagem",
      amount: "750.00",
      status: "pending",
      dueDate,
      paidAt: null,
      notes: null,
      createdAt: new Date("2026-08-21T12:00:00Z"),
    };
    dbState.selectRowsQueue = [[agencyExpense], [tripCost], [agencyExpense], [tripCost]];

    const res = await request(buildApp(paymentsRouter))
      .get("/api/expenses?includeTripCosts=true&tripId=trip-001&status=pending");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "agency-expense-001",
        amount: 500,
        source: "agency",
        tripId: "trip-001",
      }),
      expect.objectContaining({
        id: "trip-cost-001",
        amount: 750,
        source: "trip",
        tripId: "trip-001",
        supplierName: "Fornecedor da viagem",
      }),
    ]));
    expect(res.body.data.filter((row: { id: string }) => row.id === "agency-expense-001")).toHaveLength(1);
    expect(res.body.data.filter((row: { id: string }) => row.id === "trip-cost-001")).toHaveLength(1);
    expect(res.body.summary).toMatchObject({
      total: 1250,
      paid: 0,
      pending: 1250,
      overdue: 0,
      paidThisMonth: 0,
    });
  });

  it("GET /expenses?includeTripCosts=true paginates the consolidated result without changing its total", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    const makeExpense = (id: string, amount: string, createdAt: string, linkedTripCostId?: string) => ({
      id,
      tenantId: "tenant-001",
      tripId: "trip-001",
      linkedTripCostId: linkedTripCostId ?? null,
      category: "transport",
      description: id,
      amount,
      supplierId: null,
      paymentMethod: "pix",
      paymentDate: null,
      dueDate: new Date("2026-08-23T12:00:00Z"),
      status: "pending",
      notes: null,
      createdAt: new Date(createdAt),
    });
    const makeTripCost = (id: string, amount: string, createdAt: string) => ({
      id,
      tenantId: "tenant-001",
      tripId: "trip-001",
      category: "transporte",
      description: id,
      amount,
      supplierId: null,
      supplierName: null,
      status: "pending",
      dueDate: new Date("2026-08-23T12:00:00Z"),
      paidAt: null,
      notes: null,
      createdAt: new Date(createdAt),
    });
    const agencyRows = [
      makeExpense("agency-expense-001", "100.00", "2026-08-20T12:00:00Z", "trip-cost-001"),
      makeExpense("agency-expense-002", "200.00", "2026-08-19T12:00:00Z"),
    ];
    const tripRows = [
      makeTripCost("trip-cost-001", "100.00", "2026-08-22T12:00:00Z"),
      makeTripCost("trip-cost-002", "400.00", "2026-08-17T12:00:00Z"),
    ];
    dbState.selectRowsQueue = [agencyRows, tripRows, agencyRows, tripRows];

    const res = await request(buildApp(paymentsRouter))
      .get("/api/expenses?includeTripCosts=true&tripId=trip-001&status=pending&page=2&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(2);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([
      "trip-cost-002",
    ]);
    expect(res.body.summary.total).toBe(700);

    dbState.selectRowsQueue = [agencyRows, tripRows, agencyRows, tripRows];
    const firstPage = await request(buildApp(paymentsRouter))
      .get("/api/expenses?includeTripCosts=true&tripId=trip-001&status=pending&page=1&limit=2");
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "agency-expense-001",
        source: "agency",
        linkedTripCostId: "trip-cost-001",
      }),
      expect.objectContaining({ id: "agency-expense-002", source: "agency" }),
    ]));
    expect(firstPage.body.data.some((row: { id: string }) => row.id === "trip-cost-001")).toBe(false);
  });

  it("GET /expenses?includeTripCosts=true keeps cancelled rows auditable but excludes them from every KPI", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    const currentMonth = new Date("2026-09-10T12:00:00Z");
    const agencyRows = [
      {
        id: "agency-active",
        tenantId: "tenant-001",
        tripId: "trip-001",
        category: "transport",
        description: "Despesa ativa",
        amount: "300.00",
        supplierId: null,
        paymentMethod: "pix",
        paymentDate: currentMonth,
        dueDate: new Date("2026-09-10T12:00:00Z"),
        status: "paid",
        notes: null,
        createdAt: new Date("2026-09-01T12:00:00Z"),
      },
      {
        id: "agency-cancelled",
        tenantId: "tenant-001",
        tripId: "trip-001",
        category: "transport",
        description: "Despesa cancelada",
        amount: "800.00",
        supplierId: null,
        paymentMethod: "pix",
        paymentDate: currentMonth,
        dueDate: new Date("2026-09-11T12:00:00Z"),
        status: "cancelled",
        notes: null,
        createdAt: new Date("2026-09-02T12:00:00Z"),
      },
    ];
    const tripRows = [
      {
        id: "trip-active",
        tenantId: "tenant-001",
        tripId: "trip-001",
        category: "Transporte",
        description: "Custo direto ativo",
        supplierId: null,
        supplierName: null,
        amount: "700.00",
        status: "paid",
        dueDate: new Date("2026-09-12T12:00:00Z"),
        paidAt: currentMonth,
        notes: null,
        createdAt: new Date("2026-09-03T12:00:00Z"),
      },
      {
        id: "trip-cancelled",
        tenantId: "tenant-001",
        tripId: "trip-001",
        category: "Transporte",
        description: "Custo direto cancelado",
        supplierId: null,
        supplierName: null,
        amount: "900.00",
        status: "cancelled",
        dueDate: new Date("2026-09-13T12:00:00Z"),
        paidAt: currentMonth,
        notes: null,
        createdAt: new Date("2026-09-04T12:00:00Z"),
      },
    ];
    dbState.selectRowsQueue = [agencyRows, tripRows, agencyRows, tripRows];

    const res = await request(buildApp(paymentsRouter))
      .get("/api/expenses?includeTripCosts=true&tripId=trip-001");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "agency-cancelled", source: "agency", status: "cancelled" }),
      expect.objectContaining({ id: "trip-cancelled", source: "trip", status: "cancelled" }),
    ]));
    expect(res.body.summary).toMatchObject({
      total: 1000,
      paid: 1000,
      pending: 0,
      overdue: 0,
      paidThisMonth: 1000,
    });
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

describe("explicit expense and trip-cost links", () => {
  const expense = {
    id: "expense-001",
    tenantId: "tenant-001",
    tripId: "trip-001",
    linkedTripCostId: null,
    amount: "100.00",
    status: "pending",
  };
  const cost = {
    id: "cost-001",
    tenantId: "tenant-001",
    tripId: "trip-001",
    amount: "100.00",
    status: "pending",
  };

  it("links an expense and cost when trip, amount, and status match", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    dbState.selectRowsQueue = [[expense], [cost], []];

    const res = await request(buildApp(paymentsRouter))
      .post("/api/expenses/expense-001/trip-cost-link")
      .send({ tripCostId: "cost-001" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("rejects linking records with a different amount or status", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    dbState.selectRowsQueue = [[expense], [{ ...cost, status: "paid" }]];

    const res = await request(buildApp(paymentsRouter))
      .post("/api/expenses/expense-001/trip-cost-link")
      .send({ tripCostId: "cost-001" });

    expect(res.status).toBe(409);
  });

  it("can remove an explicit expense and trip-cost link", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);

    const res = await request(buildApp(paymentsRouter))
      .delete("/api/expenses/expense-001/trip-cost-link");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("blocks status changes on a linked expense and its trip cost", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    dbState.rowsByTable.set(mockExpensesTable, [{ ...expense, linkedTripCostId: "cost-001" }]);
    dbState.rowsByTable.set(mockTripCostsTable, [cost]);

    const expenseResponse = await request(buildApp(paymentsRouter))
      .patch("/api/expenses/expense-001")
      .send({ status: "paid" });
    const costResponse = await request(buildApp(tripCostsRouter))
      .patch("/api/trips/trip-001/costs/cost-001")
      .send({ status: "paid" });

    expect(expenseResponse.status).toBe(409);
    expect(costResponse.status).toBe(409);
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

  it("GET /trips/:id/costs keeps cancelled rows visible but excludes them from the trip totals", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    const activeTripCost = {
      id: "trip-active",
      tripId: "trip-001",
      tenantId: "tenant-001",
      category: "Transporte",
      description: "Custo direto ativo",
      supplierId: null,
      supplierName: null,
      amount: "700.00",
      status: "paid",
      dueDate: new Date("2026-09-12T12:00:00Z"),
      paidAt: new Date("2026-09-10T12:00:00Z"),
      notes: null,
      createdAt: new Date("2026-09-03T12:00:00Z"),
    };
    const cancelledTripCost = {
      ...activeTripCost,
      id: "trip-cancelled",
      amount: "900.00",
      status: "cancelled",
    };
    const activeAgencyExpense = {
      ...FAKE_PAYMENT,
      id: "agency-active",
      tripId: "trip-001",
      amount: "300.00",
      type: undefined,
      paymentDate: new Date("2026-09-10T12:00:00Z"),
      dueDate: new Date("2026-09-10T12:00:00Z"),
      status: "paid",
    };
    const cancelledAgencyExpense = {
      ...activeAgencyExpense,
      id: "agency-cancelled",
      amount: "800.00",
      status: "cancelled",
    };
    const tripRow = {
      id: "trip-001",
      priceAdult: "0",
      priceChild: null,
      priceSenior: null,
      totalCapacity: 20,
      fixedCosts: [],
      variableCosts: [],
    };
    dbState.selectRowsQueue = [
      [{ id: "trip-001" }],
      [activeTripCost, cancelledTripCost],
      [], // linked expense lookup for the trip costs
      [activeAgencyExpense, cancelledAgencyExpense],
      [tripRow],
      [{ total: 0 }],
    ];

    const res = await request(buildApp(tripCostsRouter)).get("/api/trips/trip-001/costs");

    expect(res.status).toBe(200);
    expect(res.body.costs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "trip-cancelled", status: "cancelled" }),
    ]));
    expect(res.body.agencyExpenses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "agency-cancelled", status: "cancelled" }),
    ]));
    expect(res.body.summary).toMatchObject({
      totalTripCosts: 700,
      totalAgencyExpenses: 300,
      totalRealCosts: 1000,
      totalPaidCosts: 1000,
      totalPendingCosts: 0,
    });
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
    dbState.rowsByTable.set(mockTripCostsTable, [{
      id: "cost-001",
      tenantId: "tenant-001",
      tripId: "trip-001",
      category: "Transporte",
      description: "Custo",
      supplierId: null,
      supplierName: null,
      amount: "100.00",
      status: "pending",
      dueDate: null,
      paidAt: null,
      notes: null,
      createdAt: new Date(),
    }]);
    dbState.rowsByTable.set(mockExpensesTable, []);
    const res = await request(buildApp(tripCostsRouter))
      .put("/api/trips/trip-001/costs/cost-001")
      .send({ description: "upd" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("DELETE /trips/:id/costs/:costId safely removes a linked cost", async () => {
    requireAuthMock.mockResolvedValue(user(ROLES.AGENCY_ADMIN) as never);
    dbState.rowsByTable.set(mockTripCostsTable, [{
      id: "cost-001",
      tenantId: "tenant-001",
      tripId: "trip-001",
    }]);
    dbState.rowsByTable.set(mockExpensesTable, [{
      id: "expense-001",
      tenantId: "tenant-001",
      linkedTripCostId: "cost-001",
    }]);

    const res = await request(buildApp(tripCostsRouter))
      .delete("/api/trips/trip-001/costs/cost-001");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

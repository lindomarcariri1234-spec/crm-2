import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { ROLES, PAYMENT_STATUS, PAYMENT_TYPE, RESERVATION_STATUS } from "@workspace/permissions";

const {
  dbState,
  mockRequireAuth,
  mockDelete,
  makeChain,
  paymentsTable,
  reservationsTable,
} = vi.hoisted(() => {
  const dbState = {
    payments: [] as Array<Record<string, unknown>>,
    reservations: [] as Array<Record<string, unknown>>,
  };
  const mockRequireAuth = vi.fn();
  const mockDelete = vi.fn();
  const paymentsTable = { id: "payments.id" };
  const reservationsTable = { id: "reservations.id" };

  const makeChain = (getRows: () => unknown[]) => {
    const chain = {} as Record<string, unknown>;
    const returnChain = () => chain;
    chain.from = returnChain;
    chain.where = returnChain;
    chain.limit = returnChain;
    chain.for = returnChain;
    chain.orderBy = returnChain;
    chain.offset = returnChain;
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(getRows());
    return chain;
  };

  return { dbState, mockRequireAuth, mockDelete, makeChain, paymentsTable, reservationsTable };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => makeChain(() => {
      throw new Error("select chain was not associated with a table");
    })),
    execute: vi.fn(async () => ({
      rows: [{
        total_paid: dbState.payments
          .filter((payment) => payment.tenantId === TENANT_ID && payment.status === PAYMENT_STATUS.PAID)
          .reduce((total, payment) => total + Number(payment.amount), 0)
          .toFixed(2),
        total_spent: "0",
        outstanding_balance: "0",
      }],
    })),
    update: vi.fn(() => ({
      set: vi.fn((updates: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          for (const reservation of dbState.reservations) {
            Object.assign(reservation, updates);
          }
        }),
      })),
    })),
    delete: mockDelete,
    transaction: vi.fn(),
  },
  paymentsTable,
  expensesTable: {},
  reservationsTable,
  clientsTable: {},
  commissionRulesTable: {},
  commissionsTable: {},
  usersTable: {},
  salesGoalsTable: {},
  tenantsTable: {},
  tripsTable: {},
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

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

vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "generated-id") }));
vi.mock("../lib/activities.js", () => ({ writeClientActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/loyalty-helpers.js", () => ({
  loyaltyAwardPoints: vi.fn().mockResolvedValue(undefined),
  loyaltyAwardPointsForReservation: vi.fn().mockResolvedValue(undefined),
  loyaltyReverseEarnedPoints: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: { syncTrip: vi.fn(), syncPayment: vi.fn() },
}));
vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../queues/email-helpers.js", () => ({
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppPaymentReceived: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/push-notifications.js", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@workspace/db";
import { requireAuth } from "../lib/tenant.js";
import paymentsRouter from "../routes/payments.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const TENANT_ID = "tenant-a";
const OTHER_TENANT_ID = "tenant-b";
const PAYMENT_ID = "payment-to-delete";
const RESERVATION_ID = "reservation-1";

function makePayment(tenantId = TENANT_ID, amount = "300.00") {
  return {
    id: PAYMENT_ID,
    tenantId,
    reservationId: RESERVATION_ID,
    clientId: null,
    type: PAYMENT_TYPE.RECEIVABLE,
    category: "reservation",
    amount,
    paymentMethod: "pix",
    installmentNumber: null,
    totalInstallments: null,
    dueDate: new Date("2026-08-23T00:00:00.000Z"),
    paidAt: new Date("2026-08-23T00:00:00.000Z"),
    status: PAYMENT_STATUS.PAID,
    receiptUrl: null,
    description: null,
    notes: null,
    createdAt: new Date("2026-08-23T00:00:00.000Z"),
    updatedAt: new Date("2026-08-23T00:00:00.000Z"),
  };
}

function makeReservation() {
  return {
    id: RESERVATION_ID,
    tenantId: TENANT_ID,
    clientId: "client-1",
    totalValue: "500.00",
    paidValue: "500.00",
    balance: "0.00",
    status: RESERVATION_STATUS.PENDING,
    confirmedAt: null,
    expiresAt: null,
    depositAmount: null,
    tripId: null,
    seats: [],
    commissionAmount: null,
    sellerId: null,
    createdById: "user-1",
  };
}

function buildApp() {
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
  app.use("/api", paymentsRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.transaction).mockImplementation(async (callback) => callback({
    select: db.select,
    execute: db.execute,
    insert: db.insert,
    update: db.update,
    delete: db.delete,
  } as never));
  dbState.payments = [makePayment(), makePayment(TENANT_ID, "200.00")];
  dbState.payments[1]!.id = "payment-to-keep";
  dbState.reservations = [makeReservation()];
  mockRequireAuth.mockResolvedValue({
    id: "manager-1",
    tenantId: TENANT_ID,
    role: ROLES.AGENCY_ADMIN,
  });

  vi.mocked(db.select).mockImplementation((() => {
    const tableChain = makeChain(() => []);
    tableChain.from = (table: unknown) => {
      if (table === paymentsTable) {
        tableChain.then = (resolve: (rows: unknown[]) => unknown) =>
          resolve(dbState.payments.filter((payment) => payment.tenantId === TENANT_ID));
      } else if (table === reservationsTable) {
        tableChain.then = (resolve: (rows: unknown[]) => unknown) =>
          resolve(dbState.reservations.filter((reservation) => reservation.tenantId === TENANT_ID));
      }
      return tableChain;
    };
    return tableChain;
  }) as never);

  mockDelete.mockImplementation(() => ({
    where: vi.fn(async () => {
      dbState.payments = dbState.payments.filter((payment) => payment.id !== PAYMENT_ID);
    }),
  }));
});

describe("DELETE /api/payments/:id", () => {
  it.each([
    ROLES.AGENCY_ADMIN,
    ROLES.SUPER_ADMIN,
  ])("allows administrative role %s to delete a payment", async (role) => {
    mockRequireAuth.mockResolvedValue({
      id: "manager-1",
      tenantId: TENANT_ID,
      role,
    });

    const response = await request(buildApp()).delete(`/api/payments/${PAYMENT_ID}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(dbState.payments.map((payment) => payment.id)).toEqual(["payment-to-keep"]);
  });

  it("returns 403 for AGENCY_MANAGER because financial access is view-only", async () => {
    mockRequireAuth.mockResolvedValue({
      id: "manager-1",
      tenantId: TENANT_ID,
      role: ROLES.AGENCY_MANAGER,
    });

    const response = await request(buildApp()).delete(`/api/payments/${PAYMENT_ID}`);

    expect(response.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(dbState.payments.map((payment) => payment.id)).toEqual([
      PAYMENT_ID,
      "payment-to-keep",
    ]);
  });

  it("recalculates the reservation paid value and balance after deleting a paid payment", async () => {
    const response = await request(buildApp()).delete(`/api/payments/${PAYMENT_ID}`);

    expect(response.status).toBe(200);
    expect(dbState.reservations[0]).toMatchObject({
      paidValue: "200",
      balance: "300",
    });
  });

  it("returns 403 for SALES without deleting the payment", async () => {
    mockRequireAuth.mockResolvedValue({
      id: "sales-1",
      tenantId: TENANT_ID,
      role: ROLES.SALES,
    });

    const response = await request(buildApp()).delete(`/api/payments/${PAYMENT_ID}`);

    expect(response.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(dbState.payments).toHaveLength(2);
  });

  it("returns 404 when the payment belongs to another tenant", async () => {
    dbState.payments = [makePayment(OTHER_TENANT_ID)];

    const response = await request(buildApp()).delete(`/api/payments/${PAYMENT_ID}`);

    expect(response.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(dbState.payments).toHaveLength(1);
  });
});
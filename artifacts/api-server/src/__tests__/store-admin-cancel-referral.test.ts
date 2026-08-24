import pino from "pino";
/**
 * Route-level tests for the admin manual-cancel referral-reversal path.
 *
 * PUT /store/orders/:id/status with status=CANCELLED triggers referral
 * reversal for paid orders (referralEffectsAppliedAt set). The route
 * branches based on whether the order has linked trip reservations:
 *
 *   - Product-only (no reservations) → reverseProductOnlyOrderReferral
 *   - Trip-based   (reservations)    → reverseTripOrderReferrals
 *
 * Both service functions are mocked (per mock-service-not-db-chain pattern)
 * so the tests assert orchestration logic, not service internals.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// vi.hoisted: shared mocks that must exist before any vi.mock() factory
// ---------------------------------------------------------------------------

const { mockReverseProductOnly, mockReverseTripOrder, mockCancelPartnerItems, mockReverseOrderSettlement, selectQueue, mockUpdateReturning } = vi.hoisted(() => {
  const selectQueue: Array<unknown[]> = [];
  // Default returns true / [] to avoid mock noise
  const mockReverseProductOnly = vi.fn().mockResolvedValue(true);
  const mockReverseTripOrder = vi.fn().mockResolvedValue([]);
  const mockCancelPartnerItems = vi.fn().mockResolvedValue(undefined);
  const mockReverseOrderSettlement = vi.fn().mockResolvedValue(undefined);
  const mockUpdateReturning = vi.fn();
  return { mockReverseProductOnly, mockReverseTripOrder, mockCancelPartnerItems, mockReverseOrderSettlement, selectQueue, mockUpdateReturning };
});

// ---------------------------------------------------------------------------
// Module mocks (must appear before router import)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => {
  // Build a select mock that pops from the shared selectQueue.
  // Each call returns a chainable object whose .where() is also directly
  // thenable (for the reservations select which has no .limit()) as well as
  // having a .limit() for the store/order selects.
  const makeWhereResult = (rows: unknown[]) => ({
    limit: vi.fn((_n: number) => Promise.resolve(rows)),
    then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(rows).catch(reject),
  });

  const mockSelect = vi.fn(() => {
    const rows = selectQueue.shift() ?? [];
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => makeWhereResult(rows)),
      limit: vi.fn(() => Promise.resolve(rows)),
    };
    return chain;
  });

  const mockUpdate = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: mockUpdateReturning,
      })),
    })),
  }));

  return {
    db: {
      select: mockSelect,
      update: mockUpdate,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({})),
    },
    storesTable: {},
    storeOrdersTable: {},
    storeOrderItemsTable: {},
    storeProductsTable: {},
    storeProductVariantsTable: {},
    storeCategoriesTable: {},
    storeCouponsTable: {},
    storeReviewsTable: {},
    reservationsTable: {},
    dealsTable: {},
    pipelineStagesTable: {},
    partnerProductsTable: {},
    priceAlertSubscriptionsTable: {},
    referralsTable: {},
    referralSettingsTable: {},
    tenantsTable: {},
    usersTable: {},
    clientsTable: {},
    tripsTable: {},
    loyaltyMembersTable: {},
    loyaltyProgramsTable: {},
    loyaltyTransactionsTable: {},
  };
});

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("../services/settlements/financial-ledger.js", () => ({
  reverseOrderSettlement: mockReverseOrderSettlement,
  recordOrderPaymentSettlement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("@workspace/permissions", () => ({
  STORE_ORDER_STATUS: {
    CANCELLED: "cancelled",
    COMPLETED: "completed",
    PROCESSING: "processing",
    CONFIRMED: "confirmed",
    PENDING: "pending",
  },
  STORE_PAYMENT_STATUS: {
    PAID: "paid",
    PENDING: "pending",
    FAILED: "failed",
    REFUNDED: "refunded",
  },
  REFERRAL_STATUS: { PENDING: "pending", COMPLETED: "completed", REVERSED: "reversed" },
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    id: "user-001",
    clerkId: "clerk-001",
    tenantId: "tenant-001",
    role: "admin",
  }),
  ADMIN_ROLES: ["admin"],
  MANAGEMENT_ROLES: ["admin", "manager"],
  getTenantUser: vi.fn(),
}));

// Service functions under test
vi.mock("../services/checkout/order-referral-reversal.js", () => ({
  reverseProductOnlyOrderReferral: mockReverseProductOnly,
  reverseTripOrderReferrals: mockReverseTripOrder,
}));

vi.mock("../services/checkout/cancel-partner-items.js", () => ({
  cancelPartnerOrderItems: mockCancelPartnerItems,
}));

// Stub every other service that the route imports
vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: vi.fn().mockResolvedValue({ tripIds: [], reservationIds: [] }),
  confirmReservationsForOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/checkout/post-booking.js", () => ({
  runPostPaymentSideEffects: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/checkout/persist-order.js", () => ({
  applyOrderInventoryEffects: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPriceDropAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/uploadthing.js", () => ({
  deleteOrphanedFile: vi.fn().mockResolvedValue(undefined),
  deleteOrphanedImages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/crypto.js", () => ({
  encryptCredential: vi.fn((v: string) => `enc:${v}`),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
}));

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------

import storeRouter from "../routes/store.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  req.log = pino({ level: "silent" }) as unknown as typeof req.log;
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", storeRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const FAKE_STORE = {
  id: "store-001",
  tenantId: "tenant-001",
  slug: "minha-loja",
  name: "Minha Loja",
};

// Minimal order with referralEffectsAppliedAt set (paid order with referral)
const FAKE_PAID_ORDER_WITH_REFERRAL = {
  id: "order-001",
  storeId: "store-001",
  tenantId: "tenant-001",
  orderNumber: "ORD-0001",
  clientId: null,
  totalAmount: "150.00",
  paymentStatus: "paid",
  referralEffectsAppliedAt: new Date("2026-06-01T12:00:00Z"),
  pendingReferral: {
    code: "FRIEND50",
    referrerId: "client-referrer-1",
    discountValue: 15,
    discountType: "percentage",
    referralId: "ref-row-001",
  },
};

// Order without referral (no pendingReferral)
const FAKE_PAID_ORDER_NO_REFERRAL = {
  ...FAKE_PAID_ORDER_WITH_REFERRAL,
  id: "order-002",
  pendingReferral: null,
};

// Order that has not had referral effects applied yet
const FAKE_UNPAID_ORDER = {
  ...FAKE_PAID_ORDER_WITH_REFERRAL,
  id: "order-003",
  referralEffectsAppliedAt: null,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  selectQueue.length = 0;
  vi.clearAllMocks();
  // Reset default return values after clearAllMocks()
  mockReverseProductOnly.mockResolvedValue(true);
  mockReverseTripOrder.mockResolvedValue([]);
    mockCancelPartnerItems.mockResolvedValue(undefined);
  // Default update returns [{id}] (1 row updated)
  mockUpdateReturning.mockResolvedValue([{ id: "order-001" }]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PUT /api/store/orders/:id/status — admin manual-cancel referral reversal", () => {
  describe("product-only order (no linked reservations)", () => {
    it("reverses paid partner items when the agency cancels the order", async () => {
      selectQueue.push([FAKE_STORE]);
      selectQueue.push([FAKE_PAID_ORDER_WITH_REFERRAL]);
      selectQueue.push([]);

      const res = await request(buildApp())
        .put("/api/store/orders/order-001/status")
        .send({ status: "cancelled" });

      expect(res.status).toBe(200);
      expect(mockCancelPartnerItems).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orderId: "order-001",
          tenantId: "tenant-001",
          reason: "Pedido cancelado pela agência",
        }),
      );
    });

    it("calls reverseProductOnlyOrderReferral and NOT reverseTripOrderReferrals", async () => {
      // DB selects: [store, order, reservations=empty]
      selectQueue.push([FAKE_STORE]);            // getStoreForTenant
      selectQueue.push([FAKE_PAID_ORDER_WITH_REFERRAL]); // re-fetch order after update
      selectQueue.push([]);                      // linked reservations → empty = product-only

      const res = await request(buildApp())
        .put("/api/store/orders/order-001/status")
        .send({ status: "cancelled" });

      expect(res.status).toBe(200);
      expect(mockReverseProductOnly).toHaveBeenCalledTimes(1);
      expect(mockReverseProductOnly).toHaveBeenCalledWith(
        expect.anything(), // db
        expect.objectContaining({
          tenantId: "tenant-001",
          orderId: "order-001",
          referralCode: "FRIEND50",
          referralId: "ref-row-001",
          reversalReason: "order_cancelled",
        }),
      );
      expect(mockReverseTripOrder).not.toHaveBeenCalled();
    });

    it("passes referralId=null for legacy orders missing referralId in JSONB", async () => {
      const orderWithLegacyRef = {
        ...FAKE_PAID_ORDER_WITH_REFERRAL,
        pendingReferral: {
          code: "LEGACY50",
          referrerId: "client-legacy",
          discountValue: 10,
          discountType: "fixed",
          // referralId is absent (legacy order)
        },
      };

      selectQueue.push([FAKE_STORE]);
      selectQueue.push([orderWithLegacyRef]);
      selectQueue.push([]);

      const res = await request(buildApp())
        .put("/api/store/orders/order-001/status")
        .send({ status: "completed" });

      expect(res.status).toBe(200);
      expect(mockReverseProductOnly).not.toHaveBeenCalled();
      expect(mockReverseTripOrder).not.toHaveBeenCalled();
    });

    it("does not reverse when the new status is not CANCELLED (e.g. COMPLETED)", async () => {
      selectQueue.push([FAKE_STORE]);
      selectQueue.push([FAKE_PAID_ORDER_WITH_REFERRAL]);

      const res = await request(buildApp())
        .put("/api/store/orders/order-001/status")
        .send({ status: "completed" });

      expect(res.status).toBe(200);
      expect(mockReverseProductOnly).not.toHaveBeenCalled();
      expect(mockReverseTripOrder).not.toHaveBeenCalled();
    });

    it("does not reverse when the new status is not CANCELLED (e.g. COMPLETED)", async () => {
      selectQueue.push([FAKE_STORE]);
      selectQueue.push([FAKE_PAID_ORDER_WITH_REFERRAL]);

      const res = await request(buildApp())
        .put("/api/store/orders/order-001/status")
        .send({ status: "completed" });

      expect(res.status).toBe(200);
      expect(mockReverseProductOnly).not.toHaveBeenCalled();
      expect(mockReverseTripOrder).not.toHaveBeenCalled();
    });

    it("does not reverse when the new status is not CANCELLED (e.g. COMPLETED)", async () => {
      selectQueue.push([FAKE_STORE]);
      selectQueue.push([FAKE_PAID_ORDER_WITH_REFERRAL]);

      const res = await request(buildApp())
        .put("/api/store/orders/order-001/status")
        .send({ status: "completed" });

      expect(res.status).toBe(200);
      expect(mockReverseProductOnly).not.toHaveBeenCalled();
      expect(mockReverseTripOrder).not.toHaveBeenCalled();
    });

    it("does not reverse when the new status is not CANCELLED (e.g. COMPLETED)", async () => {
      selectQueue.push([FAKE_STORE]);
      selectQueue.push([FAKE_PAID_ORDER_WITH_REFERRAL]);

      const res = await request(buildApp())
        .put("/api/store/orders/order-001/status")
        .send({ status: "completed" });

      expect(res.status).toBe(200);
      expect(mockReverseProductOnly).not.toHaveBeenCalled();
      expect(mockReverseTripOrder).not.toHaveBeenCalled();
    });

    it("does not reverse when the new status is not CANCELLED (e.g. COMPLETED)", async () => {
      selectQueue.push([FAKE_STORE]);
      selectQueue.push([FAKE_PAID_ORDER_WITH_REFERRAL]);

      const res = await request(buildApp())
        .put("/api/store/orders/order-001/status")
        .send({ status: "completed" });

      expect(res.status).toBe(200);
      expect(mockReverseProductOnly).not.toHaveBeenCalled();
      expect(mockReverseTripOrder).not.toHaveBeenCalled();
    });
  });
});

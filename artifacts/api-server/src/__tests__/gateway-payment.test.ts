import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// applyGatewayPayment — task #17 deferral hardening regression guard.
//
// When referral conversion + referral-credit consumption were deferred from
// checkout to payment confirmation (runPostPaymentSideEffects), the gateway
// webhook only invoked those effects when applyGatewayPayment returned a
// non-null result. For PAID product-only orders (no trip reservations) the
// function returned null, so paid product-only gateway orders never credited
// the referrer or consumed the customer's referral credit.
//
// These tests pin the contract that a paid product-only order returns a
// non-null ApplyResult (with empty reservationIds) so the caller still runs
// the payment-gated post-payment side effects, while preserving the existing
// null returns for invalid amount, missing order, and duplicate gateway tx.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: { transaction: vi.fn() },
  storeOrdersTable: {
    id: "id",
    orderNumber: "order_number",
    tenantId: "tenant_id",
    storeId: "store_id",
    clientId: "client_id",
    paymentMethod: "payment_method",
    paymentStatus: "payment_status",
    paymentIntentId: "payment_intent_id",
    paidAt: "paid_at",
    status: "status",
    confirmedAt: "confirmed_at",
  },
  reservationsTable: {
    id: "id",
    tenantId: "tenant_id",
    storeOrderId: "store_order_id",
    totalValue: "total_value",
  },
  paymentsTable: {},
  storesTable: {},
  tripsTable: {},
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("@workspace/permissions", () => ({
  PAYMENT_STATUS: { PAID: "paid" },
  RESERVATION_STATUS: {},
  STORE_ORDER_STATUS: { CONFIRMED: "confirmed" },
  STORE_PAYMENT_STATUS: { PAID: "paid" },
}));

const mockPaymentExists = vi.fn();
const mockSyncReservationPaymentStatus = vi.fn();
vi.mock("../lib/reservation-payments.js", () => ({
  paymentExistsForGatewayTx: (...a: unknown[]) => mockPaymentExists(...a),
  syncReservationPaymentStatus: (...a: unknown[]) => mockSyncReservationPaymentStatus(...a),
}));

const mockCreateReservationsForOrder = vi.fn();
vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: (...a: unknown[]) => mockCreateReservationsForOrder(...a),
}));

vi.mock("../services/checkout/post-booking.js", () => ({ runPostPaymentSideEffects: vi.fn() }));
vi.mock("../services/checkout/persist-order.js", () => ({ applyOrderInventoryEffects: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/settlements/financial-ledger.js", () => ({
  recordOrderPaymentSettlement: vi.fn().mockResolvedValue(undefined),
  reverseOrderSettlement: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../queues/email-helpers.js", () => ({ enqueueNewBookingNotificationEmail: vi.fn() }));
vi.mock("../lib/crypto.js", () => ({ decryptOrPassthrough: vi.fn((v: string) => v) }));
vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "pay-id") }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../lib/pricing.js", () => ({ roundMoney: (n: number) => Math.round(n * 100) / 100 }));
// realtime must be mocked because webhooks.ts imports it at module level;
// applyGatewayPayment itself does NOT call broadcastSeatUpdate — callers do
// after the transaction commits. The mock is here only to satisfy the import.
vi.mock("../lib/realtime.js", () => ({ broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined) }));

import { applyGatewayPayment } from "../routes/webhooks.js";

// Result sets popped, in order, by each tx.select() in applyGatewayPayment:
//   1. the order lookup (.where().limit(1))
//   2. the linked reservations lookup (.where())
let selectResults: object[][] = [];

function makeTx() {
  return {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn(() => chain);
      chain.where = vi.fn(() => {
        const rows = selectResults.shift() ?? [];
        const p = Promise.resolve(rows) as Promise<object[]> & {
          limit: (n: number) => Promise<object[]>;
        };
        p.limit = vi.fn(() => Promise.resolve(rows));
        return p;
      });
      return chain;
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{ id: "order-1" }])),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
  };
}

const STORE = {
  storeId: "store-1",
  tenantId: "tenant-1",
  slug: "loja",
  mpAccessToken: null,
  stripeWebhookSecret: null,
};

const ORDER = {
  id: "order-1",
  orderNumber: "VIS-PROD-202606-00001",
  tenantId: "tenant-1",
  storeId: "store-1",
  clientId: "client-1",
  paymentMethod: "stripe",
  paymentStatus: "pending",
};

const BASE_ARGS = {
  store: STORE,
  gateway: "stripe" as const,
  transactionId: "tx-1",
  paymentIntentId: "pi-1",
  amount: 100,
  paidAt: new Date("2026-06-19T00:00:00Z"),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callApply(args = BASE_ARGS) {
  return applyGatewayPayment(makeTx() as any, args as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  mockPaymentExists.mockResolvedValue(false);
  mockSyncReservationPaymentStatus.mockResolvedValue(undefined);
  // Return the full CreateReservationsResult shape — applyGatewayPayment now
  // accesses createResult.tripIds, so returning undefined would throw.
  mockCreateReservationsForOrder.mockResolvedValue({ reservationIds: [], reservationClientId: null, tripIds: [] });
});

describe("applyGatewayPayment", () => {
  it("returns a non-null result with empty reservationIds for a PAID product-only order (regression guard)", async () => {
    selectResults = [[ORDER], []]; // order found, no linked reservations

    const result = await callApply();

    expect(result).toEqual({
      orderId: "order-1",
      reservationIds: [],
      tripIds: [],
      tenantId: "tenant-1",
    });
    // No reservations → no Payment rows allocated for product-only orders.
    expect(mockSyncReservationPaymentStatus).not.toHaveBeenCalled();
  });

  it("returns reservationIds and allocates payments for a trip order", async () => {
    selectResults = [[ORDER], [{ id: "res-1", totalValue: "100" }]];

    const result = await callApply();

    expect(result).toEqual({
      orderId: "order-1",
      reservationIds: ["res-1"],
      tripIds: [],   // tripIds come from createReservationsForOrder; default mock returns []
      tenantId: "tenant-1",
    });
    expect(mockSyncReservationPaymentStatus).toHaveBeenCalledTimes(1);
  });

  it("propagates tripIds from createReservationsForOrder into the result", async () => {
    selectResults = [[ORDER], [{ id: "res-1", totalValue: "100" }]];
    mockCreateReservationsForOrder.mockResolvedValueOnce({
      reservationIds: ["res-1"],
      reservationClientId: null,
      tripIds: ["trip-A", "trip-B"],
    });

    const result = await callApply();

    expect(result).not.toBeNull();
    expect(result?.tripIds).toEqual(["trip-A", "trip-B"]);
  });

  it("propagates tripIds from createReservationsForOrder for a product-only order", async () => {
    // A product-only order that happens to include a trip product still gets
    // tripIds from createReservationsForOrder; the function returns early for
    // product-only (no existing reservations) but still after createReservations.
    selectResults = [[ORDER], []]; // order found, no existing DB reservations
    mockCreateReservationsForOrder.mockResolvedValueOnce({
      reservationIds: ["res-new"],
      reservationClientId: null,
      tripIds: ["trip-C"],
    });

    const result = await callApply();

    expect(result).not.toBeNull();
    expect(result?.tripIds).toEqual(["trip-C"]);
  });

  it("returns null on a duplicate gateway transaction (idempotency)", async () => {
    selectResults = [[ORDER]];
    mockPaymentExists.mockResolvedValue(true);

    const result = await callApply();

    expect(result).toBeNull();
    expect(mockCreateReservationsForOrder).not.toHaveBeenCalled();
  });

  it("returns null when no matching order exists", async () => {
    selectResults = [[]];

    const result = await callApply();

    expect(result).toBeNull();
  });

  it("returns null for a non-positive amount without touching the database", async () => {
    const tx = makeTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await applyGatewayPayment(tx as any, { ...BASE_ARGS, amount: 0 } as any);

    expect(result).toBeNull();
    expect(tx.select).not.toHaveBeenCalled();
  });
});

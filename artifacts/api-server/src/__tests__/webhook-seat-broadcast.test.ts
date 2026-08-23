/**
 * Integration guard: after a Stripe or MercadoPago payment_intent.succeeded event,
 * the webhook handler must call broadcastSeatUpdate for every trip whose reservation
 * was just created via applyGatewayPayment.
 *
 * Strategy: mount the webhooks router via supertest with real HMAC signature
 * verification. db.transaction is made to CALL its callback with a mock tx object
 * rather than returning a pre-built result, so applyGatewayPayment executes for
 * real and the full chain is exercised:
 *
 *   HTTP webhook → resolveStore → db.transaction(cb(tx)) →
 *   applyGatewayPayment(tx, args) [real] → createReservationsForOrder [mocked] →
 *   tripIds in result → broadcastSeatUpdate called for each
 *
 * createReservationsForOrder is mocked because it touches many tables; everything
 * else in applyGatewayPayment (order lookup, idempotency check, CAS update,
 * inventory, reservation sync) runs against the mock tx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Hoisted mock handles — must be created before any vi.mock() factory uses them
// ---------------------------------------------------------------------------

const {
  mockDbTransaction,
  mockDbSelect,
  mockBroadcastSeatUpdate,
  mockPaymentExists,
  mockCreateReservationsForOrder,
} = vi.hoisted(() => {
  const mockDbTransaction = vi.fn();
  // resolveStore: db.select().from().where().limit(1) chain
  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockDbSelect = vi.fn(() => ({ from: mockFrom }));
  const mockBroadcastSeatUpdate = vi.fn().mockResolvedValue(undefined);
  const mockPaymentExists = vi.fn();
  const mockCreateReservationsForOrder = vi.fn();
  return {
    mockDbTransaction,
    mockDbSelect,
    mockBroadcastSeatUpdate,
    mockWhere,
    mockFrom,
    mockPaymentExists,
    mockCreateReservationsForOrder,
  };
});

// ---------------------------------------------------------------------------
// Module-level vi.mock declarations (hoisted by Vitest to the top of the file)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: { select: mockDbSelect, transaction: mockDbTransaction },
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
  storesTable: {
    id: "storesTable.id",
    tenantId: "storesTable.tenantId",
    slug: "storesTable.slug",
    mpAccessToken: "storesTable.mpAccessToken",
    stripeWebhookSecret: "storesTable.stripeWebhookSecret",
  },
  tripsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => val),
  and: vi.fn((...a: unknown[]) => a),
  inArray: vi.fn(),
  ne: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

vi.mock("@workspace/permissions", () => ({
  PAYMENT_STATUS: {
    PAID: "paid",
    APPROVED: "approved",
    PENDING: "pending",
    CANCELLED: "cancelled",
    REFUNDED: "refunded",
    CHARGED_BACK: "charged_back",
  },
  RESERVATION_STATUS: {},
  STORE_ORDER_STATUS: { CONFIRMED: "confirmed" },
  STORE_PAYMENT_STATUS: { PAID: "paid" },
}));
vi.mock("../services/settlements/financial-ledger.js", () => ({
  recordOrderPaymentSettlement: vi.fn().mockResolvedValue(undefined),
  reverseOrderSettlement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: (...a: unknown[]) => mockBroadcastSeatUpdate(...a),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptOrPassthrough: vi.fn((v: string | null) => v),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: (...a: unknown[]) => mockCreateReservationsForOrder(...a),
}));

vi.mock("../services/checkout/post-booking.js", () => ({
  runPostPaymentSideEffects: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/checkout/persist-order.js", () => ({
  applyOrderInventoryEffects: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/reservation-payments.js", () => ({
  paymentExistsForGatewayTx: (...a: unknown[]) => mockPaymentExists(...a),
  syncReservationPaymentStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "gen-id") }));
vi.mock("../lib/pricing.js", () => ({ roundMoney: (n: number) => Math.round(n * 100) / 100 }));

// ---------------------------------------------------------------------------
// Import router AFTER all vi.mock declarations
// ---------------------------------------------------------------------------

import webhooksRouter from "../routes/webhooks.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Mock tx factory — mirrors gateway-payment.test.ts makeTx().
// db.transaction is configured (in beforeEach) to call its callback with makeTx()
// so that applyGatewayPayment executes for real against these mock db operations.
//
// selectResults is popped in order by each tx.select() call:
//   • Stripe: [0] order lookup, [1] reservations lookup
//   • MP:     [0] resolveOrderForMp (byPi), [1] order lookup, [2] reservations lookup
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = "test-stripe-secret-for-unit-test";

/** Build a valid stripe-signature header for the given rawBody. */
function makeStripeSignature(rawBody: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedPayload = `${timestamp}.${rawBody}`;
  const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

const STORE_SCOPE = {
  storeId: "store-001",
  tenantId: "tenant-001",
  slug: "loja-test",
  mpAccessToken: null,
  stripeWebhookSecret: WEBHOOK_SECRET,
};

// The order row returned by the tx.select ORDER lookup inside applyGatewayPayment
const ORDER = {
  id: "order-1",
  orderNumber: "VIS-PROD-202606-00001",
  tenantId: "tenant-001",
  storeId: "store-001",
  clientId: "client-1",
  paymentMethod: "stripe",
  paymentStatus: "pending",
};

/** Minimal Express app mounting the webhooks router with rawBody support. */
function buildApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use("/api", webhooksRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Shared beforeEach: reset all mocks and configure db.transaction to execute
// its callback with a fresh mock tx, so applyGatewayPayment runs for real.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  mockBroadcastSeatUpdate.mockResolvedValue(undefined);
  mockPaymentExists.mockResolvedValue(false);
  mockCreateReservationsForOrder.mockResolvedValue({
    reservationIds: [],
    reservationClientId: null,
    tripIds: [],
  });

  // KEY CHANGE from the prior version: db.transaction CALLS its callback with
  // a mock tx rather than short-circuiting with a pre-built result. This causes
  // applyGatewayPayment to execute for real, exercising the full chain:
  //   resolveStore → db.transaction(cb(tx)) → applyGatewayPayment [real]
  //   → createReservationsForOrder [mocked] → tripIds → broadcastSeatUpdate
  mockDbTransaction.mockImplementation(
    async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx()),
  );

  // resolveStore: db.select().from().where().limit(1) → [STORE_SCOPE]
  const limitFn = vi.fn().mockResolvedValue([STORE_SCOPE]);
  const whereFn = vi.fn(() => ({ limit: limitFn }));
  const fromFn = vi.fn(() => ({ where: whereFn }));
  mockDbSelect.mockReturnValue({ from: fromFn });
});

// ---------------------------------------------------------------------------
// Stripe webhook — applyGatewayPayment integration + broadcastSeatUpdate
// ---------------------------------------------------------------------------

describe("POST /api/webhooks/stripe/:storeSlug — applyGatewayPayment executes; seat broadcast follows", () => {
  it("applyGatewayPayment runs and broadcastSeatUpdate is called for every tripId it returns", async () => {
    // applyGatewayPayment needs two tx.select calls:
    //   [0] order lookup by paymentIntentId → found
    //   [1] reservations lookup → empty (product-only early-return path)
    // createReservationsForOrder (mocked) returns the tripIds the webhook will broadcast.
    selectResults = [[ORDER], []];
    mockCreateReservationsForOrder.mockResolvedValueOnce({
      reservationIds: [],
      reservationClientId: null,
      tripIds: ["trip-A", "trip-B"],
    });

    const event = {
      id: "evt_001",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_001", amount_received: 10000 } },
    };
    const rawBody = JSON.stringify(event);

    const res = await request(buildApp())
      .post("/api/webhooks/stripe/loja-test")
      .set("stripe-signature", makeStripeSignature(rawBody))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(200);
    // broadcastSeatUpdate is fire-and-forget — flush the microtask queue
    await new Promise<void>((r) => setImmediate(r));

    expect(mockBroadcastSeatUpdate).toHaveBeenCalledTimes(2);
    expect(mockBroadcastSeatUpdate).toHaveBeenCalledWith("trip-A", "tenant-001");
    expect(mockBroadcastSeatUpdate).toHaveBeenCalledWith("trip-B", "tenant-001");
  });

  it("does NOT call broadcastSeatUpdate when createReservationsForOrder returns tripIds: []", async () => {
    // applyGatewayPayment finds the order and runs through the product-only path,
    // but createReservationsForOrder returns no tripIds — no trips to broadcast.
    selectResults = [[ORDER], []];
    // createReservationsForOrder default mock already returns { tripIds: [] }

    const event = {
      id: "evt_002",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_002", amount_received: 5000 } },
    };
    const rawBody = JSON.stringify(event);

    const res = await request(buildApp())
      .post("/api/webhooks/stripe/loja-test")
      .set("stripe-signature", makeStripeSignature(rawBody))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(200);
    await new Promise<void>((r) => setImmediate(r));

    expect(mockBroadcastSeatUpdate).not.toHaveBeenCalled();
  });

  it("does NOT call broadcastSeatUpdate when applyGatewayPayment returns null (order not found — idempotent guard)", async () => {
    // applyGatewayPayment returns null when there is no matching order.
    // No tripIds to broadcast.
    selectResults = [[]]; // order lookup → empty → applyGatewayPayment returns null

    const event = {
      id: "evt_003",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_003", amount_received: 5000 } },
    };
    const rawBody = JSON.stringify(event);

    const res = await request(buildApp())
      .post("/api/webhooks/stripe/loja-test")
      .set("stripe-signature", makeStripeSignature(rawBody))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(200);
    await new Promise<void>((r) => setImmediate(r));

    expect(mockBroadcastSeatUpdate).not.toHaveBeenCalled();
  });

  it("does NOT call broadcastSeatUpdate when the payment is a duplicate (paymentExistsForGatewayTx returns true)", async () => {
    // applyGatewayPayment returns null when the gateway transaction already exists.
    selectResults = [[ORDER]]; // order found, but duplicate check fires
    mockPaymentExists.mockResolvedValueOnce(true);

    const event = {
      id: "evt_004",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_004", amount_received: 5000 } },
    };
    const rawBody = JSON.stringify(event);

    const res = await request(buildApp())
      .post("/api/webhooks/stripe/loja-test")
      .set("stripe-signature", makeStripeSignature(rawBody))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(200);
    await new Promise<void>((r) => setImmediate(r));

    expect(mockBroadcastSeatUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when the Stripe signature is invalid (broadcastSeatUpdate never called)", async () => {
    const event = {
      id: "evt_005",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_005", amount_received: 1000 } },
    };
    const rawBody = JSON.stringify(event);

    const res = await request(buildApp())
      .post("/api/webhooks/stripe/loja-test")
      .set("stripe-signature", "t=0,v1=badbadbadbad")
      .set("content-type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(400);
    expect(mockBroadcastSeatUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when the store slug is unknown (broadcastSeatUpdate never called)", async () => {
    const whereFn = vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) }));
    const fromFn = vi.fn(() => ({ where: whereFn }));
    mockDbSelect.mockReturnValue({ from: fromFn });

    const event = { id: "evt_006", type: "payment_intent.succeeded", data: { object: {} } };
    const rawBody = JSON.stringify(event);

    const res = await request(buildApp())
      .post("/api/webhooks/stripe/unknown-slug")
      .set("stripe-signature", makeStripeSignature(rawBody))
      .set("content-type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(400);
    expect(mockBroadcastSeatUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// MercadoPago webhook — analogous broadcast path
// ---------------------------------------------------------------------------

const MP_SECRET = "mp-test-webhook-secret";
const MP_PAYMENT_ID = "9876543";

const STORE_SCOPE_MP = {
  storeId: "store-001",
  tenantId: "tenant-001",
  slug: "loja-test",
  mpAccessToken: "mp-access-token",
  stripeWebhookSecret: null,
};

const ORDER_MP = { ...ORDER, paymentMethod: "mercadopago" };

/** Compute a valid MercadoPago x-signature header. */
function makeMpSignature(dataId: string, requestId: string): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", MP_SECRET).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

describe("POST /api/webhooks/mercadopago/:storeSlug — seat broadcast after MP payment approved", () => {
  beforeEach(() => {
    process.env["MP_WEBHOOK_SECRET"] = MP_SECRET;

    // resolveStore returns a store with mpAccessToken set
    const limitFn = vi.fn().mockResolvedValue([STORE_SCOPE_MP]);
    const whereFn = vi.fn(() => ({ limit: limitFn }));
    const fromFn = vi.fn(() => ({ where: whereFn }));
    mockDbSelect.mockReturnValue({ from: fromFn });

    // Stub globalThis.fetch used by fetchMpPayment to retrieve payment details
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: Number(MP_PAYMENT_ID),
            status: "approved",
            transaction_amount: 100,
            external_reference: "VIS-PROD-202606-00001",
            date_approved: "2026-06-01T10:00:00Z",
          }),
      }),
    );
  });

  afterEach(() => {
    delete process.env["MP_WEBHOOK_SECRET"];
    vi.unstubAllGlobals();
  });

  it("applyGatewayPayment runs and broadcastSeatUpdate is called for the MP-payment tripId", async () => {
    // MP transaction callback calls resolveOrderForMp first, then applyGatewayPayment.
    // resolveOrderForMp consumes one tx.select (byPi fast path).
    // applyGatewayPayment consumes two more: order lookup, reservations lookup.
    selectResults = [
      [{ id: "order-1" }], // resolveOrderForMp → byPi found
      [ORDER_MP],          // applyGatewayPayment → order lookup
      [],                  // applyGatewayPayment → reservations (empty → product-only path)
    ];
    mockCreateReservationsForOrder.mockResolvedValueOnce({
      reservationIds: [],
      reservationClientId: null,
      tripIds: ["trip-M"],
    });

    const requestId = "req-mp-001";
    const sig = makeMpSignature(MP_PAYMENT_ID, requestId);
    const body = { type: "payment", data: { id: MP_PAYMENT_ID } };

    const res = await request(buildApp())
      .post("/api/webhooks/mercadopago/loja-test")
      .set("x-signature", sig)
      .set("x-request-id", requestId)
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    await new Promise<void>((r) => setImmediate(r));

    expect(mockBroadcastSeatUpdate).toHaveBeenCalledWith("trip-M", "tenant-001");
  });

  it("does NOT call broadcastSeatUpdate for non-payment MP event types (merchant_order ack)", async () => {
    const dataId = "order-ref-99";
    const requestId = "req-mp-002";
    const sig = makeMpSignature(dataId, requestId);
    const body = { type: "merchant_order", data: { id: dataId } };

    const res = await request(buildApp())
      .post("/api/webhooks/mercadopago/loja-test")
      .set("x-signature", sig)
      .set("x-request-id", requestId)
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    expect(mockBroadcastSeatUpdate).not.toHaveBeenCalled();
  });

  it("does NOT call broadcastSeatUpdate when resolveOrderForMp finds no matching order", async () => {
    // resolveOrderForMp: byPi → empty, no external_reference fallback
    selectResults = [
      [], // resolveOrderForMp byPi → not found
      // No byRef fallback because external_reference in event body would be needed
    ];

    const requestId = "req-mp-003";
    const sig = makeMpSignature(MP_PAYMENT_ID, requestId);
    const body = { type: "payment", data: { id: MP_PAYMENT_ID } };

    const res = await request(buildApp())
      .post("/api/webhooks/mercadopago/loja-test")
      .set("x-signature", sig)
      .set("x-request-id", requestId)
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    await new Promise<void>((r) => setImmediate(r));

    expect(mockBroadcastSeatUpdate).not.toHaveBeenCalled();
  });
});

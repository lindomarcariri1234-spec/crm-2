/**
 * Integration test: after a Stripe webhook triggers applyGatewayPayment, the SSE
 * event must actually ARRIVE at a connected boarding-panel client within a bounded
 * time.
 *
 * Unlike webhook-seat-broadcast.test.ts (which mocks broadcastSeatUpdate and only
 * confirms it is CALLED), this test lets the real broadcastSeatUpdate +
 * emitSeatUpdate run end-to-end, using a mock SSE transport (a plain object with
 * a write() method registered as a seat-stream client) as the minimally-mocked
 * transport boundary.
 *
 * The full chain exercised here:
 *
 *   HTTP POST /api/webhooks/stripe/:slug        (real Express handler)
 *   → verifyStripeSignature                     (real HMAC check)
 *   → resolveStore (db.select mock)             (real query logic, mocked DB)
 *   → db.transaction(cb(tx))                    (tx mock; applyGatewayPayment real)
 *   → applyGatewayPayment(tx, args)             (real)
 *       • order lookup via tx.select            (mock tx returns ORDER)
 *       • paymentExistsForGatewayTx             (mocked → false)
 *       • tx.update … .returning()              (mock tx returns [{ id }])
 *       • createReservationsForOrder            (mocked → { tripIds: ["trip-SSE"] })
 *       • applyOrderInventoryEffects            (mocked)
 *       • tx.select reservations                (mock tx returns [])
 *   → broadcastSeatUpdate("trip-SSE", tenantId) (REAL — realtime.ts is not mocked)
 *       • db.select reservations (mock → [])    (real query logic, mocked DB)
 *       • emitSeatUpdate(payload)              (REAL — seat-sse.ts is not mocked)
 *           ↓
 *   mock SSE transport's write() is called     ← this is what we assert
 *
 * Bounded-wait assertion: the test waits up to 2 000 ms for the SSE event to
 * arrive, matching the spirit of "passenger visible within 3s" from the code
 * review.  In practice the event arrives within a single microtask tick (<1 ms)
 * because all DB mocks resolve synchronously.
 *
 * Paired with:
 *   - BoardingPanelModal.refetch.test.ts  — frontend SSE→refetch wiring in the
 *     actual component (MockEventSource as transport boundary)
 *   - webhook-seat-broadcast.test.ts      — full applyGatewayPayment chain, Stripe
 *     and MercadoPago paths, idempotency
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Response } from "express";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Hoisted mock handles
// ---------------------------------------------------------------------------

const {
  mockDbTransaction,
  mockDbSelect,
  mockPaymentExists,
  mockCreateReservationsForOrder,
} = vi.hoisted(() => {
  const mockDbTransaction = vi.fn();
  const mockDbSelect = vi.fn();
  const mockPaymentExists = vi.fn();
  const mockCreateReservationsForOrder = vi.fn();
  return { mockDbTransaction, mockDbSelect, mockPaymentExists, mockCreateReservationsForOrder };
});

// ---------------------------------------------------------------------------
// Module mocks — NOTE: "../lib/realtime.js" and "../lib/seat-sse.js" are
// intentionally NOT mocked here. Both run for real so we can assert that the SSE
// event actually reaches the mock transport client registered via addSeatClient.
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
    tripId: "trip_id",
    seats: "seats",
    status: "status",
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

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("@workspace/permissions", () => ({
  PAYMENT_STATUS: { PAID: "paid", APPROVED: "approved" },
  RESERVATION_STATUS: { CONFIRMED: "confirmed", PENDING: "pending" },
  STORE_ORDER_STATUS: { CONFIRMED: "confirmed" },
  STORE_PAYMENT_STATUS: { PAID: "paid" },
}));

// realtime.js is NOT mocked — broadcastSeatUpdate runs for real
// seat-sse.js is NOT mocked — emitSeatUpdate runs for real

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
  releaseOrderInventoryHolds: vi.fn().mockResolvedValue(undefined),
  reverseOrderInventoryEffects: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/settlements/financial-ledger.js", () => ({
  adjustOrderSettlement: vi.fn().mockResolvedValue(undefined),
  recordOrderPaymentSettlement: vi.fn().mockResolvedValue(undefined),
  reverseOrderSettlement: vi.fn().mockResolvedValue(undefined),
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
// Import modules AFTER all vi.mock declarations
// ---------------------------------------------------------------------------

import webhooksRouter from "../routes/webhooks.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { addSeatClient, removeSeatClient } from "../lib/seat-sse.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = "sse-delivery-test-stripe-secret";
const TRIP_ID = "trip-SSE-delivery";
const TENANT_ID = "tenant-sse";

const STORE_SCOPE = {
  storeId: "store-sse",
  tenantId: TENANT_ID,
  slug: "loja-sse",
  mpAccessToken: null,
  stripeWebhookSecret: WEBHOOK_SECRET,
};

const ORDER = {
  id: "order-sse",
  orderNumber: "VIS-PROD-202606-SSE01",
  tenantId: TENANT_ID,
  storeId: "store-sse",
  clientId: "client-sse",
  paymentMethod: "stripe",
  paymentStatus: "pending",
};

function makeStripeSignature(rawBody: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signed = `${timestamp}.${rawBody}`;
  const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(signed).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

// ---------------------------------------------------------------------------
// Mock tx factory (same pattern as webhook-seat-broadcast.test.ts)
// ---------------------------------------------------------------------------

let txSelectResults: object[][] = [];

function makeTx() {
  return {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn(() => chain);
      chain.where = vi.fn(() => {
        const rows = txSelectResults.shift() ?? [];
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
          returning: vi.fn(() => Promise.resolve([{ id: ORDER.id }])),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
  };
}

// ---------------------------------------------------------------------------
// Build the test app
// ---------------------------------------------------------------------------

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
// Mock SSE transport — a plain object with write() and the minimum surface
// required by emitSeatUpdate. This is the "minimally mocked transport boundary":
// it captures SSE payloads written by the real emitSeatUpdate function without
// needing a real HTTP connection between test and server.
// ---------------------------------------------------------------------------

interface MockTransport {
  writes: string[];
  res: Partial<Response>;
}

function makeMockTransport(): MockTransport {
  const writes: string[] = [];
  const res: Partial<Response> = {
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as unknown as Response["write"],
  };
  return { writes, res };
}

// ---------------------------------------------------------------------------
// Helper: wait up to `maxMs` for `predicate()` to return true, checking every
// `intervalMs`. Throws a descriptive error if the deadline is reached.
// ---------------------------------------------------------------------------

async function waitFor(
  predicate: () => boolean,
  maxMs: number,
  description: string,
): Promise<void> {
  const deadline = Date.now() + maxMs;
  return new Promise<void>((resolve, reject) => {
    function check() {
      if (predicate()) return resolve();
      if (Date.now() >= deadline) return reject(new Error(`Timed out after ${maxMs}ms: ${description}`));
      setTimeout(check, 5);
    }
    check();
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let transport: MockTransport;

function makeDbSelectRows(rows: unknown[]) {
  const result = Object.assign(Promise.resolve(rows), {
    limit: vi.fn(() => Promise.resolve(rows)),
  });
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => result);
  return chain;
}

function paymentSucceededEvent() {
  return {
    id: "evt_sse_03",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_sse_03", amount_received: 15000 } },
  };
}

async function deliverPaymentEvent() {
  const rawBody = JSON.stringify(paymentSucceededEvent());
  return request(buildApp())
    .post("/api/webhooks/stripe/loja-sse")
    .set("stripe-signature", makeStripeSignature(rawBody))
    .set("content-type", "application/json")
    .send(rawBody);
}

// Saved so we can restore it after each test without affecting other suites.
let _savedMpWebhookSecret: string | undefined;

describe("Stripe payment seat updates reach boarding clients", () => {
  beforeEach(() => {
    // The production Stripe handler reads STRIPE_WEBHOOK_SECRET from process.env.
    // Set it to the test secret before each test and restore it afterward.
    _savedMpWebhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
    process.env["STRIPE_WEBHOOK_SECRET"] = WEBHOOK_SECRET;

    vi.clearAllMocks();
    txSelectResults = [];
    mockPaymentExists.mockResolvedValue(false);
    mockCreateReservationsForOrder.mockResolvedValue({
      reservationIds: [],
      reservationClientId: null,
      tripIds: [],
    });
    mockDbTransaction.mockImplementation(
      async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx()),
    );

    let dbSelectCallCount = 0;
    mockDbSelect.mockImplementation(() => {
      dbSelectCallCount++;
      return makeDbSelectRows(dbSelectCallCount === 1 ? [STORE_SCOPE] : []);
    });

    transport = makeMockTransport();
    addSeatClient(TRIP_ID, transport.res as Response);
  });

  afterEach(() => {
    removeSeatClient(TRIP_ID, transport.res as Response);

    // Restore STRIPE_WEBHOOK_SECRET to its original value (or remove it if it
    // was not set before the test ran).
    if (_savedMpWebhookSecret === undefined) {
      delete process.env["STRIPE_WEBHOOK_SECRET"];
    } else {
      process.env["STRIPE_WEBHOOK_SECRET"] = _savedMpWebhookSecret;
    }
  });

  it("delivers an SSE event after a successful payment", async () => {
    txSelectResults = [[ORDER], []];
    mockCreateReservationsForOrder.mockResolvedValueOnce({
      reservationIds: [],
      reservationClientId: null,
      tripIds: [TRIP_ID],
    });

    const res = await deliverPaymentEvent();
    expect(res.status).toBe(200);

    await waitFor(
      () => transport.writes.length > 0,
      2000,
      "SSE event must arrive at the connected mock transport within 2 000 ms",
    );

    const sseFrame = transport.writes[0];
    expect(sseFrame).toMatch(/^data: /);
    const payload = JSON.parse(sseFrame.replace(/^data: /, "").trimEnd());
    expect(payload.tripId).toBe(TRIP_ID);
    expect(Array.isArray(payload.seats)).toBe(true);
  });

  it("does not deliver an event to a client registered for another trip", async () => {
    txSelectResults = [[ORDER], []];
    mockCreateReservationsForOrder.mockResolvedValueOnce({
      reservationIds: [],
      reservationClientId: null,
      tripIds: ["trip-SSE-other"],
    });

    await deliverPaymentEvent();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(transport.writes).toHaveLength(0);
  });

  it("includes occupied seats from the real seat update query", async () => {
    let dbSelectCallCount = 0;
    const confirmedReservation = { seats: ["1A"], status: "confirmed" };
    mockDbSelect.mockImplementation(() => {
      dbSelectCallCount++;
      return makeDbSelectRows(
        dbSelectCallCount === 1 ? [STORE_SCOPE] : [confirmedReservation],
      );
    });
    txSelectResults = [[ORDER], []];
    mockCreateReservationsForOrder.mockResolvedValueOnce({
      reservationIds: [],
      reservationClientId: null,
      tripIds: [TRIP_ID],
    });

    await deliverPaymentEvent();
    await waitFor(
      () => transport.writes.length > 0,
      2000,
      "SSE event with seat data must arrive within 2 000 ms",
    );

    const payload = JSON.parse(transport.writes[0].replace(/^data: /, "").trimEnd());
    expect(payload.tripId).toBe(TRIP_ID);
    expect(payload.seats).toContainEqual({ number: "1A", status: "confirmed" });
  });
});

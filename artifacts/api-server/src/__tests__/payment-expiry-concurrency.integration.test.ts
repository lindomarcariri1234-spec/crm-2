/**
 * Real PostgreSQL regression tests for payment confirmation vs reservation
 * expiry. These tests use the shared @workspace/db pool and exercise the
 * actual PATCH route and expiry cron; external notifications are mocked.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  clientsTable,
  paymentsTable,
  reservationsTable,
  storesTable,
  storeOrdersTable,
  tenantsTable,
  tripsTable,
  usersTable,
} from "@workspace/db";
import { PAYMENT_STATUS, PAYMENT_TYPE, ROLES } from "@workspace/permissions";

const { mockRequireAuth } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
}));

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

vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/activities.js", () => ({ writeClientActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/loyalty-helpers.js", () => ({
  loyaltyAwardPoints: vi.fn().mockResolvedValue(undefined),
  loyaltyAwardPointsForReservation: vi.fn().mockResolvedValue(undefined),
  loyaltyReverseEarnedPoints: vi.fn().mockResolvedValue(undefined),
  calculateTier: vi.fn(() => "bronze"),
}));
vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: { syncTrip: vi.fn().mockResolvedValue(undefined), syncPayment: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../lib/reservation-payments.js", () => ({
  sumPaidReservationPayments: async (
    executor: Pick<typeof db, "execute">,
    reservationId: string,
    tenantId: string,
  ) => {
    const result = await executor.execute(sql`
      SELECT COALESCE(SUM(amount::numeric), 0) AS total_paid
      FROM payments
      WHERE reservation_id = ${reservationId}
        AND tenant_id = ${tenantId}
        AND status = ${PAYMENT_STATUS.PAID}
    `);
    const row = (result as unknown as { rows: Array<{ total_paid: string }> }).rows[0];
    return Number(row?.total_paid ?? "0");
  },
  syncReservationPaymentStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/reservation-order-payment-sync.js", () => ({
  syncStoreOrderFromOrderPayment: vi.fn().mockResolvedValue(undefined),
  syncStoreOrderFromReservationPayment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/reservation-referral-conversion.js", async () => {
  const actual = await vi.importActual<typeof import("../services/reservation-referral-conversion.js")>(
    "../services/reservation-referral-conversion.js",
  );
  return {
    ...actual,
    convertPaidReservationReferral: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("../queues/email-helpers.js", () => ({
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralReversedEmail: vi.fn().mockResolvedValue(undefined),
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
vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/checkout/cancel-partner-items.js", () => ({
  cancelPartnerOrderItems: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/checkout/persist-order.js", () => ({
  releaseOrderInventoryHolds: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/checkout/deferred-referral-effects.js", () => ({
  expirePendingReferralForOrder: vi.fn().mockResolvedValue(undefined),
  restoreSpentCreditForOrder: vi.fn().mockResolvedValue(undefined),
}));

import paymentsRouter from "../routes/payments.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { runExpiredReservationsCron } from "../lib/expired-reservations.js";

const RUN = randomUUID().replaceAll("-", "").slice(0, 10);
const TENANT_ID = `pec-tenant-${RUN}`;
const USER_ID = `pec-user-${RUN}`;
const CLIENT_ID = `pec-client-${RUN}`;
const STORE_ID = `pec-store-${RUN}`;
const TRIP_ID = `pec-trip-${RUN}`;
const SEAT_CAPACITY = 12;
let reservationClientSequence = 0;

function reservationId(suffix: string) { return `pec-res-${RUN}-${suffix}`; }
function orderId(suffix: string) { return `pec-order-${RUN}-${suffix}`; }
function orderNumber(suffix: string) { return `PEC-${RUN}-${suffix}`; }
function paymentId(suffix: string) { return `pec-payment-${RUN}-${suffix}`; }

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {},
    };
    next();
  });
  app.use("/api", paymentsRouter);
  app.use(errorHandler);
  return app;
}

async function createOrder(suffix: string, status = "pending", paymentStatus = "pending") {
  const [row] = await db.insert(storeOrdersTable).values({
    id: orderId(suffix),
    storeId: STORE_ID,
    tenantId: TENANT_ID,
    orderNumber: orderNumber(suffix),
    customerName: "Payment expiry customer",
    customerEmail: `pec-${RUN}@example.com`,
    customerPhone: "85999990000",
    subtotal: "100.00",
    totalAmount: "100.00",
    paymentMethod: "pix",
    paymentProvider: "manual",
    status,
    paymentStatus,
  }).returning({ id: storeOrdersTable.id, orderNumber: storeOrdersTable.orderNumber });
  return row!;
}

async function createReservation(
  suffix: string,
  options: { storeOrderNumber?: string; status?: string; seat?: string; expiresAt?: Date } = {},
) {
  const id = reservationId(suffix);
  // Active reservations are unique per tenant/client/trip. Give each fixture
  // its own client so unrelated scenarios can coexist in the same test run.
  const reservationClientId = `pec-client-${RUN}-${suffix}`;
  await db.insert(clientsTable).values({
    id: reservationClientId,
    tenantId: TENANT_ID,
    name: "Payment expiry reservation client",
    email: `pec-client-${RUN}-${suffix}@example.com`,
    whatsapp: `85${String(++reservationClientSequence).padStart(9, "0")}`,
    createdById: USER_ID,
  });
  await db.insert(reservationsTable).values({
    id,
    tenantId: TENANT_ID,
    tripId: TRIP_ID,
    clientId: reservationClientId,
    createdById: USER_ID,
    seats: [options.seat ?? suffix],
    totalValue: "100.00",
    balance: "100.00",
    voucherCode: `PEC-VOUCHER-${RUN}-${suffix}`,
    qrCode: `pec-qr-${suffix}`,
    status: options.status ?? "pending",
    ...(options.storeOrderNumber ? { storeOrderId: options.storeOrderNumber } : {}),
  } as typeof reservationsTable.$inferInsert);
  await setReservationExpiry(id, options.expiresAt ?? new Date(Date.now() - 60_000));
  return id;
}

async function setReservationExpiry(id: string, expiresAt: Date) {
  await db.execute(sql`UPDATE reservations SET expires_at = ${expiresAt} WHERE id = ${id}`);
}

async function createPayment(
  suffix: string,
  options: {
    reservationId?: string | null;
    orderId?: string | null;
    status?: typeof PAYMENT_STATUS.PENDING | typeof PAYMENT_STATUS.PAID;
  } = {},
) {
  const id = paymentId(suffix);
  await db.insert(paymentsTable).values({
    id,
    tenantId: TENANT_ID,
    reservationId: options.reservationId ?? null,
    orderId: options.orderId ?? null,
    type: PAYMENT_TYPE.RECEIVABLE,
    category: "reservation",
    amount: "100.00",
    paymentMethod: "pix",
    dueDate: new Date(),
    ...(options.status === PAYMENT_STATUS.PAID
      ? { status: PAYMENT_STATUS.PAID, paidAt: new Date() }
      : { status: options.status ?? PAYMENT_STATUS.PENDING }),
  });
  return id;
}

async function setTripSeats(availableSeats: number, reservedSeats: number) {
  await db.update(tripsTable).set({ availableSeats, reservedSeats }).where(eq(tripsTable.id, TRIP_ID));
}

async function readReservationStatus(id: string) {
  const [row] = await db.select({ status: reservationsTable.status })
    .from(reservationsTable).where(eq(reservationsTable.id, id));
  return row?.status;
}

async function readSeats() {
  const [row] = await db.select({
    availableSeats: tripsTable.availableSeats,
    reservedSeats: tripsTable.reservedSeats,
  }).from(tripsTable).where(eq(tripsTable.id, TRIP_ID));
  return row;
}

/**
 * Wait until PostgreSQL itself reports a connection waiting on the fixture
 * row lock. This is an observable DB barrier, rather than a Promise.all race.
 * Waiters can queue behind one another, so follow the full blocker chain and
 * allow callers to require multiple waiting connections. Some integration
 * databases hide query text, so pg_stat_activity.query is only an extra check.
 */
async function waitForBlockedQuery(
  blockingBackendPid: number,
  predicate: (query: string) => boolean,
  expectedCount = 1,
) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; query: string; blocker_relations: string }>(`
      WITH RECURSIVE lock_chain(waiter_pid, blocker_pid, path) AS (
        SELECT activity.pid, blocker.pid, ARRAY[activity.pid, blocker.pid]
        FROM pg_stat_activity activity
        CROSS JOIN LATERAL unnest(pg_blocking_pids(activity.pid)) AS blocker(pid)
        WHERE activity.datname = current_database()
          AND activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
        UNION ALL
        SELECT chain.waiter_pid, blocker.pid, chain.path || blocker.pid
        FROM lock_chain chain
        CROSS JOIN LATERAL unnest(pg_blocking_pids(chain.blocker_pid)) AS blocker(pid)
        WHERE NOT blocker.pid = ANY(chain.path)
      )
      SELECT activity.pid, activity.query,
        COALESCE((
          SELECT string_agg(DISTINCT relation.relname, ' ')
          FROM pg_locks blocker_lock
          JOIN pg_class relation ON relation.oid = blocker_lock.relation
          WHERE blocker_lock.pid = ANY(pg_blocking_pids(activity.pid))
        ), '') AS blocker_relations
      FROM pg_stat_activity activity
      WHERE activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND activity.wait_event_type = 'Lock'
        AND EXISTS (
          SELECT 1
          FROM lock_chain
          WHERE lock_chain.waiter_pid = activity.pid
            AND lock_chain.blocker_pid = $1
        )
    `, [blockingBackendPid]);
    const matchingQueries = result.rows.filter((row) =>
      !row.query.trim() || predicate(`${row.query} ${row.blocker_relations}`.toLowerCase()),
    );
    if (matchingQueries.length >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const active = await pool.query(`
    SELECT pid, query, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
  `);
  throw new Error(`Timed out waiting for the expected PostgreSQL row-lock barrier: ${JSON.stringify(active.rows)}`);
}

async function expectRequestFinishesWhileReservationLocked(
  responsePromise: Promise<{ status: number }>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    responsePromise.then((response) => ({ response })),
    new Promise<{ timedOut: true }>((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), 2_000);
    }),
  ]);
  if (timer) clearTimeout(timer);
  expect("timedOut" in outcome).toBe(false);
  if ("response" in outcome) expect(outcome.response.status).toBe(200);
}

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run payment expiry concurrency integration tests");
  }

  mockRequireAuth.mockResolvedValue({
    id: USER_ID,
    tenantId: TENANT_ID,
    role: ROLES.AGENCY_ADMIN,
    name: "Payment expiry integration tester",
    email: `pec-${RUN}@example.com`,
  });
  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Payment expiry integration tenant",
    slug: `pec-${RUN}`,
    email: `pec-tenant-${RUN}@example.com`,
  });
  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: `pec-clerk-${RUN}`,
    tenantId: TENANT_ID,
    name: "Payment expiry integration tester",
    email: `pec-user-${RUN}@example.com`,
    role: ROLES.AGENCY_ADMIN,
    referralCode: `PEC-${RUN}`,
  });
  await db.insert(clientsTable).values({
    id: CLIENT_ID,
    tenantId: TENANT_ID,
    name: "Payment expiry test client",
    email: `pec-client-${RUN}@example.com`,
    whatsapp: "85999990000",
    createdById: USER_ID,
  });
  await db.insert(storesTable).values({
    id: STORE_ID,
    tenantId: TENANT_ID,
    name: "Payment expiry test store",
    slug: `pec-store-${RUN}`,
    email: `pec-store-${RUN}@example.com`,
  });
  await db.insert(tripsTable).values({
    id: TRIP_ID,
    tenantId: TENANT_ID,
    name: "Payment expiry integration trip",
    slug: `pec-trip-${RUN}`,
    destination: "Fortaleza",
    destinationCity: "Fortaleza",
    destinationState: "CE",
    type: "excursao",
    category: "standard",
    departureDate: new Date("2027-01-10"),
    totalCapacity: SEAT_CAPACITY,
    availableSeats: SEAT_CAPACITY,
    reservedSeats: 0,
    priceAdult: "100.00",
    createdById: USER_ID,
  });
});

afterAll(async () => {
  await db.delete(paymentsTable).where(eq(paymentsTable.tenantId, TENANT_ID));
  await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, TENANT_ID));
  await db.delete(storeOrdersTable).where(eq(storeOrdersTable.tenantId, TENANT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(storesTable).where(eq(storesTable.id, STORE_ID));
  await db.delete(tripsTable).where(eq(tripsTable.id, TRIP_ID));
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

describe("payment and reservation expiry concurrency — real PostgreSQL", () => {
  it("expires both orderless and storefront reservations and restores trip capacity", async () => {
    const order = await createOrder("expiry");
    const orderlessReservation = await createReservation("expiry-orderless");
    const storefrontReservation = await createReservation("expiry-storefront", {
      storeOrderNumber: order.orderNumber,
    });
    const orderlessPayment = await createPayment("expiry-orderless", {
      reservationId: orderlessReservation,
    });
    const storefrontPayment = await createPayment("expiry-storefront", {
      reservationId: storefrontReservation,
      orderId: order.id,
    });
    await setTripSeats(SEAT_CAPACITY - 2, 2);

    await runExpiredReservationsCron();

    expect(await readReservationStatus(orderlessReservation)).toBe("cancelled");
    expect(await readReservationStatus(storefrontReservation)).toBe("cancelled");
    expect(await readSeats()).toEqual({ availableSeats: SEAT_CAPACITY, reservedSeats: 0 });
    const [updatedOrder] = await db.select({ status: storeOrdersTable.status })
      .from(storeOrdersTable).where(eq(storeOrdersTable.id, order.id));
    expect(updatedOrder?.status).toBe("cancelled");

    const app = buildApp();
    const latePayments = await Promise.all([
      request(app).patch(`/api/payments/${orderlessPayment}`).send({ status: PAYMENT_STATUS.PAID }),
      request(app).patch(`/api/payments/${storefrontPayment}`).send({ status: PAYMENT_STATUS.PAID }),
    ]);
    expect(latePayments.map((response) => response.status)).toEqual([409, 409]);
    const storedPayments = await db.select({
      id: paymentsTable.id,
      status: paymentsTable.status,
    }).from(paymentsTable).where(and(
      eq(paymentsTable.tenantId, TENANT_ID),
      eq(paymentsTable.reservationId, orderlessReservation),
    ));
    const storefrontStoredPayments = await db.select({
      id: paymentsTable.id,
      status: paymentsTable.status,
    }).from(paymentsTable).where(and(
      eq(paymentsTable.tenantId, TENANT_ID),
      eq(paymentsTable.reservationId, storefrontReservation),
    ));
    expect(storedPayments).toEqual([{ id: orderlessPayment, status: PAYMENT_STATUS.PENDING }]);
    expect(storefrontStoredPayments).toEqual([{ id: storefrontPayment, status: PAYMENT_STATUS.PENDING }]);
  });

  it("accepts a direct orderId-only PAID PATCH before expiry and retains the receipt at expiry", async () => {
    const order = await createOrder("order-only-paid");
    const reservation = await createReservation("order-only-paid", {
      storeOrderNumber: order.orderNumber,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const payment = await createPayment("order-only-paid", { orderId: order.id });
    const app = buildApp();
    const response = await request(app).patch(`/api/payments/${payment}`)
      .send({ status: PAYMENT_STATUS.PAID, paidAt: new Date().toISOString() });
    expect(response.status).toBe(200);

    await setReservationExpiry(reservation, new Date(Date.now() - 60_000));
    await setTripSeats(SEAT_CAPACITY - 1, 1);

    await runExpiredReservationsCron();

    expect(await readReservationStatus(reservation)).toBe("pending");
    expect(await readSeats()).toEqual({ availableSeats: SEAT_CAPACITY - 1, reservedSeats: 1 });
    const [storedPayment] = await db.select({ status: paymentsTable.status })
      .from(paymentsTable).where(eq(paymentsTable.id, payment));
    expect(storedPayment?.status).toBe(PAYMENT_STATUS.PAID);
  });

  it("rechecks an orderless receipt committed while expiry waits on its reservation row", async () => {
    const reservation = await createReservation("receipt-race");
    const payment = await createPayment("receipt-race", { reservationId: reservation });
    await setTripSeats(SEAT_CAPACITY - 1, 1);

    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    try {
      await blocker.query("SELECT id FROM reservations WHERE id = $1 FOR UPDATE", [reservation]);
      const [{ pid }] = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows;
      const cron = runExpiredReservationsCron();
      await waitForBlockedQuery(pid, (query) =>
        query.includes("reservations") && (query.includes("for update") || query.startsWith("update")),
      );

      // This commits in a separate statement/connection while expiry is
      // blocked. The cron must take a fresh statement snapshot before canceling.
      await db.update(paymentsTable).set({
        status: PAYMENT_STATUS.PAID,
        paidAt: new Date(),
      }).where(eq(paymentsTable.id, payment));
      await blocker.query("COMMIT");
      await cron;
    } catch (error) {
      await blocker.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      blocker.release();
    }

    expect(await readReservationStatus(reservation)).toBe("pending");
    expect(await readSeats()).toEqual({ availableSeats: SEAT_CAPACITY - 1, reservedSeats: 1 });
  });

  it("locks the storefront order before claiming a pending payment as PAID", async () => {
    const order = await createOrder("paid-transition");
    const reservation = await createReservation("paid-transition", {
      storeOrderNumber: order.orderNumber,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const payment = await createPayment("paid-transition", {
      reservationId: reservation,
      orderId: order.id,
    });
    const app = buildApp();
    const orderBarrier = await pool.connect();
    const observer = await pool.connect();
    await orderBarrier.query("BEGIN");
    let responsePromise: Promise<{ status: number }> | undefined;
    try {
      await orderBarrier.query("SELECT id FROM store_orders WHERE id = $1 FOR UPDATE", [order.id]);
      const [{ pid }] = (await orderBarrier.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows;
      responsePromise = request(app).patch(`/api/payments/${payment}`)
        .send({ status: PAYMENT_STATUS.PAID, paidAt: new Date().toISOString() })
        .then(({ status }) => ({ status }));
      await waitForBlockedQuery(pid, (query) =>
        query.includes("store_orders") && query.includes("for update"),
      );

      // While the PAID transition is blocked at its first (order) lock, neither
      // the payment nor its reservation may already be held by the route.
      await observer.query("BEGIN");
      await observer.query("SELECT id FROM payments WHERE id = $1 FOR UPDATE NOWAIT", [payment]);
      await observer.query("SELECT id FROM reservations WHERE id = $1 FOR UPDATE NOWAIT", [reservation]);
      await observer.query("ROLLBACK");

      const [unchanged] = await db.select({ status: paymentsTable.status })
        .from(paymentsTable).where(eq(paymentsTable.id, payment));
      expect(unchanged?.status).toBe(PAYMENT_STATUS.PENDING);
      await orderBarrier.query("COMMIT");
      expect((await responsePromise).status).toBe(200);
    } finally {
      await observer.query("ROLLBACK").catch(() => undefined);
      await orderBarrier.query("ROLLBACK").catch(() => undefined);
      observer.release();
      orderBarrier.release();
    }

    const [confirmed] = await db.select({ status: paymentsTable.status })
      .from(paymentsTable).where(eq(paymentsTable.id, payment));
    expect(confirmed?.status).toBe(PAYMENT_STATUS.PAID);
  });

  it("rejects a stale PAID locator after the order closes and the receipt is refunded under its lock", async () => {
    const suffix = "stale-locator-cancelled-order";
    const order = await createOrder(suffix);
    const reservation = await createReservation(suffix, {
      storeOrderNumber: order.orderNumber,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const payment = await createPayment(suffix, {
      reservationId: reservation,
      orderId: order.id,
      status: PAYMENT_STATUS.PAID,
    });
    const app = buildApp();
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    let responsePromise: Promise<{ status: number; body: { code?: string } }> | undefined;
    try {
      await blocker.query("SELECT id FROM store_orders WHERE id = $1 FOR UPDATE", [order.id]);
      const [{ pid }] = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows;
      responsePromise = request(app).patch(`/api/payments/${payment}`)
        .send({ status: PAYMENT_STATUS.PAID })
        .then(({ status, body }) => ({ status, body }));
      await waitForBlockedQuery(pid, (query) =>
        query.includes("store_orders") && query.includes("for update"),
      );

      await blocker.query(`
        UPDATE store_orders
        SET status = 'cancelled', payment_status = 'refunded'
        WHERE id = $1
      `, [order.id]);
      await blocker.query(`
        UPDATE payments SET status = 'refunded', paid_at = now()
        WHERE id = $1
      `, [payment]);
      await blocker.query("COMMIT");

      const response = await responsePromise;
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("ORDER_CLOSED");
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }

    const [storedOrder] = await db.select({
      status: storeOrdersTable.status,
      paymentStatus: storeOrdersTable.paymentStatus,
    }).from(storeOrdersTable).where(eq(storeOrdersTable.id, order.id));
    const [storedPayment] = await db.select({ status: paymentsTable.status })
      .from(paymentsTable).where(eq(paymentsTable.id, payment));
    expect(storedOrder).toEqual({ status: "cancelled", paymentStatus: "refunded" });
    expect(storedPayment?.status).toBe(PAYMENT_STATUS.REFUNDED);
  });

  it("does not wait on the reservation for an idempotent PAID PATCH on an open order", async () => {
    const suffix = "paid-idempotent-open-order";
    const order = await createOrder(suffix);
    const reservation = await createReservation(suffix, {
      storeOrderNumber: order.orderNumber,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const payment = await createPayment(suffix, {
      reservationId: reservation,
      orderId: order.id,
      status: PAYMENT_STATUS.PAID,
    });
    const app = buildApp();
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    let responsePromise: Promise<{ status: number }> | undefined;
    try {
      await blocker.query("SELECT id FROM reservations WHERE id = $1 FOR UPDATE", [reservation]);
      responsePromise = request(app).patch(`/api/payments/${payment}`)
        .send({ status: PAYMENT_STATUS.PAID })
        .then(({ status }) => ({ status }));
      await expectRequestFinishesWhileReservationLocked(responsePromise);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    if (responsePromise) await responsePromise;

    const [storedPayment] = await db.select({ status: paymentsTable.status })
      .from(paymentsTable).where(eq(paymentsTable.id, payment));
    expect(storedPayment?.status).toBe(PAYMENT_STATUS.PAID);
  });

  it("does not deadlock deleting one of two paid payments against an idempotent PAID PATCH", async () => {
    const reservation = await createReservation("delete-patch");
    const deletedPayment = await createPayment("delete-patch-a", {
      reservationId: reservation,
      status: PAYMENT_STATUS.PAID,
    });
    const survivingPayment = await createPayment("delete-patch-b", {
      reservationId: reservation,
      status: PAYMENT_STATUS.PAID,
    });
    const app = buildApp();
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    let deletionPromise: Promise<{ status: number }> | undefined;
    try {
      await blocker.query("SELECT id FROM reservations WHERE id = $1 FOR UPDATE", [reservation]);
      const [{ pid }] = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows;
      deletionPromise = request(app).delete(`/api/payments/${deletedPayment}`)
        .then(({ status }) => ({ status }));
      // Ensure DELETE has acquired its transaction and is waiting on the locked
      // reservation before starting the idempotent PATCH on the other receipt.
      await waitForBlockedQuery(pid, (query) =>
        query.includes("reservations") && query.includes("for update"),
      );
      const patchPromise = request(app).patch(`/api/payments/${survivingPayment}`)
        .send({ status: PAYMENT_STATUS.PAID })
        .then(({ status }) => ({ status }));
      await expectRequestFinishesWhileReservationLocked(patchPromise);
      await blocker.query("COMMIT");
      expect((await deletionPromise).status).toBe(200);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }

    const remaining = await db.select({
      id: paymentsTable.id,
      status: paymentsTable.status,
    }).from(paymentsTable).where(and(
      eq(paymentsTable.tenantId, TENANT_ID),
      eq(paymentsTable.reservationId, reservation),
    ));
    expect(remaining).toEqual([{ id: survivingPayment, status: PAYMENT_STATUS.PAID }]);
  });

  it("revalidates a received payment against the new balance after waiting for a total change", async () => {
    const reservation = await createReservation("payment-balance-race", {
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const blocker = await pool.connect();

    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM reservations WHERE id = $1 FOR UPDATE", [reservation]);
      const [{ pid }] = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows;
      const app = buildApp();
      const paymentPromise = request(app).post("/api/payments").send({
        reservationId: reservation,
        type: PAYMENT_TYPE.RECEIVABLE,
        category: "reservation",
        amount: 75,
        paymentMethod: "pix",
        dueDate: new Date().toISOString(),
        status: PAYMENT_STATUS.PAID,
        paidAt: new Date().toISOString(),
      });

      const barrier = waitForBlockedQuery(pid, (query) =>
        query.includes("reservations") && query.includes("for update"),
      ).then(
        () => ({ kind: "blocked" as const }),
        (error) => ({ kind: "timeout" as const, error }),
      );
      const firstOutcome = await Promise.race([
        barrier,
        paymentPromise.then((response) => ({ kind: "response" as const, response })),
      ]);
      if (firstOutcome.kind === "response") {
        throw new Error(
          `Payment request finished before acquiring the reservation lock: ${firstOutcome.response.status} ${JSON.stringify(firstOutcome.response.body)}`,
        );
      }
      if (firstOutcome.kind === "timeout") {
        throw new Error(
          `${String(firstOutcome.error)}; PostgreSQL pool total=${pool.totalCount}, idle=${pool.idleCount}, waiting=${pool.waitingCount}`,
        );
      }
      await blocker.query(
        "UPDATE reservations SET total_value = $1, balance = $2 WHERE id = $3 AND tenant_id = $4",
        ["50.00", "50.00", reservation, TENANT_ID],
      );
      await blocker.query("COMMIT");

      const response = await paymentPromise;
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("PAYMENT_EXCEEDS_BALANCE");
      expect(response.body.message).toContain("saldo devedor");
      const storedPayments = await db.select({ id: paymentsTable.id })
        .from(paymentsTable).where(and(
          eq(paymentsTable.tenantId, TENANT_ID),
          eq(paymentsTable.reservationId, reservation),
        ));
      expect(storedPayments).toEqual([]);
      const [updatedReservation] = await db.select({
        totalValue: reservationsTable.totalValue,
        balance: reservationsTable.balance,
      }).from(reservationsTable).where(eq(reservationsTable.id, reservation));
      expect(Number(updatedReservation?.totalValue)).toBe(50);
      expect(Number(updatedReservation?.balance)).toBe(50);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
  });

  it("rejects marking an existing payment paid when the reservation total changes while it waits", async () => {
    const reservation = await createReservation("patch-balance-race", {
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const priorPayment = await createPayment("patch-balance-prior", {
      reservationId: reservation,
      status: PAYMENT_STATUS.PAID,
    });
    await db.update(paymentsTable)
      .set({ amount: "40.00" })
      .where(eq(paymentsTable.id, priorPayment));
    const payment = await createPayment("patch-balance-pending", { reservationId: reservation });
    await db.update(paymentsTable)
      .set({ amount: "55.00" })
      .where(and(
        eq(paymentsTable.id, payment),
        eq(paymentsTable.tenantId, TENANT_ID),
      ));

    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM reservations WHERE id = $1 FOR UPDATE", [reservation]);
      const [{ pid }] = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows;
      const paymentPromise = request(buildApp()).patch(`/api/payments/${payment}`).send({
        status: PAYMENT_STATUS.PAID,
        paidAt: new Date().toISOString(),
      });

      const barrier = waitForBlockedQuery(pid, (query) =>
        query.includes("reservations") && query.includes("for update"),
      ).then(
        () => ({ kind: "blocked" as const }),
        (error) => ({ kind: "timeout" as const, error }),
      );
      const firstOutcome = await Promise.race([
        barrier,
        paymentPromise.then((response) => ({ kind: "response" as const, response })),
      ]);
      if (firstOutcome.kind === "response") {
        throw new Error(
          `Payment status update finished before acquiring the reservation lock: ${firstOutcome.response.status} ${JSON.stringify(firstOutcome.response.body)}`,
        );
      }
      if (firstOutcome.kind === "timeout") {
        throw new Error(
          `${String(firstOutcome.error)}; PostgreSQL pool total=${pool.totalCount}, idle=${pool.idleCount}, waiting=${pool.waitingCount}`,
        );
      }

      await blocker.query(
        "UPDATE reservations SET total_value = $1, balance = $2 WHERE id = $3 AND tenant_id = $4",
        ["90.00", "50.00", reservation, TENANT_ID],
      );
      await blocker.query("COMMIT");

      const response = await paymentPromise;
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("PAYMENT_EXCEEDS_BALANCE");
      expect(response.body.message).toContain("saldo devedor");
      const [storedPayment] = await db.select({
        status: paymentsTable.status,
        amount: paymentsTable.amount,
      }).from(paymentsTable).where(and(
        eq(paymentsTable.id, payment),
        eq(paymentsTable.tenantId, TENANT_ID),
      ));
      expect(storedPayment).toEqual({
        status: PAYMENT_STATUS.PENDING,
        amount: "55.00",
      });
      const [updatedReservation] = await db.select({
        totalValue: reservationsTable.totalValue,
        balance: reservationsTable.balance,
      }).from(reservationsTable).where(eq(reservationsTable.id, reservation));
      expect(Number(updatedReservation?.totalValue)).toBe(90);
      expect(Number(updatedReservation?.balance)).toBe(50);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
  });

  it("only accepts one of two simultaneous payments that exceed the reservation balance together", async () => {
    const order = await createOrder("patch-competing-order");
    const reservation = await createReservation("patch-competing-payments", {
      storeOrderNumber: order.orderNumber,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const firstPayment = await createPayment("patch-competing-first", { reservationId: reservation });
    const secondPayment = await createPayment("patch-competing-second", { reservationId: reservation });
    await db.update(paymentsTable)
      .set({ amount: "60.00" })
      .where(and(
        eq(paymentsTable.tenantId, TENANT_ID),
        eq(paymentsTable.id, firstPayment),
      ));
    await db.update(paymentsTable)
      .set({ amount: "60.00" })
      .where(and(
        eq(paymentsTable.tenantId, TENANT_ID),
        eq(paymentsTable.id, secondPayment),
      ));

    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM reservations WHERE id = $1 FOR UPDATE", [reservation]);
      const [{ pid }] = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows;
      const app = buildApp();
      const firstResponsePromise = request(app).patch(`/api/payments/${firstPayment}`).send({
        status: PAYMENT_STATUS.PAID,
        paidAt: new Date().toISOString(),
      }).then((response) => response);
      const secondResponsePromise = request(app).patch(`/api/payments/${secondPayment}`).send({
        status: PAYMENT_STATUS.PAID,
        paidAt: new Date().toISOString(),
      }).then((response) => response);

      const barrier = waitForBlockedQuery(
        pid,
        (query) =>
          query.includes("for update")
          && (query.includes("reservations") || query.includes("store_orders")),
        2,
      ).then(
        () => ({ kind: "both-blocked" as const }),
        (error) => ({ kind: "timeout" as const, error }),
      );
      const firstOutcome = await Promise.race([
        barrier,
        firstResponsePromise.then((response) => ({
          kind: "response" as const,
          request: "first",
          response,
        })),
        secondResponsePromise.then((response) => ({
          kind: "response" as const,
          request: "second",
          response,
        })),
      ]);
      if (firstOutcome.kind === "response") {
        throw new Error(
          `Payment ${firstOutcome.request} finished before both requests reached the reservation lock: ${firstOutcome.response.status} ${JSON.stringify(firstOutcome.response.body)}`,
        );
      }
      if (firstOutcome.kind === "timeout") {
        throw new Error(
          `${String(firstOutcome.error)}; PostgreSQL pool total=${pool.totalCount}, idle=${pool.idleCount}, waiting=${pool.waitingCount}`,
        );
      }

      await blocker.query("COMMIT");
      const [firstResponse, secondResponse] = await Promise.all([
        firstResponsePromise,
        secondResponsePromise,
      ]);
      const responses = [firstResponse, secondResponse];
      expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
      const rejectedResponses = responses.filter((response) => response.status === 400);
      expect(rejectedResponses).toHaveLength(1);
      expect(rejectedResponses[0]?.body.code).toBe("PAYMENT_EXCEEDS_BALANCE");

      const storedPayments = await db.select({
        status: paymentsTable.status,
        amount: paymentsTable.amount,
      }).from(paymentsTable).where(and(
        eq(paymentsTable.tenantId, TENANT_ID),
        eq(paymentsTable.reservationId, reservation),
      ));
      const paidPayments = storedPayments.filter((payment) => payment.status === PAYMENT_STATUS.PAID);
      const totalPaid = paidPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      expect(paidPayments).toHaveLength(1);
      expect(storedPayments.filter((payment) => payment.status === PAYMENT_STATUS.PENDING)).toHaveLength(1);
      expect(totalPaid).toBe(60);
      const [storedReservation] = await db.select({
        totalValue: reservationsTable.totalValue,
      }).from(reservationsTable).where(and(
        eq(reservationsTable.id, reservation),
        eq(reservationsTable.tenantId, TENANT_ID),
      ));
      expect(totalPaid).toBeLessThanOrEqual(Number(storedReservation?.totalValue));
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
  });
});

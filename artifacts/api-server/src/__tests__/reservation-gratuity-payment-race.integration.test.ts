import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditLogsTable,
  clientsTable,
  commissionsTable,
  db,
  paymentsTable,
  pool,
  reservationsTable,
  tenantsTable,
  tripsTable,
  usersTable,
} from "@workspace/db";
import {
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  RESERVATION_STATUS,
  ROLES,
} from "@workspace/permissions";

const { mockRequireAuth } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin", "agency_admin"],
  MANAGEMENT_ROLES: ["admin", "agency_admin", "gerente"],
  ALL_STAFF_ROLES: ["admin", "agency_admin", "gerente", "vendedor"],
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
    syncTrips: vi.fn().mockResolvedValue(undefined),
    syncPayment: vi.fn().mockResolvedValue(undefined),
    syncTripOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/trip-overlap-notify.js", () => ({
  detectAndNotifyTripOverlap: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/client-notifications.js", () => ({
  insertClientNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/push-notifications.js", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/loyalty-helpers.js", () => ({
  loyaltyAwardPoints: vi.fn().mockResolvedValue(undefined),
  loyaltyAwardPointsForReservation: vi.fn().mockResolvedValue(undefined),
  loyaltyReverseEarnedPoints: vi.fn().mockResolvedValue(undefined),
  calculateTier: vi.fn().mockReturnValue("bronze"),
}));

vi.mock("../queues/commission-sync-helper.js", () => ({
  enqueueCommissionSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralReversedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppReservationConfirmed: vi.fn().mockResolvedValue(undefined),
  dispatchWhatsAppCadastroRealizado: vi.fn().mockResolvedValue(undefined),
  dispatchWhatsAppPaymentReceived: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
  cancelDealOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/pipeline-deal-sync.js", () => ({
  syncClientDeal: vi.fn().mockResolvedValue(undefined),
}));

import { errorHandler } from "../middlewares/errorHandler.js";
import paymentsRouter from "../routes/payments.js";
import reservationsRouter from "../routes/reservations.js";

const REQUIRED_TEST_DATABASE = "visitecrm_gratuity_race_test";
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const TENANT_ID = `grace-tenant-${RUN}`;
const USER_ID = `grace-user-${RUN}`;

type RaceFixture = {
  clientId: string;
  tripId: string;
  reservationId: string;
  paymentId: string;
};

const gratuityWinsFixture: RaceFixture = {
  clientId: `grace-client-g-${RUN}`,
  tripId: `grace-trip-g-${RUN}`,
  reservationId: `grace-res-g-${RUN}`,
  paymentId: `grace-pay-g-${RUN}`,
};

const paymentWinsFixture: RaceFixture = {
  clientId: `grace-client-p-${RUN}`,
  tripId: `grace-trip-p-${RUN}`,
  reservationId: `grace-res-p-${RUN}`,
  paymentId: `grace-pay-p-${RUN}`,
};

type ApiBody = {
  code?: string;
  isGratuidade?: boolean;
  status?: string;
};

type ApiResponse = {
  status: number;
  body: ApiBody;
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const noop = () => {};
  (req as unknown as Record<string, unknown>).log = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
  (req as unknown as Record<string, unknown>).id = "gratuity-payment-race-test";
  next();
});
app.use("/api", reservationsRouter);
app.use("/api", paymentsRouter);
app.use(errorHandler);

async function assertIsolatedDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must point to the isolated gratuity race test database");
  }
  const { rows } = await pool.query<{
    database_name: string;
    server_address: string | null;
  }>(`
    SELECT
      current_database() AS database_name,
      host(inet_server_addr()) AS server_address
  `);
  const database = rows[0];
  const isCITestDatabase =
    process.env.CI === "true" && database?.database_name === "visitecrm_ci";
  const isLocalLoopback =
    database?.server_address === "127.0.0.1" || database?.server_address === "::1";
  if (
    (database?.database_name !== REQUIRED_TEST_DATABASE && !isCITestDatabase) ||
    !isLocalLoopback
  ) {
    throw new Error(
      `Refusing to run gratuity/payment race test outside an isolated local test database`,
    );
  }
}

async function insertRaceFixture(fixture: RaceFixture) {
  await db.insert(clientsTable).values({
    id: fixture.clientId,
    tenantId: TENANT_ID,
    name: `Gratuity race ${fixture.clientId}`,
    email: `${fixture.clientId}@example.test`,
    whatsapp: "+5585999999999",
    createdById: USER_ID,
  });

  await db.insert(tripsTable).values({
    id: fixture.tripId,
    tenantId: TENANT_ID,
    name: "Gratuity/payment race test trip",
    slug: fixture.tripId,
    destination: "Test destination",
    destinationCity: "Juazeiro do Norte",
    destinationState: "CE",
    type: "excursao",
    category: "standard",
    departureDate: new Date("2027-02-10T12:00:00.000Z"),
    totalCapacity: 20,
    availableSeats: 20,
    reservedSeats: 0,
    priceAdult: "120.00",
    createdById: USER_ID,
  });

  await db.insert(reservationsTable).values({
    id: fixture.reservationId,
    tenantId: TENANT_ID,
    tripId: fixture.tripId,
    clientId: fixture.clientId,
    createdById: USER_ID,
    status: RESERVATION_STATUS.CONFIRMED,
    totalValue: "120.00",
    gratuityAmount: "0.00",
    paidValue: "0.00",
    balance: "120.00",
    isGratuidade: false,
    seats: [],
    capacityUnits: 0,
    tripType: "excursao",
    voucherCode: `GRACE-${fixture.reservationId}`,
    qrCode: `QR-${fixture.reservationId}`,
  });

  await db.insert(paymentsTable).values({
    id: fixture.paymentId,
    tenantId: TENANT_ID,
    reservationId: fixture.reservationId,
    clientId: fixture.clientId,
    type: PAYMENT_TYPE.RECEIVABLE,
    category: "reservation",
    amount: "40.00",
    paymentMethod: "pix",
    dueDate: new Date("2027-01-01T12:00:00.000Z"),
    status: PAYMENT_STATUS.PENDING,
    description: "Pending payment for gratuity/payment race test",
  });
}

function patchGratuity(reservationId: string): Promise<ApiResponse> {
  return request(app)
    .patch(`/api/reservations/${reservationId}`)
    .send({ isGratuidade: true })
    .then((response) => ({
      status: response.status,
      body: response.body as ApiBody,
    }));
}

function approvePayment(paymentId: string): Promise<ApiResponse> {
  return request(app)
    .patch(`/api/payments/${paymentId}`)
    .send({ status: PAYMENT_STATUS.APPROVED })
    .then((response) => ({
      status: response.status,
      body: response.body as ApiBody,
    }));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitForBlockedSessions(blockingPid: number, expectedCount: number) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ blocked_count: number }>(`
      WITH RECURSIVE waiters AS (
        SELECT
          activity.pid,
          pg_blocking_pids(activity.pid) AS blockers
        FROM pg_stat_activity activity
        WHERE activity.datname = current_database()
          AND activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
      ),
      reaches_fixture_blocker(pid, chain) AS (
        SELECT waiter.pid, ARRAY[waiter.pid]::integer[]
        FROM waiters waiter
        WHERE $1 = ANY(waiter.blockers)
        UNION ALL
        SELECT waiter.pid, parent.chain || waiter.pid
        FROM waiters waiter
        JOIN reaches_fixture_blocker parent
          ON parent.pid = ANY(waiter.blockers)
        WHERE NOT waiter.pid = ANY(parent.chain)
      )
      SELECT COUNT(DISTINCT pid)::integer AS blocked_count
      FROM reaches_fixture_blocker
    `, [blockingPid]);
    if ((rows[0]?.blocked_count ?? 0) >= expectedCount) return;
    await delay(10);
  }

  const { rows } = await pool.query(`
    SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers, left(query, 240) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
  `);
  throw new Error(
    `Timed out waiting for ${expectedCount} route request(s) behind reservation lock ${blockingPid}: ${JSON.stringify(rows)}`,
  );
}

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runControlledRace(
  fixture: RaceFixture,
  firstWinner: "gratuity" | "payment",
) {
  const blocker = await pool.connect();
  let transactionOpen = false;
  const pendingRequests: Promise<unknown>[] = [];
  let gratuityRequest: Promise<ApiResponse> | undefined;
  let paymentRequest: Promise<ApiResponse> | undefined;

  try {
    await blocker.query("BEGIN");
    transactionOpen = true;
    const locked = await blocker.query(
      "SELECT id FROM reservations WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
      [fixture.reservationId, TENANT_ID],
    );
    if (locked.rowCount !== 1) {
      throw new Error(`Could not lock race fixture reservation ${fixture.reservationId}`);
    }
    const { rows } = await blocker.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const blockingPid = Number(rows[0]?.pid);

    if (firstWinner === "gratuity") {
      gratuityRequest = patchGratuity(fixture.reservationId);
      pendingRequests.push(gratuityRequest);
      await waitForBlockedSessions(blockingPid, 1);
      paymentRequest = approvePayment(fixture.paymentId);
      pendingRequests.push(paymentRequest);
    } else {
      paymentRequest = approvePayment(fixture.paymentId);
      pendingRequests.push(paymentRequest);
      await waitForBlockedSessions(blockingPid, 1);
      gratuityRequest = patchGratuity(fixture.reservationId);
      pendingRequests.push(gratuityRequest);
    }

    await waitForBlockedSessions(blockingPid, 2);
    await blocker.query("COMMIT");
    transactionOpen = false;

    if (!gratuityRequest || !paymentRequest) {
      throw new Error("Both race requests must be started before releasing the lock");
    }
    const [gratuityResponse, paymentResponse] = await withTimeout(
      Promise.all([gratuityRequest, paymentRequest]),
      "Gratuity/payment race requests did not complete after releasing the reservation lock",
    );
    return { gratuityResponse, paymentResponse };
  } finally {
    if (transactionOpen) {
      await blocker.query("ROLLBACK").catch(() => undefined);
    }
    blocker.release();
    if (pendingRequests.length > 0) {
      await Promise.race([
        Promise.allSettled(pendingRequests),
        delay(2_000),
      ]);
    }
  }
}

async function readStoredState(fixture: RaceFixture) {
  const [reservation] = await db.select({
    isGratuidade: reservationsTable.isGratuidade,
    totalValue: reservationsTable.totalValue,
    paidValue: reservationsTable.paidValue,
  }).from(reservationsTable)
    .where(eq(reservationsTable.id, fixture.reservationId))
    .limit(1);
  const [payment] = await db.select({
    status: paymentsTable.status,
    amount: paymentsTable.amount,
  }).from(paymentsTable)
    .where(eq(paymentsTable.id, fixture.paymentId))
    .limit(1);
  return { reservation, payment };
}

async function expectNoActiveReceivableForFreeReservation(fixture: RaceFixture) {
  const activePayments = await db.select({ id: paymentsTable.id })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.tenantId, TENANT_ID),
      eq(paymentsTable.reservationId, fixture.reservationId),
      eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE),
      inArray(paymentsTable.status, [
        PAYMENT_STATUS.PENDING,
        PAYMENT_STATUS.OVERDUE,
        PAYMENT_STATUS.APPROVED,
        PAYMENT_STATUS.PAID,
      ]),
    ));
  expect(activePayments).toHaveLength(0);
}

describe("gratuity conversion racing a pending payment approval (PostgreSQL)", () => {
  beforeAll(async () => {
    await assertIsolatedDatabase();
    mockRequireAuth.mockResolvedValue({
      id: USER_ID,
      tenantId: TENANT_ID,
      role: ROLES.AGENCY_ADMIN,
      name: "Race test admin",
      email: `admin-${RUN}@example.test`,
    });

    await db.insert(tenantsTable).values({
      id: TENANT_ID,
      name: "Gratuity race test tenant",
      slug: `grace-${RUN}`,
      email: `tenant-${RUN}@example.test`,
    });
    await db.insert(usersTable).values({
      id: USER_ID,
      clerkId: `grace-clerk-${RUN}`,
      tenantId: TENANT_ID,
      name: "Gratuity race test admin",
      email: `admin-${RUN}@example.test`,
      role: ROLES.AGENCY_ADMIN,
      referralCode: `GRACE${RUN.toUpperCase()}`,
    });
    await insertRaceFixture(gratuityWinsFixture);
    await insertRaceFixture(paymentWinsFixture);
  });

  afterAll(async () => {
    const reservationIds = [
      gratuityWinsFixture.reservationId,
      paymentWinsFixture.reservationId,
    ];
    await db.delete(auditLogsTable)
      .where(eq(auditLogsTable.tenantId, TENANT_ID));
    await db.delete(commissionsTable)
      .where(inArray(commissionsTable.reservationId, reservationIds));
    await db.delete(paymentsTable)
      .where(eq(paymentsTable.tenantId, TENANT_ID));
    await db.delete(reservationsTable)
      .where(eq(reservationsTable.tenantId, TENANT_ID));
    await db.delete(tripsTable)
      .where(eq(tripsTable.tenantId, TENANT_ID));
    await db.delete(clientsTable)
      .where(eq(clientsTable.tenantId, TENANT_ID));
    await db.delete(usersTable)
      .where(eq(usersTable.tenantId, TENANT_ID));
    await db.delete(tenantsTable)
      .where(eq(tenantsTable.id, TENANT_ID));
  });

  it("lets gratuity win, rejects the approval, and cancels the pending receivable", async () => {
    const { gratuityResponse, paymentResponse } = await runControlledRace(
      gratuityWinsFixture,
      "gratuity",
    );

    expect(gratuityResponse.status).toBe(200);
    expect(gratuityResponse.body.isGratuidade).toBe(true);
    expect(paymentResponse.status).toBe(409);
    expect(paymentResponse.body.code).toBe("GRATUITY_PAYMENT_FORBIDDEN");

    const { reservation, payment } = await readStoredState(gratuityWinsFixture);
    expect(reservation?.isGratuidade).toBe(true);
    expect(payment?.status).toBe(PAYMENT_STATUS.CANCELLED);
    await expectNoActiveReceivableForFreeReservation(gratuityWinsFixture);
  }, 15_000);

  it("lets payment approval win, rejects gratuity, and preserves the approved payment", async () => {
    const { gratuityResponse, paymentResponse } = await runControlledRace(
      paymentWinsFixture,
      "payment",
    );

    expect(paymentResponse.status).toBe(200);
    expect(paymentResponse.body.status).toBe(PAYMENT_STATUS.APPROVED);
    expect(gratuityResponse.status).toBe(409);
    expect(gratuityResponse.body.code).toBe("GRATUITY_HAS_PAYMENTS");

    const { reservation, payment } = await readStoredState(paymentWinsFixture);
    expect(reservation?.isGratuidade).toBe(false);
    expect(payment).toMatchObject({
      status: PAYMENT_STATUS.APPROVED,
      amount: "40.00",
    });
  }, 15_000);
});
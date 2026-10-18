import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  clientsTable,
  db,
  passengersTable,
  pool,
  reservationsTable,
  storesTable,
  storeOrderItemsTable,
  storeOrdersTable,
  storeProductsTable,
  tenantsTable,
  tripsTable,
  usersTable,
} from "@workspace/db";
import { RESERVATION_STATUS, ROLES } from "@workspace/permissions";

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

vi.mock("../services/client-financials.js", () => ({
  recalculateClientFinancials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/checkout/storefront-pipeline.js", () => ({
  getStorefrontInitialPipelineStage: vi.fn().mockResolvedValue(null),
}));

import { errorHandler } from "../middlewares/errorHandler.js";
import reservationsRouter from "../routes/reservations.js";
import { createReservationsForOrder } from "../services/checkout/create-reservations.js";

const REQUIRED_TEST_DATABASE = "visitecrm_test";
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const TENANT_ID = `manual-checkout-race-tenant-${RUN}`;
const USER_ID = `manual-checkout-race-user-${RUN}`;
const TRIP_ID = `manual-checkout-race-trip-${RUN}`;
const EXISTING_CLIENT_ID = `manual-checkout-race-existing-client-${RUN}`;
const MANUAL_CLIENT_ID = `manual-checkout-race-manual-client-${RUN}`;
const CHECKOUT_CLIENT_ID = `manual-checkout-race-checkout-client-${RUN}`;
const STORE_ID = `manual-checkout-race-store-${RUN}`;
const PRODUCT_ID = `manual-checkout-race-product-${RUN}`;
const ORDER_ID = `manual-checkout-race-order-${RUN}`;
const ORDER_NUMBER = `ORD-MANUAL-CHECKOUT-RACE-${RUN}`;
const EXISTING_RESERVATION_ID = `manual-checkout-race-existing-res-${RUN}`;

type ManualResponse = {
  status: number;
  body: { code?: string; id?: string };
};

type CheckoutOutcome =
  | {
      kind: "fulfilled";
      value: Awaited<ReturnType<typeof createReservationsForOrder>>;
    }
  | { kind: "rejected"; reason: unknown };

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
  (req as unknown as Record<string, unknown>).id = "manual-checkout-capacity-race";
  next();
});
app.use("/api", reservationsRouter);
app.use(errorHandler);

async function assertIsolatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must point to an isolated local test database");
  }
  const { rows } = await pool.query<{
    database_name: string;
    server_address: string | null;
  }>(`
    SELECT current_database() AS database_name,
           host(inet_server_addr()) AS server_address
  `);
  const database = rows[0];
  const configuredHost = new URL(databaseUrl)
    .hostname.replace(/^\[|\]$/g, "")
    .toLowerCase();
  const isCITestDatabase =
    process.env.CI === "true" &&
    database?.database_name === "visitecrm_ci" &&
    ["localhost", "127.0.0.1", "::1"].includes(configuredHost);
  const isLocalLoopback =
    database?.server_address === "127.0.0.1" ||
    database?.server_address === "::1";
  const isIsolatedDeveloperDatabase =
    database?.database_name === REQUIRED_TEST_DATABASE && isLocalLoopback;

  if (!isIsolatedDeveloperDatabase && !isCITestDatabase) {
    throw new Error(
      "Refusing to run the manual/checkout capacity race outside an isolated local test database",
    );
  }
}

async function waitForBlockedSessions(blockingPid: number, expectedCount: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ blocked_count: number }>(`
      WITH RECURSIVE waiters AS (
        SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
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
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const { rows } = await pool.query(`
    SELECT pid, state, wait_event_type, wait_event,
           pg_blocking_pids(pid) AS blockers, left(query, 240) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
  `);
  throw new Error(
    `Timed out waiting for ${expectedCount} manual/checkout operations behind trip lock ${blockingPid}: ${JSON.stringify(rows)}`,
  );
}

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 10_000): Promise<T> {
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

async function seedFixtures() {
  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Manual/checkout capacity race test",
    slug: `manual-checkout-race-${RUN}`,
    email: `manual-checkout-race-${RUN}@example.test`,
  });
  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: `manual-checkout-race-clerk-${RUN}`,
    tenantId: TENANT_ID,
    name: "Manual/checkout race admin",
    email: `manual-checkout-race-admin-${RUN}@example.test`,
    role: ROLES.AGENCY_ADMIN,
    referralCode: `MCR${RUN.toUpperCase()}`,
  });
  await db.insert(clientsTable).values([
    {
      id: EXISTING_CLIENT_ID,
      tenantId: TENANT_ID,
      name: "Existing passenger",
      email: `existing-${RUN}@example.test`,
      whatsapp: "11999990001",
      createdById: USER_ID,
    },
    {
      id: MANUAL_CLIENT_ID,
      tenantId: TENANT_ID,
      name: "Manual reservation client",
      email: `manual-${RUN}@example.test`,
      whatsapp: "11999990002",
      createdById: USER_ID,
    },
    {
      id: CHECKOUT_CLIENT_ID,
      tenantId: TENANT_ID,
      name: "Store checkout client",
      email: `checkout-${RUN}@example.test`,
      whatsapp: "11999990003",
      createdById: USER_ID,
    },
  ]);
  await db.insert(storesTable).values({
    id: STORE_ID,
    tenantId: TENANT_ID,
    name: "Manual/checkout race store",
    slug: `manual-checkout-store-${RUN}`,
    email: `manual-checkout-store-${RUN}@example.test`,
  });
  await db.insert(tripsTable).values({
    id: TRIP_ID,
    tenantId: TENANT_ID,
    name: "Manual/checkout race trip",
    slug: `manual-checkout-trip-${RUN}`,
    destination: "Salvador, BA",
    destinationCity: "Salvador",
    destinationState: "BA",
    type: "excursao",
    category: "nacional",
    departureDate: new Date("2027-01-15T12:00:00.000Z"),
    totalCapacity: 2,
    availableSeats: 1,
    reservedSeats: 1,
    showSeatMap: true,
    seatMap: {
      "1": { status: "occupied" },
      "2": { status: "available" },
    },
    priceAdult: "150.00",
    createdById: USER_ID,
  });
  await db.insert(reservationsTable).values({
    id: EXISTING_RESERVATION_ID,
    tenantId: TENANT_ID,
    tripId: TRIP_ID,
    clientId: EXISTING_CLIENT_ID,
    createdById: USER_ID,
    status: RESERVATION_STATUS.PENDING,
    totalValue: "150.00",
    gratuityAmount: "0.00",
    paidValue: "0.00",
    balance: "150.00",
    isGratuidade: false,
    seats: ["1"],
    capacityUnits: 1,
    tripType: "excursao",
    voucherCode: `MCR-${RUN}`,
    reservationNumber: `RSV-MCR-${RUN}`,
    qrCode: `QR-MCR-${RUN}`,
  });
  await db.insert(passengersTable).values({
    id: `manual-checkout-race-passenger-${RUN}`,
    reservationId: EXISTING_RESERVATION_ID,
    name: "Existing passenger",
    ageCategory: "adult",
    isChildUnder7: false,
    seatNumber: "1",
    isPrimary: true,
  });
  await db.insert(storeProductsTable).values({
    id: PRODUCT_ID,
    storeId: STORE_ID,
    type: "trip",
    name: "Manual/checkout race trip",
    slug: `manual-checkout-product-${RUN}`,
    price: "150.00",
    tripId: TRIP_ID,
    status: "published",
  });
  await db.insert(storeOrdersTable).values({
    id: ORDER_ID,
    storeId: STORE_ID,
    tenantId: TENANT_ID,
    orderNumber: ORDER_NUMBER,
    clientId: CHECKOUT_CLIENT_ID,
    customerName: "Store checkout client",
    customerEmail: `checkout-${RUN}@example.test`,
    customerPhone: "11999990003",
    seats: ["2"],
    subtotal: "150.00",
    discountAmount: "0.00",
    taxAmount: "0.00",
    shippingAmount: "0.00",
    totalAmount: "150.00",
    paymentMethod: "pix",
    paymentProvider: "mercadopago",
    paymentStatus: "pending",
  });
  await db.insert(storeOrderItemsTable).values({
    id: `manual-checkout-race-item-${RUN}`,
    orderId: ORDER_ID,
    productId: PRODUCT_ID,
    productName: "Manual/checkout race trip",
    productType: "trip",
    price: "150.00",
    quantity: 1,
    subtotal: "150.00",
    discount: "0.00",
    total: "150.00",
  });
}

beforeAll(async () => {
  await assertIsolatedDatabase();
  mockRequireAuth.mockResolvedValue({
    id: USER_ID,
    tenantId: TENANT_ID,
    role: ROLES.AGENCY_ADMIN,
    name: "Manual/checkout race admin",
    email: `manual-checkout-race-admin-${RUN}@example.test`,
  });
  await seedFixtures();
});

afterAll(async () => {
  const reservationRows = await db.select({ id: reservationsTable.id })
    .from(reservationsTable)
    .where(eq(reservationsTable.tenantId, TENANT_ID));
  const reservationIds = reservationRows.map((row) => row.id);
  if (reservationIds.length > 0) {
    await db.delete(passengersTable)
      .where(inArray(passengersTable.reservationId, reservationIds));
    await db.delete(reservationsTable)
      .where(inArray(reservationsTable.id, reservationIds));
  }
  await db.delete(storeOrdersTable).where(eq(storeOrdersTable.tenantId, TENANT_ID));
  await db.delete(storeProductsTable).where(eq(storeProductsTable.id, PRODUCT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

describe("manual reservation racing storefront checkout capacity (PostgreSQL)", () => {
  it("lets only one path claim the last trip vacancy", async () => {
    const [beforeTrip] = await db.select({
      availableSeats: tripsTable.availableSeats,
      reservedSeats: tripsTable.reservedSeats,
    }).from(tripsTable).where(eq(tripsTable.id, TRIP_ID));
    expect(beforeTrip).toMatchObject({ availableSeats: 1, reservedSeats: 1 });

    const blocker = await pool.connect();
    let transactionOpen = false;
    const pendingOperations: Promise<unknown>[] = [];

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM trips WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
        [TRIP_ID, TENANT_ID],
      );
      const { rows } = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const blockingPid = Number(rows[0]?.pid);

      const manualOperation: Promise<ManualResponse> = request(app)
        .post("/api/reservations")
        .send({
          tripId: TRIP_ID,
          clientId: MANUAL_CLIENT_ID,
          seats: ["2"],
          totalValue: 150,
          paidValue: 0,
        })
        .then((response) => ({
          status: response.status,
          body: response.body as ManualResponse["body"],
        }));
      const checkoutOperation: Promise<CheckoutOutcome> =
        createReservationsForOrder(ORDER_ID).then(
          (value) => ({ kind: "fulfilled", value }),
          (reason: unknown) => ({ kind: "rejected", reason }),
        );
      pendingOperations.push(manualOperation, checkoutOperation);

      await waitForBlockedSessions(blockingPid, 2);
      await blocker.query("COMMIT");
      transactionOpen = false;

      const [manual, checkout] = await withTimeout(
        Promise.all([manualOperation, checkoutOperation]),
        "Manual reservation and checkout did not complete after releasing the trip lock",
      );

      const manualWon = manual.status === 201;
      const checkoutWon = checkout.kind === "fulfilled";
      expect([201, 409]).toContain(manual.status);
      expect(Number(manualWon) + Number(checkoutWon)).toBe(1);

      if (manualWon) {
        expect(manual.body.id).toBeTruthy();
        expect(checkout).toMatchObject({
          kind: "rejected",
          reason: { code: "INSUFFICIENT_SEATS" },
        });
      } else {
        expect(manual.body.code).toBe("RESERVATION_CONFLICT");
        expect(checkout).toMatchObject({ kind: "fulfilled" });
      }

      const committedRows = await db.select({
        id: reservationsTable.id,
        clientId: reservationsTable.clientId,
        storeOrderId: reservationsTable.storeOrderId,
        seats: reservationsTable.seats,
      }).from(reservationsTable).where(and(
        eq(reservationsTable.tenantId, TENANT_ID),
        eq(reservationsTable.tripId, TRIP_ID),
      ));
      const createdRows = committedRows.filter(
        (row) => row.id !== EXISTING_RESERVATION_ID,
      );
      expect(committedRows).toHaveLength(2);
      expect(createdRows).toHaveLength(1);
      expect(createdRows[0]?.seats).toEqual(["2"]);

      if (manualWon) {
        expect(createdRows[0]?.id).toBe(manual.body.id);
        expect(createdRows[0]?.clientId).toBe(MANUAL_CLIENT_ID);
      } else {
        expect(createdRows[0]?.clientId).toBe(CHECKOUT_CLIENT_ID);
        expect(createdRows[0]?.storeOrderId).toBe(ORDER_NUMBER);
        expect(checkout.kind === "fulfilled" ? checkout.value.reservationIds : [])
          .toContain(createdRows[0]?.id);
      }

      const passengerRows = await db.select({ id: passengersTable.id })
        .from(passengersTable)
        .where(eq(passengersTable.reservationId, createdRows[0]!.id));
      expect(passengerRows).toHaveLength(1);

      const [afterTrip] = await db.select({
        availableSeats: tripsTable.availableSeats,
        reservedSeats: tripsTable.reservedSeats,
      }).from(tripsTable).where(eq(tripsTable.id, TRIP_ID));
      expect(afterTrip).toMatchObject({ availableSeats: 0, reservedSeats: 2 });
    } finally {
      if (transactionOpen) {
        await blocker.query("ROLLBACK").catch(() => undefined);
      }
      blocker.release();
      if (pendingOperations.length > 0) {
        await Promise.race([
          Promise.allSettled(pendingOperations),
          new Promise((resolve) => setTimeout(resolve, 2_000)),
        ]);
      }
    }
  }, 15_000);
});

/**
 * Integration test: verifies the PostgreSQL unique constraint
 * `reservations_active_client_trip_unique` fires correctly when two concurrent
 * calls to `createReservationsForOrder` target the same client + trip.
 *
 * Unlike `checkout-race-condition.test.ts` (which mocks the DB layer and
 * injects a synthetic 23505 error), this test exercises the real database so
 * the actual partial unique index is evaluated by Postgres.
 *
 * The constraint definition (migration 0042):
 *   CREATE UNIQUE INDEX reservations_active_client_trip_unique
 *     ON reservations (tenant_id, client_id, trip_id)
 *     WHERE status NOT IN ('cancelled', 'refunded')
 *       AND client_id IS NOT NULL;
 *
 * Concurrency mechanism:
 *   Both calls run inside separate transactions that each acquire a FOR UPDATE
 *   lock on the trip row before inserting. Postgres serialises the two writers
 *   through the lock; the second transaction then attempts to insert a
 *   reservation for the same (tenantId, clientId, tripId) pair and hits 23505.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  tenantsTable,
  usersTable,
  storesTable,
  tripsTable,
  clientsTable,
  storeProductsTable,
  storeOrdersTable,
  storeOrderItemsTable,
  reservationsTable,
  passengersTable,
} from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";

import { generateId } from "../lib/id";
import { createReservationsForOrder } from "../services/checkout/create-reservations.js";

// ---------------------------------------------------------------------------
// Unique IDs scoped to this test run so parallel CI runs don't collide
// ---------------------------------------------------------------------------

const TENANT_ID = `test-race-tenant-${generateId()}`;
const USER_ID = `test-race-user-${generateId()}`;
const STORE_ID = `test-race-store-${generateId()}`;
const TRIP_ID = `test-race-trip-${generateId()}`;
const CLIENT_ID = `test-race-client-${generateId()}`;
const PRODUCT_ID = `test-race-product-${generateId()}`;

// Accumulators for cleanup — order matters (children before parents)
const reservationIds: string[] = [];
const orderIds: string[] = [];

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeOrderId() {
  return `test-race-order-${generateId()}`;
}

function makeOrderNumber() {
  return `ORD-RACE-${generateId()}`;
}

async function insertOrder(orderId: string, orderNumber: string) {
  await db.insert(storeOrdersTable).values({
    id: orderId,
    storeId: STORE_ID,
    tenantId: TENANT_ID,
    orderNumber,
    clientId: CLIENT_ID,
    customerName: "Maria Race",
    customerEmail: "maria.race@example.com",
    customerPhone: "11999999999",
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
    id: generateId(),
    orderId,
    productId: PRODUCT_ID,
    productName: "Excursão Race Test",
    productType: "trip",
    price: "150.00",
    quantity: 1,
    subtotal: "150.00",
    discount: "0.00",
    total: "150.00",
  });
}

// ---------------------------------------------------------------------------
// Set up: seed the minimal fixture rows once for all tests in this suite
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error(
      "DATABASE_URL must be set to run the checkout race-condition DB integration test",
    );
  }

  // Tenant
  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Race Condition Test Agency",
    slug: `race-test-${generateId()}`,
    email: `race-${generateId()}@example.com`,
  });

  // Agency user (needed by loadReservationContext → reservationCreatedById)
  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: `clerk-race-${generateId()}`,
    tenantId: TENANT_ID,
    name: "Race Test User",
    email: `race-user-${generateId()}@example.com`,
    referralCode: `RC-RACE-${generateId()}`,
    isActive: true,
  });

  // Store (required FK for store_orders)
  await db.insert(storesTable).values({
    id: STORE_ID,
    tenantId: TENANT_ID,
    name: "Race Test Store",
    slug: `race-store-${generateId()}`,
    email: `race-store-${generateId()}@example.com`,
  });

  // Trip with plenty of seats so capacity is never the bottleneck
  await db.insert(tripsTable).values({
    id: TRIP_ID,
    tenantId: TENANT_ID,
    name: "Race Test Trip",
    slug: `race-trip-${generateId()}`,
    destination: "Salvador, BA",
    destinationCity: "Salvador",
    destinationState: "BA",
    type: "excursao",
    category: "nacional",
    departureDate: new Date("2027-01-15"),
    totalCapacity: 50,
    availableSeats: 50,
    priceAdult: "150.00",
    createdById: USER_ID,
  });

  // CRM client pre-created so both orders share the same clientId.
  // If we left clientId null on the orders, both concurrent transactions would
  // attempt to upsert a client row at the same time; because there is no
  // unique constraint on (tenantId, email) in clientsTable, they might produce
  // two separate client rows and therefore two distinct (tenantId, clientId,
  // tripId) tuples — bypassing the unique index we want to exercise.
  await db.insert(clientsTable).values({
    id: CLIENT_ID,
    tenantId: TENANT_ID,
    name: "Maria Race",
    email: "maria.race@example.com",
    whatsapp: "11999999999",
    createdById: USER_ID,
  });

  // Store product linked to the trip
  await db.insert(storeProductsTable).values({
    id: PRODUCT_ID,
    storeId: STORE_ID,
    type: "trip",
    name: "Excursão Race Test",
    slug: `race-product-${generateId()}`,
    price: "150.00",
    tripId: TRIP_ID,
    status: "published",
  });
});

// ---------------------------------------------------------------------------
// Cleanup: remove all data seeded by this test run
// ---------------------------------------------------------------------------

afterAll(async () => {
  // Remove passengers before reservations (FK)
  if (reservationIds.length > 0) {
    await db.delete(passengersTable).where(
      inArray(passengersTable.reservationId, reservationIds),
    );
    await db.delete(reservationsTable).where(
      inArray(reservationsTable.id, reservationIds),
    );
  }

  // Remove orders (items cascade via FK)
  if (orderIds.length > 0) {
    await db.delete(storeOrdersTable).where(
      inArray(storeOrdersTable.id, orderIds),
    );
  }

  // store_products.trip_id → trips.id has no CASCADE, so remove products before trips.
  // storeProductsTable uses storeId which cascades from storesTable, but trips do not.
  await db.delete(storeProductsTable).where(eq(storeProductsTable.id, PRODUCT_ID));

  // Tenant cascade removes store, trip, client rows
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createReservationsForOrder — real DB unique-constraint guard", () => {
  it("fires PG 23505 on reservations_active_client_trip_unique when two concurrent orders target the same client + trip", async () => {
    const orderIdA = makeOrderId();
    const orderIdB = makeOrderId();
    const orderNumberA = makeOrderNumber();
    const orderNumberB = makeOrderNumber();

    orderIds.push(orderIdA, orderIdB);

    // Seed both orders before the concurrent race
    await insertOrder(orderIdA, orderNumberA);
    await insertOrder(orderIdB, orderNumberB);

    // Fire both createReservationsForOrder calls concurrently.
    // Each opens its own transaction and acquires a FOR UPDATE lock on the
    // trip row. Postgres serialises them through the lock; the second writer
    // then tries to INSERT a reservation row for the same
    // (tenant_id, client_id, trip_id) combination and gets 23505.
    const results = await Promise.allSettled([
      createReservationsForOrder(orderIdA),
      createReservationsForOrder(orderIdB),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one call should succeed and one should fail
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser must have been rejected with the 23505 constraint error.
    //
    // drizzle-orm v0.45+ wraps raw pg errors in a DrizzleQueryError:
    //   err.cause → the original node-postgres Error with .code / .constraint
    //
    // We verify the real Postgres constraint fired (not a synthetic mock).
    const rejectedErr = (rejected[0] as PromiseRejectedResult).reason as {
      code?: string;
      constraint?: string;
      cause?: { code?: string; constraint?: string };
    };

    // Normalise: accept the PG code either directly on the error (raw pg) or
    // on err.cause (wrapped DrizzleQueryError).
    const pgCode = rejectedErr.code ?? rejectedErr.cause?.code;
    const pgConstraint = rejectedErr.constraint ?? rejectedErr.cause?.constraint;

    expect(pgCode).toBe("23505");
    expect(pgConstraint).toBe("reservations_active_client_trip_unique");

    // Track the winning reservation so afterAll can clean it up
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ reservationIds: string[] }>).value;
    reservationIds.push(...winner.reservationIds);

    // Confirm the DB now contains exactly one active reservation for this client + trip
    const activeRows = await db
      .select({ id: reservationsTable.id })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.tenantId, TENANT_ID),
          eq(reservationsTable.clientId, CLIENT_ID),
          eq(reservationsTable.tripId, TRIP_ID),
        ),
      );

    expect(activeRows).toHaveLength(1);
  });
});

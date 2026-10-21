/**
 * PostgreSQL integration tests for checkout reservation concurrency and
 * capacity. They exercise `createReservationsForOrder` against the real DB,
 * including the `reservations_active_client_trip_unique` partial index,
 * passenger/seat persistence, and concurrent seat/capacity claims.
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
const LAP_CHILD_CLIENT_ID = `test-lap-child-client-${generateId()}`;
const SEATED_CHILD_CLIENT_ID = `test-seated-child-client-${generateId()}`;
const SEAT_RACE_CLIENT_ID_A = `test-seat-race-client-a-${generateId()}`;
const SEAT_RACE_CLIENT_ID_B = `test-seat-race-client-b-${generateId()}`;
const CAPACITY_RACE_CLIENT_ID_A = `test-capacity-race-client-a-${generateId()}`;
const CAPACITY_RACE_CLIENT_ID_B = `test-capacity-race-client-b-${generateId()}`;
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

type OrderFixtureOptions = {
  clientId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  quantity?: number;
  seats?: string[];
  coPassengers?: Array<{
    name: string;
    cpf?: string;
    phone?: string;
    isChildUnder7?: boolean;
    occupiesSeat?: boolean;
  }>;
};

async function insertOrder(
  orderId: string,
  orderNumber: string,
  options: OrderFixtureOptions = {},
) {
  const quantity = options.quantity ?? 1;
  const total = (150 * quantity).toFixed(2);
  await db.insert(storeOrdersTable).values({
    id: orderId,
    storeId: STORE_ID,
    tenantId: TENANT_ID,
    orderNumber,
    clientId: options.clientId ?? CLIENT_ID,
    customerName: options.customerName ?? "Maria Race",
    customerEmail: options.customerEmail ?? "maria.race@example.com",
    customerPhone: options.customerPhone ?? "11999999999",
    seats: options.seats ?? null,
    coPassengers: options.coPassengers ?? null,
    subtotal: total,
    discountAmount: "0.00",
    taxAmount: "0.00",
    shippingAmount: "0.00",
    totalAmount: total,
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
    quantity,
    subtotal: total,
    discount: "0.00",
    total,
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

  // Six-seat trip: the earlier scenarios use five capacity units, leaving one
  // vacancy for the final concurrent-capacity test.
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
    totalCapacity: 6,
    availableSeats: 6,
    showSeatMap: true,
    seatMap: {
      "1": { status: "available" },
      "2": { status: "available" },
      "3": { status: "available" },
      "4": { status: "available" },
      "5": { status: "available" },
      "6": { status: "available" },
    },
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
  await db.insert(clientsTable).values([
    {
      id: LAP_CHILD_CLIENT_ID,
      tenantId: TENANT_ID,
      name: "Ana Lap Test",
      email: `lap-child-${generateId()}@example.com`,
      whatsapp: "11999990001",
      createdById: USER_ID,
    },
    {
      id: SEATED_CHILD_CLIENT_ID,
      tenantId: TENANT_ID,
      name: "Bruno Seated Test",
      email: `seated-child-${generateId()}@example.com`,
      whatsapp: "11999990002",
      createdById: USER_ID,
    },
    {
      id: SEAT_RACE_CLIENT_ID_A,
      tenantId: TENANT_ID,
      name: "Carla Seat Race A",
      email: `seat-race-a-${generateId()}@example.com`,
      whatsapp: "11999990003",
      createdById: USER_ID,
    },
    {
      id: SEAT_RACE_CLIENT_ID_B,
      tenantId: TENANT_ID,
      name: "Diego Seat Race B",
      email: `seat-race-b-${generateId()}@example.com`,
      whatsapp: "11999990004",
      createdById: USER_ID,
    },
    {
      id: CAPACITY_RACE_CLIENT_ID_A,
      tenantId: TENANT_ID,
      name: "Elisa Capacity Race A",
      email: `capacity-race-a-${generateId()}@example.com`,
      whatsapp: "11999990005",
      createdById: USER_ID,
    },
    {
      id: CAPACITY_RACE_CLIENT_ID_B,
      tenantId: TENANT_ID,
      name: "Fabio Capacity Race B",
      email: `capacity-race-b-${generateId()}@example.com`,
      whatsapp: "11999990006",
      createdById: USER_ID,
    },
  ]);

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

describe("createReservationsForOrder — real DB reservation and capacity invariants", () => {
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

  it("keeps a lap child in the passenger manifest without consuming a seat or trip vacancy", async () => {
    const orderId = makeOrderId();
    orderIds.push(orderId);
    await insertOrder(orderId, makeOrderNumber(), {
      clientId: LAP_CHILD_CLIENT_ID,
      customerName: "Ana Lap Test",
      customerEmail: "ana.lap@example.com",
      seats: ["1"],
      coPassengers: [
        { name: "Lia Lap Test", isChildUnder7: true, occupiesSeat: false },
      ],
    });

    const [beforeTrip] = await db
      .select({
        availableSeats: tripsTable.availableSeats,
        reservedSeats: tripsTable.reservedSeats,
      })
      .from(tripsTable)
      .where(eq(tripsTable.id, TRIP_ID));

    const result = await createReservationsForOrder(orderId);
    reservationIds.push(...result.reservationIds);

    const [reservation] = await db
      .select({
        seats: reservationsTable.seats,
        capacityUnits: reservationsTable.capacityUnits,
      })
      .from(reservationsTable)
      .where(eq(reservationsTable.id, result.reservationIds[0]!));
    const passengerRows = await db
      .select({
        name: passengersTable.name,
        ageCategory: passengersTable.ageCategory,
        isPrimary: passengersTable.isPrimary,
        seatNumber: passengersTable.seatNumber,
      })
      .from(passengersTable)
      .where(eq(passengersTable.reservationId, result.reservationIds[0]!));
    const [afterTrip] = await db
      .select({
        availableSeats: tripsTable.availableSeats,
        reservedSeats: tripsTable.reservedSeats,
      })
      .from(tripsTable)
      .where(eq(tripsTable.id, TRIP_ID));

    expect(result.reservationIds).toHaveLength(1);
    expect(reservation).toMatchObject({ seats: ["1"], capacityUnits: 1 });
    expect(passengerRows).toHaveLength(2);
    expect(passengerRows.find((passenger) => passenger.isPrimary)).toMatchObject({
      name: "Ana Lap Test",
      ageCategory: "adult",
      seatNumber: "1",
    });
    expect(passengerRows.find((passenger) => passenger.name === "Lia Lap Test")).toMatchObject({
      ageCategory: "baby",
      isPrimary: false,
      seatNumber: null,
    });
    expect(afterTrip?.availableSeats).toBe(beforeTrip!.availableSeats - 1);
    expect(afterTrip?.reservedSeats).toBe(beforeTrip!.reservedSeats + 1);
  });

  it("reserves two trip vacancies and assigns a seat to a seated child", async () => {
    const orderId = makeOrderId();
    orderIds.push(orderId);
    await insertOrder(orderId, makeOrderNumber(), {
      clientId: SEATED_CHILD_CLIENT_ID,
      customerName: "Bruno Seated Test",
      customerEmail: "bruno.seated@example.com",
      quantity: 2,
      seats: ["2", "3"],
      coPassengers: [
        { name: "Caio Seated Test", isChildUnder7: true, occupiesSeat: true },
      ],
    });

    const [beforeTrip] = await db
      .select({
        availableSeats: tripsTable.availableSeats,
        reservedSeats: tripsTable.reservedSeats,
      })
      .from(tripsTable)
      .where(eq(tripsTable.id, TRIP_ID));

    const result = await createReservationsForOrder(orderId);
    reservationIds.push(...result.reservationIds);

    const [reservation] = await db
      .select({
        seats: reservationsTable.seats,
        capacityUnits: reservationsTable.capacityUnits,
      })
      .from(reservationsTable)
      .where(eq(reservationsTable.id, result.reservationIds[0]!));
    const passengerRows = await db
      .select({
        name: passengersTable.name,
        ageCategory: passengersTable.ageCategory,
        isPrimary: passengersTable.isPrimary,
        seatNumber: passengersTable.seatNumber,
      })
      .from(passengersTable)
      .where(eq(passengersTable.reservationId, result.reservationIds[0]!));
    const [afterTrip] = await db
      .select({
        availableSeats: tripsTable.availableSeats,
        reservedSeats: tripsTable.reservedSeats,
      })
      .from(tripsTable)
      .where(eq(tripsTable.id, TRIP_ID));

    expect(result.reservationIds).toHaveLength(1);
    expect(reservation).toMatchObject({ seats: ["2", "3"], capacityUnits: 2 });
    expect(passengerRows).toHaveLength(2);
    expect(passengerRows.find((passenger) => passenger.isPrimary)).toMatchObject({
      name: "Bruno Seated Test",
      ageCategory: "adult",
      seatNumber: "2",
    });
    expect(passengerRows.find((passenger) => passenger.name === "Caio Seated Test")).toMatchObject({
      ageCategory: "child",
      isPrimary: false,
      seatNumber: "3",
    });
    expect(afterTrip?.availableSeats).toBe(beforeTrip!.availableSeats - 2);
    expect(afterTrip?.reservedSeats).toBe(beforeTrip!.reservedSeats + 2);
  });

  it("allows only one concurrent checkout to reserve the same seat", async () => {
    const orderIdA = makeOrderId();
    const orderIdB = makeOrderId();
    const orderNumberA = makeOrderNumber();
    const orderNumberB = makeOrderNumber();
    orderIds.push(orderIdA, orderIdB);
    await Promise.all([
      insertOrder(orderIdA, orderNumberA, {
        clientId: SEAT_RACE_CLIENT_ID_A,
        customerName: "Carla Seat Race A",
        customerEmail: "carla.seat-race@example.com",
        seats: ["4"],
      }),
      insertOrder(orderIdB, orderNumberB, {
        clientId: SEAT_RACE_CLIENT_ID_B,
        customerName: "Diego Seat Race B",
        customerEmail: "diego.seat-race@example.com",
        seats: ["4"],
      }),
    ]);

    const [beforeTrip] = await db
      .select({
        availableSeats: tripsTable.availableSeats,
        reservedSeats: tripsTable.reservedSeats,
      })
      .from(tripsTable)
      .where(eq(tripsTable.id, TRIP_ID));

    const results = await Promise.allSettled([
      createReservationsForOrder(orderIdA),
      createReservationsForOrder(orderIdB),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "SEAT_CONFLICT" });

    const winningResult = fulfilled[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof createReservationsForOrder>>
    >;
    const winningReservationIds = winningResult.value.reservationIds;
    reservationIds.push(...winningReservationIds);
    expect(winningReservationIds).toHaveLength(1);

    const committedRows = await db
      .select({
        id: reservationsTable.id,
        seats: reservationsTable.seats,
        capacityUnits: reservationsTable.capacityUnits,
      })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.tenantId, TENANT_ID),
        eq(reservationsTable.tripId, TRIP_ID),
        inArray(reservationsTable.storeOrderId, [orderNumberA, orderNumberB]),
      ));
    const winningPassengerRows = await db
      .select({
        name: passengersTable.name,
        seatNumber: passengersTable.seatNumber,
        isPrimary: passengersTable.isPrimary,
      })
      .from(passengersTable)
      .where(eq(passengersTable.reservationId, winningReservationIds[0]!));
    const [afterTrip] = await db
      .select({
        availableSeats: tripsTable.availableSeats,
        reservedSeats: tripsTable.reservedSeats,
      })
      .from(tripsTable)
      .where(eq(tripsTable.id, TRIP_ID));

    expect(committedRows).toHaveLength(1);
    expect(committedRows[0]).toMatchObject({
      id: winningReservationIds[0],
      seats: ["4"],
      capacityUnits: 1,
    });
    expect(winningPassengerRows).toHaveLength(1);
    expect(winningPassengerRows[0]).toMatchObject({
      seatNumber: "4",
      isPrimary: true,
    });
    expect(afterTrip?.availableSeats).toBe(beforeTrip!.availableSeats - 1);
    expect(afterTrip?.reservedSeats).toBe(beforeTrip!.reservedSeats + 1);
  });

  it("does not oversell the last vacancy when checkouts select different seats", async () => {
    const orderIdA = makeOrderId();
    const orderIdB = makeOrderId();
    const orderNumberA = makeOrderNumber();
    const orderNumberB = makeOrderNumber();
    orderIds.push(orderIdA, orderIdB);
    await Promise.all([
      insertOrder(orderIdA, orderNumberA, {
        clientId: CAPACITY_RACE_CLIENT_ID_A,
        customerName: "Elisa Capacity Race A",
        customerEmail: "elisa.capacity-race@example.com",
        seats: ["5"],
      }),
      insertOrder(orderIdB, orderNumberB, {
        clientId: CAPACITY_RACE_CLIENT_ID_B,
        customerName: "Fabio Capacity Race B",
        customerEmail: "fabio.capacity-race@example.com",
        seats: ["6"],
      }),
    ]);

    const [beforeTrip] = await db
      .select({
        availableSeats: tripsTable.availableSeats,
        reservedSeats: tripsTable.reservedSeats,
      })
      .from(tripsTable)
      .where(eq(tripsTable.id, TRIP_ID));
    expect(beforeTrip?.availableSeats).toBe(1);
    expect(beforeTrip?.reservedSeats).toBe(5);

    const results = await Promise.allSettled([
      createReservationsForOrder(orderIdA),
      createReservationsForOrder(orderIdB),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "INSUFFICIENT_SEATS" });

    const winningResult = fulfilled[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof createReservationsForOrder>>
    >;
    const winningReservationIds = winningResult.value.reservationIds;
    reservationIds.push(...winningReservationIds);
    expect(winningReservationIds).toHaveLength(1);

    const committedRows = await db
      .select({
        id: reservationsTable.id,
        seats: reservationsTable.seats,
        capacityUnits: reservationsTable.capacityUnits,
      })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.tenantId, TENANT_ID),
        eq(reservationsTable.tripId, TRIP_ID),
        inArray(reservationsTable.storeOrderId, [orderNumberA, orderNumberB]),
      ));
    const [afterTrip] = await db
      .select({
        availableSeats: tripsTable.availableSeats,
        reservedSeats: tripsTable.reservedSeats,
      })
      .from(tripsTable)
      .where(eq(tripsTable.id, TRIP_ID));

    expect(committedRows).toHaveLength(1);
    expect(committedRows[0]?.capacityUnits).toBe(1);
    expect(committedRows[0]?.seats).toHaveLength(1);
    expect(["5", "6"]).toContain(committedRows[0]?.seats[0]);
    expect(afterTrip?.availableSeats).toBe(0);
    expect(afterTrip?.reservedSeats).toBe(beforeTrip!.reservedSeats + 1);
  });
});

/**
 * Real PostgreSQL concurrency coverage for client deletion versus reservation
 * cancellation/retry.
 *
 * The deletion service and the cancellation attempts use separate transactions.
 * Both lock the reservation before touching the trip, so PostgreSQL serializes
 * the status transition and only the transaction that observes an active
 * reservation is allowed to release its seats.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  reservationsTable,
  tenantsTable,
  tripsTable,
  usersTable,
} from "@workspace/db";
import {
  ACTIONS,
  hasPermission,
  MANAGEMENT_ROLES,
  RESERVATION_STATUS,
  RESOURCES,
  ROLES,
} from "@workspace/permissions";

import { generateId } from "../lib/id";
import {
  cancelLockedReservationAndReleaseCapacity,
  deleteReservationAndReleaseCapacity,
  lockReservationForCancellation,
} from "../services/reservation-capacity.js";
import { unlinkClientFromTrips } from "../services/unlink-client-from-trips.js";
import reservationsRouter from "../routes/reservations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const { mockGetAuth } = vi.hoisted(() => ({
  mockGetAuth: vi.fn(),
}));

// Keep authentication in the route path, but use the fixture user's Clerk ID
// instead of requiring a live Clerk request context.
vi.mock("@clerk/express", async () => {
  const actual = await vi.importActual<typeof import("@clerk/express")>("@clerk/express");
  return { ...actual, getAuth: mockGetAuth };
});

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
}));

const RUN = generateId();
const TENANT_ID = `uctci-tenant-${RUN}`;
const USER_ID = `uctci-user-${RUN}`;
const CLERK_ID = `uctci-clerk-${RUN}`;
const SALES_USER_ID = `uctci-sales-user-${RUN}`;
const SALES_CLERK_ID = `uctci-sales-clerk-${RUN}`;
const MANAGER_USER_ID = `uctci-manager-user-${RUN}`;
const MANAGER_CLERK_ID = `uctci-manager-clerk-${RUN}`;
const OTHER_USER_ID = `uctci-other-user-${RUN}`;
const CLIENT_ID = `uctci-client-${RUN}`;
const TRIP_ID = `uctci-trip-${RUN}`;
const RESERVATION_ID = `uctci-reservation-${RUN}`;
const OTHER_TENANT_ID = `uctci-other-tenant-${RUN}`;
const OTHER_TRIP_ID = `uctci-other-trip-${RUN}`;
const OTHER_RESERVATION_ID = `uctci-other-reservation-${RUN}`;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function cancelReservationAttempt(
  reservationId = RESERVATION_ID,
  holdLock = false,
  onLocked?: () => void,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const reservation = await lockReservationForCancellation(tx, TENANT_ID, reservationId);
    if (!reservation) {
      return false;
    }

    onLocked?.();

    // Keep the row lock held long enough for the deletion transaction and the
    // retry to genuinely wait on the same reservation lock.
    if (holdLock) {
      await tx.execute(sql`SELECT pg_sleep(0.05)`);
    }

    return cancelLockedReservationAndReleaseCapacity(tx, TENANT_ID, reservation);
  });
}

async function deleteReservationAttempt(): Promise<boolean> {
  return db.transaction((tx: Transaction) =>
    deleteReservationAndReleaseCapacity(tx, TENANT_ID, RESERVATION_ID),
  );
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
    } as never;
    next();
  });
  app.use("/api", reservationsRouter);
  app.use(errorHandler);
  return app;
}

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error(
      "DATABASE_URL must be set to run the unlink/cancellation concurrency integration test",
    );
  }

  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Unlink concurrency integration agency",
    slug: `uctci-${RUN}`,
    email: `uctci-${RUN}@example.com`,
  });
  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: CLERK_ID,
    tenantId: TENANT_ID,
    name: "Unlink concurrency integration tester",
    email: `uctci-user-${RUN}@example.com`,
    role: ROLES.AGENCY_ADMIN,
    referralCode: `UCTCI-${RUN}`,
  });
  await db.insert(usersTable).values({
    id: SALES_USER_ID,
    clerkId: SALES_CLERK_ID,
    tenantId: TENANT_ID,
    name: "Unlink concurrency sales user",
    email: `uctci-sales-${RUN}@example.com`,
    role: ROLES.SALES,
    referralCode: `UCTCI-SALES-${RUN}`,
  });
  await db.insert(usersTable).values({
    id: MANAGER_USER_ID,
    clerkId: MANAGER_CLERK_ID,
    tenantId: TENANT_ID,
    name: "Unlink concurrency manager user",
    email: `uctci-manager-${RUN}@example.com`,
    role: ROLES.AGENCY_MANAGER,
    referralCode: `UCTCI-MANAGER-${RUN}`,
  });
  await db.insert(tenantsTable).values({
    id: OTHER_TENANT_ID,
    name: "Other agency for reservation isolation",
    slug: `uctci-other-${RUN}`,
    email: `uctci-other-${RUN}@example.com`,
  });
  await db.insert(usersTable).values({
    id: OTHER_USER_ID,
    clerkId: `uctci-other-clerk-${RUN}`,
    tenantId: OTHER_TENANT_ID,
    name: "Other agency reservation owner",
    email: `uctci-other-user-${RUN}@example.com`,
    role: ROLES.AGENCY_ADMIN,
    referralCode: `UCTCI-OTHER-${RUN}`,
  });
  await db.insert(clientsTable).values({
    id: CLIENT_ID,
    tenantId: TENANT_ID,
    name: "Concurrent deletion client",
    email: `uctci-client-${RUN}@example.com`,
    whatsapp: `859999${RUN.slice(0, 5)}`,
    createdById: USER_ID,
  });
  await db.insert(tripsTable).values({
    id: TRIP_ID,
    tenantId: TENANT_ID,
    name: "Unlink concurrency integration trip",
    slug: `uctci-trip-${RUN}`,
    destination: "Fortaleza, CE",
    destinationCity: "Fortaleza",
    destinationState: "CE",
    type: "excursao",
    category: "nacional",
    departureDate: new Date("2027-02-15"),
    totalCapacity: 20,
    availableSeats: 8,
    reservedSeats: 0,
    confirmedSeats: 2,
    priceAdult: "100.00",
    createdById: USER_ID,
  });
  await db.insert(reservationsTable).values({
    id: RESERVATION_ID,
    tenantId: TENANT_ID,
    tripId: TRIP_ID,
    clientId: CLIENT_ID,
    seats: ["A1", "A2"],
    totalValue: "200.00",
    paidValue: "200.00",
    balance: "0.00",
    status: RESERVATION_STATUS.CONFIRMED,
    voucherCode: `UCTCI-VOUCHER-${RUN}`,
    qrCode: `UCTCI-QR-${RUN}`,
    createdById: USER_ID,
    reservationNumber: `UCTCI-${RUN}`,
  });
  await db.insert(tripsTable).values({
    id: OTHER_TRIP_ID,
    tenantId: OTHER_TENANT_ID,
    name: "Other agency isolation trip",
    slug: `uctci-other-trip-${RUN}`,
    destination: "Natal, RN",
    destinationCity: "Natal",
    destinationState: "RN",
    type: "excursao",
    category: "nacional",
    departureDate: new Date("2027-02-16"),
    totalCapacity: 20,
    availableSeats: 8,
    reservedSeats: 0,
    confirmedSeats: 2,
    priceAdult: "100.00",
    createdById: OTHER_USER_ID,
  });
  await db.insert(reservationsTable).values({
    id: OTHER_RESERVATION_ID,
    tenantId: OTHER_TENANT_ID,
    tripId: OTHER_TRIP_ID,
    seats: ["B1", "B2"],
    totalValue: "200.00",
    paidValue: "200.00",
    balance: "0.00",
    status: RESERVATION_STATUS.CONFIRMED,
    voucherCode: `UCTCI-OTHER-VOUCHER-${RUN}`,
    qrCode: `UCTCI-OTHER-QR-${RUN}`,
    createdById: OTHER_USER_ID,
    reservationNumber: `UCTCI-OTHER-${RUN}`,
  });
  mockGetAuth.mockReturnValue({ userId: CLERK_ID });
});

afterAll(async () => {
  // The tenant FK cascade removes the fixture rows in dependency order.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, OTHER_TENANT_ID));
});

describe("reservation deletion versus cancellation and client unlink — real PostgreSQL", () => {
  it("documents the reservation DELETE roles in the permission matrix", () => {
    const rolesWithReservationDelete = Object.values(ROLES).filter((role) =>
      hasPermission(role, RESOURCES.RESERVATIONS, ACTIONS.DELETE),
    );

    expect(new Set(MANAGEMENT_ROLES)).toEqual(new Set([
      ROLES.SUPER_ADMIN,
      ROLES.AGENCY_ADMIN,
      ROLES.AGENCY_MANAGER,
    ]));
    expect(new Set(rolesWithReservationDelete)).toEqual(new Set([
      ROLES.SUPER_ADMIN,
      ROLES.AGENCY_ADMIN,
    ]));
    expect(hasPermission(ROLES.AGENCY_MANAGER, RESOURCES.RESERVATIONS, ACTIONS.DELETE)).toBe(false);
  });

  it("rejects a reservation from another agency without changing its capacity", async () => {
    const response = await request(buildApp())
      .delete(`/api/reservations/${OTHER_RESERVATION_ID}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("RESERVATION_NOT_FOUND");

    const [otherReservation] = await db
      .select({ status: reservationsTable.status })
      .from(reservationsTable)
      .where(eq(reservationsTable.id, OTHER_RESERVATION_ID));
    expect(otherReservation?.status).toBe(RESERVATION_STATUS.CONFIRMED);

    const [otherTrip] = await db
      .select({
        availableSeats: tripsTable.availableSeats,
        reservedSeats: tripsTable.reservedSeats,
        confirmedSeats: tripsTable.confirmedSeats,
      })
      .from(tripsTable)
      .where(eq(tripsTable.id, OTHER_TRIP_ID));
    expect(otherTrip).toEqual({
      availableSeats: 8,
      reservedSeats: 0,
      confirmedSeats: 2,
    });
  });

  it("blocks roles without RESERVATIONS.DELETE without changing reservation or trip capacity", async () => {
    for (const userId of [SALES_CLERK_ID, MANAGER_CLERK_ID]) {
      mockGetAuth.mockReturnValue({ userId });

      const [reservationBefore] = await db
        .select({
          status: reservationsTable.status,
          seats: reservationsTable.seats,
        })
        .from(reservationsTable)
        .where(eq(reservationsTable.id, RESERVATION_ID));
      const [tripBefore] = await db
        .select({
          availableSeats: tripsTable.availableSeats,
          reservedSeats: tripsTable.reservedSeats,
          confirmedSeats: tripsTable.confirmedSeats,
        })
        .from(tripsTable)
        .where(eq(tripsTable.id, TRIP_ID));

      const response = await request(buildApp())
        .delete(`/api/reservations/${RESERVATION_ID}`);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN_ROLE");

      const [reservationAfter] = await db
        .select({
          status: reservationsTable.status,
          seats: reservationsTable.seats,
        })
        .from(reservationsTable)
        .where(eq(reservationsTable.id, RESERVATION_ID));
      const [tripAfter] = await db
        .select({
          availableSeats: tripsTable.availableSeats,
          reservedSeats: tripsTable.reservedSeats,
          confirmedSeats: tripsTable.confirmedSeats,
        })
        .from(tripsTable)
        .where(eq(tripsTable.id, TRIP_ID));

      expect(reservationAfter).toEqual(reservationBefore);
      expect(tripAfter).toEqual(tripBefore);
    }

    // The following test exercises the authorized management path.
    mockGetAuth.mockReturnValue({ userId: CLERK_ID });
  });

  it("makes concurrent cancellations release capacity only once", async () => {
    const concurrentTripId = `uctci-concurrent-trip-${RUN}`;
    const concurrentReservationId = `uctci-concurrent-reservation-${RUN}`;

    await db.insert(tripsTable).values({
      id: concurrentTripId,
      tenantId: TENANT_ID,
      name: "Concurrent cancellation trip",
      slug: `uctci-concurrent-trip-${RUN}`,
      destination: "Juazeiro do Norte, CE",
      destinationCity: "Juazeiro do Norte",
      destinationState: "CE",
      type: "excursao",
      category: "nacional",
      departureDate: new Date("2027-02-17"),
      totalCapacity: 20,
      availableSeats: 17,
      reservedSeats: 0,
      confirmedSeats: 3,
      priceAdult: "100.00",
      createdById: USER_ID,
    });
    await db.insert(reservationsTable).values({
      id: concurrentReservationId,
      tenantId: TENANT_ID,
      tripId: concurrentTripId,
      seats: ["C1", "C2", "C3"],
      totalValue: "300.00",
      paidValue: "300.00",
      balance: "0.00",
      status: RESERVATION_STATUS.CONFIRMED,
      voucherCode: `UCTCI-CONCURRENT-VOUCHER-${RUN}`,
      qrCode: `UCTCI-CONCURRENT-QR-${RUN}`,
      createdById: USER_ID,
      reservationNumber: `UCTCI-CONCURRENT-${RUN}`,
    });

    try {
      const [firstCancellation, secondCancellation] = await Promise.all([
        cancelReservationAttempt(concurrentReservationId),
        cancelReservationAttempt(concurrentReservationId),
      ]);

      expect([firstCancellation, secondCancellation].filter(Boolean)).toHaveLength(1);

      const [reservation] = await db
        .select({ status: reservationsTable.status })
        .from(reservationsTable)
        .where(eq(reservationsTable.id, concurrentReservationId));
      expect(reservation?.status).toBe(RESERVATION_STATUS.CANCELLED);

      const [trip] = await db
        .select({
          totalCapacity: tripsTable.totalCapacity,
          availableSeats: tripsTable.availableSeats,
          reservedSeats: tripsTable.reservedSeats,
          confirmedSeats: tripsTable.confirmedSeats,
        })
        .from(tripsTable)
        .where(eq(tripsTable.id, concurrentTripId));
      expect(trip).toEqual({
        totalCapacity: 20,
        availableSeats: 20,
        reservedSeats: 0,
        confirmedSeats: 0,
      });
    } finally {
      await db.delete(reservationsTable).where(eq(reservationsTable.id, concurrentReservationId));
      await db.delete(tripsTable).where(eq(tripsTable.id, concurrentTripId));
    }
  });

  it("serializes concurrent confirmation and cancellation with one valid capacity transition", async () => {
    const concurrentTripId = `uctci-confirm-cancel-trip-${RUN}`;
    const concurrentReservationId = `uctci-confirm-cancel-reservation-${RUN}`;

    await db.insert(tripsTable).values({
      id: concurrentTripId,
      tenantId: TENANT_ID,
      name: "Concurrent confirmation and cancellation trip",
      slug: `uctci-confirm-cancel-trip-${RUN}`,
      destination: "Crato, CE",
      destinationCity: "Crato",
      destinationState: "CE",
      type: "excursao",
      category: "nacional",
      departureDate: new Date("2027-02-18"),
      totalCapacity: 20,
      availableSeats: 17,
      reservedSeats: 3,
      confirmedSeats: 0,
      priceAdult: "100.00",
      createdById: USER_ID,
    });
    await db.insert(reservationsTable).values({
      id: concurrentReservationId,
      tenantId: TENANT_ID,
      tripId: concurrentTripId,
      clientId: CLIENT_ID,
      seats: ["D1", "D2", "D3"],
      totalValue: "300.00",
      paidValue: "0.00",
      balance: "300.00",
      status: RESERVATION_STATUS.PENDING,
      voucherCode: `UCTCI-CONFIRM-CANCEL-VOUCHER-${RUN}`,
      qrCode: `UCTCI-CONFIRM-CANCEL-QR-${RUN}`,
      createdById: USER_ID,
      reservationNumber: `UCTCI-CONFIRM-CANCEL-${RUN}`,
    });

    try {
      const app = buildApp();
      const [confirmation, cancellation] = await Promise.all([
        request(app)
          .patch(`/api/reservations/${concurrentReservationId}`)
          .send({ status: RESERVATION_STATUS.CONFIRMED }),
        request(app)
          .patch(`/api/reservations/${concurrentReservationId}`)
          .send({ status: RESERVATION_STATUS.CANCELLED }),
      ]);

      expect(confirmation.status).toBe(200);
      expect(cancellation.status).toBe(200);

      const [reservation] = await db
        .select({ status: reservationsTable.status })
        .from(reservationsTable)
        .where(eq(reservationsTable.id, concurrentReservationId));
      const [trip] = await db
        .select({
          totalCapacity: tripsTable.totalCapacity,
          availableSeats: tripsTable.availableSeats,
          reservedSeats: tripsTable.reservedSeats,
          confirmedSeats: tripsTable.confirmedSeats,
        })
        .from(tripsTable)
        .where(eq(tripsTable.id, concurrentTripId));

      if (reservation?.status === RESERVATION_STATUS.CONFIRMED) {
        expect(trip).toEqual({
          totalCapacity: 20,
          availableSeats: 17,
          reservedSeats: 0,
          confirmedSeats: 3,
        });
      } else {
        expect(reservation?.status).toBe(RESERVATION_STATUS.CANCELLED);
        expect(trip).toEqual({
          totalCapacity: 20,
          availableSeats: 20,
          reservedSeats: 0,
          confirmedSeats: 0,
        });
      }
    } finally {
      await db.delete(reservationsTable).where(eq(reservationsTable.id, concurrentReservationId));
      await db.delete(tripsTable).where(eq(tripsTable.id, concurrentTripId));
    }
  });

  it("serializes a concurrent seat update and cancellation without diverging capacity", async () => {
    const concurrentTripId = `uctci-seat-cancel-trip-${RUN}`;
    const concurrentReservationId = `uctci-seat-cancel-reservation-${RUN}`;

    await db.insert(tripsTable).values({
      id: concurrentTripId,
      tenantId: TENANT_ID,
      name: "Concurrent seat update and cancellation trip",
      slug: `uctci-seat-cancel-trip-${RUN}`,
      destination: "Barbalha, CE",
      destinationCity: "Barbalha",
      destinationState: "CE",
      type: "excursao",
      category: "nacional",
      departureDate: new Date("2027-02-19"),
      totalCapacity: 20,
      availableSeats: 17,
      reservedSeats: 0,
      confirmedSeats: 3,
      priceAdult: "100.00",
      createdById: USER_ID,
    });
    await db.insert(reservationsTable).values({
      id: concurrentReservationId,
      tenantId: TENANT_ID,
      tripId: concurrentTripId,
      seats: ["E1", "E2", "E3"],
      totalValue: "300.00",
      paidValue: "300.00",
      balance: "0.00",
      status: RESERVATION_STATUS.CONFIRMED,
      voucherCode: `UCTCI-SEAT-CANCEL-VOUCHER-${RUN}`,
      qrCode: `UCTCI-SEAT-CANCEL-QR-${RUN}`,
      createdById: USER_ID,
      reservationNumber: `UCTCI-SEAT-CANCEL-${RUN}`,
    });

    let releaseLock!: () => void;
    let signalLockReady!: () => void;
    const lockReady = new Promise<void>((resolve) => {
      signalLockReady = resolve;
    });
    const lockHolder = db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id
        FROM reservations
        WHERE id = ${concurrentReservationId} AND tenant_id = ${TENANT_ID}
        FOR UPDATE
      `);
      signalLockReady();
      await new Promise<void>((unlock) => {
        releaseLock = unlock;
      });
    });

    try {
      await lockReady;
      const app = buildApp();
      const cancellation = request(app)
        .patch(`/api/reservations/${concurrentReservationId}`)
        .send({ status: RESERVATION_STATUS.CANCELLED });

      // Give the cancellation transaction time to queue behind the holder.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const seatUpdate = request(app)
        .patch(`/api/reservations/${concurrentReservationId}`)
        .send({ seats: ["E1", "E2", "E3", "E4"] });
      releaseLock();

      const [cancellationResponse, seatUpdateResponse] = await Promise.all([
        cancellation,
        seatUpdate,
      ]);
      await lockHolder;

      expect(cancellationResponse.status).toBe(200);
      expect(seatUpdateResponse.status).toBe(200);

      const [reservation] = await db
        .select({
          status: reservationsTable.status,
          seats: reservationsTable.seats,
        })
        .from(reservationsTable)
        .where(eq(reservationsTable.id, concurrentReservationId));
      expect(reservation).toEqual({
        status: RESERVATION_STATUS.CANCELLED,
        seats: ["E1", "E2", "E3", "E4"],
      });

      const [trip] = await db
        .select({
          totalCapacity: tripsTable.totalCapacity,
          availableSeats: tripsTable.availableSeats,
          reservedSeats: tripsTable.reservedSeats,
          confirmedSeats: tripsTable.confirmedSeats,
        })
        .from(tripsTable)
        .where(eq(tripsTable.id, concurrentTripId));
      expect(trip).toEqual({
        totalCapacity: 20,
        availableSeats: 20,
        reservedSeats: 0,
        confirmedSeats: 0,
      });
    } finally {
      releaseLock?.();
      await lockHolder;
      await db.delete(reservationsTable).where(eq(reservationsTable.id, concurrentReservationId));
      await db.delete(tripsTable).where(eq(tripsTable.id, concurrentTripId));
    }
  });

  it("serializes a concurrent trip move and cancellation without leaking capacity", async () => {
    const oldTripId = `uctci-move-cancel-old-trip-${RUN}`;
    const newTripId = `uctci-move-cancel-new-trip-${RUN}`;
    const reservationId = `uctci-move-cancel-reservation-${RUN}`;

    await db.insert(tripsTable).values([
      {
        id: oldTripId,
        tenantId: TENANT_ID,
        name: "Concurrent move cancellation old trip",
        slug: oldTripId,
        destination: "Iguatu, CE",
        destinationCity: "Iguatu",
        destinationState: "CE",
        type: "excursao",
        category: "nacional",
        departureDate: new Date("2027-02-20"),
        totalCapacity: 20,
        availableSeats: 18,
        reservedSeats: 0,
        confirmedSeats: 2,
        priceAdult: "100.00",
        createdById: USER_ID,
      },
      {
        id: newTripId,
        tenantId: TENANT_ID,
        name: "Concurrent move cancellation new trip",
        slug: newTripId,
        destination: "Icó, CE",
        destinationCity: "Icó",
        destinationState: "CE",
        type: "excursao",
        category: "nacional",
        departureDate: new Date("2027-02-21"),
        totalCapacity: 20,
        availableSeats: 19,
        reservedSeats: 0,
        confirmedSeats: 1,
        priceAdult: "100.00",
        createdById: USER_ID,
      },
    ]);
    await db.insert(reservationsTable).values({
      id: reservationId,
      tenantId: TENANT_ID,
      tripId: oldTripId,
      clientId: CLIENT_ID,
      seats: ["F1", "F2"],
      totalValue: "200.00",
      paidValue: "200.00",
      balance: "0.00",
      status: RESERVATION_STATUS.CONFIRMED,
      voucherCode: `UCTCI-MOVE-CANCEL-VOUCHER-${RUN}`,
      qrCode: `UCTCI-MOVE-CANCEL-QR-${RUN}`,
      createdById: USER_ID,
      reservationNumber: `UCTCI-MOVE-CANCEL-${RUN}`,
    });

    try {
      const app = buildApp();
      const [moveResponse, cancellationResponse] = await Promise.all([
        request(app)
          .patch(`/api/reservations/${reservationId}`)
          .send({ tripId: newTripId }),
        request(app)
          .patch(`/api/reservations/${reservationId}`)
          .send({ status: RESERVATION_STATUS.CANCELLED }),
      ]);

      expect(moveResponse.status).toBe(200);
      expect(cancellationResponse.status).toBe(200);

      const [reservation] = await db
        .select({
          tripId: reservationsTable.tripId,
          status: reservationsTable.status,
        })
        .from(reservationsTable)
        .where(eq(reservationsTable.id, reservationId));
      expect(reservation).toEqual({
        tripId: newTripId,
        status: RESERVATION_STATUS.CANCELLED,
      });

      const tripRows = await db
        .select({
          id: tripsTable.id,
          availableSeats: tripsTable.availableSeats,
          reservedSeats: tripsTable.reservedSeats,
          confirmedSeats: tripsTable.confirmedSeats,
        })
        .from(tripsTable)
        .where(inArray(tripsTable.id, [oldTripId, newTripId]));
      expect(tripRows).toEqual(expect.arrayContaining([
        {
          id: oldTripId,
          availableSeats: 20,
          reservedSeats: 0,
          confirmedSeats: 0,
        },
        {
          id: newTripId,
          availableSeats: 19,
          reservedSeats: 0,
          confirmedSeats: 1,
        },
      ]));
    } finally {
      await db.delete(reservationsTable).where(eq(reservationsTable.id, reservationId));
      await db.delete(tripsTable).where(inArray(tripsTable.id, [oldTripId, newTripId]));
    }
  });

  it("finishes concurrent cross-trip moves without deadlocking or diverging capacity", async () => {
    const firstTripId = `uctci-cross-move-first-trip-${RUN}`;
    const secondTripId = `uctci-cross-move-second-trip-${RUN}`;
    const firstReservationId = `uctci-cross-move-first-reservation-${RUN}`;
    const secondReservationId = `uctci-cross-move-second-reservation-${RUN}`;
    const secondClientId = `uctci-cross-move-second-client-${RUN}`;

    await db.insert(clientsTable).values({
      id: secondClientId,
      tenantId: TENANT_ID,
      name: "Concurrent cross move second client",
      email: `uctci-cross-move-second-client-${RUN}@example.com`,
      whatsapp: `859998${RUN.slice(0, 5)}`,
      createdById: USER_ID,
    });

    await db.insert(tripsTable).values([
      {
        id: firstTripId,
        tenantId: TENANT_ID,
        name: "Concurrent cross move first trip",
        slug: firstTripId,
        destination: "Quixadá, CE",
        destinationCity: "Quixadá",
        destinationState: "CE",
        type: "excursao",
        category: "nacional",
        departureDate: new Date("2027-02-24"),
        totalCapacity: 20,
        availableSeats: 18,
        reservedSeats: 2,
        confirmedSeats: 0,
        priceAdult: "100.00",
        createdById: USER_ID,
      },
      {
        id: secondTripId,
        tenantId: TENANT_ID,
        name: "Concurrent cross move second trip",
        slug: secondTripId,
        destination: "Sobral, CE",
        destinationCity: "Sobral",
        destinationState: "CE",
        type: "excursao",
        category: "nacional",
        departureDate: new Date("2027-02-25"),
        totalCapacity: 20,
        availableSeats: 17,
        reservedSeats: 0,
        confirmedSeats: 3,
        priceAdult: "100.00",
        createdById: USER_ID,
      },
    ]);
    await db.insert(reservationsTable).values([
      {
        id: firstReservationId,
        tenantId: TENANT_ID,
        tripId: firstTripId,
        clientId: CLIENT_ID,
        seats: ["H1", "H2"],
        totalValue: "200.00",
        paidValue: "0.00",
        balance: "200.00",
        status: RESERVATION_STATUS.PENDING,
        voucherCode: `UCTCI-CROSS-MOVE-FIRST-VOUCHER-${RUN}`,
        qrCode: `UCTCI-CROSS-MOVE-FIRST-QR-${RUN}`,
        createdById: USER_ID,
        reservationNumber: `UCTCI-CROSS-MOVE-FIRST-${RUN}`,
      },
      {
        id: secondReservationId,
        tenantId: TENANT_ID,
        tripId: secondTripId,
        clientId: secondClientId,
        seats: ["I1", "I2", "I3"],
        totalValue: "300.00",
        paidValue: "300.00",
        balance: "0.00",
        status: RESERVATION_STATUS.CONFIRMED,
        voucherCode: `UCTCI-CROSS-MOVE-SECOND-VOUCHER-${RUN}`,
        qrCode: `UCTCI-CROSS-MOVE-SECOND-QR-${RUN}`,
        createdById: USER_ID,
        reservationNumber: `UCTCI-CROSS-MOVE-SECOND-${RUN}`,
      },
    ]);

    try {
      const app = buildApp();
      const [firstMoveResponse, secondMoveResponse] = await Promise.all([
        request(app)
          .patch(`/api/reservations/${firstReservationId}`)
          .send({ tripId: secondTripId }),
        request(app)
          .patch(`/api/reservations/${secondReservationId}`)
          .send({ tripId: firstTripId }),
      ]);

      expect(firstMoveResponse.status).toBe(200);
      expect(secondMoveResponse.status).toBe(200);

      const reservations = await db
        .select({
          id: reservationsTable.id,
          tripId: reservationsTable.tripId,
        })
        .from(reservationsTable)
        .where(inArray(reservationsTable.id, [firstReservationId, secondReservationId]));
      expect(reservations).toEqual(expect.arrayContaining([
        { id: firstReservationId, tripId: secondTripId },
        { id: secondReservationId, tripId: firstTripId },
      ]));

      const tripRows = await db
        .select({
          id: tripsTable.id,
          availableSeats: tripsTable.availableSeats,
          reservedSeats: tripsTable.reservedSeats,
          confirmedSeats: tripsTable.confirmedSeats,
        })
        .from(tripsTable)
        .where(inArray(tripsTable.id, [firstTripId, secondTripId]));
      expect(tripRows).toEqual(expect.arrayContaining([
        {
          id: firstTripId,
          availableSeats: 17,
          reservedSeats: 0,
          confirmedSeats: 3,
        },
        {
          id: secondTripId,
          availableSeats: 18,
          reservedSeats: 2,
          confirmedSeats: 0,
        },
      ]));
    } finally {
      await db.delete(reservationsTable).where(inArray(reservationsTable.id, [firstReservationId, secondReservationId]));
      await db.delete(tripsTable).where(inArray(tripsTable.id, [firstTripId, secondTripId]));
      await db.delete(clientsTable).where(eq(clientsTable.id, secondClientId));
    }
  });

  it("serializes a concurrent trip move and seat update on the final trip", async () => {
    const oldTripId = `uctci-move-seats-old-trip-${RUN}`;
    const newTripId = `uctci-move-seats-new-trip-${RUN}`;
    const reservationId = `uctci-move-seats-reservation-${RUN}`;

    await db.insert(tripsTable).values([
      {
        id: oldTripId,
        tenantId: TENANT_ID,
        name: "Concurrent move seats old trip",
        slug: oldTripId,
        destination: "Milagres, CE",
        destinationCity: "Milagres",
        destinationState: "CE",
        type: "excursao",
        category: "nacional",
        departureDate: new Date("2027-02-22"),
        totalCapacity: 20,
        availableSeats: 18,
        reservedSeats: 0,
        confirmedSeats: 2,
        priceAdult: "100.00",
        createdById: USER_ID,
      },
      {
        id: newTripId,
        tenantId: TENANT_ID,
        name: "Concurrent move seats new trip",
        slug: newTripId,
        destination: "Brejo Santo, CE",
        destinationCity: "Brejo Santo",
        destinationState: "CE",
        type: "excursao",
        category: "nacional",
        departureDate: new Date("2027-02-23"),
        totalCapacity: 20,
        availableSeats: 17,
        reservedSeats: 0,
        confirmedSeats: 3,
        priceAdult: "100.00",
        createdById: USER_ID,
      },
    ]);
    await db.insert(reservationsTable).values({
      id: reservationId,
      tenantId: TENANT_ID,
      tripId: oldTripId,
      clientId: CLIENT_ID,
      seats: ["G1", "G2"],
      totalValue: "200.00",
      paidValue: "200.00",
      balance: "0.00",
      status: RESERVATION_STATUS.CONFIRMED,
      voucherCode: `UCTCI-MOVE-SEATS-VOUCHER-${RUN}`,
      qrCode: `UCTCI-MOVE-SEATS-QR-${RUN}`,
      createdById: USER_ID,
      reservationNumber: `UCTCI-MOVE-SEATS-${RUN}`,
    });

    try {
      const app = buildApp();
      const [moveResponse, seatUpdateResponse] = await Promise.all([
        request(app)
          .patch(`/api/reservations/${reservationId}`)
          .send({ tripId: newTripId }),
        request(app)
          .patch(`/api/reservations/${reservationId}`)
          .send({ seats: ["G1", "G2", "G3"] }),
      ]);

      expect(moveResponse.status).toBe(200);
      expect(seatUpdateResponse.status).toBe(200);

      const [reservation] = await db
        .select({
          tripId: reservationsTable.tripId,
          seats: reservationsTable.seats,
          status: reservationsTable.status,
        })
        .from(reservationsTable)
        .where(eq(reservationsTable.id, reservationId));
      expect(reservation).toEqual({
        tripId: newTripId,
        seats: ["G1", "G2", "G3"],
        status: RESERVATION_STATUS.CONFIRMED,
      });

      const tripRows = await db
        .select({
          id: tripsTable.id,
          availableSeats: tripsTable.availableSeats,
          reservedSeats: tripsTable.reservedSeats,
          confirmedSeats: tripsTable.confirmedSeats,
        })
        .from(tripsTable)
        .where(inArray(tripsTable.id, [oldTripId, newTripId]));
      expect(tripRows).toEqual(expect.arrayContaining([
        {
          id: oldTripId,
          availableSeats: 20,
          reservedSeats: 0,
          confirmedSeats: 0,
        },
        {
          id: newTripId,
          availableSeats: 14,
          reservedSeats: 0,
          confirmedSeats: 6,
        },
      ]));
    } finally {
      await db.delete(reservationsTable).where(eq(reservationsTable.id, reservationId));
      await db.delete(tripsTable).where(inArray(tripsTable.id, [oldTripId, newTripId]));
    }
  });

  it("rejects a trip move when destination reservations or free passengers occupy its seats", async () => {
    const oldTripId = `uctci-seat-conflict-old-trip-${RUN}`;
    const newTripId = `uctci-seat-conflict-new-trip-${RUN}`;
    const reservationId = `uctci-seat-conflict-reservation-${RUN}`;
    const blockingReservationId = `uctci-seat-conflict-blocking-${RUN}`;
    const destinationFreePassengers = [{
      id: `uctci-seat-conflict-free-${RUN}`,
      name: "Guia da viagem",
      cpf: "11122233344",
      whatsapp: "88999999999",
      role: "guide" as const,
      seatNumber: "F3",
    }];

    await db.insert(tripsTable).values([
      {
        id: oldTripId,
        tenantId: TENANT_ID,
        name: "Seat conflict source trip",
        slug: oldTripId,
        destination: "Crato, CE",
        destinationCity: "Crato",
        destinationState: "CE",
        type: "excursao",
        category: "nacional",
        departureDate: new Date("2027-03-01"),
        totalCapacity: 20,
        availableSeats: 17,
        reservedSeats: 0,
        confirmedSeats: 3,
        priceAdult: "100.00",
        createdById: USER_ID,
      },
      {
        id: newTripId,
        tenantId: TENANT_ID,
        name: "Seat conflict destination trip",
        slug: newTripId,
        destination: "Juazeiro do Norte, CE",
        destinationCity: "Juazeiro do Norte",
        destinationState: "CE",
        type: "excursao",
        category: "nacional",
        departureDate: new Date("2027-03-02"),
        totalCapacity: 20,
        availableSeats: 17,
        reservedSeats: 1,
        confirmedSeats: 0,
        freePassengers: destinationFreePassengers,
        priceAdult: "100.00",
        createdById: USER_ID,
      },
    ]);
    await db.insert(reservationsTable).values([
      {
        id: reservationId,
        tenantId: TENANT_ID,
        tripId: oldTripId,
        clientId: CLIENT_ID,
        seats: ["F1", "F2", "F3"],
        totalValue: "300.00",
        paidValue: "300.00",
        balance: "0.00",
        status: RESERVATION_STATUS.CONFIRMED,
        voucherCode: `UCTCI-SEAT-CONFLICT-VOUCHER-${RUN}`,
        qrCode: `UCTCI-SEAT-CONFLICT-QR-${RUN}`,
        createdById: USER_ID,
        reservationNumber: `UCTCI-SEAT-CONFLICT-${RUN}`,
      },
      {
        id: blockingReservationId,
        tenantId: TENANT_ID,
        tripId: newTripId,
        seats: ["F2"],
        totalValue: "100.00",
        paidValue: "0.00",
        balance: "100.00",
        status: RESERVATION_STATUS.PENDING,
        voucherCode: `UCTCI-SEAT-CONFLICT-BLOCKING-VOUCHER-${RUN}`,
        qrCode: `UCTCI-SEAT-CONFLICT-BLOCKING-QR-${RUN}`,
        createdById: USER_ID,
        reservationNumber: `UCTCI-SEAT-CONFLICT-BLOCKING-${RUN}`,
      },
    ]);

    try {
      const response = await request(buildApp())
        .patch(`/api/reservations/${reservationId}`)
        .send({ tripId: newTripId });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("SEAT_CONFLICT");
      expect(response.body.conflictingSeats).toEqual(["F2", "F3"]);

      const [reservation] = await db
        .select({
          tripId: reservationsTable.tripId,
          seats: reservationsTable.seats,
          status: reservationsTable.status,
        })
        .from(reservationsTable)
        .where(eq(reservationsTable.id, reservationId));
      expect(reservation).toEqual({
        tripId: oldTripId,
        seats: ["F1", "F2", "F3"],
        status: RESERVATION_STATUS.CONFIRMED,
      });

      const tripRows = await db
        .select({
          id: tripsTable.id,
          availableSeats: tripsTable.availableSeats,
          reservedSeats: tripsTable.reservedSeats,
          confirmedSeats: tripsTable.confirmedSeats,
          freePassengers: tripsTable.freePassengers,
        })
        .from(tripsTable)
        .where(inArray(tripsTable.id, [oldTripId, newTripId]));
      expect(tripRows).toEqual(expect.arrayContaining([
        {
          id: oldTripId,
          availableSeats: 17,
          reservedSeats: 0,
          confirmedSeats: 3,
          freePassengers: [],
        },
        {
          id: newTripId,
          availableSeats: 17,
          reservedSeats: 1,
          confirmedSeats: 0,
          freePassengers: destinationFreePassengers,
        },
      ]));
    } finally {
      await db.delete(reservationsTable).where(inArray(reservationsTable.id, [reservationId, blockingReservationId]));
      await db.delete(tripsTable).where(inArray(tripsTable.id, [oldTripId, newTripId]));
    }
  });

  it("serializes direct deletion, cancellation, and client unlink so seats are released exactly once", async () => {
    const app = buildApp();
    let signalLockReady: (() => void) | undefined;
    const lockReady = new Promise<void>((resolve) => {
      signalLockReady = resolve;
    });
    const cancellation = cancelReservationAttempt(RESERVATION_ID, true, () => signalLockReady?.());
    await lockReady;

    const httpDeletion = request(app).delete(`/api/reservations/${RESERVATION_ID}`);
    const directDeletion = deleteReservationAttempt();
    const deletion = db.transaction((tx: Transaction) =>
      unlinkClientFromTrips(tx, TENANT_ID, CLIENT_ID),
    );
    const retry = cancelReservationAttempt(RESERVATION_ID);

    const [httpResponse, directDeletionReleased, deletedTripIds, cancellationWon, retryWon] = await Promise.all([
      httpDeletion,
      directDeletion,
      deletion,
      cancellation,
      retry,
    ]);

    expect(httpResponse.status).toBe(200);
    expect(httpResponse.body).toEqual({ success: true });

    const directReleaseOperations = [
      directDeletionReleased,
      deletedTripIds.includes(TRIP_ID),
      cancellationWon,
      retryWon,
    ].filter(Boolean);

    // The HTTP route is one of the contenders too. At most one of the direct
    // contenders may observe the active row; the final counters account for
    // the route when it wins the reservation lock.
    expect(directReleaseOperations.length).toBeLessThanOrEqual(1);

    const [reservation] = await db
      .select({
        status: reservationsTable.status,
        clientId: reservationsTable.clientId,
      })
      .from(reservationsTable)
      .where(eq(reservationsTable.id, RESERVATION_ID));
    expect(reservation).toBeUndefined();

    const [trip] = await db
      .select({
        totalCapacity: tripsTable.totalCapacity,
        availableSeats: tripsTable.availableSeats,
        reservedSeats: tripsTable.reservedSeats,
        confirmedSeats: tripsTable.confirmedSeats,
      })
      .from(tripsTable)
      .where(eq(tripsTable.id, TRIP_ID));
    expect(trip).toEqual({
      totalCapacity: 20,
      availableSeats: 10,
      reservedSeats: 0,
      confirmedSeats: 0,
    });
    expect(trip!.availableSeats).toBeLessThanOrEqual(trip!.totalCapacity);
  });
});
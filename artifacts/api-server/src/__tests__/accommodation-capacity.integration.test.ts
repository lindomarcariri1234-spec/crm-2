import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  usersTable,
  storesTable,
  storeProductsTable,
  storeOrdersTable,
  storeOrderItemsTable,
  accommodationsTable,
  accommodationRoomsTable,
  accommodationRoomInventoryTable,
  accommodationRoomBlocksTable,
  accommodationStaysTable,
  accommodationStayGuestsTable,
  accommodationRoomAssignmentsTable,
  tripsTable,
  reservationsTable,
  passengersTable,
  reservationRoomAssignmentsTable,
} from "@workspace/db";

const auth = vi.hoisted(() => ({
  id: "",
  tenantId: "",
  role: "agencia",
}));

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "accommodation-capacity-test-user" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(async () => auth),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["superadmin", "agencia"],
  MANAGEMENT_ROLES: ["superadmin", "agencia", "gerente"],
}));

import accommodationOperationsRouter from "../routes/accommodation-operations.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { createReservationsForOrder } from "../services/checkout/create-reservations.js";

const run = randomUUID().replace(/-/g, "").slice(0, 12);
const tenantId = `accommodation-capacity-tenant-${run}`;
const userId = `accommodation-capacity-user-${run}`;
const storeId = `accommodation-capacity-store-${run}`;
const accommodationId = `accommodation-capacity-hotel-${run}`;
const tripId = `accommodation-capacity-trip-${run}`;
const reservationId = `accommodation-capacity-reservation-${run}`;
const passengerId = `accommodation-capacity-passenger-${run}`;
const stayId = `accommodation-capacity-stay-${run}`;
const stayGuestId = `accommodation-capacity-stay-guest-${run}`;
const orderId = `accommodation-capacity-order-${run}`;
const productId = `accommodation-capacity-product-${run}`;

const roomAvailableId = `accommodation-capacity-room-available-${run}`;
const roomLegacyId = `accommodation-capacity-room-legacy-${run}`;
const roomStayId = `accommodation-capacity-room-stay-${run}`;
const roomBlockedId = `accommodation-capacity-room-blocked-${run}`;
const roomInventoryBlockedId = `accommodation-capacity-room-inventory-blocked-${run}`;
const roomInventoryOverrideId = `accommodation-capacity-room-inventory-override-${run}`;

const checkIn = "2031-04-10";
const checkOut = "2031-04-12";
const checkoutOrderIds: string[] = [orderId];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", accommodationOperationsRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

async function createDirectCheckoutOrder(roomId: string, guestCount = 1) {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const directOrderId = `accommodation-capacity-order-${suffix}`;
  await db.insert(storeOrdersTable).values({
    id: directOrderId,
    storeId,
    tenantId,
    orderNumber: `ACCAP-ORDER-${suffix}`,
    customerName: "Checkout capacity guest",
    customerEmail: `checkout-capacity-${suffix}@example.com`,
    customerPhone: "11999999999",
    subtotal: "250.00",
    totalAmount: "250.00",
    paymentMethod: "pix",
    paymentProvider: "test",
    paymentStatus: "pending",
    coPassengers: guestCount > 1
      ? Array.from({ length: guestCount - 1 }, (_, index) => ({ name: `Additional guest ${index + 1}` }))
      : [],
  });
  await db.insert(storeOrderItemsTable).values({
    id: `accommodation-capacity-order-item-${suffix}`,
    orderId: directOrderId,
    productId,
    productName: "Direct accommodation product",
    productType: "accommodation",
    price: "250.00",
    quantity: 1,
    subtotal: "250.00",
    discount: "0.00",
    total: "250.00",
    metadata: { checkIn, checkOut, roomId },
  });
  checkoutOrderIds.push(directOrderId);
  return directOrderId;
}

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run the accommodation capacity DB integration test");
  }

  await db.insert(tenantsTable).values({
    id: tenantId,
    name: "Accommodation Capacity Test Agency",
    slug: `accommodation-capacity-${run}`,
    email: `accommodation-capacity-${run}@example.com`,
  });
  await db.insert(usersTable).values({
    id: userId,
    clerkId: `accommodation-capacity-clerk-${run}`,
    tenantId,
    name: "Accommodation Capacity Admin",
    email: `accommodation-capacity-admin-${run}@example.com`,
    referralCode: `ACCAP${run}`,
    isActive: true,
  });
  await db.insert(storesTable).values({
    id: storeId,
    tenantId,
    name: "Accommodation Capacity Store",
    slug: `accommodation-capacity-store-${run}`,
    email: `accommodation-capacity-store-${run}@example.com`,
  });
  await db.insert(accommodationsTable).values({
    id: accommodationId,
    tenantId,
    name: "Capacity Test Hotel",
    type: "hotel",
    status: "active",
  });
  await db.insert(accommodationRoomsTable).values([
    {
      id: roomAvailableId,
      tenantId,
      accommodationId,
      name: "Available",
      category: "standard",
      capacity: 2,
    },
    {
      id: roomLegacyId,
      tenantId,
      accommodationId,
      name: "Legacy reservation",
      category: "standard",
      capacity: 1,
    },
    {
      id: roomStayId,
      tenantId,
      accommodationId,
      name: "Storefront stay",
      category: "standard",
      capacity: 2,
    },
    {
      id: roomBlockedId,
      tenantId,
      accommodationId,
      name: "Room block",
      category: "standard",
      capacity: 1,
    },
    {
      id: roomInventoryBlockedId,
      tenantId,
      accommodationId,
      name: "Inventory block",
      category: "standard",
      capacity: 1,
    },
    {
      id: roomInventoryOverrideId,
      tenantId,
      accommodationId,
      name: "Inventory override",
      category: "standard",
      capacity: 2,
    },
  ]);
  await db.insert(tripsTable).values({
    id: tripId,
    tenantId,
    name: "Capacity Test Trip",
    slug: `accommodation-capacity-trip-${run}`,
    destination: "Test destination",
    destinationCity: "Test city",
    destinationState: "SP",
    type: "excursao",
    category: "nacional",
    departureDate: new Date("2031-04-10T12:00:00Z"),
    returnDate: new Date("2031-04-12T12:00:00Z"),
    totalCapacity: 20,
    availableSeats: 20,
    priceAdult: "100.00",
    createdById: userId,
    accommodationId,
  });
  await db.insert(reservationsTable).values({
    id: reservationId,
    tenantId,
    tripId,
    totalValue: "100.00",
    paidValue: "100.00",
    balance: "0.00",
    status: "confirmed",
    voucherCode: `ACCAP-VOUCHER-${run}`,
    qrCode: `ACCAP-QR-${run}`,
    createdById: userId,
  });
  await db.insert(passengersTable).values({
    id: passengerId,
    reservationId,
    name: "Legacy reservation guest",
    ageCategory: "adult",
  });
  await db.insert(reservationRoomAssignmentsTable).values({
    id: `accommodation-capacity-legacy-assignment-${run}`,
    tenantId,
    tripId,
    reservationId,
    passengerId,
    roomId: roomLegacyId,
  });

  await db.insert(accommodationStaysTable).values({
    id: stayId,
    tenantId,
    accommodationId,
    source: "STORE_ORDER",
    checkIn,
    checkOut,
    nights: 2,
    status: "confirmed",
    storeOrderId: `existing-store-order-${run}`,
  });
  await db.insert(accommodationStayGuestsTable).values({
    id: stayGuestId,
    tenantId,
    stayId,
    name: "Storefront stay guest",
    guestType: "adult",
  });
  await db.insert(accommodationRoomAssignmentsTable).values({
    id: `accommodation-capacity-stay-assignment-${run}`,
    tenantId,
    stayId,
    stayGuestId,
    roomId: roomStayId,
    checkIn,
    checkOut,
    assignedBy: userId,
  });

  await db.insert(accommodationRoomBlocksTable).values({
    id: `accommodation-capacity-room-block-${run}`,
    tenantId,
    accommodationId,
    roomId: roomBlockedId,
    startDate: "2031-04-11",
    endDate: "2031-04-13",
    blockType: "maintenance",
    reason: "Integration test block",
    status: "active",
    createdBy: userId,
  });
  await db.insert(accommodationRoomInventoryTable).values([
    {
      id: `accommodation-capacity-inventory-block-${run}`,
      tenantId,
      roomId: roomInventoryBlockedId,
      inventoryDate: "2031-04-11",
      status: "maintenance",
      maintenanceReason: "Integration test maintenance",
    },
    {
      id: `accommodation-capacity-inventory-override-${run}`,
      tenantId,
      roomId: roomInventoryOverrideId,
      inventoryDate: "2031-04-11",
      status: "available",
      capacityOverride: 1,
    },
  ]);

  await db.insert(storeProductsTable).values({
    id: productId,
    storeId,
    type: "accommodation",
    name: "Direct accommodation product",
    slug: `accommodation-capacity-product-${run}`,
    price: "250.00",
    status: "published",
    accommodationId,
  });
  await db.insert(storeOrdersTable).values({
    id: orderId,
    storeId,
    tenantId,
    orderNumber: `ACCAP-ORDER-${run}`,
    customerName: "Checkout capacity guest",
    customerEmail: `checkout-capacity-${run}@example.com`,
    customerPhone: "11999999999",
    subtotal: "250.00",
    totalAmount: "250.00",
    paymentMethod: "pix",
    paymentProvider: "test",
    paymentStatus: "pending",
  });
  await db.insert(storeOrderItemsTable).values({
    id: `accommodation-capacity-order-item-${run}`,
    orderId,
    productId,
    productName: "Direct accommodation product",
    productType: "accommodation",
    price: "250.00",
    quantity: 1,
    subtotal: "250.00",
    discount: "0.00",
    total: "250.00",
    metadata: { checkIn, checkOut, roomId: roomLegacyId },
  });

  auth.id = userId;
  auth.tenantId = tenantId;
});

afterAll(async () => {
  await db.delete(accommodationRoomAssignmentsTable).where(eq(accommodationRoomAssignmentsTable.tenantId, tenantId));
  await db.delete(accommodationStayGuestsTable).where(eq(accommodationStayGuestsTable.tenantId, tenantId));
  await db.delete(accommodationStaysTable).where(eq(accommodationStaysTable.tenantId, tenantId));
  await db.delete(accommodationRoomInventoryTable).where(eq(accommodationRoomInventoryTable.tenantId, tenantId));
  await db.delete(accommodationRoomBlocksTable).where(eq(accommodationRoomBlocksTable.tenantId, tenantId));
  await db.delete(reservationRoomAssignmentsTable).where(eq(reservationRoomAssignmentsTable.tenantId, tenantId));
  await db.delete(passengersTable).where(eq(passengersTable.reservationId, reservationId));
  await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, tenantId));
  await db.delete(storeOrdersTable).where(inArray(storeOrdersTable.id, checkoutOrderIds));
  await db.delete(storeProductsTable).where(eq(storeProductsTable.id, productId));
  await db.delete(tripsTable).where(eq(tripsTable.id, tripId));
  await db.delete(accommodationRoomsTable).where(eq(accommodationRoomsTable.tenantId, tenantId));
  await db.delete(accommodationsTable).where(eq(accommodationsTable.tenantId, tenantId));
  await db.delete(storesTable).where(eq(storesTable.id, storeId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("accommodation capacity — real PostgreSQL integration", () => {
  it("combines legacy reservations, storefront stays, blocks, and daily inventory in PMS availability", async () => {
    const response = await request(app)
      .get(`/api/accommodations/${accommodationId}/availability`)
      .query({ checkIn, checkOut });

    expect(response.status).toBe(200);
    const rooms = new Map<string, {
      occupied: number;
      capacity: number;
      available: number;
      blocked: boolean;
    }>(response.body.rooms.map((room: {
      id: string;
      occupied: number;
      capacity: number;
      available: number;
      blocked: boolean;
    }) => [room.id, room]));

    expect(rooms.get(roomAvailableId)).toMatchObject({
      occupied: 0,
      capacity: 2,
      available: 2,
      blocked: false,
    });
    expect(rooms.get(roomLegacyId)).toMatchObject({
      occupied: 1,
      capacity: 1,
      available: 0,
      blocked: false,
    });
    expect(rooms.get(roomStayId)).toMatchObject({
      occupied: 1,
      capacity: 2,
      available: 1,
      blocked: false,
    });
    expect(rooms.get(roomBlockedId)).toMatchObject({
      occupied: 0,
      capacity: 1,
      available: 0,
      blocked: true,
    });
    expect(rooms.get(roomInventoryBlockedId)).toMatchObject({
      occupied: 0,
      capacity: 1,
      available: 0,
      blocked: true,
    });
    expect(rooms.get(roomInventoryOverrideId)).toMatchObject({
      occupied: 0,
      capacity: 1,
      available: 1,
      blocked: false,
    });
  });

  it("rejects direct checkout when legacy occupancy exhausts capacity and rolls back the stay", async () => {
    await expect(createReservationsForOrder(orderId)).rejects.toMatchObject({
      statusCode: 409,
      code: "ACCOMMODATION_NO_AVAILABILITY",
    });

    const stays = await db.select({ id: accommodationStaysTable.id })
      .from(accommodationStaysTable)
      .where(and(
        eq(accommodationStaysTable.tenantId, tenantId),
        eq(accommodationStaysTable.storeOrderId, orderId),
      ));
    expect(stays).toHaveLength(0);

    const guests = await db.select({ id: accommodationStayGuestsTable.id })
      .from(accommodationStayGuestsTable)
      .where(eq(accommodationStayGuestsTable.tenantId, tenantId));
    expect(guests.map(guest => guest.id)).toEqual([stayGuestId]);

    const assignments = await db.select({
      id: accommodationRoomAssignmentsTable.id,
      stayId: accommodationRoomAssignmentsTable.stayId,
    })
      .from(accommodationRoomAssignmentsTable)
      .where(eq(accommodationRoomAssignmentsTable.tenantId, tenantId));
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.stayId).toBe(stayId);
  });

  it("rejects direct checkout for an occupied stay, a room block, and daily inventory block", async () => {
    for (const roomId of [roomStayId, roomBlockedId, roomInventoryBlockedId]) {
      const directOrderId = await createDirectCheckoutOrder(roomId, roomId === roomStayId ? 2 : 1);

      await expect(createReservationsForOrder(directOrderId)).rejects.toMatchObject({
        statusCode: 409,
        code: "ACCOMMODATION_NO_AVAILABILITY",
      });

      const stays = await db.select({ id: accommodationStaysTable.id })
        .from(accommodationStaysTable)
        .where(and(
          eq(accommodationStaysTable.tenantId, tenantId),
          eq(accommodationStaysTable.storeOrderId, directOrderId),
        ));
      expect(stays).toHaveLength(0);
    }
  });
});
import {
  db,
  partnerAvailabilityTable,
  partnerProductsTable,
  reservationsTable,
  storeOrderItemsTable,
  storeOrdersTable,
  storeProductsTable,
  storesTable,
  tripsTable,
} from "@workspace/db";
import { ACTIVE_RESERVATION_STATUSES, RESERVATION_STATUS } from "@workspace/permissions";
import { and, eq, inArray, ne } from "drizzle-orm";
import { logger } from "../lib/logger";

export type ReservationSnapshot = {
  tripId: string;
  tenantId: string;
  status: string;
  seats: string[] | null;
  capacityUnits: number;
};

export type TripSnapshot = {
  tripId: string;
  tenantId: string;
  totalCapacity: number;
  storedReserved: number;
  storedConfirmed: number;
  storedAvailable: number;
  freePassengerCount: number;
  reservations: ReservationSnapshot[];
};

export type InventoryItemSnapshot = {
  itemId: string;
  quantity: number;
  itemStatus: string;
  inventoryClaimedQuantity: number;
  inventoryState: string | null;
  salesCountApplied: boolean;
};

export type InventorySnapshot = {
  productId: string;
  tenantId: string;
  trackInventory: boolean;
  allowBackorder: boolean;
  storedStock: number | null;
  storedSalesCount: number;
  items: InventoryItemSnapshot[];
};

export type PartnerClaimSnapshot = {
  tenantId: string;
  productId: string;
  date: string;
  quantity: number;
};

export type PartnerAvailabilitySnapshot = {
  availabilityId: string;
  tenantId: string;
  productId: string;
  date: string;
  storedSpotsUsed: number;
  claims: PartnerClaimSnapshot[];
};

export type CapacityDrift = {
  tenantId: string;
  resourceType: "trip" | "inventory" | "partner_availability";
  resourceId: string;
  metric: string;
  storedValue: number;
  expectedValue: number;
  difference: number;
};

export type CapacityIntegrityReport = {
  checkedAt: string;
  tripsChecked: number;
  productsChecked: number;
  partnerDatesChecked: number;
  divergences: CapacityDrift[];
};

export type CapacityIntegritySnapshot = {
  trips: TripSnapshot[];
  inventories: InventorySnapshot[];
  partnerAvailabilities: PartnerAvailabilitySnapshot[];
  partnerClaims?: PartnerClaimSnapshot[];
};

function reservationUnits(reservation: Pick<ReservationSnapshot, "capacityUnits" | "seats">): number {
  return reservation.capacityUnits > 0 ? reservation.capacityUnits : (reservation.seats ?? []).length;
}

function addDrift(
  drifts: CapacityDrift[],
  input: Omit<CapacityDrift, "difference">,
): void {
  if (input.storedValue === input.expectedValue) return;
  drifts.push({
    ...input,
    difference: input.expectedValue - input.storedValue,
  });
}

function detectTripDrifts(trip: TripSnapshot, drifts: CapacityDrift[]): void {
  let computedReserved = 0;
  let computedConfirmed = 0;
  for (const reservation of trip.reservations) {
    const units = reservationUnits(reservation);
    if (reservation.status === RESERVATION_STATUS.CONFIRMED) computedConfirmed += units;
    else computedReserved += units;
  }

  const computedAvailable = Math.max(
    0,
    trip.totalCapacity - computedReserved - computedConfirmed - trip.freePassengerCount,
  );
  addDrift(drifts, {
    tenantId: trip.tenantId,
    resourceType: "trip",
    resourceId: trip.tripId,
    metric: "reserved_seats",
    storedValue: trip.storedReserved,
    expectedValue: computedReserved,
  });
  addDrift(drifts, {
    tenantId: trip.tenantId,
    resourceType: "trip",
    resourceId: trip.tripId,
    metric: "confirmed_seats",
    storedValue: trip.storedConfirmed,
    expectedValue: computedConfirmed,
  });
  addDrift(drifts, {
    tenantId: trip.tenantId,
    resourceType: "trip",
    resourceId: trip.tripId,
    metric: "available_seats",
    storedValue: trip.storedAvailable,
    expectedValue: computedAvailable,
  });
}

function detectInventoryDrifts(product: InventorySnapshot, drifts: CapacityDrift[]): void {
  if (!product.trackInventory || product.allowBackorder) return;

  const expectedSalesCount = product.items
    .filter((item) => item.itemStatus !== "cancelled" && item.salesCountApplied)
    .reduce((total, item) => total + item.quantity, 0);
  addDrift(drifts, {
    tenantId: product.tenantId,
    resourceType: "inventory",
    resourceId: product.productId,
    metric: "sales_count",
    storedValue: product.storedSalesCount,
    expectedValue: expectedSalesCount,
  });

  if (product.storedStock !== null && product.storedStock < 0) {
    addDrift(drifts, {
      tenantId: product.tenantId,
      resourceType: "inventory",
      resourceId: product.productId,
      metric: "stock_quantity_nonnegative",
      storedValue: product.storedStock,
      expectedValue: 0,
    });
  }

  for (const item of product.items) {
    if (item.itemStatus === "cancelled") continue;
    const hasClaim = item.inventoryState === "reserved" || item.inventoryState === "sold";
    if (hasClaim && item.inventoryClaimedQuantity !== item.quantity) {
      addDrift(drifts, {
        tenantId: product.tenantId,
        resourceType: "inventory",
        resourceId: `${product.productId}/item/${item.itemId}`,
        metric: "claimed_quantity",
        storedValue: item.inventoryClaimedQuantity,
        expectedValue: item.quantity,
      });
    }
    // Released claims intentionally retain their quantity as immutable ownership
    // history; only a claim with no state at all is malformed.
    if (item.inventoryClaimedQuantity > 0 && item.inventoryState === null) {
      addDrift(drifts, {
        tenantId: product.tenantId,
        resourceType: "inventory",
        resourceId: `${product.productId}/item/${item.itemId}`,
        metric: "claim_state",
        storedValue: item.inventoryClaimedQuantity,
        expectedValue: 0,
      });
    }
    if (
      (item.inventoryState === "sold" && !item.salesCountApplied)
      || (item.inventoryState === "reserved" && item.salesCountApplied)
    ) {
      addDrift(drifts, {
        tenantId: product.tenantId,
        resourceType: "inventory",
        resourceId: `${product.productId}/item/${item.itemId}`,
        metric: "claim_payment_state",
        storedValue: item.salesCountApplied ? 1 : 0,
        expectedValue: item.inventoryState === "sold" ? 1 : 0,
      });
    }
  }
}

function detectPartnerAvailabilityDrifts(
  availability: PartnerAvailabilitySnapshot,
  drifts: CapacityDrift[],
): void {
  const expectedSpotsUsed = availability.claims
    .filter((claim) =>
      claim.tenantId === availability.tenantId
      && claim.productId === availability.productId
      && claim.date === availability.date,
    )
    .reduce((total, claim) => total + claim.quantity, 0);
  addDrift(drifts, {
    tenantId: availability.tenantId,
    resourceType: "partner_availability",
    resourceId: `${availability.productId}/${availability.date}`,
    metric: "spots_used",
    storedValue: availability.storedSpotsUsed,
    expectedValue: expectedSpotsUsed,
  });
}

export function detectCapacityDrifts(snapshot: CapacityIntegritySnapshot): CapacityDrift[] {
  const drifts: CapacityDrift[] = [];
  for (const trip of snapshot.trips) detectTripDrifts(trip, drifts);
  for (const inventory of snapshot.inventories) detectInventoryDrifts(inventory, drifts);
  for (const availability of snapshot.partnerAvailabilities) {
    detectPartnerAvailabilityDrifts(availability, drifts);
  }
  const representedAvailability = new Set(
    snapshot.partnerAvailabilities.map(
      (availability) => `${availability.tenantId}:${availability.productId}:${availability.date}`,
    ),
  );
  const missingAvailabilityClaims = new Map<string, PartnerClaimSnapshot>();
  for (const claim of snapshot.partnerClaims ?? []) {
    const key = `${claim.tenantId}:${claim.productId}:${claim.date}`;
    if (representedAvailability.has(key)) continue;
    const current = missingAvailabilityClaims.get(key);
    missingAvailabilityClaims.set(key, {
      ...claim,
      quantity: (current?.quantity ?? 0) + claim.quantity,
    });
  }
  for (const claim of missingAvailabilityClaims.values()) {
    addDrift(drifts, {
      tenantId: claim.tenantId,
      resourceType: "partner_availability",
      resourceId: `${claim.productId}/${claim.date}`,
      metric: "spots_used_without_availability",
      storedValue: 0,
      expectedValue: claim.quantity,
    });
  }
  return drifts;
}

/**
 * Reads all persisted capacity claims and compares them with the counters used
 * by checkout. This function deliberately has no UPDATE/DELETE path: historical
 * or manually changed data must be surfaced for an operator rather than guessed
 * back into a valid state.
 */
export async function runCapacityIntegrityCheck(): Promise<CapacityIntegrityReport> {
  const checkedAt = new Date().toISOString();
  try {
    const trips = await db
      .select({
        tripId: tripsTable.id,
        tenantId: tripsTable.tenantId,
        totalCapacity: tripsTable.totalCapacity,
        storedReserved: tripsTable.reservedSeats,
        storedConfirmed: tripsTable.confirmedSeats,
        storedAvailable: tripsTable.availableSeats,
        freePassengers: tripsTable.freePassengers,
      })
      .from(tripsTable)
      .where(and(ne(tripsTable.status, "cancelled"), ne(tripsTable.status, "completed")));

    const reservations = await db
      .select({
        tripId: reservationsTable.tripId,
        tenantId: reservationsTable.tenantId,
        status: reservationsTable.status,
        seats: reservationsTable.seats,
        capacityUnits: reservationsTable.capacityUnits,
      })
      .from(reservationsTable)
      .where(inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES));
    const reservationsByTrip = new Map<string, ReservationSnapshot[]>();
    for (const reservation of reservations) {
      const key = `${reservation.tenantId}:${reservation.tripId}`;
      const current = reservationsByTrip.get(key) ?? [];
      current.push(reservation);
      reservationsByTrip.set(key, current);
    }

    const tripSnapshots: TripSnapshot[] = trips.map((trip) => ({
      tripId: trip.tripId,
      tenantId: trip.tenantId,
      totalCapacity: Number(trip.totalCapacity) || 0,
      storedReserved: Number(trip.storedReserved) || 0,
      storedConfirmed: Number(trip.storedConfirmed) || 0,
      storedAvailable: Number(trip.storedAvailable) || 0,
      freePassengerCount: Array.isArray(trip.freePassengers) ? trip.freePassengers.length : 0,
      reservations: reservationsByTrip.get(`${trip.tenantId}:${trip.tripId}`) ?? [],
    }));

    const products = await db
      .select({
        productId: storeProductsTable.id,
        tenantId: storesTable.tenantId,
        trackInventory: storeProductsTable.trackInventory,
        allowBackorder: storeProductsTable.allowBackorder,
        storedStock: storeProductsTable.stockQuantity,
        storedSalesCount: storeProductsTable.salesCount,
      })
      .from(storeProductsTable)
      .innerJoin(storesTable, eq(storeProductsTable.storeId, storesTable.id));

    const orderItems = await db
      .select({
        itemId: storeOrderItemsTable.id,
        productId: storeOrderItemsTable.productId,
        tenantId: storeOrdersTable.tenantId,
        quantity: storeOrderItemsTable.quantity,
        itemStatus: storeOrderItemsTable.itemStatus,
        inventoryClaimedQuantity: storeOrderItemsTable.inventoryClaimedQuantity,
        inventoryState: storeOrderItemsTable.inventoryState,
        salesCountApplied: storeOrderItemsTable.salesCountApplied,
        partnerProductId: storeOrderItemsTable.partnerProductId,
        partnerCapacityClaimedQuantity: storeOrderItemsTable.partnerCapacityClaimedQuantity,
        metadata: storeOrderItemsTable.metadata,
      })
      .from(storeOrderItemsTable)
      .innerJoin(storeOrdersTable, eq(storeOrderItemsTable.orderId, storeOrdersTable.id))
      .where(ne(storeOrderItemsTable.itemStatus, "cancelled"));
    const itemsByProduct = new Map<string, InventoryItemSnapshot[]>();
    for (const item of orderItems) {
      const current = itemsByProduct.get(`${item.tenantId}:${item.productId}`) ?? [];
      current.push(item);
      itemsByProduct.set(`${item.tenantId}:${item.productId}`, current);
    }
    const inventorySnapshots: InventorySnapshot[] = products.map((product) => ({
      ...product,
      items: itemsByProduct.get(`${product.tenantId}:${product.productId}`) ?? [],
    }));

    const availabilityRows = await db
      .select({
        availabilityId: partnerAvailabilityTable.id,
        tenantId: partnerProductsTable.tenantId,
        productId: partnerAvailabilityTable.productId,
        date: partnerAvailabilityTable.date,
        storedSpotsUsed: partnerAvailabilityTable.spotsUsed,
      })
      .from(partnerAvailabilityTable)
      .innerJoin(partnerProductsTable, eq(partnerAvailabilityTable.productId, partnerProductsTable.id));

    const partnerClaims: PartnerClaimSnapshot[] = [];
    for (const item of orderItems) {
      const partnerDate = item.metadata && typeof item.metadata === "object"
        ? (item.metadata as Record<string, unknown>)["partnerDate"]
        : null;
      if (!item.partnerProductId || typeof partnerDate !== "string" || item.partnerCapacityClaimedQuantity <= 0) continue;
      partnerClaims.push({
        tenantId: item.tenantId,
        productId: item.partnerProductId,
        date: partnerDate,
        quantity: item.partnerCapacityClaimedQuantity,
      });
    }

    const partnerAvailabilitySnapshots = availabilityRows.map((row) => ({
      ...row,
      claims: partnerClaims.filter((claim) => claim.tenantId === row.tenantId),
    }));

    const report: CapacityIntegrityReport = {
      checkedAt,
      tripsChecked: tripSnapshots.length,
      productsChecked: inventorySnapshots.length,
      partnerDatesChecked: partnerAvailabilitySnapshots.length,
      divergences: detectCapacityDrifts({
        trips: tripSnapshots,
        inventories: inventorySnapshots,
        partnerAvailabilities: partnerAvailabilitySnapshots,
        partnerClaims,
      }),
    };

    for (const drift of report.divergences) {
      logger.warn(drift, "[capacity-integrity] divergence detected");
    }
    logger.info({
      tripsChecked: report.tripsChecked,
      productsChecked: report.productsChecked,
      partnerDatesChecked: report.partnerDatesChecked,
      divergences: report.divergences.length,
    }, "[capacity-integrity] read-only check complete");
    return report;
  } catch (error) {
    logger.error({ error }, "[capacity-integrity] read-only check failed");
    return {
      checkedAt,
      tripsChecked: 0,
      productsChecked: 0,
      partnerDatesChecked: 0,
      divergences: [],
    };
  }
}
import { describe, expect, it } from "vitest";
import {
  detectCapacityDrifts,
  type CapacityIntegritySnapshot,
} from "../services/capacity-integrity.js";

describe("capacity integrity checks", () => {
  it("counts capacityUnits when a trip reservation has no numbered seats", () => {
    const snapshot: CapacityIntegritySnapshot = {
      trips: [{
        tripId: "trip-1",
        tenantId: "tenant-a",
        totalCapacity: 5,
        storedReserved: 1,
        storedConfirmed: 0,
        storedAvailable: 4,
        freePassengerCount: 0,
        reservations: [{
          tripId: "trip-1",
          tenantId: "tenant-a",
          status: "pending",
          seats: [],
          capacityUnits: 2,
        }],
      }],
      inventories: [],
      partnerAvailabilities: [],
    };

    expect(detectCapacityDrifts(snapshot)).toEqual([
      {
        tenantId: "tenant-a",
        resourceType: "trip",
        resourceId: "trip-1",
        metric: "reserved_seats",
        storedValue: 1,
        expectedValue: 2,
        difference: 1,
      },
      {
        tenantId: "tenant-a",
        resourceType: "trip",
        resourceId: "trip-1",
        metric: "available_seats",
        storedValue: 4,
        expectedValue: 3,
        difference: -1,
      },
    ]);
  });

  it("compares a controlled product's sales counter with persisted item claims", () => {
    const snapshot: CapacityIntegritySnapshot = {
      trips: [],
      inventories: [{
        productId: "product-1",
        tenantId: "tenant-a",
        trackInventory: true,
        allowBackorder: false,
        storedStock: 8,
        storedSalesCount: 1,
        items: [{
          itemId: "item-1",
          quantity: 2,
          itemStatus: "active",
          inventoryClaimedQuantity: 2,
          inventoryState: "sold",
          salesCountApplied: true,
        }],
      }],
      partnerAvailabilities: [],
    };

    expect(detectCapacityDrifts(snapshot)).toEqual([{
      tenantId: "tenant-a",
      resourceType: "inventory",
      resourceId: "product-1",
      metric: "sales_count",
      storedValue: 1,
      expectedValue: 2,
      difference: 1,
    }]);
  });

  it("compares dated partner capacity with persisted claims in the same agency", () => {
    const snapshot: CapacityIntegritySnapshot = {
      trips: [],
      inventories: [],
      partnerAvailabilities: [{
        availabilityId: "availability-1",
        tenantId: "tenant-a",
        productId: "partner-product-1",
        date: "2026-09-20",
        storedSpotsUsed: 1,
        claims: [{
          tenantId: "tenant-a",
          productId: "partner-product-1",
          date: "2026-09-20",
          quantity: 3,
        }, {
          // A claim from another agency must never affect this availability.
          tenantId: "tenant-b",
          productId: "partner-product-1",
          date: "2026-09-20",
          quantity: 50,
        }],
      }],
    };

    expect(detectCapacityDrifts(snapshot)).toEqual([{
      tenantId: "tenant-a",
      resourceType: "partner_availability",
      resourceId: "partner-product-1/2026-09-20",
      metric: "spots_used",
      storedValue: 1,
      expectedValue: 3,
      difference: 2,
    }]);
  });
});
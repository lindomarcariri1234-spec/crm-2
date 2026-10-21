import { describe, expect, it } from "vitest";
import type { storeProductsTable } from "@workspace/db";
import { applyStorefrontChildPricing, countSeatBearingStorefrontChildren } from "./storefront-child-pricing.js";
import type { PersistedOrderItem } from "./persist-order.js";

function setup(quantity = 3) {
  const product = { id: "product-1", tripId: "trip-1" } as typeof storeProductsTable.$inferSelect;
  const total = 100 * quantity;
  const item: PersistedOrderItem = {
    id: "item-1",
    orderId: "",
    productId: "product-1",
    productName: "Viagem",
    productType: "trip",
    productImage: null,
    variant: null,
    price: "100.00",
    quantity,
    subtotal: total.toFixed(2),
    discount: "0",
    total: total.toFixed(2),
    metadata: null,
  };
  const tripLinkedProducts = new Map([
    ["trip-1", { product, totalQty: quantity, totalValue: total }],
  ]);
  return {
    subtotal: total,
    orderItemsData: [item],
    fetchedProducts: new Map([["product-1", product]]),
    tripLinkedProducts,
  };
}

describe("storefront child ticket pricing", () => {
  it("counts only explicitly declared seated children, excluding lap and legacy companions", () => {
    expect(countSeatBearingStorefrontChildren([
      { isChildUnder7: false, occupiesSeat: true },
      { isChildUnder7: true, occupiesSeat: false },
      { name: "legacy companion" },
    ])).toBe(1);
  });

  it("splits adult and child fares using the trip's configured child price", () => {
    const result = applyStorefrontChildPricing({
      ...setup(),
      childSeatCount: 2,
      priceChildByTrip: new Map([["trip-1", "60.00"]]),
    });

    expect(result.subtotal).toBe(220);
    expect(result.tripLinkedProducts.get("trip-1")?.totalValue).toBe(220);
    expect(result.orderItemsData).toHaveLength(2);
    expect(result.orderItemsData).toEqual(expect.arrayContaining([
      expect.objectContaining({ price: "100.00", quantity: 1, total: "100.00" }),
      expect.objectContaining({
        price: "60.00",
        quantity: 2,
        total: "120.00",
        metadata: { fareCategory: "child" },
      }),
    ]));
  });

  it("falls back to the adult fare only when no child price is configured", () => {
    const result = applyStorefrontChildPricing({
      ...setup(2),
      childSeatCount: 1,
      priceChildByTrip: new Map([["trip-1", null]]),
    });

    expect(result.subtotal).toBe(200);
    expect(result.orderItemsData).toHaveLength(1);
  });

  it("supports a configured zero child fare without reducing seat quantity", () => {
    const result = applyStorefrontChildPricing({
      ...setup(2),
      childSeatCount: 1,
      priceChildByTrip: new Map([["trip-1", 0]]),
    });

    expect(result.subtotal).toBe(100);
    expect(result.tripLinkedProducts.get("trip-1")?.totalQty).toBe(2);
    expect(result.orderItemsData).toEqual(expect.arrayContaining([
      expect.objectContaining({ price: "0.00", quantity: 1, total: "0.00" }),
    ]));
  });
});

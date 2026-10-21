import type { storeProductsTable } from "@workspace/db";
import { generateId } from "../../lib/id.js";
import { roundMoney } from "../../lib/pricing.js";
import type { PersistedOrderItem } from "./persist-order.js";

type TripLinkedProduct = {
  product: typeof storeProductsTable.$inferSelect;
  totalQty: number;
  totalValue: number;
};

export interface StorefrontChildPricingInput {
  subtotal: number;
  orderItemsData: PersistedOrderItem[];
  fetchedProducts: Map<string, typeof storeProductsTable.$inferSelect>;
  tripLinkedProducts: Map<string, TripLinkedProduct>;
  childSeatCount: number;
  priceChildByTrip: Map<string, string | number | null>;
}

export function countSeatBearingStorefrontChildren(
  passengers: readonly {
    name?: string;
    isChildUnder7?: boolean;
    occupiesSeat?: boolean;
  }[],
): number {
  // Only records carrying the new age flag are children. Legacy companions
  // without it remain adult-fare passengers for backward compatibility.
  return passengers.filter(
    (passenger) => passenger.isChildUnder7 !== undefined && passenger.occupiesSeat !== false,
  ).length;
}

/**
 * Reprices explicitly declared, seat-bearing children from the linked trip's
 * configured child fare. The buyer remains the first adult-fare seat. Splitting
 * order lines keeps each persisted unit price accurate for receipts and reports.
 */
export function applyStorefrontChildPricing(
  input: StorefrontChildPricingInput,
): Omit<StorefrontChildPricingInput, "childSeatCount" | "priceChildByTrip"> {
  const {
    subtotal,
    orderItemsData,
    fetchedProducts,
    tripLinkedProducts,
    childSeatCount,
    priceChildByTrip,
  } = input;
  if (childSeatCount <= 0) {
    return { subtotal, orderItemsData, fetchedProducts, tripLinkedProducts };
  }

  let remainingChildren = childSeatCount;
  let buyerSeatAssigned = false;
  let subtotalDelta = 0;
  const valueDeltaByTrip = new Map<string, number>();
  const repricedItems: PersistedOrderItem[] = [];

  for (const item of orderItemsData) {
    const product = fetchedProducts.get(item.productId);
    const tripId = product?.tripId;
    if (!tripId || remainingChildren <= 0) {
      repricedItems.push(item);
      continue;
    }

    const buyerSeatCount = buyerSeatAssigned ? 0 : Math.min(1, item.quantity);
    if (item.quantity > 0) buyerSeatAssigned = true;
    const childQuantity = Math.min(
      remainingChildren,
      Math.max(0, item.quantity - buyerSeatCount),
    );
    if (childQuantity <= 0) {
      repricedItems.push(item);
      continue;
    }
    remainingChildren -= childQuantity;

    const adultPrice = Number(item.price);
    const configuredChildPrice = priceChildByTrip.get(tripId);
    const childPrice = configuredChildPrice == null ? adultPrice : Number(configuredChildPrice);
    if (
      !Number.isFinite(adultPrice) || adultPrice < 0
      || !Number.isFinite(childPrice) || childPrice < 0
    ) {
      throw new Error(`Preço inválido para passageiros da viagem ${tripId}`);
    }
    if (childPrice === adultPrice) {
      repricedItems.push(item);
      continue;
    }

    const adultQuantity = item.quantity - childQuantity;
    const oldTotal = Number(item.total ?? item.subtotal ?? 0);
    const adultTotal = roundMoney(adultPrice * adultQuantity);
    const childTotal = roundMoney(childPrice * childQuantity);
    const newTotal = roundMoney(adultTotal + childTotal);
    const delta = roundMoney(newTotal - oldTotal);
    subtotalDelta = roundMoney(subtotalDelta + delta);
    valueDeltaByTrip.set(
      tripId,
      roundMoney((valueDeltaByTrip.get(tripId) ?? 0) + delta),
    );

    if (adultQuantity > 0) {
      repricedItems.push({
        ...item,
        quantity: adultQuantity,
        subtotal: adultTotal.toFixed(2),
        total: adultTotal.toFixed(2),
      });
    }
    if (childQuantity > 0) {
      repricedItems.push({
        ...item,
        id: adultQuantity > 0 ? generateId() : item.id,
        price: childPrice.toFixed(2),
        quantity: childQuantity,
        subtotal: childTotal.toFixed(2),
        total: childTotal.toFixed(2),
        metadata: { ...(item.metadata ?? {}), fareCategory: "child" },
      });
    }
  }

  if (remainingChildren > 0) {
    throw new Error(`Não foi possível associar ${remainingChildren} criança(s) com poltrona a uma tarifa de viagem`);
  }

  const updatedTripLinkedProducts = new Map(tripLinkedProducts);
  for (const [tripId, delta] of valueDeltaByTrip) {
    const linked = updatedTripLinkedProducts.get(tripId);
    if (linked) {
      updatedTripLinkedProducts.set(tripId, {
        ...linked,
        totalValue: roundMoney(linked.totalValue + delta),
      });
    }
  }

  return {
    subtotal: roundMoney(subtotal + subtotalDelta),
    orderItemsData: repricedItems,
    fetchedProducts,
    tripLinkedProducts: updatedTripLinkedProducts,
  };
}

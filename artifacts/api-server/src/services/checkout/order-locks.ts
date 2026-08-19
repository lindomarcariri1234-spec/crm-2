import { storeProductsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Tx } from "./tx";

export async function lockTripsForCheckout(
  tx: Tx,
  args: {
    tenantId: string;
    tripLinkedProducts: Map<string, { product: typeof storeProductsTable.$inferSelect; totalQty: number; totalValue: number }>;
  },
): Promise<Map<string, string>> {
  const { tenantId, tripLinkedProducts } = args;
  const lockedTripTypes = new Map<string, string>();
  const sortedTripIds = Array.from(tripLinkedProducts.keys()).sort();
  for (const tripId of sortedTripIds) {
    const { product, totalQty } = tripLinkedProducts.get(tripId)!;
    const lockResult = await tx.execute(
      sql`SELECT id, available_seats, type FROM trips WHERE id = ${tripId} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
    const row = (lockResult as unknown as { rows: Array<{ id: string; available_seats: number; type: string }> }).rows[0];
    if (!row) {
      const tripErr = new Error("trip_not_found");
      (tripErr as Error & Record<string, unknown>).productName = product.name;
      throw tripErr;
    }
    const currentSeats = Number(row.available_seats);
    if (currentSeats < totalQty) {
      const seatErr = new Error("no_seats");
      (seatErr as Error & Record<string, unknown>).productName = product.name;
      (seatErr as Error & Record<string, unknown>).available = currentSeats;
      throw seatErr;
    }
    lockedTripTypes.set(tripId, row.type ?? "");
  }
  return lockedTripTypes;
}

export async function lockProductsForCheckout(
  tx: Tx,
  args: {
    fetchedProducts: Map<string, typeof storeProductsTable.$inferSelect>;
    quantityByProductId: Map<string, number>;
  },
): Promise<void> {
  const { fetchedProducts, quantityByProductId } = args;
  const trackedProductIds = Array.from(fetchedProducts.values())
    .filter((p) => p.trackInventory && !p.allowBackorder)
    .map((p) => p.id)
    .sort();
  for (const productId of trackedProductIds) {
    const product = fetchedProducts.get(productId)!;
    const lockResult = await tx.execute(
      sql`SELECT id, stock_quantity FROM store_products WHERE id = ${product.id} FOR UPDATE`,
    );
    const row = (lockResult as unknown as { rows: Array<{ id: string; stock_quantity: number | null }> }).rows[0];
    const currentStock = Number(row?.stock_quantity ?? 0);
    const totalRequested = quantityByProductId.get(product.id) ?? 0;
    if (currentStock < totalRequested) {
      const stockErr = new Error("insufficient_stock");
      (stockErr as Error & Record<string, unknown>).productName = product.name;
      (stockErr as Error & Record<string, unknown>).available = currentStock;
      throw stockErr;
    }
  }
}

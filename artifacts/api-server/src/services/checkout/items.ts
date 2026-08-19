import { db } from "@workspace/db";
import { storeProductsTable, tripsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { ValidationError, ConflictError } from "../../lib/errors";
import { generateId } from "../../lib/id";
import type { PersistedOrderItem } from "./persist-order";

export interface CheckoutItemInput {
  productId: string;
  quantity: number;
  variantLabel?: string;
  variantData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PreparedCheckoutItems {
  subtotal: number;
  orderItemsData: PersistedOrderItem[];
  fetchedProducts: Map<string, typeof storeProductsTable.$inferSelect>;
  quantityByProductId: Map<string, number>;
  tripLinkedProducts: Map<string, { product: typeof storeProductsTable.$inferSelect; totalQty: number; totalValue: number }>;
}

export async function prepareCheckoutItems(args: {
  storeId: string;
  tenantId: string;
  items: CheckoutItemInput[];
}): Promise<PreparedCheckoutItems> {
  const { storeId, tenantId, items } = args;

  const quantityByProductId = new Map<string, number>();
  for (const item of items) {
    quantityByProductId.set(item.productId, (quantityByProductId.get(item.productId) ?? 0) + item.quantity);
  }

  let subtotal = 0;
  const orderItemsData: PersistedOrderItem[] = [];
  const fetchedProducts = new Map<string, typeof storeProductsTable.$inferSelect>();
  const tripLinkedProducts = new Map<string, { product: typeof storeProductsTable.$inferSelect; totalQty: number; totalValue: number }>();

  for (const item of items) {
    if (!fetchedProducts.has(item.productId)) {
      const [product] = await db.select().from(storeProductsTable)
        .where(and(
          eq(storeProductsTable.id, item.productId),
          eq(storeProductsTable.storeId, storeId),
          eq(storeProductsTable.status, "active"),
        )).limit(1);
      if (!product) {
        throw new ValidationError(`Product ${item.productId} not found or unavailable`, "VALIDATION_ERROR");
      }
      if (product.trackInventory && !product.allowBackorder) {
        const totalRequested = quantityByProductId.get(product.id) ?? item.quantity;
        const available = product.stockQuantity ?? 0;
        if (available < totalRequested) {
          throw new ConflictError(`Estoque insuficiente para "${product.name}". Disponível: ${available}`, "INSUFFICIENT_STOCK");
        }
      }
      fetchedProducts.set(product.id, product);
    }
    const product = fetchedProducts.get(item.productId)!;
    const price = parseFloat(product.onSale && product.salePrice ? product.salePrice : product.price);
    const lineTotal = price * item.quantity;
    subtotal += lineTotal;
    orderItemsData.push({
      id: generateId(),
      orderId: "",
      productId: product.id,
      productName: product.name,
      productType: product.type,
      productImage: product.thumbnail,
      variant: item.variantData || (item.variantLabel ? { label: item.variantLabel } : null),
      price: price.toFixed(2),
      quantity: item.quantity,
      subtotal: lineTotal.toFixed(2),
      discount: "0",
      total: lineTotal.toFixed(2),
      metadata: item.metadata || null,
    });
  }

  for (const [productId, product] of fetchedProducts) {
    if (!product.tripId) continue;
    const totalQty = quantityByProductId.get(productId) ?? 0;
    if (totalQty <= 0) continue;
    const productPrice = parseFloat(product.onSale && product.salePrice ? product.salePrice : product.price);
    const existing = tripLinkedProducts.get(product.tripId);
    if (existing) {
      existing.totalQty += totalQty;
      existing.totalValue += productPrice * totalQty;
    } else {
      tripLinkedProducts.set(product.tripId, { product, totalQty, totalValue: productPrice * totalQty });
    }
  }

  for (const [tripId, { product, totalQty }] of tripLinkedProducts) {
    const [trip] = await db.select({ availableSeats: tripsTable.availableSeats })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, tenantId)))
      .limit(1);
    if (!trip) {
      throw new ValidationError(`Viagem vinculada ao produto "${product.name}" não encontrada`, "TRIP_NOT_FOUND");
    }
    if (trip.availableSeats < totalQty) {
      throw new ConflictError(`Sem vagas suficientes para "${product.name}". Disponível: ${trip.availableSeats} vaga(s)`, "INSUFFICIENT_SEATS");
    }
  }

  return { subtotal, orderItemsData, fetchedProducts, quantityByProductId, tripLinkedProducts };
}

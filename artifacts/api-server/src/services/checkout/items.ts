import { db } from "@workspace/db";
import { storeProductsTable, tripsTable, partnerProductsTable, partnersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { ValidationError, ConflictError } from "../../lib/errors";
import { generateId } from "../../lib/id";
import type { PersistedOrderItem } from "./persist-order";

export interface CheckoutItemInput {
  productId: string;
  quantity: number;
  variantName?: string;
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
  partnerAttributions: Map<string, { partnerId: string; partnerProductId: string; sellerName: string }>;
}

export function resolveCheckoutUnitPrice(
  product: typeof storeProductsTable.$inferSelect,
  item: Pick<CheckoutItemInput, "variantName" | "variantLabel">,
): number {
  const basePrice = Number(product.onSale && product.salePrice ? product.salePrice : product.price);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (!product.hasVariants || variants.length === 0) return basePrice;

  const label = item.variantLabel?.trim();
  if (!label) {
    throw new ValidationError(`Selecione uma opção para "${product.name}"`, "PRODUCT_VARIANT_REQUIRED");
  }
  const requestedName = item.variantName?.trim();
  const matchingOptions = variants.flatMap((rawVariant) => {
    if (!rawVariant || typeof rawVariant !== "object") return [];
    const variant = rawVariant as { name?: unknown; options?: unknown };
    if (requestedName && variant.name !== requestedName) return [];
    if (!Array.isArray(variant.options)) return [];
    return variant.options.flatMap((rawOption) => {
      if (!rawOption || typeof rawOption !== "object") return [];
      const option = rawOption as { label?: unknown; price?: unknown };
      return option.label === label ? [{ option, name: variant.name }] : [];
    });
  });
  if (matchingOptions.length !== 1) {
    throw new ValidationError(
      `A opção selecionada para "${product.name}" não está disponível`,
      "INVALID_PRODUCT_VARIANT",
    );
  }

  const price = Number(matchingOptions[0]!.option.price);
  if (!Number.isFinite(price) || price < 0) {
    throw new ValidationError(
      `O preço da opção selecionada para "${product.name}" é inválido`,
      "INVALID_PRODUCT_VARIANT_PRICE",
    );
  }
  return price;
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
  const valueByProductId = new Map<string, number>();
  const tripLinkedProducts = new Map<string, { product: typeof storeProductsTable.$inferSelect; totalQty: number; totalValue: number }>();
  const partnerAttributions = new Map<string, { partnerId: string; partnerProductId: string; sellerName: string }>();

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
      if (product.partnerProductId) {
        const [partnerOffer] = await db.select({
          partnerId: partnerProductsTable.partnerId,
          partnerProductId: partnerProductsTable.id,
          sellerName: partnersTable.name,
          offerStatus: partnerProductsTable.status,
          partnerStatus: partnersTable.status,
          type: partnerProductsTable.type,
        }).from(partnerProductsTable)
          .innerJoin(partnersTable, eq(partnersTable.id, partnerProductsTable.partnerId))
          .where(and(
            eq(partnerProductsTable.id, product.partnerProductId),
            eq(partnerProductsTable.tenantId, tenantId),
          ))
          .limit(1);
        if (!partnerOffer || partnerOffer.offerStatus !== "active" || partnerOffer.partnerStatus !== "active") {
          throw new ConflictError(`A oferta de parceiro "${product.name}" não está disponível`, "PARTNER_OFFER_UNAVAILABLE");
        }
        if (partnerOffer.type === "passeio" || partnerOffer.type === "experiencia") {
          const partnerDate = item.metadata?.["partnerDate"];
          if (typeof partnerDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(partnerDate)) {
            throw new ValidationError(`Selecione uma data válida para "${product.name}"`, "PARTNER_DATE_REQUIRED");
          }
        }
        partnerAttributions.set(product.id, {
          partnerId: partnerOffer.partnerId,
          partnerProductId: partnerOffer.partnerProductId,
          sellerName: partnerOffer.sellerName,
        });
      }
      fetchedProducts.set(product.id, product);
    }
    const product = fetchedProducts.get(item.productId)!;
    const price = resolveCheckoutUnitPrice(product, item);
    const lineTotal = price * item.quantity;
    subtotal += lineTotal;
    valueByProductId.set(product.id, (valueByProductId.get(product.id) ?? 0) + lineTotal);
    orderItemsData.push({
      id: generateId(),
      orderId: "",
      productId: product.id,
      productName: product.name,
      productType: product.type,
      productImage: product.thumbnail,
      variant: item.variantData || (item.variantLabel
        ? { ...(item.variantName ? { name: item.variantName } : {}), label: item.variantLabel }
        : null),
      price: price.toFixed(2),
      quantity: item.quantity,
      subtotal: lineTotal.toFixed(2),
      discount: "0",
      total: lineTotal.toFixed(2),
      metadata: item.metadata || null,
      ...partnerAttributions.get(product.id),
    });
  }

  for (const [productId, product] of fetchedProducts) {
    if (!product.tripId) continue;
    const totalQty = quantityByProductId.get(productId) ?? 0;
    if (totalQty <= 0) continue;
    const totalValue = valueByProductId.get(productId) ?? 0;
    const existing = tripLinkedProducts.get(product.tripId);
    if (existing) {
      existing.totalQty += totalQty;
      existing.totalValue += totalValue;
    } else {
      tripLinkedProducts.set(product.tripId, { product, totalQty, totalValue });
    }
  }

  for (const [tripId, { product, totalQty }] of tripLinkedProducts) {
    const [trip] = await db.select({
      availableSeats: tripsTable.availableSeats,
      status: tripsTable.status,
    })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, tenantId)))
      .limit(1);
    if (!trip) {
      throw new ValidationError(`Viagem vinculada ao produto "${product.name}" não encontrada`, "TRIP_NOT_FOUND");
    }
    if (trip.status === "completed") {
      throw new ConflictError(
        `A viagem "${product.name}" já foi realizada e não está mais disponível para compra`,
        "TRIP_COMPLETED",
      );
    }
    if (trip.availableSeats < totalQty) {
      throw new ConflictError(`Sem vagas suficientes para "${product.name}". Disponível: ${trip.availableSeats} vaga(s)`, "INSUFFICIENT_SEATS");
    }
  }

  return { subtotal, orderItemsData, fetchedProducts, quantityByProductId, tripLinkedProducts, partnerAttributions };
}

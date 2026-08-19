import { db } from "@workspace/db";
import { localToday } from "@workspace/shared";
import {
  storesTable,
  storeProductsTable,
  storeOrdersTable,
  storeOrderItemsTable,
  storeCouponsTable,
  partnersTable,
  partnerProductsTable,
  partnerCommissionsTable,
  referralsTable,
} from "@workspace/db";
import { and, eq, sql, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../lib/reservation-payments";
import { generateId } from "../../lib/id";
import { roundMoney } from "../../lib/pricing";
import { lockProductsForCheckout } from "./order-locks";
import type { Tx } from "./tx";
import { REFERRAL_STATUS } from "@workspace/permissions";

export interface PersistedOrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  productType: string;
  productImage: string | null;
  variant: Record<string, unknown> | null;
  price: string;
  quantity: number;
  subtotal: string;
  discount: string;
  total: string;
  metadata: Record<string, unknown> | null;
}

export interface PersistOrderArgs {
  store: typeof storesTable.$inferSelect;
  data: {
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    customerCpf?: string;
    customerAddress?: Record<string, unknown>;
    items: Array<{ productId: string; quantity: number }>;
    couponCode?: string;
    referralCookieId?: string;
    paymentMethod?: string;
    paymentProvider?: string;
    notes?: string;
    customerNotes?: string;
    ipAddress?: string;
    userAgent?: string;
    seats?: string[];
    boardingLocationId?: string;
    coPassengers?: Array<{ name: string; cpf?: string; phone?: string }>;
    depositAmount?: number;
  };
  orderId: string;
  orderNumber: string;
  orderPaymentToken: string;
  subtotal: number;
  /** Combined discount (promo coupon/referral code + referral-credit spend) — stored on order record */
  discountAmount: number;
  /** Promo-only discount (coupon or referral-code) — used for reservation.discountReferralAmount analytics */
  promoDiscountAmount: number;
  totalAmount: number;
  couponId?: string;
  appliedReferralCode?: string;
  appliedReferralReferrerId?: string;
  appliedReferralDiscountValue: number;
  appliedReferralDiscountType: string;
  orderItemsData: PersistedOrderItem[];
  fetchedProducts: Map<string, typeof storeProductsTable.$inferSelect>;
  quantityByProductId: Map<string, number>;
  tripLinkedProducts: Map<string, { product: typeof storeProductsTable.$inferSelect; totalQty: number; totalValue: number }>;
  parsedBirthDate: Date | null;
  /** Referral rows to mark as (partially) consumed for credit spend — processed inside the transaction */
  creditSpend?: Array<{ id: string; consumedAmount: number }>;
}

export interface PersistOrderResult {
  reservationClientId: string | null;
}

async function writePartnerCommissions(
  tx: Tx,
  tenantId: string,
  orderId: string,
  orderItemsData: PersistedOrderItem[],
  fetchedProducts: Map<string, typeof storeProductsTable.$inferSelect>,
): Promise<void> {
  const partnerProductTotals = new Map<string, number>();
  for (const item of orderItemsData) {
    const product = fetchedProducts.get(item.productId);
    const ppId = (product as typeof storeProductsTable.$inferSelect & { partnerProductId?: string | null }).partnerProductId;
    if (!ppId) continue;
    partnerProductTotals.set(ppId, (partnerProductTotals.get(ppId) ?? 0) + Number(item.total));
  }
  if (partnerProductTotals.size === 0) return;

  const ppIds = [...partnerProductTotals.keys()];
  const partnerProducts = await tx
    .select({ id: partnerProductsTable.id, partnerId: partnerProductsTable.partnerId })
    .from(partnerProductsTable)
    .where(inArray(partnerProductsTable.id, ppIds));

  const partnerIds = [...new Set(partnerProducts.map((p) => p.partnerId))];
  const partners = await tx
    .select({ id: partnersTable.id, commissionPct: partnersTable.commissionPct })
    .from(partnersTable)
    .where(inArray(partnersTable.id, partnerIds));

  const partnerMap = new Map(partners.map((p) => [p.id, p]));
  // Use Brazil calendar month so partner commissions are attributed to the correct period at night
  const period = localToday().slice(0, 7); // "YYYY-MM" in America/Sao_Paulo

  // Group by partnerId so there is exactly one commission row per partner per order
  const partnerGrossMap = new Map<string, number>();
  for (const pp of partnerProducts) {
    const gross = partnerProductTotals.get(pp.id) ?? 0;
    partnerGrossMap.set(pp.partnerId, (partnerGrossMap.get(pp.partnerId) ?? 0) + gross);
  }

  for (const [partnerId, grossAmount] of partnerGrossMap) {
    if (grossAmount <= 0) continue;
    const partner = partnerMap.get(partnerId);
    if (!partner) continue;
    const agencyPct = Number(partner.commissionPct);
    const agencyAmount = roundMoney(grossAmount * agencyPct / 100);
    const partnerAmount = grossAmount - agencyAmount;
    await tx.insert(partnerCommissionsTable).values({
      id: generateId(),
      orderId,
      partnerId,
      tenantId,
      grossAmount: grossAmount.toFixed(2),
      partnerAmount: partnerAmount.toFixed(2),
      agencyAmount: agencyAmount.toFixed(2),
      status: "pending",
      period,
    });
  }
}

async function writeOrderAndItems(tx: Tx, args: PersistOrderArgs, reservationClientId: string | null, pendingReferralId?: string): Promise<void> {
  const {
    store, data, orderId, orderNumber, orderPaymentToken,
    subtotal, discountAmount, totalAmount, couponId, orderItemsData,
  } = args;

  await tx.insert(storeOrdersTable).values({
    id: orderId,
    storeId: store.id,
    tenantId: store.tenantId,
    orderNumber,
    paymentToken: orderPaymentToken,
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    customerPhone: data.customerPhone ?? "",
    ...(reservationClientId && { clientId: reservationClientId }),
    ...(data.customerCpf && { customerCpf: data.customerCpf }),
    ...(args.parsedBirthDate && { customerBirthdate: args.parsedBirthDate.toISOString().slice(0, 10) }),
    ...(data.customerAddress && { customerAddress: data.customerAddress }),
    subtotal: subtotal.toFixed(2),
    discountAmount: discountAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    ...(data.depositAmount != null ? {
      depositAmount: data.depositAmount.toFixed(2),
      amountRemaining: (totalAmount - data.depositAmount).toFixed(2),
    } : {}),
    ...(couponId && { couponId }),
    ...(data.couponCode && { couponCode: data.couponCode }),
    // Persist referral conversion + referral-credit intent on the order. The
    // actual crediting/consumption (bonus calculation, tier upgrade) is deferred
    // to payment confirmation (applyDeferredOrderCredits). However, a PENDING
    // row is already inserted into referrals at checkout time (see persistCheckoutOrder)
    // so the referral is visible immediately — pendingReferralId links the order to it.
    ...(args.appliedReferralCode && args.appliedReferralReferrerId && {
      pendingReferral: {
        code: args.appliedReferralCode,
        referrerId: args.appliedReferralReferrerId,
        discountValue: args.appliedReferralDiscountValue,
        discountType: args.appliedReferralDiscountType,
        cookieId: data.referralCookieId ?? null,
        // ID of the already-inserted pending referral row so applyDeferredOrderCredits
        // can UPDATE it to completed instead of inserting a duplicate.
        referralId: pendingReferralId ?? null,
      },
    }),
    ...(args.creditSpend && args.creditSpend.length > 0 && {
      pendingCreditSpend: args.creditSpend,
    }),
    paymentMethod: data.paymentMethod ?? "pending",
    paymentProvider: data.paymentProvider ?? "manual",
    ...(data.customerNotes && { customerNotes: data.customerNotes }),
    ...((data.notes && !data.customerNotes) && { customerNotes: data.notes }),
    ...(data.ipAddress && { ipAddress: data.ipAddress }),
    ...(data.userAgent && { userAgent: data.userAgent }),
    // Logistics chosen by the customer during vitrine checkout.
    // Saved here so createReservationsForOrder (post-payment) can honour the
    // customer's selection instead of auto-assigning seats and leaving
    // boardingLocationId blank on the resulting CRM reservation.
    ...(data.boardingLocationId && { boardingLocationId: data.boardingLocationId }),
    ...(data.seats && data.seats.length > 0 && { seats: data.seats }),
    // Co-passenger data collected when qty > 1. createReservationsForOrder
    // reads this to create one passengersTable row per seat.
    ...(data.coPassengers && data.coPassengers.length > 0 && { coPassengers: data.coPassengers }),
  });

  for (const itemData of orderItemsData) {
    itemData.orderId = orderId;
    await tx.insert(storeOrderItemsTable).values(itemData);
  }
}


export async function persistCheckoutOrder(args: PersistOrderArgs): Promise<PersistOrderResult> {
  await db.transaction(async (tx) => {
    await lockProductsForCheckout(tx, {
      fetchedProducts: args.fetchedProducts,
      quantityByProductId: args.quantityByProductId,
    });

    // CRM client upsert is intentionally NOT performed here. An anonymous
    // caller does not need to be authenticated to submit a checkout form, so
    // creating or updating a clientsTable row at this point would let unpaid
    // submissions pollute tenant CRM data. The client is created/linked inside
    // createReservationsForOrder, which runs only after payment is confirmed.

    // Insert a PENDING referral row immediately at checkout time so the referral
    // is visible in both the agency panel and the referrer's portal right away —
    // without waiting for payment confirmation. The full conversion (bonus amount,
    // tier computation, loyalty points) is still deferred to payment time via
    // applyDeferredOrderCredits, which will UPDATE this row to 'completed'.
    // This is safe: the row only credits the referrer after payment, and the
    // referralId is stored in pendingReferral so applyDeferredOrderCredits can
    // find and update it without inserting a duplicate.
    let pendingReferralId: string | undefined;
    if (args.appliedReferralCode && args.appliedReferralReferrerId) {
      pendingReferralId = generateId();
      await tx.insert(referralsTable).values({
        id: pendingReferralId,
        tenantId: args.store.tenantId,
        referrerId: args.appliedReferralReferrerId,
        code: args.appliedReferralCode,
        status: REFERRAL_STATUS.PENDING,
        source: "store",
        referredEmail: args.data.customerEmail,
        referredName: args.data.customerName,
        discountApplied: true,
        discountValue: args.appliedReferralDiscountValue.toFixed(2),
        discountType: args.appliedReferralDiscountType,
        discountAmount: args.promoDiscountAmount.toFixed(2),
        bonusAmount: "0",
        ...(args.data.ipAddress && { ipAddress: args.data.ipAddress }),
        ...(args.data.referralCookieId && { cookieId: args.data.referralCookieId }),
      });
    }

    await writeOrderAndItems(tx, args, null, pendingReferralId);
    await writePartnerCommissions(tx, args.store.tenantId, args.orderId, args.orderItemsData, args.fetchedProducts);

    // Reservations are NOT created here. They are created after payment confirmation
    // (Stripe webhook or manual payment entry) to prevent anonymous users from holding
    // trip inventory without paying. See createReservationsForOrder in create-reservations.ts.

    // Stock decrement, coupon usageCount increment, and totalOrders increment are
    // intentionally NOT performed here. They are deferred to applyOrderInventoryEffects,
    // which is called from payment-confirmation paths (gateway webhook + manual payment)
    // so that anonymous unpaid checkout submissions cannot drain inventory, exhaust
    // coupon limits, or inflate store metrics without completing payment.

    // Referral bonus crediting (referrer's bonus amount, tier upgrade, loyalty points)
    // and referral-credit consumption are NOT performed here. They are applied only
    // after payment is confirmed by applyDeferredOrderCredits, which updates the
    // already-inserted PENDING referral row to 'completed'. This prevents anonymous
    // or unpaid checkout submissions from crediting a referrer or burning a
    // customer's credit, and lets the conversion be linked to a real reservation
    // so it is reversible on cancellation.
  });

  // Referral-converted / tier-upgrade / WhatsApp notifications and referral-code
  // generation for the checkout client are intentionally NOT dispatched here.
  // They are deferred to runPostPaymentSideEffects so they only fire after the
  // order's payment is confirmed.

  return { reservationClientId: null };
}

/**
 * Apply inventory side-effects that must only happen AFTER payment is confirmed:
 *   - Decrement stockQuantity / increment salesCount for each ordered product
 *   - Increment the order's coupon usageCount (if a coupon was used)
 *   - Increment the store's totalOrders counter
 *
 * This is called from applyGatewayPayment (inside the already-idempotent
 * payment transaction) and from the manual-payment confirmation handler in
 * store.ts (gated by a pre-check of the order's current paymentStatus so it
 * only fires on the UNPAID → PAID transition).
 *
 * Moving these writes from order-creation time to payment-confirmation time
 * prevents anonymous, non-paying checkout submissions from draining inventory,
 * exhausting coupon limits, or inflating store metrics.
 */
export async function applyOrderInventoryEffects(orderId: string, tx: DbExecutor): Promise<void> {
  const [order] = await tx
    .select({ storeId: storeOrdersTable.storeId, couponId: storeOrdersTable.couponId })
    .from(storeOrdersTable)
    .where(eq(storeOrdersTable.id, orderId))
    .limit(1);
  if (!order) return;

  const items = await tx
    .select({ productId: storeOrderItemsTable.productId, quantity: storeOrderItemsTable.quantity })
    .from(storeOrderItemsTable)
    .where(eq(storeOrderItemsTable.orderId, orderId));
  if (items.length === 0) return;

  const quantityByProductId = new Map<string, number>();
  for (const item of items) {
    quantityByProductId.set(item.productId, (quantityByProductId.get(item.productId) ?? 0) + item.quantity);
  }

  const productIds = [...quantityByProductId.keys()];
  const products = await tx
    .select({ id: storeProductsTable.id, trackInventory: storeProductsTable.trackInventory })
    .from(storeProductsTable)
    .where(inArray(storeProductsTable.id, productIds));

  for (const product of products) {
    const totalQty = quantityByProductId.get(product.id) ?? 0;
    if (product.trackInventory) {
      await tx.update(storeProductsTable).set({
        stockQuantity: sql`GREATEST(0, COALESCE(stock_quantity, 0) - ${totalQty})`,
        salesCount: sql`sales_count + ${totalQty}`,
      }).where(eq(storeProductsTable.id, product.id));
    } else {
      await tx.update(storeProductsTable).set({
        salesCount: sql`sales_count + ${totalQty}`,
      }).where(eq(storeProductsTable.id, product.id));
    }
  }

  if (order.couponId) {
    await tx.update(storeCouponsTable)
      .set({ usageCount: sql`usage_count + 1` })
      .where(eq(storeCouponsTable.id, order.couponId));
  }

  await tx.update(storesTable)
    .set({ totalOrders: sql`total_orders + 1` })
    .where(eq(storesTable.id, order.storeId));
}

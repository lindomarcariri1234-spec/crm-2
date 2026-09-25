/**
 * Real PostgreSQL integration coverage for the first-purchase referral claim.
 *
 * The two checkouts use different order IDs but the same tenant, referral code,
 * and customer email. The advisory transaction lock in persist-order.ts must
 * serialize them so only one pending referral reservation is committed.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  referralsTable,
  referralSettingsTable,
  storeOrdersTable,
  storeProductsTable,
  storesTable,
  tenantsTable,
} from "@workspace/db";

import {
  persistCheckoutOrder,
  type PersistOrderArgs,
} from "../services/checkout/persist-order.js";

const run = randomUUID().replaceAll("-", "").slice(0, 12);
const tenantId = `first-purchase-race-tenant-${run}`;
const storeId = `first-purchase-race-store-${run}`;
const productId = `first-purchase-race-product-${run}`;
const settingsId = `first-purchase-race-settings-${run}`;
const referrerId = `first-purchase-race-referrer-${run}`;
const referralCode = `FIRST-RACE-${run}`;
const customerEmail = `first-purchase-race-customer-${run}@example.com`;

const orderIds = [
  `first-purchase-race-order-a-${run}`,
  `first-purchase-race-order-b-${run}`,
];

function makePersistArgs(orderId: string, orderNumber: string): PersistOrderArgs {
  const product = productFixture;
  return {
    store: storeFixture,
    data: {
      customerName: "First purchase race customer",
      customerEmail,
      customerPhone: "85999990000",
      items: [{ productId, quantity: 1 }],
      paymentMethod: "pix",
      paymentProvider: "integration-test",
    },
    orderId,
    orderNumber,
    orderPaymentToken: `payment-token-${orderId}`,
    subtotal: 100,
    discountAmount: 10,
    promoDiscountAmount: 10,
    totalAmount: 90,
    appliedReferralCode: referralCode,
    appliedReferralReferrerId: referrerId,
    appliedReferralDiscountValue: 10,
    appliedReferralDiscountType: "percentage",
    orderItemsData: [{
      id: `first-purchase-race-item-${orderId}`,
      orderId,
      productId,
      productName: product.name,
      productType: product.type,
      productImage: null,
      variant: null,
      price: "100.00",
      quantity: 1,
      subtotal: "100.00",
      discount: "10.00",
      total: "90.00",
      metadata: null,
    }],
    fetchedProducts: new Map([[productId, product]]),
    quantityByProductId: new Map([[productId, 1]]),
    tripLinkedProducts: new Map(),
    parsedBirthDate: null,
  };
}

let storeFixture: typeof storesTable.$inferSelect;
let productFixture: typeof storeProductsTable.$inferSelect;

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error(
      "DATABASE_URL must be set to run the first-purchase referral concurrency integration test",
    );
  }

  await db.insert(tenantsTable).values({
    id: tenantId,
    name: "First purchase race test agency",
    slug: `first-purchase-race-${run}`,
    email: `first-purchase-race-agency-${run}@example.com`,
  });
  await db.insert(storesTable).values({
    id: storeId,
    tenantId,
    name: "First purchase race test store",
    slug: `first-purchase-race-store-${run}`,
    email: `first-purchase-race-store-${run}@example.com`,
  });
  await db.insert(storeProductsTable).values({
    id: productId,
    storeId,
    type: "product",
    name: "First purchase race test product",
    slug: `first-purchase-race-product-${run}`,
    price: "100.00",
    // Avoid competing with the referral reservation lock in this test.
    trackInventory: false,
    allowBackorder: true,
    status: "published",
  });
  await db.insert(referralSettingsTable).values({
    id: settingsId,
    tenantId,
    requireFirstPurchase: true,
    discountValue: "10",
    discountType: "percentage",
  });

  const [store] = await db
    .select()
    .from(storesTable)
    .where(eq(storesTable.id, storeId));
  const [product] = await db
    .select()
    .from(storeProductsTable)
    .where(eq(storeProductsTable.id, productId));
  if (!store || !product) {
    throw new Error("Could not load the first-purchase referral integration fixtures");
  }
  storeFixture = store;
  productFixture = product;
});

afterAll(async () => {
  await db.delete(referralsTable).where(eq(referralsTable.tenantId, tenantId));
  // The store and its orders/products/settings are tenant-owned and cascade.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("persistCheckoutOrder — first-purchase referral reservation under concurrent checkouts", () => {
  it("commits one pending referral and rejects the other checkout", async () => {
    const results = await Promise.allSettled([
      persistCheckoutOrder(
        makePersistArgs(orderIds[0]!, `FIRST-RACE-ORDER-A-${run}`),
      ),
      persistCheckoutOrder(
        makePersistArgs(orderIds[1]!, `FIRST-RACE-ORDER-B-${run}`),
      ),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<unknown> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = rejected[0]!.reason as { code?: string };
    expect(rejection.code).toBe("REFERRAL_FIRST_PURCHASE_RESERVED");

    const referrals = await db
      .select({
        id: referralsTable.id,
        status: referralsTable.status,
        referredEmail: referralsTable.referredEmail,
        source: referralsTable.source,
      })
      .from(referralsTable)
      .where(and(
        eq(referralsTable.tenantId, tenantId),
        eq(referralsTable.code, referralCode),
      ));
    expect(referrals).toHaveLength(1);
    expect(referrals[0]).toMatchObject({
      status: "pending",
      referredEmail: customerEmail,
      source: "store",
    });

    const orders = await db
      .select({
        id: storeOrdersTable.id,
        pendingReferral: storeOrdersTable.pendingReferral,
      })
      .from(storeOrdersTable)
      .where(and(
        eq(storeOrdersTable.tenantId, tenantId),
        eq(storeOrdersTable.customerEmail, customerEmail),
      ));
    expect(orders).toHaveLength(1);
    expect(orders[0]?.pendingReferral).toMatchObject({
      code: referralCode,
      referrerId,
      referralId: referrals[0]!.id,
    });
  });
});
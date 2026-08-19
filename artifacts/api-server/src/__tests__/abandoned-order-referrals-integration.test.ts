/**
 * Integration test: confirms the abandoned-order referral sweep's fallback
 * `isNull(reservationId)` guard prevents reversing trip-linked PENDING referrals.
 *
 * The fallback path (used for legacy orders that lack `referralId` in the
 * `pendingReferral` JSONB) includes `AND reservation_id IS NULL`. Trip-linked
 * referrals have a non-null `reservation_id` and are handled by the reservation-
 * cancellation path in reservations.ts. A future schema change or query refactor
 * that drops this guard could silently reverse reservation-path referrals.
 *
 * This test exercises the real database (no mocks) so the actual SQL is
 * evaluated by Postgres.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  tenantsTable,
  tripsTable,
  usersTable,
  reservationsTable,
  referralsTable,
  storeOrdersTable,
  storesTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { REFERRAL_STATUS, RESERVATION_STATUS, STORE_PAYMENT_STATUS } from "@workspace/permissions";

import { generateId } from "../lib/id";
import { runAbandonedOrderReferralCleanup, _resetAlertState, ABANDONED_ORDER_THRESHOLD_HOURS } from "../lib/abandoned-order-referrals.js";

const TENANT_ID = `test-tenant-${generateId()}`;
const TRIP_ID = `test-trip-${generateId()}`;
const USER_ID = `test-user-${generateId()}`;
const STORE_ID = `test-store-${generateId()}`;

const reservationIds: string[] = [];
const referralIds: string[] = [];
const storeOrderIds: string[] = [];

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run the abandoned-order referral integration test");
  }

  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Abandoned Sweep Test Agency",
    slug: `abandoned-test-${generateId()}`,
    email: `abandoned-${generateId()}@example.com`,
  });

  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: `clerk-${generateId()}`,
    tenantId: TENANT_ID,
    name: "Abandoned Test User",
    email: `abandoned-user-${generateId()}@example.com`,
    referralCode: `RC-${generateId()}`,
  });

  await db.insert(tripsTable).values({
    id: TRIP_ID,
    tenantId: TENANT_ID,
    name: "Abandoned Test Trip",
    slug: `abandoned-trip-${generateId()}`,
    destination: "Fortaleza, CE",
    destinationCity: "Fortaleza",
    destinationState: "CE",
    type: "excursao",
    category: "nacional",
    departureDate: new Date("2025-07-10"),
    totalCapacity: 46,
    availableSeats: 46,
    priceAdult: "100.00",
    createdById: USER_ID,
  });

  await db.insert(storesTable).values({
    id: STORE_ID,
    tenantId: TENANT_ID,
    name: "Abandoned Test Store",
    slug: `abandoned-store-${generateId()}`,
    email: `store-${generateId()}@example.com`,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  _resetAlertState();

  if (storeOrderIds.length > 0) {
    await db.delete(storeOrdersTable).where(inArray(storeOrdersTable.id, [...storeOrderIds]));
    storeOrderIds.length = 0;
  }
  if (referralIds.length > 0) {
    await db.delete(referralsTable).where(inArray(referralsTable.id, [...referralIds]));
    referralIds.length = 0;
  }
  if (reservationIds.length > 0) {
    await db.delete(reservationsTable).where(inArray(reservationsTable.id, [...reservationIds]));
    reservationIds.length = 0;
  }
});

afterAll(async () => {
  await db.delete(storesTable).where(inArray(storesTable.id, [STORE_ID]));
  await db.delete(tripsTable).where(inArray(tripsTable.id, [TRIP_ID]));
  await db.delete(usersTable).where(inArray(usersTable.id, [USER_ID]));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [TENANT_ID]));
});

/**
 * Captures the `{ total, reversed, skipped }` payload from the sweep's
 * final "Sweep complete" structured log. Returns null if the sweep found
 * no orders (i.e., the "Sweep complete" log was never emitted).
 */
async function runAndCaptureSweepStats(): Promise<{ total: number; reversed: number; skipped: number } | null> {
  const { logger } = await import("../lib/logger.js");
  let stats: { total: number; reversed: number; skipped: number } | null = null;

  vi.spyOn(logger, "info").mockImplementation((...args: unknown[]) => {
    const [obj, msg] = args as [unknown, string?, ...unknown[]];
    if (typeof obj === "object" && obj !== null && msg === "[abandoned-referrals] Sweep complete") {
      stats = obj as { total: number; reversed: number; skipped: number };
    }
  });

  await runAbandonedOrderReferralCleanup();
  return stats;
}

describe("runAbandonedOrderReferralCleanup integration", () => {
  it("does NOT reverse a trip-linked PENDING referral via the fallback path and records it as skipped", async () => {
    const code = `ABANDONED-${generateId()}`;

    // 1. Create a cancelled reservation (trip-linked)
    const reservationId = `test-res-${generateId()}`;
    reservationIds.push(reservationId);
    await db.insert(reservationsTable).values({
      id: reservationId,
      tenantId: TENANT_ID,
      tripId: TRIP_ID,
      seats: [],
      totalValue: "100.00",
      balance: "0.00",
      voucherCode: `VCHR-${generateId()}`,
      qrCode: `QR-${reservationId}`,
      createdById: USER_ID,
      status: RESERVATION_STATUS.CANCELLED,
      discountReferralCode: code,
    });

    // 2. Create a PENDING referral with reservationId set (trip-linked).
    //    This row should never be touched by the abandoned-order sweep — it
    //    belongs to the reservation-cancellation path in reservations.ts.
    const referralId = `test-ref-${generateId()}`;
    referralIds.push(referralId);
    await db.insert(referralsTable).values({
      id: referralId,
      tenantId: TENANT_ID,
      referrerId: `referrer-${generateId()}`,
      code,
      status: REFERRAL_STATUS.PENDING,
      reservationId,
      bonusAmount: "0",
      discountApplied: true,
      discountValue: "10",
    });

    // 3. Create a legacy store order (no referralId in pendingReferral).
    //    Using the fallback path: lookup by code + tenantId + PENDING + reservationId IS NULL.
    //    The matching referral row has reservationId != null so the guard should block it.
    const orderId = `test-order-${generateId()}`;
    storeOrderIds.push(orderId);
    const cutoffAge = (ABANDONED_ORDER_THRESHOLD_HOURS + 1) * 60 * 60 * 1000;
    await db.insert(storeOrdersTable).values({
      id: orderId,
      storeId: STORE_ID,
      tenantId: TENANT_ID,
      orderNumber: `ORD-${generateId()}`,
      customerName: "Cliente Teste",
      customerEmail: "test@example.com",
      customerPhone: "11999999999",
      subtotal: "100.00",
      discountAmount: "10.00",
      taxAmount: "0.00",
      shippingAmount: "0.00",
      totalAmount: "90.00",
      paymentMethod: "pix",
      paymentProvider: "mercadopago",
      paymentStatus: STORE_PAYMENT_STATUS.PENDING,
      referralEffectsAppliedAt: null,
      pendingReferral: { code, referrerId: `referrer-${generateId()}`, discountValue: 10, discountType: "percentage" },
      createdAt: new Date(Date.now() - cutoffAge),
    });

    // 4. Run the sweep and capture summary stats.
    const stats = await runAndCaptureSweepStats();

    // 5. The order was picked up (total=1), but the fallback guard blocked the
    //    reversal because no PENDING referral row has reservationId IS NULL for this code.
    expect(stats).not.toBeNull();
    expect(stats?.total).toBe(1);
    expect(stats?.reversed).toBe(0);
    expect(stats?.skipped).toBe(1);

    // 6. Double-check the referral row itself is still PENDING.
    const [referralAfter] = await db
      .select({ status: referralsTable.status })
      .from(referralsTable)
      .where(inArray(referralsTable.id, [referralId]));
    expect(referralAfter?.status).toBe(REFERRAL_STATUS.PENDING);
  });

  it("DOES reverse a product-only PENDING referral via the fallback path (reservationId IS NULL)", async () => {
    const code = `ABANDONED-PROD-${generateId()}`;

    // 1. Create a PENDING referral with NULL reservationId (product-only).
    const referralId = `test-ref-${generateId()}`;
    referralIds.push(referralId);
    await db.insert(referralsTable).values({
      id: referralId,
      tenantId: TENANT_ID,
      referrerId: `referrer-${generateId()}`,
      code,
      status: REFERRAL_STATUS.PENDING,
      reservationId: null,
      bonusAmount: "0",
      discountApplied: true,
      discountValue: "10",
    });

    // 2. Create a legacy store order (no referralId in pendingReferral).
    const orderId = `test-order-${generateId()}`;
    storeOrderIds.push(orderId);
    const cutoffAge = (ABANDONED_ORDER_THRESHOLD_HOURS + 1) * 60 * 60 * 1000;
    await db.insert(storeOrdersTable).values({
      id: orderId,
      storeId: STORE_ID,
      tenantId: TENANT_ID,
      orderNumber: `ORD-${generateId()}`,
      customerName: "Cliente Teste",
      customerEmail: "test@example.com",
      customerPhone: "11999999999",
      subtotal: "100.00",
      discountAmount: "10.00",
      taxAmount: "0.00",
      shippingAmount: "0.00",
      totalAmount: "90.00",
      paymentMethod: "pix",
      paymentProvider: "mercadopago",
      paymentStatus: STORE_PAYMENT_STATUS.PENDING,
      referralEffectsAppliedAt: null,
      pendingReferral: { code, referrerId: `referrer-${generateId()}`, discountValue: 10, discountType: "percentage" },
      createdAt: new Date(Date.now() - cutoffAge),
    });

    // 3. Run the sweep and capture summary stats.
    const stats = await runAndCaptureSweepStats();

    // 4. The order was picked up and the referral was reversed (skipped=0).
    expect(stats).not.toBeNull();
    expect(stats?.total).toBe(1);
    expect(stats?.reversed).toBe(1);
    expect(stats?.skipped).toBe(0);

    // 5. Double-check the referral row was set to REVERSED.
    const [referralAfter] = await db
      .select({ status: referralsTable.status })
      .from(referralsTable)
      .where(inArray(referralsTable.id, [referralId]));
    expect(referralAfter?.status).toBe(REFERRAL_STATUS.REVERSED);
  });
});

// ---------------------------------------------------------------------------
// Primary path — referralId present in pendingReferral JSONB
//
// Task #72 added isNull(referralsTable.reservationId) to the primary path
// WHERE clause so the sweep cannot reverse trip-linked PENDING referrals
// even when their id is stored in an order's pendingReferral JSONB.
// These tests prove the guard works at the SQL level (not just in mocks).
// ---------------------------------------------------------------------------

describe("runAbandonedOrderReferralCleanup — primary path (referralId in JSONB)", () => {
  const cutoffAge = (ABANDONED_ORDER_THRESHOLD_HOURS + 1) * 60 * 60 * 1000;

  it("does NOT reverse a PENDING referral with reservationId != null via the primary path", async () => {
    // The order carries referralId in pendingReferral JSONB → primary path.
    // The referral has reservationId set (trip-linked). The isNull guard in
    // the primary WHERE makes PostgreSQL return no row → sweep skips it.
    const code = `PRI-TRIP-${generateId()}`;
    const referralId = `test-ref-${generateId()}`;
    referralIds.push(referralId);
    await db.insert(referralsTable).values({
      id: referralId,
      tenantId: TENANT_ID,
      referrerId: `fake-referrer-${generateId()}`,
      code,
      status: REFERRAL_STATUS.PENDING,
      reservationId: `fake-res-${generateId()}`, // trip-linked
      bonusAmount: "0",
      discountApplied: true,
      discountValue: "10",
    });

    const orderId = `test-order-${generateId()}`;
    storeOrderIds.push(orderId);
    await db.insert(storeOrdersTable).values({
      id: orderId,
      storeId: STORE_ID,
      tenantId: TENANT_ID,
      orderNumber: `ORD-${generateId()}`,
      customerName: "Cliente Teste",
      customerEmail: `test-${generateId()}@example.com`,
      customerPhone: "11999999999",
      subtotal: "100.00",
      totalAmount: "100.00",
      paymentMethod: "pix",
      paymentProvider: "mercadopago",
      paymentStatus: STORE_PAYMENT_STATUS.PENDING,
      referralEffectsAppliedAt: null,
      // referralId present → primary path
      pendingReferral: { code, referrerId: `fake-referrer-${generateId()}`, discountValue: 10, discountType: "percentage", referralId },
      createdAt: new Date(Date.now() - cutoffAge),
    });

    const stats = await runAndCaptureSweepStats();

    expect(stats).not.toBeNull();
    expect(stats?.total).toBe(1);
    expect(stats?.reversed).toBe(0);
    expect(stats?.skipped).toBe(1);

    const [after] = await db
      .select({ status: referralsTable.status })
      .from(referralsTable)
      .where(inArray(referralsTable.id, [referralId]));
    expect(after?.status).toBe(REFERRAL_STATUS.PENDING);
  });

  it("DOES reverse a PENDING referral with reservationId = null via the primary path (control)", async () => {
    // Primary path with a product-only referral (reservationId = null).
    // The isNull guard is satisfied → PostgreSQL returns the row → reversed.
    const code = `PRI-PROD-${generateId()}`;
    const referralId = `test-ref-${generateId()}`;
    referralIds.push(referralId);
    await db.insert(referralsTable).values({
      id: referralId,
      tenantId: TENANT_ID,
      referrerId: `fake-referrer-${generateId()}`,
      code,
      status: REFERRAL_STATUS.PENDING,
      reservationId: null, // product-only
      bonusAmount: "0",
      discountApplied: true,
      discountValue: "10",
    });

    const orderId = `test-order-${generateId()}`;
    storeOrderIds.push(orderId);
    await db.insert(storeOrdersTable).values({
      id: orderId,
      storeId: STORE_ID,
      tenantId: TENANT_ID,
      orderNumber: `ORD-${generateId()}`,
      customerName: "Cliente Teste",
      customerEmail: `test-${generateId()}@example.com`,
      customerPhone: "11999999999",
      subtotal: "100.00",
      totalAmount: "100.00",
      paymentMethod: "pix",
      paymentProvider: "mercadopago",
      paymentStatus: STORE_PAYMENT_STATUS.PENDING,
      referralEffectsAppliedAt: null,
      pendingReferral: { code, referrerId: `fake-referrer-${generateId()}`, discountValue: 10, discountType: "percentage", referralId },
      createdAt: new Date(Date.now() - cutoffAge),
    });

    const stats = await runAndCaptureSweepStats();

    expect(stats).not.toBeNull();
    expect(stats?.total).toBe(1);
    expect(stats?.reversed).toBe(1);
    expect(stats?.skipped).toBe(0);

    const [after] = await db
      .select({ status: referralsTable.status })
      .from(referralsTable)
      .where(inArray(referralsTable.id, [referralId]));
    expect(after?.status).toBe(REFERRAL_STATUS.REVERSED);
  });

  it("reverses only the product-only referral when both types share one sweep run (primary path)", async () => {
    // Two orders, both with referralId in JSONB (primary path).
    // Only the product-only one (reservationId = null) is reversed.
    const tripCode = `PRI-BOTH-TRIP-${generateId()}`;
    const tripReferralId = `test-ref-${generateId()}`;
    referralIds.push(tripReferralId);
    await db.insert(referralsTable).values({
      id: tripReferralId,
      tenantId: TENANT_ID,
      referrerId: `fake-referrer-${generateId()}`,
      code: tripCode,
      status: REFERRAL_STATUS.PENDING,
      reservationId: `fake-res-${generateId()}`,
      bonusAmount: "0",
      discountApplied: true,
      discountValue: "10",
    });

    const prodCode = `PRI-BOTH-PROD-${generateId()}`;
    const prodReferralId = `test-ref-${generateId()}`;
    referralIds.push(prodReferralId);
    await db.insert(referralsTable).values({
      id: prodReferralId,
      tenantId: TENANT_ID,
      referrerId: `fake-referrer-${generateId()}`,
      code: prodCode,
      status: REFERRAL_STATUS.PENDING,
      reservationId: null,
      bonusAmount: "0",
      discountApplied: true,
      discountValue: "10",
    });

    for (const [referralId, code] of [[tripReferralId, tripCode], [prodReferralId, prodCode]]) {
      const orderId = `test-order-${generateId()}`;
      storeOrderIds.push(orderId);
      await db.insert(storeOrdersTable).values({
        id: orderId,
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        orderNumber: `ORD-${generateId()}`,
        customerName: "Cliente Teste",
        customerEmail: `test-${generateId()}@example.com`,
        customerPhone: "11999999999",
        subtotal: "100.00",
        totalAmount: "100.00",
        paymentMethod: "pix",
        paymentProvider: "mercadopago",
        paymentStatus: STORE_PAYMENT_STATUS.PENDING,
        referralEffectsAppliedAt: null,
        pendingReferral: { code, referrerId: `fake-referrer-${generateId()}`, discountValue: 10, discountType: "percentage", referralId },
        createdAt: new Date(Date.now() - cutoffAge),
      });
    }

    const stats = await runAndCaptureSweepStats();

    expect(stats).not.toBeNull();
    expect(stats?.total).toBe(2);
    expect(stats?.reversed).toBe(1);
    expect(stats?.skipped).toBe(1);

    const [tripAfter] = await db
      .select({ status: referralsTable.status })
      .from(referralsTable)
      .where(inArray(referralsTable.id, [tripReferralId]));
    expect(tripAfter?.status).toBe(REFERRAL_STATUS.PENDING);

    const [prodAfter] = await db
      .select({ status: referralsTable.status })
      .from(referralsTable)
      .where(inArray(referralsTable.id, [prodReferralId]));
    expect(prodAfter?.status).toBe(REFERRAL_STATUS.REVERSED);
  });
});

// ---------------------------------------------------------------------------
// FAILED payment status — sweep must treat FAILED orders identically to PENDING
//
// runAbandonedOrderReferralCleanup uses UNPAID_STATUSES = [PENDING, FAILED].
// A FAILED order means a gateway attempt was made but money was not captured.
// The referral-reversal logic is identical; only the WHERE branch differs.
// ---------------------------------------------------------------------------

describe("runAbandonedOrderReferralCleanup — FAILED payment status orders", () => {
  const cutoffAge = (ABANDONED_ORDER_THRESHOLD_HOURS + 1) * 60 * 60 * 1000;

  it("does NOT reverse a trip-linked PENDING referral from a FAILED order (primary path)", async () => {
    // Same scenario as the PENDING tests but with paymentStatus = FAILED.
    // The isNull(reservationId) guard must hold regardless of payment status.
    const code = `FAIL-TRIP-${generateId()}`;
    const referralId = `test-ref-${generateId()}`;
    referralIds.push(referralId);
    await db.insert(referralsTable).values({
      id: referralId,
      tenantId: TENANT_ID,
      referrerId: `fake-referrer-${generateId()}`,
      code,
      status: REFERRAL_STATUS.PENDING,
      reservationId: `fake-res-${generateId()}`, // trip-linked
      bonusAmount: "0",
      discountApplied: true,
      discountValue: "10",
    });

    const orderId = `test-order-${generateId()}`;
    storeOrderIds.push(orderId);
    await db.insert(storeOrdersTable).values({
      id: orderId,
      storeId: STORE_ID,
      tenantId: TENANT_ID,
      orderNumber: `ORD-${generateId()}`,
      customerName: "Cliente Teste",
      customerEmail: `test-${generateId()}@example.com`,
      customerPhone: "11999999999",
      subtotal: "100.00",
      totalAmount: "100.00",
      paymentMethod: "pix",
      paymentProvider: "mercadopago",
      paymentStatus: STORE_PAYMENT_STATUS.FAILED,
      referralEffectsAppliedAt: null,
      pendingReferral: { code, referrerId: `fake-referrer-${generateId()}`, discountValue: 10, discountType: "percentage", referralId },
      createdAt: new Date(Date.now() - cutoffAge),
    });

    const stats = await runAndCaptureSweepStats();

    expect(stats).not.toBeNull();
    expect(stats?.total).toBe(1);
    expect(stats?.reversed).toBe(0);
    expect(stats?.skipped).toBe(1);

    const [after] = await db
      .select({ status: referralsTable.status })
      .from(referralsTable)
      .where(inArray(referralsTable.id, [referralId]));
    expect(after?.status).toBe(REFERRAL_STATUS.PENDING);
  });

  it("DOES reverse a product-only PENDING referral from a FAILED order (primary path)", async () => {
    // A failed-payment order with a product-only referral (reservationId = null)
    // must be swept just like a pending-payment order.
    const code = `FAIL-PROD-${generateId()}`;
    const referralId = `test-ref-${generateId()}`;
    referralIds.push(referralId);
    await db.insert(referralsTable).values({
      id: referralId,
      tenantId: TENANT_ID,
      referrerId: `fake-referrer-${generateId()}`,
      code,
      status: REFERRAL_STATUS.PENDING,
      reservationId: null,
      bonusAmount: "0",
      discountApplied: true,
      discountValue: "10",
    });

    const orderId = `test-order-${generateId()}`;
    storeOrderIds.push(orderId);
    await db.insert(storeOrdersTable).values({
      id: orderId,
      storeId: STORE_ID,
      tenantId: TENANT_ID,
      orderNumber: `ORD-${generateId()}`,
      customerName: "Cliente Teste",
      customerEmail: `test-${generateId()}@example.com`,
      customerPhone: "11999999999",
      subtotal: "100.00",
      totalAmount: "100.00",
      paymentMethod: "pix",
      paymentProvider: "mercadopago",
      paymentStatus: STORE_PAYMENT_STATUS.FAILED,
      referralEffectsAppliedAt: null,
      pendingReferral: { code, referrerId: `fake-referrer-${generateId()}`, discountValue: 10, discountType: "percentage", referralId },
      createdAt: new Date(Date.now() - cutoffAge),
    });

    const stats = await runAndCaptureSweepStats();

    expect(stats).not.toBeNull();
    expect(stats?.total).toBe(1);
    expect(stats?.reversed).toBe(1);
    expect(stats?.skipped).toBe(0);

    const [after] = await db
      .select({ status: referralsTable.status })
      .from(referralsTable)
      .where(inArray(referralsTable.id, [referralId]));
    expect(after?.status).toBe(REFERRAL_STATUS.REVERSED);
  });

  // -------------------------------------------------------------------------
  // Fallback path: legacy orders without referralId in pendingReferral JSONB
  // The same UNPAID_STATUSES = [PENDING, FAILED] WHERE clause applies to the
  // fallback path too; these tests prove FAILED orders are swept correctly
  // via the code-based lookup (no referralId field in pendingReferral).
  // -------------------------------------------------------------------------

  it("does NOT reverse a trip-linked PENDING referral via the fallback path when the order has FAILED status", async () => {
    // Fallback path: pendingReferral has no referralId field (legacy order).
    // The referral row has reservationId != null (trip-linked).
    // The `isNull(reservationId)` guard in the fallback WHERE clause must
    // prevent the reversal, regardless of whether the order's payment
    // status is PENDING or FAILED.
    const code = `FAIL-FB-TRIP-${generateId()}`;

    const reservationId = `test-res-${generateId()}`;
    reservationIds.push(reservationId);
    await db.insert(reservationsTable).values({
      id: reservationId,
      tenantId: TENANT_ID,
      tripId: TRIP_ID,
      seats: [],
      totalValue: "100.00",
      balance: "0.00",
      voucherCode: `VCHR-${generateId()}`,
      qrCode: `QR-${reservationId}`,
      createdById: USER_ID,
      status: RESERVATION_STATUS.CANCELLED,
      discountReferralCode: code,
    });

    const referralId = `test-ref-${generateId()}`;
    referralIds.push(referralId);
    await db.insert(referralsTable).values({
      id: referralId,
      tenantId: TENANT_ID,
      referrerId: `fake-referrer-${generateId()}`,
      code,
      status: REFERRAL_STATUS.PENDING,
      reservationId, // trip-linked → fallback guard must block this
      bonusAmount: "0",
      discountApplied: true,
      discountValue: "10",
    });

    // Legacy order: no referralId in pendingReferral → fallback path
    const orderId = `test-order-${generateId()}`;
    storeOrderIds.push(orderId);
    await db.insert(storeOrdersTable).values({
      id: orderId,
      storeId: STORE_ID,
      tenantId: TENANT_ID,
      orderNumber: `ORD-${generateId()}`,
      customerName: "Cliente Teste",
      customerEmail: `test-${generateId()}@example.com`,
      customerPhone: "11999999999",
      subtotal: "100.00",
      discountAmount: "10.00",
      taxAmount: "0.00",
      shippingAmount: "0.00",
      totalAmount: "90.00",
      paymentMethod: "pix",
      paymentProvider: "mercadopago",
      paymentStatus: STORE_PAYMENT_STATUS.FAILED,
      referralEffectsAppliedAt: null,
      // No referralId field → fallback code-based lookup
      pendingReferral: { code, referrerId: `fake-referrer-${generateId()}`, discountValue: 10, discountType: "percentage" },
      createdAt: new Date(Date.now() - cutoffAge),
    });

    const stats = await runAndCaptureSweepStats();

    // The order is picked up (FAILED is in UNPAID_STATUSES), but the
    // fallback guard blocks the reversal because no PENDING referral row
    // has reservationId IS NULL for this code.
    expect(stats).not.toBeNull();
    expect(stats?.total).toBe(1);
    expect(stats?.reversed).toBe(0);
    expect(stats?.skipped).toBe(1);

    const [referralAfter] = await db
      .select({ status: referralsTable.status })
      .from(referralsTable)
      .where(inArray(referralsTable.id, [referralId]));
    expect(referralAfter?.status).toBe(REFERRAL_STATUS.PENDING);
  });

  it("DOES reverse a product-only PENDING referral via the fallback path when the order has FAILED status", async () => {
    // Fallback path: pendingReferral has no referralId field (legacy order).
    // The referral row has reservationId = null (product-only).
    // A FAILED payment status means no money was captured — reversal is correct.
    const code = `FAIL-FB-PROD-${generateId()}`;

    const referralId = `test-ref-${generateId()}`;
    referralIds.push(referralId);
    await db.insert(referralsTable).values({
      id: referralId,
      tenantId: TENANT_ID,
      referrerId: `fake-referrer-${generateId()}`,
      code,
      status: REFERRAL_STATUS.PENDING,
      reservationId: null, // product-only → fallback guard allows reversal
      bonusAmount: "0",
      discountApplied: true,
      discountValue: "10",
    });

    // Legacy order: no referralId in pendingReferral → fallback path
    const orderId = `test-order-${generateId()}`;
    storeOrderIds.push(orderId);
    await db.insert(storeOrdersTable).values({
      id: orderId,
      storeId: STORE_ID,
      tenantId: TENANT_ID,
      orderNumber: `ORD-${generateId()}`,
      customerName: "Cliente Teste",
      customerEmail: `test-${generateId()}@example.com`,
      customerPhone: "11999999999",
      subtotal: "100.00",
      discountAmount: "10.00",
      taxAmount: "0.00",
      shippingAmount: "0.00",
      totalAmount: "90.00",
      paymentMethod: "pix",
      paymentProvider: "mercadopago",
      paymentStatus: STORE_PAYMENT_STATUS.FAILED,
      referralEffectsAppliedAt: null,
      // No referralId field → fallback code-based lookup
      pendingReferral: { code, referrerId: `fake-referrer-${generateId()}`, discountValue: 10, discountType: "percentage" },
      createdAt: new Date(Date.now() - cutoffAge),
    });

    const stats = await runAndCaptureSweepStats();

    // The order is picked up and the referral is reversed.
    expect(stats).not.toBeNull();
    expect(stats?.total).toBe(1);
    expect(stats?.reversed).toBe(1);
    expect(stats?.skipped).toBe(0);

    const [referralAfter] = await db
      .select({ status: referralsTable.status })
      .from(referralsTable)
      .where(inArray(referralsTable.id, [referralId]));
    expect(referralAfter?.status).toBe(REFERRAL_STATUS.REVERSED);
  });
});

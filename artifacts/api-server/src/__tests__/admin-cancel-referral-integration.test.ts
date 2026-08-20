/**
 * Integration test: confirms that the admin manual-cancel referral-reversal
 * service functions (`reverseTripOrderReferrals` and
 * `reverseProductOnlyOrderReferral`) correctly mutate the real database.
 *
 * Route-level unit tests (store-admin-cancel-referral.test.ts) confirm the
 * right branch is called for a given order; this file confirms the SQL that
 * actually runs against Postgres produces the expected state:
 *   - referral rows flip from COMPLETED → REVERSED
 *   - referrer client counters are decremented (GREATEST guard prevents negatives)
 *   - a double-call is a no-op (idempotency)
 *
 * Exercises the real database — no mocks.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  tenantsTable,
  tripsTable,
  usersTable,
  referralsTable,
  reservationsTable,
  storesTable,
  clientsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { REFERRAL_STATUS } from "@workspace/permissions";

import { generateId } from "../lib/id";
import {
  reverseTripOrderReferrals,
  reverseProductOnlyOrderReferral,
} from "../services/checkout/order-referral-reversal.js";

const TENANT_ID = `test-tenant-${generateId()}`;
const TRIP_ID = `test-trip-${generateId()}`;
const USER_ID = `test-user-${generateId()}`;
const STORE_ID = `test-store-${generateId()}`;

const referralIds: string[] = [];
const reservationIds: string[] = [];
const clientIds: string[] = [];

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error(
      "DATABASE_URL must be set to run the admin-cancel referral integration test",
    );
  }

  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Admin Cancel Referral Test Agency",
    slug: `admin-cancel-ref-${generateId()}`,
    email: `admin-cancel-ref-${generateId()}@example.com`,
  });

  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: `clerk-${generateId()}`,
    tenantId: TENANT_ID,
    name: "Admin Cancel Test User",
    email: `admin-cancel-user-${generateId()}@example.com`,
    referralCode: `RC-${generateId()}`,
  });

  await db.insert(tripsTable).values({
    id: TRIP_ID,
    tenantId: TENANT_ID,
    name: "Admin Cancel Test Trip",
    slug: `admin-cancel-trip-${generateId()}`,
    destination: "Recife, PE",
    destinationCity: "Recife",
    destinationState: "PE",
    type: "excursao",
    category: "nacional",
    departureDate: new Date("2025-08-15"),
    totalCapacity: 40,
    availableSeats: 40,
    priceAdult: "200.00",
    createdById: USER_ID,
  });

  await db.insert(storesTable).values({
    id: STORE_ID,
    tenantId: TENANT_ID,
    name: "Admin Cancel Test Store",
    slug: `admin-cancel-store-${generateId()}`,
    email: `admin-cancel-store-${generateId()}@example.com`,
  });
});

afterEach(async () => {
  if (referralIds.length > 0) {
    await db
      .delete(referralsTable)
      .where(inArray(referralsTable.id, [...referralIds]));
    referralIds.length = 0;
  }
  if (reservationIds.length > 0) {
    await db
      .delete(reservationsTable)
      .where(inArray(reservationsTable.id, [...reservationIds]));
    reservationIds.length = 0;
  }
  if (clientIds.length > 0) {
    await db
      .delete(clientsTable)
      .where(inArray(clientsTable.id, [...clientIds]));
    clientIds.length = 0;
  }
});

afterAll(async () => {
  await db.delete(storesTable).where(inArray(storesTable.id, [STORE_ID]));
  await db.delete(tripsTable).where(inArray(tripsTable.id, [TRIP_ID]));
  await db.delete(usersTable).where(inArray(usersTable.id, [USER_ID]));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [TENANT_ID]));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createReferrer(opts: {
  successfulReferrals: number;
  referralEarnings: string;
}): Promise<string> {
  const id = `test-client-${generateId()}`;
  clientIds.push(id);
  await db.insert(clientsTable).values({
    id,
    tenantId: TENANT_ID,
    name: "Referrer Client",
    email: `referrer-${generateId()}@example.com`,
    whatsapp: `+5511999${generateId().slice(0, 5)}`,
    createdById: USER_ID,
    successfulReferrals: opts.successfulReferrals,
    referralEarnings: opts.referralEarnings,
  });
  return id;
}

async function createRealReservationId(): Promise<string> {
  const id = `test-res-${generateId()}`;
  reservationIds.push(id);
  await db.insert(reservationsTable).values({
    id,
    tenantId: TENANT_ID,
    tripId: TRIP_ID,
    seats: [],
    totalValue: "200.00",
    balance: "200.00",
    voucherCode: `VCH-${generateId()}`,
    qrCode: `QR-${generateId()}`,
    createdById: USER_ID,
    status: "pending",
  });
  return id;
}

async function createCompletedTripReferral(opts: {
  referrerId: string;
  bonusAmount: string;
}): Promise<{ referralId: string; reservationId: string }> {
  const reservationId = await createRealReservationId();
  const referralId = `test-ref-${generateId()}`;
  referralIds.push(referralId);
  await db.insert(referralsTable).values({
    id: referralId,
    tenantId: TENANT_ID,
    referrerId: opts.referrerId,
    code: `REF-${generateId()}`,
    status: REFERRAL_STATUS.COMPLETED,
    reservationId,
    bonusAmount: opts.bonusAmount,
    discountApplied: true,
    discountValue: "10",
  });
  return { referralId, reservationId };
}

async function createCompletedProductReferral(opts: {
  referrerId: string;
  bonusAmount: string;
}): Promise<string> {
  const id = `test-ref-${generateId()}`;
  referralIds.push(id);
  await db.insert(referralsTable).values({
    id,
    tenantId: TENANT_ID,
    referrerId: opts.referrerId,
    code: `REF-${generateId()}`,
    status: REFERRAL_STATUS.COMPLETED,
    reservationId: null,
    bonusAmount: opts.bonusAmount,
    discountApplied: true,
    discountValue: "10",
  });
  return id;
}

async function fetchReferral(id: string) {
  const [row] = await db
    .select({
      status: referralsTable.status,
      reversalReason: referralsTable.reversalReason,
    })
    .from(referralsTable)
    .where(eq(referralsTable.id, id));
  return row;
}

async function fetchClientCounters(id: string) {
  const [row] = await db
    .select({
      successfulReferrals: clientsTable.successfulReferrals,
      referralEarnings: clientsTable.referralEarnings,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, id));
  return row;
}

// ---------------------------------------------------------------------------
// Tests: reverseTripOrderReferrals
// ---------------------------------------------------------------------------

describe("reverseTripOrderReferrals integration", () => {
  it("flips a COMPLETED referral to REVERSED and decrements the referrer's counters", async () => {
    // Referrer starts with one credited referral so the decrement is visible.
    const referrerId = await createReferrer({
      successfulReferrals: 1,
      referralEarnings: "25.00",
    });
    const { referralId, reservationId } = await createCompletedTripReferral({
      referrerId,
      bonusAmount: "25.00",
    });

    const reversed = await reverseTripOrderReferrals(db, {
      tenantId: TENANT_ID,
      orderId: `fake-order-${generateId()}`,
      cancellableReservationIds: [reservationId],
      reversalReason: "order_cancelled",
    });

    expect(reversed).toHaveLength(1);
    expect(reversed[0]).toBe(referralId);

    const ref = await fetchReferral(referralId);
    expect(ref?.status).toBe(REFERRAL_STATUS.REVERSED);

    const counters = await fetchClientCounters(referrerId);
    expect(counters?.successfulReferrals).toBe(0);
    expect(Number(counters?.referralEarnings)).toBeCloseTo(0, 1);
  });

  it("GREATEST guard prevents negative counters when referrer was already at zero", async () => {
    // Referrer starts at zero. Reversing one of two referrals triggers the
    // GREATEST guard and keeps both counters at 0 (never goes negative).
    const referrerId = await createReferrer({
      successfulReferrals: 0,
      referralEarnings: "0.00",
    });
    const { referralId: referralIdA, reservationId: reservationIdA } =
      await createCompletedTripReferral({
        referrerId,
        bonusAmount: "20.00",
      });
    const { referralId: referralIdB, reservationId: reservationIdB } =
      await createCompletedTripReferral({
        referrerId,
        bonusAmount: "30.00",
      });

    // Only cancel reservationIdA — referralIdB is untouched.
    const reversed = await reverseTripOrderReferrals(db, {
      tenantId: TENANT_ID,
      orderId: `fake-order-${generateId()}`,
      cancellableReservationIds: [reservationIdA],
      reversalReason: "order_cancelled",
    });

    expect(reversed).toHaveLength(1);
    expect(reversed[0]).toBe(referralIdA);

    const refA = await fetchReferral(referralIdA);
    expect(refA?.status).toBe(REFERRAL_STATUS.REVERSED);

    const refB = await fetchReferral(referralIdB);
    expect(refB?.status).toBe(REFERRAL_STATUS.COMPLETED);

    // GREATEST guard: started at 0, can't go below 0.
    const counters = await fetchClientCounters(referrerId);
    expect(counters?.successfulReferrals).toBe(0);
    expect(Number(counters?.referralEarnings)).toBe(0);

    void reservationIdB;
  });

  it("reverses a trip-linked referral when referrer starts at zero (GREATEST guard holds)", async () => {
    // Single trip referral; referrer starts at 0.  The GREATEST guard fires
    // and prevents the counters from going negative.
    const referrerId = await createReferrer({
      successfulReferrals: 0,
      referralEarnings: "0.00",
    });
    const { referralId, reservationId } = await createCompletedTripReferral({
      referrerId,
      bonusAmount: "25.00",
    });

    const reversed = await reverseTripOrderReferrals(db, {
      tenantId: TENANT_ID,
      orderId: `fake-order-${generateId()}`,
      cancellableReservationIds: [reservationId],
      reversalReason: "order_cancelled",
    });

    expect(reversed).toHaveLength(1);
    expect(reversed[0]).toBe(referralId);

    const ref = await fetchReferral(referralId);
    expect(ref?.status).toBe(REFERRAL_STATUS.REVERSED);

    // GREATEST guard: started at 0, stays at 0.
    const counters = await fetchClientCounters(referrerId);
    expect(counters?.successfulReferrals).toBe(0);
    expect(Number(counters?.referralEarnings)).toBe(0);
  });

  it("idempotency: calling reverseTripOrderReferrals twice on the same reservation is a no-op on the second call", async () => {
    // Referrer starts with 1 credited referral (bonus 20).
    const referrerId = await createReferrer({
      successfulReferrals: 1,
      referralEarnings: "20.00",
    });
    const { referralId, reservationId } = await createCompletedTripReferral({
      referrerId,
      bonusAmount: "20.00",
    });

    // First call — should reverse the referral.
    const firstReversed = await reverseTripOrderReferrals(db, {
      tenantId: TENANT_ID,
      orderId: `fake-order-${generateId()}`,
      cancellableReservationIds: [reservationId],
      reversalReason: "order_cancelled",
    });

    expect(firstReversed).toHaveLength(1);
    expect(firstReversed[0]).toBe(referralId);

    const refAfterFirst = await fetchReferral(referralId);
    expect(refAfterFirst?.status).toBe(REFERRAL_STATUS.REVERSED);

    const countersAfterFirst = await fetchClientCounters(referrerId);
    expect(countersAfterFirst?.successfulReferrals).toBe(0);
    expect(Number(countersAfterFirst?.referralEarnings)).toBeCloseTo(0, 1);

    // Second call — referral is already REVERSED, service skips it (no-op).
    const secondReversed = await reverseTripOrderReferrals(db, {
      tenantId: TENANT_ID,
      orderId: `fake-order-${generateId()}`,
      cancellableReservationIds: [reservationId],
      reversalReason: "order_cancelled",
    });

    expect(secondReversed).toHaveLength(0);

    // Counters must not have been decremented a second time.
    const countersAfterSecond = await fetchClientCounters(referrerId);
    expect(countersAfterSecond?.successfulReferrals).toBe(0);
    expect(Number(countersAfterSecond?.referralEarnings)).toBeCloseTo(0, 1);
  });

  it("returns an empty array and makes no DB changes when reservationIds list is empty", async () => {
    const reversed = await reverseTripOrderReferrals(db, {
      tenantId: TENANT_ID,
      orderId: `fake-order-${generateId()}`,
      cancellableReservationIds: [],
      reversalReason: "order_cancelled",
    });

    expect(reversed).toHaveLength(0);
  });

  it("does NOT reverse referrals belonging to a different tenant", async () => {
    // otherTenantId is never inserted into tenantsTable; referralsTable has no
    // FK on tenant_id so the insert succeeds and lets us test the isolation
    // guard inside reverseTripOrderReferrals (tenantId filter in the WHERE).
    const otherTenantId = `other-tenant-${generateId()}`;
    const referrerId = await createReferrer({
      successfulReferrals: 0,
      referralEarnings: "0.00",
    });
    // Reservation lives under TENANT_ID (required for FK); tenant isolation is
    // enforced via the referral row's own tenantId column.
    const reservationId = await createRealReservationId();

    // Insert the cross-tenant referral under otherTenantId with a fresh id.
    const crossTenantReferralId = `test-ref-${generateId()}`;
    referralIds.push(crossTenantReferralId);
    await db.insert(referralsTable).values({
      id: crossTenantReferralId,
      tenantId: otherTenantId,
      referrerId,
      code: `REF-${generateId()}`,
      status: REFERRAL_STATUS.COMPLETED,
      reservationId,
      bonusAmount: "25.00",
      discountApplied: true,
      discountValue: "10",
    });

    // Service is called with TENANT_ID — must NOT touch the otherTenant referral.
    const reversed = await reverseTripOrderReferrals(db, {
      tenantId: TENANT_ID,
      orderId: `fake-order-${generateId()}`,
      cancellableReservationIds: [reservationId],
      reversalReason: "order_cancelled",
    });

    expect(reversed).toHaveLength(0);

    // Cross-tenant referral must remain COMPLETED.
    const ref = await fetchReferral(crossTenantReferralId);
    expect(ref?.status).toBe(REFERRAL_STATUS.COMPLETED);

    // Referrer counters must be untouched (started at 0, still 0).
    const counters = await fetchClientCounters(referrerId);
    expect(counters?.successfulReferrals).toBe(0);
    expect(Number(counters?.referralEarnings)).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Tests: reverseProductOnlyOrderReferral
  // ---------------------------------------------------------------------------

  it("reverseProductOnlyOrderReferral reverses a COMPLETED product-only referral", async () => {
    // Referrer starts with 1 credited referral so the decrement is visible.
    const referrerId = await createReferrer({
      successfulReferrals: 1,
      referralEarnings: "25.00",
    });
    const referralId = await createCompletedProductReferral({
      referrerId,
      bonusAmount: "25.00",
    });

    const code = (
      await db
        .select({ code: referralsTable.code })
        .from(referralsTable)
        .where(eq(referralsTable.id, referralId))
    )[0]?.code ?? "";

    const wasReversed = await reverseProductOnlyOrderReferral(db, {
      tenantId: TENANT_ID,
      orderId: `fake-order-${generateId()}`,
      referralCode: code,
      referralId,
      reversalReason: "order_cancelled",
    });

    expect(wasReversed).toBe(true);

    const refAfter = await fetchReferral(referralId);
    expect(refAfter?.status).toBe(REFERRAL_STATUS.REVERSED);
    expect(refAfter?.reversalReason).toBe("order_cancelled");

    const counters = await fetchClientCounters(referrerId);
    expect(counters?.successfulReferrals).toBe(0);
    expect(Number(counters?.referralEarnings)).toBeCloseTo(0, 1);
  });

  it("reverseProductOnlyOrderReferral is idempotent: second call on already-REVERSED referral returns false", async () => {
    const referrerId = await createReferrer({
      successfulReferrals: 0,
      referralEarnings: "0.00",
    });
    const referralId = await createCompletedProductReferral({
      referrerId,
      bonusAmount: "25.00",
    });

    const code = (
      await db
        .select({ code: referralsTable.code })
        .from(referralsTable)
        .where(eq(referralsTable.id, referralId))
    )[0]?.code ?? "";

    // First call — reverses the referral.
    const firstResult = await reverseProductOnlyOrderReferral(db, {
      tenantId: TENANT_ID,
      orderId: `fake-order-${generateId()}`,
      referralCode: code,
      referralId,
      reversalReason: "order_cancelled",
    });
    expect(firstResult).toBe(true);

    // Second call — already REVERSED, must be a no-op.
    const wasReversed = await reverseProductOnlyOrderReferral(db, {
      tenantId: TENANT_ID,
      orderId: `fake-order-${generateId()}`,
      referralCode: code,
      referralId,
      reversalReason: "order_cancelled",
    });

    expect(wasReversed).toBe(false);

    // Counters must not have been decremented a second time.
    const counters = await fetchClientCounters(referrerId);
    expect(counters?.successfulReferrals).toBe(0);
    expect(Number(counters?.referralEarnings)).toBe(0);
  });

  it("reverseProductOnlyOrderReferral GREATEST guard prevents negative counters when referrer starts at zero", async () => {
    const referrerId = await createReferrer({
      successfulReferrals: 0,
      referralEarnings: "0.00",
    });
    const referralId = await createCompletedProductReferral({
      referrerId,
      bonusAmount: "25.00",
    });

    const code = (
      await db
        .select({ code: referralsTable.code })
        .from(referralsTable)
        .where(eq(referralsTable.id, referralId))
    )[0]?.code ?? "";

    await reverseProductOnlyOrderReferral(db, {
      tenantId: TENANT_ID,
      orderId: `fake-order-${generateId()}`,
      referralCode: code,
      referralId,
      reversalReason: "order_cancelled",
    });

    // GREATEST guard: started at 0, stays at 0 — never goes negative.
    const counters = await fetchClientCounters(referrerId);
    expect(counters?.successfulReferrals).toBe(0);
    expect(Number(counters?.referralEarnings)).toBe(0);
  });
});

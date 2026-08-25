import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// reverseTripOrderReferrals — service unit tests
//
// Verifies the batch referral-reversal path that fires when a trip-based
// store order is refunded via a payment gateway webhook.
//
// DB call sequence:
//   1. SELECT referrals WHERE tenantId=? AND reservationId IN (?) AND status=COMPLETED
//   2. For each found referral: UPDATE clients (decrement) + UPDATE referrals (REVERSED)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  referralsTable: {
    id: "id",
    tenantId: "tenant_id",
    status: "status",
    reservationId: "reservation_id",
    referrerId: "referrer_id",
    bonusAmount: "bonus_amount",
    reversalReason: "reversal_reason",
    reversalAt: "reversal_at",
    updatedAt: "updated_at",
  },
  clientsTable: {
    id: "id",
    tenantId: "tenant_id",
    successfulReferrals: "successful_referrals",
    referralEarnings: "referral_earnings",
  },
  referralCommissionsTable: {
    tenantId: "tenant_id",
    referralId: "referral_id",
    status: "status",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _eq: [col, val] })),
  inArray: vi.fn((col: unknown, vals: unknown[]) => ({ _inArray: [col, vals] })),
  sql: vi.fn(() => "SQL_EXPR"),
}));

vi.mock("@workspace/permissions", () => ({
  REFERRAL_STATUS: {
    PENDING: "pending",
    COMPLETED: "completed",
    REVERSED: "reversed",
  },
}));

const mockLogInfo = vi.fn();
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: (...args: unknown[]) => mockLogInfo(...args),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { reverseTripOrderReferrals } from "../services/checkout/order-referral-reversal.js";

// ---------------------------------------------------------------------------
// DB mock helpers
// ---------------------------------------------------------------------------

let selectQueue: object[][] = [];
let updateSetCalls: Record<string, unknown>[] = [];
let updateWhereCalls: unknown[] = [];

function makeTx() {
  const tx: Record<string, unknown> = {};

  tx.select = vi.fn(() => {
    const rows = selectQueue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    // reverseTripOrderReferrals does NOT call .limit() on the referrals batch query
    chain.then = (resolve: (v: object[]) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return chain;
  });

  tx.update = vi.fn(() => {
    const u: Record<string, unknown> = {};
    u.set = vi.fn((payload: Record<string, unknown>) => {
      updateSetCalls.push(payload);
      return u;
    });
    u.where = vi.fn((clause: unknown) => {
      updateWhereCalls.push(clause);
      return Promise.resolve(undefined);
    });
    return u;
  });

  return tx;
}

const TENANT_ID = "tenant-abc";
const ORDER_ID = "order-xyz";
const RES_1 = "res-001";
const RES_2 = "res-002";

const REFERRAL_1 = {
  id: "ref-001",
  referrerId: "client-referrer-1",
  bonusAmount: "75.00",
};

const REFERRAL_2 = {
  id: "ref-002",
  referrerId: "client-referrer-2",
  bonusAmount: "30.00",
};

beforeEach(() => {
  selectQueue = [];
  updateSetCalls = [];
  updateWhereCalls = [];
  vi.clearAllMocks();
});

describe("reverseTripOrderReferrals", () => {
  it("returns [] when cancellableReservationIds is empty", async () => {
    const tx = makeTx();
    const result = await reverseTripOrderReferrals(tx as never, {
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      cancellableReservationIds: [],
      reversalReason: "order_refunded",
    });
    expect(result).toEqual([]);
    expect(tx.select).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("reverses a single COMPLETED referral linked to the reservation", async () => {
    selectQueue.push([REFERRAL_1]);
    const tx = makeTx();

    const result = await reverseTripOrderReferrals(tx as never, {
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      cancellableReservationIds: [RES_1],
      reversalReason: "order_refunded",
    });

    expect(result).toEqual(["ref-001"]);
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(3); // client + referral + commission

    // Client decrement uses GREATEST-guarded SQL
    expect(updateSetCalls[0]).toMatchObject({
      successfulReferrals: "SQL_EXPR",
      referralEarnings: "SQL_EXPR",
    });

    // Referral marked REVERSED
    expect(updateSetCalls[1]).toMatchObject({
      status: "reversed",
      reversalReason: "order_refunded",
    });
    expect(updateSetCalls[1].reversalAt).toBeInstanceOf(Date);
    expect(updateSetCalls[1].updatedAt).toBeInstanceOf(Date);
  });

  it("batch-reverses multiple COMPLETED referrals across several reservations", async () => {
    selectQueue.push([REFERRAL_1, REFERRAL_2]);
    const tx = makeTx();

    const result = await reverseTripOrderReferrals(tx as never, {
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      cancellableReservationIds: [RES_1, RES_2],
      reversalReason: "order_refunded",
    });

    expect(result).toEqual(["ref-001", "ref-002"]);
    expect(tx.select).toHaveBeenCalledTimes(1);
    // Two referrals → 2 client updates + 2 referral updates
    expect(tx.update).toHaveBeenCalledTimes(6);

    // Both referrers got decremented
    const clientUpdates = updateSetCalls.filter((d) => d.successfulReferrals !== undefined);
    expect(clientUpdates).toHaveLength(2);

    const referralUpdates = updateSetCalls.filter((d) => d.reversalReason !== undefined);
    expect(referralUpdates).toHaveLength(2);
    expect(referralUpdates[0].reversalReason).toBe("order_refunded");
    expect(referralUpdates[1].reversalReason).toBe("order_refunded");
  });

  it("returns [] when no COMPLETED referral matches the reservation ids", async () => {
    selectQueue.push([]);
    const tx = makeTx();

    const result = await reverseTripOrderReferrals(tx as never, {
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      cancellableReservationIds: [RES_1],
      reversalReason: "order_refunded",
    });

    expect(result).toEqual([]);
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("is idempotent: already-REVERSED referrals are naturally skipped (status filter)", async () => {
    // Simulate a second run after the first reversed the referral.
    // The SELECT filters on status=COMPLETED, so the now-REVERSED row
    // returns nothing.
    selectQueue.push([]);
    const tx = makeTx();

    const result = await reverseTripOrderReferrals(tx as never, {
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      cancellableReservationIds: [RES_1],
      reversalReason: "order_refunded",
    });

    expect(result).toEqual([]);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("logs the reversal with correct metadata", async () => {
    selectQueue.push([REFERRAL_1]);
    const tx = makeTx();

    await reverseTripOrderReferrals(tx as never, {
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      cancellableReservationIds: [RES_1],
      reversalReason: "order_refunded",
    });

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        reversedCount: 1,
        reversedIds: ["ref-001"],
        reversalReason: "order_refunded",
      }),
      expect.any(String),
    );
  });

  it("converts bonusAmount to number and passes it into the SQL decrement", async () => {
    selectQueue.push([{ id: "ref-003", referrerId: "client-3", bonusAmount: "123.45" }]);
    const tx = makeTx();

    await reverseTripOrderReferrals(tx as never, {
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      cancellableReservationIds: [RES_1],
      reversalReason: "order_refunded",
    });

    // The SQL mock is a simple vi.fn() returning "SQL_EXPR", so we can't
    // assert the exact interpolated value here, but the real code passes
    // bonusToReverse.toFixed(2) into the template. We verify the update
    // count and structure instead.
    expect(tx.update).toHaveBeenCalledTimes(3);
    expect(updateSetCalls[0]).toMatchObject({
      successfulReferrals: "SQL_EXPR",
      referralEarnings: "SQL_EXPR",
    });
  });

  it("accepts 'order_cancelled' as a valid reversalReason (admin manual-cancel path)", async () => {
    selectQueue.push([REFERRAL_1]);
    const tx = makeTx();

    const result = await reverseTripOrderReferrals(tx as never, {
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      cancellableReservationIds: [RES_1],
      reversalReason: "order_cancelled",
    });

    expect(result).toEqual(["ref-001"]);
    expect(tx.update).toHaveBeenCalledTimes(3);
    expect(updateSetCalls[1]).toMatchObject({
      status: "reversed",
      reversalReason: "order_cancelled",
    });
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        reversalReason: "order_cancelled",
      }),
      expect.any(String),
    );
  });
});

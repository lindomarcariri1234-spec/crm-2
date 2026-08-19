import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// reverseProductOnlyOrderReferral — service unit tests
//
// Verifies the referral-reversal path that fires when a product-only store
// order (no trip reservation) is refunded or manually cancelled.
//
// Row-identification paths:
//   PRIMARY  — referralId (DB row id stored in pendingReferral.referralId):
//              SELECT WHERE id=? AND tenantId=? AND status=COMPLETED
//              Deterministic even with multiple COMPLETED rows for the same code.
//   FALLBACK — code-based lookup for legacy orders without referralId:
//              SELECT WHERE code=? AND tenantId=? AND status=COMPLETED
//                         AND reservationId IS NULL LIMIT 1
//
// DB call sequence when referralId is provided:
//   1. SELECT by id (primary)  — if found → 2 UPDATEs (client + referral)
//   2. SELECT by code (fallback, only when primary returns nothing)
//      — if found → 2 UPDATEs
//      — if not found → no-op, return false
//
// DB call sequence when referralId is null/undefined:
//   1. SELECT by code (fallback only) — if found → 2 UPDATEs, else no-op
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  referralsTable: {
    id: "id",
    tenantId: "tenant_id",
    code: "code",
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
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _eq: [col, val] })),
  isNull: vi.fn((col: unknown) => ({ _isNull: col })),
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
const mockLogDebug = vi.fn();
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: (...args: unknown[]) => mockLogInfo(...args),
    debug: (...args: unknown[]) => mockLogDebug(...args),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { reverseProductOnlyOrderReferral } from "../services/checkout/order-referral-reversal.js";

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
    chain.limit = vi.fn(() => Promise.resolve(rows));
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
const REFERRAL_CODE = "FRIEND50";
const REFERRER_ID = "client-referrer-1";

const COMPLETED_REFERRAL = {
  id: "referral-001",
  referrerId: REFERRER_ID,
  bonusAmount: "75.00",
};

const COMPLETED_REFERRAL_2 = {
  id: "referral-002",
  referrerId: "client-referrer-2",
  bonusAmount: "100.00",
};

beforeEach(() => {
  selectQueue = [];
  updateSetCalls = [];
  updateWhereCalls = [];
  vi.clearAllMocks();
});

describe("reverseProductOnlyOrderReferral", () => {
  describe("primary path — referralId provided", () => {
    it("reverses the exact referral row found by ID and returns true", async () => {
      // Primary SELECT (by id) returns the referral → no fallback needed
      selectQueue.push([COMPLETED_REFERRAL]);
      const tx = makeTx();

      const result = await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: "referral-001",
        reversalReason: "order_refunded",
      });

      expect(result).toBe(true);
      // One SELECT (primary) + two UPDATEs; no fallback SELECT
      expect(tx.select).toHaveBeenCalledTimes(1);
      expect(tx.update).toHaveBeenCalledTimes(2);
    });

    it("picks the exact row when multiple COMPLETED conversions exist for the same code", async () => {
      // Only the primary SELECT fires; it returns the specific referral-001
      // row. The other COMPLETED row (referral-002, bonus=100) is never seen.
      selectQueue.push([COMPLETED_REFERRAL]); // primary: id=referral-001
      const tx = makeTx();

      const result = await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: "referral-001",
        reversalReason: "order_refunded",
      });

      expect(result).toBe(true);
      // The client decrement reflects referral-001's bonus (75.00), not ref-002's
      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({ bonusToReverse: 75, referralId: "referral-001" }),
        expect.any(String),
      );
      // Only one SELECT — we never touched the code-based fallback path
      expect(tx.select).toHaveBeenCalledTimes(1);
    });

    it("falls back to code-based lookup when primary SELECT returns nothing", async () => {
      // Primary finds nothing → fallback SELECT returns the referral
      selectQueue.push([]); // primary: not found
      selectQueue.push([COMPLETED_REFERRAL]); // fallback: found
      const tx = makeTx();

      const result = await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: "stale-id-no-longer-exists",
        reversalReason: "order_refunded",
      });

      expect(result).toBe(true);
      expect(tx.select).toHaveBeenCalledTimes(2);
      expect(tx.update).toHaveBeenCalledTimes(2);
    });

    it("returns false when both primary and fallback find nothing", async () => {
      selectQueue.push([]); // primary: not found
      selectQueue.push([]); // fallback: not found
      const tx = makeTx();

      const result = await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: "referral-001",
        reversalReason: "order_refunded",
      });

      expect(result).toBe(false);
      expect(tx.update).not.toHaveBeenCalled();
      expect(mockLogDebug).toHaveBeenCalled();
    });
  });

  describe("fallback path — no referralId (legacy orders)", () => {
    it("finds the row by code+reservationId=null and reverses it", async () => {
      // No primary SELECT (referralId is null); only one fallback SELECT
      selectQueue.push([COMPLETED_REFERRAL]);
      const tx = makeTx();

      const result = await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: null,
        reversalReason: "order_refunded",
      });

      expect(result).toBe(true);
      expect(tx.select).toHaveBeenCalledTimes(1);
      expect(tx.update).toHaveBeenCalledTimes(2);
    });

    it("returns false when fallback finds nothing", async () => {
      selectQueue.push([]);
      const tx = makeTx();

      const result = await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: undefined,
        reversalReason: "order_refunded",
      });

      expect(result).toBe(false);
      expect(tx.update).not.toHaveBeenCalled();
    });

    it("uses isNull(reservationId) in the fallback query to exclude trip-linked referrals", async () => {
      const { isNull } = await import("drizzle-orm");
      selectQueue.push([COMPLETED_REFERRAL]);
      const tx = makeTx();

      await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: null,
        reversalReason: "order_refunded",
      });

      // isNull was called exactly once (the fallback path), with the
      // reservationId column (mocked as the string "reservation_id").
      expect(isNull).toHaveBeenCalledTimes(1);
      expect(isNull).toHaveBeenCalledWith("reservation_id");
    });
  });

  describe("UPDATE payloads", () => {
    it("decrements referrer counters with GREATEST-guarded SQL expressions", async () => {
      selectQueue.push([COMPLETED_REFERRAL]);
      const tx = makeTx();

      await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: "referral-001",
        reversalReason: "order_refunded",
      });

      expect(updateSetCalls[0]).toMatchObject({
        successfulReferrals: "SQL_EXPR",
        referralEarnings: "SQL_EXPR",
      });
    });

    it("marks the referral REVERSED with reason and timestamp", async () => {
      selectQueue.push([COMPLETED_REFERRAL]);
      const tx = makeTx();

      await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: "referral-001",
        reversalReason: "order_refunded",
      });

      expect(updateSetCalls[1]).toMatchObject({
        status: "reversed",
        reversalReason: "order_refunded",
      });
      expect(updateSetCalls[1].reversalAt).toBeInstanceOf(Date);
      expect(updateSetCalls[1].updatedAt).toBeInstanceOf(Date);
    });

    it("forwards 'order_cancelled' as the reversalReason", async () => {
      selectQueue.push([COMPLETED_REFERRAL]);
      const tx = makeTx();

      await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: "referral-001",
        reversalReason: "order_cancelled",
      });

      expect(updateSetCalls[1]).toMatchObject({
        status: "reversed",
        reversalReason: "order_cancelled",
      });
    });

    it("converts bonusAmount string to a number for the log and SQL decrement", async () => {
      const referralWithDecimal = { ...COMPLETED_REFERRAL, bonusAmount: "123.45" };
      selectQueue.push([referralWithDecimal]);
      const tx = makeTx();

      await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: "referral-001",
        reversalReason: "order_refunded",
      });

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({ bonusToReverse: 123.45 }),
        expect.any(String),
      );
    });
  });

  describe("idempotency", () => {
    it("returns false on a second call when the row is already REVERSED", async () => {
      // First call — primary SELECT returns COMPLETED referral
      selectQueue.push([COMPLETED_REFERRAL]);
      // Second call — referral is now REVERSED so primary SELECT returns nothing,
      // fallback also returns nothing (the referral no longer has status=COMPLETED)
      selectQueue.push([]);
      selectQueue.push([]);

      const tx = makeTx();

      const first = await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: "referral-001",
        reversalReason: "order_refunded",
      });
      const second = await reverseProductOnlyOrderReferral(tx as never, {
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        referralCode: REFERRAL_CODE,
        referralId: "referral-001",
        reversalReason: "order_refunded",
      });

      expect(first).toBe(true);
      expect(second).toBe(false);
      // First call: 1 SELECT + 2 UPDATEs. Second: 2 SELECTs (both empty) + 0 UPDATEs.
      expect(updateSetCalls).toHaveLength(2);
    });
  });
});

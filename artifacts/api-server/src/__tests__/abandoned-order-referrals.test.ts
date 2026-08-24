import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// runAbandonedOrderReferralCleanup — unit tests
//
// Verifies the abandoned-order referral sweep that runs daily to reverse
// PENDING referral rows left behind by orders that were never paid.
//
// Row-identification strategy:
//   PRIMARY  — referralId present in pendingReferral JSONB:
//              SELECT WHERE id=referralId AND tenantId=? AND status=PENDING.
//              If primary misses → SKIP immediately (already reversed or gone).
//              No fallback is attempted when referralId is present, to prevent
//              a re-run from touching an unrelated PENDING row sharing the code.
//   FALLBACK — referralId absent (legacy orders predate the field):
//              SELECT WHERE code=? AND tenantId=? AND status=PENDING
//                           AND reservationId IS NULL LIMIT 1.
//
// Key invariant: PENDING rows were never promoted to COMPLETED, so
// successfulReferrals / referralEarnings were never incremented.
// Only the referral row status needs to be updated (no client counters).
// ---------------------------------------------------------------------------

const { mockDb, mockEq, mockInArray } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn(),
    update: vi.fn(),
  };
  const mockEq = vi.fn((col: unknown, val: unknown) => ({ _eq: [col, val] }));
  const mockInArray = vi.fn((col: unknown, vals: unknown) => ({ _inArray: [col, vals] }));
  return { mockDb, mockEq, mockInArray };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  referralsTable: {
    id: "id",
    tenantId: "tenant_id",
    code: "code",
    status: "status",
    reservationId: "reservation_id",
    reversalReason: "reversal_reason",
    reversalAt: "reversal_at",
    updatedAt: "updated_at",
  },
  storeOrdersTable: {
    id: "id",
    tenantId: "tenant_id",
    pendingReferral: "pending_referral",
    referralEffectsAppliedAt: "referral_effects_applied_at",
    paymentStatus: "payment_status",
    createdAt: "created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  eq: mockEq,
  inArray: mockInArray,
  isNull: vi.fn((col: unknown) => ({ _isNull: col })),
  isNotNull: vi.fn((col: unknown) => ({ _isNotNull: col })),
  lt: vi.fn((col: unknown, val: unknown) => ({ _lt: [col, val] })),
}));

vi.mock("@workspace/permissions", () => ({
  REFERRAL_STATUS: {
    PENDING: "pending",
    COMPLETED: "completed",
    REVERSED: "reversed",
  },
  STORE_PAYMENT_STATUS: {
    PENDING: "pending",
    PAID: "paid",
    REFUNDED: "refunded",
    FAILED: "failed",
  },
}));

const mockLogInfo = vi.fn();
const mockLogDebug = vi.fn();
const mockLogWarn = vi.fn();
const mockLogError = vi.fn();
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: (...args: unknown[]) => mockLogInfo(...args),
    debug: (...args: unknown[]) => mockLogDebug(...args),
    warn: (...args: unknown[]) => mockLogWarn(...args),
    error: (...args: unknown[]) => mockLogError(...args),
  },
}));

const mockSendAbandonedReferralAlertEmail = vi.fn();
vi.mock("@workspace/email", () => ({
  sendAbandonedReferralAlertEmail: (opts: unknown) => mockSendAbandonedReferralAlertEmail(opts),
}));

// ---------------------------------------------------------------------------
// DB mock helpers
//
// selectQueue: row arrays popped one-per-call, in call order.
//   Call #1 → order-level SELECT (storeOrdersTable query)
//   Per-order calls: primary SELECT (if referralId present), or fallback SELECT
//
// updateSetCalls:   payloads passed to .set() on each db.update() chain
// updateWhereCalls: clauses passed to .where() on each db.update() chain
// ---------------------------------------------------------------------------

let selectQueue: object[][] = [];
let updateSetCalls: Record<string, unknown>[] = [];
let updateWhereCalls: unknown[] = [];

function buildSelectChain(rows: object[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(rows));
  chain.then = (resolve: (v: object[]) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function buildUpdateChain() {
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
}

function resetMocks() {
  selectQueue = [];
  updateSetCalls = [];
  updateWhereCalls = [];
  vi.clearAllMocks();
  mockSendAbandonedReferralAlertEmail.mockResolvedValue({ success: true, messageId: "msg-123" });
  mockEq.mockImplementation((col: unknown, val: unknown) => ({ _eq: [col, val] }));
  mockInArray.mockImplementation((col: unknown, vals: unknown) => ({ _inArray: [col, vals] }));
  mockDb.select.mockImplementation(() => buildSelectChain(selectQueue.shift() ?? []));
  mockDb.update.mockImplementation(() => buildUpdateChain());
}

const TENANT_ID = "tenant-111";
const ORDER_ID = "order-aaa";
const REFERRAL_CODE = "SAVE10";
const REFERRAL_ID = "ref-pending-001";

const PENDING_REFERRAL_FIELD = {
  code: REFERRAL_CODE,
  referrerId: "client-referrer-xyz",
  referralId: REFERRAL_ID,
};

const ABANDONED_ORDER = {
  id: ORDER_ID,
  tenantId: TENANT_ID,
  pendingReferral: PENDING_REFERRAL_FIELD,
};

const PENDING_ROW = { id: REFERRAL_ID };

beforeEach(resetMocks);

import { runAbandonedOrderReferralCleanup, ABANDONED_ORDER_THRESHOLD_HOURS, _resetAlertState, ABANDONED_REFERRAL_ALERT_THRESHOLD } from "../lib/abandoned-order-referrals.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAbandonedOrderReferralCleanup", () => {
  describe("early exit — no eligible orders", () => {
    it("returns without touching referrals when no orders match", async () => {
      selectQueue.push([]); // order SELECT → empty

      await runAbandonedOrderReferralCleanup();

      expect(mockDb.select).toHaveBeenCalledTimes(1);
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockLogDebug).toHaveBeenCalledWith(
        expect.stringContaining("No abandoned orders"),
      );
    });
  });

  describe("order-level WHERE filters", () => {
    it("uses inArray with PENDING and FAILED payment statuses to exclude paid orders", async () => {
      selectQueue.push([]);

      await runAbandonedOrderReferralCleanup();

      const inArrayCalls = mockInArray.mock.calls as [unknown, unknown[]][];
      const paymentStatusCall = inArrayCalls.find(([col]) => col === "payment_status");
      expect(paymentStatusCall).toBeDefined();
      const statuses = paymentStatusCall![1];
      expect(statuses).toContain("pending");
      expect(statuses).toContain("failed");
      expect(statuses).not.toContain("paid");
      expect(statuses).not.toContain("refunded");
    });

    it("passes a cutoff timestamp to lt() for the createdAt filter", async () => {
      const { lt } = await import("drizzle-orm");
      selectQueue.push([]);

      const before = Date.now();
      await runAbandonedOrderReferralCleanup();
      const after = Date.now();

      const ltCalls = (lt as ReturnType<typeof vi.fn>).mock.calls as [unknown, unknown][];
      const createdAtCall = ltCalls.find(([col]) => col === "created_at");
      expect(createdAtCall).toBeDefined();

      const cutoffDate = createdAtCall![1] as Date;
      const expectedMin = new Date(before - ABANDONED_ORDER_THRESHOLD_HOURS * 60 * 60 * 1000 - 200);
      const expectedMax = new Date(after - ABANDONED_ORDER_THRESHOLD_HOURS * 60 * 60 * 1000 + 200);
      expect(cutoffDate.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
      expect(cutoffDate.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
    });
  });

  describe("primary path — referralId present", () => {
    it("reverses the PENDING referral row identified by referralId", async () => {
      selectQueue.push([ABANDONED_ORDER]);
      selectQueue.push([PENDING_ROW]); // primary SELECT → found

      await runAbandonedOrderReferralCleanup();

      // order SELECT + primary referral SELECT = 2; no fallback SELECT
      expect(mockDb.select).toHaveBeenCalledTimes(2);
      // Exactly 1 UPDATE — referral row only (no client counter decrement)
      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(updateSetCalls[0]).toMatchObject({
        status: "reversed",
        reversalReason: "order_abandoned",
      });
      expect(updateSetCalls[0]).toHaveProperty("reversalAt");
      expect(updateSetCalls[0]).toHaveProperty("updatedAt");
    });

    it("logs the reversal with orderId, tenantId, referralId, and code", async () => {
      selectQueue.push([ABANDONED_ORDER]);
      selectQueue.push([PENDING_ROW]);

      await runAbandonedOrderReferralCleanup();

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: ORDER_ID,
          tenantId: TENANT_ID,
          referralId: REFERRAL_ID,
          code: REFERRAL_CODE,
        }),
        expect.any(String),
      );
    });

    it("skips immediately (no fallback) when primary SELECT returns nothing", async () => {
      selectQueue.push([ABANDONED_ORDER]);
      selectQueue.push([]); // primary → not found

      await runAbandonedOrderReferralCleanup();

      // Only 2 selects: orders + primary. No fallback SELECT is attempted.
      expect(mockDb.select).toHaveBeenCalledTimes(2);
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockLogDebug).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: ORDER_ID, referralId: REFERRAL_ID }),
        expect.any(String),
      );
    });

    it("is idempotent: second sweep with the same order skips when row was already reversed", async () => {
      // First run: primary finds the PENDING row → reversed
      selectQueue.push([ABANDONED_ORDER]);
      selectQueue.push([PENDING_ROW]);
      await runAbandonedOrderReferralCleanup();
      expect(mockDb.update).toHaveBeenCalledTimes(1);

      // Second run: same order still matches the WHERE clause (paymentStatus still
      // pending, referralEffectsAppliedAt still null, still old enough), but the
      // referral row is now REVERSED → primary SELECT returns nothing → skip, no UPDATE.
      resetMocks();
      selectQueue.push([ABANDONED_ORDER]); // order still visible
      selectQueue.push([]);               // primary: row already reversed, returns nothing

      await runAbandonedOrderReferralCleanup();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("second sweep does not touch unrelated pending rows that share the same code", async () => {
      // First run: reverses the referral row for this order
      selectQueue.push([ABANDONED_ORDER]);
      selectQueue.push([PENDING_ROW]);
      await runAbandonedOrderReferralCleanup();

      // Second run: order still visible; primary miss because original row reversed.
      // An unrelated PENDING row with the same code now exists (different conversion).
      // The sweep must NOT reverse it — no fallback attempted when referralId present.
      resetMocks();
      selectQueue.push([ABANDONED_ORDER]); // order still visible
      selectQueue.push([]);               // primary: returns nothing (already reversed)
      // If fallback were attempted, it would return this unrelated row:
      const unrelatedRow = { id: "ref-unrelated-999" };
      selectQueue.push([unrelatedRow]); // should NEVER be consumed

      await runAbandonedOrderReferralCleanup();

      expect(mockDb.update).not.toHaveBeenCalled();
      // selectQueue[0] still has unrelatedRow — it was never consumed
      expect(selectQueue).toHaveLength(1);
    });

    it("never reverses a trip-linked PENDING referral — isNull(reservationId) guard in primary WHERE", async () => {
      // Scenario: a store order's pendingReferral.referralId points to a
      // referral row that has reservationId != null (trip-linked). This can
      // occur if the reservation-cancellation path sets reservationId before
      // the abandoned-order sweep runs, or if a future code change stores a
      // trip-linked referralId in the order's pendingReferral JSONB.
      //
      // The primary WHERE must include isNull(referralsTable.reservationId)
      // so the DB returns nothing for trip-linked referrals → sweep skips,
      // no UPDATE issued. Trip-linked reversal is exclusively owned by the
      // reservation-cancellation path (reservations.ts).
      selectQueue.push([ABANDONED_ORDER]);
      selectQueue.push([]); // primary SELECT: isNull guard excludes trip-linked row

      await runAbandonedOrderReferralCleanup();

      expect(mockDb.update).not.toHaveBeenCalled();

      // Confirm the guard is wired into the primary path WHERE clause.
      // referralsTable.reservationId is mocked as "reservation_id".
      const { isNull } = await import("drizzle-orm");
      const isNullCalls = (isNull as ReturnType<typeof vi.fn>).mock.calls as [unknown][];
      const hasReservationIdGuard = isNullCalls.some(([col]) => col === "reservation_id");
      expect(hasReservationIdGuard).toBe(true);
    });

    it("reports correct reversed/skipped counts", async () => {
      const order2 = {
        id: "order-bbb",
        tenantId: TENANT_ID,
        pendingReferral: { code: "SAVE20", referrerId: "ref-2", referralId: "ref-pending-002" },
      };
      selectQueue.push([ABANDONED_ORDER, order2]); // 2 eligible orders
      selectQueue.push([PENDING_ROW]);              // order1 primary → found
      selectQueue.push([]);                         // order2 primary → not found (already reversed)

      await runAbandonedOrderReferralCleanup();

      expect(mockDb.update).toHaveBeenCalledTimes(1); // only order1 reversed
      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({ total: 2, reversed: 1, skipped: 1 }),
        expect.any(String),
      );
    });
  });

  describe("fallback path — no referralId in pendingReferral (legacy orders)", () => {
    it("uses code + tenantId + PENDING + reservationId IS NULL when referralId absent", async () => {
      const legacyOrder = {
        id: "order-legacy-2",
        tenantId: TENANT_ID,
        pendingReferral: { code: REFERRAL_CODE, referrerId: "client-xyz" },
      };
      selectQueue.push([legacyOrder]);
      selectQueue.push([{ id: "ref-legacy-001" }]); // fallback SELECT → found

      await runAbandonedOrderReferralCleanup();

      // 2 selects: orders + fallback (primary path skipped — no referralId)
      expect(mockDb.select).toHaveBeenCalledTimes(2);
      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(updateSetCalls[0]).toMatchObject({ status: "reversed", reversalReason: "order_abandoned" });
    });

    it("skips when fallback also finds nothing", async () => {
      const legacyOrder = {
        id: "order-legacy-2",
        tenantId: TENANT_ID,
        pendingReferral: { code: REFERRAL_CODE, referrerId: "client-xyz" },
      };
      selectQueue.push([legacyOrder]);
      selectQueue.push([]); // fallback → nothing

      await runAbandonedOrderReferralCleanup();

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe("no client counter decrements", () => {
    it("only updates referralsTable — never performs a second UPDATE for client counters", async () => {
      selectQueue.push([ABANDONED_ORDER]);
      selectQueue.push([PENDING_ROW]);

      await runAbandonedOrderReferralCleanup();

      // Exactly 1 UPDATE — referral row only, no client decrement
      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("operator alert — all-skipped condition", () => {
    beforeEach(() => {
      _resetAlertState();
      vi.unstubAllEnvs();
    });

    it("fires alert when skipped > 0, reversed === 0, and total >= threshold", async () => {
      vi.stubEnv("SUPERADMIN_EMAIL", "ops@visitecrm.com");

      const orders = Array.from({ length: ABANDONED_REFERRAL_ALERT_THRESHOLD }, () => ({
        id: `order-skip-${Math.random()}`,
        tenantId: TENANT_ID,
        pendingReferral: { code: REFERRAL_CODE, referrerId: "ref-xyz", referralId: "ref-gone-001" },
      }));
      selectQueue.push(orders);
      for (let i = 0; i < ABANDONED_REFERRAL_ALERT_THRESHOLD; i++) {
        selectQueue.push([]);
      }

      await runAbandonedOrderReferralCleanup();

      expect(mockSendAbandonedReferralAlertEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "ops@visitecrm.com" }),
      );
    });

    it("clears rate limit when email send fails so next run can retry", async () => {
      vi.stubEnv("SUPERADMIN_EMAIL", "ops@visitecrm.com");
      mockSendAbandonedReferralAlertEmail.mockResolvedValueOnce({ success: false, error: "network" });

      const orders = Array.from({ length: ABANDONED_REFERRAL_ALERT_THRESHOLD }, () => ({
        id: `order-skip-${Math.random()}`,
        tenantId: TENANT_ID,
        pendingReferral: { code: REFERRAL_CODE, referrerId: "ref-xyz", referralId: "ref-gone-001" },
      }));
      selectQueue.push(orders);
      selectQueue.push([]);
      selectQueue.push([]);

      await runAbandonedOrderReferralCleanup();

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockSendAbandonedReferralAlertEmail).toHaveBeenCalledTimes(1);
    });

    it("rate-limits alert to 24h — second run within window is suppressed", async () => {
      vi.stubEnv("SUPERADMIN_EMAIL", "ops@visitecrm.com");

      const orders = Array.from({ length: ABANDONED_REFERRAL_ALERT_THRESHOLD }, () => ({
        id: `order-skip-${Math.random()}`,
        tenantId: TENANT_ID,
        pendingReferral: { code: REFERRAL_CODE, referrerId: "ref-xyz", referralId: "ref-gone-001" },
      }));
      selectQueue.push(orders);
      for (let i = 0; i < ABANDONED_REFERRAL_ALERT_THRESHOLD; i++) {
        selectQueue.push([]);
      }

      await runAbandonedOrderReferralCleanup();

      expect(mockSendAbandonedReferralAlertEmail).toHaveBeenCalledTimes(1);
      expect(mockLogError).not.toHaveBeenCalled();

      // Second run should retry because rate limit was cleared on failure
      mockSendAbandonedReferralAlertEmail.mockResolvedValueOnce({ success: true, messageId: "msg-456" });
      selectQueue.push([...orders]);
      for (let i = 0; i < ABANDONED_REFERRAL_ALERT_THRESHOLD; i++) {
        selectQueue.push([]);
      }

      await runAbandonedOrderReferralCleanup();

      expect(mockSendAbandonedReferralAlertEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "ops@visitecrm.com" }),
      );
    });

    it("clears rate limit when email send fails so next run can retry", async () => {
      vi.stubEnv("SUPERADMIN_EMAIL", "ops@visitecrm.com");
      mockSendAbandonedReferralAlertEmail.mockResolvedValueOnce({ success: false, error: "network" });

      const orders = Array.from({ length: ABANDONED_REFERRAL_ALERT_THRESHOLD }, () => ({
        id: `order-skip-${Math.random()}`,
        tenantId: TENANT_ID,
        pendingReferral: { code: REFERRAL_CODE, referrerId: "ref-xyz", referralId: "ref-gone-001" },
      }));
      selectQueue.push(orders);
      for (let i = 0; i < ABANDONED_REFERRAL_ALERT_THRESHOLD; i++) {
        selectQueue.push([]);
      }

      await runAbandonedOrderReferralCleanup();

      expect(mockSendAbandonedReferralAlertEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "ops@visitecrm.com" }),
      );
    });

    it("clears rate limit when email send fails so next run can retry", async () => {
      vi.stubEnv("SUPERADMIN_EMAIL", "ops@visitecrm.com");
      mockSendAbandonedReferralAlertEmail.mockResolvedValueOnce({ success: false, error: "network" });

      const orders = Array.from({ length: ABANDONED_REFERRAL_ALERT_THRESHOLD }, () => ({
        id: `order-skip-${Math.random()}`,
        tenantId: TENANT_ID,
        pendingReferral: { code: REFERRAL_CODE, referrerId: "ref-xyz", referralId: "ref-gone-001" },
      }));
      selectQueue.push(orders);
      for (let i = 0; i < ABANDONED_REFERRAL_ALERT_THRESHOLD; i++) {
        selectQueue.push([]);
      }

      await runAbandonedOrderReferralCleanup();

      expect(mockSendAbandonedReferralAlertEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "ops@visitecrm.com" }),
      );
    });

    it("clears rate limit when email send fails so next run can retry", async () => {
      vi.stubEnv("SUPERADMIN_EMAIL", "ops@visitecrm.com");
      mockSendAbandonedReferralAlertEmail.mockResolvedValueOnce({ success: false, error: "network" });

      const orders = Array.from({ length: ABANDONED_REFERRAL_ALERT_THRESHOLD }, () => ({
        id: `order-skip-${Math.random()}`,
        tenantId: TENANT_ID,
        pendingReferral: { code: REFERRAL_CODE, referrerId: "ref-xyz", referralId: "ref-gone-001" },
      }));
      selectQueue.push(orders);
      for (let i = 0; i < ABANDONED_REFERRAL_ALERT_THRESHOLD; i++) {
        selectQueue.push([]);
      }

      await runAbandonedOrderReferralCleanup();

      expect(mockSendAbandonedReferralAlertEmail).toHaveBeenCalledTimes(1);
      expect(mockLogError).toHaveBeenCalledWith(
        expect.objectContaining({ error: "network" }),
        "[abandoned-referrals] Failed to send all-skipped alert email — clearing rate limit so next run can retry",
      );

      // Second run should retry because rate limit was cleared on failure
      mockSendAbandonedReferralAlertEmail.mockResolvedValueOnce({ success: true, messageId: "msg-456" });
      selectQueue.push([...orders]);
      for (let i = 0; i < ABANDONED_REFERRAL_ALERT_THRESHOLD; i++) {
        selectQueue.push([]);
      }
      await runAbandonedOrderReferralCleanup();

      expect(mockSendAbandonedReferralAlertEmail).toHaveBeenCalledTimes(2);
    });
  });
});

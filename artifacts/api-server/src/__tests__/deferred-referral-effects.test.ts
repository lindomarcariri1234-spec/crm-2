import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// applyDeferredOrderCredits — task #17 deferral hardening
// ---------------------------------------------------------------------------
// NOTE: the production code uses logger.warn (from ../../lib/logger), NOT
// console.warn. Mock the logger module so warn calls are observable.
// ---------------------------------------------------------------------------
//
// Referrer conversion crediting AND referral-credit consumption are deferred
// from checkout to payment confirmation, so an anonymous/unpaid storefront order
// can never credit a referrer or burn a customer's referral credit before money
// is captured. This verifies the payment-time applier:
//   - applies exactly once (idempotent under webhook retries / "mark paid")
//   - only runs once payment_status === PAID
//   - links the conversion to the first reservation of the order (null for
//     product-only orders)
//   - consumes referral credit best-effort: a shortfall is capped + logged,
//     never thrown (money is already captured)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: { transaction: vi.fn() },
  storeOrdersTable: {
    id: "id",
    tenantId: "tenant_id",
    clientId: "client_id",
    orderNumber: "order_number",
    customerEmail: "customer_email",
    customerName: "customer_name",
    discountAmount: "discount_amount",
    ipAddress: "ip_address",
    paymentStatus: "payment_status",
    pendingReferral: "pending_referral",
    pendingCreditSpend: "pending_credit_spend",
    referralEffectsAppliedAt: "referral_effects_applied_at",
  },
  referralsTable: {
    id: "id",
    tenantId: "tenant_id",
    bonusAmount: "bonus_amount",
    bonusCreditUsedAmount: "bonus_credit_used_amount",
    bonusCreditUsedAt: "bonus_credit_used_at",
    bonusCreditOrderId: "bonus_credit_order_id",
    updatedAt: "updated_at",
  },
  reservationsTable: {
    id: "id",
    tenantId: "tenant_id",
    storeOrderId: "store_order_id",
    createdAt: "created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  sql: vi.fn(() => "SQL_EXPR"),
}));

vi.mock("@workspace/permissions", () => ({
  STORE_PAYMENT_STATUS: { PAID: "paid", PENDING: "pending" },
}));

const mockRecordReferralConversion = vi.fn();
vi.mock("../services/checkout/referral-conversion.js", () => ({
  recordReferralConversion: (...args: unknown[]) =>
    mockRecordReferralConversion(...args),
}));

// deferred-referral-effects.ts uses logger.warn (not console.warn).
// Wrap in a closure so the factory can run hoisted before mockLogWarn is assigned.
const mockLogWarn = vi.fn();
vi.mock("../lib/logger.js", () => ({
  logger: {
    warn:  (...args: unknown[]) => mockLogWarn(...args),
    error: vi.fn(),
    info:  vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { db } from "@workspace/db";
import { applyDeferredOrderCredits } from "../services/checkout/deferred-referral-effects.js";

// db.transaction(cb) → cb(tx). Each tx.select() pops the next result set off this
// queue (in call order: order-lock, then credit-rows, then reservation lookup).
// The chain is thenable (for `await …for("update")`) and exposes .limit() (for
// `await …limit(1)`); both resolve to the popped set. tx.update().set() payloads
// are captured in updateSetCalls.
let selectQueue: object[][] = [];
let updateSetCalls: Record<string, unknown>[] = [];

function makeTx() {
  const tx: Record<string, unknown> = {};
  tx.select = vi.fn(() => {
    const rows = selectQueue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.for = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
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
    u.where = vi.fn(() => Promise.resolve(undefined));
    return u;
  });
  return tx;
}

function installTx(results: object[][]) {
  selectQueue = [...results];
  (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (tx: unknown) => unknown) => cb(makeTx()),
  );
}

const PAID_ORDER = {
  id: "order-1",
  tenantId: "tenant-1",
  clientId: "client-1",
  orderNumber: "VIS-PROD-202606-00001",
  customerEmail: "joao@example.com",
  customerName: "João Silva",
  discountAmount: "20.00",
  ipAddress: "203.0.113.7",
  paymentStatus: "paid",
  pendingReferral: null as unknown,
  pendingCreditSpend: null as unknown,
  referralEffectsAppliedAt: null as Date | null,
};

const REFERRAL = {
  code: "VALID-REF",
  referrerId: "ref-client-1",
  discountValue: 10,
  discountType: "percentage",
  cookieId: "ck-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  updateSetCalls = [];
  mockRecordReferralConversion.mockResolvedValue({
    tierUpgraded: false,
    newTierLevel: "bronze",
    newTierLabel: "Bronze",
    bonusMultiplier: 1,
  });
});

describe("applyDeferredOrderCredits", () => {
  it("applies the conversion + credit once for a PAID order and links the first reservation", async () => {
    mockRecordReferralConversion.mockResolvedValueOnce({
      tierUpgraded: true,
      newTierLevel: "silver",
      newTierLabel: "Prata",
      bonusMultiplier: 1.5,
    });
    installTx([
      [{ ...PAID_ORDER, pendingReferral: REFERRAL, pendingCreditSpend: [{ id: "refrow-1", consumedAmount: 15 }] }],
      [{ id: "refrow-1", bonusAmount: "30.00", bonusCreditUsedAmount: "0.00" }], // locked credit rows
      [{ id: "res-1" }], // first reservation for order
    ]);

    const result = await applyDeferredOrderCredits("order-1");

    expect(result.conversionApplied).toBe(true);
    expect(result.conversion?.tierUpgraded).toBe(true);
    expect(mockRecordReferralConversion).toHaveBeenCalledTimes(1);
    expect(mockRecordReferralConversion.mock.calls[0][1]).toMatchObject({
      tenantId: "tenant-1",
      referrerId: "ref-client-1",
      referralCode: "VALID-REF",
      referredClientId: "client-1",
      discountAmount: 20,
      reservationId: "res-1",
    });
    // One credit consumption update + the final applied marker.
    expect(updateSetCalls).toHaveLength(2);
    expect(updateSetCalls[0]).toMatchObject({ bonusCreditOrderId: "order-1" });
    expect(updateSetCalls[1].referralEffectsAppliedAt).toBeInstanceOf(Date);
  });

  it("is a no-op when the effects were already applied (idempotent under retries)", async () => {
    installTx([
      [{ ...PAID_ORDER, pendingReferral: REFERRAL, referralEffectsAppliedAt: new Date() }],
    ]);

    const result = await applyDeferredOrderCredits("order-1");

    expect(result.conversionApplied).toBe(false);
    expect(mockRecordReferralConversion).not.toHaveBeenCalled();
    expect(updateSetCalls).toHaveLength(0);
  });

  it("does nothing until payment is confirmed (status !== PAID)", async () => {
    installTx([
      [{
        ...PAID_ORDER,
        paymentStatus: "pending",
        pendingReferral: REFERRAL,
        pendingCreditSpend: [{ id: "refrow-1", consumedAmount: 15 }],
      }],
    ]);

    const result = await applyDeferredOrderCredits("order-1");

    expect(result.conversionApplied).toBe(false);
    expect(mockRecordReferralConversion).not.toHaveBeenCalled();
    expect(updateSetCalls).toHaveLength(0);
  });

  it("passes a null reservationId for a product-only order (no reservation)", async () => {
    installTx([
      [{ ...PAID_ORDER, pendingReferral: REFERRAL }],
      [], // reservation lookup → none
    ]);

    const result = await applyDeferredOrderCredits("order-1");

    expect(result.conversionApplied).toBe(true);
    expect(mockRecordReferralConversion).toHaveBeenCalledTimes(1);
    expect(mockRecordReferralConversion.mock.calls[0][1]).toMatchObject({ reservationId: null });
    // Only the applied marker (no credit consumption planned).
    expect(updateSetCalls).toHaveLength(1);
    expect(updateSetCalls[0].referralEffectsAppliedAt).toBeInstanceOf(Date);
  });

  it("caps a credit shortfall and logs it instead of throwing", async () => {
    installTx([
      [{ ...PAID_ORDER, pendingCreditSpend: [{ id: "refrow-1", consumedAmount: 50 }] }],
      [{ id: "refrow-1", bonusAmount: "30.00", bonusCreditUsedAmount: "10.00" }], // only 20 available
    ]);

    const result = await applyDeferredOrderCredits("order-1");

    expect(result.conversionApplied).toBe(false); // no referral on this order
    // Production code calls logger.warn (not console.warn) when credit is capped.
    expect(mockLogWarn).toHaveBeenCalled();
    expect(mockRecordReferralConversion).not.toHaveBeenCalled();
    // Capped credit update + applied marker — and it did not throw.
    expect(updateSetCalls).toHaveLength(2);
    expect(updateSetCalls[0]).toMatchObject({ bonusCreditOrderId: "order-1" });
  });

  it("warns and skips when a planned credit row is missing, still marking applied", async () => {
    installTx([
      [{ ...PAID_ORDER, pendingCreditSpend: [{ id: "ghost", consumedAmount: 10 }] }],
      [], // locked credit rows → row not found
    ]);

    const result = await applyDeferredOrderCredits("order-1");

    expect(result.conversionApplied).toBe(false);
    // Production code calls logger.warn (not console.warn) when a credit row is missing.
    expect(mockLogWarn).toHaveBeenCalled();
    // No credit update (row missing); only the applied marker.
    expect(updateSetCalls).toHaveLength(1);
    expect(updateSetCalls[0].referralEffectsAppliedAt).toBeInstanceOf(Date);
  });

  it("is a no-op when the order does not exist", async () => {
    installTx([[]]); // order-lock returns nothing

    const result = await applyDeferredOrderCredits("missing-order");

    expect(result.conversionApplied).toBe(false);
    expect(mockRecordReferralConversion).not.toHaveBeenCalled();
    expect(updateSetCalls).toHaveLength(0);
  });

  // ── Pending-row de-duplication: UPDATE path ───────────────────────────────
  //
  // When the checkout creates a PENDING referral row, its id is stored in
  // pendingReferral.referralId. At payment time, applyDeferredOrderCredits must
  // forward that id as existingReferralId to recordReferralConversion so it
  // UPDATEs the pending row to 'completed' instead of inserting a duplicate.

  it("forwards existingReferralId to recordReferralConversion when referralId is present in pendingReferral (UPDATE path, prevents duplicate row)", async () => {
    const REFERRAL_WITH_ID = { ...REFERRAL, referralId: "pending-ref-row-1" };
    installTx([
      [{ ...PAID_ORDER, pendingReferral: REFERRAL_WITH_ID }],
      [], // reservation lookup → product-only order, no reservation
    ]);

    const result = await applyDeferredOrderCredits("order-1");

    expect(result.conversionApplied).toBe(true);
    expect(mockRecordReferralConversion).toHaveBeenCalledTimes(1);
    // The pending-row id must be forwarded so recordReferralConversion can UPDATE
    // the existing row instead of inserting a second one (de-duplication invariant).
    expect(mockRecordReferralConversion.mock.calls[0][1]).toMatchObject({
      existingReferralId: "pending-ref-row-1",
    });
  });

  // ── Backward-compat: INSERT path for pre-feature orders ──────────────────
  //
  // Orders placed before the pending-row feature was shipped have no referralId
  // in pendingReferral. recordReferralConversion must receive existingReferralId=null
  // so it falls through to the INSERT path — the same as the original behavior.

  it("passes existingReferralId=null when referralId is absent from pendingReferral (backward-compat INSERT path)", async () => {
    // REFERRAL has no referralId field — mimics orders placed before the
    // pending-row feature shipped (Task #56 backward-compat requirement).
    installTx([
      [{ ...PAID_ORDER, pendingReferral: REFERRAL }],
      [], // reservation lookup → product-only order, no reservation
    ]);

    const result = await applyDeferredOrderCredits("order-1");

    expect(result.conversionApplied).toBe(true);
    expect(mockRecordReferralConversion).toHaveBeenCalledTimes(1);
    // existingReferralId must be null → recordReferralConversion will INSERT a new row
    // instead of attempting to UPDATE a non-existent pending row.
    expect(mockRecordReferralConversion.mock.calls[0][1]).toMatchObject({
      existingReferralId: null,
    });
  });
});

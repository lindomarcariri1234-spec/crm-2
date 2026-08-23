/**
 * Unit tests for recordReferralConversion — UPDATE vs INSERT branching.
 *
 * When `existingReferralId` is a non-null string, the function must UPDATE the
 * PENDING row that was already inserted at checkout time (to avoid inserting a
 * duplicate 'completed' row). When it is null, the function must INSERT a new
 * 'completed' row (backward-compatible path for orders placed before the
 * pending-row feature shipped).
 *
 * These tests mock the tx object directly (same pattern as
 * deferred-referral-effects.test.ts) and assert on captured update/insert payloads.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before imports so vi.mock hoisting works correctly
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  referralsTable:         { id: "id", tenantId: "tenant_id", status: "status" },
  referralCommissionsTable: { id: "id" },
  partnersTable: { id: "id", tenantId: "tenant_id", status: "status", referralCommissionEligible: "referral_commission_eligible" },
  referralSettingsTable:  { tenantId: "tenant_id" },
  referralTrackingTable:  { tenantId: "tenant_id", cookieId: "cookie_id", referralCode: "referral_code" },
  storeOrdersTable:       { tenantId: "tenant_id", clientId: "client_id", createdAt: "created_at", ipAddress: "ip_address" },
  clientsTable:           {
    id: "id",
    tenantId: "tenant_id",
    email: "email",
    referredById: "referred_by_id",
    referralCode: "referral_code",
    successfulReferrals: "successful_referrals",
    totalReferrals: "total_referrals",
    referralEarnings: "referral_earnings",
    status: "status",
    ambassadorOptIn: "ambassador_opt_in",
    referralCodeStatus: "referral_code_status",
  },
  loyaltyMembersTable:       { id: "id", tenantId: "tenant_id", clientId: "client_id", programId: "program_id", totalPoints: "total_points", availablePoints: "available_points" },
  loyaltyTransactionsTable:  { id: "id", tenantId: "tenant_id", memberId: "member_id", referenceId: "reference_id", referenceType: "reference_type" },
  loyaltyProgramsTable:      { id: "id", isActive: "is_active" },
}));

vi.mock("drizzle-orm", () => ({
  and:     vi.fn((...args) => args),
  eq:      vi.fn((col, val) => `${String(col)}=${String(val)}`),
  desc:    vi.fn(() => "desc"),
  sql:     Object.assign(vi.fn(() => "SQL_EXPR"), { raw: vi.fn() }),
  inArray: vi.fn(() => "inArray"),
}));

vi.mock("@workspace/permissions", () => ({
  REFERRAL_STATUS: { PENDING: "pending", COMPLETED: "completed" },
}));

const mockApplyActiveCampaignBonus = vi.fn();
vi.mock("../lib/referral-campaigns.js", () => ({
  applyActiveCampaignBonus: (...args: unknown[]) => mockApplyActiveCampaignBonus(...args),
  normalizeReferralChannel: (source?: string, medium?: string) => source ? (medium ? `${source}:${medium}` : source) : "direct",
  referralActivitySegment: (successfulReferrals: number) => successfulReferrals >= 3 ? "active" : successfulReferrals >= 1 ? "occasional" : "inactive",
}));

const mockComputeReferralTier = vi.fn();
vi.mock("../lib/referral-tiers.js", () => ({
  computeReferralTier: (...args: unknown[]) => mockComputeReferralTier(...args),
}));

const mockDetectReferralFraud = vi.fn();
vi.mock("../lib/referral-fraud.js", () => ({
  detectReferralFraud: (...args: unknown[]) => mockDetectReferralFraud(...args),
}));

vi.mock("../lib/pricing.js", () => ({
  roundMoney: (v: number) => Math.round(v * 100) / 100,
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "new-gen-id"),
}));

vi.mock("../lib/loyalty-helpers.js", () => ({
  calculateTier: vi.fn(() => "bronze"),
}));

// ---------------------------------------------------------------------------
// Import the function under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { recordReferralConversion } from "../services/checkout/referral-conversion.js";
import type { Tx } from "../services/checkout/tx.js";

// ---------------------------------------------------------------------------
// Shared test infrastructure
// ---------------------------------------------------------------------------

let selectQueue: object[][] = [];
let updateSetCalls: Record<string, unknown>[] = [];
let insertValueCalls: Record<string, unknown>[] = [];

function makeTx() {
  const tx: Record<string, unknown> = {};

  tx.select = vi.fn(() => {
    const rows = selectQueue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from    = vi.fn(() => chain);
    chain.where   = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit   = vi.fn(() => Promise.resolve(rows));
    chain.then    = (
      resolve: (v: object[]) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject);
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

  tx.insert = vi.fn(() => {
    const ins: Record<string, unknown> = {};
    ins.values = vi.fn((vals: Record<string, unknown>) => {
      insertValueCalls.push(vals);
      return { onConflictDoNothing: vi.fn(() => Promise.resolve([])) };
    });
    return ins;
  });

  return tx as unknown as Tx;
}

// ---------------------------------------------------------------------------
// Common fixtures
// ---------------------------------------------------------------------------

const REF_SETTINGS = {
  bonusValue:              "10",
  bonusType:               "percentage",
  tiersConfig:             null,
  expirationDays:          "30",
  pointsPerReferral:       "0",  // disable loyalty path to keep select queue short
  loyaltyPointsEmailEnabled: true,
  discountExpirationDays:  null,
  maxReferralsPerUser:     null,
};

const REFERRER = {
  successfulReferrals: 2,
  email: "referrer@example.com",
  status: "active",
  ambassadorOptIn: false,
  referralCodeStatus: "active",
};

const BASE_ARGS = {
  tenantId:          "tenant-001",
  referrerId:        "referrer-001",
  referralCode:      "VALID-REF",
  referredClientId:  null as string | null,  // null → skip referred-client update
  customerEmail:     "customer@example.com",
  customerName:      "Customer Name",
  discountAmount:    10,
  discountValue:     5,
  discountType:      "percentage",
  referralCookieId:  undefined,  // direct attribution; never select a tracking row by shared code
  conversionIp:      null,
};

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue       = [];
  updateSetCalls    = [];
  insertValueCalls  = [];

  // Default mock responses for helpers used by all paths
  mockApplyActiveCampaignBonus.mockResolvedValue({ adjustedBase: 10, fixedExtra: 0 });
  mockComputeReferralTier.mockReturnValue({
    tier: { level: "bronze", label: "Bronze", bonusMultiplier: 1 },
  });
  mockDetectReferralFraud.mockReturnValue({ flagged: false });
});

// ---------------------------------------------------------------------------
// Helpers — queue the selects that every path needs
//   1. referralSettingsTable
//   2. clientsTable (referrer)
//   3. storeOrdersTable (last referrer order, fraud)
// ---------------------------------------------------------------------------

function queueCommonSelects() {
  selectQueue.push(
    [REF_SETTINGS],  // 1. referral settings
    [REFERRER],      // 2. referrer client row
    [],              // 3. storeOrdersTable — no prior order (no fraud signal)
  );
}

// ---------------------------------------------------------------------------
// UPDATE path — existingReferralId non-null
// ---------------------------------------------------------------------------

describe("recordReferralConversion — UPDATE path (existingReferralId non-null)", () => {
  it("calls tx.update with status='completed' and does NOT call tx.insert when existingReferralId is provided", async () => {
    queueCommonSelects();
    const tx = makeTx();

    await recordReferralConversion(tx, {
      ...BASE_ARGS,
      existingReferralId: "existing-ref-row-1",
    });

    // At least one update must carry status='completed' (the pending → completed promotion).
    const referralStatusUpdate = updateSetCalls.find(
      (u) => u.status === "completed",
    );
    expect(referralStatusUpdate).toBeDefined();
    expect(referralStatusUpdate).toMatchObject({ status: "completed" });

    // tx.insert must NOT have been called at all (no new referral row).
    expect(insertValueCalls).toHaveLength(0);
  });

  it("sets the referralId used in the UPDATE to the provided existingReferralId (not a freshly generated one)", async () => {
    queueCommonSelects();
    const tx = makeTx();

    // We intercept the .where() call on the update chain to capture the id filter.
    const whereArgs: unknown[] = [];
    (tx as unknown as Record<string, unknown>).update = vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        updateSetCalls.push(payload);
        return {
          where: vi.fn((expr: unknown) => {
            whereArgs.push(expr);
            return Promise.resolve(undefined);
          }),
        };
      }),
    }));

    await recordReferralConversion(tx, {
      ...BASE_ARGS,
      existingReferralId: "existing-ref-row-1",
    });

    // The WHERE expression is built with eq(referralsTable.id, existingReferralId).
    // Our eq mock returns "id=existing-ref-row-1" (col=value string).
    const referralUpdateWhere = whereArgs.find(
      (w) => String(w).includes("existing-ref-row-1"),
    );
    expect(referralUpdateWhere).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// INSERT path — existingReferralId null (backward-compat)
// ---------------------------------------------------------------------------

describe("recordReferralConversion — INSERT path (existingReferralId null)", () => {
  it("calls tx.insert with status='completed' and does NOT call tx.update with status='completed' when existingReferralId is null", async () => {
    queueCommonSelects();
    const tx = makeTx();

    await recordReferralConversion(tx, {
      ...BASE_ARGS,
      existingReferralId: null,
    });

    // tx.insert must have been called with status='completed'.
    const referralInsert = insertValueCalls.find(
      (v) => v.status === "completed",
    );
    expect(referralInsert).toBeDefined();
    expect(referralInsert).toMatchObject({
      status: "completed",
      tenantId: "tenant-001",
      referrerId: "referrer-001",
      code: "VALID-REF",
    });

    // tx.update must NOT have been called with status='completed'
    // (the update is for clientsTable stats and referralTracking, neither of which has a status field).
    const referralStatusUpdate = updateSetCalls.find(
      (u) => u.status === "completed",
    );
    expect(referralStatusUpdate).toBeUndefined();
  });

  it("uses a freshly generated id for the new referral row when existingReferralId is null", async () => {
    queueCommonSelects();
    const tx = makeTx();

    await recordReferralConversion(tx, {
      ...BASE_ARGS,
      existingReferralId: null,
    });

    // generateId() is mocked to return "new-gen-id".
    const referralInsert = insertValueCalls.find(
      (v) => v.status === "completed",
    );
    expect(referralInsert).toMatchObject({ id: "new-gen-id" });
  });
});

// ---------------------------------------------------------------------------
// Shared invariants — both paths must mark conversion regardless of the branch
// ---------------------------------------------------------------------------

describe("recordReferralConversion — shared invariants", () => {
  it("uses direct attribution without a cookie instead of another visitor's tracking UTM", async () => {
    selectQueue.push(
      [REF_SETTINGS],
      [REFERRER],
      // This would be an unrelated visitor's tracking row if the implementation
      // still queried by referral code. It must never reach campaign policy.
      [{ utmSource: "whatsapp", utmMedium: "paid" }],
    );
    const tx = makeTx();

    await recordReferralConversion(tx, { ...BASE_ARGS, existingReferralId: "referral-direct" });

    expect(mockApplyActiveCampaignBonus).toHaveBeenCalledWith(
      tx,
      "tenant-001",
      10,
      expect.any(Date),
      expect.objectContaining({ attributionChannel: "direct", activitySegment: "occasional" }),
    );
    // settings + referrer + last referrer order; no selection by referralCode.
    expect((tx.select as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(3);
  });

  it("increments the referrer's successfulReferrals regardless of UPDATE or INSERT path", async () => {
    for (const existingReferralId of ["existing-ref-row-1", null]) {
      vi.clearAllMocks();
      selectQueue       = [];
      updateSetCalls    = [];
      insertValueCalls  = [];
      mockApplyActiveCampaignBonus.mockResolvedValue({ adjustedBase: 10, fixedExtra: 0 });
      mockComputeReferralTier.mockReturnValue({
        tier: { level: "bronze", label: "Bronze", bonusMultiplier: 1 },
      });
      mockDetectReferralFraud.mockReturnValue({ flagged: false });
      queueCommonSelects();
      const tx = makeTx();

      await recordReferralConversion(tx, { ...BASE_ARGS, existingReferralId });

      // tx.update must have been called with a payload that increments
      // successfulReferrals (via sql`COALESCE(...) + 1`). Our sql mock returns
      // "SQL_EXPR", so we look for the clientsTable update that also sets
      // totalReferrals (which would be "SQL_EXPR" from the mocked sql tag).
      const clientUpdate = updateSetCalls.find(
        (u) => "successfulReferrals" in u || "totalReferrals" in u,
      );
      expect(clientUpdate).toBeDefined();
    }
  });

  it("returns tierUpgraded=false when the tier level stays the same after conversion", async () => {
    queueCommonSelects();
    const tx = makeTx();
    // Both before and after: same tier level → no upgrade.
    mockComputeReferralTier.mockReturnValue({
      tier: { level: "bronze", label: "Bronze", bonusMultiplier: 1 },
    });

    const result = await recordReferralConversion(tx, {
      ...BASE_ARGS,
      existingReferralId: "any-id",
    });

    expect(result.tierUpgraded).toBe(false);
    expect(result.newTierLevel).toBe("bronze");
  });
});

describe("recordReferralConversion — contractual commission eligibility", () => {
  it("credits an opted-in ambassador while keeping the promotional bonus separate", async () => {
    queueCommonSelects();
    selectQueue[1] = [{ ...REFERRER, ambassadorOptIn: true }];
    mockApplyActiveCampaignBonus.mockResolvedValue({
      adjustedBase: 10,
      fixedExtra: 0,
      campaignId: "campaign-1",
      commissionType: "fixed",
      commissionValue: 7.5,
      commissionRecipientType: "ambassador",
    });

    await recordReferralConversion(makeTx(), { ...BASE_ARGS, existingReferralId: "referral-1" });

    expect(insertValueCalls).toContainEqual(expect.objectContaining({
      campaignId: "campaign-1",
      recipientType: "ambassador",
      recipientId: "referrer-001",
      referrerId: "referrer-001",
      amount: "7.50",
      status: "pending",
    }));
  });

  it("does not pay commission to a client who has not opted into ambassador terms", async () => {
    queueCommonSelects();
    mockApplyActiveCampaignBonus.mockResolvedValue({
      adjustedBase: 10,
      fixedExtra: 0,
      campaignId: "campaign-1",
      commissionType: "fixed",
      commissionValue: 7.5,
      commissionRecipientType: "ambassador",
    });

    await recordReferralConversion(makeTx(), { ...BASE_ARGS, existingReferralId: "referral-1" });

    expect(insertValueCalls).not.toContainEqual(expect.objectContaining({ recipientType: "ambassador" }));
  });

  it("credits only the active contract-eligible partner represented by the paid order", async () => {
    queueCommonSelects();
    selectQueue.push([{ id: "partner-1" }]);
    mockApplyActiveCampaignBonus.mockResolvedValue({
      adjustedBase: 10,
      fixedExtra: 0,
      campaignId: "campaign-1",
      commissionType: "bonus_percentage",
      commissionValue: 10,
      commissionRecipientType: "partner",
      eligiblePartnerIds: ["partner-1"],
    });

    await recordReferralConversion(makeTx(), {
      ...BASE_ARGS,
      existingReferralId: "referral-1",
      partnerIds: ["partner-1", "partner-not-contractually-eligible"],
    });

    expect(insertValueCalls).toContainEqual(expect.objectContaining({
      recipientType: "partner",
      recipientId: "partner-1",
      amount: "1.00",
      status: "pending",
    }));
  });
});

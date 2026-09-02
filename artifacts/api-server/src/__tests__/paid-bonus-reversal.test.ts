import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  executeQueue: [] as Array<{ rows: Array<Record<string, unknown>> }>,
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@workspace/db", () => {
  const tables = {
    referralsTable: {
      id: "referrals.id", tenantId: "referrals.tenant_id", status: "referrals.status",
      bonusPaid: "referrals.bonus_paid", reservationId: "referrals.reservation_id",
      referrerId: "referrals.referrer_id", referredId: "referrals.referred_id",
      bonusAmount: "referrals.bonus_amount", reversalReason: "referrals.reversal_reason",
      reversalAt: "referrals.reversal_at", updatedAt: "referrals.updated_at",
    },
    clientsTable: {
      id: "clients.id", tenantId: "clients.tenant_id",
      successfulReferrals: "clients.successful_referrals", referralEarnings: "clients.referral_earnings",
    },
    loyaltyMembersTable: {
      id: "loyalty_members.id", tenantId: "loyalty_members.tenant_id",
      clientId: "loyalty_members.client_id", totalPoints: "loyalty_members.total_points",
      availablePoints: "loyalty_members.available_points",
    },
    loyaltyTransactionsTable: {
      id: "loyalty_transactions.id", tenantId: "loyalty_transactions.tenant_id",
      memberId: "loyalty_transactions.member_id", type: "loyalty_transactions.type",
      points: "loyalty_transactions.points", referenceId: "loyalty_transactions.reference_id",
      referenceType: "loyalty_transactions.reference_type",
    },
    referralBonusReversalsTable: {
      id: "referral_bonus_reversals.id", tenantId: "referral_bonus_reversals.tenant_id",
      referralId: "referral_bonus_reversals.referral_id", amount: "referral_bonus_reversals.amount",
      reason: "referral_bonus_reversals.reason",
    },
  };

  const tx = {
    execute: vi.fn(() => Promise.resolve(state.executeQueue.shift() ?? { rows: [] })),
    select: vi.fn(() => {
      const rows = state.selectQueue.shift() ?? [];
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn(() => chain);
      chain.where = vi.fn(() => chain);
      chain.limit = vi.fn(() => Promise.resolve(rows));
      chain.then = (
        resolve: (value: Array<Record<string, unknown>>) => unknown,
        reject: (error: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject);
      return chain;
    }),
    update: vi.fn(() => {
      const query: Record<string, unknown> = {};
      query.set = vi.fn((payload: Record<string, unknown>) => {
        state.updates.push(payload);
        return query;
      });
      query.where = vi.fn(() => Promise.resolve(undefined));
      return query;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((payload: Record<string, unknown>) => {
        state.inserts.push(payload);
        return Promise.resolve(undefined);
      }),
    })),
  };

  return {
    ...tables,
    db: { transaction: vi.fn((callback: (executor: unknown) => unknown) => callback(tx)) },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((column: unknown, value: unknown) => ({ eq: [column, value] })),
  sql: vi.fn(() => "SQL_EXPR"),
}));

vi.mock("@workspace/permissions", () => ({
  PAYMENT_STATUS: { PAID: "paid" },
  PAYMENT_TYPE: { RECEIVABLE: "receivable" },
  REFERRAL_STATUS: { PENDING: "pending", COMPLETED: "completed", REVERSED: "reversed" },
  RESERVATION_STATUS: { CANCELLED: "cancelled", REFUNDED: "refunded", FAILED: "failed" },
}));

vi.mock("../lib/loyalty-helpers.js", () => ({ calculateTier: vi.fn(() => "silver") }));
vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "reversal-audit-id") }));

import { reversePaidReferralBonus } from "../services/reservation-referral-conversion.js";

const TENANT_ID = "tenant-001";
const REFERRAL_ID = "referral-001";

function queuePaidReferral() {
  state.executeQueue.push(
    { rows: [{
      id: REFERRAL_ID,
      reservation_id: "reservation-001",
      status: "completed",
      bonus_paid: true,
      referrer_id: "client-referrer",
      referred_id: "client-referred",
      bonus_amount: "50.00",
    }] },
    { rows: [{ id: "client-referrer" }] },
    { rows: [] },
    { rows: [{ id: "loyalty-member" }] },
  );
  state.selectQueue.push(
    [], // no prior audit record
    [{ id: "loyalty-member", totalPoints: 120, availablePoints: 90 }],
    [{ id: "loyalty-credit", points: 25 }],
    [], // no prior points reversal
  );
}

beforeEach(() => {
  state.executeQueue.length = 0;
  state.selectQueue.length = 0;
  state.updates.length = 0;
  state.inserts.length = 0;
});

describe("reversePaidReferralBonus", () => {
  it("compensates balance, commission, status and loyalty points while auditing the operator", async () => {
    queuePaidReferral();

    const result = await reversePaidReferralBonus(
      REFERRAL_ID,
      TENANT_ID,
      "Pagamento confirmado por engano",
      "operator-001",
    );

    expect(result).toMatchObject({
      reversalId: "reversal-audit-id",
      referralId: REFERRAL_ID,
      bonusAmount: "50.00",
      reason: "Pagamento confirmado por engano",
      alreadyReversed: false,
    });
    expect(state.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ successfulReferrals: "SQL_EXPR", referralEarnings: "SQL_EXPR" }),
      expect.objectContaining({ status: "reversed", reversalReason: "Pagamento confirmado por engano" }),
      expect.objectContaining({ totalPoints: 95, availablePoints: "SQL_EXPR", tier: "silver" }),
    ]));
    expect(state.inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `${REFERRAL_ID}:reversal`,
        points: -25,
        referenceType: "referral_reversal",
      }),
      expect.objectContaining({
        id: "reversal-audit-id",
        tenantId: TENANT_ID,
        referralId: REFERRAL_ID,
        amount: "50.00",
        initiatedById: "operator-001",
        reason: "Pagamento confirmado por engano",
      }),
    ]));
  });

  it("replays an existing reversal without changing balances or sending another financial entry", async () => {
    state.executeQueue.push({ rows: [{
      id: REFERRAL_ID,
      reservation_id: null,
      status: "reversed",
      bonus_paid: true,
      referrer_id: "client-referrer",
      referred_id: null,
      bonus_amount: "50.00",
    }] });
    state.selectQueue.push([{
      id: "reversal-audit-id",
      amount: "50.00",
      reason: "Pagamento confirmado por engano",
    }]);

    const result = await reversePaidReferralBonus(
      REFERRAL_ID,
      TENANT_ID,
      "motivo repetido",
      "operator-002",
    );

    expect(result).toMatchObject({
      reversalId: "reversal-audit-id",
      reason: "Pagamento confirmado por engano",
      alreadyReversed: true,
    });
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects a referral whose bonus was not paid", async () => {
    state.executeQueue.push({ rows: [{
      id: REFERRAL_ID,
      status: "completed",
      bonus_paid: false,
      referrer_id: "client-referrer",
      bonus_amount: "50.00",
    }] });
    state.selectQueue.push([]);

    await expect(reversePaidReferralBonus(
      REFERRAL_ID,
      TENANT_ID,
      "motivo",
      "operator-001",
    )).rejects.toMatchObject({ code: "REFERRAL_PAID_REVERSAL", statusCode: 422 });
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });
});
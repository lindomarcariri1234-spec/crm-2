import { beforeEach, describe, expect, it, vi } from "vitest";

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: { transaction },
  reservationsTable: { id: "reservation_id", tenantId: "tenant_id", clientId: "client_id" },
  paymentsTable: { id: "payment_id", tenantId: "tenant_id", reservationId: "reservation_id", type: "type", status: "status", amount: "amount" },
  referralsTable: {
    id: "referral_id",
    tenantId: "tenant_id",
    reservationId: "reservation_id",
    referrerId: "referrer_id",
    referredId: "referred_id",
    bonusAmount: "bonus_amount",
    status: "status",
    reversalReason: "reversal_reason",
    reversalAt: "reversal_at",
    updatedAt: "updated_at",
  },
  clientsTable: { id: "client_id", tenantId: "tenant_id", successfulReferrals: "successful_referrals", referralEarnings: "referral_earnings" },
  loyaltyMembersTable: { id: "member_id", tenantId: "tenant_id", clientId: "client_id", totalPoints: "total_points", availablePoints: "available_points", lastActivityAt: "last_activity_at" },
  loyaltyTransactionsTable: { id: "transaction_id", tenantId: "tenant_id", memberId: "member_id", type: "type", points: "points", referenceId: "reference_id", referenceType: "reference_type" },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((column: unknown, value: unknown) => ({ eq: [column, value] })),
  sql: vi.fn(() => "SQL_EXPR"),
}));

vi.mock("@workspace/permissions", () => ({
  PAYMENT_STATUS: { PAID: "paid" },
  PAYMENT_TYPE: { RECEIVABLE: "receivable" },
  REFERRAL_STATUS: { COMPLETED: "completed", REVERSED: "reversed" },
  RESERVATION_STATUS: { CANCELLED: "cancelled", REFUNDED: "refunded", FAILED: "failed" },
}));

import {
  reverseReservationReferralIfNoEligiblePayment,
} from "../services/reservation-referral-conversion.js";

let selectQueue: unknown[][] = [];
let updateSetCalls: Record<string, unknown>[] = [];
let insertValues: Record<string, unknown>[] = [];

function makeTx() {
  const tx = {
    select: vi.fn(() => {
      const rows = selectQueue.shift() ?? [];
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn(() => chain);
      chain.where = vi.fn(() => chain);
      chain.for = vi.fn(() => chain);
      chain.limit = vi.fn(async () => rows);
      return chain;
    }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateSetCalls.push(values);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertValues.push(values);
        return Promise.resolve([]);
      }),
    })),
  };
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  updateSetCalls = [];
  insertValues = [];
});


describe("reverseReservationReferralIfNoEligiblePayment", () => {
  it("does not reverse while another positive PAID receivable remains", async () => {
    const tx = makeTx();
    selectQueue.push(
      [{ id: "reservation-1", clientId: "client-1" }],
      [{ id: "payment-remaining" }],
    );
    transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(tx));

    const result = await reverseReservationReferralIfNoEligiblePayment(
      "reservation-1",
      "tenant-1",
      "payment_refunded",
    );

    expect(result).toBeNull();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("reverses bonus, counters, commission and referral points after the last payment", async () => {
    const tx = makeTx();
    selectQueue.push(
      [{ id: "reservation-1", clientId: "client-1" }],
      [],
      [{
        id: "referral-1",
        referrerId: "referrer-1",
        referredId: "client-1",
        bonusAmount: "25.00",
        status: "completed",
      }],
      [{ id: "member-1", totalPoints: 120, availablePoints: 90 }],
      [{ id: "referral-points-1", points: 30 }],
      [],
    );
    transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(tx));

    const result = await reverseReservationReferralIfNoEligiblePayment(
      "reservation-1",
      "tenant-1",
      "payment_deleted",
    );

    expect(result).toMatchObject({
      referralId: "referral-1",
      referrerId: "referrer-1",
      bonusAmount: "25.00",
      reason: "payment_deleted",
      loyaltyPointsReversed: 30,
    });
    expect(updateSetCalls).toHaveLength(3);
    expect(updateSetCalls[0]).toMatchObject({ successfulReferrals: "SQL_EXPR", referralEarnings: "SQL_EXPR" });
    expect(updateSetCalls[1]).toMatchObject({ status: "reversed", reversalReason: "payment_deleted" });
    expect(updateSetCalls[2]).toMatchObject({ totalPoints: 90, availablePoints: "SQL_EXPR", tier: "bronze" });
    expect(insertValues[0]).toMatchObject({
      id: "referral-1:reversal",
      points: -30,
      referenceId: "referral-1",
      referenceType: "referral_reversal",
    });
  });

  it("is financially idempotent while returning the reversed referral for notification retry", async () => {
    const tx = makeTx();
    selectQueue.push(
      [{ id: "reservation-1", clientId: "client-1" }],
      [],
      [{
        id: "referral-1",
        reservationId: "reservation-1",
        referrerId: "referrer-1",
        referredId: "client-1",
        bonusAmount: "25.00",
        status: "reversed",
        reversalReason: "payment_refunded",
      }],
    );
    transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(tx));

    const result = await reverseReservationReferralIfNoEligiblePayment(
      "reservation-1",
      "tenant-1",
      "payment_cancelled",
    );

    expect(result).toMatchObject({
      referralId: "referral-1",
      reservationId: "reservation-1",
      reason: "payment_refunded",
      loyaltyPointsReversed: 0,
    });
    expect(tx.update).not.toHaveBeenCalled();
  });
});
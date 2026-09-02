import { beforeEach, describe, expect, it, vi } from "vitest";

const { transaction, recordReferralConversion } = vi.hoisted(() => ({
  transaction: vi.fn(),
  recordReferralConversion: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: { transaction },
  reservationsTable: {}, referralsTable: {}, clientsTable: {},
}));
vi.mock("../services/checkout/referral-conversion.js", () => ({ recordReferralConversion }));

import { convertPaidReservationReferral } from "../services/reservation-referral-conversion.js";

function executor(results: unknown[][]) {
  return {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const method of ["from", "where", "for"]) chain[method] = vi.fn(() => chain);
      chain.limit = vi.fn(async () => results.shift() ?? []);
      return chain;
    }),
  };
}

describe("convertPaidReservationReferral", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation(async (callback) => callback(executor([])));
  });

  it.each([
    { status: "pending", balance: "0.00", paidValue: "0.00" },
    { status: "confirmed", balance: "1.00", paidValue: "0.00" },
  ])("does not convert a reservation without a positive payment %#", async reservation => {
    transaction.mockImplementation(async callback => callback(executor([[{ ...reservation, id: "r1", clientId: "c1" }]])));
    await convertPaidReservationReferral("r1", "tenant-a");
    expect(recordReferralConversion).not.toHaveBeenCalled();
  });

  it("converts a confirmed zero-balance pending referral once and replay finds none", async () => {
    const reservation = { id: "r1", clientId: "c1", status: "confirmed", balance: "0.00", paidValue: "100.00" };
    const referral = { id: "ref1", referrerId: "amb1", code: "CODE", discountAmount: "10", discountValue: "10", discountType: "percentage" };
    transaction
      .mockImplementationOnce(async callback => callback(executor([[reservation], [referral], [{ name: "Client", email: "c@example.com" }]])))
      .mockImplementationOnce(async callback => callback(executor([[reservation], []])));
    await convertPaidReservationReferral("r1", "tenant-a");
    await convertPaidReservationReferral("r1", "tenant-a");
    expect(recordReferralConversion).toHaveBeenCalledTimes(1);
    expect(recordReferralConversion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: "tenant-a", reservationId: "r1", existingReferralId: "ref1",
    }));
  });

  it("converts a partially paid reservation and does not wait for zero balance", async () => {
    const reservation = { id: "r1", clientId: "c1", status: "pending", balance: "90.00", paidValue: "10.00" };
    const referral = { id: "ref1", referrerId: "amb1", code: "CODE", discountAmount: "10", discountValue: "10", discountType: "percentage" };
    transaction.mockImplementationOnce(async callback => callback(executor([
      [reservation],
      [referral],
      [{ name: "Client", email: "c@example.com" }],
    ])));

    await convertPaidReservationReferral("r1", "tenant-a");

    expect(recordReferralConversion).toHaveBeenCalledTimes(1);
    expect(recordReferralConversion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: "tenant-a", reservationId: "r1", existingReferralId: "ref1",
    }));
  });
});
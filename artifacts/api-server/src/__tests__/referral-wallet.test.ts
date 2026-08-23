import { describe, expect, it } from "vitest";
import { REFERRAL_STATUS } from "@workspace/permissions";
import { calculateReferralWallet } from "../lib/referral-wallet.js";

describe("calculateReferralWallet", () => {
  const now = new Date("2026-08-23T15:00:00.000Z");

  it("separates usable, pending, used, and expiring promotional credit", () => {
    const wallet = calculateReferralWallet(
      [
        {
          status: REFERRAL_STATUS.COMPLETED,
          bonusAmount: "50.00",
          bonusPaid: false,
          bonusCreditUsedAmount: "10.00",
          convertedAt: new Date("2026-08-01T15:00:00.000Z"),
          expiresAt: new Date("2026-08-26T15:00:00.000Z"),
        },
        {
          status: REFERRAL_STATUS.CONVERTED,
          bonusAmount: "20.00",
          bonusPaid: false,
          bonusCreditUsedAmount: null,
          convertedAt: new Date("2026-08-20T15:00:00.000Z"),
          expiresAt: new Date("2026-09-30T15:00:00.000Z"),
        },
      ],
      7,
      now,
    );

    expect(wallet).toMatchObject({
      availableCredit: 40,
      pendingCredit: 20,
      usedCredit: 10,
      expiringCredit: 40,
    });
    expect(wallet.expiringOn?.toISOString()).toBe("2026-08-26T15:00:00.000Z");
  });

  it("does not surface paid, expired, or reversed rewards as active credit", () => {
    const wallet = calculateReferralWallet(
      [
        {
          status: REFERRAL_STATUS.COMPLETED,
          bonusAmount: "20.00",
          bonusPaid: true,
          bonusCreditUsedAmount: null,
          convertedAt: new Date("2026-08-01T15:00:00.000Z"),
          expiresAt: new Date("2026-09-01T15:00:00.000Z"),
        },
        {
          status: REFERRAL_STATUS.COMPLETED,
          bonusAmount: "20.00",
          bonusPaid: false,
          bonusCreditUsedAmount: null,
          convertedAt: new Date("2026-08-01T15:00:00.000Z"),
          expiresAt: new Date("2026-08-22T15:00:00.000Z"),
        },
        {
          status: REFERRAL_STATUS.REVERSED,
          bonusAmount: "20.00",
          bonusPaid: false,
          bonusCreditUsedAmount: "20.00",
          convertedAt: new Date("2026-08-01T15:00:00.000Z"),
          expiresAt: new Date("2026-09-01T15:00:00.000Z"),
        },
      ],
      0,
      now,
    );

    expect(wallet).toEqual({
      availableCredit: 0,
      pendingCredit: 0,
      usedCredit: 0,
      expiringCredit: 0,
      expiringOn: null,
    });
  });
});
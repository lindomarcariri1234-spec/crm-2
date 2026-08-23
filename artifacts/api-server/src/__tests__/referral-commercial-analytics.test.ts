import { describe, expect, it } from "vitest";
import { REFERRAL_STATUS } from "@workspace/permissions";
import { calculateReferralCommercialAnalytics } from "../lib/referral-commercial-analytics.js";

describe("calculateReferralCommercialAnalytics", () => {
  const since = new Date("2026-08-01T00:00:00.000Z");

  it("uses only valid conversions for the selected tenant and period", () => {
    const { summary, ranking } = calculateReferralCommercialAnalytics(
      [
        {
          tenantId: "tenant-a",
          referrerId: "referrer-1",
          referrerName: "Ana",
          status: REFERRAL_STATUS.COMPLETED,
          convertedAt: new Date("2026-08-12T12:00:00.000Z"),
          bonusAmount: "10.00",
          bonusPaid: true,
          bonusPaidAt: new Date("2026-08-13T12:00:00.000Z"),
          bonusCreditUsedAmount: null,
          discountAmount: "5.00",
          reservationStatus: "confirmed",
          reservationPaidValue: "100.00",
          commissionAmount: "12.50",
          commissionStatus: "approved",
        },
        {
          tenantId: "tenant-a",
          referrerId: "referrer-2",
          referrerName: "Bruno",
          status: REFERRAL_STATUS.COMPLETED,
          convertedAt: new Date("2026-08-13T12:00:00.000Z"),
          bonusAmount: "20.00",
          bonusPaid: false,
          bonusPaidAt: null,
          bonusCreditUsedAmount: "5.00",
          discountAmount: "10.00",
          reservationStatus: "cancelled",
          reservationPaidValue: "300.00",
          commissionAmount: "99.00",
          commissionStatus: "approved",
        },
        {
          tenantId: "tenant-a",
          referrerId: "referrer-3",
          referrerName: "Carla",
          status: REFERRAL_STATUS.REVERSED,
          convertedAt: new Date("2026-08-14T12:00:00.000Z"),
          bonusAmount: "40.00",
          bonusPaid: true,
          bonusPaidAt: new Date("2026-08-15T12:00:00.000Z"),
          bonusCreditUsedAmount: null,
          discountAmount: "20.00",
          reservationStatus: "confirmed",
          reservationPaidValue: "500.00",
          commissionAmount: "99.00",
          commissionStatus: "reversed",
        },
        {
          tenantId: "tenant-b",
          referrerId: "referrer-4",
          referrerName: "Outra agência",
          status: REFERRAL_STATUS.COMPLETED,
          convertedAt: new Date("2026-08-14T12:00:00.000Z"),
          bonusAmount: "50.00",
          bonusPaid: true,
          bonusPaidAt: new Date("2026-08-15T12:00:00.000Z"),
          bonusCreditUsedAmount: null,
          discountAmount: "25.00",
          reservationStatus: "confirmed",
          reservationPaidValue: "900.00",
          commissionAmount: "99.00",
          commissionStatus: "paid",
        },
        {
          tenantId: "tenant-a",
          referrerId: "referrer-5",
          referrerName: "Conversão antiga",
          status: REFERRAL_STATUS.COMPLETED,
          convertedAt: new Date("2026-07-31T23:59:00.000Z"),
          bonusAmount: "30.00",
          bonusPaid: true,
          bonusPaidAt: new Date("2026-08-01T12:00:00.000Z"),
          bonusCreditUsedAmount: null,
          discountAmount: "15.00",
          reservationStatus: "confirmed",
          reservationPaidValue: "250.00",
          commissionAmount: "99.00",
          commissionStatus: "paid",
        },
      ],
      "tenant-a",
      since,
    );

    expect(summary).toEqual({
      validReferrals: 1,
      attributedRevenue: 100,
      rewardsPaid: 10,
      rewardsPending: 0,
      discountGiven: 5,
      commissions: 12.5,
      acquisitionCost: 15,
      cac: 15,
      roiPercent: 566.67,
      roiMultiple: 6.67,
    });
    expect(ranking).toEqual([
      {
        referrerId: "referrer-1",
        referrerName: "Ana",
        conversions: 1,
        attributedRevenue: 100,
        rewardsPaid: 10,
        commissionAmount: 12.5,
      },
    ]);
  });

  it("keeps empty periods safe from divide-by-zero values", () => {
    const { summary, ranking } = calculateReferralCommercialAnalytics([], "tenant-a", since);

    expect(summary).toEqual({
      validReferrals: 0,
      attributedRevenue: 0,
      rewardsPaid: 0,
      rewardsPending: 0,
      discountGiven: 0,
      commissions: 0,
      acquisitionCost: 0,
      cac: 0,
      roiPercent: 0,
      roiMultiple: 0,
    });
    expect(ranking).toEqual([]);
  });

  it("reports only unreversed ledger commissions without adding them to promotional acquisition cost", () => {
    const { summary, ranking } = calculateReferralCommercialAnalytics(
      [
        {
          tenantId: "tenant-a",
          referrerId: "referrer-1",
          referrerName: "Ana",
          status: REFERRAL_STATUS.COMPLETED,
          convertedAt: new Date("2026-08-12T12:00:00.000Z"),
          bonusAmount: "10.00",
          bonusPaid: true,
          bonusPaidAt: null,
          bonusCreditUsedAmount: null,
          discountAmount: "5.00",
          reservationStatus: "confirmed",
          reservationPaidValue: "100.00",
          commissionAmount: "30.00",
          commissionStatus: "paid",
        },
        {
          tenantId: "tenant-a",
          referrerId: "referrer-1",
          referrerName: "Ana",
          status: REFERRAL_STATUS.COMPLETED,
          convertedAt: new Date("2026-08-13T12:00:00.000Z"),
          bonusAmount: "0.00",
          bonusPaid: false,
          bonusPaidAt: null,
          bonusCreditUsedAmount: null,
          discountAmount: "0.00",
          reservationStatus: "confirmed",
          reservationPaidValue: "200.00",
          commissionAmount: "99.00",
          commissionStatus: "reversed",
        },
      ],
      "tenant-a",
      since,
    );

    expect(summary.commissions).toBe(30);
    expect(summary.acquisitionCost).toBe(15);
    expect(ranking).toEqual([expect.objectContaining({
      referrerId: "referrer-1",
      conversions: 2,
      commissionAmount: 30,
    })]);
  });
});
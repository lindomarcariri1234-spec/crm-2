import { describe, expect, it } from "vitest";
import { financialMetricCards, hasFinancialMetricData } from "../components/financial-metrics-overview";
import type { FinancialMetricTotals } from "../lib/financial-metrics-api";

const emptyTotals: FinancialMetricTotals = {
  grossBookedRevenue: 0, bookedRevenue: 0, receivedRevenue: 0, receivable: 0,
  overdueReceivable: 0, payable: 0, overduePayable: 0,
  discounts: 0, clientReferralBonuses: 0, clientReferralCredits: 0,
  sellerCommissions: 0, sellerCommissionsPaid: 0,
  referralCommissions: 0, referralCommissionsPaid: 0,
  expenses: 0, expensesPaid: 0, tripCosts: 0, tripCostsPaid: 0,
  userReferralBalance: 0, userDebt: 0, operatingCostsPaid: 0,
  profit: 0, margin: 0,
};

describe("FinancialMetricsOverview", () => {
  it("covers every consolidated financial area with a destination", () => {
    expect(financialMetricCards.map((card) => card.key)).toEqual([
      "received", "booked", "receivable", "overdue", "user-debt", "costs",
      "commissions", "bonuses", "profit", "margin",
    ]);
    expect(financialMetricCards.every((card) => card.href.startsWith("/"))).toBe(true);
  });

  it("only treats a non-zero canonical total as financial activity", () => {
    expect(hasFinancialMetricData(emptyTotals)).toBe(false);
    expect(hasFinancialMetricData({ ...emptyTotals, receivedRevenue: 12.5 })).toBe(true);
  });
});
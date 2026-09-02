import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildFinancialMetricFilters, calculateFinancialMetrics, saoPauloMonthPeriod, type FinancialMetricSources } from "../services/financial-metrics";

const period = saoPauloMonthPeriod("2025-02");
const date = (s: string) => new Date(s);
const sources = (overrides: Partial<FinancialMetricSources> = {}): FinancialMetricSources => ({
  reservations: [], payments: [], expenses: [], tripCosts: [], commissions: [],
  referralCommissions: [], referrals: [], ledgerEntries: [], users: [], ...overrides,
});

describe("canonical financial metrics", () => {
  it("uses BRT month boundaries, payment cash, and open payment receivables", () => {
    const result = calculateFinancialMetrics(sources({
      reservations: [{ id: "r", tripId: "t", status: "confirmed", totalValue: "100.00", discountTotal: "10.00", createdAt: date("2025-02-01T03:00:00Z") }],
      payments: [
        { id: "before", type: "receivable", status: "paid", amount: "10", paidAt: date("2025-02-01T02:59:59Z") },
        { id: "partial", reservationId: "r", type: "receivable", status: "paid", amount: "33.335", paidAt: date("2025-02-28T23:00:00Z") },
        { id: "open", type: "receivable", status: "pending", amount: "66.67", dueDate: date("2025-02-15T12:00:00Z") },
      ],
    }), period);
    expect(result.totals).toMatchObject({ grossBookedRevenue: 110, bookedRevenue: 100, discounts: 10, receivedRevenue: 33.34, receivable: 66.67 });
    expect(result.byTrip).toEqual([expect.objectContaining({ tripId: "t", receivedRevenue: 33.34 })]);
  });

  it("excludes cancelled/refunded rows and avoids reservation/order payment double count", () => {
    const result = calculateFinancialMetrics(sources({
      reservations: [
        { id: "a", tripId: "trip-a", status: "confirmed", totalValue: "50", createdAt: date("2025-02-05T12:00:00Z") },
        { id: "cancelled", tripId: "trip-b", status: "cancelled", totalValue: "99", createdAt: date("2025-02-05T12:00:00Z") },
      ],
      // One order payment may represent a multi-trip checkout; it is counted once
      // globally and remains unallocated without an explicit reservation allocation.
      payments: [
        { id: "order-payment", orderId: "order-1", type: "receivable", status: "paid", amount: "50", paidAt: date("2025-02-06T12:00:00Z") },
        { id: "refund", reservationId: "a", type: "receivable", status: "refunded", amount: "50", paidAt: date("2025-02-06T12:00:00Z") },
      ],
    }), period);
    expect(result.totals).toMatchObject({ grossBookedRevenue: 50, receivedRevenue: 50 });
    expect(result.diagnostics.unallocatedPaymentIds).toEqual(["order-payment"]);
    expect(result.diagnostics.excluded).toMatchObject({ reservations: 1, payments: 1 });
  });

  it("keeps cost sources and commission/referral sources separate", () => {
    const result = calculateFinancialMetrics(sources({
      expenses: [{ id: "expense", tripId: "t", status: "paid", amount: "10.005", dueDate: date("2025-02-02T12:00:00Z"), paymentDate: date("2025-02-02T12:00:00Z") }],
      tripCosts: [{ id: "cost", tripId: "t", status: "paid", amount: "10.005", dueDate: date("2025-02-02T12:00:00Z"), paidAt: date("2025-02-02T12:00:00Z") }],
      commissions: [{ id: "seller", userId: "u", status: "paid", commissionAmount: "3.33", paidAt: date("2025-02-02T12:00:00Z"), createdAt: date("2025-02-02T12:00:00Z") }],
      referralCommissions: [{ id: "ref-commission", status: "paid", amount: "2.22", paidAt: date("2025-02-02T12:00:00Z"), createdAt: date("2025-02-02T12:00:00Z") }],
      referrals: [{ id: "referral", status: "converted", bonusAmount: "1.11", bonusPaidAt: date("2025-02-02T12:00:00Z"), bonusCreditUsedAmount: "4.44", bonusCreditUsedAt: date("2025-02-03T12:00:00Z") }],
      users: [{ id: "u", referralBalance: "5.00" }],
    }), period);
    expect(result.totals).toMatchObject({
      expenses: 10.01, expensesPaid: 10.01, tripCosts: 10.01, tripCostsPaid: 10.01,
      sellerCommissions: 3.33, sellerCommissionsPaid: 3.33,
      referralCommissions: 2.22, referralCommissionsPaid: 2.22,
      clientReferralBonuses: 1.11, clientReferralCredits: 4.44,
      userReferralBalance: 5, userDebt: 5, operatingCostsPaid: 20.02, profit: -26.68,
    });
    expect(result.byUser).toEqual([expect.objectContaining({ userId: "u", sellerCommissions: 3.33 })]);
  });

  it("keeps historical debt and overdue balances as aggregate snapshots", () => {
    const result = calculateFinancialMetrics(sources({
      payments: [
        { id: "period-open", type: "receivable", status: "pending", amount: "25", dueDate: date("2025-02-20T12:00:00Z") },
      ],
      commissions: [
        { id: "period-commission", userId: "u", status: "approved", commissionAmount: "3", createdAt: date("2025-02-10T12:00:00Z") },
      ],
    }), { ...period, asOf: date("2025-03-01T03:00:00Z") }, {
      overdueReceivable: "125.50",
      overduePayable: "40.25",
      userReferralBalance: "10.00",
      unpaidSellerCommissions: "30.00",
      unpaidReferralCommissions: "20.00",
    });

    expect(result.totals).toMatchObject({
      receivable: 25,
      overdueReceivable: 125.5,
      overduePayable: 40.25,
      userReferralBalance: 10,
      userDebt: 60,
      sellerCommissions: 3,
    });
  });

  it("scales duplicate diagnostics with a large irrelevant history", () => {
    const historicalExpenses = Array.from({ length: 5_000 }, (_, index) => ({
      id: `other-tenant-expense-${index}`,
      tripId: `other-tenant-trip-${index}`,
      status: "paid",
      amount: "999.99",
      dueDate: date("2023-01-01T12:00:00Z"),
      paymentDate: date("2023-01-01T12:00:00Z"),
    }));
    const historicalCosts = historicalExpenses.map((expense, index) => ({
      id: `other-tenant-cost-${index}`,
      tripId: `other-tenant-cost-trip-${index}`,
      status: "paid",
      amount: expense.amount,
      dueDate: expense.dueDate,
      paidAt: expense.paymentDate,
    }));
    const result = calculateFinancialMetrics(sources({
      expenses: [
        ...historicalExpenses,
        { id: "in-period-expense", tripId: "trip", status: "paid", amount: "10", dueDate: date("2025-02-02T12:00:00Z"), paymentDate: date("2025-02-02T12:00:00Z") },
      ],
      tripCosts: [
        ...historicalCosts,
        { id: "in-period-cost", tripId: "trip", status: "paid", amount: "10", dueDate: date("2025-02-02T12:00:00Z"), paidAt: date("2025-02-02T12:00:00Z") },
      ],
    }), period);

    expect(result.totals).toMatchObject({ expenses: 10, tripCosts: 10, expensesPaid: 10, tripCostsPaid: 10 });
    expect(result.diagnostics.potentialCrossSourceDuplicates).toEqual([
      { expenseId: "in-period-expense", tripCostId: "in-period-cost" },
    ]);
  });

  it("scopes every PostgreSQL source filter to the requested tenant", () => {
    const tenantId = "tenant-under-test";
    const dialect = new PgDialect();
    const asOf = date("2025-03-01T03:00:00Z");
    const filters = buildFinancialMetricFilters(tenantId, period, asOf);

    for (const filter of Object.values(filters)) {
      const query = dialect.sqlToQuery(filter!);
      expect(query.params, query.sql).toContain(tenantId);
      expect(query.params, query.sql).not.toContain("another-tenant");
    }
    expect(dialect.sqlToQuery(filters.payments!).params).not.toContain(asOf);
    expect(dialect.sqlToQuery(filters.overduePayments!).params).toContain(asOf.toISOString());
  });
});

import { describe, expect, it } from "vitest";
import { calculateTripCostSummary } from "./trip-cost-summary.js";

describe("calculateTripCostSummary", () => {
  it("uses each confirmed reservation's net value and actual passenger capacity", () => {
    const summary = calculateTripCostSummary({
      confirmedReservations: [
        { capacityUnits: 2, seats: [], totalValue: "180.00" },
        { capacityUnits: 0, seats: ["1", "2", "3"], totalValue: "50.01" },
      ],
      costs: [
        { amount: "100.10", status: "paid" },
        { amount: "20.45", status: "overdue" },
        { amount: "10.10", status: "pending" },
      ],
      fixedCostAmounts: ["50.00"],
      variableCostPerPassengerAmounts: ["5.00"],
    });

    expect(summary).toEqual({
      expectedRevenue: 230.01,
      totalRealCosts: 130.65,
      totalPaidCosts: 100.1,
      totalPendingCosts: 30.55,
      profit: 99.36,
      margin: 43.2,
      plannedBudget: 75,
      budgetVariance: 55.65,
      confirmedSeats: 5,
    });
  });

  it("does not invent passengers or revenue for an empty trip", () => {
    const summary = calculateTripCostSummary({
      confirmedReservations: [],
      costs: [],
      fixedCostAmounts: ["1000.00"],
      variableCostPerPassengerAmounts: ["10.00"],
    });

    expect(summary).toMatchObject({
      expectedRevenue: 0,
      profit: 0,
      margin: 0,
      plannedBudget: 1000,
      budgetVariance: -1000,
      confirmedSeats: 0,
    });
  });
});
import { describe, expect, it } from "vitest";
import { areExpenseAndTripCostLinkable } from "../services/expense-trip-cost-link";

const expense = {
  tripId: "trip-1",
  amount: "125.00",
  status: "pending",
};

describe("areExpenseAndTripCostLinkable", () => {
  it("allows an explicit link when trip, cents, and status match", () => {
    expect(areExpenseAndTripCostLinkable(expense, {
      tripId: "trip-1",
      amount: 125,
      status: "pending",
    })).toBe(true);
  });

  it("compares currency values in cents", () => {
    expect(areExpenseAndTripCostLinkable({ ...expense, amount: "125.004" }, {
      tripId: "trip-1",
      amount: "125.00",
      status: "pending",
    })).toBe(true);
  });

  it.each([
    [{ ...expense, tripId: null }, { tripId: "trip-1", amount: 125, status: "pending" }],
    [{ ...expense, tripId: "trip-2" }, { tripId: "trip-1", amount: 125, status: "pending" }],
    [expense, { tripId: "trip-1", amount: 125.01, status: "pending" }],
    [expense, { tripId: "trip-1", amount: 125, status: "paid" }],
    [{ ...expense, amount: "not-a-number" }, { tripId: "trip-1", amount: 125, status: "pending" }],
  ])("rejects mismatched records", (left, right) => {
    expect(areExpenseAndTripCostLinkable(left, right)).toBe(false);
  });
});
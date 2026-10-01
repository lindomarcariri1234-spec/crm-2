import { describe, expect, it } from "vitest";
import {
  calculateRuleCommission,
  calculateSellerCommission,
  canTransitionCommissionStatus,
  getCommissionTravelScope,
  selectApplicableCommissionRule,
} from "../lib/commission-calculation.js";

describe("commission calculation helpers", () => {
  it.each([
    ["Brasil", "national"],
    ["Brazil", "national"],
    ["BR", "national"],
    ["Argentina", "international"],
    ["", null],
    [null, null],
    ["Desconhecido", null],
    ["Unknown", null],
    ["N/A", null],
  ] as const)("classifies destination country %s", (country, expected) => {
    expect(getCommissionTravelScope(country)).toBe(expected);
  });

  it("prefers a trip-specific rule, then travel scope, then all trips", () => {
    const rules = [
      { appliesTo: "all", tripId: null, type: "percentage", value: "2" },
      { appliesTo: "national", tripId: null, type: "percentage", value: "8" },
      { appliesTo: "trip", tripId: "trip-1", type: "fixed", value: "125" },
    ];

    expect(selectApplicableCommissionRule(rules, "trip-1", "national")).toBe(rules[2]);
    expect(selectApplicableCommissionRule(rules, "trip-2", "national")).toBe(rules[1]);
    expect(selectApplicableCommissionRule(rules, "trip-2", "international")).toBe(rules[0]);
    expect(selectApplicableCommissionRule(rules, null, null)).toBe(rules[0]);
  });

  it("uses the same percentage plus fixed calculation for hybrid seller commissions", () => {
    const seller = {
      commissionType: "hybrid",
      commissionRate: "5",
      commissionFixed: "30",
    };

    expect(calculateSellerCommission(1_000, seller)).toEqual({
      commissionAmount: 80,
      commissionRate: 5,
      commissionType: "hybrid",
    });
  });

  it("does not report a fixed amount as a percentage rate", () => {
    expect(calculateRuleCommission(1_000, { type: "fixed", value: "125.50" })).toEqual({
      commissionAmount: 125.5,
      commissionRate: null,
      commissionType: "fixed",
    });
  });

  it("allows only the pending-to-approved and approved-to-paid transitions", () => {
    expect(canTransitionCommissionStatus("pending", "approved")).toBe(true);
    expect(canTransitionCommissionStatus("approved", "paid")).toBe(true);
    expect(canTransitionCommissionStatus("pending", "paid")).toBe(false);
    expect(canTransitionCommissionStatus("paid", "approved")).toBe(false);
    expect(canTransitionCommissionStatus("cancelled", "pending")).toBe(false);
  });
});
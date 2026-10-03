import { describe, expect, it } from "vitest";
import { assertPayableMatchesOperationalCost, operationalCostAmountsMatch, toOperationalCostStatus, toPayableStatus } from "./operational-cost-payables.js";

describe("operational cost payable synchronization", () => {
  it.each(["pending", "overdue", "paid"])("keeps %s status aligned across both ledgers", (status) => {
    expect(toPayableStatus(status)).toBe(status);
    expect(toOperationalCostStatus(status)).toBe(status);
    expect(() => assertPayableMatchesOperationalCost({
      costAmount: "125.00",
      costStatus: status,
      payable: { type: "payable", amount: 125, status },
    })).not.toThrow();
  });

  it("compares amounts at cent precision", () => {
    expect(operationalCostAmountsMatch("125.00", 125)).toBe(true);
    expect(operationalCostAmountsMatch("125.00", "125.01")).toBe(false);
  });

  it.each([
    { type: "receivable", amount: 125, status: "pending" },
    { type: "payable", amount: 125.01, status: "pending" },
    { type: "payable", amount: 125, status: "overdue" },
  ])("rejects unsafe explicit links: %o", (payable) => {
    expect(() => assertPayableMatchesOperationalCost({
      costAmount: 125,
      costStatus: "pending",
      payable,
    })).toThrow();
  });

  it.each(["cancelled", "approved", "refunded", "failed", "charged_back"])(
    "rejects unsupported linked state %s",
    (status) => {
      expect(() => toPayableStatus(status)).toThrow();
      expect(() => toOperationalCostStatus(status)).toThrow();
    },
  );
});
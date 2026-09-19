import { describe, expect, it } from "vitest";
import { buildFinancialCategoryRows } from "@/components/financial-consolidation-view";

describe("financial consolidation", () => {
  it("merges agency and trip categories without counting cancelled rows", () => {
    const rows = buildFinancialCategoryRows(
      [
        { id: "trip-1", category: "Transporte", amount: 100, status: "paid" },
        { id: "agency-1", category: "transport", amount: 50, status: "pending" },
        { id: "cancelled-1", category: "transport", amount: 900, status: "cancelled" },
      ],
      [{ id: "planned-1", category: "Transporte", amount: 120, kind: "fixed" }],
    );

    expect(rows).toEqual([
      {
        category: "Transporte",
        planned: 120,
        actual: 150,
        paid: 100,
        open: 50,
      },
    ]);
  });

  it("uses server category totals for a paginated global expense list", () => {
    const rows = buildFinancialCategoryRows(
      [{ id: "page-1", category: "food", amount: 25, status: "paid" }],
      [],
      [
        { category: "food", total: 250 },
        { category: "transport", total: 100 },
      ],
    );

    expect(rows).toEqual([
      { category: "Alimentação", planned: 0, actual: 250, paid: 0, open: 0 },
      { category: "Transporte", planned: 0, actual: 100, paid: 0, open: 0 },
    ]);
  });
});
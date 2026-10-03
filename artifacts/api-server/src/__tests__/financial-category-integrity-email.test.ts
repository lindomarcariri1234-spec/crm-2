import { describe, expect, it } from "vitest";
import { renderFinancialCategoryIntegrityAlertEmail } from "@workspace/email";

describe("financial category integrity alert email", () => {
  it("contains only the migration status and requested aggregate totals", () => {
    const rendered = renderFinancialCategoryIntegrityAlertEmail({
      to: "ops@example.com",
      migrationStatus: "missing",
      totals: {
        expenses: 1,
        trip_costs: 2,
        fixed_costs: 3,
        variable_costs: 4,
      },
    });

    expect(rendered.html).toContain("Migração 0101: ausente");
    expect(rendered.html).toContain("expenses: 1");
    expect(rendered.html).toContain("trip_costs: 2");
    expect(rendered.html).toContain("fixed_costs: 3");
    expect(rendered.html).toContain("variable_costs: 4");
    expect(rendered.html).not.toMatch(/description|tenant|client|reserva|email/i);
    expect(rendered.subject).not.toContain("ops@example.com");
  });

  it("rejects invalid totals instead of inserting arbitrary content", () => {
    expect(() =>
      renderFinancialCategoryIntegrityAlertEmail({
        to: "ops@example.com",
        migrationStatus: "applied",
        totals: {
          expenses: Number.NaN,
          trip_costs: 0,
          fixed_costs: 0,
          variable_costs: 0,
        },
      }),
    ).toThrow(/Invalid financial category integrity count/);
  });
});
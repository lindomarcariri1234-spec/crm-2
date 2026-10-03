export type FinancialCategoryIntegrityTotals = {
  expenses: number;
  trip_costs: number;
  fixed_costs: number;
  variable_costs: number;
};

export type FinancialCategoryIntegrityResult = {
  migrationStatus: "applied" | "missing";
  totals: FinancialCategoryIntegrityTotals;
  needsAlert: boolean;
};

export type FinancialCategoryIntegrityQuery = (
  statement: string,
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export declare const FINANCIAL_CATEGORY_MIGRATION_WHEN: number;

export declare function verifyFinancialCategoryIntegrity(
  query: FinancialCategoryIntegrityQuery,
): Promise<FinancialCategoryIntegrityResult>;
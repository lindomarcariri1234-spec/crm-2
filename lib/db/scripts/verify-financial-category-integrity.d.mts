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

export type FinancialCategoryIntegrityReadOnlyClient = {
  query(
    statement: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type FinancialCategoryIntegrityVerifier = (
  query: FinancialCategoryIntegrityQuery,
) => Promise<FinancialCategoryIntegrityResult>;

export declare const FINANCIAL_CATEGORY_MIGRATION_WHEN: number;
export declare const DEFAULT_FINANCIAL_CATEGORY_INTEGRITY_TIMEOUT_MS: number;

export declare function verifyFinancialCategoryIntegrity(
  query: FinancialCategoryIntegrityQuery,
): Promise<FinancialCategoryIntegrityResult>;

export declare function verifyFinancialCategoryIntegrityInReadOnlyTransaction(
  client: FinancialCategoryIntegrityReadOnlyClient,
  verifier?: FinancialCategoryIntegrityVerifier,
  options?: { timeoutMs?: number },
): Promise<FinancialCategoryIntegrityResult>;
import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface FinancialMetricTotals {
  grossBookedRevenue: number;
  bookedRevenue: number;
  receivedRevenue: number;
  receivable: number;
  overdueReceivable: number;
  payable: number;
  overduePayable: number;
  discounts: number;
  clientReferralBonuses: number;
  clientReferralCredits: number;
  sellerCommissions: number;
  sellerCommissionsPaid: number;
  referralCommissions: number;
  referralCommissionsPaid: number;
  expenses: number;
  expensesPaid: number;
  tripCosts: number;
  tripCostsPaid: number;
  userReferralBalance: number;
  userDebt: number;
  operatingCostsPaid: number;
  profit: number;
  margin: number;
}

export interface FinancialMetricsResponse {
  period: { start: string; end: string; label: string; asOf: string };
  timezone: string;
  contracts: Record<string, string>;
  totals: FinancialMetricTotals;
  byTrip: Array<{ tripId: string } & FinancialMetricTotals>;
  byUser: Array<{ userId: string } & FinancialMetricTotals>;
  diagnostics: {
    sourceRows: Record<string, number>;
    excluded: Record<string, number>;
    duplicateIdsIgnored: number;
    unallocatedPaymentIds: string[];
    ledgerEntriesNotIncludedInTotals: number;
    potentialCrossSourceDuplicates: Array<{ expenseId: string; tripCostId: string }>;
  };
}

export const getFinancialMetricsQueryKey = (month?: string) =>
  ["/api/admin/financial-metrics", month ?? "current"] as const;

export async function getFinancialMetrics(month?: string): Promise<FinancialMetricsResponse> {
  const params = month ? `?month=${encodeURIComponent(month)}` : "";
  const response = await fetch(`${BASE}/api/admin/financial-metrics${params}`, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message ?? body?.error ?? "Não foi possível carregar os indicadores financeiros.");
  }
  return response.json() as Promise<FinancialMetricsResponse>;
}

export function useFinancialMetrics(month?: string) {
  return useQuery({
    queryKey: getFinancialMetricsQueryKey(month),
    queryFn: () => getFinancialMetrics(month),
  });
}
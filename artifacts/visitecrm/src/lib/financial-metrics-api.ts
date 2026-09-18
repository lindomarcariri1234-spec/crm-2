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
  pmsPaymentAdjustments: Array<{
    id: string;
    reservationId: string;
    reservationNumber: string;
    previousPaidAmount: number;
    newPaidAmount: number;
    deltaAmount: number;
    reason: string;
    adjustedByName: string | null;
    createdAt: string;
  }>;
  diagnostics: {
    sourceRows: Record<string, number>;
    excluded: Record<string, number>;
    duplicateIdsIgnored: number;
    unallocatedPaymentIds: string[];
    ledgerEntriesNotIncludedInTotals: number;
    potentialCrossSourceDuplicates: Array<{ expenseId: string; tripCostId: string }>;
  };
}

export type FinancialMetricsPeriod = "7d" | "30d" | "90d" | "12m";
export interface FinancialMetricsFilters {
  reservationNumber?: string;
  adjustedBy?: string;
}

export const FINANCIAL_METRICS_PERIOD_LABELS: Record<FinancialMetricsPeriod, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  "12m": "Últimos 12 meses",
};

export const getFinancialMetricsQueryKey = (
  period?: FinancialMetricsPeriod,
  filters: FinancialMetricsFilters = {},
) =>
  ["/api/admin/financial-metrics", period ?? "current", filters.reservationNumber ?? "", filters.adjustedBy ?? ""] as const;

export async function getFinancialMetrics(
  period?: FinancialMetricsPeriod,
  filters: FinancialMetricsFilters = {},
): Promise<FinancialMetricsResponse> {
  const params = new URLSearchParams();
  if (period) params.set("period", period);
  if (filters.reservationNumber) params.set("reservationNumber", filters.reservationNumber);
  if (filters.adjustedBy) params.set("adjustedBy", filters.adjustedBy);
  const query = params.toString();
  const response = await fetch(`${BASE}/api/admin/financial-metrics${query ? `?${query}` : ""}`, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message ?? body?.error ?? "Não foi possível carregar os indicadores financeiros.");
  }
  return response.json() as Promise<FinancialMetricsResponse>;
}

export function useFinancialMetrics(
  period?: FinancialMetricsPeriod,
  filters: FinancialMetricsFilters = {},
) {
  return useQuery({
    queryKey: getFinancialMetricsQueryKey(period, filters),
    queryFn: () => getFinancialMetrics(period, filters),
  });
}
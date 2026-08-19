import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult, QueryKey, UseMutationResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { ErrorType } from "./custom-fetch";

const SIXTY_SECONDS = 60_000;

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface GemeoFutureTrip {
  id: string;
  name: string;
  destination: string;
  departureDate: string;
  capacity: number;
  occupied: number;
  fillRate: number;
  daysUntil: number;
  atRisk: boolean;
}

export interface GemeoMetrics {
  kpis: {
    revenueMTD: number;
    revenueMTDPrev: number;
    revenueMTDChangePct: number | null;
    reservationsToday: number;
    reservationsThisWeek: number;
    npsAvg30d: number | null;
    npsCount30d: number;
    opportunitySignals: number;
  };
  growth: {
    newLeadsThisMonth: number;
    conversionRate: number;
    conversionRatePrev: number;
    pipelineValue: number;
  };
  revenue: {
    mtd: number;
    mtdPrev: number;
    netProfit: number;
    receivablePending: number;
  };
  operation: {
    activeTrips: number;
    avgOccupancy: number;
    tripsAtRisk: number;
    futureTrips: GemeoFutureTrip[];
  };
  retention: {
    npsAvg30d: number | null;
    churnSignals: number;
    opportunitySignals: number;
  };
  cachedAt: string;
}

export const getGemeoMetricsUrl = () => `/api/dashboard/gemeo`;

export const getGemeoMetrics = (options?: RequestInit) =>
  customFetch<GemeoMetrics>(getGemeoMetricsUrl(), { ...options, method: "GET" });

export const getGemeoMetricsQueryKey = () => [`/api/dashboard/gemeo`] as const;

export function useGetGemeoMetrics<
  TData = GemeoMetrics,
  TError = ErrorType<unknown>,
>(options?: {
  query?: Partial<UseQueryOptions<GemeoMetrics, TError, TData>>;
  request?: RequestInit;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGemeoMetricsQueryKey();

  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getGemeoMetrics({ signal, ...requestOptions });

  const query = useQuery({
    queryKey,
    queryFn,
    refetchInterval: SIXTY_SECONDS,
    staleTime: SIXTY_SECONDS,
    ...queryOptions,
  }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return { ...query, queryKey };
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export type GemeoAlertCategory = "occupancy" | "churn" | "revenue" | "opportunity";
export type GemeoAlertSeverity = "low" | "medium" | "high";

export interface GemeoAlertItem {
  id: string;
  tenantId: string;
  message: string;
  category: GemeoAlertCategory;
  severity: GemeoAlertSeverity;
  actionUrl: string | null;
  generatedAt: string;
  createdAt: string;
}

export interface GemeoAlertsResponse {
  alerts: GemeoAlertItem[];
}

export const getGemeoAlertsUrl = () => `/api/dashboard/gemeo/alerts`;

export const getGemeoAlerts = (options?: RequestInit) =>
  customFetch<GemeoAlertsResponse>(getGemeoAlertsUrl(), { ...options, method: "GET" });

export const getGemeoAlertsQueryKey = () => [`/api/dashboard/gemeo/alerts`] as const;

export function useGetGemeoAlerts<
  TData = GemeoAlertsResponse,
  TError = ErrorType<unknown>,
>(options?: {
  query?: Partial<UseQueryOptions<GemeoAlertsResponse, TError, TData>>;
  request?: RequestInit;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGemeoAlertsQueryKey();

  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getGemeoAlerts({ signal, ...requestOptions });

  const query = useQuery({
    queryKey,
    queryFn,
    refetchInterval: SIXTY_SECONDS,
    ...queryOptions,
  }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return { ...query, queryKey };
}

export const dismissGemeoAlert = (id: string, options?: RequestInit) =>
  customFetch<{ success: boolean }>(`/api/dashboard/gemeo/alerts/${id}/dismiss`, {
    ...options,
    method: "PATCH",
  });

export function useDismissGemeoAlert(): UseMutationResult<{ success: boolean }, ErrorType, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dismissGemeoAlert(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getGemeoAlertsQueryKey() });
    },
  });
}

// ─── Opportunities ────────────────────────────────────────────────────────────

export interface GemeoOpportunityItem {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  actionUrl: string | null;
  generatedAt: string;
  createdAt: string;
}

export interface GemeoOpportunitiesResponse {
  opportunities: GemeoOpportunityItem[];
}

export const getGemeoOpportunitiesUrl = () => `/api/dashboard/gemeo/opportunities`;

export const getGemeoOpportunities = (options?: RequestInit) =>
  customFetch<GemeoOpportunitiesResponse>(getGemeoOpportunitiesUrl(), { ...options, method: "GET" });

export const getGemeoOpportunitiesQueryKey = () => [`/api/dashboard/gemeo/opportunities`] as const;

export function useGetGemeoOpportunities<
  TData = GemeoOpportunitiesResponse,
  TError = ErrorType<unknown>,
>(options?: {
  query?: Partial<UseQueryOptions<GemeoOpportunitiesResponse, TError, TData>>;
  request?: RequestInit;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGemeoOpportunitiesQueryKey();

  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getGemeoOpportunities({ signal, ...requestOptions });

  const query = useQuery({
    queryKey,
    queryFn,
    refetchInterval: SIXTY_SECONDS,
    ...queryOptions,
  }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return { ...query, queryKey };
}

export const dismissGemeoOpportunity = (id: string, options?: RequestInit) =>
  customFetch<{ success: boolean }>(`/api/dashboard/gemeo/opportunities/${id}/dismiss`, {
    ...options,
    method: "PATCH",
  });

export function useDismissGemeoOpportunity(): UseMutationResult<{ success: boolean }, ErrorType, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dismissGemeoOpportunity(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getGemeoOpportunitiesQueryKey() });
    },
  });
}

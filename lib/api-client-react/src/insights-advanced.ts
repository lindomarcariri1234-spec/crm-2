import { useQuery, useMutation } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult, QueryKey, UseMutationResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { ErrorType } from "./custom-fetch";

const FIVE_MINUTES = 5 * 60_000;

// ─── Revenue forecast ─────────────────────────────────────────────────────────

export interface RevenueHistoryPoint {
  month: string;
  revenue: number;
}

export interface RevenueForecastPoint {
  month: string;
  base: number;
  optimistic: number;
  pessimistic: number;
}

export interface RevenueForecastData {
  history: RevenueHistoryPoint[];
  forecast: RevenueForecastPoint[];
  narrative: string;
  source: "ai" | "computed";
  generatedAt: string;
}

export const getRevenueForecastUrl = () => `/api/insights/revenue-forecast`;

export const getRevenueForecast = (options?: RequestInit) =>
  customFetch<RevenueForecastData>(getRevenueForecastUrl(), { ...options, method: "GET" });

export const getRevenueForecastQueryKey = () => [`/api/insights/revenue-forecast`] as const;

export function useGetRevenueForecast<
  TData = RevenueForecastData,
  TError = ErrorType<unknown>,
>(options?: {
  query?: Partial<UseQueryOptions<RevenueForecastData, TError, TData>>;
  request?: RequestInit;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getRevenueForecastQueryKey();

  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getRevenueForecast({ signal, ...requestOptions });

  const query = useQuery({
    queryKey,
    queryFn,
    staleTime: FIVE_MINUTES,
    ...queryOptions,
  }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return { ...query, queryKey };
}

// ─── Occupancy risk ───────────────────────────────────────────────────────────

export type OccupancyRiskLevel = "red" | "yellow" | "green";

export interface OccupancyRiskTrip {
  id: string;
  name: string;
  destination: string;
  departureDate: string;
  daysUntil: number;
  capacity: number;
  occupied: number;
  availableSeats: number;
  fillRate: number;
  risk: OccupancyRiskLevel;
  comment: string | null;
}

export interface OccupancyRiskData {
  trips: OccupancyRiskTrip[];
  summary: string;
  counts: { red: number; yellow: number; green: number };
  generatedAt: string;
}

export const getOccupancyRiskUrl = () => `/api/insights/occupancy-risk`;

export const getOccupancyRisk = (options?: RequestInit) =>
  customFetch<OccupancyRiskData>(getOccupancyRiskUrl(), { ...options, method: "GET" });

export const getOccupancyRiskQueryKey = () => [`/api/insights/occupancy-risk`] as const;

export function useGetOccupancyRisk<
  TData = OccupancyRiskData,
  TError = ErrorType<unknown>,
>(options?: {
  query?: Partial<UseQueryOptions<OccupancyRiskData, TError, TData>>;
  request?: RequestInit;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getOccupancyRiskQueryKey();

  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getOccupancyRisk({ signal, ...requestOptions });

  const query = useQuery({
    queryKey,
    queryFn,
    staleTime: FIVE_MINUTES,
    ...queryOptions,
  }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return { ...query, queryKey };
}

// ─── Revenue simulator ────────────────────────────────────────────────────────

export interface SimulatorInput {
  leadsChangePct: number;
  priceChangePct: number;
  conversionChangePct: number;
}

export interface SimulatorResult {
  baselineRevenue: number;
  projectedRevenue: number;
  deltaRevenue: number;
  deltaPct: number;
  reasoning: string;
  source: "ai" | "computed";
  generatedAt: string;
}

export const runSimulator = (body: SimulatorInput, options?: RequestInit) =>
  customFetch<SimulatorResult>(`/api/insights/simulator`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    body: JSON.stringify(body),
  });

export const useRunSimulator = (): UseMutationResult<SimulatorResult, ErrorType, SimulatorInput> =>
  useMutation({
    mutationFn: (body: SimulatorInput) => runSimulator(body),
  });

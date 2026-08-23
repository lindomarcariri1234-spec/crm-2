import { useQuery, useMutation } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult, QueryKey, UseMutationResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { ErrorType } from "./custom-fetch";

export type ReferralAnalyticsPeriod = 30 | 90 | 180;

export interface ReferralAnalyticsSeries {
  week: string;
  created: number;
  converted: number;
}

export interface ReferralAnalyticsFunnel {
  created: number;
  visited: number;
  converted: number;
  bonusPaid: number;
}

export interface ReferralAnalyticsMonthly {
  month: string;
  created: number;
  converted: number;
  bonusPaid: number;
}

export interface ReferralAnalyticsChannel {
  source: string;
  visitors: number;
  converted: number;
}

export interface ReferralAnalyticsROI {
  totalBonusPaid: number;
  totalReferredRevenue: number;
}

export interface ReferralAnalyticsMonthStats {
  referrals: number;
  conversions: number;
  bonusPaid: number;
  bonusPaidAmount: number;
}

export interface ReferralAnalyticsCommercialSummary {
  validReferrals: number;
  attributedRevenue: number;
  rewardsPaid: number;
  rewardsPending: number;
  discountGiven: number;
  acquisitionCost: number;
  cac: number;
  roiPercent: number;
  roiMultiple: number;
}

export interface ReferralAnalyticsRankingEntry {
  referrerId: string;
  referrerName: string;
  conversions: number;
  attributedRevenue: number;
  rewardsPaid: number;
  /**
   * Contractual partner commissions are outside the current program. This
   * explicit zero keeps the UI from mistaking promotional bonus for commission.
   */
  commissionAmount: number;
}

export interface ReferralAnalyticsTrackingFunnel {
  uniqueVisitors: number;
  checkoutStarts: number;
  converted: number;
}

export interface ReferralAnalyticsData {
  series: ReferralAnalyticsSeries[];
  monthly: ReferralAnalyticsMonthly[];
  funnel: ReferralAnalyticsFunnel;
  trackingFunnel: ReferralAnalyticsTrackingFunnel;
  channels: ReferralAnalyticsChannel[];
  roi: ReferralAnalyticsROI;
  currentMonth: ReferralAnalyticsMonthStats;
  prevMonth: ReferralAnalyticsMonthStats;
  summary: ReferralAnalyticsCommercialSummary;
  ranking: ReferralAnalyticsRankingEntry[];
  conversionRate: number;
  prevConversionRate: number;
  discountGiven: number;
}

export const getReferralAnalyticsUrl = (period: ReferralAnalyticsPeriod) =>
  `/api/referrals/analytics?period=${period}`;

export const getReferralAnalytics = (period: ReferralAnalyticsPeriod, options?: RequestInit) =>
  customFetch<ReferralAnalyticsData>(getReferralAnalyticsUrl(period), { ...options, method: "GET" });

export const getReferralAnalyticsQueryKey = (period: ReferralAnalyticsPeriod) =>
  [`/api/referrals/analytics`, period] as const;

export function useGetReferralAnalytics<
  TData = ReferralAnalyticsData,
  TError = ErrorType<unknown>,
>(
  period: ReferralAnalyticsPeriod,
  options?: {
    query?: UseQueryOptions<ReferralAnalyticsData, TError, TData>;
    request?: RequestInit;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getReferralAnalyticsQueryKey(period);

  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getReferralAnalytics(period, { signal, ...requestOptions });

  const query = useQuery({
    queryKey,
    queryFn,
    ...queryOptions,
  }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return { ...query, queryKey };
}

export interface ReferralShareData {
  link: string;
  qrCodeDataUrl: string;
}

export const getReferralShareUrl = (id: string) => `/api/referrals/${id}/share`;

export const getReferralShare = (id: string, options?: RequestInit) =>
  customFetch<ReferralShareData>(getReferralShareUrl(id), { ...options, method: "GET" });

export const getReferralShareQueryKey = (id: string) =>
  [`/api/referrals/share`, id] as const;

export function useGetReferralShare<
  TData = ReferralShareData,
  TError = ErrorType<unknown>,
>(
  id: string | null | undefined,
  options?: {
    query?: UseQueryOptions<ReferralShareData, TError, TData>;
    request?: RequestInit;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getReferralShareQueryKey(id ?? "");

  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getReferralShare(id!, { signal, ...requestOptions });

  const query = useQuery({
    queryKey,
    queryFn,
    enabled: !!id,
    ...queryOptions,
  }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return { ...query, queryKey };
}

export interface ReferralExportFilters {
  status?: string;
  search?: string;
  bonusPaid?: boolean;
  fraudFlag?: boolean;
  expiringSoon?: boolean;
  bonusNotified?: boolean;
  format?: "csv" | "xlsx" | "json";
}

export interface ReferralExpiryEmailEntry {
  status: string;
  errorMessage: string | null;
  sentAt: string;
}

export interface ReferralExpiryEmailStatus {
  d7: ReferralExpiryEmailEntry | null;
  d1: ReferralExpiryEmailEntry | null;
}

export const getReferralExpiryEmailStatusUrl = (id: string) =>
  `/api/referrals/${id}/expiry-email-status`;

export const getReferralExpiryEmailStatus = (id: string, options?: RequestInit) =>
  customFetch<ReferralExpiryEmailStatus>(getReferralExpiryEmailStatusUrl(id), { ...options, method: "GET" });

export const getReferralExpiryEmailStatusQueryKey = (id: string) =>
  [`/api/referrals/expiry-email-status`, id] as const;

export function useGetReferralExpiryEmailStatus<
  TData = ReferralExpiryEmailStatus,
  TError = ErrorType<unknown>,
>(
  id: string | null | undefined,
  options?: {
    query?: UseQueryOptions<ReferralExpiryEmailStatus, TError, TData>;
    request?: RequestInit;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getReferralExpiryEmailStatusQueryKey(id ?? "");

  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getReferralExpiryEmailStatus(id!, { signal, ...requestOptions });

  const query = useQuery({
    queryKey,
    queryFn,
    enabled: !!id,
    ...queryOptions,
  }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return { ...query, queryKey };
}

export interface ReferralBonusReleaseEmailStatus {
  bonusRelease: ReferralExpiryEmailEntry | null;
}

export const getReferralBonusReleaseEmailStatusUrl = (id: string) =>
  `/api/referrals/${id}/bonus-release-email-status`;

export const getReferralBonusReleaseEmailStatus = (id: string, options?: RequestInit) =>
  customFetch<ReferralBonusReleaseEmailStatus>(getReferralBonusReleaseEmailStatusUrl(id), { ...options, method: "GET" });

export const getReferralBonusReleaseEmailStatusQueryKey = (id: string) =>
  [`/api/referrals/bonus-release-email-status`, id] as const;

export function useGetReferralBonusReleaseEmailStatus<
  TData = ReferralBonusReleaseEmailStatus,
  TError = ErrorType<unknown>,
>(
  id: string | null | undefined,
  options?: {
    query?: UseQueryOptions<ReferralBonusReleaseEmailStatus, TError, TData>;
    request?: RequestInit;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getReferralBonusReleaseEmailStatusQueryKey(id ?? "");

  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getReferralBonusReleaseEmailStatus(id!, { signal, ...requestOptions });

  const query = useQuery({
    queryKey,
    queryFn,
    enabled: !!id,
    ...queryOptions,
  }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return { ...query, queryKey };
}

export const getReferralAnalyticsExportUrl = (
  period: ReferralAnalyticsPeriod,
  opts?: { startDate?: string; endDate?: string },
) => {
  const params = new URLSearchParams();
  if (opts?.startDate) {
    params.set("startDate", opts.startDate);
    if (opts.endDate) params.set("endDate", opts.endDate);
  } else {
    params.set("period", String(period));
  }
  return `/api/referrals/analytics/export?${params.toString()}`;
};

export interface ReferralCampaign {
  id: string;
  tenantId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  bonusType: "multiplier" | "fixed_extra" | "fixed_bonus" | "percentage_bonus" | "reduced_bonus" | "no_reward";
  bonusValue: number;
  bannerText: string | null;
  createdAt: string;
  updatedAt: string;
  referralsCount?: number;
  bonusPaidCount?: number;
  bonusPaidAmount?: number;
  eligibleStoreProductIds: string[];
  eligibleTierLevels: string[];
  conversionCap: number | null;
  budgetAmount: number | null;
  shareMessage: string | null;
  materialUrl: string | null;
  publicRanking: boolean;
  eligibleActivitySegments: Array<"active" | "occasional" | "inactive">;
  eligibleChannels: string[];
  commissionType: "none" | "fixed" | "bonus_percentage";
  commissionValue: number;
  commissionRecipientType: "ambassador" | "partner";
  eligiblePartnerIds: string[];
}

export interface CreateReferralCampaignBody {
  name: string;
  startsAt: string;
  endsAt: string;
  bonusType: "multiplier" | "fixed_extra" | "fixed_bonus" | "percentage_bonus" | "reduced_bonus" | "no_reward";
  bonusValue: number;
  bannerText?: string;
  eligibleStoreProductIds?: string[];
  eligibleTierLevels?: string[];
  conversionCap?: number | null;
  budgetAmount?: number | null;
  shareMessage?: string | null;
  materialUrl?: string | null;
  publicRanking?: boolean;
  eligibleActivitySegments?: Array<"active" | "occasional" | "inactive">;
  eligibleChannels?: string[];
  commissionType?: "none" | "fixed" | "bonus_percentage";
  commissionValue?: number;
  commissionRecipientType?: "ambassador" | "partner";
  eligiblePartnerIds?: string[];
}

export const useListReferralCampaigns = (): UseQueryResult<ReferralCampaign[], ErrorType> =>
  useQuery({
    queryKey: ["referrals", "campaigns"],
    queryFn: () => customFetch<ReferralCampaign[]>("/api/referrals/campaigns"),
    staleTime: 30_000,
  });

export const useGetActiveCampaign = (): UseQueryResult<ReferralCampaign | null, ErrorType> =>
  useQuery({
    queryKey: ["referrals", "active-campaign"],
    queryFn: () => customFetch<ReferralCampaign | null>("/api/referrals/active-campaign"),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

export const useCreateReferralCampaign = (): UseMutationResult<ReferralCampaign, ErrorType, CreateReferralCampaignBody> =>
  useMutation({
    mutationFn: (body: CreateReferralCampaignBody) =>
      customFetch<ReferralCampaign>("/api/referrals/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  });

export const useDeleteReferralCampaign = (): UseMutationResult<void, ErrorType, { id: string }> =>
  useMutation({
    mutationFn: ({ id }: { id: string }) =>
      customFetch<void>(`/api/referrals/campaigns/${id}`, { method: "DELETE" }),
  });

export interface UpdateReferralCampaignBody {
  id: string;
  name?: string;
  startsAt?: string;
  endsAt?: string;
  bonusType?: "multiplier" | "fixed_extra" | "fixed_bonus" | "percentage_bonus" | "reduced_bonus" | "no_reward";
  bonusValue?: number;
  bannerText?: string | null;
  eligibleStoreProductIds?: string[];
  eligibleTierLevels?: string[];
  conversionCap?: number | null;
  budgetAmount?: number | null;
  shareMessage?: string | null;
  materialUrl?: string | null;
  publicRanking?: boolean;
  eligibleActivitySegments?: Array<"active" | "occasional" | "inactive">;
  eligibleChannels?: string[];
  commissionType?: "none" | "fixed" | "bonus_percentage";
  commissionValue?: number;
  commissionRecipientType?: "ambassador" | "partner";
  eligiblePartnerIds?: string[];
}

export const useUpdateReferralCampaign = (): UseMutationResult<ReferralCampaign, ErrorType, UpdateReferralCampaignBody> =>
  useMutation({
    mutationFn: ({ id, ...body }: UpdateReferralCampaignBody) =>
      customFetch<ReferralCampaign>(`/api/referrals/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  });

export const getReferralExportUrl = (filters: ReferralExportFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);
  if (filters.bonusPaid === false) params.set("bonusPaid", "false");
  if (filters.fraudFlag === true) params.set("fraudFlag", "true");
  if (filters.expiringSoon === true) params.set("expiringSoon", "true");
  if (filters.bonusNotified === true) params.set("bonusNotified", "true");
  if (filters.bonusNotified === false) params.set("bonusNotified", "false");
  if (filters.format && filters.format !== "csv") params.set("format", filters.format);
  const qs = params.toString();
  return qs ? `/api/referrals/export?${qs}` : `/api/referrals/export`;
};

export interface CommissionReportTotals {
  pending: number;
  approved: number;
  paid: number;
}

export interface CommissionReport {
  totals: CommissionReportTotals;
  counts: CommissionReportTotals;
  entries: Array<{
    id: string;
    referralId: string;
    campaignId: string | null;
    recipientType: "ambassador" | "partner";
    recipientId: string;
    recipientName: string;
    amount: number;
    basis: string;
    status: "pending" | "approved" | "paid" | "reversed";
    approvedAt: string | null;
    paidAt: string | null;
    reversedAt: string | null;
    createdAt: string;
  }>;
  partnerTotals: Array<{
    partnerId: string;
    partnerName: string;
    pending: number;
    approved: number;
    paid: number;
    reversed: number;
    total: number;
  }>;
}

export const useGetReferralCommissionReport = (): UseQueryResult<CommissionReport, ErrorType> =>
  useQuery({
    queryKey: ["referrals", "commissions", "report"],
    queryFn: () => customFetch<CommissionReport>("/api/referrals/commissions/report"),
  });

export const useUpdateReferralCommissionStatus = (): UseMutationResult<void, ErrorType, { id: string; status: "pending" | "approved" | "paid" }> =>
  useMutation({
    mutationFn: ({ id, status }) =>
      customFetch<void>(`/api/referrals/commissions/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }),
  });

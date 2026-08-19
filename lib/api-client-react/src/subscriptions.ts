import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  UseMutationOptions,
  UseQueryOptions,
  UseMutationResult,
  UseQueryResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface PlanPublic {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  monthlyPrice: string;
  annualPrice: string;
  maxUsers: number;
  maxClients: number;
  maxTrips: number;
  features: string[];
  supportedFeatures: string[];
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  trialDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionUsage {
  users: number;
  clients: number;
  trips: number;
  maxUsers: number;
  maxClients: number;
  maxTrips: number;
}

export interface SubscriptionInvoice {
  id: string;
  tenantId: string;
  planId?: string | null;
  invoiceNumber?: string | null;
  amount: string;
  currency: string;
  status: string;
  paymentMethod?: string | null;
  dueDate?: string | null;
  paidAt?: string | null;
  description?: string | null;
  notes?: string | null;
  pixCode?: string | null;
  pixQrCodeUrl?: string | null;
  pixExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CurrentSubscriptionResponse {
  tenant: {
    id: string;
    name: string;
    planId: string;
    status: string;
    trialEndsAt?: string | null;
  };
  plan: PlanPublic | null;
  plans: PlanPublic[];
  subscription: {
    id: string;
    tenantId: string;
    planId: string;
    status: string;
    billingCycle: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    trialEnd?: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  usage: SubscriptionUsage;
  invoices: SubscriptionInvoice[];
}

export interface UpgradeSubscriptionBody {
  planId: string;
  billingCycle?: "monthly" | "annual";
}

export interface UpgradeSubscriptionResponse {
  upgraded: boolean;
  pendingInvoice?: boolean;
  trial?: boolean;
  trialDays?: number;
  trialEndsAt?: string;
  plan: PlanPublic;
  invoice: SubscriptionInvoice | null;
  checkoutUrl?: string | null;
}

export const getCurrentSubscriptionQueryKey = () => ["/api/subscriptions/current"] as const;

export const useGetCurrentSubscription = <
  TData = CurrentSubscriptionResponse,
  TError = unknown,
>(
  options?: Omit<UseQueryOptions<CurrentSubscriptionResponse, TError, TData>, "queryKey" | "queryFn">
): UseQueryResult<TData, TError> => {
  return useQuery({
    queryKey: getCurrentSubscriptionQueryKey(),
    queryFn: () =>
      customFetch<CurrentSubscriptionResponse>("/api/subscriptions/current"),
    ...options,
  });
};

export const useUpgradeSubscription = <
  TError = unknown,
  TContext = unknown,
>(
  options?: UseMutationOptions<UpgradeSubscriptionResponse, TError, UpgradeSubscriptionBody, TContext>
): UseMutationResult<UpgradeSubscriptionResponse, TError, UpgradeSubscriptionBody, TContext> => {
  return useMutation({
    mutationFn: (body: UpgradeSubscriptionBody) =>
      customFetch<UpgradeSubscriptionResponse>("/api/subscriptions/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    ...options,
  });
};

export const useGenerateInvoicePix = <
  TError = unknown,
  TContext = unknown,
>(
  options?: UseMutationOptions<SubscriptionInvoice, TError, { id: string }, TContext>
): UseMutationResult<SubscriptionInvoice, TError, { id: string }, TContext> => {
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      customFetch<SubscriptionInvoice>(`/api/invoices/${id}/pix`, {
        method: "POST",
      }),
    ...options,
  });
};

export const useConfirmInvoicePayment = <
  TError = unknown,
  TContext = unknown,
>(
  options?: UseMutationOptions<SubscriptionInvoice, TError, { id: string }, TContext>
): UseMutationResult<SubscriptionInvoice, TError, { id: string }, TContext> => {
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      customFetch<SubscriptionInvoice>(`/api/admin/invoices/${id}/confirm-payment`, {
        method: "POST",
      }),
    ...options,
  });
};

export const getListPublicPlansQueryKey = () => ["/api/plans/list"] as const;

export const useListPublicPlans = <
  TData = PlanPublic[],
  TError = unknown,
>(
  options?: Omit<UseQueryOptions<PlanPublic[], TError, TData>, "queryKey" | "queryFn">
): UseQueryResult<TData, TError> => {
  return useQuery({
    queryKey: getListPublicPlansQueryKey(),
    queryFn: () => customFetch<PlanPublic[]>("/api/plans/list"),
    ...options,
  });
};

export interface StripeCheckoutResponse {
  clientSecret: string;
  paymentIntentId: string;
  publishableKey: string;
}

export const useCreateStripeCheckout = <
  TError = unknown,
  TContext = unknown,
>(
  options?: UseMutationOptions<StripeCheckoutResponse, TError, { id: string }, TContext>
): UseMutationResult<StripeCheckoutResponse, TError, { id: string }, TContext> => {
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      customFetch<StripeCheckoutResponse>(`/api/invoices/${id}/stripe/checkout`, {
        method: "POST",
      }),
    ...options,
  });
};

export interface CustomerPortalResponse {
  portalUrl: string;
}

export const useCreateCustomerPortalSession = <
  TError = unknown,
  TContext = unknown,
>(
  options?: UseMutationOptions<CustomerPortalResponse, TError, void, TContext>
): UseMutationResult<CustomerPortalResponse, TError, void, TContext> => {
  return useMutation({
    mutationFn: () =>
      customFetch<CustomerPortalResponse>("/api/subscriptions/portal", {
        method: "POST",
      }),
    ...options,
  });
};

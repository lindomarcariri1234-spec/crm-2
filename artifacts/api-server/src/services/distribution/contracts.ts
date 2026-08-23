export type DistributionKind = "transport" | "lodging" | "tour" | "ticket" | "insurance" | "transfer";
export type DistributionOperation = "search" | "quote" | "availability" | "book" | "cancel" | "get_order" | "reconcile";

export interface DistributionSearchRequest {
  kind?: DistributionKind;
  origin?: string;
  destination?: string;
  date?: string;
  passengers?: number;
}

export interface NormalizedOffer {
  externalId: string;
  kind: DistributionKind;
  title: string;
  description?: string;
  origin?: string;
  destination?: string;
  price: number;
  currency: string;
  priceValidUntil: string;
  availableUnits?: number;
  cancellationPolicy?: string;
  metadata: Record<string, unknown>;
}

export interface DistributionQuoteRequest {
  offerExternalId: string;
  quantity: number;
  date?: string;
}

export interface NormalizedQuote {
  quoteId: string;
  offerExternalId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  currency: string;
  validUntil: string;
  availableUnits?: number;
}

export interface DistributionBookingRequest {
  quoteId: string;
  offerExternalId: string;
  quantity: number;
  customer: { name: string; email: string; phone?: string };
  idempotencyKey: string;
}

export interface NormalizedOrder {
  externalOrderId: string;
  status: "confirmed" | "pending" | "cancelled";
  voucherCode?: string;
  offerExternalId: string;
  quantity: number;
  totalPrice: number;
  currency: string;
}

export interface DistributionCancelRequest {
  externalOrderId: string;
  reason?: string;
}

export interface DistributionOperationContext {
  tenantId: string;
  availableUnits?: number;
}

export interface DistributionAdapter {
  readonly type: string;
  search(request: DistributionSearchRequest, context: DistributionOperationContext): Promise<NormalizedOffer[]>;
  quote(request: DistributionQuoteRequest, context: DistributionOperationContext): Promise<NormalizedQuote>;
  availability(request: DistributionQuoteRequest, context: DistributionOperationContext): Promise<{ availableUnits: number; checkedAt: string }>;
  book(request: DistributionBookingRequest, context: DistributionOperationContext): Promise<NormalizedOrder>;
  cancel(request: DistributionCancelRequest, context: DistributionOperationContext): Promise<NormalizedOrder>;
  getOrder(externalOrderId: string, context: DistributionOperationContext): Promise<NormalizedOrder>;
}

export class DistributionProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode: number;

  constructor(message: string, code: string, options?: { retryable?: boolean; statusCode?: number }) {
    super(message);
    this.name = "DistributionProviderError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.statusCode = options?.statusCode ?? 502;
  }
}
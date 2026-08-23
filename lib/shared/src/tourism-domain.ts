/**
 * Canonical, storage-agnostic tourism domain contracts.
 *
 * These contracts are intentionally independent from Drizzle tables. Existing
 * store/trip/reservation records can be adapted to them incrementally without
 * forcing a table rename or creating a second source of truth.
 */

export const TOURISM_PARTY_TYPES = {
  AGENCY: "agency",
  OPERATOR: "operator",
  PARTNER: "partner",
  SUPPLIER: "supplier",
  TRAVELER: "traveler",
} as const;

export type TourismPartyType = (typeof TOURISM_PARTY_TYPES)[keyof typeof TOURISM_PARTY_TYPES];

export const TOURISM_PRODUCT_TYPES = {
  EXPERIENCE: "experience",
  TRIP: "trip",
  TRANSPORT: "transport",
  LODGING: "lodging",
  EVENT: "event",
  TICKET: "ticket",
  INSURANCE: "insurance",
  TRANSFER: "transfer",
  PACKAGE: "package",
  FOOD: "food",
} as const;

export type TourismProductType = (typeof TOURISM_PRODUCT_TYPES)[keyof typeof TOURISM_PRODUCT_TYPES];

export const TOURISM_SUPPLY_ORIGINS = {
  OWNED: "owned",
  PARTNER: "partner",
  INTEGRATION: "integration",
} as const;

export type TourismSupplyOrigin = (typeof TOURISM_SUPPLY_ORIGINS)[keyof typeof TOURISM_SUPPLY_ORIGINS];

export const TOURISM_PRODUCT_STATUSES = {
  DRAFT: "draft",
  PENDING_REVIEW: "pending_review",
  PUBLISHED: "published",
  PAUSED: "paused",
  ARCHIVED: "archived",
} as const;

export type TourismProductStatus = (typeof TOURISM_PRODUCT_STATUSES)[keyof typeof TOURISM_PRODUCT_STATUSES];

export const TOURISM_ORDER_STATUSES = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  PROCESSING: "processing",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
} as const;

export type TourismOrderStatus = (typeof TOURISM_ORDER_STATUSES)[keyof typeof TOURISM_ORDER_STATUSES];

export const TOURISM_RESERVATION_STATUSES = {
  HELD: "held",
  PENDING: "pending",
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  REFUNDED: "refunded",
  FAILED: "failed",
} as const;

export type TourismReservationStatus = (typeof TOURISM_RESERVATION_STATUSES)[keyof typeof TOURISM_RESERVATION_STATUSES];

export const TOURISM_PAYMENT_STATUSES = {
  PENDING: "pending",
  AUTHORIZED: "authorized",
  CONFIRMED: "confirmed",
  OVERDUE: "overdue",
  FAILED: "failed",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
  CHARGED_BACK: "charged_back",
} as const;

export type TourismPaymentStatus = (typeof TOURISM_PAYMENT_STATUSES)[keyof typeof TOURISM_PAYMENT_STATUSES];

export const TOURISM_AVAILABILITY_MODES = {
  FINITE: "finite",
  ON_REQUEST: "on_request",
  UNLIMITED: "unlimited",
  EXTERNAL: "external",
} as const;

export type TourismAvailabilityMode = (typeof TOURISM_AVAILABILITY_MODES)[keyof typeof TOURISM_AVAILABILITY_MODES];

export const TOURISM_AVAILABILITY_STATUSES = {
  AVAILABLE: "available",
  LIMITED: "limited",
  SOLD_OUT: "sold_out",
  UNAVAILABLE: "unavailable",
  UNKNOWN: "unknown",
} as const;

export type TourismAvailabilityStatus = (typeof TOURISM_AVAILABILITY_STATUSES)[keyof typeof TOURISM_AVAILABILITY_STATUSES];

export const TOURISM_BENEFIT_TYPES = {
  PROMOTIONAL_BONUS: "promotional_bonus",
  LOYALTY_POINTS: "loyalty_points",
  WALLET_CREDIT: "wallet_credit",
  CASHBACK: "cashback",
  PARTNER_BENEFIT: "partner_benefit",
} as const;

export type TourismBenefitType = (typeof TOURISM_BENEFIT_TYPES)[keyof typeof TOURISM_BENEFIT_TYPES];

export const TOURISM_RELATIONSHIP_STAGES = {
  LEAD: "lead",
  PROSPECT: "prospect",
  CLIENT: "client",
  ADVOCATE: "advocate",
  INACTIVE: "inactive",
} as const;

export type TourismRelationshipStage = (typeof TOURISM_RELATIONSHIP_STAGES)[keyof typeof TOURISM_RELATIONSHIP_STAGES];

export interface TourismEntityRef {
  readonly id: string;
  readonly tenantId: string;
}

export interface TourismParty extends TourismEntityRef {
  readonly type: TourismPartyType;
  readonly displayName: string;
  readonly externalRef?: string;
}

export interface TourismMoney {
  /** Decimal string, never a binary floating-point amount. */
  readonly amount: string;
  readonly currency: "BRL" | (string & {});
}

export interface TourismCancellationPolicy {
  readonly refundable: boolean;
  readonly deadline?: string;
  readonly fee?: TourismMoney;
  readonly description?: string;
}

export interface TourismProduct extends TourismEntityRef {
  readonly type: TourismProductType;
  readonly name: string;
  readonly slug: string;
  readonly origin: TourismSupplyOrigin;
  readonly ownerPartyId: string;
  readonly supplierPartyId?: string;
  readonly status: TourismProductStatus;
  readonly categoryId?: string;
  readonly destination?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TourismAvailability extends TourismEntityRef {
  readonly offerId: string;
  readonly mode: TourismAvailabilityMode;
  readonly status: TourismAvailabilityStatus;
  readonly quantityAvailable?: number;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly sourceRef?: string;
  readonly checkedAt: string;
}

export interface TourismOffer extends TourismEntityRef {
  readonly productId: string;
  readonly sellerPartyId: string;
  readonly supplierPartyId?: string;
  readonly origin: TourismSupplyOrigin;
  readonly price: TourismMoney;
  readonly compareAtPrice?: TourismMoney;
  readonly availability: TourismAvailability;
  readonly cancellationPolicy?: TourismCancellationPolicy;
  readonly termsVersion?: string;
  readonly externalRef?: string;
}

export interface TourismOrderLine extends TourismEntityRef {
  readonly orderId: string;
  readonly offerId: string;
  readonly productId: string;
  readonly sellerPartyId: string;
  readonly quantity: number;
  readonly unitPrice: TourismMoney;
  readonly totalPrice: TourismMoney;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TourismOrder extends TourismEntityRef {
  readonly customerPartyId?: string;
  readonly status: TourismOrderStatus;
  readonly currency: string;
  readonly lines: readonly TourismOrderLine[];
  readonly subtotal: TourismMoney;
  readonly discount: TourismMoney;
  readonly total: TourismMoney;
  readonly idempotencyKey: string;
  readonly channel: "crm" | "storefront" | "mobile" | "partner" | "api";
}

export interface TourismReservation extends TourismEntityRef {
  readonly orderId: string;
  readonly lineId: string;
  readonly offerId: string;
  readonly travelerPartyId?: string;
  readonly status: TourismReservationStatus;
  readonly quantity: number;
  readonly voucherCode?: string;
  readonly heldUntil?: string;
}

export interface TourismPayment extends TourismEntityRef {
  readonly orderId: string;
  readonly status: TourismPaymentStatus;
  readonly amount: TourismMoney;
  readonly provider: string;
  readonly providerTransactionId?: string;
  readonly installmentNumber?: number;
  readonly totalInstallments?: number;
  readonly isDeposit?: boolean;
  readonly idempotencyKey: string;
}

export interface TourismCommission extends TourismEntityRef {
  readonly orderId: string;
  readonly lineId?: string;
  readonly recipientPartyId: string;
  readonly basis: TourismMoney;
  readonly amount: TourismMoney;
  readonly status: "pending" | "approved" | "paid" | "reversed";
  readonly source: "sale" | "referral" | "partner";
}

export interface TourismBenefit extends TourismEntityRef {
  readonly beneficiaryPartyId: string;
  readonly type: TourismBenefitType;
  readonly amount?: TourismMoney;
  readonly points?: number;
  readonly status: "pending" | "available" | "consumed" | "expired" | "reversed";
  readonly sourceRef: string;
  readonly expiresAt?: string;
}

export interface TourismRelationship extends TourismEntityRef {
  readonly partyId: string;
  readonly stage: TourismRelationshipStage;
  readonly source?: string;
  readonly channel?: string;
  readonly consentVersion?: string;
  readonly lastInteractionAt?: string;
  readonly nextActionAt?: string;
}

export interface TourismAccessContext {
  readonly actorId: string;
  readonly tenantId: string | null;
  readonly role: string;
  /**
   * Server-only scope, set after the endpoint has validated a superadmin
   * session. Client input must never be spread into this context.
   */
  readonly authorizationScope?: "tenant" | "platform";
}

export class TourismDomainError extends Error {
  readonly code: "INVALID_CONTRACT" | "TENANT_MISMATCH" | "TENANT_ACCESS_DENIED";

  constructor(code: TourismDomainError["code"], message: string) {
    super(message);
    this.name = "TourismDomainError";
    this.code = code;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/;
const FORMATTED_CPF_PATTERN = /(?:^|[^0-9])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?:$|[^0-9])/;
const FORMATTED_CARD_PATTERN = /(?:^|[^0-9])(?:\d{4}[-. ]?){3}\d{4}(?:$|[^0-9])/;
const FORMATTED_BRAZIL_PHONE_PATTERN = /(?:^|[^0-9])(?:\+?55[-. ]?)?(?:\(?\d{2}\)?[-. ]?)?9?\d{4,5}[-. ]?\d{4}(?:$|[^0-9])/;

function invalidContract(message: string): never {
  throw new TourismDomainError("INVALID_CONTRACT", message);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidContract(`${field} must be a non-empty string`);
  }
}

export function validateIdentifier(value: unknown, field = "id"): asserts value is string {
  assertString(value, field);
  const digitsOnly = value.replace(/\D/g, "");
  // Reject sensitive Brazilian identifiers before the generic identifier
  // pattern accepts their dots, hyphens, parentheses, or spaces. This also
  // protects a caller who prefixes a raw value with an otherwise-valid label.
  if (
    FORMATTED_CPF_PATTERN.test(value) ||
    FORMATTED_CARD_PATTERN.test(value) ||
    FORMATTED_BRAZIL_PHONE_PATTERN.test(value) ||
    (!/[A-Za-z]/.test(value) && digitsOnly.length >= 8)
  ) {
    invalidContract(`${field} must be an opaque identifier, not a personal or payment identifier`);
  }
  if (!ID_PATTERN.test(value)) {
    invalidContract(`${field} contains unsupported characters or is too long`);
  }
}

export function validateTenantId(value: unknown): asserts value is string {
  validateIdentifier(value, "tenantId");
}

export function validateEntityRef(value: unknown): asserts value is TourismEntityRef {
  if (!value || typeof value !== "object") invalidContract("entity reference must be an object");
  const ref = value as Record<string, unknown>;
  validateIdentifier(ref.id, "id");
  validateTenantId(ref.tenantId);
}

export function assertSameTenant(...refs: readonly TourismEntityRef[]): string {
  if (refs.length === 0) invalidContract("at least one entity reference is required");
  refs.forEach(validateEntityRef);
  const tenantId = refs[0].tenantId;
  if (refs.some((ref) => ref.tenantId !== tenantId)) {
    throw new TourismDomainError("TENANT_MISMATCH", "tourism entities must belong to the same tenant");
  }
  return tenantId;
}

export function assertTenantAccess(context: TourismAccessContext, targetTenantId: string): void {
  validateTenantId(targetTenantId);
  if (context.authorizationScope === "platform" && context.role === "superadmin") return;
  if (!context.tenantId || context.tenantId !== targetTenantId) {
    throw new TourismDomainError("TENANT_ACCESS_DENIED", "actor cannot access this tenant");
  }
}

export function validateMoney(value: unknown, field = "money"): asserts value is TourismMoney {
  if (!value || typeof value !== "object") invalidContract(`${field} must be an object`);
  const money = value as Record<string, unknown>;
  if (typeof money.amount !== "string" || !DECIMAL_PATTERN.test(money.amount)) {
    invalidContract(`${field}.amount must be a positive decimal string with up to four decimals`);
  }
  assertString(money.currency, `${field}.currency`);
}

export interface TourismIdempotencyParts {
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly operation: string;
  /**
   * Stable identifier of one business effect, such as a payment ID or provider
   * webhook ID. Replays reuse it; separate installments use different values.
   */
  readonly effectId: string;
}

/**
 * Produces a stable key for retried commands. Only opaque identifiers are
 * accepted, so callers cannot accidentally put emails, phones or card data in
 * a key that may be logged or persisted.
 */
export function buildTourismIdempotencyKey(parts: TourismIdempotencyParts): string {
  validateTenantId(parts.tenantId);
  validateIdentifier(parts.aggregateType, "aggregateType");
  validateIdentifier(parts.aggregateId, "aggregateId");
  validateIdentifier(parts.operation, "operation");
  validateIdentifier(parts.effectId, "effectId");

  return [
    "tourism",
    parts.tenantId,
    parts.aggregateType,
    parts.aggregateId,
    parts.operation,
    parts.effectId,
  ].join(":");
}

export function validateTourismIdempotencyKey(
  value: unknown,
  context: Pick<TourismIdempotencyParts, "tenantId" | "aggregateType" | "aggregateId" | "operation">,
): asserts value is string {
  validateTenantId(context.tenantId);
  validateIdentifier(context.aggregateType, "aggregateType");
  validateIdentifier(context.aggregateId, "aggregateId");
  validateIdentifier(context.operation, "operation");
  assertString(value, "idempotencyKey");
  const prefix = `tourism:${context.tenantId}:${context.aggregateType}:${context.aggregateId}:${context.operation}:`;
  if (!value.startsWith(prefix)) {
    invalidContract("idempotencyKey does not match its tenant, aggregate, and operation");
  }
  validateIdentifier(value.slice(prefix.length), "idempotencyKey.effectId");
}

/**
 * Explicit compatibility mappings for current persisted states. Adapt the
 * legacy record at the boundary; do not cast a storage status into a canonical
 * status and silently change its meaning.
 */
export function mapLegacyStoreOrderStatus(status: string): TourismOrderStatus {
  switch (status) {
    case "pending":
    case "confirmed":
    case "processing":
    case "completed":
    case "cancelled":
      return status;
    case "refunded":
      return TOURISM_ORDER_STATUSES.REFUNDED;
    default:
      invalidContract(`unsupported legacy store order status: ${status}`);
  }
}

export function mapLegacyReservationStatus(status: string): TourismReservationStatus {
  switch (status) {
    case "pending":
    case "confirmed":
    case "cancelled":
    case "completed":
    case "refunded":
    case "failed":
      return status;
    default:
      invalidContract(`unsupported legacy reservation status: ${status}`);
  }
}

export function mapLegacyPaymentStatus(status: string): TourismPaymentStatus {
  switch (status) {
    case "pending":
      return TOURISM_PAYMENT_STATUSES.PENDING;
    case "approved":
    case "authorized":
      return TOURISM_PAYMENT_STATUSES.AUTHORIZED;
    case "paid":
    case "confirmed":
      return TOURISM_PAYMENT_STATUSES.CONFIRMED;
    case "overdue":
      return TOURISM_PAYMENT_STATUSES.OVERDUE;
    case "failed":
      return TOURISM_PAYMENT_STATUSES.FAILED;
    case "cancelled":
      return TOURISM_PAYMENT_STATUSES.CANCELLED;
    case "refunded":
      return TOURISM_PAYMENT_STATUSES.REFUNDED;
    case "charged_back":
      return TOURISM_PAYMENT_STATUSES.CHARGED_BACK;
    default:
      invalidContract(`unsupported legacy payment status: ${status}`);
  }
}

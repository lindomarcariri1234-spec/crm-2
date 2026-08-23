import {
  validateIdentifier,
  validateMoney,
  validateTenantId,
  validateTourismIdempotencyKey,
  type TourismMoney,
} from "./tourism-domain.js";

export const TOURISM_EVENT_TYPES = {
  CHECKOUT_STARTED: "tourism.checkout.started",
  ORDER_CREATED: "tourism.order.created",
  RESERVATION_HELD: "tourism.reservation.held",
  RESERVATION_CONFIRMED: "tourism.reservation.confirmed",
  RESERVATION_CANCELLED: "tourism.reservation.cancelled",
  PAYMENT_CONFIRMED: "tourism.payment.confirmed",
  PAYMENT_REFUNDED: "tourism.payment.refunded",
  COMMISSION_EARNED: "tourism.commission.earned",
  BENEFIT_GRANTED: "tourism.benefit.granted",
  COMMUNICATION_REQUESTED: "tourism.communication.requested",
} as const;

export type TourismEventType = (typeof TOURISM_EVENT_TYPES)[keyof typeof TOURISM_EVENT_TYPES];

export interface TourismEventDataMap {
  [TOURISM_EVENT_TYPES.CHECKOUT_STARTED]: {
    readonly orderId: string;
    readonly channel: "crm" | "storefront" | "mobile" | "partner" | "api";
  };
  [TOURISM_EVENT_TYPES.ORDER_CREATED]: {
    readonly orderId: string;
    readonly lineIds: readonly string[];
  };
  [TOURISM_EVENT_TYPES.RESERVATION_HELD]: {
    readonly reservationId: string;
    readonly offerId: string;
    readonly quantity: number;
    readonly heldUntil: string;
  };
  [TOURISM_EVENT_TYPES.RESERVATION_CONFIRMED]: {
    readonly reservationId: string;
    readonly orderId: string;
  };
  [TOURISM_EVENT_TYPES.RESERVATION_CANCELLED]: {
    readonly reservationId: string;
    readonly reason: string;
  };
  [TOURISM_EVENT_TYPES.PAYMENT_CONFIRMED]: {
    readonly paymentId: string;
    readonly orderId: string;
    readonly amount: TourismMoney;
  };
  [TOURISM_EVENT_TYPES.PAYMENT_REFUNDED]: {
    readonly paymentId: string;
    readonly orderId: string;
    readonly amount: TourismMoney;
    readonly reason: string;
  };
  [TOURISM_EVENT_TYPES.COMMISSION_EARNED]: {
    readonly commissionId: string;
    readonly recipientPartyId: string;
    readonly amount: TourismMoney;
  };
  [TOURISM_EVENT_TYPES.BENEFIT_GRANTED]: {
    readonly benefitId: string;
    readonly beneficiaryPartyId: string;
    readonly type: "promotional_bonus" | "loyalty_points" | "wallet_credit" | "cashback" | "partner_benefit";
  };
  [TOURISM_EVENT_TYPES.COMMUNICATION_REQUESTED]: {
    readonly communicationId: string;
    readonly channel: "email" | "whatsapp" | "push" | "sms";
    /** Opaque recipient reference; never put a phone or e-mail in the event. */
    readonly recipientRef: string;
    readonly template: string;
  };
}

export interface TourismEventMetadata {
  readonly eventId: string;
  readonly eventVersion: 1;
  readonly occurredAt: string;
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly idempotencyKey: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly actorId?: string;
}

export interface TourismDomainEvent<TType extends TourismEventType = TourismEventType> {
  readonly type: TType;
  readonly metadata: TourismEventMetadata;
  readonly data: TourismEventDataMap[TType];
}

export interface CreateTourismEventInput<TType extends TourismEventType> {
  readonly type: TType;
  readonly eventId: string;
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /**
   * Required. It must name a single business effect, not merely an event type.
   * For example, payment events use a payment aggregate and provider event ID.
   */
  readonly idempotencyKey: string;
  readonly occurredAt?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly actorId?: string;
  readonly data: TourismEventDataMap[TType];
}

/**
 * Creates the stable envelope used by synchronous handlers and future
 * outbox/queue adapters. The event itself is immutable; retries reuse the
 * supplied idempotency key and do not invent a second business effect.
 */
export function createTourismEvent<TType extends TourismEventType>(
  input: CreateTourismEventInput<TType>,
): TourismDomainEvent<TType> {
  if (!Object.values(TOURISM_EVENT_TYPES).includes(input.type)) {
    throw new Error(`unsupported tourism event type: ${String(input.type)}`);
  }
  validateIdentifier(input.eventId, "eventId");
  validateTenantId(input.tenantId);
  validateIdentifier(input.aggregateType, "aggregateType");
  validateIdentifier(input.aggregateId, "aggregateId");
  if (input.correlationId !== undefined) validateIdentifier(input.correlationId, "correlationId");
  if (input.causationId !== undefined) validateIdentifier(input.causationId, "causationId");
  if (input.actorId !== undefined) validateIdentifier(input.actorId, "actorId");

  validateTourismIdempotencyKey(input.idempotencyKey, {
    tenantId: input.tenantId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    operation: input.type,
  });
  validateEventData(input.type, input.data);

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new Error("occurredAt must be an ISO-compatible timestamp");
  }

  return {
    type: input.type,
    metadata: {
      eventId: input.eventId,
      eventVersion: 1,
      occurredAt,
      tenantId: input.tenantId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      idempotencyKey: input.idempotencyKey,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
      ...(input.actorId ? { actorId: input.actorId } : {}),
    },
    data: input.data,
  };
}

function validateTimestamp(value: unknown, field: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-compatible timestamp`);
  }
}

function validatePositiveQuantity(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function validateEventData(type: TourismEventType, data: unknown): void {
  if (!data || typeof data !== "object") throw new Error(`${type} data must be an object`);
  const value = data as Record<string, unknown>;

  switch (type) {
    case TOURISM_EVENT_TYPES.CHECKOUT_STARTED:
      validateIdentifier(value.orderId, "data.orderId");
      if (!["crm", "storefront", "mobile", "partner", "api"].includes(String(value.channel))) {
        throw new Error("data.channel is not a supported checkout channel");
      }
      return;
    case TOURISM_EVENT_TYPES.ORDER_CREATED:
      validateIdentifier(value.orderId, "data.orderId");
      if (!Array.isArray(value.lineIds) || value.lineIds.length === 0) {
        throw new Error("data.lineIds must contain at least one line");
      }
      value.lineIds.forEach((lineId) => validateIdentifier(lineId, "data.lineIds[]"));
      return;
    case TOURISM_EVENT_TYPES.RESERVATION_HELD:
      validateIdentifier(value.reservationId, "data.reservationId");
      validateIdentifier(value.offerId, "data.offerId");
      validatePositiveQuantity(value.quantity, "data.quantity");
      validateTimestamp(value.heldUntil, "data.heldUntil");
      return;
    case TOURISM_EVENT_TYPES.RESERVATION_CONFIRMED:
      validateIdentifier(value.reservationId, "data.reservationId");
      validateIdentifier(value.orderId, "data.orderId");
      return;
    case TOURISM_EVENT_TYPES.RESERVATION_CANCELLED:
      validateIdentifier(value.reservationId, "data.reservationId");
      validateIdentifier(value.reason, "data.reason");
      return;
    case TOURISM_EVENT_TYPES.PAYMENT_CONFIRMED:
    case TOURISM_EVENT_TYPES.PAYMENT_REFUNDED:
      validateIdentifier(value.paymentId, "data.paymentId");
      validateIdentifier(value.orderId, "data.orderId");
      validateMoney(value.amount, "data.amount");
      if (type === TOURISM_EVENT_TYPES.PAYMENT_REFUNDED) validateIdentifier(value.reason, "data.reason");
      return;
    case TOURISM_EVENT_TYPES.COMMISSION_EARNED:
      validateIdentifier(value.commissionId, "data.commissionId");
      validateIdentifier(value.recipientPartyId, "data.recipientPartyId");
      validateMoney(value.amount, "data.amount");
      return;
    case TOURISM_EVENT_TYPES.BENEFIT_GRANTED:
      validateIdentifier(value.benefitId, "data.benefitId");
      validateIdentifier(value.beneficiaryPartyId, "data.beneficiaryPartyId");
      if (!["promotional_bonus", "loyalty_points", "wallet_credit", "cashback", "partner_benefit"].includes(String(value.type))) {
        throw new Error("data.type is not a supported benefit type");
      }
      return;
    case TOURISM_EVENT_TYPES.COMMUNICATION_REQUESTED:
      validateIdentifier(value.communicationId, "data.communicationId");
      validateIdentifier(value.recipientRef, "data.recipientRef");
      validateIdentifier(value.template, "data.template");
      if (!["email", "whatsapp", "push", "sms"].includes(String(value.channel))) {
        throw new Error("data.channel is not a supported communication channel");
      }
      return;
  }
}

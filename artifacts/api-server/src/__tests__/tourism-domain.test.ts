import { describe, expect, it } from "vitest";
import {
  TOURISM_EVENT_TYPES,
  assertSameTenant,
  assertTenantAccess,
  buildTourismIdempotencyKey,
  createTourismEvent,
  mapLegacyPaymentStatus,
  mapLegacyReservationStatus,
  TourismDomainError,
  validateMoney,
} from "@workspace/shared";

describe("canonical tourism domain contracts", () => {
  it("keeps entity references inside one tenant", () => {
    expect(assertSameTenant({ id: "order_1", tenantId: "tenant_1" }, { id: "line_1", tenantId: "tenant_1" })).toBe("tenant_1");
    expect(() => assertSameTenant({ id: "order_1", tenantId: "tenant_1" }, { id: "line_1", tenantId: "tenant_2" })).toThrow(TourismDomainError);
  });

  it("rejects cross-tenant access unless the context is an explicit platform admin", () => {
    expect(() => assertTenantAccess({ actorId: "user_1", tenantId: "tenant_1", role: "agencia", authorizationScope: "platform" }, "tenant_2")).toThrow(
      TourismDomainError,
    );
    expect(() => assertTenantAccess({ actorId: "admin_1", tenantId: null, role: "superadmin", authorizationScope: "platform" }, "tenant_2")).not.toThrow();
  });

  it("creates stable idempotency keys from opaque identifiers", () => {
    const first = buildTourismIdempotencyKey({
      tenantId: "tenant_1",
      aggregateType: "order",
      aggregateId: "order_1",
      operation: "payment-confirmed",
      effectId: "payment_1",
    });
    const second = buildTourismIdempotencyKey({
      tenantId: "tenant_1",
      aggregateType: "order",
      aggregateId: "order_1",
      operation: "payment-confirmed",
      effectId: "payment_1",
    });

    expect(first).toBe(second);
    expect(first).toBe("tourism:tenant_1:order:order_1:payment-confirmed:payment_1");
    expect(() =>
      buildTourismIdempotencyKey({
        tenantId: "tenant_1",
        aggregateType: "order",
        aggregateId: "12345678901",
        operation: "payment-confirmed",
        effectId: "payment_1",
      }),
    ).toThrow(TourismDomainError);
    expect(() =>
      buildTourismIdempotencyKey({
        tenantId: "tenant_1",
        aggregateType: "payment",
        aggregateId: "4242424242424242",
        operation: TOURISM_EVENT_TYPES.PAYMENT_CONFIRMED,
        effectId: "stripe_evt_1",
      }),
    ).toThrow(TourismDomainError);
  });

  it("builds a versioned event envelope with a deterministic fallback key", () => {
    const event = createTourismEvent({
      type: TOURISM_EVENT_TYPES.PAYMENT_CONFIRMED,
      eventId: "evt_1",
      tenantId: "tenant_1",
      aggregateType: "payment",
      aggregateId: "payment_1",
      idempotencyKey: buildTourismIdempotencyKey({
        tenantId: "tenant_1",
        aggregateType: "payment",
        aggregateId: "payment_1",
        operation: TOURISM_EVENT_TYPES.PAYMENT_CONFIRMED,
        effectId: "stripe_evt_1",
      }),
      data: {
        paymentId: "payment_1",
        orderId: "order_1",
        amount: { amount: "125.50", currency: "BRL" },
      },
    });

    expect(event.metadata.eventVersion).toBe(1);
    expect(event.metadata.idempotencyKey).toBe("tourism:tenant_1:payment:payment_1:tourism.payment.confirmed:stripe_evt_1");
    expect(event.data.amount).toEqual({ amount: "125.50", currency: "BRL" });
  });

  it("does not deduplicate distinct installments for the same order", () => {
    const first = buildTourismIdempotencyKey({
      tenantId: "tenant_1",
      aggregateType: "payment",
      aggregateId: "payment_1",
      operation: TOURISM_EVENT_TYPES.PAYMENT_CONFIRMED,
      effectId: "stripe_evt_1",
    });
    const second = buildTourismIdempotencyKey({
      tenantId: "tenant_1",
      aggregateType: "payment",
      aggregateId: "payment_2",
      operation: TOURISM_EVENT_TYPES.PAYMENT_CONFIRMED,
      effectId: "stripe_evt_2",
    });

    expect(first).not.toBe(second);
  });

  it("rejects raw card-like values even when a caller bypasses the key builder", () => {
    expect(() =>
      createTourismEvent({
        type: TOURISM_EVENT_TYPES.PAYMENT_CONFIRMED,
        eventId: "evt_2",
        tenantId: "tenant_1",
        aggregateType: "payment",
        aggregateId: "payment_1",
        idempotencyKey: "tourism:tenant_1:payment:payment_1:tourism.payment.confirmed:4242424242424242",
        data: {
          paymentId: "payment_1",
          orderId: "order_1",
          amount: { amount: "125.50", currency: "BRL" },
        },
      }),
    ).toThrow(TourismDomainError);
  });

  it("rejects formatted CPF, card, and phone values from event and key metadata", () => {
    expect(() =>
      buildTourismIdempotencyKey({
        tenantId: "tenant_1",
        aggregateType: "payment",
        aggregateId: "123.456.789-09",
        operation: TOURISM_EVENT_TYPES.PAYMENT_CONFIRMED,
        effectId: "stripe_evt_1",
      }),
    ).toThrow(TourismDomainError);
    expect(() =>
      buildTourismIdempotencyKey({
        tenantId: "tenant_1",
        aggregateType: "payment",
        aggregateId: "payment_1",
        operation: TOURISM_EVENT_TYPES.PAYMENT_CONFIRMED,
        effectId: "4242-4242-4242-4242",
      }),
    ).toThrow(TourismDomainError);
    expect(() =>
      createTourismEvent({
        type: TOURISM_EVENT_TYPES.COMMUNICATION_REQUESTED,
        eventId: "evt_3",
        tenantId: "tenant_1",
        aggregateType: "communication",
        aggregateId: "communication_1",
        idempotencyKey: "tourism:tenant_1:communication:communication_1:tourism.communication.requested:message_1",
        data: {
          communicationId: "communication_1",
          channel: "whatsapp",
          recipientRef: "88-98888-7777",
          template: "reservation_reminder",
        },
      }),
    ).toThrow(TourismDomainError);
  });

  it("maps legacy payment and reservation statuses without dropping failed or paid states", () => {
    expect(mapLegacyPaymentStatus("paid")).toBe("confirmed");
    expect(mapLegacyPaymentStatus("approved")).toBe("authorized");
    expect(mapLegacyPaymentStatus("overdue")).toBe("overdue");
    expect(mapLegacyReservationStatus("failed")).toBe("failed");
  });

  it("accepts decimal money strings and rejects floating-point amounts", () => {
    expect(() => validateMoney({ amount: "125.50", currency: "BRL" })).not.toThrow();
    expect(() => validateMoney({ amount: 125.5, currency: "BRL" })).toThrow(TourismDomainError);
    expect(() => validateMoney({ amount: "1.23456", currency: "BRL" })).toThrow(TourismDomainError);
  });
});
import { describe, expect, it } from "vitest";
import { ReferenceDistributionAdapter } from "../services/distribution/reference-adapter.js";

describe("ReferenceDistributionAdapter", () => {
  const tenant = { tenantId: "tenant-distribution-test" };

  it("returns normalized test offers and validates dates", async () => {
    const adapter = new ReferenceDistributionAdapter();
    const tours = await adapter.search({ kind: "tour", date: "2026-08-23" }, tenant);

    expect(tours).toHaveLength(1);
    expect(tours[0]).toMatchObject({
      externalId: "ref-cariri-tour",
      kind: "tour",
      currency: "BRL",
      availableUnits: 12,
    });
    await expect(adapter.search({ date: "23/08/2026" }, tenant)).rejects.toMatchObject({ code: "INVALID_DATE" });
  });

  it("issues a normalized quote using the gateway's tenant-scoped availability", async () => {
    const adapter = new ReferenceDistributionAdapter();
    const quote = await adapter.quote(
      { offerExternalId: "ref-cariri-transfer", quantity: 2 },
      { ...tenant, availableUnits: 3 },
    );

    expect(quote).toMatchObject({
      offerExternalId: "ref-cariri-transfer",
      quantity: 2,
      unitPrice: 95,
      totalPrice: 190,
      availableUnits: 3,
    });
    await expect(adapter.quote(
      { offerExternalId: "ref-cariri-transfer", quantity: 4 },
      { ...tenant, availableUnits: 3 },
    )).rejects.toMatchObject({ code: "SOLD_OUT" });
  });

  it("returns normalized booking and cancellation responses without process-local state", async () => {
    const adapter = new ReferenceDistributionAdapter();
    const order = await adapter.book({
      quoteId: "quote-persisted-by-gateway",
      offerExternalId: "ref-cariri-tour",
      quantity: 2,
      customer: { name: "Cliente de Teste", email: "cliente@example.com" },
      idempotencyKey: "booking-reference-0001",
    }, tenant);
    const cancelled = await adapter.cancel({ externalOrderId: order.externalOrderId }, tenant);

    expect(order).toMatchObject({ status: "confirmed", voucherCode: expect.stringMatching(/^REF-/) });
    expect(cancelled).toMatchObject({ externalOrderId: order.externalOrderId, status: "cancelled" });
    await expect(adapter.getOrder(order.externalOrderId, tenant)).rejects.toMatchObject({ code: "ORDER_LOOKUP_LOCAL" });
  });
});
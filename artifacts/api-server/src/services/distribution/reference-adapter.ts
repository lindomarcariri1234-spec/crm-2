import {
  DistributionProviderError,
  type DistributionAdapter,
  type DistributionBookingRequest,
  type DistributionCancelRequest,
  type DistributionOperationContext,
  type DistributionQuoteRequest,
  type DistributionSearchRequest,
} from "./contracts";
import { randomUUID } from "node:crypto";

type ReferenceOrder = Awaited<ReturnType<DistributionAdapter["book"]>>;

const offers = [
  {
    externalId: "ref-cariri-tour",
    kind: "tour" as const,
    title: "Rota Cultural do Cariri",
    description: "Experiência de teste para validar o ciclo de distribuição.",
    origin: "Juazeiro do Norte",
    destination: "Cariri",
    price: 180,
    currency: "BRL",
    availableUnits: 12,
    cancellationPolicy: "Cancelamento gratuito até 24 horas antes.",
    metadata: { provider: "reference", testOnly: true, durationHours: 8 },
  },
  {
    externalId: "ref-cariri-transfer",
    kind: "transfer" as const,
    title: "Transfer Aeroporto–Centro",
    description: "Transfer de referência sem data obrigatória.",
    origin: "Aeroporto de Juazeiro do Norte",
    destination: "Centro do Crato",
    price: 95,
    currency: "BRL",
    availableUnits: 8,
    cancellationPolicy: "Cancelamento gratuito até 2 horas antes.",
    metadata: { provider: "reference", testOnly: true, vehicle: "van" },
  },
];

function validUntil(): string {
  return new Date(Date.now() + 15 * 60_000).toISOString();
}

function findOffer(externalId: string) {
  const offer = offers.find((item) => item.externalId === externalId);
  if (!offer) throw new DistributionProviderError("Oferta não encontrada.", "OFFER_NOT_FOUND", { statusCode: 404 });
  return offer;
}

export class ReferenceDistributionAdapter implements DistributionAdapter {
  readonly type = "distribution_reference";

  async search(request: DistributionSearchRequest, _context: DistributionOperationContext) {
    if (request.date && !/^\d{4}-\d{2}-\d{2}$/.test(request.date)) {
      throw new DistributionProviderError("A data deve usar o formato YYYY-MM-DD.", "INVALID_DATE", { statusCode: 400 });
    }
    return offers
      .filter((offer) => !request.kind || offer.kind === request.kind)
      .filter((offer) => !request.origin || offer.origin.toLowerCase().includes(request.origin.toLowerCase()))
      .filter((offer) => !request.destination || offer.destination.toLowerCase().includes(request.destination.toLowerCase()))
      .map((offer) => ({ ...offer, priceValidUntil: validUntil() }));
  }

  async quote(request: DistributionQuoteRequest, context: DistributionOperationContext) {
    const offer = findOffer(request.offerExternalId);
    const availableUnits = context.availableUnits ?? offer.availableUnits;
    if (!Number.isInteger(request.quantity) || request.quantity < 1) {
      throw new DistributionProviderError("A quantidade deve ser um inteiro positivo.", "INVALID_QUANTITY", { statusCode: 400 });
    }
    if (availableUnits < request.quantity) {
      throw new DistributionProviderError("Oferta sem disponibilidade para a quantidade solicitada.", "SOLD_OUT", { statusCode: 409 });
    }
    const quoteId = `ref-quote-${randomUUID()}`;
    const expiresAt = validUntil();
    return {
      quoteId,
      offerExternalId: offer.externalId,
      quantity: request.quantity,
      unitPrice: offer.price,
      totalPrice: offer.price * request.quantity,
      currency: offer.currency,
      validUntil: expiresAt,
      availableUnits,
    };
  }

  async availability(request: DistributionQuoteRequest, context: DistributionOperationContext) {
    findOffer(request.offerExternalId);
    const offer = findOffer(request.offerExternalId);
    return { availableUnits: context.availableUnits ?? offer.availableUnits, checkedAt: new Date().toISOString() };
  }

  async book(request: DistributionBookingRequest, context: DistributionOperationContext) {
    const offer = findOffer(request.offerExternalId);
    // The gateway validates the persisted tenant-bound quote and atomically
    // reserves capacity before this simulated provider confirmation.
    const order: ReferenceOrder = {
      externalOrderId: request.idempotencyKey,
      status: "confirmed",
      voucherCode: `REF-${request.idempotencyKey.slice(-8).toUpperCase()}`,
      offerExternalId: offer.externalId,
      quantity: request.quantity,
      totalPrice: offer.price * request.quantity,
      currency: offer.currency,
    };
    return order;
  }

  async cancel(request: DistributionCancelRequest, _context: DistributionOperationContext): Promise<ReferenceOrder> {
    return {
      externalOrderId: request.externalOrderId,
      status: "cancelled" as const,
      offerExternalId: "",
      quantity: 0,
      totalPrice: 0,
      currency: "BRL",
    };
  }

  async getOrder(_externalOrderId: string, _context: DistributionOperationContext): Promise<ReferenceOrder> {
    throw new DistributionProviderError(
      "A consulta de pedidos do adaptador de referência é resolvida pelo registro local da plataforma.",
      "ORDER_LOOKUP_LOCAL",
      { statusCode: 404 },
    );
  }
}

export const referenceDistributionAdapter = new ReferenceDistributionAdapter();
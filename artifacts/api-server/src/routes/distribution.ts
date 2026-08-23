import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  distributionBookingsTable,
  distributionOffersTable,
  distributionOperationsTable,
  storesTable,
} from "@workspace/db";
import { ADMIN_ROLES, requireAuth } from "../lib/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import {
  getDistributionHealth,
  persistDistributionOffers,
  runDistributionOperation,
} from "../services/distribution/gateway";
import { DistributionProviderError } from "../services/distribution/contracts";

const router = Router();

const searchSchema = z.object({
  kind: z.enum(["transport", "lodging", "tour", "ticket", "insurance", "transfer"]).optional(),
  origin: z.string().trim().max(160).optional(),
  destination: z.string().trim().max(160).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  passengers: z.number().int().min(1).max(20).optional(),
});
const quoteSchema = z.object({
  quantity: z.number().int().min(1).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const bookingSchema = quoteSchema.extend({
  quoteId: z.string().trim().min(1).max(200),
  customer: z.object({
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(30).optional(),
  }),
});
const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

function idempotencyKey(req: Request, prefix: string): string {
  const raw = req.header("idempotency-key")?.trim();
  if (raw && /^[A-Za-z0-9._:-]{8,160}$/.test(raw)) return raw;
  return `${prefix}:${crypto.randomUUID()}`;
}

async function requireDistributionAdmin(req: Request, res: Response, next: NextFunction) {
  const me = await requireAuth(req, res);
  if (!me) return null;
  if (!ADMIN_ROLES.includes(me.role)) {
    next(new ForbiddenError("Apenas administradores podem operar integrações de distribuição.", "FORBIDDEN_ROLE"));
    return null;
  }
  return me;
}

async function findOffer(tenantId: string, offerId: string) {
  const [offer] = await db.select().from(distributionOffersTable).where(and(
    eq(distributionOffersTable.id, offerId),
    eq(distributionOffersTable.tenantId, tenantId),
    eq(distributionOffersTable.isActive, true),
  )).limit(1);
  if (!offer) throw new NotFoundError("Oferta integrada não encontrada.", "DISTRIBUTION_OFFER_NOT_FOUND");
  return offer;
}

async function ensurePersistedBooking(
  tenantId: string,
  offerId: string,
  order: {
    externalOrderId: string;
    status: "confirmed" | "pending" | "cancelled";
    quantity: number;
    voucherCode?: string;
  },
): Promise<void> {
  await db.insert(distributionBookingsTable).values({
    id: crypto.randomUUID(),
    tenantId,
    integrationType: "distribution_reference",
    externalOrderId: order.externalOrderId,
    offerId,
    quantity: order.quantity,
    status: order.status,
    voucherCode: order.voucherCode ?? null,
  }).onConflictDoNothing();
}

router.get("/distribution/health", async (req, res, next) => {
  try {
    const me = await requireDistributionAdmin(req, res, next);
    if (!me) return;
    res.json(await getDistributionHealth(me.tenantId));
  } catch (error) {
    next(error);
  }
});

router.get("/distribution/offers", async (req, res, next) => {
  try {
    const me = await requireDistributionAdmin(req, res, next);
    if (!me) return;
    const offers = await db.select().from(distributionOffersTable).where(and(
      eq(distributionOffersTable.tenantId, me.tenantId),
      eq(distributionOffersTable.isActive, true),
    )).orderBy(desc(distributionOffersTable.lastSyncedAt));
    res.json(offers.map((offer) => ({
      ...offer,
      price: Number(offer.price),
      priceValidUntil: offer.priceValidUntil?.toISOString() ?? null,
      lastSyncedAt: offer.lastSyncedAt?.toISOString() ?? null,
    })));
  } catch (error) {
    next(error);
  }
});

router.post("/distribution/search", async (req, res, next) => {
  try {
    const me = await requireDistributionAdmin(req, res, next);
    if (!me) return;
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Critérios de busca inválidos.", "VALIDATION_ERROR");
    const key = idempotencyKey(req, "distribution-search");
    const result = await runDistributionOperation({
      tenantId: me.tenantId,
      operation: "search",
      idempotencyKey: key,
      request: parsed.data,
      execute: (adapter) => adapter.search(parsed.data, { tenantId: me.tenantId }),
    });
    await persistDistributionOffers(me.tenantId, result.response);
    res.json({ offers: result.response, operationId: result.operationId, replayed: result.replayed });
  } catch (error) {
    next(error);
  }
});

router.post("/distribution/offers/:offerId/quote", async (req, res, next) => {
  try {
    const me = await requireDistributionAdmin(req, res, next);
    if (!me) return;
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Dados de cotação inválidos.", "VALIDATION_ERROR");
    const offer = await findOffer(me.tenantId, req.params.offerId);
    const key = idempotencyKey(req, "distribution-quote");
    const result = await runDistributionOperation({
      tenantId: me.tenantId,
      operation: "quote",
      idempotencyKey: key,
      request: { externalId: offer.externalId, ...parsed.data },
      offerId: offer.id,
      execute: (adapter) => adapter.quote(
        { offerExternalId: offer.externalId, ...parsed.data },
        { tenantId: me.tenantId, availableUnits: offer.availableUnits ?? 0 },
      ),
    });
    await db.update(distributionOperationsTable).set({ externalId: result.response.quoteId }).where(
      eq(distributionOperationsTable.id, result.operationId),
    );
    res.json({ quote: result.response, operationId: result.operationId, replayed: result.replayed });
  } catch (error) {
    next(error);
  }
});

router.post("/distribution/offers/:offerId/availability", async (req, res, next) => {
  try {
    const me = await requireDistributionAdmin(req, res, next);
    if (!me) return;
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Dados de disponibilidade inválidos.", "VALIDATION_ERROR");
    const offer = await findOffer(me.tenantId, req.params.offerId);
    const key = idempotencyKey(req, "distribution-availability");
    const result = await runDistributionOperation({
      tenantId: me.tenantId,
      operation: "availability",
      idempotencyKey: key,
      request: { externalId: offer.externalId, ...parsed.data },
      offerId: offer.id,
      execute: (adapter) => adapter.availability(
        { offerExternalId: offer.externalId, ...parsed.data },
        { tenantId: me.tenantId, availableUnits: offer.availableUnits ?? 0 },
      ),
    });
    res.json({ availability: result.response, operationId: result.operationId, replayed: result.replayed });
  } catch (error) {
    next(error);
  }
});

router.post("/distribution/offers/:offerId/book", async (req, res, next) => {
  try {
    const me = await requireDistributionAdmin(req, res, next);
    if (!me) return;
    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Dados de reserva inválidos.", "VALIDATION_ERROR");
    const key = req.header("idempotency-key")?.trim();
    if (!key || !/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
      throw new ValidationError("Informe uma chave de idempotência válida para reservar.", "IDEMPOTENCY_KEY_REQUIRED");
    }
    const offer = await findOffer(me.tenantId, req.params.offerId);
    const operationRequest = { externalId: offer.externalId, ...parsed.data };
    const requestHash = crypto.createHash("sha256").update(JSON.stringify(operationRequest)).digest("hex");
    const [previousBooking] = await db.select({
      id: distributionOperationsTable.id,
      requestHash: distributionOperationsTable.requestHash,
      status: distributionOperationsTable.status,
      response: distributionOperationsTable.response,
    }).from(distributionOperationsTable).where(and(
      eq(distributionOperationsTable.tenantId, me.tenantId),
      eq(distributionOperationsTable.integrationType, "distribution_reference"),
      eq(distributionOperationsTable.idempotencyKey, key),
    )).limit(1);
    if (previousBooking?.requestHash !== undefined && previousBooking.requestHash !== requestHash) {
      throw new ConflictError("A chave de idempotência já foi usada para outra operação.", "IDEMPOTENCY_KEY_REUSED");
    }
    if (previousBooking?.status === "succeeded" && previousBooking.response) {
      await ensurePersistedBooking(me.tenantId, offer.id, previousBooking.response as {
        externalOrderId: string;
        status: "confirmed" | "pending" | "cancelled";
        quantity: number;
        voucherCode?: string;
      });
      res.json({ order: previousBooking.response, operationId: previousBooking.id, replayed: true });
      return;
    }
    const [quoteOperation] = await db.select({
      response: distributionOperationsTable.response,
    }).from(distributionOperationsTable).where(and(
      eq(distributionOperationsTable.tenantId, me.tenantId),
      eq(distributionOperationsTable.operation, "quote"),
      eq(distributionOperationsTable.externalId, parsed.data.quoteId),
      eq(distributionOperationsTable.status, "succeeded"),
    )).limit(1);
    const quote = quoteOperation?.response as {
      offerExternalId?: string;
      quantity?: number;
      validUntil?: string;
    } | undefined;
    if (
      !quote ||
      quote.offerExternalId !== offer.externalId ||
      quote.quantity !== parsed.data.quantity ||
      !quote.validUntil ||
      new Date(quote.validUntil).getTime() <= Date.now()
    ) {
      throw new ValidationError("A cotação é inválida ou expirou. Faça uma nova cotação.", "QUOTE_INVALID_OR_EXPIRED");
    }
    const result = await runDistributionOperation({
      tenantId: me.tenantId,
      operation: "book",
      idempotencyKey: key,
      request: operationRequest,
      offerId: offer.id,
      execute: (adapter) => adapter.book({
        quoteId: parsed.data.quoteId,
        offerExternalId: offer.externalId,
        quantity: parsed.data.quantity,
        customer: parsed.data.customer,
        idempotencyKey: key,
      }, { tenantId: me.tenantId, availableUnits: offer.availableUnits ?? 0 }),
      finalize: async (tx, order, operationId) => {
        const [reserved] = await tx.update(distributionOffersTable).set({
          availableUnits: sql`${distributionOffersTable.availableUnits} - ${parsed.data.quantity}`,
          updatedAt: new Date(),
        }).where(and(
          eq(distributionOffersTable.id, offer.id),
          eq(distributionOffersTable.tenantId, me.tenantId),
          gte(distributionOffersTable.availableUnits, parsed.data.quantity),
        )).returning({ id: distributionOffersTable.id });
        if (!reserved) {
          throw new DistributionProviderError(
            "A oferta ficou indisponível antes da reserva.",
            "SOLD_OUT",
            { statusCode: 409 },
          );
        }
        await tx.insert(distributionBookingsTable).values({
          id: crypto.randomUUID(),
          tenantId: me.tenantId,
          integrationType: "distribution_reference",
          externalOrderId: order.externalOrderId,
          offerId: offer.id,
          quantity: order.quantity,
          status: order.status,
          voucherCode: order.voucherCode ?? null,
        }).onConflictDoNothing();
        await tx.update(distributionOperationsTable).set({ externalId: order.externalOrderId }).where(
          eq(distributionOperationsTable.id, operationId),
        );
      },
    });
    await ensurePersistedBooking(me.tenantId, offer.id, result.response);
    res.status(result.replayed ? 200 : 201).json({ order: result.response, operationId: result.operationId, replayed: result.replayed });
  } catch (error) {
    next(error);
  }
});

router.post("/distribution/orders/:externalOrderId/cancel", async (req, res, next) => {
  try {
    const me = await requireDistributionAdmin(req, res, next);
    if (!me) return;
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Dados de cancelamento inválidos.", "VALIDATION_ERROR");
    const key = req.header("idempotency-key")?.trim();
    if (!key || !/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
      throw new ValidationError("Informe uma chave de idempotência válida para cancelar.", "IDEMPOTENCY_KEY_REQUIRED");
    }
    const [booking] = await db.select().from(distributionBookingsTable).where(and(
      eq(distributionBookingsTable.tenantId, me.tenantId),
      eq(distributionBookingsTable.integrationType, "distribution_reference"),
      eq(distributionBookingsTable.externalOrderId, req.params.externalOrderId),
    )).limit(1);
    if (!booking) throw new NotFoundError("Pedido externo não encontrado.", "DISTRIBUTION_ORDER_NOT_FOUND");
    const [bookingOffer] = await db.select().from(distributionOffersTable).where(and(
      eq(distributionOffersTable.id, booking.offerId),
      eq(distributionOffersTable.tenantId, me.tenantId),
    )).limit(1);
    if (!bookingOffer) throw new NotFoundError("Oferta vinculada ao pedido não encontrada.", "DISTRIBUTION_OFFER_NOT_FOUND");
    const normalizedCancelledOrder = {
      externalOrderId: booking.externalOrderId,
      status: "cancelled" as const,
      voucherCode: booking.voucherCode ?? undefined,
      offerExternalId: bookingOffer.externalId,
      quantity: booking.quantity,
      totalPrice: Number(bookingOffer.price) * booking.quantity,
      currency: bookingOffer.currency,
    };
    if (booking.status === "cancelled") {
      res.json({
        order: normalizedCancelledOrder,
        replayed: true,
      });
      return;
    }
    const result = await runDistributionOperation({
      tenantId: me.tenantId,
      operation: "cancel",
      idempotencyKey: key,
      request: { externalOrderId: req.params.externalOrderId, ...parsed.data },
      execute: (adapter) => adapter.cancel({ externalOrderId: req.params.externalOrderId, ...parsed.data }, { tenantId: me.tenantId }),
      finalize: async (tx, _order, operationId) => {
        const [cancelled] = await tx.update(distributionBookingsTable).set({
          status: "cancelled",
          cancelledAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(distributionBookingsTable.id, booking.id),
          eq(distributionBookingsTable.status, "confirmed"),
        )).returning({ id: distributionBookingsTable.id });
        if (cancelled) {
          await tx.update(distributionOffersTable).set({
            availableUnits: sql`${distributionOffersTable.availableUnits} + ${booking.quantity}`,
            updatedAt: new Date(),
          }).where(eq(distributionOffersTable.id, booking.offerId));
        }
        await tx.update(distributionOperationsTable).set({ externalId: booking.externalOrderId }).where(
          eq(distributionOperationsTable.id, operationId),
        );
      },
    });
    res.json({ order: normalizedCancelledOrder, operationId: result.operationId, replayed: result.replayed });
  } catch (error) {
    next(error);
  }
});

router.get("/distribution/operations", async (req, res, next) => {
  try {
    const me = await requireDistributionAdmin(req, res, next);
    if (!me) return;
    const rows = await db.select().from(distributionOperationsTable).where(eq(
      distributionOperationsTable.tenantId,
      me.tenantId,
    )).orderBy(desc(distributionOperationsTable.createdAt)).limit(100);
    res.json(rows.map(({ response: _response, ...row }) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })));
  } catch (error) {
    next(error);
  }
});

// Public catalogue only. Booking stays behind checkout/payment confirmation until a
// contracted provider is installed; the reference adapter must never charge users.
router.get("/public/store/:slug/distribution/offers", async (req, res, next) => {
  try {
    const [store] = await db.select({ tenantId: storesTable.tenantId }).from(storesTable)
      .where(eq(storesTable.slug, req.params.slug)).limit(1);
    if (!store) throw new NotFoundError("Loja não encontrada.", "STORE_NOT_FOUND");
    const offers = await db.select().from(distributionOffersTable).where(and(
      eq(distributionOffersTable.tenantId, store.tenantId),
      eq(distributionOffersTable.isActive, true),
    )).orderBy(desc(distributionOffersTable.lastSyncedAt));
    res.json(offers.map((offer) => ({
      id: offer.id,
      kind: offer.kind,
      title: offer.title,
      description: offer.description,
      origin: offer.origin,
      destination: offer.destination,
      price: Number(offer.price),
      currency: offer.currency,
      priceValidUntil: offer.priceValidUntil?.toISOString() ?? null,
      availableUnits: offer.availableUnits,
      cancellationPolicy: offer.cancellationPolicy,
      source: "external",
      testOnly: offer.integrationType === "distribution_reference",
    })));
  } catch (error) {
    next(error);
  }
});

export default router;
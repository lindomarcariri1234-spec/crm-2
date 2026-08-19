import { Router, type Request, type NextFunction } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { storeOrdersTable, reservationsTable, paymentsTable, storesTable, tripsTable } from "@workspace/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { generateId } from "../lib/id";
import { logger } from "../lib/logger";
import { syncReservationPaymentStatus, paymentExistsForGatewayTx, type DbExecutor } from "../lib/reservation-payments";
import { createReservationsForOrder } from "../services/checkout/create-reservations";
import { broadcastSeatUpdate } from "../lib/realtime";
import { runPostPaymentSideEffects } from "../services/checkout/post-booking";
import { applyOrderInventoryEffects } from "../services/checkout/persist-order";
import { enqueueNewBookingNotificationEmail } from "../queues/email-helpers";
import { decryptOrPassthrough } from "../lib/crypto";
import { PAYMENT_STATUS, RESERVATION_STATUS, STORE_ORDER_STATUS, STORE_PAYMENT_STATUS } from "@workspace/permissions";
import { reverseProductOnlyOrderReferral, reverseTripOrderReferrals } from "../services/checkout/order-referral-reversal";
import { roundMoney } from "../lib/pricing";
import { ValidationError, AppError } from "../lib/errors";

const router = Router();

// Express captures the parsed body via req.body and the raw bytes via
// req.rawBody (see app.ts express.json verify hook). Webhook signature
// checks must use rawBody to avoid normalization differences.
type RawBodyRequest = Request & { rawBody?: Buffer };

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

interface StoreScope {
  storeId: string;
  tenantId: string;
  slug: string;
  mpAccessToken: string | null;
  stripeWebhookSecret: string | null;
}

/**
 * Resolves the store referenced in the webhook URL. Webhook routes are
 * slug-scoped (`/webhooks/<provider>/:storeSlug`) so the handler can pick
 * the right tenant + provider credentials before processing the event,
 * even when multiple stores share the same gateway account.
 */
async function resolveStore(slug: string): Promise<StoreScope | null> {
  if (!slug) return null;
  const [store] = await db
    .select({
      storeId: storesTable.id,
      tenantId: storesTable.tenantId,
      slug: storesTable.slug,
      mpAccessToken: storesTable.mpAccessToken,
      stripeWebhookSecret: storesTable.stripeWebhookSecret,
    })
    .from(storesTable)
    .where(eq(storesTable.slug, slug))
    .limit(1);
  return store ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook
// ─────────────────────────────────────────────────────────────────────────────

interface StripeSignatureParts {
  timestamp: string;
  v1: string[];
}

function parseStripeSignature(header: string | undefined): StripeSignatureParts | null {
  if (!header) return null;
  let timestamp = "";
  const v1: string[] = [];
  for (const piece of header.split(",")) {
    const [k, v] = piece.split("=");
    if (!k || !v) continue;
    if (k.trim() === "t") timestamp = v.trim();
    else if (k.trim() === "v1") v1.push(v.trim());
  }
  if (!timestamp || v1.length === 0) return null;
  return { timestamp, v1 };
}

const STRIPE_TOLERANCE_SECONDS = 300; // 5 minutes — matches Stripe SDK default

function verifyStripeSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  const parsed = parseStripeSignature(header);
  if (!parsed) return false;
  const tsNum = Number(parsed.timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > STRIPE_TOLERANCE_SECONDS) return false;
  const signedPayload = `${parsed.timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return parsed.v1.some((sig) => timingSafeEqualHex(expected, sig));
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

router.post("/webhooks/stripe/:storeSlug", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await resolveStore(req.params["storeSlug"] ?? "");
    if (!store) {
      next(new ValidationError("Unknown store", "VALIDATION_ERROR"));
      return;
    }

    // Prefer the per-store webhook secret; fall back to the global env var for
    // backward compatibility with deployments that have not yet migrated to
    // per-store secrets.
    const secret = process.env["MP_WEBHOOK_SECRET"];

    if (!secret) {
      logger.warn(
        { slug: store.slug },
        "[webhooks/stripe] No webhook secret configured (per-store or global) — rejecting",
      );
      next(new ValidationError("Webhook not configured", "VALIDATION_ERROR"));
      return;
    }

    const rawBody = (req as RawBodyRequest).rawBody;
    if (!rawBody) {
      next(new ValidationError("Missing raw body", "VALIDATION_ERROR"));
      return;
    }

    const sigHeader = req.header("x-signature");
    if (!verifyStripeSignature(rawBody, sigHeader, secret)) {
      logger.warn(
        { sigHeader: sigHeader ? "present" : "missing", slug: store.slug },
        "[webhooks/stripe] Invalid signature",
      );
      next(new ValidationError("Invalid signature", "VALIDATION_ERROR"));
      return;
    }

    const event = req.body as StripeEvent;
    if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
      next(new ValidationError("Malformed event", "VALIDATION_ERROR"));
      return;
    }

    // Process synchronously inside a DB transaction so the order update,
    // payment inserts and reservation re-sync either all succeed or none
    // do. Returning a non-2xx on processing failure asks Stripe to retry.
    try {
      await handleStripeEvent(event, store);
      res.status(200).json({ received: true });
    } catch (err) {
      logger.error(
        { err, eventId: event.id, eventType: event.type, slug: store.slug },
        "[webhooks/stripe] Processing failure — returning 500 so Stripe retries",
      );
      next(err);
    }
  } catch (err) {
    next(err);
  }
});

async function handleStripeEvent(event: StripeEvent, store: StoreScope): Promise<void> {
  const obj = event.data?.object ?? {};

  if (event.type === "payment_intent.succeeded") {
    const paymentIntentId = String(obj["id"] ?? "");
    const amountReceived = Number(obj["amount_received"] ?? obj["amount"] ?? 0) / 100;
    if (!paymentIntentId || amountReceived <= 0) return;
    const result = await db.transaction(async (tx) => {
      return applyGatewayPayment(tx as unknown as DbExecutor, {
        store,
        gateway: "stripe",
        transactionId: paymentIntentId,
        paymentIntentId,
        amount: amountReceived,
        paidAt: new Date(),
      });
    });
    if (result) {
      // Broadcast seat-map updates for each trip whose reservation was just created.
      // This refreshes the admin seat map and boarding panel for any open admin session
      // without requiring a manual page reload. Fire-and-forget; never blocks the webhook.
      for (const tripId of result.tripIds) {
        broadcastSeatUpdate(tripId, result.tenantId).catch((err) =>
          logger.warn({ err, tripId }, "[webhooks/stripe] Failed to broadcast seat update after payment"),
        );
      }
      // Reservations now normally already exist by payment-confirmation time
      // (created at checkout). Only send the "new booking" notification when
      // this call actually created them (tripIds non-empty) — never resend it
      // just because payment confirmed for an already-notified reservation.
      if (result.tripIds.length > 0) {
        for (const reservationId of result.reservationIds) {
          enqueueNewBookingNotificationEmail(reservationId, result.tenantId).catch((err) =>
            logger.warn({ err, reservationId }, "[webhooks] Failed to enqueue payment confirmation notification"),
          );
        }
      }
      // Post-payment: provision the portal account and mint the referral code
      // (gated behind confirmed payment). Fire-and-forget; never blocks the webhook.
      runPostPaymentSideEffects(result.orderId).catch((err) =>
        logger.warn({ err, orderId: result.orderId }, "[webhooks] Failed post-payment side effects"),
      );
    }
    return;
  }

  if (event.type === "payment_intent.payment_failed") {
    const paymentIntentId = String(obj["id"] ?? "");
    if (!paymentIntentId) return;
    await db.transaction(async (tx) => {
      await markOrderFailed(tx as unknown as DbExecutor, store, paymentIntentId, "stripe");
    });
    return;
  }

  if (event.type === "charge.refunded") {
    const paymentIntentId = String(obj["payment_intent"] ?? "");
    if (!paymentIntentId) return;
    // Only treat as a full refund/cancellation when the entire charge was
    // refunded. Partial refunds are recorded in financial views via the
    // existing payments rows but must not cancel the reservation.
    const amount = Number(obj["amount"] ?? 0);
    const amountRefunded = Number(obj["amount_refunded"] ?? 0);
    if (amount > 0 && amountRefunded < amount) {
      logger.info({ paymentIntentId, amount, amountRefunded }, "[webhooks/stripe] Partial refund — order/reservation untouched");
      return;
    }
    await db.transaction(async (tx) => {
      await markOrderRefunded(tx as unknown as DbExecutor, store, paymentIntentId, "stripe");
    });
    return;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MercadoPago webhook
// ─────────────────────────────────────────────────────────────────────────────

interface MpSignatureParts {
  ts: string;
  v1: string;
}

function parseMpSignature(header: string | undefined): MpSignatureParts | null {
  if (!header) return null;
  let ts = "";
  let v1 = "";
  for (const piece of header.split(",")) {
    const [k, v] = piece.split("=");
    if (!k || !v) continue;
    if (k.trim() === "ts") ts = v.trim();
    else if (k.trim() === "v1") v1 = v.trim();
  }
  if (!ts || !v1) return null;
  return { ts, v1 };
}

const MP_TOLERANCE_SECONDS = 600; // 10 minutes — MP delivery can be slower than Stripe

function verifyMpSignature(
  dataId: string,
  xRequestId: string,
  header: string | undefined,
  secret: string,
): boolean {
  const parsed = parseMpSignature(header);
  if (!parsed) return false;
  const tsRaw = Number(parsed.ts);
  if (!Number.isFinite(tsRaw)) return false;
  // MP signs `ts` in milliseconds (per their docs); accept seconds too for safety.
  const tsSec = tsRaw > 1e12 ? Math.floor(tsRaw / 1000) : tsRaw;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > MP_TOLERANCE_SECONDS) return false;
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${parsed.ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return timingSafeEqualHex(expected, parsed.v1);
}

interface MpPayment {
  id: number | string;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  external_reference?: string | null;
  date_approved?: string | null;
}

async function fetchMpPayment(paymentId: string, accessToken: string): Promise<MpPayment | null> {
  try {
    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status, paymentId }, "[webhooks/mercadopago] Failed to fetch payment");
      return null;
    }
    return (await resp.json()) as MpPayment;
  } catch (err) {
    logger.error({ err, paymentId }, "[webhooks/mercadopago] Error fetching payment");
    return null;
  }
}

router.post("/webhooks/mercadopago/:storeSlug", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const secret = process.env["MP_WEBHOOK_SECRET"];
    if (!secret) {
      logger.warn("[webhooks/mercadopago] MP_WEBHOOK_SECRET not configured — rejecting");
      next(new ValidationError("Webhook not configured", "VALIDATION_ERROR"));
      return;
    }

    const store = await resolveStore(req.params["storeSlug"] ?? "");
    if (!store) {
      next(new ValidationError("Unknown store", "VALIDATION_ERROR"));
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const queryDataId = typeof req.query["data.id"] === "string" ? (req.query["data.id"] as string) : "";
    const bodyData = (body["data"] ?? {}) as Record<string, unknown>;
    const dataId = String(bodyData["id"] ?? queryDataId ?? "");
    const eventType = String(body["type"] ?? body["topic"] ?? req.query["type"] ?? req.query["topic"] ?? "");

    if (!dataId) {
      next(new ValidationError("Missing data.id", "VALIDATION_ERROR"));
      return;
    }

    const xRequestId = req.header("x-request-id") ?? "";
    const sigHeader = req.header("x-signature");
    if (!verifyMpSignature(dataId, xRequestId, sigHeader, secret)) {
      logger.warn(
        { sigHeader: sigHeader ? "present" : "missing", slug: store.slug },
        "[webhooks/mercadopago] Invalid signature",
      );
      next(new ValidationError("Invalid signature", "VALIDATION_ERROR"));
      return;
    }

    if (eventType !== "payment") {
      // Ack other notification types (merchant_order, etc.) without processing.
      res.status(200).json({ received: true });
      return;
    }

    const accessToken = decryptOrPassthrough(store.mpAccessToken);
    if (!accessToken) {
      logger.warn(
        { slug: store.slug, dataId },
        "[webhooks/mercadopago] Store has no MP access token configured",
      );
      next(new ValidationError("Store missing MP access token", "VALIDATION_ERROR"));
      return;
    }

    const payment = await fetchMpPayment(dataId, accessToken);
    if (!payment) {
      // MP API failure — ask the provider to retry.
      next(new AppError("MercadoPago API unreachable — retry later", 503, "MP_API_UNAVAILABLE"));
      return;
    }

    try {
      await handleMpPayment(store, dataId, payment);
      res.status(200).json({ received: true });
    } catch (err) {
      logger.error(
        { err, dataId, slug: store.slug },
        "[webhooks/mercadopago] Processing failure — returning 500 so MP retries",
      );
      next(err);
    }
  } catch (err) {
    next(err);
  }
});

async function handleMpPayment(store: StoreScope, paymentId: string, payment: MpPayment): Promise<void> {
  const externalRef = typeof payment.external_reference === "string"
    ? payment.external_reference.trim()
    : "";

  if (payment.status === PAYMENT_STATUS.APPROVED) {
    const result = await db.transaction(async (tx) => {
      const tx2 = tx as unknown as DbExecutor;
      const orderId = await resolveOrderForMp(tx2, store, paymentId, externalRef);
      if (!orderId) {
        logger.info({ paymentId, externalRef, slug: store.slug }, "[webhooks/mercadopago] No matching order");
        return null;
      }
      return applyGatewayPayment(tx2, {
        store,
        gateway: "mercadopago",
        transactionId: String(payment.id),
        paymentIntentId: paymentId,
        amount: Number(payment.transaction_amount ?? 0),
        paidAt: payment.date_approved ? new Date(payment.date_approved) : new Date(),
      });
    });
    if (result) {
      // Broadcast seat-map updates for each trip whose reservation was just created.
      for (const tripId of result.tripIds) {
        broadcastSeatUpdate(tripId, result.tenantId).catch((err) =>
          logger.warn({ err, tripId }, "[webhooks/mp] Failed to broadcast seat update after payment"),
        );
      }
      // See the analogous guard in handleStripeEvent above: only notify when
      // this call actually created the reservation (tripIds non-empty).
      if (result.tripIds.length > 0) {
        for (const reservationId of result.reservationIds) {
          enqueueNewBookingNotificationEmail(reservationId, result.tenantId).catch((err) =>
            logger.warn({ err, reservationId }, "[webhooks] Failed to enqueue payment confirmation notification"),
          );
        }
      }
      // Post-payment: provision the portal account and mint the referral code
      // (gated behind confirmed payment). Fire-and-forget; never blocks the webhook.
      runPostPaymentSideEffects(result.orderId).catch((err) =>
        logger.warn({ err, orderId: result.orderId }, "[webhooks] Failed post-payment side effects"),
      );
    }
  } else if (payment.status === "rejected") {
    await db.transaction(async (tx) => {
      const tx2 = tx as unknown as DbExecutor;
      const orderId = await resolveOrderForMp(tx2, store, paymentId, externalRef);
      if (!orderId) return;
      await markOrderFailed(tx2, store, paymentId, "mercadopago");
    });
  } else if (payment.status === PAYMENT_STATUS.CANCELLED || payment.status === PAYMENT_STATUS.REFUNDED || payment.status === PAYMENT_STATUS.CHARGED_BACK) {
    await db.transaction(async (tx) => {
      const tx2 = tx as unknown as DbExecutor;
      const orderId = await resolveOrderForMp(tx2, store, paymentId, externalRef);
      if (!orderId) return;
      await markOrderRefunded(tx2, store, paymentId, "mercadopago");
    });
  }
}

/**
 * Locate the store_order corresponding to an incoming MercadoPago payment.
 * Tries `paymentIntentId == paymentId` first; falls back to
 * `orderNumber == external_reference` (set when the MP payment/preference
 * was created). When the fallback hits, we backfill `paymentIntentId` on
 * the order so future events for the same payment short-circuit.
 *
 * Returns the order id when found, or null. All lookups are tenant + store
 * scoped to prevent cross-tenant matches.
 */
async function resolveOrderForMp(
  tx: DbExecutor,
  store: StoreScope,
  paymentId: string,
  externalRef: string,
): Promise<string | null> {
  const [byPi] = await tx
    .select({ id: storeOrdersTable.id })
    .from(storeOrdersTable)
    .where(
      and(
        eq(storeOrdersTable.tenantId, store.tenantId),
        eq(storeOrdersTable.storeId, store.storeId),
        eq(storeOrdersTable.paymentIntentId, paymentId),
      ),
    )
    .limit(1);
  if (byPi) return byPi.id;

  if (!externalRef) return null;

  const [byRef] = await tx
    .select({ id: storeOrdersTable.id, paymentIntentId: storeOrdersTable.paymentIntentId })
    .from(storeOrdersTable)
    .where(
      and(
        eq(storeOrdersTable.tenantId, store.tenantId),
        eq(storeOrdersTable.storeId, store.storeId),
        eq(storeOrdersTable.orderNumber, externalRef),
      ),
    )
    .limit(1);
  if (!byRef) return null;

  // Backfill paymentIntentId so subsequent webhooks hit the fast path.
  // Only set when missing; never overwrite a different value.
  if (!byRef.paymentIntentId) {
    await tx
      .update(storeOrdersTable)
      .set({ paymentIntentId: paymentId })
      .where(eq(storeOrdersTable.id, byRef.id));
  } else if (byRef.paymentIntentId !== paymentId) {
    logger.warn(
      { orderId: byRef.id, existing: byRef.paymentIntentId, incoming: paymentId },
      "[webhooks/mercadopago] external_reference matched order but paymentIntentId differs — refusing to overwrite",
    );
    return null;
  }
  return byRef.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers (all take a tx so the whole webhook event is atomic)
// ─────────────────────────────────────────────────────────────────────────────

interface ApplyArgs {
  store: StoreScope;
  gateway: "stripe" | "mercadopago";
  transactionId: string;
  paymentIntentId: string;
  amount: number;
  paidAt: Date;
}

interface ApplyResult {
  orderId: string;
  reservationIds: string[];
  tenantId: string;
  /** Trip IDs for which reservations were created this call, for post-commit SSE broadcast. */
  tripIds: string[];
}

export async function applyGatewayPayment(tx: DbExecutor, args: ApplyArgs): Promise<ApplyResult | null> {
  const { store, gateway, transactionId, paymentIntentId, amount, paidAt } = args;
  if (amount <= 0) return null;

  // Look up the order scoped to this store/tenant so we never accidentally
  // apply a payment from one tenant's gateway to another tenant's order.
  const [order] = await tx
    .select({
      id: storeOrdersTable.id,
      orderNumber: storeOrdersTable.orderNumber,
      tenantId: storeOrdersTable.tenantId,
      storeId: storeOrdersTable.storeId,
      clientId: storeOrdersTable.clientId,
      paymentMethod: storeOrdersTable.paymentMethod,
      paymentStatus: storeOrdersTable.paymentStatus,
    })
    .from(storeOrdersTable)
    .where(
      and(
        eq(storeOrdersTable.tenantId, store.tenantId),
        eq(storeOrdersTable.storeId, store.storeId),
        eq(storeOrdersTable.paymentIntentId, paymentIntentId),
      ),
    )
    .limit(1);

  if (!order) {
    logger.info({ paymentIntentId, gateway, slug: store.slug }, "[webhooks] No matching order for paymentIntentId");
    return null;
  }

  // Idempotency: if we already recorded this exact gateway transaction, stop.
  if (await paymentExistsForGatewayTx(order.tenantId, gateway, transactionId, tx)) {
    logger.info({ paymentIntentId, gateway, transactionId }, "[webhooks] Duplicate event ignored");
    return null;
  }

  // Atomic conditional update: only matches when paymentStatus is NOT already PAID.
  // This is the idempotency gate for inventory effects — concurrent or duplicate
  // webhook deliveries get 0 rows returned and skip inventory effects.
  // Also covers the manual-paid-then-webhook path: if admin already marked the order
  // paid (which applies inventory effects once), the gateway webhook sees 0 rows
  // here and skips effects, preventing a double-apply.
  const updatedOrderRows = await tx
    .update(storeOrdersTable)
    .set({ paymentStatus: STORE_PAYMENT_STATUS.PAID, paidAt, status: STORE_ORDER_STATUS.CONFIRMED, confirmedAt: paidAt })
    .where(and(
      eq(storeOrdersTable.id, order.id),
      ne(storeOrdersTable.paymentStatus, STORE_PAYMENT_STATUS.PAID),
    ))
    .returning({ id: storeOrdersTable.id });

  const didTransitionToPaid = updatedOrderRows.length > 0;

  // Create reservations now (payment confirmed): seats are only reserved after payment,
  // not at checkout time. createReservationsForOrder is idempotent — safe on retries.
  const createResult = await createReservationsForOrder(order.id, tx as unknown as Parameters<typeof createReservationsForOrder>[1]);

  // Apply inventory effects deferred from order-creation: stock decrement, coupon
  // usageCount increment, and totalOrders increment. Only applied on the first
  // UNPAID → PAID transition — skipped for duplicate/retried webhook events and for
  // orders already marked paid by the manual-payment admin path.
  if (didTransitionToPaid) {
    await applyOrderInventoryEffects(order.id, tx);
  }

  // Find the reservations linked to this order via storeOrderId == orderNumber
  const reservations = await tx
    .select({ id: reservationsTable.id, totalValue: reservationsTable.totalValue })
    .from(reservationsTable)
    .where(
      and(
        eq(reservationsTable.tenantId, order.tenantId),
        eq(reservationsTable.storeOrderId, order.orderNumber),
      ),
    );

  if (reservations.length === 0) {
    // Product-only paid order: there are no reservations to allocate Payment rows
    // to, but the order IS paid. Return the orderId (with no reservationIds) so
    // the caller still runs the payment-gated post-payment side effects (deferred
    // referral conversion + referral-credit consumption + referral-code mint).
    // Without this, paid product-only gateway orders would never credit the
    // referrer or consume the customer's referral credit. runPostPaymentSideEffects
    // is fully idempotent, so re-running it on a duplicate webhook is safe.
    logger.info({ orderId: order.id, paymentIntentId }, "[webhooks] Product-only order paid — no reservations to sync");
    return { orderId: order.id, reservationIds: [], tripIds: createResult.tripIds, tenantId: order.tenantId };
  }

  // Mixed-cart orders may include non-reservation products. Cap the amount
  // allocated to reservation Payment rows at the sum of reservation totals
  // so non-reservation items don't inflate paidValue/balance.
  const totalReservationValue = reservations.reduce((acc, r) => acc + Number(r.totalValue), 0);
  if (totalReservationValue <= 0) return null;
  const allocatable = Math.min(amount, totalReservationValue);

  let allocated = 0;
  for (let i = 0; i < reservations.length; i++) {
    const r = reservations[i]!;
    const isLast = i === reservations.length - 1;
    const share = isLast
      ? roundMoney(allocatable - allocated)
      : roundMoney((Number(r.totalValue) / totalReservationValue) * allocatable);
    allocated = roundMoney(allocated + share);

    if (share <= 0) continue;

    await tx.insert(paymentsTable).values({
      id: generateId(),
      tenantId: order.tenantId,
      reservationId: r.id,
      clientId: order.clientId ?? null,
      orderId: order.id,
      type: "receivable",
      category: "reservation",
      amount: String(share),
      paymentMethod: order.paymentMethod ?? gateway,
      installmentNumber: i + 1,
      totalInstallments: reservations.length,
      dueDate: paidAt,
      paidAt,
      status: PAYMENT_STATUS.PAID,
      gateway,
      transactionId,
      description: `Pagamento ${gateway} confirmado via webhook`,
    });

    await syncReservationPaymentStatus(r.id, order.tenantId, tx);
  }

  logger.info(
    { orderId: order.id, gateway, transactionId, reservations: reservations.length, amount },
    "[webhooks] Gateway payment applied and reservations synced",
  );
  return { orderId: order.id, reservationIds: reservations.map((r) => r.id), tripIds: createResult.tripIds, tenantId: order.tenantId };
}

async function markOrderFailed(
  tx: DbExecutor,
  store: StoreScope,
  paymentIntentId: string,
  gateway: string,
): Promise<void> {
  const [order] = await tx
    .select({
      id: storeOrdersTable.id,
      tenantId: storeOrdersTable.tenantId,
      orderNumber: storeOrdersTable.orderNumber,
      paymentStatus: storeOrdersTable.paymentStatus,
    })
    .from(storeOrdersTable)
    .where(
      and(
        eq(storeOrdersTable.tenantId, store.tenantId),
        eq(storeOrdersTable.storeId, store.storeId),
        eq(storeOrdersTable.paymentIntentId, paymentIntentId),
      ),
    )
    .limit(1);
  if (!order) return;
  if (order.paymentStatus === STORE_PAYMENT_STATUS.PAID) {
    logger.warn(
      { paymentIntentId, gateway },
      "[webhooks] Failed event arrived after payment was marked paid; ignoring",
    );
    return;
  }
  await tx
    .update(storeOrdersTable)
    .set({ paymentStatus: STORE_PAYMENT_STATUS.FAILED })
    .where(eq(storeOrdersTable.id, order.id));

  // Cascade to linked reservations: a payment failure should leave them in
  // `failed` so staff/customers can see the rejection without manual review.
  // Terminal-state reservations (cancelled/completed) are left alone.
  const reservations = await tx
    .select({ id: reservationsTable.id, status: reservationsTable.status })
    .from(reservationsTable)
    .where(
      and(
        eq(reservationsTable.tenantId, order.tenantId),
        eq(reservationsTable.storeOrderId, order.orderNumber),
      ),
    );

  const failableIds = reservations
    .filter((r) => r.status !== RESERVATION_STATUS.CANCELLED && r.status !== RESERVATION_STATUS.COMPLETED)
    .map((r) => r.id);
  if (failableIds.length > 0) {
    await tx
      .update(reservationsTable)
      .set({ status: RESERVATION_STATUS.FAILED })
      .where(
        and(
          eq(reservationsTable.tenantId, order.tenantId),
          inArray(reservationsTable.id, failableIds),
        ),
      );
  }

  logger.info(
    { orderId: order.id, gateway, reservationsFailed: failableIds.length },
    "[webhooks] Order marked failed and reservations cascaded",
  );
}

async function markOrderRefunded(
  tx: DbExecutor,
  store: StoreScope,
  paymentIntentId: string,
  gateway: string,
): Promise<void> {
  const [order] = await tx
    .select({
      id: storeOrdersTable.id,
      tenantId: storeOrdersTable.tenantId,
      orderNumber: storeOrdersTable.orderNumber,
      pendingReferral: storeOrdersTable.pendingReferral,
      referralEffectsAppliedAt: storeOrdersTable.referralEffectsAppliedAt,
    })
    .from(storeOrdersTable)
    .where(
      and(
        eq(storeOrdersTable.tenantId, store.tenantId),
        eq(storeOrdersTable.storeId, store.storeId),
        eq(storeOrdersTable.paymentIntentId, paymentIntentId),
      ),
    )
    .limit(1);
  if (!order) return;

  const now = new Date();
  await tx
    .update(storeOrdersTable)
    .set({ paymentStatus: STORE_PAYMENT_STATUS.REFUNDED, refundedAt: now, status: STORE_ORDER_STATUS.CANCELLED, cancelledAt: now })
    .where(eq(storeOrdersTable.id, order.id));

  // Demote previously-paid Payment rows to refunded so any subsequent
  // recomputation of reservation balances reflects the reversal.
  await tx
    .update(paymentsTable)
    .set({ status: PAYMENT_STATUS.REFUNDED })
    .where(
      and(
        eq(paymentsTable.tenantId, order.tenantId),
        eq(paymentsTable.orderId, order.id),
        eq(paymentsTable.gateway, gateway),
      ),
    );

  // Cascade reservations to `cancelled` (refunds are irreversible from the
  // CRM perspective). We then re-sync paid totals so balance/paidValue
  // reflect the demoted Payment rows.
  const reservations = await tx
    .select({
      id: reservationsTable.id,
      status: reservationsTable.status,
      tripId: reservationsTable.tripId,
      seats: reservationsTable.seats,
    })
    .from(reservationsTable)
    .where(
      and(
        eq(reservationsTable.tenantId, order.tenantId),
        eq(reservationsTable.storeOrderId, order.orderNumber),
      ),
    );

  const cancellableIds = reservations
    .filter((r) => r.status !== RESERVATION_STATUS.CANCELLED && r.status !== RESERVATION_STATUS.COMPLETED)
    .map((r) => r.id);

  // Update trip seat counters BEFORE the bulk status update so we can read
  // each reservation's current (pre-cancel) status. Confirmed reservations
  // decrement confirmed_seats; pending ones decrement reserved_seats. In both
  // cases available_seats is incremented by the total number of freed seats.
  if (cancellableIds.length > 0) {
    const seatDeltaByTrip = new Map<string, { confirmed: number; reserved: number }>();
    for (const r of reservations) {
      if (!cancellableIds.includes(r.id)) continue;
      const seatsCount = Array.isArray(r.seats) ? r.seats.length : 0;
      if (seatsCount === 0 || !r.tripId) continue;
      const entry = seatDeltaByTrip.get(r.tripId) ?? { confirmed: 0, reserved: 0 };
      if (r.status === RESERVATION_STATUS.CONFIRMED) {
        entry.confirmed += seatsCount;
      } else {
        entry.reserved += seatsCount;
      }
      seatDeltaByTrip.set(r.tripId, entry);
    }
    for (const [tripId, { confirmed, reserved }] of seatDeltaByTrip) {
      await tx.update(tripsTable).set({
        availableSeats: sql`LEAST(total_capacity, GREATEST(0, available_seats + ${confirmed + reserved}))`,
        ...(confirmed > 0 ? { confirmedSeats: sql`GREATEST(0, confirmed_seats - ${confirmed})` } : {}),
        ...(reserved > 0 ? { reservedSeats: sql`GREATEST(0, reserved_seats - ${reserved})` } : {}),
      }).where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, order.tenantId)));
    }

    await tx
      .update(reservationsTable)
      .set({ status: RESERVATION_STATUS.CANCELLED, cancelledAt: now })
      .where(
        and(
          eq(reservationsTable.tenantId, order.tenantId),
          inArray(reservationsTable.id, cancellableIds),
        ),
      );

    // Reverse COMPLETED referrals linked to the reservations being cancelled.
    // `markOrderRefunded` bypasses the per-reservation PATCH handler where
    // reservations.ts Reversal 3 lives, so we replicate the same logic here.
    await reverseTripOrderReferrals(tx, {
      tenantId: order.tenantId,
      orderId: order.id,
      cancellableReservationIds: cancellableIds,
      reversalReason: "order_refunded",
    });
  }

  for (const r of reservations) {
    await syncReservationPaymentStatus(r.id, order.tenantId, tx);
  }

  // For product-only orders (no reservations), reverse any COMPLETED referral
  // that was credited when the order was paid. Trip-based orders are handled
  // by `reverseTripOrderReferrals` inside the cancellableIds block above.
  if (reservations.length === 0 && order.referralEffectsAppliedAt != null) {
    const ref = order.pendingReferral;
    if (ref?.code) {
      await reverseProductOnlyOrderReferral(tx, {
        tenantId: order.tenantId,
        orderId: order.id,
        referralCode: ref.code,
        referralId: ref.referralId,
        reversalReason: "order_refunded",
      });
    }
  }

  logger.info(
    { orderId: order.id, gateway, reservationsCancelled: cancellableIds.length },
    "[webhooks] Order refunded, reservations cancelled and resynced",
  );
}

export default router;

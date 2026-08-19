import type { Request, Response } from "express";
import { db, tenantsTable, plansTable, invoicesTable, subscriptionsTable, tripsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { INVOICE_STATUS, TENANT_STATUS, SUBSCRIPTION_STATUS } from "@workspace/permissions";
import { getUncachableStripeClient, getStripeWebhookSecret } from "./stripeClient";
import { getManagedWebhookSigningSecret, isStripeSyncInitComplete } from "./stripeSync";
import { generateId } from "./id";
import { logger } from "./logger";
import { hasSeatMapFeature } from "./plan-features";

async function activateSubscriptionForTenant(
  tenantId: string,
  planId: string,
  stripeCustomerId?: string,
  stripeSubscriptionId?: string,
  periodEnd?: Date,
): Promise<void> {
  const [plan] = await db.select().from(plansTable)
    .where(eq(plansTable.id, planId))
    .limit(1);
  if (!plan) {
    const [planBySlug] = await db.select().from(plansTable)
      .where(eq(plansTable.slug, planId))
      .limit(1);
    if (!planBySlug) return;
    return activateSubscriptionForTenant(tenantId, planBySlug.id, stripeCustomerId, stripeSubscriptionId, periodEnd);
  }

  await db.update(tenantsTable).set({
    planId: plan.slug,
    pendingPlanId: null,
    status: TENANT_STATUS.ACTIVE,
    updatedAt: new Date(),
  }).where(eq(tenantsTable.id, tenantId));

  if (!hasSeatMapFeature((plan.supportedFeatures ?? []) as string[])) {
    await db.update(tripsTable).set({ showSeatMap: true }).where(eq(tripsTable.tenantId, tenantId));
  }

  const existingSubs = await db.select().from(subscriptionsTable)
    .where(eq(subscriptionsTable.tenantId, tenantId))
    .orderBy(desc(subscriptionsTable.createdAt))
    .limit(1);

  const computedPeriodEnd = periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  if (existingSubs.length > 0) {
    await db.update(subscriptionsTable).set({
      planId: plan.id,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      currentPeriodEnd: computedPeriodEnd,
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
      ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
    }).where(eq(subscriptionsTable.id, existingSubs[0]!.id));
  } else {
    await db.insert(subscriptionsTable).values({
      id: generateId(),
      tenantId,
      planId: plan.id,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      billingCycle: "monthly",
      currentPeriodStart: new Date(),
      currentPeriodEnd: computedPeriodEnd,
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
      ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
    });
  }
}

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  // Collect all candidate secrets: the manually-configured env var AND the
  // managed webhook secret auto-stored by stripe-replit-sync. When multiple
  // Stripe webhook endpoints are registered at the same URL (e.g. a legacy
  // manual endpoint coexisting with the managed one), each has its own signing
  // secret. We try every non-null candidate and accept the first that verifies.
  const envSecret = await getStripeWebhookSecret();
  const managedSecret = await getManagedWebhookSigningSecret();

  // Deduplicate: if both resolve to the same value, only try once.
  const candidateSecrets: string[] = [];
  if (envSecret) candidateSecrets.push(envSecret);
  if (managedSecret && managedSecret !== envSecret) candidateSecrets.push(managedSecret);

  if (candidateSecrets.length === 0) {
    // No signing secret available. If StripeSync init is still running, the
    // managed secret may simply not be cached yet (event delivered during the
    // boot window). Tell Stripe to retry soon with a 503 instead of a hard 400
    // rejection — Stripe retries 5xx automatically for up to ~3 days.
    if (!isStripeSyncInitComplete()) {
      logger.warn("Stripe webhook secret not ready (StripeSync init in progress) — asking Stripe to retry");
      res.status(503).json({ error: "Stripe sync inicializando — tente novamente em breve" });
      return;
    }
    logger.warn("Stripe webhook secret not configured — rejecting request");
    res.status(400).json({ error: "Stripe webhook não configurado" });
    return;
  }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  // When the route is registered with express.raw(), the parsed buffer arrives
  // in req.body (not req.rawBody). When the route goes through express.json()
  // with the verify hook, it arrives in req.rawBody. Accept either.
  const reqAny = req as Request & { rawBody?: Buffer };
  const rawBody: Buffer | undefined =
    reqAny.rawBody instanceof Buffer
      ? reqAny.rawBody
      : req.body instanceof Buffer
        ? req.body
        : undefined;

  if (!rawBody) {
    res.status(400).json({ error: "Raw body não disponível para verificação de assinatura" });
    return;
  }

  let stripe;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    logger.error({ err }, "Stripe not configured for webhook");
    res.status(400).json({ error: "Stripe não configurado" });
    return;
  }

  let event;
  for (const secret of candidateSecrets) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
      break;
    } catch {
      // Try next candidate
    }
  }
  if (!event) {
    logger.warn({ candidateCount: candidateSecrets.length }, "Stripe webhook signature verification failed with all candidate secrets");
    res.status(400).json({ error: "Assinatura inválida" });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const tenantId = session.metadata?.tenantId ?? session.client_reference_id;
        const planId = session.metadata?.planId;
        const stripeCustomerId = typeof session.customer === "string" ? session.customer : undefined;
        const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : undefined;

        if (tenantId && planId) {
          await activateSubscriptionForTenant(tenantId, planId, stripeCustomerId, stripeSubscriptionId);
          logger.info({ tenantId, planId }, "[stripe-webhook] checkout.session.completed — subscription activated");
        }

        // Mark the local invoice as paid if we have one
        if (session.metadata?.invoiceId) {
          await db.update(invoicesTable).set({
            status: INVOICE_STATUS.PAID,
            paidAt: new Date(),
            ...(stripeCustomerId ? { stripeCustomerId } : {}),
          }).where(eq(invoicesTable.id, session.metadata.invoiceId));
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const stripeInvoice = event.data.object;
        const tenantId = stripeInvoice.metadata?.tenantId;
        const planId = stripeInvoice.metadata?.planId;
        const stripeCustomerId = typeof stripeInvoice.customer === "string" ? stripeInvoice.customer : undefined;
        const stripeInvoiceRaw = stripeInvoice as unknown as Record<string, unknown>;
        const stripeSubscriptionId = typeof stripeInvoiceRaw["subscription"] === "string" ? stripeInvoiceRaw["subscription"] : undefined;

        // Mark local invoice paid by stripeInvoiceId
        if (stripeInvoice.id) {
          await db.update(invoicesTable).set({
            status: INVOICE_STATUS.PAID,
            paidAt: new Date(),
            stripeInvoiceId: stripeInvoice.id,
            ...(stripeCustomerId ? { stripeCustomerId } : {}),
          }).where(eq(invoicesTable.stripeInvoiceId, stripeInvoice.id));
        }

        // Also look up by invoiceId metadata
        if (stripeInvoice.metadata?.invoiceId) {
          await db.update(invoicesTable).set({
            status: INVOICE_STATUS.PAID,
            paidAt: new Date(),
            ...(stripeInvoice.id ? { stripeInvoiceId: stripeInvoice.id } : {}),
            ...(stripeCustomerId ? { stripeCustomerId } : {}),
          }).where(eq(invoicesTable.id, stripeInvoice.metadata.invoiceId));
        }

        if (tenantId && planId) {
          const periodEndTs = stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000) : undefined;
          await activateSubscriptionForTenant(tenantId, planId, stripeCustomerId, stripeSubscriptionId, periodEndTs);
          logger.info({ tenantId, planId }, "[stripe-webhook] invoice.payment_succeeded — subscription activated");
        }

        // Also handle PaymentIntent metadata path
        if (stripeInvoiceRaw["payment_intent"] && typeof stripeInvoiceRaw["payment_intent"] === "string") {
          const [inv] = await db.select().from(invoicesTable)
            .where(eq(invoicesTable.stripePaymentIntentId, stripeInvoiceRaw["payment_intent"]))
            .limit(1);
          if (inv && inv.status !== INVOICE_STATUS.PAID) {
            await db.update(invoicesTable).set({
              status: INVOICE_STATUS.PAID,
              paidAt: new Date(),
            }).where(eq(invoicesTable.id, inv.id));

            if (inv.planId && inv.tenantId) {
              const periodEndTs = stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000) : undefined;
              await activateSubscriptionForTenant(inv.tenantId, inv.planId, stripeCustomerId, stripeSubscriptionId, periodEndTs);
            }
          }
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object;
        const invoiceId = pi.metadata?.invoiceId;
        const tenantId = pi.metadata?.tenantId;
        const planId = pi.metadata?.planId;
        const stripeCustomerId = typeof pi.customer === "string" ? pi.customer : undefined;

        if (invoiceId) {
          const [inv] = await db.select().from(invoicesTable)
            .where(eq(invoicesTable.id, invoiceId))
            .limit(1);
          if (inv && inv.status !== INVOICE_STATUS.PAID) {
            await db.update(invoicesTable).set({
              status: INVOICE_STATUS.PAID,
              paidAt: new Date(),
              ...(stripeCustomerId ? { stripeCustomerId } : {}),
            }).where(eq(invoicesTable.id, invoiceId));

            if (tenantId && planId) {
              await activateSubscriptionForTenant(tenantId, planId, stripeCustomerId);
            } else if (inv.tenantId && inv.planId) {
              await activateSubscriptionForTenant(inv.tenantId, inv.planId, stripeCustomerId);
            }
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        const invoiceId = pi.metadata?.invoiceId;
        if (invoiceId) {
          await db.update(invoicesTable).set({
            status: INVOICE_STATUS.FAILED,
            notes: "Pagamento falhou via Stripe",
          }).where(eq(invoicesTable.id, invoiceId));
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const tenantId = sub.metadata?.tenantId;
        if (!tenantId) break;

        const subRaw = sub as unknown as Record<string, unknown>;
        const periodEnd = subRaw["current_period_end"] ? new Date((subRaw["current_period_end"] as number) * 1000) : undefined;
        const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : undefined;

        const subs = await db.select().from(subscriptionsTable)
          .where(eq(subscriptionsTable.tenantId, tenantId))
          .orderBy(desc(subscriptionsTable.createdAt))
          .limit(1);

        if (subs.length > 0) {
          await db.update(subscriptionsTable).set({
            status: sub.status === "active" ? SUBSCRIPTION_STATUS.ACTIVE
              : sub.status === "trialing" ? SUBSCRIPTION_STATUS.TRIAL
              : sub.status === "canceled" ? SUBSCRIPTION_STATUS.CANCELED
              : sub.status,
            cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
            ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
            ...(stripeCustomerId ? { stripeCustomerId } : {}),
            stripeSubscriptionId: sub.id,
          }).where(eq(subscriptionsTable.id, subs[0]!.id));
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const tenantId = sub.metadata?.tenantId;
        if (!tenantId) break;

        await db.update(subscriptionsTable).set({
          status: SUBSCRIPTION_STATUS.CANCELED,
          canceledAt: new Date(),
        }).where(eq(subscriptionsTable.stripeSubscriptionId, sub.id));

        await db.update(tenantsTable).set({
          planId: "starter",
          status: TENANT_STATUS.ACTIVE,
          updatedAt: new Date(),
        }).where(eq(tenantsTable.id, tenantId));

        logger.info({ tenantId, subscriptionId: sub.id }, "[stripe-webhook] customer.subscription.deleted — downgraded to starter");
        break;
      }

      default:
        logger.debug({ type: event.type }, "[stripe-webhook] unhandled event type");
    }

    res.json({ received: true });
  } catch (err) {
    logger.error({ err, eventType: event.type }, "[stripe-webhook] Error processing event");
    res.status(500).json({ error: "Internal server error" });
  }
}

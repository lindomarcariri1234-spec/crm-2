import type { Request, Response } from "express";
import { db, tenantsTable, plansTable, invoicesTable, subscriptionsTable, tripsTable, stripeWebhookEventsTable } from "@workspace/db";
import { eq, desc, and, ne } from "drizzle-orm";
import { INVOICE_STATUS, TENANT_STATUS, SUBSCRIPTION_STATUS } from "@workspace/permissions";
import { getUncachableStripeClient, getStripeWebhookSecret } from "./stripeClient";
import { getManagedWebhookSigningSecret, isStripeSyncInitComplete } from "./stripeSync";
import { generateId } from "./id";
import { logger } from "./logger";
import { hasSeatMapFeature } from "./plan-features";

// Executor type: either the base `db` handle or a transaction handle `tx`.
// Every business query in this module runs through an executor passed in by the
// caller so that ALL writes for a single webhook event share one transaction —
// there is no global mutable `db` reference used for side effects. On any
// failure the whole transaction rolls back (event claim + all mutations + the
// processed mark), and a process crash rolls back uncommitted work, so Stripe
// can cleanly reprocess the event and no permanent "processing" rows are left.
type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function activateSubscriptionForTenant(
  tx: DbExecutor,
  tenantId: string,
  planId: string,
  stripeCustomerId?: string,
  stripeSubscriptionId?: string,
  periodEnd?: Date,
): Promise<boolean> {
  const [plan] = await tx.select().from(plansTable)
    .where(eq(plansTable.id, planId))
    .limit(1);
  if (!plan) {
    const [planBySlug] = await tx.select().from(plansTable)
      .where(eq(plansTable.slug, planId))
      .limit(1);
    if (!planBySlug) return false;
    return activateSubscriptionForTenant(tx, tenantId, planBySlug.id, stripeCustomerId, stripeSubscriptionId, periodEnd);
  }

  const markTenantActive = async () => {
    await tx.update(tenantsTable).set({
      planId: plan.slug,
      pendingPlanId: null,
      status: TENANT_STATUS.ACTIVE,
      updatedAt: new Date(),
    }).where(eq(tenantsTable.id, tenantId));

    if (!hasSeatMapFeature((plan.supportedFeatures ?? []) as string[])) {
      await tx.update(tripsTable).set({ showSeatMap: true }).where(eq(tripsTable.tenantId, tenantId));
    }
  };

  const existingSubs = await tx.select().from(subscriptionsTable)
    .where(eq(subscriptionsTable.tenantId, tenantId))
    .orderBy(desc(subscriptionsTable.createdAt))
    .limit(1);

  const existingSub = existingSubs[0];

  // Resolve the period end WITHOUT clobbering an already-provisioned trial.
  //
  // When no explicit `periodEnd` is supplied — e.g. a Stripe-native trial
  // Checkout Session (`payment_status: "no_payment_required"`) with NO local
  // invoice — the upgrade flow has already inserted a PENDING_PAYMENT
  // subscription whose `currentPeriodEnd` is the planned trial end (with
  // `trialStart`/`trialEnd` set). Blindly falling back to a 30-day default here
  // would overwrite that established trial period. So when activating an
  // existing row and no periodEnd is given, PRESERVE its current period end
  // (and trialEnd) instead of defaulting.
  const isTrialPeriodPreserved =
    periodEnd == null &&
    !!existingSub &&
    (existingSub.trialEnd != null || existingSub.currentPeriodEnd != null);

  const computedPeriodEnd = periodEnd
    ?? (isTrialPeriodPreserved ? (existingSub!.currentPeriodEnd ?? undefined) : undefined)
    ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  if (existingSub) {
    // Idempotency guard: if this exact subscription is already ACTIVE for the
    // same plan with the same Stripe subscription id, a duplicate/redelivered
    // activation is a no-op — do not re-stamp (and never regress the period).
    const alreadyProvisioned =
      existingSub.status === SUBSCRIPTION_STATUS.ACTIVE &&
      existingSub.planId === plan.id &&
      (!stripeSubscriptionId || existingSub.stripeSubscriptionId === stripeSubscriptionId) &&
      periodEnd == null;
    if (alreadyProvisioned) return false;

    // ── Durable atomic subscription-level claim ──
    // When no explicit `periodEnd` is supplied, this activation comes from a
    // confirmed checkout.session.completed with NO local invoice to claim
    // against (a Stripe-native `no_payment_required` trial, or a legacy paid
    // session). The invoice-claim guard used elsewhere is unavailable here, so
    // the concurrency defence lives on the pre-provisioned subscription row:
    // transition it to ACTIVE with a single conditional UPDATE
    // (…WHERE id=? AND status != ACTIVE) and RETURN the claimed id. Only the
    // winning delivery matches a row and reports activation; a concurrent
    // duplicate matches zero rows and reports no activation — so two parallel
    // deliveries can never both activate this tenant.
    //
    // When an explicit `periodEnd` IS supplied (invoice-driven paid flows), the
    // idempotency/atomicity is already enforced by the caller's invoice claim,
    // so we keep the plain unconditional update to avoid disturbing that path.
    if (periodEnd == null) {
      const claimed = await tx.update(subscriptionsTable).set({
        planId: plan.id,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        currentPeriodEnd: computedPeriodEnd,
        ...(stripeCustomerId ? { stripeCustomerId } : {}),
        ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
      }).where(and(
        eq(subscriptionsTable.id, existingSub.id),
        ne(subscriptionsTable.status, SUBSCRIPTION_STATUS.ACTIVE),
      )).returning({ id: subscriptionsTable.id });
      if (claimed.length === 0) return false;
      await markTenantActive();
      return true;
    }

    await tx.update(subscriptionsTable).set({
      planId: plan.id,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      currentPeriodEnd: computedPeriodEnd,
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
      ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
    }).where(eq(subscriptionsTable.id, existingSub.id));
    await markTenantActive();
    return true;
  } else {
    await tx.insert(subscriptionsTable).values({
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
    await markTenantActive();
    return true;
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

  // ── Single-transaction, failure-atomic event processing ──
  // Stripe delivers events at-least-once: the same event id can arrive more
  // than once (automatic retries, network races, or multiple registered
  // endpoints hitting this URL). Everything below runs inside ONE database
  // transaction so that the event-idempotency CLAIM, every business mutation
  // (invoice / subscription / tenant), and the final "processed" mark either
  // ALL commit together or ALL roll back together:
  //
  //   - Winning delivery, success  → the claim, all side effects, and the
  //     processed mark commit atomically; the claim now permanently suppresses
  //     future duplicates.
  //   - Duplicate/concurrent delivery → the INSERT … ON CONFLICT DO NOTHING
  //     RETURNING claim returns zero rows; the transaction commits with NO
  //     side effects and we ack 200. Primary-key uniqueness serialises a true
  //     concurrent race so exactly one delivery wins.
  //   - Handler throws / processed-mark fails → the transaction ROLLS BACK,
  //     releasing the claim AND undoing every side effect, so Stripe's retry
  //     can cleanly reprocess. A process crash mid-flight rolls back the
  //     uncommitted transaction too — no permanent "processing" rows are ever
  //     left behind, so no stale-claim reaping is needed.
  let wasDuplicate = false;
  try {
    await db.transaction(async (tx) => {
      const claimed = await tx.insert(stripeWebhookEventsTable)
        .values({ id: event.id, type: event.type })
        .onConflictDoNothing({ target: stripeWebhookEventsTable.id })
        .returning({ id: stripeWebhookEventsTable.id });

      if (claimed.length === 0) {
        wasDuplicate = true;
        logger.info({ eventId: event.id, eventType: event.type }, "[stripe-webhook] duplicate event — already claimed, skipping side effects");
        return;
      }

      switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const tenantId = session.metadata?.tenantId ?? session.client_reference_id;
        const planId = session.metadata?.planId;
        const stripeCustomerId = typeof session.customer === "string" ? session.customer : undefined;
        const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : undefined;

        // Only act on a CONFIRMED-paid session. `checkout.session.completed`
        // also fires for sessions whose payment is still pending/delayed (e.g.
        // async payment methods like boleto/PIX/bank debit), where
        // `payment_status` is "unpaid". Activating on those would flip a tenant
        // to ACTIVE and mark an invoice PAID before money has actually settled.
        //
        // Accepted states:
        //   - "paid"                → payment collected.
        //   - "no_payment_required" → e.g. Stripe-native trial (valid payment
        //                             method captured; Stripe charges at trial
        //                             end). Safe to activate the trial.
        // Rejected:
        //   - "unpaid"              → async/delayed payment not yet settled.
        //     Activation happens later via invoice.payment_succeeded /
        //     payment_intent.succeeded once payment confirms.
        const paymentStatus = session.payment_status;
        const isConfirmedPaid =
          paymentStatus === "paid" || paymentStatus === "no_payment_required";

        if (!isConfirmedPaid) {
          // Deferred activation (async payment methods: boleto/PIX/bank debit).
          // Even though we do NOT activate yet, the Stripe Subscription now
          // exists on the session (created when the customer completed
          // checkout). Persist that id onto the local pending invoice so the
          // later `invoice.payment_succeeded` event — which carries only the
          // Stripe subscription id, not our local invoiceId — can be matched
          // back to THIS exact invoice once the payment settles.
          if (stripeSubscriptionId && (session.metadata?.invoiceId || session.id)) {
            const correlationPatch: Record<string, unknown> = {
              stripeSubscriptionId,
              ...(stripeCustomerId ? { stripeCustomerId } : {}),
            };
            if (session.metadata?.invoiceId) {
              await tx.update(invoicesTable).set(correlationPatch)
                .where(eq(invoicesTable.id, session.metadata.invoiceId));
            } else if (session.id) {
              await tx.update(invoicesTable).set(correlationPatch)
                .where(eq(invoicesTable.stripeCheckoutSessionId, session.id));
            }
          }
          logger.info(
            { tenantId, planId, paymentStatus, sessionStatus: session.status },
            "[stripe-webhook] checkout.session.completed — payment not confirmed, deferring activation",
          );
          break;
        }

        // Resolve the metadata-linked LOCAL invoice up front. When a prior
        // invoice.payment_succeeded (e.g. an async payment settling first) has
        // ALREADY marked this invoice paid and activated the subscription using
        // its LOCAL billingPeriodEnd (preserving an annual term), a redelivered
        // or later-arriving paid checkout.session.completed must NOT re-activate
        // — doing so would overwrite the annual period with the 30-day default.
        //
        // We therefore ATOMICALLY claim the invoice PENDING→PAID with a single
        // conditional UPDATE (…WHERE id=? AND status != PAID). Only the winning
        // claimant activates. A concurrent/duplicate paid checkout, or a paid
        // checkout racing an invoice.payment_succeeded, will match zero rows on
        // the claim and skip activation — preserving the established billing
        // period and never double-activating.
        let checkoutLocalInvoice: typeof invoicesTable.$inferSelect | undefined;
        if (session.metadata?.invoiceId) {
          [checkoutLocalInvoice] = await tx.select().from(invoicesTable)
            .where(eq(invoicesTable.id, session.metadata.invoiceId))
            .limit(1);
        }

        // Native Stripe-trial Checkout Sessions (payment_status
        // "no_payment_required") carry NO local invoiceId — the upgrade flow
        // pre-provisioned a subscription row whose currentPeriodEnd is the
        // planned trial end. In that case there is nothing to claim; we activate
        // and let activateSubscriptionForTenant PRESERVE the existing trial
        // period (no periodEnd passed → no 30-day clobber).
        const hasLocalInvoice = !!session.metadata?.invoiceId;

        if (hasLocalInvoice) {
          if (checkoutLocalInvoice) {
            const claimed = await tx.update(invoicesTable).set({
              status: INVOICE_STATUS.PAID,
              paidAt: new Date(),
              ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
              ...(stripeCustomerId ? { stripeCustomerId } : {}),
            }).where(and(
              eq(invoicesTable.id, checkoutLocalInvoice.id),
              ne(invoicesTable.status, INVOICE_STATUS.PAID),
            )).returning({ id: invoicesTable.id });

            // Only the winning claimant activates, using the invoice's LOCAL
            // billingPeriodEnd so an annual term is preserved.
            if (claimed.length > 0 && tenantId && planId) {
              await activateSubscriptionForTenant(
                tx,
                tenantId,
                planId,
                stripeCustomerId,
                stripeSubscriptionId,
                checkoutLocalInvoice.billingPeriodEnd ?? undefined,
              );
              logger.info({ tenantId, planId }, "[stripe-webhook] checkout.session.completed — subscription activated");
            }
          }
        } else if (stripeSubscriptionId && session.id) {
          // No local invoiceId (Stripe-native trial or a legacy paid session).
          // Activation goes through the durable atomic subscription-level claim
          // inside activateSubscriptionForTenant (…WHERE status != ACTIVE): only
          // the winning delivery flips the pre-provisioned pending subscription
          // to ACTIVE and reports it, so two concurrent/duplicate deliveries can
          // never both activate. The native-trial period is preserved (no
          // periodEnd passed → no 30-day clobber). Then atomically claim any
          // invoice linked by the Checkout Session id.
          if (tenantId && planId) {
            const activated = await activateSubscriptionForTenant(
              tx,
              tenantId,
              planId,
              stripeCustomerId,
              stripeSubscriptionId,
              undefined,
            );
            if (activated) {
              logger.info({ tenantId, planId }, "[stripe-webhook] checkout.session.completed — subscription activated");
            }
          }

          await tx.update(invoicesTable).set({
            status: INVOICE_STATUS.PAID,
            paidAt: new Date(),
            ...(stripeCustomerId ? { stripeCustomerId } : {}),
            stripeSubscriptionId,
          }).where(and(
            eq(invoicesTable.stripeCheckoutSessionId, session.id),
            ne(invoicesTable.status, INVOICE_STATUS.PAID),
          ));
        } else if (tenantId && planId) {
          // No local invoice and no Stripe subscription id (e.g. a native trial
          // where the subscription id is absent on the session). Activate via
          // the same durable atomic subscription-level claim, preserving any
          // pre-provisioned trial period; only the winning delivery reports.
          const activated = await activateSubscriptionForTenant(
            tx,
            tenantId,
            planId,
            stripeCustomerId,
            stripeSubscriptionId,
            undefined,
          );
          if (activated) {
            logger.info({ tenantId, planId }, "[stripe-webhook] checkout.session.completed — subscription activated");
          }
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const stripeInvoice = event.data.object;
        const stripeInvoiceRaw = stripeInvoice as unknown as Record<string, unknown>;

        // tenantId/planId may live on the Stripe invoice's own metadata OR, for
        // a Subscription Checkout, on the subscription's metadata (which Stripe
        // surfaces via `subscription_details.metadata` on the invoice). Read
        // both, preferring the invoice-level metadata when present.
        const subscriptionDetails = stripeInvoiceRaw["subscription_details"] as
          | { metadata?: Record<string, string | undefined> | null }
          | undefined
          | null;
        const subMetadata = subscriptionDetails?.metadata ?? undefined;
        const tenantId = stripeInvoice.metadata?.tenantId ?? subMetadata?.tenantId;
        const planId = stripeInvoice.metadata?.planId ?? subMetadata?.planId;
        // The LOCAL invoice id is the most durable correlation handle: it is
        // stamped both on the Checkout Session metadata AND on the Stripe
        // subscription metadata (subscription_data.metadata) at upgrade time, so
        // Stripe surfaces it here via subscription_details.metadata even when
        // checkout.session.completed has not yet run (async payment races).
        const localInvoiceId = stripeInvoice.metadata?.invoiceId ?? subMetadata?.invoiceId;
        const stripeCustomerId = typeof stripeInvoice.customer === "string" ? stripeInvoice.customer : undefined;
        const stripeSubscriptionId = typeof stripeInvoiceRaw["subscription"] === "string" ? stripeInvoiceRaw["subscription"] : undefined;
        const periodEndTs = stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000) : undefined;

        // Mark local invoice paid by stripeInvoiceId
        if (stripeInvoice.id) {
          await tx.update(invoicesTable).set({
            status: INVOICE_STATUS.PAID,
            paidAt: new Date(),
            stripeInvoiceId: stripeInvoice.id,
            ...(stripeCustomerId ? { stripeCustomerId } : {}),
          }).where(eq(invoicesTable.stripeInvoiceId, stripeInvoice.id));
        }

        // ── Durable LOCAL-invoiceId correlation (preferred) ──
        // Prefer the local invoiceId carried on either the Stripe invoice
        // metadata or the subscription metadata (subscription_data.metadata).
        // This is the most durable handle because it identifies THIS exact local
        // pending invoice by its own primary id — no dependency on the Stripe
        // subscription id having been stamped by checkout.session.completed. So
        // even if invoice.payment_succeeded arrives BEFORE an (unpaid) deferred
        // checkout.session.completed, we still mark the correct invoice paid and
        // activate using its LOCAL billingPeriodEnd (preserving an annual term).
        let activatedViaCorrelation = false;
        if (localInvoiceId) {
          const [localInvoice] = await tx.select().from(invoicesTable)
            .where(eq(invoicesTable.id, localInvoiceId))
            .limit(1);

          if (localInvoice) {
            // Atomic claim: transition the invoice PENDING→PAID in a single
            // conditional UPDATE (…WHERE id=? AND status != PAID). Only the
            // winning claimant gets a returned row and may activate. Under
            // concurrent/duplicate deliveries (e.g. two invoice.payment_succeeded
            // events, or a paid checkout.session.completed racing this one), the
            // loser's UPDATE matches zero rows and it performs no activation —
            // so the tenant is never double-activated and no billing period is
            // overwritten.
            const claimed = await tx.update(invoicesTable).set({
              status: INVOICE_STATUS.PAID,
              paidAt: new Date(),
              ...(stripeInvoice.id ? { stripeInvoiceId: stripeInvoice.id } : {}),
              ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
              ...(stripeCustomerId ? { stripeCustomerId } : {}),
            }).where(and(
              eq(invoicesTable.id, localInvoice.id),
              ne(invoicesTable.status, INVOICE_STATUS.PAID),
            )).returning({ id: invoicesTable.id });

            if (claimed.length > 0) {
              const activationTenantId = tenantId ?? localInvoice.tenantId;
              const activationPlanId = planId ?? localInvoice.planId ?? undefined;
              const activationPeriodEnd = localInvoice.billingPeriodEnd ?? periodEndTs;

              if (activationTenantId && activationPlanId) {
                await activateSubscriptionForTenant(
                  tx,
                  activationTenantId,
                  activationPlanId,
                  stripeCustomerId,
                  stripeSubscriptionId,
                  activationPeriodEnd ?? undefined,
                );
                logger.info(
                  { tenantId: activationTenantId, planId: activationPlanId, invoiceId: localInvoice.id },
                  "[stripe-webhook] invoice.payment_succeeded — local invoice paid & activated",
                );
              }
            }
            // Whether we won the claim or found it already PAID, this invoice is
            // now the settled target — suppress the generic fallback so we never
            // re-activate/overwrite the preserved billing period.
            activatedViaCorrelation = true;
          }
        }

        // ── Durable Subscription-Checkout correlation (fallback) ──
        // An async Subscription Checkout produces a local PENDING invoice that
        // carries no Stripe invoice id and whose session metadata is NOT copied
        // onto this Stripe invoice. Correlate back to the exact local invoice
        // via the Stripe subscription id we persisted (at checkout creation or
        // on the deferred checkout.session.completed event). Activation uses the
        // LOCAL invoice's billingPeriodEnd so an annual term is preserved rather
        // than defaulting to the Stripe invoice period (or a 30-day fallback).
        if (!activatedViaCorrelation && stripeSubscriptionId) {
          const [localInvoice] = await tx.select().from(invoicesTable)
            .where(eq(invoicesTable.stripeSubscriptionId, stripeSubscriptionId))
            .orderBy(desc(invoicesTable.createdAt))
            .limit(1);

          if (localInvoice) {
            // Atomic claim (see local-invoiceId path above): only the winning
            // conditional UPDATE may activate, keeping concurrent/duplicate
            // deliveries idempotent.
            const claimed = await tx.update(invoicesTable).set({
              status: INVOICE_STATUS.PAID,
              paidAt: new Date(),
              ...(stripeInvoice.id ? { stripeInvoiceId: stripeInvoice.id } : {}),
              ...(stripeCustomerId ? { stripeCustomerId } : {}),
            }).where(and(
              eq(invoicesTable.id, localInvoice.id),
              ne(invoicesTable.status, INVOICE_STATUS.PAID),
            )).returning({ id: invoicesTable.id });

            if (claimed.length > 0) {
              const activationTenantId = tenantId ?? localInvoice.tenantId;
              const activationPlanId = planId ?? localInvoice.planId ?? undefined;
              const activationPeriodEnd = localInvoice.billingPeriodEnd ?? periodEndTs;

              if (activationTenantId && activationPlanId) {
                await activateSubscriptionForTenant(
                  tx,
                  activationTenantId,
                  activationPlanId,
                  stripeCustomerId,
                  stripeSubscriptionId,
                  activationPeriodEnd ?? undefined,
                );
                logger.info(
                  { tenantId: activationTenantId, planId: activationPlanId, invoiceId: localInvoice.id },
                  "[stripe-webhook] invoice.payment_succeeded — subscription-checkout invoice paid & activated",
                );
              }
            }
            activatedViaCorrelation = true;
          }
        }

        // Generic metadata-driven activation. Skipped when the durable
        // subscription-checkout correlation already activated for this invoice,
        // so we never overwrite the preserved annual billingPeriodEnd with the
        // Stripe invoice's shorter period.
        if (tenantId && planId && !activatedViaCorrelation) {
          await activateSubscriptionForTenant(tx, tenantId, planId, stripeCustomerId, stripeSubscriptionId, periodEndTs);
          logger.info({ tenantId, planId }, "[stripe-webhook] invoice.payment_succeeded — subscription activated");
        }

        // Also handle PaymentIntent metadata path
        if (stripeInvoiceRaw["payment_intent"] && typeof stripeInvoiceRaw["payment_intent"] === "string") {
          const [inv] = await tx.select().from(invoicesTable)
            .where(eq(invoicesTable.stripePaymentIntentId, stripeInvoiceRaw["payment_intent"]))
            .limit(1);
          if (inv) {
            const claimed = await tx.update(invoicesTable).set({
              status: INVOICE_STATUS.PAID,
              paidAt: new Date(),
            }).where(and(
              eq(invoicesTable.id, inv.id),
              ne(invoicesTable.status, INVOICE_STATUS.PAID),
            )).returning({ id: invoicesTable.id });

            if (claimed.length > 0 && inv.planId && inv.tenantId) {
              await activateSubscriptionForTenant(
                tx,
                inv.tenantId,
                inv.planId,
                stripeCustomerId,
                stripeSubscriptionId,
                inv.billingPeriodEnd ?? periodEndTs ?? undefined,
              );
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
          const [inv] = await tx.select().from(invoicesTable)
            .where(eq(invoicesTable.id, invoiceId))
            .limit(1);
          if (inv) {
            // Atomic claim: only the winning conditional UPDATE activates, so a
            // duplicate payment_intent.succeeded (or one racing an
            // invoice.payment_succeeded for the same local invoice) is an
            // idempotent no-op.
            const claimed = await tx.update(invoicesTable).set({
              status: INVOICE_STATUS.PAID,
              paidAt: new Date(),
              ...(stripeCustomerId ? { stripeCustomerId } : {}),
            }).where(and(
              eq(invoicesTable.id, invoiceId),
              ne(invoicesTable.status, INVOICE_STATUS.PAID),
            )).returning({ id: invoicesTable.id });

            if (claimed.length > 0) {
              // Preserve the invoice's billing period so annual invoices activate
              // for a full year. Without this, activateSubscriptionForTenant falls
              // back to a 30-day default, prematurely expiring annual subscribers.
              const periodEnd = inv.billingPeriodEnd ?? undefined;

              if (tenantId && planId) {
                await activateSubscriptionForTenant(tx, tenantId, planId, stripeCustomerId, undefined, periodEnd);
              } else if (inv.tenantId && inv.planId) {
                await activateSubscriptionForTenant(tx, inv.tenantId, inv.planId, stripeCustomerId, undefined, periodEnd);
              }
            }
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        const invoiceId = pi.metadata?.invoiceId;
        if (invoiceId) {
          await tx.update(invoicesTable).set({
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

        const subs = await tx.select().from(subscriptionsTable)
          .where(eq(subscriptionsTable.tenantId, tenantId))
          .orderBy(desc(subscriptionsTable.createdAt))
          .limit(1);

        if (subs.length > 0) {
          await tx.update(subscriptionsTable).set({
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

        await tx.update(subscriptionsTable).set({
          status: SUBSCRIPTION_STATUS.CANCELED,
          canceledAt: new Date(),
        }).where(eq(subscriptionsTable.stripeSubscriptionId, sub.id));

        await tx.update(tenantsTable).set({
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

      // Mark the claim processed only after all side effects succeeded — and
      // WITHIN the same transaction, so the processed mark commits atomically
      // with the claim and every business mutation. If this update throws, the
      // whole transaction rolls back (claim + side effects released) and Stripe
      // retries cleanly.
      await tx.update(stripeWebhookEventsTable).set({
        status: "processed",
        processedAt: new Date(),
      }).where(eq(stripeWebhookEventsTable.id, event.id));
    });

    res.json({ received: true });
  } catch (err) {
    // The transaction has already rolled back: the event claim, all business
    // mutations, and the processed mark are all undone as one unit, so no
    // partial DB writes are committed and Stripe's automatic retry can cleanly
    // reprocess. No manual claim-release is needed (rollback handles it).
    logger.error({ err, eventType: event.type }, "[stripe-webhook] Error processing event — transaction rolled back");
    if (wasDuplicate) {
      // Defensive: a duplicate short-circuit does no writes, so a throw here is
      // unexpected, but never let it 500 a benign duplicate.
      res.json({ received: true });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
}

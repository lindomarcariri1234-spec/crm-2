import { Router, type NextFunction } from "express";
import { db, tenantsTable, plansTable, invoicesTable, subscriptionsTable, usersTable, clientsTable, tripsTable } from "@workspace/db";
import { eq, and, or, count, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { logger } from "../lib/logger";
import { generatePixEMV, generatePixQrCodeUrl } from "../lib/pix";
import { persistUsageSnapshot } from "../lib/planLimits";
import { generateInvoiceNumber } from "../lib/invoiceNumber";
import { ROLES, INVOICE_STATUS, TENANT_STATUS, SUBSCRIPTION_STATUS } from "@workspace/permissions";
import { getUncachableStripeClient, getStripePublishableKey } from "../lib/stripeClient";
import { handleStripeWebhook } from "../lib/stripeWebhookHandler";
import { hasSeatMapFeature } from "../lib/plan-features";

const router = Router();

router.get("/subscriptions/current", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res, { skipTenantStatusCheck: true });
    if (!me) return;
    if (!me.tenantId) { next(new NotFoundError("No tenant", "NOT_FOUND")); return; }

    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1);
    if (!tenant) { next(new NotFoundError("Tenant not found", "NOT_FOUND")); return; }

    const allPlans = await db.select().from(plansTable).where(eq(plansTable.isActive, true)).orderBy(plansTable.sortOrder);

    const currentPlan = allPlans.find(p => p.id === tenant.planId || p.slug === tenant.planId) ?? null;

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.tenantId, me.tenantId))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(1);

    const [userCountRow] = await db
      .select({ cnt: count() })
      .from(usersTable)
      .where(eq(usersTable.tenantId, me.tenantId));
    const [clientCountRow] = await db
      .select({ cnt: count() })
      .from(clientsTable)
      .where(eq(clientsTable.tenantId, me.tenantId));
    const [tripCountRow] = await db
      .select({ cnt: count() })
      .from(tripsTable)
      .where(eq(tripsTable.tenantId, me.tenantId));

    const invoices = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.tenantId, me.tenantId))
      .orderBy(desc(invoicesTable.createdAt))
      .limit(10);

    const maxUsers = tenant.maxUsersOverride ?? currentPlan?.maxUsers ?? 3;
    const maxClients = tenant.maxClientsOverride ?? currentPlan?.maxClients ?? 500;
    const maxTrips = tenant.maxTripsOverride ?? currentPlan?.maxTrips ?? 20;

    res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        planId: tenant.planId,
        status: tenant.status,
        trialEndsAt: tenant.trialEndsAt,
      },
      plan: currentPlan,
      plans: allPlans,
      subscription: sub ?? null,
      usage: {
        users: userCountRow?.cnt ?? 0,
        clients: clientCountRow?.cnt ?? 0,
        trips: tripCountRow?.cnt ?? 0,
        maxUsers,
        maxClients,
        maxTrips,
      },
      invoices,
    });
  } catch (err) {
    next(err);
  }
});

const UpgradeBody = z.object({
  planId: z.string().optional(),
  planSlug: z.string().optional(),
  billingCycle: z.enum(["monthly", "annual"]).default("monthly"),
}).refine(d => d.planId || d.planSlug, { message: "planId or planSlug is required" });

router.post("/subscriptions/upgrade", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res, { skipTenantStatusCheck: true });
    if (!me) return;
    if (!me.tenantId) { next(new ValidationError(String("No tenant" ), "VALIDATION_ERROR")); return; }
    if (me.role !== ROLES.AGENCY_ADMIN && me.role !== ROLES.SUPER_ADMIN) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const parsed = UpgradeBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const planConditions = [
      ...(parsed.data.planId ? [eq(plansTable.id, parsed.data.planId)] : []),
      ...(parsed.data.planSlug ? [eq(plansTable.slug, parsed.data.planSlug)] : []),
    ];
    const [newPlan] = await db
      .select()
      .from(plansTable)
      .where(planConditions.length === 1 ? planConditions[0] : or(...planConditions))
      .limit(1);
    if (!newPlan) { next(new NotFoundError("Plano não encontrado", "NOT_FOUND")); return; }

    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1);
    if (!tenant) { next(new NotFoundError("Tenant não encontrado", "NOT_FOUND")); return; }

    const isDowngradeToFree = Number(newPlan.monthlyPrice) === 0;

    if (isDowngradeToFree) {
      await db.update(tenantsTable)
        .set({ planId: newPlan.slug, status: TENANT_STATUS.ACTIVE, updatedAt: new Date() })
        .where(eq(tenantsTable.id, me.tenantId));

      await db.update(subscriptionsTable)
        .set({ status: SUBSCRIPTION_STATUS.CANCELED, canceledAt: new Date() })
        .where(and(
          eq(subscriptionsTable.tenantId, me.tenantId),
          eq(subscriptionsTable.status, SUBSCRIPTION_STATUS.ACTIVE),
        ));

      await db.insert(subscriptionsTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        planId: newPlan.id,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        billingCycle: parsed.data.billingCycle,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });

      if (!hasSeatMapFeature((newPlan.supportedFeatures ?? []) as string[])) {
        await db.update(tripsTable).set({ showSeatMap: true }).where(eq(tripsTable.tenantId, me.tenantId));
      }

      res.json({ upgraded: true, plan: newPlan, invoice: null });
      return;
    }

    const trialDays = newPlan.trialDays ?? 0;

    if (trialDays > 0) {
      const priorTrialOrPaid = await db
        .select()
        .from(subscriptionsTable)
        .where(and(
          eq(subscriptionsTable.tenantId, me.tenantId),
          or(
            eq(subscriptionsTable.status, SUBSCRIPTION_STATUS.ACTIVE),
            eq(subscriptionsTable.status, SUBSCRIPTION_STATUS.TRIAL),
            eq(subscriptionsTable.status, SUBSCRIPTION_STATUS.CANCELED),
          )
        ))
        .limit(1);

      if (priorTrialOrPaid.length === 0) {
    const now = new Date();
        const trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

        // Try Stripe-native trial (creates subscription with trial_end so Stripe
        // charges automatically at trial expiration — no manual invoice needed).
        let stripeForTrial;
        try { stripeForTrial = await getUncachableStripeClient(); } catch { stripeForTrial = null; }

        let stripeCustomerIdForTrial: string | null = null;
        let stripeSubscriptionIdForTrial: string | null = null;
        let checkoutUrlForTrial: string | null = null;

        if (stripeForTrial) {
          // Find or create customer
          const existingSubsForTrial = await db
            .select()
            .from(subscriptionsTable)
            .where(eq(subscriptionsTable.tenantId, me.tenantId))
            .orderBy(desc(subscriptionsTable.createdAt))
            .limit(10);
          stripeCustomerIdForTrial = existingSubsForTrial.find(s => s.stripeCustomerId)?.stripeCustomerId ?? null;

          if (!stripeCustomerIdForTrial) {
            const existingInvForTrial = await db
              .select({ cid: invoicesTable.stripeCustomerId })
              .from(invoicesTable)
              .where(eq(invoicesTable.tenantId, me.tenantId))
              .orderBy(desc(invoicesTable.createdAt))
              .limit(5);
            stripeCustomerIdForTrial = existingInvForTrial.find(i => i.cid)?.cid ?? null;
          }

          if (!stripeCustomerIdForTrial) {
            const [adminUserForTrial] = await db
              .select({ email: usersTable.email, name: usersTable.name })
              .from(usersTable)
              .where(and(eq(usersTable.tenantId, me.tenantId), eq(usersTable.role, ROLES.AGENCY_ADMIN)))
              .limit(1);
            const customerForTrial = await stripeForTrial.customers.create({
              email: adminUserForTrial?.email ?? undefined,
              name: adminUserForTrial?.name ?? undefined,
              metadata: { tenantId: me.tenantId },
            });
            stripeCustomerIdForTrial = customerForTrial.id;
          }

          // Find a Stripe price for this plan
          const priceIntervalForTrial = parsed.data.billingCycle === "annual" ? "year" : "month";
          const trialPriceAmount = parsed.data.billingCycle === "annual"
            ? Number(newPlan.annualPrice) : Number(newPlan.monthlyPrice);
          const amountCentsForTrial = Math.round(trialPriceAmount * 100);

          const stripePricesForTrial = await stripeForTrial.prices.search({
            query: `metadata['planSlug']:'${newPlan.slug}' AND active:'true'`,
          });
          const matchingPriceForTrial = stripePricesForTrial.data.find(
            p => p.recurring?.interval === priceIntervalForTrial &&
                 p.unit_amount === amountCentsForTrial &&
                 p.currency === "brl"
          );

          if (matchingPriceForTrial) {
            // Create Stripe Checkout Session with trial_end — Stripe charges automatically
    const frontendUrl = process.env["FRONTEND_URL"]
      ?? (process.env["REPLIT_DEV_DOMAIN"] ? `https://${process.env["REPLIT_DEV_DOMAIN"]}` : "");
      const successUrl = `${frontendUrl}/configuracoes?tab=plano&payment=success`;
      const cancelUrl = `${frontendUrl}/configuracoes?tab=plano&payment=cancel`;

            const trialSession = await stripeForTrial.checkout.sessions.create({
              mode: "subscription",
              customer: stripeCustomerIdForTrial ?? undefined,
              line_items: [{ price: matchingPriceForTrial.id, quantity: 1 }],
              success_url: successUrl,
              cancel_url: cancelUrl,
              client_reference_id: me.tenantId,
              metadata: { tenantId: me.tenantId, planId: newPlan.id },
              subscription_data: {
                trial_end: Math.floor(trialEnd.getTime() / 1000),
                metadata: { tenantId: me.tenantId, planId: newPlan.id },
              },
            });
            checkoutUrlForTrial = trialSession.url;
            stripeSubscriptionIdForTrial = typeof trialSession.subscription === "string"
              ? trialSession.subscription : null;
          }
        }

        // If Stripe Checkout URL is available, do NOT activate trial yet.
        // Activation happens via checkout.session.completed webhook (ensures payment method captured).
        if (checkoutUrlForTrial) {
          // Mark tenant as pending so they know checkout is required
          await db.update(tenantsTable)
            .set({ pendingPlanId: newPlan.slug, status: TENANT_STATUS.PENDING_PAYMENT, updatedAt: now })
            .where(eq(tenantsTable.id, me.tenantId));

          await db.insert(subscriptionsTable).values({
            id: generateId(),
            tenantId: me.tenantId,
            planId: newPlan.id,
            status: SUBSCRIPTION_STATUS.PENDING_PAYMENT,
            billingCycle: parsed.data.billingCycle,
            currentPeriodStart: now,
            currentPeriodEnd: trialEnd,
            trialStart: now,
            trialEnd,
            ...(stripeCustomerIdForTrial ? { stripeCustomerId: stripeCustomerIdForTrial } : {}),
          });

          void persistUsageSnapshot(me.tenantId);
          res.json({ upgraded: false, pendingInvoice: true, trial: true, trialDays, trialEndsAt: trialEnd, plan: newPlan, invoice: null, checkoutUrl: checkoutUrlForTrial });
          return;
        }

        // No Stripe → activate trial immediately (PIX payment method captured later)
        await db.update(tenantsTable)
          .set({ planId: newPlan.slug, status: TENANT_STATUS.ACTIVE, updatedAt: now })
          .where(eq(tenantsTable.id, me.tenantId));

        await db.insert(subscriptionsTable).values({
          id: generateId(),
          tenantId: me.tenantId,
          planId: newPlan.id,
          status: SUBSCRIPTION_STATUS.TRIAL,
          billingCycle: parsed.data.billingCycle,
          currentPeriodStart: now,
          currentPeriodEnd: trialEnd,
          trialStart: now,
          trialEnd,
        });

        void persistUsageSnapshot(me.tenantId);
        res.json({ upgraded: true, trial: true, trialDays, trialEndsAt: trialEnd, plan: newPlan, invoice: null });
        return;
      }
    }

    // Try Stripe Checkout Session first; fall back to PIX if Stripe not configured
    let stripe;
    try {
      stripe = await getUncachableStripeClient();
    } catch {
      stripe = null;
    }

    const price = parsed.data.billingCycle === "annual"
      ? Number(newPlan.annualPrice)
      : Number(newPlan.monthlyPrice);

    const now = new Date();
    const periodStart = now;
    const periodDays = parsed.data.billingCycle === "annual" ? 365 : 30;
    const periodEnd = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000);
    const dueDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const invoiceId = generateId();
    const invoiceNumber = await generateInvoiceNumber(me.tenantId, now.getFullYear());

    if (stripe) {
      // ── Stripe Checkout Session path ──
      // Find or create Stripe customer for this tenant
      const existingSubs = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.tenantId, me.tenantId))
        .orderBy(desc(subscriptionsTable.createdAt))
        .limit(10);

    let stripeCustomerId = existingSubs.find(s => s.stripeCustomerId)?.stripeCustomerId ?? null;
      if (!stripeCustomerId) {
        const existingInv = await db
          .select({ cid: invoicesTable.stripeCustomerId })
          .from(invoicesTable)
          .where(eq(invoicesTable.tenantId, me.tenantId))
          .orderBy(desc(invoicesTable.createdAt))
          .limit(10);
        stripeCustomerId = existingInv.find(i => i.cid)?.cid ?? null;
      }

      if (!stripeCustomerId) {
      const [adminUser] = await db
        .select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(and(eq(usersTable.tenantId, me.tenantId), eq(usersTable.role, ROLES.AGENCY_ADMIN)))
        .limit(1);

      const customer = await stripe.customers.create({
        email: adminUser?.email ?? undefined,
        name: adminUser?.name ?? undefined,
        metadata: { tenantId: me.tenantId },
      });
        stripeCustomerId = customer.id;

        if (existingSubs.length > 0) {
          await db.update(subscriptionsTable)
            .set({ stripeCustomerId })
            .where(eq(subscriptionsTable.id, existingSubs[0]!.id));
        }
      }

      // Find active Stripe price matching plan + billing cycle
      const priceInterval = parsed.data.billingCycle === "annual" ? "year" : "month";
      const amountCents = Math.round(price * 100);

      const stripePrices = await stripe.prices.search({
        query: `metadata['planSlug']:'${newPlan.slug}' AND active:'true'`,
      });

      const matchingPrice = stripePrices.data.find(
        p => p.recurring?.interval === priceInterval && p.unit_amount === amountCents && p.currency === "brl"
      );

      // Early validation: fail BEFORE any DB writes if no recurring price found.
      // A one-time payment would NOT create a Stripe subscription, so the
      // checkout.session.completed webhook handler would fail to activate the
      // tenant plan — the customer would pay but remain on the free tier.
      // By returning here we leave tenant, invoice, and subscription tables
      // completely untouched, avoiding stale PENDING_PAYMENT state.
      if (!matchingPrice) {
        logger.warn(
          { planSlug: newPlan.slug, billingCycle: parsed.data.billingCycle, amountCents },
          "[subscriptions/upgrade] No recurring Stripe price found — blocking checkout to prevent silent one-time payment fallback",
        );
        next(new AppError(
          `Preço recorrente não encontrado para o plano "${newPlan.name}" (${parsed.data.billingCycle === "annual" ? "anual" : "mensal"}). Configure um preço Stripe com metadata planSlug="${newPlan.slug}".`,
          400,
          "STRIPE_PRICE_NOT_FOUND",
        ));
        return;
      }

    const frontendUrl = process.env["FRONTEND_URL"]
      ?? (process.env["REPLIT_DEV_DOMAIN"] ? `https://${process.env["REPLIT_DEV_DOMAIN"]}` : "");
      const successUrl = `${frontendUrl}/configuracoes?tab=plano&payment=success`;
      const cancelUrl = `${frontendUrl}/configuracoes?tab=plano&payment=cancel`;

      // Create pending invoice record
      await db.insert(invoicesTable).values({
        id: invoiceId,
        invoiceNumber,
        tenantId: me.tenantId,
        planId: newPlan.id,
        amount: String(price),
        currency: "BRL",
        status: INVOICE_STATUS.PENDING,
        paymentMethod: "card",
        dueDate,
        description: `Assinatura ${newPlan.name} — ${parsed.data.billingCycle === "annual" ? "Anual" : "Mensal"}`,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        stripeCustomerId,
      });

      await db.update(tenantsTable)
        .set({ status: TENANT_STATUS.PENDING_PAYMENT, pendingPlanId: newPlan.slug, updatedAt: now })
        .where(eq(tenantsTable.id, me.tenantId));

      await db.insert(subscriptionsTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        planId: newPlan.id,
        status: SUBSCRIPTION_STATUS.PENDING_PAYMENT,
        billingCycle: parsed.data.billingCycle,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        stripeCustomerId,
      });

      void persistUsageSnapshot(me.tenantId);

      // matchingPrice is guaranteed to exist here (early return above guards this)
      const checkoutSession = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: stripeCustomerId,
        line_items: [{ price: matchingPrice.id, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: me.tenantId,
        metadata: { tenantId: me.tenantId, planId: newPlan.id, invoiceId },
        subscription_data: {
          // Carry the LOCAL invoiceId onto the Stripe subscription metadata so a
          // later asynchronous `invoice.payment_succeeded` — which Stripe surfaces
          // via `subscription_details.metadata` on the invoice — can be matched
          // back to THIS exact local pending invoice even if
          // `checkout.session.completed` has not run yet (and thus the durable
          // subscription-id correlation has not been stamped).
          metadata: { tenantId: me.tenantId, planId: newPlan.id, invoiceId },
        },
      });

      // Persist durable Stripe correlation IDs on the local invoice so a later
      // asynchronous `invoice.payment_succeeded` webhook — which for a
      // Subscription Checkout carries only the Stripe subscription id (and not
      // our local invoiceId metadata) — can be matched back to THIS exact
      // pending invoice. `checkoutSession.subscription` is typically null at
      // creation time for mode: "subscription" (Stripe creates it when the
      // customer completes checkout); the webhook path fills it in later.
      const checkoutInvoicePatch: Partial<typeof invoicesTable.$inferInsert> = {
        stripeCheckoutSessionId: checkoutSession.id,
      };
      if (checkoutSession.payment_intent && typeof checkoutSession.payment_intent === "string") {
        checkoutInvoicePatch.stripePaymentIntentId = checkoutSession.payment_intent;
      }
      if (typeof checkoutSession.subscription === "string") {
        checkoutInvoicePatch.stripeSubscriptionId = checkoutSession.subscription;
      }
      await db.update(invoicesTable).set(checkoutInvoicePatch).where(eq(invoicesTable.id, invoiceId));

      const [createdInvoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
      res.json({ upgraded: false, pendingInvoice: true, plan: newPlan, invoice: createdInvoice, checkoutUrl: checkoutSession.url });
      return;
    }

    // ── PIX fallback (when Stripe is not configured) ──
    const pixKey = process.env["PIX_KEY"];
    const pixName = process.env["PIX_NAME"] ?? "VisiteCRM";
    const pixCity = process.env["PIX_CITY"] ?? "SAO PAULO";

    let pixCode: string | null = null;
    let pixQrCodeUrl: string | null = null;
    const pixExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (pixKey) {
      pixCode = generatePixEMV({
        key: pixKey,
        name: pixName,
        city: pixCity,
        amount: price,
        txid: invoiceId.slice(0, 25),
        description: `Plano ${newPlan.name}`,
      });
      pixQrCodeUrl = generatePixQrCodeUrl(pixCode);
    }

    await db.insert(invoicesTable).values({
      id: invoiceId,
      invoiceNumber,
      tenantId: me.tenantId,
      planId: newPlan.id,
      amount: String(price),
      currency: "BRL",
      status: INVOICE_STATUS.PENDING,
      paymentMethod: pixKey ? "pix" : "manual",
      dueDate,
      description: `Assinatura ${newPlan.name} — ${parsed.data.billingCycle === "annual" ? "Anual" : "Mensal"}`,
      billingPeriodStart: periodStart,
      billingPeriodEnd: periodEnd,
      pixCode: pixCode ?? null,
      pixQrCodeUrl: pixQrCodeUrl ?? null,
      pixExpiresAt: pixKey ? pixExpiresAt : null,
    });

    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);

    await db.update(tenantsTable)
      .set({ status: TENANT_STATUS.PENDING_PAYMENT, pendingPlanId: newPlan.slug, updatedAt: now })
      .where(eq(tenantsTable.id, me.tenantId));

    void persistUsageSnapshot(me.tenantId);

    await db.insert(subscriptionsTable).values({
      id: generateId(),
      tenantId: me.tenantId,
      planId: newPlan.id,
      status: SUBSCRIPTION_STATUS.PENDING_PAYMENT,
      billingCycle: parsed.data.billingCycle,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });

    res.json({ upgraded: false, pendingInvoice: true, plan: newPlan, invoice });
  } catch (err) {
    next(err);
  }
});

router.post("/invoices/:id/pix", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res, { skipTenantStatusCheck: true });
    if (!me) return;

    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, req.params.id)).limit(1);
    if (!invoice) { next(new NotFoundError("Fatura não encontrada", "NOT_FOUND")); return; }

    if (me.role !== ROLES.SUPER_ADMIN && invoice.tenantId !== me.tenantId) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const pixKey = process.env["PIX_KEY"];
    if (!pixKey) { next(new ValidationError(String("PIX não configurado. Entre em contato com o suporte." ), "VALIDATION_ERROR")); return; }

    const pixName = process.env["PIX_NAME"] ?? "VisiteCRM";
    const pixCity = process.env["PIX_CITY"] ?? "SAO PAULO";

    const pixCode = generatePixEMV({
      key: pixKey,
      name: pixName,
      city: pixCity,
      amount: Number(invoice.amount),
      txid: invoice.id.slice(0, 25),
      description: invoice.description?.slice(0, 40) ?? "Assinatura VisiteCRM",
    });
    const pixQrCodeUrl = generatePixQrCodeUrl(pixCode);
    const pixExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.update(invoicesTable).set({
      pixCode,
      pixQrCodeUrl,
      pixExpiresAt,
      paymentMethod: "pix",
      status: INVOICE_STATUS.PROCESSING,
    }).where(eq(invoicesTable.id, req.params.id));

    const [updated] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, req.params.id)).limit(1);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post("/invoices/:id/stripe/checkout", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res, { skipTenantStatusCheck: true });
    if (!me) return;

    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, req.params.id)).limit(1);
    if (!invoice) { next(new NotFoundError("Fatura não encontrada", "NOT_FOUND")); return; }
    if (me.role !== ROLES.SUPER_ADMIN && invoice.tenantId !== me.tenantId) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    if (invoice.status === INVOICE_STATUS.PAID) { next(new ValidationError(String("Fatura já está paga" ), "VALIDATION_ERROR")); return; }

    let stripe;
    try {
      stripe = await getUncachableStripeClient();
    } catch {
      next(new ValidationError("Stripe não configurado. Entre em contato com o suporte.", "VALIDATION_ERROR"));
      return;
    }

    const amountCents = Math.round(Number(invoice.amount) * 100);

    // Find or create a Stripe customer for this tenant so the portal works later
    const existingSub = await db
      .select()
      .from(subscriptionsTable)
      .where(and(
        eq(subscriptionsTable.tenantId, invoice.tenantId),
        // stripeCustomerId must not be null — Drizzle handles this via .isNotNull() but a simple filter works too
      ))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(10);

    let stripeCustomerId = existingSub.find(s => s.stripeCustomerId)?.stripeCustomerId ?? null;

    if (!stripeCustomerId) {
      const [adminUser] = await db
        .select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(and(eq(usersTable.tenantId, me.tenantId), eq(usersTable.role, ROLES.AGENCY_ADMIN)))
        .limit(1);

      const customer = await stripe.customers.create({
        email: adminUser?.email ?? undefined,
        name: adminUser?.name ?? undefined,
        metadata: { tenantId: me.tenantId },
      });
      stripeCustomerId = customer.id;

      // Persist on the most recent subscription
      if (existingSub.length > 0) {
        await db.update(subscriptionsTable)
          .set({ stripeCustomerId })
          .where(eq(subscriptionsTable.id, existingSub[0]!.id));
      }
    }

    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "brl",
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      metadata: { invoiceId: invoice.id, tenantId: invoice.tenantId },
      description: invoice.description ?? "Assinatura VisiteCRM",
    });

    await db.update(invoicesTable).set({
      paymentMethod: "card",
      stripePaymentIntentId: pi.id,
      stripeCustomerId,
    }).where(eq(invoicesTable.id, req.params.id));

    const publishableKey = await getStripePublishableKey();

    res.json({ clientSecret: pi.client_secret!, paymentIntentId: pi.id, publishableKey });
  } catch (err) {
    next(err);
  }
});

router.post("/subscriptions/portal", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res, { skipTenantStatusCheck: true });
    if (!me) return;
    if (!me.tenantId) { next(new ValidationError(String("No tenant" ), "VALIDATION_ERROR")); return; }
    if (me.role !== ROLES.AGENCY_ADMIN && me.role !== ROLES.SUPER_ADMIN) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    let stripe;
    try {
      stripe = await getUncachableStripeClient();
    } catch {
      next(new ValidationError("Stripe não configurado. Entre em contato com o suporte.", "VALIDATION_ERROR"));
      return;
    }

    // Look up an existing Stripe customer for this tenant
    const subs = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.tenantId, me.tenantId))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(10);

    let stripeCustomerId = subs.find(s => s.stripeCustomerId)?.stripeCustomerId ?? null;

    // Also check invoices table as a fallback
    if (!stripeCustomerId) {
      const inv = await db
        .select({ stripeCustomerId: invoicesTable.stripeCustomerId })
        .from(invoicesTable)
        .where(eq(invoicesTable.tenantId, me.tenantId))
        .orderBy(desc(invoicesTable.createdAt))
        .limit(10);
      stripeCustomerId = inv.find(i => i.stripeCustomerId)?.stripeCustomerId ?? null;
    }

    if (!stripeCustomerId) {
      // Create a new customer so the portal can be accessed
      const [adminUser] = await db
        .select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(and(eq(usersTable.tenantId, me.tenantId), eq(usersTable.role, ROLES.AGENCY_ADMIN)))
        .limit(1);

      const customer = await stripe.customers.create({
        email: adminUser?.email ?? undefined,
        name: adminUser?.name ?? undefined,
        metadata: { tenantId: me.tenantId },
      });
      stripeCustomerId = customer.id;

      if (subs.length > 0) {
        await db.update(subscriptionsTable)
          .set({ stripeCustomerId })
          .where(eq(subscriptionsTable.id, subs[0]!.id));
      }
    }

    const frontendUrl = process.env["FRONTEND_URL"]
      ?? (process.env["REPLIT_DEV_DOMAIN"] ? `https://${process.env["REPLIT_DEV_DOMAIN"]}` : "");
    const returnUrl = `${frontendUrl}/configuracoes?tab=plano`;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    res.json({ portalUrl: portalSession.url });
  } catch (err) {
    next(err);
  }
});

router.post("/webhooks/stripe", (req, res) => void handleStripeWebhook(req, res));

export default router;

---
name: Stripe payment confirmation activation
description: Guardrails for subscription activation after Checkout Session and PaymentIntent webhook events.
---

Only activate a tenant and mark an invoice paid after a confirmed paid payment event. A `checkout.session.completed` event alone is insufficient for delayed or asynchronous payment methods; it must have `payment_status: "paid"` (or the intentional Stripe trial state `"no_payment_required"`). When an invoice is activated from `payment_intent.succeeded`, pass its persisted `billingPeriodEnd` through to subscription activation.

Stripe webhooks are at-least-once and can arrive in any order. Claim each signed Stripe event by its ID, execute the claim, all invoice/subscription/tenant writes, and its processed marker in one database transaction. A duplicate event must exit without side effects; a failure must roll back the claim and every write so Stripe can retry cleanly.

**Why:** Checkout sessions can complete before payment settles, and the activation helper otherwise defaults to a 30-day term. Activating early grants access without payment; dropping the invoice period shortens annual subscriptions to one month. Separately, a non-transactional event ledger can permanently swallow a crash or leave a paid invoice without activation after a partial failure.

**How to apply:** Keep tenant ownership authorization on invoice checkout creation, let webhooks confirm payment before activation, and cover unpaid Checkout Sessions plus annual PaymentIntent completions with route-level regression tests. Test duplicate, concurrent, reverse-order, and injected-failure deliveries whenever webhook processing changes.
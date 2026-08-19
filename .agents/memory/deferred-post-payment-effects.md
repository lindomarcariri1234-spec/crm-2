---
name: Deferred post-payment side effects & product-only gateway gap
description: Why post-payment side effects wired through applyGatewayPayment's non-null result silently skip paid product-only store orders, and how idempotency is enforced.
---

# Deferred referral/credit effects gated behind store-order payment

Anonymous storefront checkout must NOT credit a referrer or consume a customer's
referral/loyalty credit before money is captured. The consume + referrer-conversion
crediting are deferred from checkout to payment confirmation: checkout only stores
the intent on `store_orders` (`pending_referral`, `pending_credit_spend`) and applies
the DISCOUNT; the actual effects run in `applyDeferredOrderCredits(orderId)` invoked
from `runPostPaymentSideEffects`.

## The gotcha: product-only gateway orders
`applyGatewayPayment` (webhooks.ts) returns `null` for **product-only** paid orders
(`reservations.length === 0`), and the Stripe/MP call sites only run
`runPostPaymentSideEffects` when the result is non-null. So if you wire ANY
payment-gated side effect through that non-null result, it is **silently skipped for
paid product-only gateway orders**. Fix: the product-only branch returns
`{ orderId, reservationIds: [], tenantId }` so the caller still runs post-payment
effects (the empty reservationIds loop emits no booking emails).

**Why:** product-only orders have no reservations to allocate `payments` rows to, so
the original code bailed early with `null` — which doubled as "no post-payment work",
an assumption that broke once referral/credit effects moved to payment time.

## Idempotency rule (critical)
Product-only orders create **no `payments` rows**, so `paymentExistsForGatewayTx`
(the gateway dedup guard) NEVER dedupes them — a duplicate webhook re-enters the
product-only branch every time. This is only safe because every post-payment step is
idempotent on its own:
- `applyDeferredOrderCredits` runs in its OWN tx, locks the order `FOR UPDATE`, and
  no-ops once `referralEffectsAppliedAt` is set (and unless `paymentStatus === PAID`).
  The marker is written at the END so a mid-tx failure stays retryable.
- `generateAndAssignReferralCode` returns the existing code if one exists.
- `ensurePortalAccount` no-ops if the portal user exists; product-only orders skip it.

**How to apply:** any new payment-gated side effect must be idempotent on its own
marker/state — do NOT rely on `paymentExistsForGatewayTx` to gate it, especially for
product-only orders. The manual mark-paid path (store.ts order status PUT) already
calls `runPostPaymentSideEffects` unconditionally on the PAID transition.

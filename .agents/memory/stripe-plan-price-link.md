---
name: Stripe plan→price link (metadata-only)
description: How VisiteCRM subscription checkout resolves a Stripe price, and the two ways it silently breaks.
---

# Stripe plan → price resolution

The `plans` table has **no** `stripePriceId` column. Subscription checkout in
`artifacts/api-server/src/routes/subscriptions.ts` resolves the Stripe price at
request time with `stripe.prices.search({ query: "metadata['planSlug']:'<slug>' AND active:'true'" })`,
then picks the recurring price matching the requested billing cycle + amount + `brl`.

## Two silent failure modes (both hit production Stripe checkout)

1. **Empty `plans` table** → `/subscriptions/upgrade` returns 404. A freshly
   deployed/empty DB has no plan rows because plan seeding historically was
   manual-only. Fixed by `seedPlansIfMissing()` (startup, insert-only). The
   standalone `seed:plans` script does ON CONFLICT DO UPDATE for intentional re-sync.

2. **Stripe price missing `metadata.planSlug`** → `prices.search` returns nothing,
   so checkout silently falls back to **one-time payment mode** instead of a
   subscription. Live products created manually in the Stripe dashboard usually
   lack this metadata. The `seed-stripe-plans.ts` script creates prices WITH
   `planSlug`/`planId`/`cycle` metadata (monthly + annual); manual dashboard
   products do not.

**Why:** the only join between a DB plan and a Stripe price is the `planSlug`
metadata string. No metadata = no link = degraded checkout, with no error surfaced.

**How to apply:** any Stripe price intended for subscription checkout MUST carry
`metadata.planSlug` equal to the plan slug. When auditing, run the exact search
the code runs, not a product list.

## prices.search is eventually consistent
Stripe's Search API is index-backed and lags a few seconds behind metadata
writes. Right after creating/updating a price's metadata, `prices.search` can
return 0 results transiently. Re-verify after a short delay; don't conclude the
metadata write failed.

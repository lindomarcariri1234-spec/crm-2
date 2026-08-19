---
name: stripe-replit-sync managed webhook auto-secret
description: How the webhook signing secret is auto-sourced from stripe._managed_webhooks so STRIPE_WEBHOOK_SECRET doesn't need to be set manually
---

# Stripe managed webhook auto-secret pattern

## The pattern
`stripe._managed_webhooks` (created by stripe-replit-sync's runMigrations) has a `secret text NOT NULL` column storing the signing secret at webhook creation time. On subsequent restarts Stripe's GET doesn't return the secret, but it's still in the DB.

`initStripeSync` caches it in `_cachedManagedWebhookSecret`:
- If `webhook.secret` is present in the creation response → cache directly
- Otherwise → query `stripe._managed_webhooks WHERE url = ?` via `_stripeSyncInstance.postgresClient`

`handleStripeWebhook` in `stripeWebhookHandler.ts` now falls back:
```
(await getStripeWebhookSecret()) ?? (await getManagedWebhookSigningSecret()) ?? undefined
```

So `STRIPE_WEBHOOK_SECRET` is optional — the managed webhook secret is used automatically.

**Why:** eliminates the manual copy-paste of the signing secret after production first-boot.

**How to apply:** If the signing secret fallback stops working, query `SELECT secret FROM stripe._managed_webhooks WHERE url = 'https://<domain>/api/stripe/webhook'` to verify the secret is stored.

## Production key path
`initStripeSync` now calls `getStripeSecretKey()` (from `stripeClient.ts`) instead of reading `process.env["STRIPE_SECRET_KEY"]` directly. `getStripeSecretKey()` uses the Replit Connector first (returns live key in REPLIT_DEPLOYMENT=1), falls back to env var. This ensures production runs with the live Stripe key for StripeSync.

## Architecture note
`handleStripeWebhook` and `initStripeSync`/`getStripeSync()` are two independent paths:
- App webhook handler: verifies signature, runs business logic (activate subscription, mark invoice paid)
- stripe-replit-sync: syncs Stripe objects to stripe.* tables for analytics/reporting

The managed webhook creation by stripe-replit-sync creates a Stripe webhook endpoint that delivers to the SAME URL, so one HTTP call serves both purposes.

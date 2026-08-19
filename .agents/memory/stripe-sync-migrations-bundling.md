---
name: stripe-replit-sync migrations under esbuild
description: Why stripe.* tables were never created and how the bundled migration runner must be fed its SQL folder
---

# stripe-replit-sync migrations under esbuild bundling

`stripe-replit-sync` does NOT auto-migrate on `new StripeSync(...)`. You must call the
exported `runMigrations({ databaseUrl, ssl, logger })` separately to create the `stripe`
schema and its ~29 tables. `initStripeSync` originally skipped this, so the engine failed
at runtime with `relation "stripe.accounts" does not exist` (and `stripe._sync_status`).

**The bundling trap:** `runMigrations` loads its SQL via `path.resolve(__dirname, "./migrations")`.
api-server is bundled by esbuild into a single `dist/index.mjs`, and `build.mjs`'s banner sets
`globalThis.__dirname` to the bundle dir. So at runtime the package looks for
`artifacts/api-server/dist/migrations` (which doesn't exist) and silently logs
`Migrations directory ... not found, skipping` — the call "succeeds" but creates nothing.

**Fix (two parts, both required):**
1. Call `runMigrations(...)` as step 0 of `initStripeSync` (before `new StripeSync`).
2. In `build.mjs`, copy the package's `dist/migrations` folder into the api-server bundle's
   `dist/migrations` so the bundled runner finds them. Resolve via
   `createRequire(import.meta.url).resolve("stripe-replit-sync")` then `dirname + "migrations"`.

**Why:** any node package that reads sibling data files via `__dirname` breaks when bundled —
either externalize it (like http-proxy-middleware) or copy its data assets into the bundle dir.

**How to apply:** verify with `SELECT table_name FROM information_schema.tables WHERE table_schema='stripe'`
(expect ~29 tables) and a clean startup showing `[stripe-sync] syncBackfill complete`.

**Architecture note:** the app's own `handleStripeWebhook` (`/api/stripe/webhook`) verifies with
`STRIPE_WEBHOOK_SECRET` and does the business logic (activate subscription, mark invoice paid).
It does NOT call `getStripeSync().processWebhook()`, so stripe-sync's `findOrCreateManagedWebhook`
is an independent data-sync path. Two Stripe webhook endpoints can point at the same URL; only the
one whose secret == STRIPE_WEBHOOK_SECRET will pass app-side signature verification.

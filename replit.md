# VisiteCRM

## Overview

VisiteCRM is a comprehensive SaaS CRM platform designed for Brazilian tourism agencies specializing in group excursions. Its primary purpose is to streamline operations for these agencies by offering multi-tenancy, robust role-based access, and extensive features for managing trips, seats, and reservations. The platform also includes financial tracking, a Kanban sales pipeline, communication tools, automation capabilities, loyalty programs, a referral system, NPS (Net Promoter Score) measurement, and advanced analytics. VisiteCRM aims to be the leading operational backbone for Brazilian tourism agencies, enhancing efficiency, customer engagement, and business growth in a specialized market segment.

## User Preferences

I want iterative development. I prefer planned reporting for complex features and architectural decisions. Consult before making major changes to the database schema or core architectural patterns. Do not make changes to files related to `artifacts/mockup-sandbox`.

## System Architecture

VisiteCRM is built as a pnpm workspace monorepo utilizing TypeScript.

### Stack
- **Monorepo Tool**: pnpm workspaces
- **Node.js**: 24
- **Frontend**: React 19, Vite, Tailwind CSS v4, shadcn/ui
- **Authentication**: Clerk (`@clerk/react`, `@clerk/express`)
- **API Framework**: Express 5
- **Database**: PostgreSQL with Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API Codegen**: Orval (from OpenAPI spec in `lib/api-spec`)
- **Build Tools**: esbuild (API), Vite (frontend)

### Artifacts
- **`artifacts/visitecrm`**: React frontend, port 19951, accessible at `/`
- **`artifacts/api-server`**: Express API server, port 8080, routes at `/api`

### Replit Development Setup

- **Runtime**: Node.js 24 and pnpm workspaces. Install the locked dependency tree with `pnpm install --frozen-lockfile`.
- **Web preview**: run the `artifacts/visitecrm: web` workflow (Vite on port 19951). It proxies `/api` requests to the local API.
- **API**: run the `artifacts/api-server: API Server` workflow (Express on port 8080). It requires `CLERK_SECRET_KEY`, `CREDENTIAL_ENCRYPTION_KEY`, and Replit-provided `DATABASE_URL`; the development Clerk publishable key is configured as an environment variable.
- **Optional integrations**: uploads require `UPLOADTHING_TOKEN`; email delivery requires `RESEND_API_KEY`; Redis-backed queues require `REDIS_URL`. The API starts without these optional services, using its documented development fallbacks.

### Core Features and Design Patterns
- **Multi-tenancy**: Each agency operates as a distinct tenant with isolated data.
- **Role-Based Access Control (RBAC)**: Supports roles like `superadmin`, `agencia`, `vendedor`, and `cliente` with fine-grained permissions enforced at the API level.
- **UI/UX**: Frontend uses React with Tailwind CSS and shadcn/ui for a modern, responsive design. All user-facing content is in Brazilian Portuguese.
- **Authentication & Onboarding**: Integrates Clerk for authentication. New agencies go through a multi-step onboarding process to create their tenant. Users are synced to the database upon login.
- **Key Modules**: Dashboard (KPIs/charts/funnels), Pipeline (Kanban), Trip & Reservation Management (seat mapping, PDF exports), Financials (receivables/payables/expenses), Communication & Automation, Marketing (campaigns/NPS), Registrations (suppliers/vehicles/accommodations/destinations), Admin Panel (superadmin tenant/plan/billing/user management + SaaS metrics).
- **Database Schema**: Drizzle ORM manages a PostgreSQL database. Uses text IDs generated with `generateId()` for all tables instead of serial integers.
- **API Design**: All API routes are prefixed with `/api/` and follow RESTful principles.
- **Reservation Numbering**: A structured, human-readable reservation numbering system (`{PREFIX}-{TYPE}-{YYYYMM}-{NNNNN}`) is implemented for clarity and traceability.
- **Google Calendar Integration**: OAuth flow for connecting Google Calendar, with auto-sync hooks for trip events, payments, and birthdays. Supports automatic token refresh.

### Multi-Tenant Online Store
The platform includes a multi-tenant e-commerce solution with both an admin panel for agencies and a public storefront.
- **Admin Panel (`/loja/*`)**: For store settings, product/category/coupon CRUD, order management, and review moderation.
- **Public Vitrine (`/loja/:slug/*`)**: An unauthenticated storefront for customers to browse products, view details, checkout, and track orders.

### Async Job Queue (BullMQ)
- **Package**: `bullmq` v5 + `ioredis` in `@workspace/api-server`. Connection in `src/lib/redis.ts` reads `REDIS_URL`; gracefully disabled when absent (falls back to synchronous email + node-cron fallbacks).
- **Queues**: `emails` (3 retries, exponential backoff) and `reminders`, defined in `src/queues/index.ts`.
- **Workers**: `src/workers/email.worker.ts` (reservation-confirmation) and `src/workers/reminder.worker.ts` (D-1 boarding, D-3 payment reminders), started on boot when Redis is available. Repeatable jobs run at 08:00 BRT daily (`REMINDER_CRON`/`REMINDER_TZ`).
- **Resend endpoint**: `POST /api/email-logs/:id/resend` — restricted to `MANAGEMENT_ROLES`, only for `status=failed` logs (422 otherwise); creates a fresh `email_logs` row + delivery job per attempt.
- **Reminder retry semantics**: batch jobs never throw on individual send failures (avoids double-sending to already-reached recipients) — an intentional reliability tradeoff. See `src/workers/reminder.worker.ts`.
- **Worker tuning**: environment-aware concurrency/polling (`NODE_ENV !== "production"` guard) — dev uses low concurrency and a 30s `drainDelay` to conserve Redis request budget (Upstash free tier); production favors responsiveness (`stalledInterval: 15s`, default `drainDelay`).

### Real-Time Seat Availability (SSE)
- **Module**: `artifacts/api-server/src/lib/seat-sse.ts` — in-memory registry of `tripId → Set<Response>`.
- **Endpoints**: `GET /api/public/store/:slug/trips/:tripId/seats/stream` (no auth, Vitrine) and `GET /api/trips/:tripId/seats/stream` (Clerk auth, admin).
- **Emit triggers**: `broadcastSeatUpdate(tripId, tenantId)` fires (fire-and-forget) after any seat-changing operation (reservation create/update/delete, Vitrine checkout).
- **Frontend hook**: `artifacts/visitecrm/src/hooks/useSeatStream.ts`, used by the reservation wizard's seat-picker step; auto-deselects seats that become occupied via SSE.
- **Multi-instance fan-out**: when `REDIS_URL` is set, updates are published to a Redis `seat-updates` channel so all horizontally-scaled replicas stay in sync; falls back to direct in-memory emit otherwise.

## Testing Infrastructure

- **Test framework**: Vitest v3
- **Run all tests**: `pnpm test` (workspace root, backend then frontend)
- **Backend only**: `pnpm --filter @workspace/api-server run test` — `artifacts/api-server/src/__tests__/**` and `src/workers/*.test.ts`, covering typed errors, pure utility functions (reservation numbering, passenger age, pricing/discount calculations), seat broadcast logic, endpoint-level request validation, and reminder-worker retry/exhaustion behavior.
- **Frontend only**: `pnpm --filter @workspace/visitecrm run test` — `artifacts/visitecrm/src/__tests__/**`, covering formatting/utility helpers and reservation pricing/discount calculations plus their Zod schemas.

## Database Migrations & Seeding

Drizzle ORM manages all schema migrations in `lib/db/drizzle/`; they run automatically on API server startup via `runMigrations()` in `lib/db/src/migrate.ts`.

**Baseline rules (do not violate)**:
- The legacy per-step migration chain was squashed into one idempotent baseline (`0000_squash_baseline`), generated from the current Drizzle schema. **Never mutate it or its `when` timestamp.**
- Add schema changes only as new numbered migrations via `pnpm --filter @workspace/db generate` (idx `1`+). Each new migration's `when` must stay strictly greater than every earlier entry **and** above the real DB watermark (~`1.8e12`, higher than `Date.now()` in 2026) — otherwise Drizzle silently skips it. The guard test `artifacts/api-server/src/__tests__/migration-journal-order.test.ts` enforces ordering.
- After any `ADD COLUMN` migration, run `pnpm --filter @workspace/db validate-coverage` (schema-drift workflow) to confirm fresh databases stay schema-complete.

**Seeding**:
- Plans (Starter/Pro/Enterprise) are auto-seeded on startup by `seedPlansIfMissing()` (insert-only, never overwrites admin-edited rows). To force a re-sync: `pnpm --filter @workspace/scripts run seed:plans`.
- Stripe products/prices: `STRIPE_SECRET_KEY=sk_test_... pnpm --filter @workspace/scripts tsx src/seed-stripe-plans.ts` — idempotent, adopts existing manually-created Stripe products, and tags prices with `metadata.planSlug` (required for subscription checkout to resolve the right price; see `subscriptions.ts`).
- Referral `source` backfill (one-time, idempotent): `pnpm --filter @workspace/scripts run backfill:referral-source`.
- Referral pending-orders backfill (one-time, idempotent): `pnpm --filter @workspace/scripts run backfill:referral-pending-orders` — inserts PENDING referral rows for orders placed with a referral code *before* the checkout fix that inserts the row at checkout time. Safe to re-run; skips orders where `pending_referral->>'referralId'` is already set.

**Stripe webhook duplicate-endpoint audit**: `initStripeSync()` (`artifacts/api-server/src/lib/stripeSync.ts`) warns (non-fatally) when more than one enabled Stripe webhook endpoint targets `/api/stripe/webhook`, to catch the class of incident where a stale duplicate silently double-delivers billing events. Status is exposed via `getWebhookAuditStatus()` and returned from `GET /admin/system-health` as `stripeWebhookAudit`; the Plans admin page (`artifacts/visitecrm/src/pages/admin/plans.tsx`) shows a warning banner with the offending endpoint URLs when `status === "duplicate"`.

**Baseline omits manually-added constraints (corrective migration `0001`)**: The baseline is generated from the Drizzle schema TS, so any DB object that exists ONLY in a hand-written migration — and is not declared in `lib/db/src/schema/` — is silently dropped from it. The `referrals_crm_requires_reservation_id` CHECK constraint (originally added by legacy manual migration 0071, never represented in the schema TS) is one such object: existing databases have it, but a fresh DB built from the baseline alone did not. Migration `0001_referrals_crm_check` is an idempotent corrective migration that restores it (`DO $$ … EXCEPTION WHEN duplicate_object`), so fresh DBs gain it and existing DBs treat it as a no-op. A full catalog audit (tables, columns, indexes, all constraints) of a baseline-built DB vs an existing DB confirmed this CHECK was the ONLY object the squash dropped.

**Important**:
- Never mutate the consolidated baseline (`0000_squash_baseline`) or its `when`.
- Add schema changes as new numbered migrations via `pnpm --filter @workspace/db generate` (idx `1`+). Each new migration's `when` MUST stay strictly greater than every earlier entry, or Drizzle silently skips it. The guard test `artifacts/api-server/src/__tests__/migration-journal-order.test.ts` (`GUARD_FROM_IDX=1`) enforces this.
- **`when` must also clear the real DB watermark.** Existing databases carry a migration watermark of ~`1.782e12` (the legacy chain's inflated timestamps), which is HIGHER than `Date.now()` in 2026. A migration whose `when` is below that watermark is silently skipped on already-migrated DBs even though it passes the guard test. Migration `0001` sets `when=1800000000000` (above the watermark), which raises the journal's running max so the guard test now also forces every future migration above the watermark. Do not lower it.

### Plan Seeding
Plan rows (Starter, Pro, Enterprise) are seeded automatically on API server startup. After migrations run, `seedPlansIfMissing()` (`artifacts/api-server/src/lib/seed-plans.ts`) ensures the canonical plans exist so a freshly-deployed/empty production database does not leave billing, onboarding, and plan selection broken (`/subscriptions/upgrade` 404s when the `plans` table is empty).

**Insert-only by design**: the startup seeder is guarded by a row-count check and uses `onConflictDoNothing` on `slug`, so it **never overwrites** plan rows an operator edited via the admin UI (`POST/PATCH/DELETE /admin/plans`). It only populates an empty table. The seed is non-fatal — a failure logs an error but does not block boot.

To intentionally **re-sync** plan definitions (ON CONFLICT DO UPDATE), run the standalone script instead:

```bash
pnpm --filter @workspace/scripts run seed:plans
```

Plan values are mirrored between `scripts/src/seed-plans.ts` (canonical) and the startup seeder; keep them in sync.

### Stripe Product/Price Seeding
The plan→Stripe-price link is **metadata-only**: `subscriptions.ts` resolves a price for checkout via `stripe.prices.search({ query: "metadata['planSlug']:'<slug>' AND active:'true'" })` and picks the recurring price matching the requested billing cycle + amount + `brl`. There is no `stripePriceId` column on `plans`. **Every Stripe price intended for subscription checkout MUST carry `metadata.planSlug`** (matching the plan slug), otherwise checkout silently falls back to one-time payment mode.

Seed Stripe products/prices (idempotent; finds-or-creates products, creates monthly + annual `brl` recurring prices with `planSlug`/`planId`/`cycle` metadata) with:

```bash
STRIPE_SECRET_KEY=sk_test_... pnpm --filter @workspace/scripts tsx src/seed-stripe-plans.ts
```

**Product adoption (avoids duplicates against manually-created LIVE products)**: the seeder first looks up a product by `metadata['planSlug']`; if that misses it falls back to matching an active product by name (`VisiteCRM <Plan>` or the bare `<Plan>`) and **adopts** it, backfilling `planSlug`/`planId` into the product metadata (without renaming it). This is required because the LIVE account (Visite Cariri) has operator-created plain "Pro"/"Enterprise" products with empty product-level metadata — a metadata-only lookup would miss them and create duplicate "VisiteCRM Pro/Enterprise" products. Only prices carry `planSlug` for checkout resolution, so product-level metadata is a convenience, not a requirement.

Note: `prices.search` uses Stripe's **eventually-consistent search index** — newly created/updated price metadata can take a few seconds to become searchable, so checkout may briefly miss a just-seeded price.

**LIVE annual prices (June 2026)**: the LIVE account originally had only **monthly** Pro/Enterprise prices, so annual checkout silently fell back to one-time `payment` mode (`subscriptions.ts` finds no matching annual recurring price). Annual `brl` recurring prices were created directly on the existing manual products — Pro R$970/yr (`97000` cents) and Enterprise R$3970/yr (`397000` cents), each carrying `metadata.planSlug` + `planId` + `cycle: "annual"` — matching the `annual_price` column in `plans`. Verified the exact checkout search (`metadata['planSlug']:'<slug>' AND active:'true'`, filtered to `interval=year`/amount/`brl`) resolves both. Re-running the seeder now adopts these same products instead of duplicating them.

**Admin visibility into missing prices**: `GET /api/admin/plans/stripe-health` (superadmin-only) checks every non-free plan against the same `prices.search` query used at checkout time, and reports per-plan whether a matching monthly/annual recurring `brl` price exists. This surfaces the misconfiguration described above *before* a customer hits the `STRIPE_PRICE_NOT_FOUND` 400 during checkout. The admin Plans page (`artifacts/visitecrm/src/pages/admin/plans.tsx`) calls this endpoint and renders: a banner when Stripe isn't configured at all, a summary banner with a refresh button when any plan is missing a price, and a per-row warning badge/icon next to the offending price column. Free plans (monthly and annual price both `0`) are always reported healthy and skipped from the Stripe search.


### Stripe Webhook Duplicate-Endpoint Audit
After registering the managed webhook, `initStripeSync()` (`artifacts/api-server/src/lib/stripeSync.ts`) lists all Stripe webhook endpoints for the active mode and warns (non-fatally) when more than one *enabled* endpoint targets `/api/stripe/webhook` — a prior incident had a stale duplicate endpoint silently double-delivering every billing event (double plan activations).

The result of the most recent audit is cached in module state and exposed via `getWebhookAuditStatus()` (`status: "ok" | "duplicate" | "unknown"`, `duplicateCount`, `endpoints`, `checkedAt`). `GET /admin/system-health` returns it as `stripeWebhookAudit` in the response, and the Plans admin page (`artifacts/visitecrm/src/pages/admin/plans.tsx`) renders an amber warning banner when `status === "duplicate"`, listing the offending endpoint URLs so an operator can remove the extra one(s) in the Stripe Dashboard. `status` is `"unknown"` until the first successful audit or whenever the last attempt could not reach Stripe (never blocks startup).

### Duplicate Reservation Diagnostic

Se houver suspeita de reservas duplicadas para o mesmo cliente na mesma viagem, execute o script de diagnóstico (somente leitura — não altera dados):

```bash
pnpm --filter @workspace/scripts run list:duplicate-reservations
```

Ele lista todos os grupos `(tenant_id, client_id, trip_id)` com 2+ reservas ativas, mostrando números de reserva, status e IDs. A exclusão de duplicatas deve ser feita manualmente via CRM (cancelar a reserva indesejada na tela de Reservas).

**Camadas de proteção contra duplicatas (implementadas em migration 0042):**
- **Banco**: índice único parcial `reservations_active_client_trip_unique` em `(tenant_id, client_id, trip_id)` WHERE `status NOT IN ('cancelled','refunded') AND client_id IS NOT NULL`.
- **API**: `POST /api/reservations` retorna 409 `DUPLICATE_RESERVATION` se o mesmo cliente já tiver reserva ativa na viagem.
- **UI**: O wizard de Nova Reserva bloqueia o botão "Próximo" quando detecta duplicata; o usuário precisa marcar uma checkbox de confirmação explícita para prosseguir.

### Pipeline Duplicate-Lead Cleanup
A bug (fixed in the "Novo Cliente" form) caused two Pipeline deal cards to be created for every client+trip reservation — one in "Reserva Criada" (backend `syncClientDeal`) and one in "Lead" (frontend `createDeal`). Run this one-time, idempotent cleanup to remove the inferior duplicate from any pre-fix agencies:

```bash
pnpm --filter @workspace/scripts run cleanup:pipeline-duplicate-leads
```

It keeps the deal in the most-advanced stage (highest `pipelineStages.order`) and hard-deletes the rest. Safe to re-run — already-clean groups produce zero deletions. See `scripts/src/cleanup-pipeline-duplicate-leads.ts`.

### Referral Source Backfill
Migration `0071` added the `source` column (with a CHECK constraint requiring `reservation_id` when `source = 'crm'`). Rows created before that migration have `source = NULL`. Run this one-time, idempotent backfill to populate accurate source values on existing **completed** referral rows:

```bash
pnpm --filter @workspace/scripts run backfill:referral-source
```

It sets `source = 'crm'` for completed rows that have a `reservation_id`, and `source = 'store'` for completed rows without one. Rows whose `source` is already set are skipped, so it is safe to re-run. See `scripts/src/backfill-referral-source.ts`.

## File Upload Limits

Video uploads go through UploadThing via the `/api/upload/video` endpoint (multer + `utapi.uploadFiles`).

| Type | Self-imposed limit | UploadThing plan limit |
|------|--------------------|------------------------|
| Images | 8 MB | plan-dependent |
| Documents | 16 MB | plan-dependent |
| **Videos** | **128 MB** | plan-dependent (typically 2 GB on paid plans) |

The 128 MB cap is set in two places — keep them in sync if you change it:
1. `artifacts/api-server/src/routes/upload.ts` — `videoUpload` multer `limits.fileSize`
2. `artifacts/visitecrm/src/components/video-gallery-upload.tsx` — `MAX_SIZE` guard in `handleFileChange`

The component displays estimated time remaining (`uploadEta`) during upload, computed from XHR progress events in `useUploadVideo` (`artifacts/visitecrm/src/hooks/use-upload.ts`). The estimate appears after ≥1 s of elapsed time to avoid noisy initial bursts.

## External Dependencies

- **Clerk**: User authentication and authorization.
- **PostgreSQL**: Primary database.
- **Google Calendar API**: Event synchronization and management.
- **Replit DB**: Database hosting in the Replit environment.
- **Redis (optional)**: Required for BullMQ async job queues (`REDIS_URL`, Upstash-compatible). Upstash free tier has a 500,000 daily request limit — upgrade or run a local `redis-server` for sustained dev usage.
- **`ENABLE_WORKERS`** (optional): Controls whether BullMQ workers start on boot. Defaults to `false` in dev, `true` in production. When `false`, node-cron fallbacks handle expired-reservation cleanup and failed-email retries instead. Set `ENABLE_WORKERS=false` with `REDIS_URL` unset for a fully Redis-free local session.

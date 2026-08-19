# Threat Model

## Project Overview

VisiteCRM is a pnpm-workspace TypeScript monorepo for a Brazilian multi-tenant tourism CRM. The production application consists of an Express 5 API in `artifacts/api-server` and a React/Vite frontend in `artifacts/visitecrm`, backed by PostgreSQL via Drizzle and Clerk for authentication. Agencies manage trips, reservations, customers, finances, communications, and a public storefront (`/loja/:slug/*`) where end customers can browse products and place orders.

This threat model is production-scoped. `artifacts/mockup-sandbox` is not deployed to production and should normally be ignored during scans unless production reachability is later demonstrated. Assume `NODE_ENV=production` and that Replit deployment terminates TLS for client-to-server traffic.

## Assets

- **Agency tenant data** — customers, trips, reservations, seat assignments, invoices, marketing data, referrals, and analytics. Leakage or cross-tenant access would expose sensitive business and customer information.
- **Customer personal data** — names, emails, phone numbers, CPF, reservation details, order notes, and payment artifacts such as PIX and boleto references. This is directly sensitive and often enough to enable fraud or social engineering.
- **Accounts and sessions** — Clerk identities, local user records, role assignments, and session cookies/tokens. Compromise allows impersonation and possible tenant-wide access depending on role.
- **Payment and billing state** — subscription invoices, order payment status, PIX configuration, Stripe payment intents, and fulfillment state. Unauthorized reads or writes can create fraud, revenue loss, or customer confusion.
- **Platform secrets and service credentials** — database credentials, Clerk secret key, Stripe secret key, Google Calendar OAuth secrets, Redis URL, and email-delivery credentials. Exposure would materially compromise the platform.
- **Operational workflows** — automated emails, reminders, and public booking flows that create downstream reservations and customer accounts. Abuse can cause unauthorized account creation, data disclosure, or operational disruption.

## Trust Boundaries

- **Browser to API** — all frontend input is untrusted. The backend must authenticate and authorize protected routes, validate request bodies, and compute sensitive values server-side.
- **Public storefront to backend** — `artifacts/api-server/src/routes/store-public.ts` serves anonymous users. This is the sharpest boundary because unauthenticated traffic can create orders, inspect public catalog data, and interact with booking-related flows.
- **Authenticated user to tenant-scoped data** — most CRM routes rely on Clerk identity plus local role/tenant checks. Every query that reads or mutates tenant data must enforce tenant scoping server-side.
- **Agency/admin to superadmin** — superadmin endpoints expose cross-tenant platform management. These routes must require explicit superadmin checks independent of frontend visibility.
- **API to PostgreSQL** — the API has broad database access. Query construction, tenant filters, and identifier selection determine whether users can reach only their own records.
- **API to third parties** — Clerk, Stripe, Google Calendar, email delivery, UploadThing, and Redis are all external trust boundaries. Requests crossing them must be authenticated, targeted only to intended origins/hosts, and must not leak secrets in logs or responses.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/index.ts`, `artifacts/visitecrm/src/App.tsx`, `artifacts/visitecrm/src/pages/**`.
- **Highest-risk code areas:** `artifacts/api-server/src/routes/store-public.ts`, authenticated route handlers under `artifacts/api-server/src/routes/**`, tenant helpers in `artifacts/api-server/src/lib/tenant.ts`, role logic in `lib/permissions/src/index.ts`, onboarding/bootstrap flows in `artifacts/api-server/src/routes/onboarding.ts`, and UploadThing lifecycle helpers in `artifacts/api-server/src/lib/uploadthing.ts`.
- **Public surfaces:** `/api/public/store/:slug/*`, onboarding endpoints, health checks, calendar callback, storefront pages under `artifacts/visitecrm/src/pages/vitrine/**`.
- **Authenticated/admin surfaces:** most `/api/*` CRM routes plus `/api/admin/*` and `/api/admin/**` superadmin routes.
- **Usually dev-only / out of scope:** `artifacts/mockup-sandbox`, local scripts, and other non-deployed tooling unless production reachability is shown.

## Current Scan Reminders

- **Public checkout remains a primary abuse target.** Anonymous storefront flows can still affect inventory, referral state, and customer-account provisioning, so future scans should re-check post-order side effects, referral-credit consumption, and any path that grants client capabilities before payment confirmation.
- **Public review/read models must stay projection-safe.** Anonymous storefront endpoints should never return raw database rows for customer-generated content, because review records and similar models can contain internal identifiers and reviewer contact fields that are not meant for public display.
- **Order lookup is hardened, but referral endpoints remain secrecy-sensitive.** Public order lookup now requires a high-entropy `paymentToken`, so future storefront privacy reviews should focus less on raw order numbers and more on `/api/public/store/:slug/referral/*`, where low-entropy referral codes and validation responses can reveal customer names or prior-purchase status.
- **Authorization drift is a recurring risk in CRM routes.** Many handlers use `requireAuth(...)` plus tenant filters but still need explicit role or permission checks aligned with `lib/permissions/src/index.ts`, especially in referrals, documents, trips, boarding/check-in flows, user-management endpoints, payments, reservations, and reporting endpoints.
- **Bootstrap and billing state need server-side enforcement.** Tenant status, `trialEndsAt`, and plan selection must be treated as security-relevant because onboarding can mint long-lived privileged tenants and unpaid tenants must not retain operational access indefinitely.
- **Shared UploadThing credentials create cross-tenant blast radius.** Any cleanup path that deletes files by URL or key must prove ownership, not just trust that the hostname belongs to UploadThing.
- **OAuth callback state must be one-time and session-bound.** Signed `state` values alone are not enough for browser-based integrations like Google Calendar if the nonce is never stored or invalidated and the callback is allowed to complete without proving it belongs to the initiating user session.
- **Runtime integrations must reuse the hardened SSRF path.** Validating tenant-controlled URLs only when they are saved or tested is insufficient; every production send path must keep the same connect-time SSRF protections and redirect restrictions used by the test helpers.
- **Transport security findings should stay in scope.** Production-only code paths that relax TLS verification, even for background sync components, are security relevant and should be rechecked on future scans.

## Threat Categories

### Spoofing

Authentication is split between Clerk and local user synchronization. The critical guarantee is that protected API routes must not rely on frontend gating or on `clerkMiddleware` alone; they must explicitly require a valid Clerk-authenticated user and map that identity to the correct local user record. Superadmin access must be tied to explicit server-side checks, not route naming or UI visibility.

### Tampering

Customers and agency users send untrusted data for orders, reservations, payments, notes, and CRM updates. The system must derive authoritative prices, totals, seat availability, and role-sensitive fields on the server, and it must reject attempts to modify records outside the caller's tenant or allowed role. Shared-schema multi-tenancy makes missing `tenantId` filters especially dangerous.

### Information Disclosure

The platform stores high-value PII and payment-related artifacts, and it exposes both public and authenticated read paths. Public endpoints must reveal only information intentionally meant for anonymous users, and authenticated endpoints must scope every response to the caller's tenant and role. Order/reservation tracking identifiers, voucher codes, and similar lookup tokens must be treated as secrets if they grant access to customer data.

### Denial of Service

The public storefront permits anonymous browsing, seat-map reads, SSE connections, coupon/referral validation, and order creation. These endpoints must remain resilient against scraping, brute force, and resource-exhaustion attacks through bounded request sizes, reasonable rate limits, and careful handling of long-lived public SSE connections. Third-party calls and queue operations should fail safely without tying up request handlers indefinitely.

### Elevation of Privilege

The main privilege risks are broken tenant isolation, missing role checks on admin/superadmin routes, and IDOR-style access using guessable identifiers. The system must ensure that no authenticated agency user can cross tenant boundaries and that no anonymous user can retrieve or influence data beyond intentionally public storefront content. Human-readable identifiers must not function as bearer secrets unless they have sufficient entropy and are validated with an additional factor.

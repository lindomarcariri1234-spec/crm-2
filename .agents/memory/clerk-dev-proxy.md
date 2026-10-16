---
name: Clerk proxy — canonical pattern (production-only, no-op in dev)
description: How the Clerk FAPI proxy is configured. Active in production via clerkProxyMiddleware; no-op in dev. Do NOT auto-derive proxy URLs from the Replit dev domain.
---

# Clerk proxy — canonical pattern

## Rule

`clerkProxyMiddleware()` is mounted at `/api/__clerk` in `app.ts` and is
**production-only** (`NODE_ENV !== "production"` → returns `next()`). In
production it derives the `Clerk-Proxy-Url` header dynamically from the incoming
request host (via `x-forwarded-host`), so no env var is needed at runtime.

The client-side `VITE_CLERK_PROXY_URL` is not sufficient by itself: production
also requires the matching domain `proxy_url` to be configured in the Clerk
Dashboard under Domains → Frontend API. If that setting is missing or mismatched,
Clerk can return `host_invalid` from `/v1/environment` even while the proxy
successfully serves ClerkJS assets.

**Why:** Clerk requires every `proxyUrl` to be registered in the Clerk Dashboard.
The Replit preview URL changes per session so it can never be registered — any
auto-derived dev proxy URL causes a `400 "unable to attribute this request to
an instance"` blank screen. The middleware guards against this with the
`NODE_ENV` check. Clerk's production domain-level `proxy_url` is separate from
the client bundle's proxy URL.

**How to apply:**
- Keep `clerkProxyMiddleware()` (no args) in `app.ts`; never pass `isAllowedOrigin` or a hardcoded URL.
- `authorizedParties` in `app.ts` must NOT include `clerkProxyOrigin` — the proxy URL is never registered as an authorized party.
- Frontend `App.tsx`: `clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL` (empty in dev; Replit auto-sets it in production builds for the deployed domain).
- In Clerk Dashboard, set the production domain's `proxy_url` to the same full proxy URL used by the client, e.g. `https://visitecrm.com/api/__clerk`.
- `http-proxy-middleware` must NOT be bundled by esbuild — it has transitive deps (`entities@4.5.0`) with explicit `.js` ESM imports that esbuild cannot resolve. Keep it in the `external` array in `build.mjs` AND maintain the symlink `artifacts/api-server/node_modules/http-proxy-middleware → node_modules/.pnpm/http-proxy-middleware@3.0.7/...`.

## Prod env vars that matter for auth/CORS

`FRONTEND_URL` (and optionally `ADDITIONAL_ORIGINS`) must include the deployed
origin, or CORS middleware rejects cross-origin POSTs and Clerk
`authorizedParties` won't match.

## After publishing

Re-publish from the Publish button so Replit auto-injects `VITE_CLERK_PROXY_URL`
into the production build for the custom domain. Without republishing, the old
build (without the proxy URL) stays live.

## Verify the live Clerk path

DNS resolution alone does not confirm that the deployed frontend is using the
Clerk proxy. Inspect the live Vite bundle for a defined compiled `proxyUrl`, then
load an authenticated route in a clean browser and confirm Clerk initializes
instead of failing on the custom Frontend API host.

**Why:** a domain record can propagate while a stale deployment still renders a
blank app because its Clerk provider was built without the Replit-injected proxy.

**How to apply:** after changing Clerk DNS or proxy settings, republish first,
then verify the compiled production bundle, the Clerk Dashboard domain
`proxy_url`, and the real authenticated route. DNS resolution and a successful
ClerkJS asset response do not prove that `/v1/environment` is attributed to the
right production instance.

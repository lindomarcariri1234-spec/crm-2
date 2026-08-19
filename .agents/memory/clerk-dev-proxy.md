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

**Why:** Clerk requires every `proxyUrl` to be registered in the Clerk Dashboard.
The Replit preview URL changes per session so it can never be registered — any
auto-derived dev proxy URL causes a `400 "unable to attribute this request to
an instance"` blank screen. The middleware guards against this with the
`NODE_ENV` check.

**How to apply:**
- Keep `clerkProxyMiddleware()` (no args) in `app.ts`; never pass `isAllowedOrigin` or a hardcoded URL.
- `authorizedParties` in `app.ts` must NOT include `clerkProxyOrigin` — the proxy URL is never registered as an authorized party.
- Frontend `App.tsx`: `clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL` (empty in dev; Replit auto-sets it in production builds for the deployed domain).
- `http-proxy-middleware` must NOT be bundled by esbuild — it has transitive deps (`entities@4.5.0`) with explicit `.js` ESM imports that esbuild cannot resolve. Keep it in the `external` array in `build.mjs` AND maintain the symlink `artifacts/api-server/node_modules/http-proxy-middleware → node_modules/.pnpm/http-proxy-middleware@3.0.7/...`.

## Prod env vars that matter for auth/CORS

`FRONTEND_URL` (and optionally `ADDITIONAL_ORIGINS`) must include the deployed
origin, or CORS middleware rejects cross-origin POSTs and Clerk
`authorizedParties` won't match.

## After publishing

Re-publish from the Publish button so Replit auto-injects `VITE_CLERK_PROXY_URL`
into the production build for the custom domain. Without republishing, the old
build (without the proxy URL) stays live.

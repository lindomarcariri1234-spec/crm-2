---
name: Host-header token links
description: Token-bearing email links on public/anonymous endpoints must use a trusted configured origin, never the request Host header.
---

# Token-bearing email links must not use the request Host header

When an **anonymous/public** endpoint emails a link that carries a secret token
(confirm, unsubscribe, password-reset, magic-link, etc.), build the URL from a
trusted server-configured origin — not from `req.get("host")` / `req.protocol`.

In this repo the trusted base is `STORE_PUBLIC_BASE`:
`process.env.STORE_PUBLIC_URL ?? https://${REPLIT_DEV_DOMAIN ?? "visitecrm.com"}` (strip trailing slash).
It is defined in both `artifacts/api-server/src/routes/store.ts` (price-drop emails)
and `artifacts/api-server/src/routes/store-public.ts` (subscribe confirm/unsubscribe).

**Why:** `Host` is attacker-controlled on anonymous routes. A forged Host makes the
emailed confirm/unsubscribe link point at an attacker domain → phishing + raw-token
capture, defeating double opt-in. Caught in architect review of the Vitrine price-alert feature.

**How to apply:** Any new public route that emails a token link — reuse the
`STORE_PUBLIC_BASE` pattern. Authenticated/admin convenience links are lower risk,
but prefer the configured origin there too.

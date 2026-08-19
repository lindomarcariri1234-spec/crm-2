---
name: Vitrine preview & screenshot quirks
description: Why app_preview screenshots of the storefront 404'd and the Clerk CORS noise — localhost:5000 vs public-domain /api routing.
---

# app_preview hits localhost:5000 directly, not the public domain

`app_preview` / the preview pane load the page from `http://localhost:5000`
(the "Start application" workflow = the visitecrm vite dev server), NOT the
public `*.picard.replit.dev` domain. This has two consequences a future agent
will trip over when screenshotting the storefront (Vitrine):

1. **`/api` must be proxied by vite, or browser fetches return the SPA HTML.**
   On the **public** Replit domain, infra routes `/api` to the api-server
   (port 8080). But vite on localhost:5000 has no such routing — a request to
   `localhost:5000/api/...` falls through to the SPA `index.html` (200,
   `text/html`). `storeApi` then does `JSON.parse(html)` → throws →
   `getStore` catch → the storefront renders "404 Loja não encontrada".
   `curl` to the **public** domain returns correct JSON, masking the problem.
   **Fix (already in `artifacts/visitecrm/vite.config.ts`):** a dev
   `server.proxy` block mapping `/api` → `http://localhost:8080`. Do not remove
   it or storefront preview/screenshots break again.
   **Why:** the frontend correctly uses relative `/api` (right for the public
   domain); only the direct-localhost preview path needs the proxy.

2. **Clerk JS fails to load in app_preview (CORS) — expected, not a bug.**
   `VITE_CLERK_PROXY_URL` is the public domain (`REPLIT_DEV_DOMAIN`), so
   `clerk.browser.js` loads cross-origin from localhost:5000 and the redirect
   to the api-server's own public domain is CORS-blocked. Console shows
   repeated `clerk.browser.js ... blocked by CORS` / 401. **Public /
   unauthenticated storefront pages still render fine.** Don't chase this when
   debugging storefront visuals; only auth-gated UI is affected in screenshots.

## How to apply
When a storefront (or any artifact relying on infra `/api` routing) shows 404 /
empty data ONLY in app_preview but `curl` to the public domain works, check for
a vite `/api` proxy first. Ignore the Clerk CORS lines for public pages.

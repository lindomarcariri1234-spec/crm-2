---
name: Canonical storefront runtime
description: Keep public storefront HTML and public API on the same runtime and database.
---

Public storefront HTML and public API must use the same data runtime. A static SPA fallback or an external `/loja` rewrite can make crawler-visible SEO HTML stale even when `/api/public/store/:slug` returns current store settings; the crawler-facing route must inject agency metadata server-side.

**Why:** The split runtime served old SEO values in crawler-visible HTML while the shared public API already had the latest saved values.

**How to apply:** When changing storefront routing or deployment topology, verify both `/loja/<slug>` HTML and `/api/public/store/<slug>` against the same backend with a crawler user-agent; assert `og:title`, `og:description`, and `og:image`, not just the browser-rendered page.
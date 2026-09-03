---
name: Canonical storefront runtime
description: Keep public storefront HTML and public API on the same runtime and database.
---

Public storefront HTML and public API must use the same runtime/database. Routing `/loja` through a separate Vercel function while `/api` uses Replit can make SEO HTML stale even when the API returns current store settings.

**Why:** The split runtime served old SEO values in crawler-visible HTML while the shared public API already had the latest saved values.

**How to apply:** When changing storefront routing or deployment topology, verify both `/loja/<slug>` HTML and `/api/public/store/<slug>` against the same backend before relying on social previews.
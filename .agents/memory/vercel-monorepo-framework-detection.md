---
name: Vercel monorepo framework detection
description: Why the combined Vite and Express deployment must explicitly select the Vite framework
---

For the combined VisiteCRM deployment, keep the Vercel framework explicitly set to Vite. The Express API remains a separate function under `api/`.

**Why:** Vercel's backend framework detector can see Express in the monorepo and classify the whole project as an Express backend. It then searches the configured frontend output directory for a Node entrypoint and fails even though the Vite `index.html` exists.

**How to apply:** Preserve the explicit Vite framework selection whenever changing Vercel configuration. Do not switch the whole project to the Express preset unless the deployment architecture is intentionally redesigned. Also remember that Vercel may validate `outputDirectory` relative to its configured monorepo root; build staging must place the static output under that root.
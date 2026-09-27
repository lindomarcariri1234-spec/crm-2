---
name: Vercel monorepo framework
description: Vercel project metadata can override the repository's Vite deployment intent
---

A Vercel project linked to a monorepo can be classified as `express` even when the repository's `vercel.json` declares Vite and a static output directory.

**Why:** The linked VisiteCRM project was detected as Express, which can prevent the intended Vite build from being selected.

**How to apply:** Inspect the existing Vercel project before deploying. If its framework disagrees with the repository configuration, set the project framework explicitly to `vite` before creating the production deployment.
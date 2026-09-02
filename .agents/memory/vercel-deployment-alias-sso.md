---
name: Vercel deployment alias SSO
description: How to validate a Vercel deployment when generated aliases are protected by the platform's SSO gate
---

Generated Vercel deployment URLs and git branch aliases can return a 302 to the Vercel SSO endpoint even when the deployment is ready. The project's public custom domain may still serve the deployment normally.

**Why:** Testing the generated alias with an unauthenticated curl can look like a failed deploy even though the build completed and the production alias is serving the new files.

**How to apply:** Confirm `readyState` and commit metadata through the Vercel API, then validate a frontend-only marker through the configured public custom domain; treat SSO redirects on generated aliases as access protection, not build failure.
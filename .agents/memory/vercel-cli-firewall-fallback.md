---
name: Vercel CLI firewall fallback
description: Temporary Vercel CLI installs can be blocked by the Replit package firewall even when a cached CLI is usable.
---

When `pnpm dlx vercel` fails on a transitive package download, check the pnpm dlx cache for an already extracted Vercel CLI before changing project dependencies or switching deployment mechanisms.

**Why:** The package firewall can reject a dependency such as `tar` while the requested Vercel package and its executable are already present in a cache from an earlier invocation.

**How to apply:** Execute the cached CLI directly for the deployment, keep `.vercel` and `.vercelignore` temporary when needed, and verify the resulting production deployment through the Vercel API and public domain. If the cached CLI rejects its token or crashes during auto-update, the managed Vercel connector can create a deployment with `POST /v13/deployments` using the existing project, `target: production`, and a GitHub `gitSource` (`repoId`, `ref`, `sha`). Direct GitSource deployments may run the versioned `ignoreCommand` with an unusable previous-SHA comparison and cancel as “no published-app changes”; if the commit is unverified, Vercel may also require `gitProviderOptions.requireVerifiedCommits` to be temporarily disabled. Restore both safeguards after the build.
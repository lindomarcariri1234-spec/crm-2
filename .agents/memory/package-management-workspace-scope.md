---
name: Monorepo dependency install scope
description: How to handle package changes when the Replit package installer targets the pnpm workspace root.
---

When a Replit language-package install or removal fails with `ERR_PNPM_ADDING_TO_ROOT` because it ran at the workspace root, scope the pnpm operation to the target artifact with `pnpm --filter @workspace/<artifact> add/remove <package>` rather than adding the dependency to the root.

**Why:** Artifact packages have separate importers; a root-level dependency is not the intended product dependency and pnpm rejects the implicit workspace-root add.

**How to apply:** Try the package-management flow first; if its failure is specifically the root-scope guard, use the exact artifact filter and verify the package and lockfile diff records the dependency under that artifact.
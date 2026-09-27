---
name: Temporary worktree package resolution
description: Prevent scratch pnpm worktrees from importing workspace packages from the primary checkout.
---

When validating a different monorepo commit in a temporary Git worktree, symlinking the entire app-level `node_modules` from the primary checkout can make `@workspace/*` imports resolve to the primary checkout's sources. This can produce misleading missing-export build errors. Copy the app-level `node_modules` symlink structure into the temporary worktree so relative workspace links resolve there; the shared root package store can remain shared.

**Why:** A Vite build against a scratch commit failed on an API-client export that existed in the scratch tree; the app-level dependency symlink was resolving the primary checkout instead.

**How to apply:** Before building in a temporary pnpm worktree, inspect `realpath` for a workspace package imported by the app. If it points outside the worktree, recreate the app-level dependency symlink structure so workspace packages resolve to the scratch tree, then rerun the build.
---
name: Temporary worktree package resolution
description: Keep scratch Git worktrees isolated and resolve pnpm workspace packages from the intended checkout.
---

Place temporary Git worktrees outside the repository root, such as under `/tmp`. An in-repository worktree can lose its `.git` pointer during a workspace snapshot and be captured as a nested copy of the whole repository. Before removing a worktree, verify its Git metadata and status; if the pointer is missing, inspect the exact tree before repairing or restoring anything.

**Why:** A workspace snapshot captured an in-root temporary worktree as 3,149 tracked paths after its `.git` pointer disappeared, making cleanup look like deletion of project files.

**How to apply:** Keep scratch worktrees outside the app tree, confirm `git worktree list` and the worktree's own status before cleanup, and never run broad pruning or restore operations when a worktree path is ambiguous.

When validating a different monorepo commit in a temporary Git worktree, symlinking the entire app-level `node_modules` from the primary checkout can make `@workspace/*` imports resolve to the primary checkout's sources. This can produce misleading missing-export build errors. Copy the app-level `node_modules` symlink structure into the temporary worktree so relative workspace links resolve there; the shared root package store can remain shared.

**Why:** A Vite build against a scratch commit failed on an API-client export that existed in the scratch tree; the app-level dependency symlink was resolving the primary checkout instead.

**How to apply:** Before building in a temporary pnpm worktree, inspect `realpath` for a workspace package imported by the app. If it points outside the worktree, recreate the app-level dependency symlink structure so workspace packages resolve to the scratch tree, then rerun the build.
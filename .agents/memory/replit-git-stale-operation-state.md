---
name: Replit Git stale operation state
description: Diagnose Replit Git pane invalid-state errors caused by stale Git metadata.
---

Replit Git errors can be caused by stale `CHERRY_PICK_HEAD` or `REBASE_HEAD` markers even when the referenced commit is already an ancestor of the active branch. An old zero-byte `packed-refs.lock` can then prevent Git from clearing those markers.

**Why:** Resetting or force-pushing to clear a UI error can discard valid branch history. A stale lock should not be removed while another Git process is using it.

**How to apply:** Check full `git status`, operation-state paths, and whether the referenced commit is already in `HEAD`. Clear a redundant cherry-pick with `git cherry-pick --quit` only when the index and worktree are clean. Remove a stale refs lock only after confirming it is old, empty, and unused by any Git process; then verify branch tips and status are unchanged.

A stale, nonempty `.git/packed-refs.new` can also block `git fetch` during `pack-refs`. It is a staging snapshot, not the authoritative packed refs file, and may contain different refs.

**Why:** Blindly replacing `packed-refs` with the staged snapshot can lose refs; when only the remote tip is needed, `git ls-remote` avoids changing local refs.

**How to apply:** Confirm no Git process is active, inspect the file timestamp and compare its contents with `packed-refs`, and use `git ls-remote` for a remote-tip check. Do not promote or delete the staged file without understanding its contents.
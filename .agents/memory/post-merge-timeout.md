---
name: Post-merge setup timeout must stay generous (~5 min)
description: Why the post-merge setup timeout was raised from 180s to 300s and what dominates its runtime.
---

# Post-merge setup is naturally slow — keep the timeout generous

`scripts/post-merge.sh` runs: `pnpm install --frozen-lockfile` →
`@workspace/db migrate` → `@workspace/scripts seed:plans`. After the script,
the platform also does **workflow reconciliation** (restarts every running
workflow — there are ~6, including the api-server which does a full esbuild
build, plus two Expo apps). All of that counts against the post-merge timeout.

Observed: even with dependencies already cached, the full pipeline takes
**~126s**. When a merged task **changes the lockfile** (e.g. a security scan
bumping vulnerable deps), `pnpm install` alone jumps to **~90s** (it can't be a
no-op), pushing the total past the original **180s** timeout → setup is killed
and reported as failed even though migrations/seeding actually completed.

**Decision:** timeout raised to **300000 ms (5 min)** via
`setPostMergeConfig({ timeoutMs: 300000 })` (stored in `.replit` `[postMerge]`).

**Why:** dep-changing merges are common enough (any security/upgrade task) that
a 3-min budget is too tight once you add workflow reconciliation. 5 min absorbs
a slow install without masking a genuine hang.

**How to apply:** if a post-merge timeout recurs, first check whether the merge
changed `pnpm-lock.yaml` (slow install is expected, not a bug). Only investigate
the script for a real hang if it blows past 5 min. Don't drop the timeout back
to 180s.

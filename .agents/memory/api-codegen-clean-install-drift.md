---
name: API codegen clean-install drift
description: Why local API contract checks can pass while clean CI reports formatter-only generated changes.
---

When `api:codegen:check` passes locally but clean CI reports a formatting-only diff, compare the installed formatter with the lockfile and CI package-manager version. Pin the root Prettier version exactly, pin the project package manager, and have `pnpm/action-setup` read the root `packageManager` field instead of duplicating its version in the workflow.

**Why:** pnpm links in `node_modules` can remain stale after branch or lockfile changes, and a version range can resolve differently from a developer's existing install. Both can make local codegen pass while clean CI exposes generated-output drift. In Replit, declaring a `packageManager` version different from the provided global pnpm can also trigger a failed automatic self-switch.

**How to apply:** Choose a pnpm version that local workflows can run, or use Corepack consistently for direct and nested pnpm commands. Then perform a frozen install, run `api:codegen:check`, and verify generated outputs are unchanged. Never hand-edit generated files.
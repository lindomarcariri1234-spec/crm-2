---
name: API codegen clean-install drift
description: Why local API contract checks can pass while clean CI reports formatter-only generated changes.
---

When `api:codegen:check` passes locally but clean CI reports a formatting-only diff, compare the formatter resolved from `lib/api-spec` with the lockfile and CI package-manager version. This workspace had local Prettier 3.8.1 while frozen CI used 3.9.9; the only output difference was line wrapping in a generated React API type, and later CI checks were skipped.

**Why:** pnpm links in `node_modules` can remain stale after branch or lockfile changes, so local codegen may pass against an older executable while clean CI exposes generated-output drift.

**How to apply:** Reproduce with a frozen install using CI's PNPM version, regenerate through `api:codegen`, and commit deterministic generated output. Do not hand-edit generated files.
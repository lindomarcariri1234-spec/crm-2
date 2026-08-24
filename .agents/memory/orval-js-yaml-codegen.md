---
name: Orval js-yaml generation incompatibility
description: Why API client/schema code generation currently fails and how to approach a repair safely.
---

`pnpm --filter @workspace/api-spec run codegen` currently fails before generation because Orval imports a default `js-yaml` export that the workspace's `js-yaml` v5 override does not provide.

**Why:** API-contract changes cannot be safely regenerated until the direct generator or the overridden transitive dependency is made compatible. Changing the override without review could affect other tooling and security posture.

**How to apply:** When updating OpenAPI-driven code, first repair this compatibility by upgrading Orval or selecting a compatible `js-yaml` version after reviewing the workspace impact; then rerun generation and review all generated diffs.

## Current additional blocker

The checked-in OpenAPI source contains duplicated keys and concatenated top-level sections. A narrow Orval-only downgrade to `js-yaml` 4 makes Orval start, but strict YAML parsing then fails and `clean: true` deletes generated output before reporting the malformed source.

**Why:** The workspace-wide `js-yaml` 5 override masks the duplicate-key parse error by blocking Orval earlier at module load. Treating the module import alone as the fix can therefore erase generated files without producing replacements.

**How to apply:** Do not run clean code generation against the current source until a dedicated OpenAPI consolidation task produces one valid document. If generation is attempted and fails after cleaning, restore generated files from `HEAD` before continuing.
---
name: Orval js-yaml generation incompatibility
description: Why API client/schema code generation currently fails and how to approach a repair safely.
---

`pnpm --filter @workspace/api-spec run codegen` currently fails before generation because Orval imports a default `js-yaml` export that the workspace's `js-yaml` v5 override does not provide.

**Why:** API-contract changes cannot be safely regenerated until the direct generator or the overridden transitive dependency is made compatible. Changing the override without review could affect other tooling and security posture.

**How to apply:** When updating OpenAPI-driven code, first repair this compatibility by upgrading Orval or selecting a compatible `js-yaml` version after reviewing the workspace impact; then rerun generation and review all generated diffs.
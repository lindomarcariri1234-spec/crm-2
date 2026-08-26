---
name: Orval codegen workflow
description: The compatibility boundary and repeatable process for generating OpenAPI validators and React clients.
---

Use `pnpm run api:codegen` to regenerate the Zod validators, React client types, and hooks, and `pnpm run api:codegen:check` to detect drift. Do not hand-edit generated API artifacts. Codegen validates that the source contains exactly one top-level OpenAPI document before invoking Orval.

**Why:** The workspace retains `js-yaml` v5 for other tooling, while Orval requires the v4 default-export behavior. A scoped Orval-only dependency override preserves both needs. Silently selecting the first of multiple top-level API definitions could let edits to an ignored appended definition drift from generated clients.

**How to apply:** Change the OpenAPI definition, run the root generation command, review the generated diffs, then run the drift check. The generated Zod package entry point is finalized as part of the command because exporting both Orval output surfaces creates duplicate TypeScript exports.

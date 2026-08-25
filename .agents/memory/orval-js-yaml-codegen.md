---
name: Orval codegen workflow
description: The compatibility boundary and repeatable process for generating OpenAPI validators and React clients.
---

Use `pnpm run api:codegen` to regenerate the Zod validators, React client types, and hooks, and `pnpm run api:codegen:check` to detect drift. Do not hand-edit generated API artifacts.

**Why:** The workspace retains `js-yaml` v5 for other tooling, while Orval requires the v4 default-export behavior. A scoped Orval-only dependency override preserves both needs. The checked-in OpenAPI input also retains a historical appended document, so generation deliberately uses the canonical first OpenAPI definition rather than treating the combined source as a valid single document.

**How to apply:** Change the canonical OpenAPI definition, run the root generation command, review the generated diffs, then run the drift check. The generated Zod package entry point is finalized as part of the command because exporting both Orval output surfaces creates duplicate TypeScript exports. If the OpenAPI documents are eventually consolidated, remove the first-document preparation boundary and validate the new single source before changing the workflow.

---
name: API typecheck approach — compact declarations + single-pass tsc
description: How the API typecheck stays fast and OOM-free; compact-dts is the key step before tsc.
---

The api-typecheck workflow runs in three stages: build workspace declarations (db, api-zod), run compact-dts to simplify api-zod's generated `.d.ts`, then a single-pass `tsc -p tsconfig.check.json`.

**Why compact-dts matters:** The orval-generated `api.d.ts` expands every schema into a 5-parameter `ZodObject<{fieldTypes}, "strip", ZodTypeAny, Output, Input>`. TypeScript must hold the full recursive generic tree in memory for all ~474 schemas simultaneously, pushing peak heap to ~2 GB. Compacting each schema to `ZodType<Output, ZodTypeDef, Input>` removes the field-type generics, reducing memory enough for a single-pass check to succeed within 1.5 GB.

**Why single-pass beats batched:** The prior batch approach spawned dozens of separate `tsc` processes, each reloading all declarations from scratch. Once declarations are compact, one process loads them once and checks everything faster.

**Key invariant — array-of-intersection parenthesisation:** `ZodArray<ZodIntersection<A, B>>` must produce `(OutputA & OutputB)[]`, not `OutputA & OutputB[]`. The compact-dts script tracks `needsParens` on its return value and applies parentheses before appending `[]`; preserve this logic when editing the script.

**Fallback:** `artifacts/api-server/scripts/typecheck-batches.mjs` (concurrency=3, batchSize=6) exists as a documented fallback if single-pass ever exceeds 1.5 GB again.

**visitecrm-typecheck dependency:** The frontend typecheck uses project references to `@workspace/api-client-react`; its `dist/` declarations must be rebuilt before the check runs. The `visitecrm-typecheck` validation command already does this (`tsc --build` on api-client-react first).

**How to apply:** compact-dts must run AFTER `tsc --build` on api-zod and BEFORE `tsc -p tsconfig.check.json`. The api-typecheck validation workflow guarantees this ordering. Do not replace workspace contracts with `any` stubs or relax `noImplicitAny`. Treat the googleapis shim in `src/typecheck-googleapis.d.ts` as a scoped performance tradeoff.

---
name: api-zod duplicate export root cause
description: Why lib/api-zod/src/index.ts must NOT export both ./generated/api and ./generated/types
---

## Rule
`lib/api-zod/src/index.ts` must export ONLY `./generated/api`.
**Never add** `export * from "./generated/types"` — it re-exports the same
TypeScript interfaces that already appear in `./generated/api`, causing ~200
TS2308 "already exported" errors.

## Why
`./generated/api` is the superset (Zod schemas + TS interfaces, 476 exports).
`./generated/types/` re-exports only the plain TS interfaces (276 files).
Any name exported from types/ is already in api.ts.

## How to apply
If a task adds a new `.ts` file to `lib/api-zod/src/generated/types/` AND also
adds the matching Zod schema + interface to `api.ts`, the types/ file is already
redundant. Do not add it to types/index.ts AND keep it out of index.ts exports.

---
name: Workspace lib TypeScript build (project references)
description: Consumers resolve workspace libs (lib/db, lib/api-zod, lib/api-client-react) via compiled dist/*.d.ts through project references, so stale dist breaks tsc after schema changes OR after adding a new exported source file.
---

Consumers in this monorepo (api-server, visitecrm, etc.) type-check workspace libraries through their compiled `dist/*.d.ts`, NOT their source `.ts`. So the dist must be rebuilt after ANY of:
- adding a new column to `lib/db/src/schema/*.ts` (→ `tsc --noEmit` reports "Property X does not exist on type Y"), OR
- adding/exporting a NEW source file in a lib (e.g. `lib/api-client-react/src/insights-advanced.ts`), OR
- editing existing generated source files like `lib/api-client-react/src/generated/api.schemas.ts` or `api.ts` (→ stale dist makes typecheck slow AND causes missing-property errors on the new/changed types).

When dist is stale, `tsc --noEmit` on visitecrm can exceed 2 minutes because it falls back to re-checking the huge source files (api.ts is 20k lines). After rebuilding the dist (~30s), the frontend typecheck returns to ~26s.

**Why:** Consumer tsconfigs use project `references` (e.g. `references: [{path: "../../lib/api-client-react"}]`) with `composite: true`, so TS reads `dist/` declarations, not source. A package `exports` map pointing at `./src` does not override this for `tsc`.

**How to apply:** After such changes, rebuild the affected lib's dist (fast, emit-only):
```
cd lib/db && npx tsc --build
cd lib/api-zod && npx tsc --build
cd lib/api-client-react && npx tsc --build   # use --force if dist looks stale
```
Runtime is unaffected (vite/tsx/esbuild read source directly); only `tsc` type checks are impacted. tsc may OOM at 2048MB — run via `node --max-old-space-size=6144 $(node -e "console.log(require.resolve('typescript/bin/tsc'))") --build`.

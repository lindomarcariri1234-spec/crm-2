---
name: api-client-react type duplication
description: ListClientsParams and similar query-param types exist in BOTH api-zod AND api-client-react; both must be updated together.
---

## Rule
When adding or changing a query-param type (e.g. `ListClientsParams`), update it in **two** places:

1. `lib/api-zod/src/generated/types/<typeName>.ts`
2. `lib/api-client-react/src/generated/api.schemas.ts` (search for the type name in this file)

Then rebuild both libs:
```bash
cd lib/api-zod && pnpm exec tsc --build
cd lib/api-client-react && pnpm exec tsc --build
```

**Why:** `api-client-react` does NOT import types from `@workspace/api-zod`. It carries its own verbatim copy of every type in `api.schemas.ts`. The `api-zod` dist `.d.ts` is irrelevant to the visitecrm frontend; the frontend reads from `api-client-react`'s dist instead. Updating only `api-zod` leaves the TS error intact in the frontend.

**How to apply:** Any time a grep for the type in `lib/api-client-react/src/generated/api.schemas.ts` returns a match, that file also needs the edit.

---
name: Run the production build after a task merge, not just tests
description: Why a green test suite can still hide a deploy-breaking wrong-module import in api-server, and what to run to catch it.
---

# A passing test suite does NOT prove the api-server production build works

esbuild (the api-server production bundler, `build.mjs`) does **static
named-export resolution**: `import { foo } from "../x"` fails the build with
"No matching export in x for import foo" if `x` doesn't export `foo`. Vitest /
vite-node does **runtime** module resolution and the test files heavily
`vi.mock(...)` modules, so a wrong-module named import resolves to `undefined`
at test time instead of erroring — the full suite can be 100% green while the
production build (and therefore the deploy) hard-fails.

Concrete instance: a merged task imported `getTenantReservationPrefix` from
`lib/tenant` (it actually lives in `lib/reservation-number`). All 501 backend
tests passed because they mock `../lib/reservation-number.js`; only
`pnpm --filter @workspace/api-server run build` surfaced the error.

**How to apply:** after ANY task merge that touched `artifacts/api-server`,
run `pnpm --filter @workspace/api-server run build` (exit 0 = good) before
declaring the merge healthy or publishing. The post-merge script only runs
migrations + `seed:plans`, NOT the build, so build breaks slip through. The
deploy build is the same esbuild step, so a local build failure = a publish
failure.

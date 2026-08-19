---
name: UploadThing SDK v7 CDN upload bug
description: Effect-Platform FetchHttpClient in uploadthing v7.x breaks CDN PUT requests with double-encoded params and spurious Range header. Fix requires external esbuild + separate fetch-patch module loaded first in index.ts.
---

## Rule
uploadthing v7 uses Effect-Platform's `FetchHttpClient`, which captures `globalThis.fetch` **by value** at module initialisation time via `effect_Layer.succeed(FetchHttpClient.Fetch, fetch)`. Once the module is cached by Node.js, the captured `fetch` reference cannot be changed.

Version pinned to `"uploadthing": "7.7.4"` (exact, no `^`) in `artifacts/api-server/package.json`.

**Bug 1 — Spurious `Range: bytes=0-` header**
Effect-Platform adds this to all PUT requests. UploadThing CDN HMAC verifies the exact signed-header set; any extra header breaks the signature check.

**Bug 2 — Double-encoded query parameters**
Effect-Platform percent-encodes already-encoded sequences in the presigned URL:
- `image%2Fpng` → `image%252Fpng`
- `Visite%20Cariri` → `Visite%2520Cariri`

The CDN decodes once, getting `image%2Fpng` (not `image/png`). HMAC was computed over `image/png` → "Failed to verify URL: Invalid signature".

## Fix (two required parts)

### Part 1: externalise uploadthing in build.mjs
Add `"uploadthing"`, `"@uploadthing/shared"`, `"@uploadthing/mime-types"` to the `external` array. This prevents esbuild from bundling uploadthing — it must be loaded via `require()` at runtime (after the patch).

### Part 2: lib/fetch-patch.ts imported FIRST in index.ts
`src/lib/fetch-patch.ts` patches `globalThis.fetch` and is imported as the **very first import** in `src/index.ts` (before `import app`):
```typescript
import "./lib/fetch-patch";   // ← must be first
import app from "./app";
```

The patch intercepts PUT requests to `*.ingest.uploadthing.com`:
1. Un-double-encodes params: `/%25([0-9A-Fa-f]{2})/g` → `%$1`
2. Strips the `Range` header via `headers.delete("range")`

### Why the order matters (critical)
`app.ts` imports all routes, including `routes/uploadthing.ts`. That module calls `require("uploadthing/express")` at module init time. In the esbuild bundle, route modules are initialised BEFORE lib modules (dependency order). So if `fetch-patch.ts` is not the first import, `uploadthing/express` is required first, captures the unpatched `fetch`, and all subsequent `require("uploadthing/server")` calls hit the same cached module — the patch never takes effect.

Confirmed bundle initialisation order (grep the dist/index.mjs):
```
293910: src/lib/fetch-patch.ts → patchGlobalFetch() runs ✓
303724: __require("uploadthing/express") → AFTER patch ✓
303820: __require("uploadthing/server") → AFTER patch ✓
```

### Previous wrong approaches (do NOT revert to these)
- `globalThis.fetch` patch inside `lib/uploadthing.ts` (too late — uploadthing/express already cached)
- `undici.setGlobalDispatcher` interceptor — Effect-Platform v3.x uses `FetchHttpClient`, NOT undici directly; the dispatcher is never called for those requests

## How to apply
Keep `lib/fetch-patch.ts` as the first import in `index.ts`. Do not remove the uploadthing externals from `build.mjs`. Do not revert `routes/uploadthing.ts` or `lib/uploadthing.ts` back to static imports.

Before upgrading uploadthing: verify Effect-Platform's FetchHttpClient no longer adds Range header or double-encodes. If fixed: remove `fetch-patch.ts`, remove externals from `build.mjs`, remove version pin.

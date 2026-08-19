---
name: CJS require Vitest mock bypass
description: vi.mock("pkg") intercepts ESM import condition but NOT CJS require() — applies to routes/uploadthing.ts and similar SDK patterns
---

## Rule
`vi.mock("uploadthing/express")` (or any package) only intercepts the ESM `import` condition. If production code uses `const { foo } = require("uploadthing/express")` (CJS runtime call), the real SDK loads and the mock is bypassed.

**Why:** Packages with dual ESM/CJS exports expose different file paths per condition. Vitest registers mocks by the specifier ("uploadthing/express") against ESM resolution. The CJS `require()` resolver picks a different underlying file (e.g. `.cjs` vs `.js`), so the mock registry is never consulted.

**How to apply:**
- When a route uses `require("pkg")` at top-level for runtime-ordering reasons (e.g. `routes/uploadthing.ts` loads after fetch-patch), mocking the SDK directly will silently fail.
- Instead, mock the parent module (`vi.mock("../routes/index.js", ...)`) and provide an inline handler that reproduces the SDK's auth contract without loading the SDK.
- Pattern: the inline handler calls the already-mocked auth function (e.g. `getAuth(req)`) and returns the expected status codes.
- This approach tests the same behavior (Clerk bypass in app.ts + auth enforcement) without the SDK dependency.

---
name: CJS require Vitest mock bypass
description: vi.mock("pkg") intercepts ESM import condition but NOT CJS require() — applies to routes/uploadthing.ts and similar SDK patterns
---

## Rule
`vi.mock("uploadthing/express")` (or any package) only intercepts the ESM `import` condition. If production code uses `const { foo } = require("uploadthing/express")` (CJS runtime call), the real SDK loads and the mock is bypassed. For tests of the actual UploadThing route guards, importing `uploadRouter` still works: the real SDK-built route objects expose their `middleware` callbacks for direct invocation with mocked auth/database dependencies.

**Why:** Packages with dual ESM/CJS exports expose different file paths per condition. Vitest registers mocks by the specifier ("uploadthing/express") against ESM resolution. The CJS `require()` resolver picks a different underlying file (e.g. `.cjs` vs `.js`), so the mock registry is never consulted. The constructed UploadThing route definition itself can be tested without mocking the SDK or making a provider request.

**How to apply:**
- When a route uses `require("pkg")` at top-level for runtime-ordering reasons (e.g. `routes/uploadthing.ts` loads after fetch-patch), mocking the SDK directly will silently fail.
- For callback middleware tests, import the real `uploadRouter`, invoke each route's `.middleware({ req })`, and mock only Clerk/database dependencies; a rejecting middleware prevents the post-middleware provider step.
- For app-layer tests of Clerk bypass behavior where loading the SDK is unnecessary, mock the parent module (`vi.mock("../routes/index.js", ...)`) and provide an inline handler that reproduces the auth contract.

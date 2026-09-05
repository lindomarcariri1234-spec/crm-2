---
name: Published chunk verification
description: Design rule for checking code-split frontend assets in the published environment.
---

The publication smoke check can validate Vite code-split chunks without adding a browser dependency: request each route document, follow same-origin JavaScript imports and Vite chunk-map references recursively, and require successful JavaScript content types. Protected route checks must receive a short-lived test session through an environment-provided `Cookie` or `Authorization` header.

**Why:** The failure mode is an HTML document or stale/missing asset served at a JavaScript URL. Recursive published-asset checks catch this at the deployed origin while avoiding hard-coded credentials and the maintenance cost of shipping a browser binary in CI.

**How to apply:** Keep public and protected routes in the same check, include the route name in every asset failure, and never print or commit the authentication header. A browser-level check may complement this later for runtime-only imports, but should not replace the cheap published-asset crawl.
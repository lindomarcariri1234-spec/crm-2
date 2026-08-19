---
name: API typecheck under constrained heap
description: How the API validation stays complete when one TypeScript process exceeds the workflow memory limit
---

The API typecheck must build the real DB and API-Zod declaration outputs first, then run separate TypeScript processes over small groups of production entrypoints. Keep the aggregate entrypoints (`app`, server `index`, and route registration) explicitly covered; do not replace workspace contracts with broad `any` stubs or relax `noImplicitAny`.

**Why:** The full API graph exceeds the workflow heap even when workspace contracts resolve to generated declarations. The largest external declaration graph is `googleapis`, so the validation config uses a narrow, type-only surface for the calendar methods currently used; runtime builds still import the real SDK.

**How to apply:** Preserve build-before-batches ordering, keep each batch below the measured heap threshold, and treat any SDK type shim as a scoped performance tradeoff that should be replaced with accurate request interfaces when practical.
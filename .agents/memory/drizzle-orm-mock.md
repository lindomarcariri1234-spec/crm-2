---
name: drizzle-orm mock completeness
description: Endpoint tests that vi.mock drizzle-orm must include EVERY operator the route uses, or the handler throws TypeError at runtime.
---

## Rule
When endpoint test files (`endpoints.test.ts`, `commission-sync-route-resilience.test.ts`, etc.) do `vi.mock("drizzle-orm", () => ({ ... }))`, every drizzle-orm operator called by the route handler must appear in that map. Unlisted operators resolve as `undefined`; calling `undefined(...)` throws `TypeError` which the Express error handler catches → 500 (masking the true assertion).

**Why:** The route at `POST /reservations` calls `notInArray(...)` for the duplicate-reservation guard (migration 0042). That operator was not in the mock, causing all 7 reservation creation tests to produce 500 instead of 201.

**How to apply:** Before adding a new drizzle-orm operator to any route, grep for its usage in test files and add it to the `vi.mock("drizzle-orm", ...)` block in every test file that covers that route. The full set needed as of July 2026: `eq, and, or, inArray, notInArray, desc, asc, ilike, sql` (with `sql.raw`).

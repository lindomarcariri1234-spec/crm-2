---
name: Drizzle query rejection mocks
description: How endpoint tests should model a rejected Drizzle query when the route catches the terminal query promise.
---

When testing a route-level fallback around a Drizzle query, keep `db.select().from(...)` as a builder and reject the promise returned by its terminal method such as `.where()` or `.execute()`.

**Why:** Rejecting `db.select()` itself bypasses the builder chain and produces a misleading 500 before the route reaches the intended catch.

**How to apply:** Build the same chain methods the handler calls, then return `Promise.reject(...)` from the terminal method that is covered by the production catch.
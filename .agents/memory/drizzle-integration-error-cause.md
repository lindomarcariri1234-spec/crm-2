---
name: Drizzle integration error causes
description: Where PostgreSQL error codes and constraint names appear on failed Drizzle writes.
---

Drizzle wraps node-postgres write failures in `DrizzleQueryError`; the native PostgreSQL `code` and `constraint` fields are on `error.cause`, not the top-level error.

**Why:** A constraint integration test saw PostgreSQL correctly reject an over-limit row, but matching `code` and `constraint` at the top level failed because Drizzle had wrapped the driver error.

**How to apply:** In integration tests asserting a PostgreSQL constraint, match the Drizzle error's `cause.code` and `cause.constraint`.

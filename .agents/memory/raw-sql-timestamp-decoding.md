---
name: Raw SQL timestamp decoding
description: Normalize timestamp aggregates returned by raw PostgreSQL queries before passing them to Drizzle timestamp columns.
---

Raw SQL results do not pass through Drizzle's column decoder. PostgreSQL timestamp aggregates may therefore arrive as strings even when ORM-selected timestamp fields are `Date` objects. Normalize raw timestamp values before comparisons or updates through Drizzle.

**Why:** Drizzle's timestamp encoder calls `toISOString()`; passing a raw string to a Date-mode timestamp column throws at query construction.

**How to apply:** Treat timestamp fields from raw SQL as `Date | string | null` and convert string values to valid `Date` objects at the boundary before storing or comparing them.
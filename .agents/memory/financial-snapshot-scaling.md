---
name: Financial snapshot scaling
description: How to keep period reports bounded without changing current overdue and liability snapshots
---

Period metrics should load only rows within their reporting windows. Current overdue balances and liabilities are different: they span history, so compute them as SQL aggregates and merge the scalar results into the report rather than loading every matching row.

**Why:** Filtering periodic sources alone can look like a performance fix while historical open payments and unpaid commissions still grow API memory and response time without bound.

**How to apply:** Whenever a financial report combines period activity with an as-of snapshot, keep the activity row-bounded, aggregate the snapshot in PostgreSQL, and index both date-window and snapshot predicates by tenant/status.
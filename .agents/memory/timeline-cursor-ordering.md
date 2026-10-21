---
name: Cross-source timeline cursor ordering
description: Keep database paging, in-memory merges, and cursor comparisons consistent when one timeline combines multiple tables.
---

For a timeline merged from multiple sources, use the same complete order in each source query, the in-memory merge, and the cursor predicate. Timestamp ties need a deterministic ID tie-breaker; use an explicit binary collation when database locale ordering could differ from the application comparator.

**Why:** A cursor boundary that compares IDs differently across sources can skip or repeat entries sharing a timestamp.

**How to apply:** When adding a source to a paginated timeline, verify its sort key, SQL cursor predicate, and merge comparator are equivalent, including collation and any source-specific ID prefix.

---
name: PostgreSQL parameter casts in arithmetic
description: Raw SQL arithmetic with interpolated values can fail when PostgreSQL cannot infer parameter types
---

## Rule
When an interpolated value participates in arithmetic inside a raw SQL expression, cast it to the column's intended type at the expression boundary.

**Why:** PostgreSQL can receive interpolated values as `unknown`; operators such as subtraction may then be ambiguous even when the destination column is typed.

**How to apply:** Use explicit casts such as `::integer` or `::numeric` on both arithmetic operands in `sql` templates, and cover the expression with a real PostgreSQL integration test.
---
name: CHECK constraint drift scope
description: Safe expansion of live CHECK-constraint drift checks in the legacy schema.
---

Do not compare every legacy CHECK constraint by raw migration text without reviewing the live PostgreSQL definition. A broad comparison on the development database found 15 other CHECK definitions that did not match their migration text, while the tenant-ID byte-limit constraint matched. Those differences may be semantic formatting or actual drift; they are not confirmed safe.

**Why:** Broadening the drift check without reconciling those existing definitions caused unrelated failures and obscured whether the tenant-ID safeguard itself was present.

**How to apply:** When adding more live CHECK constraints, inspect each difference, distinguish semantic equivalence from real schema drift, and add focused tests before including it in automated verification.

For individually reviewed named checks in incremental `CREATE TABLE` migrations, expect PostgreSQL's default validated state. PostgreSQL can deparse a text `IN ('a', 'b')` rule as `= ANY(ARRAY['a'::text, 'b'::text])`; normalize only that simple text-literal membership form and preserve literal case.

**Why:** The support-ticket status and priority checks are semantically unchanged in the live catalog, but PostgreSQL renders them as `ANY` arrays. Lowercasing literals could hide a real case-sensitive rule change.

**How to apply:** Keep membership normalization narrow, test equivalent and changed literal lists, and compare `convalidated` for rules that must be validated.

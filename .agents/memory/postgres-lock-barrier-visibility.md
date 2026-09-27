---
name: PostgreSQL lock barrier visibility
description: How to synchronize database integration tests when PostgreSQL hides active query text.
---

**Rule:** For database lock barriers, track the blocker dependency graph from a dedicated blocker backend; do not rely only on query text or a direct blocking-PID match.

**Why:** Shared test databases can hide active SQL in `pg_stat_activity.query`. When multiple transactions queue for the same row, only the first waiter may list the test blocker directly; later waiters can block behind that first transaction.

**How to apply:** Use `pg_blocking_pids` recursively to count distinct waiting PIDs whose chain reaches the fixture blocker. When query text is visible, use the SQL or relation as an extra check; when hidden, the blocker chain plus an expected waiter count is the barrier.
---
name: PostgreSQL lock barrier visibility
description: How to synchronize database integration tests when PostgreSQL hides active query text.
---

**Rule:** Use the explicit blocker backend PID and `pg_blocking_pids` for lock-barrier tests; do not rely only on `pg_stat_activity.query`.

**Why:** Some shared test databases return an empty query string while still exposing the lock wait and blocking PID. SQL-text predicates then time out even though the row lock is working.

**How to apply:** Hold a dedicated blocker connection and ensure only one operation is waiting on that lock. Match SQL text or relation names when available; when query text is hidden, the specific blocker PID is the synchronization signal.
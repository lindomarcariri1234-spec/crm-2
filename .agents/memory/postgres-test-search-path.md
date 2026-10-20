---
name: Pooled PostgreSQL temporary schemas
description: Reset connection-local schema state before returning test clients to a shared PostgreSQL pool.
---

When an integration test uses a pooled client with a temporary schema, reset `search_path` before releasing the client. Dropping the schema does not clear the connection's session setting.

**Why:** A later query may reuse the released connection and resolve tables against the now-missing schema, producing misleading “relation does not exist” failures.

**How to apply:** In `finally`, drop the test schema, run `RESET search_path` on the same client, then release it to the pool.

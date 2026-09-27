---
name: Local PostgreSQL integration setup
description: A local server configuration quirk when running the database migration integration tests in this Replit container.
---

**Rule:** Start ephemeral PostgreSQL with its Unix socket directory explicitly set to an existing writable path, such as the data directory.

**Why:** This container's PostgreSQL build defaults to `/run/postgresql`, which is absent; without an explicit socket path, `pg_ctl` reports that startup failed even though initialization succeeded.

**How to apply:** When running local-only database integration tests, pass `-k <writable-directory>` to `postgres` through `pg_ctl -o`; the test can still connect over `127.0.0.1`.
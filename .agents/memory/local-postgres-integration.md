---
name: Local PostgreSQL integration setup
description: A local server configuration quirk when running the database migration integration tests in this Replit container.
---

**Rule:** Start ephemeral PostgreSQL with its Unix socket directory explicitly set to an existing writable path, such as the data directory.

**Why:** This container's PostgreSQL build defaults to `/run/postgresql`, which is absent; without an explicit socket path, `pg_ctl` reports that startup failed even though initialization succeeded.

**How to apply:** When running local-only database integration tests, pass `-k <writable-directory>` to `postgres` through `pg_ctl -o`; the test can still connect over `127.0.0.1`.

**Process lifetime:** Keep the local PostgreSQL server in a persistent background shell task while migrations and tests run.

**Why:** A one-shot shell can terminate daemonized child processes when it exits, leaving later test commands with `ECONNREFUSED` even though startup and migrations succeeded.

**How to apply:** Start the cluster in a background task that stays alive, run the migration and tests against it, then stop the database and the task.
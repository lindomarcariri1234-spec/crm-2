---
name: Disposable PostgreSQL integration tests
description: Safe setup for PostgreSQL integration tests that require the isolated visitecrm_test database.
---

In this Replit Nix container, a temporary local PostgreSQL server must use a writable Unix socket directory such as its temporary data folder; the default `/run/postgresql` directory may not exist. Bind the test server to loopback and use the test suite's required database name so its isolation guard accepts the connection.

**Why:** Integration tests write data and explicitly refuse non-isolated databases; using an application or production database would risk modifying real records.

**How to apply:** For database integration tests, start a disposable local cluster with `unix_socket_directories` set to a writable temp folder, create `visitecrm_test`, apply migrations using a process-local `DATABASE_URL`, run only the target test, then stop and remove the cluster.

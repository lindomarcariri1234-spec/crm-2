---
name: Testing harness gotchas
description: Index of project-specific Vitest mock, integration-database, and validation pitfalls.
---

Detailed notes by failure mode:

- [CJS require mock bypass](cjs-require-vitest-mock.md)
- [Vitest one-time mock queue isolation](vitest-mock-queue.md)
- [Drizzle mock completeness](drizzle-orm-mock.md)
- [Storefront test mock ordering](store-public-test-mock-layout.md)
- [Frontend SSE component harness](frontend-sse-component-tests.md)
- [Endpoint database mock exports](endpoint-test-db-mock-exports.md)
- [Query rejection mocks](drizzle-query-rejection-mocks.md)
- [Concurrent mock call ordering](concurrent-mock-order.md)
- [Referral select-count expectations](referrals-test-select-count.md)
- [Integration test isolation and batching](vitest-db-integration-isolation.md)
- [Test-suite batching](test-suite-batching.md)
- [Vitest mock-call typing](vitest-mock-call-typing.md)
- [Tests excluded from typecheck](test-files-excluded-from-typecheck.md)
- [Concurrent audit snapshots](concurrent-audit-snapshot-tests.md)
- [Radix form harness](radix-form-test-harness.md)
- [Vitest 4 constructor mocks](vitest4-constructor-mocks.md)
- [Local PostgreSQL integration setup](local-postgres-integration.md)
- [PostgreSQL lock-barrier visibility](postgres-lock-barrier-visibility.md)

## GitHub Actions PostgreSQL isolation

For an isolated-database guard, permit the CI service database only when `CI` is `"true"`, the database name is exactly `visitecrm_ci`, and the configured URL host is loopback. Do not require PostgreSQL's `inet_server_addr()` to be loopback in GitHub Actions.

**Why:** The Actions job connects through `localhost`, but PostgreSQL reports its service container's bridge-network address.

**How to apply:** Keep the developer path constrained to the dedicated local test database and loopback server address; use the exact CI database name plus a loopback URL host for the hosted-service path.
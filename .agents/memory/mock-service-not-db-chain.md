---
name: Mock service functions, not raw DB chains, in route tests
description: When a route delegates to an already-unit-tested service function, mock that function directly instead of replicating its internal db.select/insert call sequence
---

## Rule
When testing a route handler (e.g. via supertest) that calls into a service module (e.g. `createReservationsForOrder`, `ensurePortalAccount`) which is *itself* covered by its own unit tests, `vi.mock` the service module and assert on how the route calls it (arguments, call count, ordering relative to the response) — do not re-mock the service's internal `db.select().from().where()...` chain step-by-step from the route test.

**Why:** Chaining low-level DB mocks to match a service's internal call order is extremely brittle — any refactor of the service's internal query order (even a behavior-preserving one) breaks unrelated route tests with a confusing 500 instead of a clear assertion failure. It also duplicates coverage the service's own unit tests already provide, and makes the route test unreadable (dozens of `mockResolvedValueOnce` calls with no clear correspondence to route behavior).

**How to apply:**
- Identify the service-layer boundary the route delegates to.
- `vi.mock("../services/checkout/create-reservations.js", () => ({ createReservationsForOrder: vi.fn() }))` (adjust path/name), then set return values per test with `mockResolvedValueOnce`.
- Assert the route: (a) calls the service with the right args, (b) reacts correctly to its return value/thrown error, (c) does NOT call it when preconditions aren't met (e.g. no trip-linked products).
- Leave deep DB-chain mocking for the service's own unit/integration test file, where the internal query sequence is the actual thing under test.

---
name: broadcastSeatUpdate dual-query mock pattern
description: realtime.ts makes two db.select() calls; test mock must use call-count routing to distinguish chains
---

# broadcastSeatUpdate dual-query mock pattern

## The rule
`realtime.ts::broadcastSeatUpdate` makes **two sequential `db.select()` calls**:
1. Reservations query: `.select().from(reservationsTable).where()` → resolves to reservations array
2. Trip freePassengers query: `.select().from(tripsTable).where().limit(1)` → resolves to `[{ freePassengers: [] }]`

The `@workspace/db` mock in `broadcastSeatUpdate.test.ts` must expose **both** `reservationsTable` and `tripsTable`, and must return **different mock chains** for each `db.select()` call.

## How to apply
Use `mockSelect.mock.calls.length` (cleared per test by `vi.clearAllMocks()`) to route chains:

```ts
const mockSelect = vi.fn(() => {
  const n = mockSelect.mock.calls.length;
  return n === 1 ? { from: mockResFrom } : { from: mockTripFrom };
});
```

- Chain 1 (n=1, reservations): `.from().where()` → `mockResWhere.mockResolvedValue([...reservations])`
- Chain 2 (n=2, trip): `.from().where().limit()` → `mockTripLimit.mockResolvedValue([{ freePassengers: [] }])`

In `beforeEach`: `vi.clearAllMocks()` + reset both `mockResWhere` and `mockTripLimit` defaults.

**Why:** Adding `tripsTable.freePassengers` lookup to realtime.ts broke the existing single-chain mock. The call-count approach is stable because `vi.clearAllMocks()` clears `mock.calls` each test, resetting the counter without touching implementations.

**File:** `artifacts/api-server/src/__tests__/broadcastSeatUpdate.test.ts`

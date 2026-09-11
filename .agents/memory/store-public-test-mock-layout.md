---
name: store-public test mock layout
description: Mock chain rules for store-public.test.ts (POST /orders checkout endpoint tests)
---

## Rule: productId in body must match the fetched product's id

`prepareCheckoutItems` keys `fetchedProducts` by `product.id` (the DB value) and `quantityByProductId` by the body's `item.productId`. If these differ (e.g., body sends `"prod-trip"` but the mock returns a product with `id="prod-001"`), then `tripLinkedProducts` ends up empty and the cap/seat checks are never reached. Always use `FAKE_PRODUCT.id` as the `productId` in test bodies.

**Why:** The mock doesn't filter by query parameters — it just returns whatever was queued. So the body productId must match the mock product's id for the in-memory maps to align.

**How to apply:** When writing a test for a trip-linked product, ensure `items: [{ productId: FAKE_PRODUCT.id, quantity: N }]` and `tripProduct = { ...FAKE_PRODUCT, tripId: "..." }`.

## Rule: mockLimit.mockReset() + mockTransaction.mockReset() in beforeEach

Added to `beforeEach` to prevent once-queue leaks. `vi.clearAllMocks()` only clears call records, NOT `mockResolvedValueOnce` or `mockImplementationOnce` queues. An early-returning handler (e.g., returns 409 before calling `db.transaction`) leaves any `mockTransaction.mockImplementationOnce` unconsumed, corrupting the next test.

**Why:** Vitest's `clearAllMocks` = `mockClear` which does NOT reset once queues. Only `mockReset()` does.

**How to apply:** After `vi.clearAllMocks()` in beforeEach, call `mockTransaction.mockReset()` and `mockLimit.mockReset()`, then immediately re-set the default implementations with `mockImplementation(...)`.

## mockLimit slot order (per-request, after any reset)

For a standard trip-linked product checkout:
1. `getActiveStore` → `[FAKE_STORE]`
2. `prepareCheckoutItems` product fetch → `[tripProduct]`
3. `prepareCheckoutItems` Phase 1.5 seat check → `[{ availableSeats: N }]`
4. `loadReservationContext` admin user → `[{ id: "admin-001" }]`
5. IP hold check → `[]` (no prior hold) or `[{ holdCount: N }]`
6. post-tx order re-fetch → `[FAKE_ORDER]`

The per-order cap check fires BETWEEN slots 3 and 4 (no DB calls).

## Rule: terminal orderBy chains must be awaitable

When a route query ends at `.orderBy()` without a following `.limit()`, the shared
mock chain must return a thenable that resolves to the row array while still
exposing `.limit()` for queries that continue. Returning only `{ limit }` makes
`await query` produce an object and causes failures such as `rows.reduce is not a function`.

**Why:** Storefront checkout reads cashback rows with a terminal orderBy, while
other reads use orderBy followed by limit; the same chain fixture must model both
forms.

**How to apply:** In a focused test, return `Object.assign(Promise.resolve(rows), { limit: mockLimit })`
from the orderBy mock and keep limit responses in the normal FIFO queue.

## Pre-existing failures (do not fix)

- `"does not apply discount when referral code is expired"` → 500 from `buildTxMock().insert` lacking `.returning()`
- `"calls enqueueReservationConfirmationEmail ..."` → same root cause

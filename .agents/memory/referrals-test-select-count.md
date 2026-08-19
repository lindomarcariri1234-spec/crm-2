---
name: referrals test select count drift
description: How many db.select mocks each referral-bonus test needs — drifts whenever a new select is added to the handler
---

## Rule

Every `db.select` call in the handler must have a corresponding `mockImplementationOnce`. A missing mock causes the chain to get `undefined` from the base `vi.fn()`, throwing TypeError → 500 (instead of the expected status code).

**Why:** The `vi.fn()` base returns `undefined` by default. Calling `.from()` on `undefined` throws immediately, which is caught by the try-catch and returns 500. The test sees 500 instead of 200/422/etc.

**Diagnostic tip:** If a test returns 500 unexpectedly, count how many `db.select` calls the handler makes vs how many `mockImplementationOnce` are registered. A mismatch is the most common cause.

## Current select counts (as of this note)

### POST /api/referrals/:id/pay-bonus (3 selects total)
```
1. referral + LEFT JOIN clientsTable + LEFT JOIN tenantsTable
2. referralSettingsTable (grace period for bonusPaid lock check)
3. referral + LEFT JOIN clientsTable (refetch after update)
```
Mock order: `[joinedRow, [], refetchRow]` (empty `[]` for settings → gracePeriodDays defaults to 30)

### GET /api/referrals (3 or 4 selects)
```
1. COUNT select (with LEFT JOIN clientsTable)
2. rows select (with LEFT JOIN clientsTable)
3. referralTrackingTable aggregation — CONDITIONAL on codes.length > 0
4. referralSettingsTable (gracePeriodDays for bonusReleasesAt computation) — ALWAYS
```
Mock order: `[count, rows, tracking, settings]`
When rows is empty: tracking select is skipped → `[count, empty, settings]` (3 total)

**How to apply:** When adding a new `db.select` call to a referral handler, immediately add the corresponding `mockImplementationOnce(() => makeChain([]))` to ALL affected tests. Check both `referral-bonus.test.ts` and any other file that tests the same endpoint.

---
name: Referral cap concurrency
description: The transactional pattern used to enforce max referrals per referrer without allowing concurrent conversions to pass the cap.
---

When `maxReferralsPerUser` is active, first perform a conditional no-op update on the referrer row with `successful_referrals < cap`, then increment the counters later in the same transaction.

**Why:** PostgreSQL keeps the row lock from the conditional update until the checkout transaction commits, so a concurrent conversion rechecks the cap after the first conversion. A plain read followed by an increment allows both conversions to pass.

**How to apply:** keep the tenant predicate on both the reservation update and the final counter update; preserve the no-op update shape because conversion unit-test transactions may not expose Drizzle's `.for("update")` chain.
---
name: Referral cap concurrency
description: The transactional pattern used to enforce max referrals per referrer without allowing concurrent conversions to pass the cap.
---

Lock the tenant-scoped referrer before reading its conversion count or computing its tier, and retain that lock through the conversion transaction. For campaign-wide conversion caps or budgets, also lock the capped campaign row before reading usage; compare the projected tier-adjusted bonus to the remaining budget, then persist the conversion before releasing the transaction.

**Why:** Per-referrer locking cannot protect a campaign-wide limit when different referrers convert at the same time. A campaign-row lock serializes those transactions, and the following usage query gets a fresh committed snapshot before the referral write.

**How to apply:** Keep tenant predicates on locked lookups and final updates. Test doubles must support the locking chain; do not remove a production lock to accommodate mocks. Use real PostgreSQL concurrency tests with different referrers for campaign-wide limits.
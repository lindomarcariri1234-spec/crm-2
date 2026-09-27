---
name: Referral cap concurrency
description: The transactional pattern used to enforce max referrals per referrer without allowing concurrent conversions to pass the cap.
---

Lock the tenant-scoped referrer before reading its conversion count or computing its tier, and retain that lock through the conversion transaction.

**Why:** A conditional no-op update previously protected the cap, but its preceding read could still produce stale tier decisions. Reading under a row lock protects both cap and tier, and real PostgreSQL concurrency tests confirm the limit.

**How to apply:** Keep tenant predicates on the locked lookup and all final updates. Test doubles must support the locking chain; do not remove a production lock to accommodate mocks.
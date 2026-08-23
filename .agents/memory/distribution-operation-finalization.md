---
name: Distribution operation finalization
description: Consistency rules for supplier-style operations that consume or release local capacity.
---

For distribution operations that affect local availability, commit the capacity change, tenant-owned booking ledger transition, and operation terminal state in one database transaction. A separate sequence can leave a permanent capacity leak or an unmanageable order if the process stops between statements.

**Why:** A successful external acknowledgement is not sufficient when the local audit record, booking lookup, and capacity counter are each independently persisted. Recovery retries must recognize completed idempotent operations and deterministically restore a missing ledger row before responding.

**How to apply:** Reserve only as part of the final transactional success path; release capacity only alongside the confirmed-to-cancelled transition. On an idempotent replay, return the saved completed result before mutable quote-expiry checks, and ensure the tenant booking ledger exists.
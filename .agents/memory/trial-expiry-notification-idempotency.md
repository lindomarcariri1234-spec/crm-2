---
name: Trial expiry notification idempotency
description: Cross-instance deduplication for tenant trial expiry emails without changing the immutable tenant schema
---

Trial expiry email windows use a unique platform-settings ledger key containing the tenant, trial end date, and window.

**Why:** The consolidated database baseline is intentionally immutable, while the scheduled job must remain idempotent across restarts and multiple API instances.

**How to apply:** Claim the ledger row atomically before sending, keep successful claims, and delete only the same claim token when delivery fails so a later run can retry safely.
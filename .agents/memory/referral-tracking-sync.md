---
name: Referral tracking synchronization
description: Public referral visits and CRM referral summaries must remain consistent through one atomic update.
---

# Referral tracking and CRM synchronization

Treat `referral_tracking` as the event-level source of truth for public referral
visits. When recording a visit, update the tracking record and reconcile the
matching CRM referral summary (`visitsCount`, `firstVisit`, and `lastVisit`) in
the same transaction. Keep notifications outside that transaction so delivery
failures do not roll back attribution.

**Why:** separate writes left the SI and CRM with partial counts or dates when
one database operation failed, while the admin list and analytics then showed
different versions of the same referral.

**How to apply:** scope every read and write by tenant, preserve the original
tracking code for returning cookies, use an aggregate for historical rows, and
return the server-issued cookie only after the transaction commits.
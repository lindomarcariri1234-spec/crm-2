---
name: Financial integrity release alerts
description: Privacy and duplicate-prevention rules for migration integrity emails.
---

Integrity alert emails contain only migration status and aggregate counts for the approved categories. Do not include row details, identifiers, descriptions, recipient, release ID, or provider errors in the email body.

**Why:** the alert is a deployment signal, not a financial data export; repeated API boots and build hooks for one release must not send duplicate notices, and an uncertain mail-provider outcome must not block startup or publication.

**How to apply:** use one durable, unique claim per stable publication version across API startup and deployment migration steps. Claim before sending and retain the claim if delivery fails or times out; log only the approved aggregate results and a generic delivery outcome.
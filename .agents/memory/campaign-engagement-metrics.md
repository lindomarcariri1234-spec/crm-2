---
name: Campaign engagement metrics
description: Idempotent, tenant-scoped campaign outcome counters from provider callbacks.
---

Treat `campaign_sends` as the unique-recipient engagement ledger. Provider callbacks conditionally stamp one timestamp per metric and increment campaign totals only when that timestamp is first written. Overall delivery is channel-agnostic; email delivery is counted separately, and opens/clicks are email-only. A null tracking-start timestamp means historical metrics are unavailable, not zero.

**Why:** Provider webhooks may replay or arrive from multiple channels for one recipient; counting callback events directly inflates totals, and campaigns sent before tracking began have no reliable historical outcome data.

**How to apply:** When changing campaign webhooks or analytics, keep metric updates tenant-scoped and atomic with first-write timestamps. Preserve the distinction between unavailable and measured-zero outcomes in API responses and UI.

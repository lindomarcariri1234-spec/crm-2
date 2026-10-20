---
name: Resend complaint delivery semantics
description: Treat Resend complaints as both a complaint outcome and evidence that the email was delivered.
---

For `email.complained`, persist its complaint timestamp and count separately, but treat the callback as evidence of delivery too. Keep complaint metrics gated by the campaign's failure-tracking start marker so campaigns sent before tracking was enabled still show complaint outcomes as unavailable.

**Why:** A complaint happens after the recipient receives an email, while `email.bounced` and `email.failed` indicate it did not reach the recipient. An out-of-order complaint callback should not label a delivered message as failed.

**How to apply:** In Resend webhook handling and campaign outcome aggregation, preserve delivery-confirmed status for complaints and count the complaint independently, while retaining the availability guard for legacy campaigns.

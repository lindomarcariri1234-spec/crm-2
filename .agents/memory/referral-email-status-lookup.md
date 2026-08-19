---
name: Referral email delivery-status lookup
description: How referral expiry/bonus-release email delivery status is resolved from email_logs, and why it relies on subject matching.
---

# Referral email delivery-status endpoints

The `/referrals/:id/expiry-email-status` and `/referrals/:id/bonus-release-email-status` endpoints resolve delivery status from the `email_logs` table.

`email_logs` has NO email-type / template discriminator column. Both endpoints are tenant-scoped (`referrals.tenantId` AND `emailLogs.tenantId` = caller's tenant). They distinguish *which* referral email a log row is by:
- `email_logs.referralId = :id`, PLUS
- for bonus-release: `subject ILIKE '%disponível para resgate%'` (the fixed subject set by `enqueueReferralBonusReleasedEmail`).

**Why:** there is no `type`/`template` column to filter on, and expiry emails also stamp `referralId`, so subject matching is the only way to separate bonus-release from expiry logs for the same referral.

**How to apply:** this is fragile against subject/localization changes. If you change a referral email subject, update the matching ILIKE in the status endpoint in lockstep. The durable fix (do this when the schema next changes) is to add an explicit email-type/template column to `email_logs` and filter on it instead of the subject string.

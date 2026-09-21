---
name: Referral email delivery-status lookup
description: How referral expiry/bonus-release email delivery status is resolved from email_logs using stable notification types with legacy backfill.
---

# Referral email delivery-status endpoints

The `/referrals/:id/expiry-email-status` and `/referrals/:id/bonus-release-email-status` endpoints resolve delivery status from the `email_logs` table.

`email_logs.notification_type` is the stable discriminator. Both endpoints are tenant-scoped (`referrals.tenantId` AND `emailLogs.tenantId` = caller's tenant) and filter by `email_logs.referralId` plus:
- expiry: `expiry_warning_7` or `expiry_warning_1`
- bonus release: `bonus_released`

Historical rows are retained. Migration backfill uses recognizable legacy subjects once; new writes persist the type directly, so later subject or locale changes do not affect reconciliation.

**Why:** subject, translated body, and recipient are presentation/delivery data, not stable reconciliation keys.

**How to apply:** every new referral notification producer must persist `notificationType` and include `referralId`; status and retry code must never reintroduce subject or recipient matching.

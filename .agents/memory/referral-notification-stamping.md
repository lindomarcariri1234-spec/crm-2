---
name: Referral notification stamping
description: Referral warning and bonus-release sent markers must follow durable delivery acceptance.
---

Referral notification columns are delivery markers, not claims. Stamp them only after the outbound email delivery is accepted, pending in the durable queue, or processing; failed, skipped, and unknown outcomes must remain eligible for recovery. Concurrent callers may both reach the idempotent outbound dispatcher, but only one should win the final marker update.

**Why:** Marking before dispatch permanently hid transient provider or queue failures, while a pre-dispatch claim also made manual recovery report success without a delivered notification.

**How to apply:** Keep notification identity stable through `email_logs.notificationType` and use a separate attempt suffix for intentional manual resends.
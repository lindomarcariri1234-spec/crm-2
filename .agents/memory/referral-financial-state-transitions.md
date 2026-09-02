---
name: Referral financial state transitions
description: Durable rules for keeping referral payment and conversion state consistent under admin edits and concurrent requests.
---

# Referral financial state transitions

Financial referral transitions must be narrow and atomic. Administrative metadata updates may expire a pending referral, but must not directly set conversion timestamps, payment flags, or terminal financial statuses. A payment claim must require the expected converted state and unpaid flag in the same `UPDATE`, confirm an affected row with `RETURNING`, and only then enqueue notifications.

**Why:** A read-then-write check allows concurrent payment requests or reversal callbacks to both appear valid, producing duplicate deliveries or a paid/reversed referral with mismatched balances, commissions, or points.

**How to apply:** Keep conversion and reversal effects in their dedicated transactional flows. For any new financial side effect, add its state guard to the atomic claim and make retries/no-op races skip the side effect when no row was claimed.
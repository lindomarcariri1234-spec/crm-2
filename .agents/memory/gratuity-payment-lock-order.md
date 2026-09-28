---
name: Gratuity and payment lock order
description: Avoid deadlocks when a gratuity transition and payment update contend.
---

Do not cancel pending receivables while holding the reservation row lock during a gratuity transition. Payment status updates lock the payment before they update its reservation, so waiting on payment rows in the reverse order can deadlock. Commit the reservation’s gratuity and capacity transition first, then cancel eligible unpaid receivables in a separate transaction.

**Why:** Concurrent payment status updates and gratuity conversion otherwise acquire the same reservation and payment locks in opposite orders.

**How to apply:** Any flow that changes reservation financial state and linked payment rows must preserve a consistent lock order or split the work so it never holds the reservation lock while waiting for a payment lock. Keep paid-payment history unchanged.
---
name: Marketplace capacity lifecycle
description: When dated partner capacity is reserved and released in marketplace checkout.
---

Partner availability is claimed atomically only when payment is confirmed, never when an anonymous checkout is created. Dated partner offers require a canonical `YYYY-MM-DD` value before checkout can proceed; transfers are intentionally undated.

**Why:** Unpaid or abandoned checkouts must not permanently consume a partner's sellable inventory. The conditional update protects the last seats against payment-time concurrency.

**How to apply:** Any future payment confirmation path that creates an operational order must invoke the shared inventory effects in its transaction. A cancellation can release availability only after its item state changes atomically to cancelled.
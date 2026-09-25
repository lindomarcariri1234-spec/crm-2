---
name: Reservation expiry payment locks
description: Concurrency rule for expiring storefront reservation holds while payment attempts are being recorded.
---

The reservation-expiry transaction and every storefront payment path must acquire the store-order row lock before locking or changing its reservations. A paid receipt protects the hold only when it is both `receivable` and `paid`, and it may be linked through either the reservation or the order.

**Why:** A payment row inserted after expiry releases capacity can leave a paid record attached to a cancelled reservation, while treating pending or failed gateway attempts as payment received can hold capacity forever. A shared order lock gives expiry, gateway confirmation, and manual payment creation one deterministic winner.

**How to apply:** Preserve the order-before-reservation lock order in new checkout, webhook, manual-payment, cancellation, or reconciliation paths. Keep payment eligibility checks tenant-scoped and status/type-specific.
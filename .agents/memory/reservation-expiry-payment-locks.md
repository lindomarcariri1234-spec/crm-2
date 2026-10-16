---
name: Reservation expiry payment locks
description: Concurrency rule for expiring storefront reservation holds while payment attempts are being recorded.
---

The reservation-expiry transaction and every storefront payment path must acquire the store-order row lock before locking or changing its reservations. A hold is protected only when paid receivables total at least the reservation's deposit threshold, or its full value when no deposit is configured. A confirmed gateway payment arriving after cancellation is recorded against the cancelled order for manual refund review; never reactivate released capacity automatically.

**Why:** Any nonzero partial payment must not pin a pending reservation indefinitely, and a provider may confirm money after the cleanup transaction has already released the seat. Reopening that reservation could oversell inventory; dropping the gateway receipt would hide received money.

**How to apply:** Preserve the order-before-reservation lock order in checkout, webhook, manual payment, cancellation, and reconciliation paths. Count only tenant-scoped paid receivables toward the appropriate reservation threshold; keep late settlements idempotent and visibly flagged for manual refund handling without running booking or post-payment effects.
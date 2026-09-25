---
name: First-purchase referral reservation
description: Concurrency rule for referral discounts limited to a customer's first completed purchase
---

The first-purchase referral benefit is reserved inside the checkout order transaction with a PostgreSQL transaction advisory lock keyed by tenant and normalized customer email. A pending order carrying a referral intent blocks another discounted checkout; cancelled or refunded orders do not.

**Why:** The pre-check for completed orders runs before persistence and cannot prevent two concurrent checkouts from both receiving the discount. The pending order must reserve eligibility until payment or cancellation resolves it.

**How to apply:** Keep the referral code reusable across different referred customers. Preserve idempotent replay by excluding the same order ID, and return a dedicated conflict code when another active order owns the reservation.
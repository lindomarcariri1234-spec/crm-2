---
name: Mixed-order receipt allocation
description: How order-level confirmed receipts are represented on child reservations without inventing or losing cents.
---

When one checkout order contains multiple reservations, allocate its confirmed order-level receipts proportionally to each reservation's net total. Perform the allocation in integer cents and assign rounding remainders deterministically so child allocations reconcile exactly.

**Why:** Payments can be linked only to the parent order. Treating every child as unpaid hides real receipts, while independently rounding proportional shares loses or creates cents and can produce contradictory balances.

**How to apply:** Any reservation-facing summary, voucher eligibility check, portal view, or pipeline view for a mixed order must use the same allocation rule and retain the parent order's cancelled/refunded/failed state precedence.
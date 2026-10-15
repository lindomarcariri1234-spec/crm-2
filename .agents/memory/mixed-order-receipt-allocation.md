---
name: Mixed-order receipt allocation
description: How order-level confirmed receipts are represented on child reservations without inventing or losing cents.
---

When one checkout order contains multiple reservations, allocate its confirmed order-level receipts proportionally to each reservation's net total. Perform the allocation in integer cents and assign rounding remainders deterministically so child allocations reconcile exactly.

**Why:** Payments can be linked only to the parent order. Treating every child as unpaid hides real receipts, while independently rounding proportional shares loses or creates cents and can produce contradictory balances.

**How to apply:** Any reservation-facing summary, voucher eligibility check, portal view, or pipeline view for a mixed order must use the same allocation rule and retain the parent order's cancelled/refunded/failed state precedence.

## Partial Stripe refunds

Keep the original paid receipt rows intact. Represent cumulative partial refunds
as deterministic negative receivable rows allocated proportionally across the
charge's order-level and reservation-linked receipts in integer cents. Replays
update the same per-receipt refund rows; reservation balance refreshes must not
change an active reservation's status.

**Why:** Mutating gross payment amounts loses receipt history and makes cumulative
Stripe refund events difficult to replay safely. A stable negative allocation
preserves the original receipt while making paid totals net of refunds.

**How to apply:** Select only original positive receipt rows for the order and
payment intent, allocate the cumulative refund with deterministic cent remainders,
and refresh affected client totals after commit. Full refunds continue to use
the existing terminal cancellation path.
---
name: Financial balance period scoping
description: How financial periods filter overdue items and unpaid commissions while preserving the current user referral balance
---

For period reports, overdue receivables and payables include only currently open payments whose due date falls inside the selected window and before the report's as-of time. User debt combines the current tenant-wide user referral balance with currently unpaid seller and referral commissions created inside the selected window.

Keep these totals as SQL aggregates rather than loading all matching history. The referral balance remains a current snapshot because the metrics endpoint does not have a reliable period-level balance breakdown.

**Why:** The chosen reporting meaning is current open obligations associated with dates in the selected period, not a reconstruction of historical balances. The referral balance itself remains current; summing it as if it were earned in the selected window would misstate the metric.

**How to apply:** Keep date predicates tenant-scoped and end-exclusive. Use due dates for overdue payments and creation dates for unpaid commissions. Keep UI labels explicit that user debt includes the current referral balance plus period-scoped unpaid commissions; do not call the whole total a historical or period balance.
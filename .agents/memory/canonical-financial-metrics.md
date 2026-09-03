---
name: Canonical financial metric semantics
description: Rules for keeping VisiteCRM financial totals comparable without double counting distinct financial concepts.
---

Use payment rows for cash received and open receivables/payables; use reservation rows for booked value and discounts. General expenses and trip costs remain separate sources. Seller commissions, referral commissions, client bonuses, client credits and current user referral balances are distinct concepts and must be reported separately.

Cash profit subtracts paid operating costs, paid commissions and paid client bonuses from received revenue. Accrued totals must never be silently mixed into that cash formula.

Potential duplicates across general expenses and trip costs may be diagnosed, but must not be automatically merged using amount/date similarity because there is no immutable cross-source identity.

For a storefront order linked to one reservation, the order's discounted total is the canonical booking total. `depositAmount` is only the requested minimum; only paid receivable rows count as received. Real balance is discounted total minus confirmed receipts.

**Why:** Similar values can represent different liabilities, while one checkout can also span multiple reservations. Heuristic merging either loses valid costs or creates double counting.

**How to apply:** Reuse the canonical financial metrics contract for agency dashboards and insights. Show requested deposit separately from payment received, derive the balance from confirmed receipts, and preserve centavo rounding, explicit America/Sao_Paulo periods, tenant-scoped queries and source-specific status/date semantics.
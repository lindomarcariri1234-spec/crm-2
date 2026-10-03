---
name: Operational-cost payable associations
description: Invariants for linking payables to agency expenses and trip costs.
---

Only an explicit staff action and source ID may link a payable to an operational cost. Never infer links from matching amounts or dates. At link time, require a tenant-scoped payable with matching type, cent-exact amount, and compatible status.

When an agency expense is already linked to a trip cost, the payable must use the agency expense as its source. The consolidated expenses list then displays one financial source and cannot create duplicate payable associations for the same cost.

Keep status and paid-at changes synchronized between a linked payable and its source. Lock in payment → agency expense → trip cost order, and recheck the association after locking. Direct source deletion and parent-trip cascades must not silently clear a source link; require staff to unlink first.

**Why:** Payables and operational costs are separate ledgers. The explicit relationship is a user decision, and losing it through inference or a cascade can detach financial history or double-count the cost.

**How to apply:** Preserve these rules in future payment, expense, trip-cost, and trip-deletion routes; enforce one payable per source in the database as well as in application checks.
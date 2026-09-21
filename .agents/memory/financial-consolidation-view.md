---
name: Financial consolidation view
description: Product rules for presenting planned trip costs, realized costs, agency expenses, and sale prices together.
---

Planning amounts and sale prices are separate from realized costs. Direct trip costs and agency expenses may share a category and must be normalized before being grouped, while cancelled rows remain auditable but contribute zero to realized totals.

**Why:** Combining planning or prices into realized totals creates false expenses, and keeping agency category codes separate from trip labels hides the true category total.

**How to apply:** For a selected trip, load its financial read model so prices, planned rows, direct costs, and agency expenses stay synchronized. For the global expenses view, aggregate planned costs across the trip list but only show sale prices when one trip is selected; never invent a global price by summing or averaging trip prices.
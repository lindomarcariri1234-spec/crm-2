---
name: Store variant checkout pricing
description: Server-authoritative variant selection and pricing for public-store checkout.
---

**Rule:** The public checkout must calculate the selected variant's unit price from the product's stored variant options, matched by variant name and label. Treat the client-supplied unit price as display-only.

**Why:** The storefront exposes option-specific prices, so charging only the base product price can undercharge or overcharge customers; trusting a posted price would also allow price tampering.

**How to apply:** When checkout accepts variants, validate the selected option against the current tenant/store product and persist the matched name and label for order tracking.

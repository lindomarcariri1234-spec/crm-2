---
name: Storefront analytics privacy
description: First-party tenant-scoped storefront aggregates and privacy limits.
---

Storefront reporting uses first-party tenant/store daily counters. Client event bodies use controlled page/group/source dimensions only; never include visitor identity, product IDs, search text, or free-form content. A public store slug may be used only in the routing path to resolve the store. Existing product `viewsCount` rankings are lifetime totals and must be labeled that way.

**Why:** Agencies need page and product interest reporting without identifying visitors; product rankings reuse the existing all-time view counter rather than implying a period-specific measure.

**How to apply:** Aggregate validated events by tenant/store and São Paulo calendar day. Keep event payloads bounded, avoid visitor-level claims, and label all-time product views separately from period metrics.

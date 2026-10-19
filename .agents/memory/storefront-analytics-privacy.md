---
name: Storefront analytics privacy
description: First-party tenant-scoped storefront aggregates and privacy limits.
---

Storefront reporting uses first-party tenant/store daily counters. Client event bodies use controlled page/group/source dimensions only; never include visitor identity, product IDs, search text, or free-form content. A public store slug may be used only in the routing path to resolve the store. Existing product `viewsCount` rankings are lifetime totals and must be labeled that way. Derived ratios such as events per 100 page views are event-count relationships, not visitor or conversion rates; event types may repeat.

**Why:** Agencies need page and product interest reporting without identifying visitors; product rankings reuse the existing all-time view counter rather than implying a period-specific measure, and repeated events cannot establish unique-person conversion.

**How to apply:** Aggregate validated events by tenant/store and São Paulo calendar day. Keep event payloads bounded, avoid visitor-level claims, label all-time product views separately from period metrics, and disclose the event and page-view denominator when showing derived ratios.

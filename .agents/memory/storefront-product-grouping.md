---
name: Storefront product grouping
description: Decision separating public travel/other merchandising from commercial product types and operational trip links.
---

Persist public storefront grouping independently from `store_products.type`, `store_categories`, and `tripId`. A linked operational trip always belongs to the public travel group; an unlinked offer can be explicitly assigned to either travel or other.

**Why:** Product type determines commercial behavior, categories organize the store, and `tripId` is the real operational relationship. None should be overloaded to classify an unlinked offer for storefront navigation.

**How to apply:** Keep public filters and homepage grouping based on the saved storefront group, with `tripId` as the linked-trip override. Update the admin editor, API, and public product responses together when the grouping contract changes.

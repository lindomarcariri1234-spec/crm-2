---
name: Client trip visibility
description: Access policy for customer accounts reading trip endpoints.
---

**Rule:** Authenticated client accounts may read only trips linked to their own reservations through internal trip routes. The public storefront remains the catalog for browsing available trips.

**Why:** The user selected reservation-only access during the security audit to keep customer views separate from agency trip operations.

**How to apply:** Scope client trip lists and detail routes through the caller's tenant-scoped client record and reservations. Do not expose staff-only trip costs, driver documents or contact details, or agency revenue aggregates to clients.

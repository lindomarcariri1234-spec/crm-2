---
name: Storefront analytics privacy
description: Privacy limits for storefront preference and conversion events.
---

Storefront analytics events must use only controlled group/source dimensions. Do not send store slugs, product or record IDs, personal data, or free-form content.

**Why:** The preference funnel should compare interest in travel versus other store items without identifying visitors.

**How to apply:** Use the shared safe event wrapper and keep future storefront funnel instrumentation within these dimensions.

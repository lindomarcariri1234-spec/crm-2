---
name: Commission travel scope
description: How commission rules classify destination countries and select national or international rules.
---

Blank or placeholder destination values must not imply either national or international travel; return no travel scope so rule selection falls through to the general rule. Brazil is national, and a known non-Brazil destination is international. Rule precedence is trip-specific, matching travel scope, then general. Preview and reservation synchronization must use the same helpers.

**Why:** Missing or placeholder country data must not accidentally select a category-specific payout, and preview/synchronization must not disagree about the commission amount.

**How to apply:** Keep country classification centralized. If destination data conventions change, extend the unknown-value cases with tests before changing classification.
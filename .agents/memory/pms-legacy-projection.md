---
name: PMS legacy projection
description: Compatibility rule for the additive PMS layer when agencies continue editing legacy accommodation records.
---

The legacy accommodation and room records remain the source of truth during the first PMS phase. PMS property, room type, unit, and default rate-plan rows must be projected idempotently before PMS reads or direct reservations, so records created after the schema migration are visible without changing legacy contracts.

**Why:** The PMS is additive by design, but a one-time migration backfill would make later legacy registrations invisible to direct lodging sales.

**How to apply:** Keep deterministic legacy IDs and conflict-safe inserts; derive availability from both PMS reservations and the legacy operational tables until the migration is explicitly completed.
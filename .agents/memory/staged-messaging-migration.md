---
name: Staged messaging migration
description: User-approved order and compatibility constraints for the VisiteCRM messaging refactor.
---

Migrate messaging in stages: unify send commands first; add channels such as Instagram to the shared delivery ledger while retaining channel-specific rules; unify history reads only after the send model is established; consolidate the screen after the API and data model are shared; remove duplicate paths only after records and delivery states are verified.

Preserve existing records and contracts during the transition. Instagram replies must keep the 24-hour reply window, provider-specific credentials, idempotency, and no-blind-retry handling for unknown outcomes.

**Why:** The user explicitly requested an incremental rework that preserves existing data and safeguards.

**How to apply:** Do not start by replacing history tables or merging screens. Add compatible projections and verify historical and delivery states before retiring legacy paths.

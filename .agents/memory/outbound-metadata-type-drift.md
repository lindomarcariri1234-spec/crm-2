---
name: Outbound metadata type drift
description: Production stores outbound message metadata as JSON while the declared schema uses JSONB.
---

Production has been observed with `outbound_messages.metadata` typed as `json`, even though the application schema declares it as `jsonb`. Raw SQL metadata merges that combine the column directly with JSONB values can fail before a WhatsApp provider call.

**Why:** Inbox sends were marked `unknown` with no provider or external ID because the metadata merge raised a PostgreSQL type error before calling Evolution.

**How to apply:** For raw merges of this column, cast the input to `jsonb` and cast the merged result to `json` so the expression also works against the live production column. Verify live column types before relying on the declared schema alone.

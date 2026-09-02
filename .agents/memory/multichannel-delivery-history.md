---
name: Multichannel delivery history
description: Contract convention for exposing outbound delivery retry details without breaking the existing attempt count.
---

The outbound delivery contract keeps `attempts` as the numeric retry count and exposes provider-attempt records in a separate history collection.

**Why:** Existing screens and persistence use `attempts` as a number; changing its meaning would silently break retry limits, progress displays, and consumers.

**How to apply:** When adding delivery detail to the ledger API, return both the count and the separate attempt history, including provider, external ID, timestamps, status, and sanitized error.

Provider callbacks must match tenant + provider + external ID, update the existing delivery monotonically, and notify tenant-scoped clients without inserting messages.

**Why:** Provider retries and reused IDs must not cross agency boundaries, downgrade a delivered record, or duplicate inbound/outbound history.

**How to apply:** Keep webhook handling on the outbound ledger; leave inbound WhatsApp processing on its chatbot path and refresh the history cache through the tenant SSE stream.

Legacy email history rows that mirror outbound email deliveries should store the
outbound message ID and be finalized by updating the existing row with
`tenantId + outboundMessageId`, rather than matching on recipient or subject.

**Why:** A queued legacy row must become sent or failed after the delivery worker
finishes, including failures without a provider message ID, without duplicating
history or allowing one tenant to update another tenant's row.

**How to apply:** Link the row when projecting the outbound message; synchronize
only terminal email delivery states and leave retryable pending attempts queued.
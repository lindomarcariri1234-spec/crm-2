---
name: Outbox lease ambiguity
description: Expired outbound delivery leases must not be treated as safe retries
---

An outbound delivery whose processing lease expires has an unknown provider outcome, not a retryable failure. Move it to an explicit unknown state, close the attempt with the same state, and do not enqueue it automatically. A late success may finalize that same attempt; a late failure must remain unknown. The current Evolution sendText and Z-API send-text endpoints do not document native idempotency keys, so a network failure must not fall back to another provider.

**Why:** The process can crash after the provider accepts a message but before the acceptance and external ID are persisted. Resetting the row to pending can send the same message twice.

**How to apply:** Keep normal retries limited to confirmed failed/provider-unavailable outcomes. Require provider reconciliation or an explicitly safe provider idempotency mechanism before retrying an unknown delivery. Operational sweeps should report unknown confirmations grouped by tenant, using the timestamp written at the unknown transition to calculate review age, without enqueueing them. Persist per-tenant alert state with a cooldown and conditional update so restarts and concurrent workers do not flood monitoring.
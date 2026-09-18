---
name: Concurrent audit snapshot tests
description: How to verify ordered audit events produced by concurrent transactional updates
---

When testing concurrent updates that serialize on a database row lock, derive the event sequence from snapshot content: the first event starts from the known original state, and the next event's `before` must equal the first event's `after`.

**Why:** Database `created_at` values can have the same precision for transactions that are serialized correctly, so ordering audit rows by timestamp can make a correct concurrency test flaky or assert the wrong sequence.

**How to apply:** Query all events for the entity, assert the expected count and actor set, identify the initial event by its known `before` snapshot, then compare the next `before`, final `after`, and persisted row. Also assert no extra entity events remain.
---
name: Cross-trip swap test fixtures
description: PostgreSQL uniqueness constraint to account for when testing reciprocal active reservation moves
---

Reciprocal active reservation moves must use distinct clients (or explicitly nullable client links) in test fixtures.

**Why:** The active client+trip partial unique index rejects the intermediate row update when two reservations belonging to the same client exchange trips, even though the capacity locks themselves are ordered safely.

**How to apply:** For concurrency tests focused on trip-capacity locking, give each active reservation a different client and use non-overlapping seats. Repeat-buyer fixtures must place a client's active confirmed reservations on different trips; this isolates the metric test from the same partial uniqueness rule.
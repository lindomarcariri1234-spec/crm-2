---
name: Calendar trip-event concurrency
description: How concurrent trip calendar syncs avoid duplicate Google events.
---

# Calendar trip-event concurrency

**Rule:** Trip calendar events are serialized with a PostgreSQL transaction advisory lock keyed by tenant, trip, and user. The lock covers the local lookup, Google API call, and local write; other event types stay on the existing path.

**Why:** A unique database constraint alone would stop duplicate rows but could still let concurrent callers create duplicate Google events before either row is persisted.

**How to apply:** Keep the lock scoped to records with `eventType = "trip"` and both `tripId` and `userId`. Any new trip-event sync entry point must use the same locked upsert helper.
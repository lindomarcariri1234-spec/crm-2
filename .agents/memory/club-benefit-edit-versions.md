---
name: Club benefit edit versions
description: Constraints for using updatedAt as the club-benefit optimistic concurrency token.
---

The club-benefit editor uses `updatedAt` as its optimistic concurrency token. Every successful benefit mutation must strictly advance that timestamp; otherwise an immediate follow-up save can still match an old version, especially when writes occur within the same millisecond. New-benefit responses must include the persisted timestamp so the editor starts from the server's version.

**Why:** PostgreSQL timestamps are returned to the client at millisecond precision, so timestamp-based compare-and-swap needs monotonic advancement to distinguish rapid writes.

**How to apply:** When adding another write path for `club_benefits` (including import, restore, or admin actions), update `updatedAt` monotonically and return the persisted value when the client will edit the row.

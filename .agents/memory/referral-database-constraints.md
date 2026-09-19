---
name: Referral database constraints
description: Durable rules for referral foreign keys and financial state checks
---

Referral financial constraints must encode states the application actually writes. A paid commission may be created before `paid_at` is recorded, so the database should reject contradictory pending/reversed states without requiring a timestamp the flow does not yet populate.

**Why:** A stricter first constraint broke the real PostgreSQL reversal integration fixture even though the application treated the row as valid.

**How to apply:** Audit live legacy rows first; use `NOT VALID` when introducing referral constraints to existing databases, enforce tenant boundaries with composite `(tenant_id, referral_id)` foreign keys where both columns are required, and validate later after the production audit.
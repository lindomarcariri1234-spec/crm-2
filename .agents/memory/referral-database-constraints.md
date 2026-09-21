---
name: Referral database constraints
description: Durable rules for referral foreign keys and financial state checks
---

Referral financial constraints must encode states the application actually writes. A paid commission may be created before `paid_at` is recorded, so the database should reject contradictory pending/reversed states without requiring a timestamp the flow does not yet populate.

**Why:** A stricter first constraint broke the real PostgreSQL reversal integration fixture even though the application treated the row as valid.

**How to apply:** Audit live legacy rows first; use `NOT VALID` when introducing referral constraints to existing databases, enforce tenant boundaries with composite `(tenant_id, referral_id)` foreign keys where both columns are required, and validate later after the production audit.

The Replit Publish schema diff can serialize `NOT VALID` CHECK constraints with an extra closing parenthesis. It also does not treat a change from `NOT VALID` to validated as a diff. For an audited production database, validate the development copy first; if existing production FKs remain `NOT VALID`, replace them with distinct, immediately validated constraint names so Publish emits an add/drop pair.

**Why:** The publish-time diff failed first on a missing composite parent key, then on malformed `NOT VALID` CHECK SQL, and finally would have silently retained legacy `NOT VALID` FKs because validation-state-only changes were not detected.

**How to apply:** Make the parent key a real `UNIQUE` constraint (not only a unique index), validate the development checks, and use a distinct-name replacement for legacy unvalidated FKs. Confirm the generated diff has no `NOT VALID` and contains the validated add/drop pair before publishing.
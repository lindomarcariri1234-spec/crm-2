---
name: Agency onboarding ownership
description: Identity and concurrency rules for self-service agency creation.
---

**Rule:** Self-service agency onboarding is for an active, unassigned agency administrator only. Preserve superadmin identity and serialize tenant creation by locking and rechecking that user's row in the same transaction.

**Why:** A duplicate onboarding request could otherwise create multiple tenant records for one identity, and the previous unconditional role assignment could downgrade a configured superadmin.

**How to apply:** Keep preflight checks for fast failures, but revalidate activity, role, and tenant assignment under a row lock before inserting a tenant or assigning it to the user.

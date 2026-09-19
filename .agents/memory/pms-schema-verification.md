---
name: PMS schema verification
description: Verification rule for incremental PMS schema changes in the development database.
---

After adding a PMS column, run live schema verification rather than trusting the migration command's success message. Keep the migration idempotent so a missing column can be repaired safely without changing the immutable baseline.

**Why:** The development migration runner reported success while the live PMS table still lacked the newly added cancellation column; schema-drift caught the mismatch.

**How to apply:** Run the full database schema-drift check after every PMS schema change and resolve any live mismatch before restarting dependent services.
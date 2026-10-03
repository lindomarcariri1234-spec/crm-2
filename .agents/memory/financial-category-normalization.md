---
name: Financial category normalization
description: Shared category aliases for spreadsheet imports and backup restores, with different strictness for new input versus historical data.
---

Use one shared category alias map for financial imports. Spreadsheet expense input is strict and rejects unknown categories. Backup restoration normalizes recognized aliases but preserves unknown category strings so valid legacy backups are not rejected or rewritten.

**Why:** backup files can contain historical category values that were never accepted by the current spreadsheet importer; restore must preserve that data while applying the canonical aliases it does know.

**How to apply:** when adding or changing a financial category alias, update the shared normalizer. Keep strict validation at user-input boundaries and use the lenient known-alias lookup when restoring expenses or planned costs.
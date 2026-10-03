---
name: Financial category normalization
description: Shared category aliases for imports, backup restores, and SQL cleanup while preserving unknown historical values.
---

Use one shared category alias map for financial imports. Spreadsheet expense input is strict and rejects unknown categories. Backup restoration and SQL cleanup normalize recognized aliases but preserve unknown category strings and unrelated record fields.

**Why:** backup files and existing rows can contain historical category values that were never accepted by the current spreadsheet importer. Restore and cleanup must preserve that data while applying the canonical aliases they do know. PostgreSQL `lower()` may not lowercase accented uppercase characters under a C locale, so SQL normalization must explicitly translate accented characters and collapse whitespace.

**How to apply:** when adding or changing a financial category alias, update the shared normalizer and its SQL equivalent. Keep strict validation at user-input boundaries; for SQL, normalize composed uppercase/lowercase accents and decomposed marks explicitly, and update only the category field of recognized values.
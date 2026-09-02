---
name: Migration validator ALTER TABLE parsing
description: The schema column validator must recognize optional IF EXISTS and multiple comma-separated ADD COLUMN clauses.
---

The migration column validator should parse each ALTER TABLE statement first, then collect every ADD COLUMN clause within it. Both `ALTER TABLE IF EXISTS` and comma-separated additions are valid migration forms.

**Why:** Existing migrations use both forms; matching only a single `ALTER TABLE ... ADD COLUMN` shape can report already-covered columns as missing and falsely fail schema validation.

**How to apply:** When changing migration validation or adding migration syntax, keep the parser statement-aware and run the full schema-drift check.
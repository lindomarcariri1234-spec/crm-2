---
name: validate-tables unindented migrations
description: extractColumnsFromBody indentation requirement and the requireIndent param added for hand-written incremental migrations
---

# validate-tables column extraction indentation

## Rule
`extractColumnsFromBody` in `lib/db/scripts/validate-tables.mjs` uses `\s{2,}` by default to match column names — this matches the Drizzle-generated squash baseline format (always 2-space indented). Hand-written incremental SQL migration files often have zero indentation for column definitions.

When `parseMigrationCreateTableBlocks` calls `extractColumnsFromBody` with the default (`requireIndent=true`), it silently extracts 0 columns from an unindented CREATE TABLE body. validate-tables CHECK 2 then flags all those columns as "in baseline without a corresponding migration" → EXIT 1 (post-merge failure).

**Fix applied**: added `requireIndent` parameter (default `true`) to `extractColumnsFromBody`. `parseMigrationCreateTableBlocks` calls it with `requireIndent=false`, accepting `\s*` (any leading whitespace including none).

**Why:** The squash baseline is always Drizzle-generated (2-space indent). Incremental migrations are hand-written and may have no indentation. The two parsing functions now use separate indent policies.

**How to apply:** Any new hand-written CREATE TABLE migration with no indentation is safe — `parseMigrationCreateTableBlocks` handles it. If you write a new migration extractor that calls `extractColumnsFromBody` directly, pass `requireIndent=false` when parsing hand-written SQL.

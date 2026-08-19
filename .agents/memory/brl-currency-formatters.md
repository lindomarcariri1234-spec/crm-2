---
name: BRL currency formatters (shared)
description: The two canonical money formatters in @workspace/shared and when to use each
---

`@workspace/shared` deliberately exports TWO BRL formatters — pick by **output context**:

- `formatBRL` — locale `style:"currency"` → `R$ 1.234,50` with a NON-BREAKING space (U+00A0). For on-screen UI and HTML emails.
- `formatBRLPlain` — `R$ ` (regular space) + grouped 2-decimal → `R$ 1.234,50`. For CSV exports, PDFs, and calendar event text.

**Why:** the NBSP emitted by the locale currency style breaks CSV parsing (Excel) and can mis-render in embedded PDF fonts, so plain-text outputs must use a regular space. The two outputs look identical on screen but differ byte-for-byte — that is why they are NOT merged into one.

**How to apply:** route any new money display through one of these by context (UI/email → `formatBRL`; CSV/PDF/calendar → `formatBRLPlain`). Don't reintroduce a local copy.

---
name: Vitrine "today" must be local date, not UTC
description: Date-only "today" logic in the Brazil-facing storefront must use local Y-M-D, never toISOString().slice(0,10).
---

In the public Vitrine (and other Brazil-facing date-only UI), compute "today" as a
local `yyyy-mm-dd` string from `getFullYear()/getMonth()/getDate()`, NOT from
`new Date().toISOString().slice(0, 10)`.

**Why:** `toISOString()` is UTC. For Brazilian users (UTC-3) in the evening, the UTC
date is already the next day, so date-input `min`, "upcoming departure"
initialization, and past/today calendar-cell styling all shift a day early. The
whole app is PT-BR / Brazil-scoped, so this is a real correctness bug, flagged in
code review.

**How to apply:** Any client-side date-only comparison/seed in the storefront
(calendar grid, date pickers, "upcoming" filters). Reuse a local `dateKey(y, m, d)`
helper (calendar.tsx has one) or inline the padded local build.

---
name: Drizzle enum literal in insert array
description: A wrong string literal for an enum-typed column in a db.insert().values([...]) array produces a confusing generic overload error, not a clear message.
---

- When `db.insert(table).values([...])` fails with `TS2769: No overload matches this call`, don't assume it's a literal-widening quirk from heterogeneous object shapes in the array — first check whether one of the string literals you passed for an enum-typed column (role, status, type, etc.) is simply wrong (doesn't match any value in the actual permissions/enum union).
- **Why:** Drizzle types enum columns as a union of specific string literals (e.g. a `Role` or `PaymentType` alias from the permissions package). Passing a plausible-but-wrong value (e.g. a value that would make sense in English/business terms but isn't in the actual union) fails type-checking, but the reported error is a generic "no overload matches" dump comparing the whole object shape — it does not point at the specific bad field or say "invalid enum value". This wastes time chasing array-literal-widening as the cause when the real bug is a typo'd/guessed literal.
- **How to apply:** when this error appears on an insert call, grep the actual enum/const definition (usually in `lib/permissions/src/index.ts` for this project) for the column in question and diff every literal in your insert payload against the real allowed values before investigating anything more exotic (array widening, contextual typing).

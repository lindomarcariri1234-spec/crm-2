---
name: SSL sslmode strip pattern
description: How to suppress pg-connection-string sslmode deprecation warning in production
---

## Rule
When creating a pg Pool with a DATABASE_URL that contains `sslmode=require`, passing an explicit `ssl` option alongside `connectionString` is NOT enough to suppress the `pg-connection-string` deprecation warning. The warning fires during URL parsing, before the ssl option is consulted.

## Fix
Strip `sslmode` from the connectionString URL in production, then supply `ssl: { rejectUnauthorized: true }` explicitly:

```ts
let connectionString = rawUrl;
const sslOption: { ssl?: { rejectUnauthorized: boolean } } = {};
if (isProduction) {
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete("sslmode");
    connectionString = u.toString();
  } catch { /* keep original */ }
  sslOption.ssl = { rejectUnauthorized: true };
}
export const pool = new Pool({ connectionString, ...sslOption });
```

**Why:** pg-connection-string emits the warning at URL parse time. The only reliable fix is to remove sslmode from the URL before it is parsed.

**How to apply:** Apply this pattern to EVERY place that creates a pg Pool from DATABASE_URL in production: `lib/db/src/connection.ts` (main pool) and `artifacts/api-server/src/lib/stripeSync.ts` (StripeSync pool). Do NOT pass `ssl: true` (less strict); always use `{ rejectUnauthorized: true }`.

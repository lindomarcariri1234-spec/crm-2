---
name: SSL sslmode strip pattern
description: How production PostgreSQL clients normalize sslmode and handle the Supabase pooler certificate chain
---

## Rule
When creating a pg Pool with a DATABASE_URL that contains `sslmode=require`, passing an explicit `ssl` option alongside `connectionString` is NOT enough to suppress the `pg-connection-string` deprecation warning. The warning fires during URL parsing, before the ssl option is consulted.

## Fix
Strip `sslmode` from the connection string in production and supply explicit SSL options. Keep `rejectUnauthorized: true` by default. For exact official Supabase pooler hosts (`pooler.supabase.com` or a subdomain ending in `.pooler.supabase.com`), keep TLS enabled but use `rejectUnauthorized: false`; Vercel's Node runtime otherwise rejects the pooler's managed chain with `SELF_SIGNED_CERT_IN_CHAIN`.

**Why:** pg-connection-string emits the warning at URL parse time. The only reliable fix is to remove sslmode from the URL before it is parsed.

**How to apply:** Use the shared database connection configuration for every production PostgreSQL client, including StripeSync. Never relax verification for generic hosts or lookalike suffixes such as `pooler.supabase.com.evil.example`.

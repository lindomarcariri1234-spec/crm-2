---
name: Per-row SAVEPOINT for continue-on-error import loops
description: Why a "catch error, collect it in a report, continue to the next row" loop inside one DB transaction silently loses every row after the first failure — and how to fix it in drizzle-orm/Postgres.
---

## The bug
In Postgres, once any statement inside a transaction errors, the whole transaction is poisoned: every subsequent statement fails with "current transaction is aborted, commands ignored until end of transaction block" — even if application code wraps each row in its own `try/catch` and keeps going to build a per-row success/failure report. The `catch` swallows the *first* error correctly, but every row processed afterward (even unrelated ones) then fails too, and if that failure is also caught-and-reported, the report looks plausible while being silently wrong — most rows report as "failed" for the wrong reason, not their real one.

**Why:** this only surfaces with a multi-row import/batch job that intentionally continues past per-row errors to produce a report (created/duplicate/skipped/error counts). A happy-path test with no failing rows never exercises it.

## The fix
Wrap each row's handler (and any per-row bookkeeping, e.g. writing to a dedup ledger) in a nested `tx.transaction(async (rowTx) => { ... })` call from inside the outer transaction. drizzle-orm implements a nested `.transaction()` call as a Postgres `SAVEPOINT` / `RELEASE SAVEPOINT` / `ROLLBACK TO SAVEPOINT` (confirmed in drizzle-orm's `node-postgres/session.cjs`), so a single row's failure rolls back only that row's partial work — including any sequence/counter increments it made (e.g. a next-code generator) — while leaving the outer transaction and all other rows intact.

**How to apply:** any batch/import job that does per-item try/catch-and-continue inside one outer transaction needs `outerTx.transaction(rowTx => handler(rowTx, ...))` per item, and every query/insert inside that handler must use the passed-in `rowTx`, not the outer transaction object — using the outer `tx` anywhere inside defeats the savepoint isolation.

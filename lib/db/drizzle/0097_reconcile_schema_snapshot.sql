-- Reconcile Drizzle's snapshot graph after combining independently journaled migrations.
-- The generated DDL is already covered by migrations 0077_first_zemo and 0085–0096;
-- existing foreign keys may have different names. No schema changes are applied here.
SELECT 1;
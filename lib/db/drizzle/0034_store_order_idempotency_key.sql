-- Add idempotency_key to store_orders so a browser retry / double-submit of
-- the same checkout attempt reuses the original order instead of creating a
-- duplicate one and double-reserving seats. A unique index on
-- (store_id, idempotency_key) enforces this at the DB level; Postgres treats
-- NULL keys as distinct, so older/no-key orders are unaffected.
ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "idempotency_key" text;

CREATE UNIQUE INDEX IF NOT EXISTS "store_orders_store_idempotency_key_unique"
  ON "store_orders" ("store_id", "idempotency_key");

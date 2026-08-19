-- Deferred referral/credit effects on store_orders.
-- These columns persist the referral conversion + referral-credit spend intent
-- at checkout, but the effects are only applied after payment is confirmed
-- (see artifacts/api-server/src/services/checkout/deferred-referral-effects.ts).
-- This stops anonymous/unpaid orders from crediting a referrer's conversion or
-- consuming a customer's referral credit before money is captured.
ALTER TABLE "store_orders"
  ADD COLUMN IF NOT EXISTS "pending_referral" json;
ALTER TABLE "store_orders"
  ADD COLUMN IF NOT EXISTS "pending_credit_spend" json;
ALTER TABLE "store_orders"
  ADD COLUMN IF NOT EXISTS "referral_effects_applied_at" timestamp with time zone;

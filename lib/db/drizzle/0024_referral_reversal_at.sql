-- 0024: Add referral_reversal_at timestamp to reservations table.
--
-- Purpose: explicit idempotency guard for Reversal 3 (referral bonus reversal).
-- When a reservation is cancelled and the referral reversal runs, this column
-- is set. On re-cancel (reopen → cancel again), the guard fires before any DB
-- lookup, preventing duplicate referral reversal attempts.
--
-- Mirrors the existing coupon_reversal_at pattern (Reversal 1 guard).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-run on any database.

--> statement-breakpoint

ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "referral_reversal_at" timestamp with time zone;

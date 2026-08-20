-- Durable correlation for async Subscription Checkout → local pending invoice.
-- The later `invoice.payment_succeeded` webhook only carries the Stripe
-- subscription id (not our local invoiceId metadata), so we persist the
-- Checkout Session id and the Stripe Subscription id on the local invoice to
-- match the exact pending invoice back on payment settlement.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "stripe_checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_stripe_subscription_id_idx" ON "invoices" ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_stripe_checkout_session_id_idx" ON "invoices" ("stripe_checkout_session_id");

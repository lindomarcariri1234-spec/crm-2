-- Keep the customer-facing reservation-confirmation WhatsApp idempotent across
-- deposit and balance payments for the same reservation.
ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "whatsapp_confirmed_sent_at" timestamp with time zone;
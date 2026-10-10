ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS infinitepay_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS infinitepay_handle text;

ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS infinitepay_checkout_url text;

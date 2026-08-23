ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "eligible_store_product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "eligible_tier_levels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "conversion_cap" integer,
  ADD COLUMN IF NOT EXISTS "budget_amount" numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "share_message" text,
  ADD COLUMN IF NOT EXISTS "material_url" text,
  ADD COLUMN IF NOT EXISTS "public_ranking" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "commission_type" text DEFAULT 'none' NOT NULL,
  ADD COLUMN IF NOT EXISTS "commission_value" numeric(10, 4) DEFAULT '0' NOT NULL;

CREATE TABLE IF NOT EXISTS "referral_commissions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "referral_id" text NOT NULL UNIQUE,
  "referrer_id" text NOT NULL,
  "campaign_id" text,
  "amount" numeric(12, 2) NOT NULL,
  "basis" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "approved_at" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "reversed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "referral_commissions_tenant_status_idx"
  ON "referral_commissions" ("tenant_id", "status");
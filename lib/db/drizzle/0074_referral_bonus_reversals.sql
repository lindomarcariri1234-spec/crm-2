CREATE TABLE IF NOT EXISTS "referral_bonus_reversals" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "referral_id" text NOT NULL,
  "amount" numeric(10, 2) NOT NULL,
  "reason" text NOT NULL,
  "initiated_by_id" text NOT NULL,
  "confirmed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referral_bonus_reversals_tenant_referral_unique" UNIQUE("tenant_id","referral_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_bonus_reversals_tenant_created_idx"
  ON "referral_bonus_reversals" USING btree ("tenant_id","created_at");
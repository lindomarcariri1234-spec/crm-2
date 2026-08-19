DO $$ BEGIN CREATE TABLE "referral_attempt_logs" ( "id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "client_id" text NOT NULL, "store_slug" text NOT NULL, "ip_address" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL ); EXCEPTION WHEN duplicate_table THEN END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TABLE "price_alert_subscriptions" ( "id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "store_id" text NOT NULL, "product_id" text NOT NULL, "email" text NOT NULL, "price_at_subscribe" numeric(10, 2) NOT NULL, "status" text DEFAULT 'pending' NOT NULL, "confirmation_token_hash" text, "unsubscribe_token_hash" text, "confirmed_at" timestamp with time zone, "last_notified_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL ); EXCEPTION WHEN duplicate_table THEN END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TABLE "insights_chat_history" ( "id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "user_id" text NOT NULL, "chat_type" text NOT NULL, "messages" json DEFAULT '[]'::json NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, CONSTRAINT "insights_chat_history_unique" UNIQUE("tenant_id","user_id","chat_type") ); EXCEPTION WHEN duplicate_table THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "tenants" ADD COLUMN "prefix_locked" boolean DEFAULT false NOT NULL; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "clients" ADD COLUMN "referral_code_status" text DEFAULT 'active' NOT NULL; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "clients" ADD COLUMN "referral_suspended_attempt_at" timestamp with time zone; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "clients" ADD COLUMN "referral_suspended_attempt_count" integer DEFAULT 0 NOT NULL; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "reservations" ADD COLUMN "referral_reversal_at" timestamp with time zone; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deals" ADD COLUMN "follow_up_note" text; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referral_settings" ADD COLUMN "loyalty_points_email_enabled" boolean DEFAULT true NOT NULL; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referral_settings" ADD COLUMN "grace_period_days" integer DEFAULT 30 NOT NULL; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referral_settings" ADD COLUMN "bonus_validity_days" integer DEFAULT 30 NOT NULL; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referral_settings" ADD COLUMN "discount_expiration_days" integer DEFAULT 30 NOT NULL; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referral_settings" ADD COLUMN "min_purchase_amount" numeric(10, 2); EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referral_settings" ADD COLUMN "max_referrals_per_user" integer DEFAULT 0 NOT NULL; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referrals" ADD COLUMN "reversal_reason" text; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "referrals" ADD COLUMN "reversal_at" timestamp with time zone; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "store_orders" ADD COLUMN "idempotency_key" text; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "store_orders" ADD COLUMN "customer_birthdate" date; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "store_orders" ADD COLUMN "pending_referral" json; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "store_orders" ADD COLUMN "pending_credit_spend" json; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "store_orders" ADD COLUMN "referral_effects_applied_at" timestamp with time zone; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "store_orders" ADD COLUMN "boarding_location_id" text; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "store_orders" ADD COLUMN "seats" json; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "store_orders" ADD COLUMN "co_passengers" json; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "stores" ADD COLUMN "min_deposit_amount" numeric(10, 2); EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "client_favorites" ADD COLUMN "low_availability_notified_at" timestamp with time zone; EXCEPTION WHEN duplicate_column THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "price_alert_subscriptions" ADD CONSTRAINT "price_alert_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "price_alert_subscriptions" ADD CONSTRAINT "price_alert_subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "price_alert_subscriptions" ADD CONSTRAINT "price_alert_subscriptions_product_id_store_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."store_products"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_alert_subs_product_status_idx" ON "price_alert_subscriptions" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_alert_subs_conf_token_idx" ON "price_alert_subscriptions" USING btree ("confirmation_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_alert_subs_unsub_token_idx" ON "price_alert_subscriptions" USING btree ("unsubscribe_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trips_tenant_id_departure_date_idx" ON "trips" USING btree ("tenant_id","departure_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trips_tenant_id_status_idx" ON "trips" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trips_slug_idx" ON "trips" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_tenant_id_created_at_idx" ON "reservations" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_trip_id_idx" ON "reservations" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_client_id_idx" ON "reservations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_tenant_id_status_idx" ON "reservations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_tenant_id_created_at_idx" ON "expenses" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_trip_id_idx" ON "expenses" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_tenant_id_created_at_idx" ON "payments" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_reservation_id_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_client_id_idx" ON "payments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_tenant_id_status_idx" ON "payments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_stages_pipeline_id_name_idx" ON "pipeline_stages" USING btree ("pipeline_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_orders_store_idempotency_key_unique" ON "store_orders" USING btree ("store_id","idempotency_key");
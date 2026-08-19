CREATE TABLE IF NOT EXISTS "price_alert_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"store_id" text NOT NULL,
	"product_id" text NOT NULL,
	"email" text NOT NULL,
	"price_at_subscribe" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"confirmation_token_hash" text,
	"unsubscribe_token_hash" text,
	"confirmed_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_alert_subscriptions" ADD CONSTRAINT "price_alert_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_alert_subscriptions" ADD CONSTRAINT "price_alert_subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_alert_subscriptions" ADD CONSTRAINT "price_alert_subscriptions_product_id_store_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "store_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_alert_subs_product_status_idx" ON "price_alert_subscriptions" USING btree ("product_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_alert_subs_conf_token_idx" ON "price_alert_subscriptions" USING btree ("confirmation_token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_alert_subs_unsub_token_idx" ON "price_alert_subscriptions" USING btree ("unsubscribe_token_hash");

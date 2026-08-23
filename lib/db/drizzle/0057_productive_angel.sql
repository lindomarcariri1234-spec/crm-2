CREATE TABLE "financial_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"settlement_item_id" text,
	"order_id" text,
	"client_id" text,
	"participant_type" text NOT NULL,
	"participant_id" text,
	"category" text NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"settlement_status" text DEFAULT 'available' NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"reversal_of_entry_id" text,
	"expires_at" timestamp with time zone,
	"available_at" timestamp with time zone,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text NOT NULL,
	"client_id" text,
	"seller_type" text NOT NULL,
	"seller_id" text,
	"seller_name" text NOT NULL,
	"source" text NOT NULL,
	"gross_amount" numeric(14, 2) NOT NULL,
	"discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"fee_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"commission_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"commission_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"seller_net_amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"settlement_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_ledger_entries" ADD CONSTRAINT "financial_ledger_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledger_entries" ADD CONSTRAINT "financial_ledger_entries_settlement_item_id_settlement_items_id_fk" FOREIGN KEY ("settlement_item_id") REFERENCES "public"."settlement_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledger_entries" ADD CONSTRAINT "financial_ledger_entries_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledger_entries" ADD CONSTRAINT "financial_ledger_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_order_item_id_store_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."store_order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_ledger_tenant_idempotency_unique" ON "financial_ledger_entries" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "financial_ledger_tenant_order_idx" ON "financial_ledger_entries" USING btree ("tenant_id","order_id","occurred_at");--> statement-breakpoint
CREATE INDEX "financial_ledger_participant_idx" ON "financial_ledger_entries" USING btree ("tenant_id","participant_type","participant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "financial_ledger_expiry_idx" ON "financial_ledger_entries" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_items_order_item_unique" ON "settlement_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "settlement_items_tenant_order_idx" ON "settlement_items" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "settlement_items_tenant_seller_idx" ON "settlement_items" USING btree ("tenant_id","seller_type","seller_id");
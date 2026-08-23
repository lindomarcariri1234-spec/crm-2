CREATE TABLE "distribution_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"integration_type" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"origin" text,
	"destination" text,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"price_valid_until" timestamp with time zone,
	"available_units" integer,
	"cancellation_policy" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "distribution_offers_tenant_provider_external_uq" UNIQUE("tenant_id","integration_type","external_id")
);
--> statement-breakpoint
CREATE TABLE "distribution_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"integration_type" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"offer_id" text,
	"external_id" text,
	"status" text DEFAULT 'started' NOT NULL,
	"response" jsonb,
	"error_code" text,
	"error_message" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "distribution_operations_tenant_provider_key_uq" UNIQUE("tenant_id","integration_type","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "distribution_offers" ADD CONSTRAINT "distribution_offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_operations" ADD CONSTRAINT "distribution_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_operations" ADD CONSTRAINT "distribution_operations_offer_id_distribution_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."distribution_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "distribution_offers_tenant_active_idx" ON "distribution_offers" USING btree ("tenant_id","is_active","kind");--> statement-breakpoint
CREATE INDEX "distribution_operations_tenant_created_idx" ON "distribution_operations" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "distribution_operations_status_idx" ON "distribution_operations" USING btree ("tenant_id","status");
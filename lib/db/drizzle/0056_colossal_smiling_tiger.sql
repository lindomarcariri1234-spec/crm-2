CREATE TABLE "distribution_bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"integration_type" text NOT NULL,
	"external_order_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"voucher_code" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "distribution_bookings_tenant_provider_order_uq" UNIQUE("tenant_id","integration_type","external_order_id")
);
--> statement-breakpoint
ALTER TABLE "distribution_bookings" ADD CONSTRAINT "distribution_bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_bookings" ADD CONSTRAINT "distribution_bookings_offer_id_distribution_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."distribution_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "distribution_bookings_tenant_status_idx" ON "distribution_bookings" USING btree ("tenant_id","status");
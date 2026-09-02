CREATE TABLE IF NOT EXISTS "outbound_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "event_type" text NOT NULL,
  "origin" text DEFAULT 'system' NOT NULL,
  "origin_channel" text,
  "recipient_type" text NOT NULL,
  "recipient_id" text,
  "recipient_name" text,
  "email_address" text,
  "whatsapp_number" text,
  "email_subject" text,
  "email_html" text,
  "whatsapp_text" text,
  "sender_name" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "is_replication" boolean DEFAULT false NOT NULL,
  "replicated_from_id" text,
  "created_by_id" text,
  "metadata" json,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outbound_messages_tenant_idempotency_unique" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_deliveries" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "outbound_message_id" text NOT NULL,
  "channel" text NOT NULL,
  "recipient" text,
  "subject" text,
  "content" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "provider" text,
  "external_id" text,
  "last_error" text,
  "skipped_reason" text,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "claimed_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outbound_deliveries_message_channel_unique" UNIQUE("outbound_message_id","channel")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_delivery_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "delivery_id" text NOT NULL,
  "attempt_number" integer NOT NULL,
  "provider" text,
  "status" text NOT NULL,
  "external_id" text,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "outbound_delivery_attempts_delivery_number_unique" UNIQUE("delivery_id","attempt_number")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "outbound_deliveries" ADD CONSTRAINT "outbound_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "outbound_deliveries" ADD CONSTRAINT "outbound_deliveries_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "outbound_delivery_attempts" ADD CONSTRAINT "outbound_delivery_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "outbound_delivery_attempts" ADD CONSTRAINT "outbound_delivery_attempts_delivery_id_outbound_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."outbound_deliveries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_tenant_created_idx" ON "outbound_messages" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_tenant_status_idx" ON "outbound_messages" USING btree ("tenant_id","status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_deliveries_tenant_status_next_idx" ON "outbound_deliveries" USING btree ("tenant_id","status","next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_deliveries_tenant_message_idx" ON "outbound_deliveries" USING btree ("tenant_id","outbound_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_delivery_attempts_tenant_started_idx" ON "outbound_delivery_attempts" USING btree ("tenant_id","started_at");
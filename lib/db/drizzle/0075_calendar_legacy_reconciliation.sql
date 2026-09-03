CREATE TABLE IF NOT EXISTS "calendar_reconciliations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "user_id" text NOT NULL,
  "google_event_id" text NOT NULL,
  "calendar_id" text DEFAULT 'primary' NOT NULL,
  "event_type" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "event_summary" text NOT NULL,
  "event_description" text,
  "event_location" text,
  "event_start_date" timestamp with time zone NOT NULL,
  "event_end_date" timestamp with time zone,
  "candidate_matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "selected_resource_id" text,
  "resolved_at" timestamp with time zone,
  "resolved_by_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_reconciliations_user_google_event_unique"
  ON "calendar_reconciliations" USING btree ("user_id","google_event_id");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_reconciliations_tenant_status_idx"
  ON "calendar_reconciliations" USING btree ("tenant_id","status");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_reconciliations_user_status_idx"
  ON "calendar_reconciliations" USING btree ("user_id","status");;
--> statement-breakpoint
ALTER TABLE "calendar_reconciliations"
  ADD CONSTRAINT "calendar_reconciliations_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE "calendar_reconciliations"
  ADD CONSTRAINT "calendar_reconciliations_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE "calendar_reconciliations"
  ADD CONSTRAINT "calendar_reconciliations_resolved_by_id_users_id_fk"
  FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;;
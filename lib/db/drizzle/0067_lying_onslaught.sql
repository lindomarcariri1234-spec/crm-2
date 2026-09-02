CREATE TABLE IF NOT EXISTS "linked_data_reconciliation_runs" (
"id" text PRIMARY KEY NOT NULL,
"tenant_id" text NOT NULL,
"mode" text NOT NULL,
"executed_at" timestamp with time zone NOT NULL,
"checked_count" integer DEFAULT 0 NOT NULL,
"repaired_count" integer DEFAULT 0 NOT NULL,
"issue_count" integer DEFAULT 0 NOT NULL,
"summary" json DEFAULT '{}'::json NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linked_data_reconciliation_runs" ADD CONSTRAINT "linked_data_reconciliation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linked_data_reconciliation_runs_tenant_executed_idx" ON "linked_data_reconciliation_runs" USING btree ("tenant_id","executed_at");
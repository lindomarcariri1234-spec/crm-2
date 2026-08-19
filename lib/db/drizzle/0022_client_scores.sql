-- 0022: Create client_scores table in production.
--
-- Root cause confirmed in production logs (June 2026):
--   • relation "client_scores" does not exist → ALL /api/clients → 500
--
-- The table exists in the squash baseline (0000) but was never created in the
-- production database because the journal already marked 0000 as applied when
-- client_scores was still absent. This migration creates it idempotently.
--
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS,
-- EXCEPTION WHEN duplicate_object, CREATE INDEX IF NOT EXISTS) — safe to
-- re-run on any database.

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_scores" (
        "id" text PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "purchase_score" integer DEFAULT 0 NOT NULL,
        "recompra_score" integer DEFAULT 0 NOT NULL,
        "churn_score" integer DEFAULT 0 NOT NULL,
        "nbo_trip_id" text,
        "nbo_reasoning" text,
        "rfm_r" integer,
        "rfm_f" integer,
        "rfm_m" numeric(12, 2),
        "calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "client_scores" ADD CONSTRAINT "client_scores_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "client_scores" ADD CONSTRAINT "client_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "client_scores" ADD CONSTRAINT "client_scores_nbo_trip_id_trips_id_fk" FOREIGN KEY ("nbo_trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "client_scores_client_tenant_unique" ON "client_scores" USING btree ("client_id","tenant_id");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "client_scores_tenant_idx" ON "client_scores" USING btree ("tenant_id","calculated_at");

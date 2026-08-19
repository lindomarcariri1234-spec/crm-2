-- 0021: Catch-all for tables and columns that exist in the Drizzle TypeScript
-- schema and the squash baseline (0000) but are absent from the production
-- database because they were never covered by an incremental migration.
--
-- Root causes confirmed in production logs:
--   • column "expo_push_token" does not exist  → ALL /api/clients → 500
--   • relation "ai_integrations" does not exist → /api/ai-integration → 500
--   • relation "ai_integration_logs" does not exist → /api/ai-integration/logs → 500
--   • relation "tenant_integrations" does not exist → /api/integrations → 500
--   • relation "tenant_integration_logs" does not exist → /api/integrations/*/logs → 500
--   • relation "club_config" does not exist → /api/club/config → 500
--   • relation "club_benefits" does not exist → /api/club/benefits → 500
--
-- All statements are idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
-- EXISTS / EXCEPTION WHEN duplicate_object — safe to re-run on any database.

--> statement-breakpoint

-- 1. clients — expo_push_token column
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "expo_push_token" text;

--> statement-breakpoint

-- 2. ai_integration_logs
CREATE TABLE IF NOT EXISTS "ai_integration_logs" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "event" text NOT NULL,
        "level" text DEFAULT 'info' NOT NULL,
        "message" text NOT NULL,
        "actor_id" text,
        "actor_name" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "ai_integration_logs" ADD CONSTRAINT "ai_integration_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_integration_logs_tenant_idx" ON "ai_integration_logs" USING btree ("tenant_id","created_at");

--> statement-breakpoint

-- 3. ai_integrations
CREATE TABLE IF NOT EXISTS "ai_integrations" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "name" text,
        "provider" text DEFAULT 'openai' NOT NULL,
        "api_key_encrypted" text,
        "access_token_encrypted" text,
        "base_url" text,
        "default_model" text,
        "environment" text DEFAULT 'production' NOT NULL,
        "enabled" boolean DEFAULT false NOT NULL,
        "status" text DEFAULT 'disconnected' NOT NULL,
        "last_error" text,
        "last_sync_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "ai_integrations_tenant_id_unique" UNIQUE("tenant_id")
);

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "ai_integrations" ADD CONSTRAINT "ai_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

-- 4. tenant_integration_logs
CREATE TABLE IF NOT EXISTS "tenant_integration_logs" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "type" text NOT NULL,
        "event" text NOT NULL,
        "level" text DEFAULT 'info' NOT NULL,
        "message" text NOT NULL,
        "actor_id" text,
        "actor_name" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "tenant_integration_logs" ADD CONSTRAINT "tenant_integration_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tenant_integration_logs_tenant_idx" ON "tenant_integration_logs" USING btree ("tenant_id","type","created_at");

--> statement-breakpoint

-- 5. tenant_integrations
CREATE TABLE IF NOT EXISTS "tenant_integrations" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "type" text NOT NULL,
        "name" text,
        "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "secrets_encrypted" text,
        "environment" text DEFAULT 'production' NOT NULL,
        "enabled" boolean DEFAULT false NOT NULL,
        "status" text DEFAULT 'disconnected' NOT NULL,
        "last_error" text,
        "last_sync_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "tenant_integrations_tenant_type_uq" UNIQUE("tenant_id","type")
);

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "tenant_integrations" ADD CONSTRAINT "tenant_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

-- 6. club_benefits
CREATE TABLE IF NOT EXISTS "club_benefits" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "tier" text NOT NULL,
        "benefit_key" text NOT NULL,
        "label" text NOT NULL,
        "description" text,
        "value" text,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "club_benefits" ADD CONSTRAINT "club_benefits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "club_benefits_tenant_tier_idx" ON "club_benefits" USING btree ("tenant_id","tier");

--> statement-breakpoint

-- 7. club_config
CREATE TABLE IF NOT EXISTS "club_config" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "club_name" text DEFAULT 'Clube Visite' NOT NULL,
        "description" text,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "club_config" ADD CONSTRAINT "club_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "club_config_tenant_unique" ON "club_config" USING btree ("tenant_id");

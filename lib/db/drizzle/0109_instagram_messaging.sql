CREATE TABLE IF NOT EXISTS "instagram_oauth_states" (
  "state_hash" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "actor_user_id" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "instagram_oauth_states_tenant_expiry_idx"
  ON "instagram_oauth_states" ("tenant_id", "expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_integrations_instagram_account_uq"
  ON "tenant_integrations" (("config" ->> 'instagramUserId'))
  WHERE "type" = 'instagram_messaging' AND "config" ? 'instagramUserId';

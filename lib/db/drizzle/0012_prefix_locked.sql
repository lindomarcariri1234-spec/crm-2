ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "prefix_locked" boolean NOT NULL DEFAULT false;

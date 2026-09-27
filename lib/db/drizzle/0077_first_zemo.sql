LOCK TABLE "tenants", "plans" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_state_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"monthly_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"status_changed" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"is_inferred" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_state_history_tenant_changed_idx" ON "tenant_state_history" USING btree ("tenant_id","changed_at","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_state_history_changed_idx" ON "tenant_state_history" USING btree ("changed_at");
--> statement-breakpoint
INSERT INTO "tenant_state_history" (
  "tenant_id", "plan_id", "status", "monthly_price", "changed_at",
  "status_changed", "source", "is_inferred"
)
SELECT
  t."id",
  t."plan_id",
  t."status",
  COALESCE(
    (SELECT p."monthly_price" FROM "plans" p WHERE p."slug" = t."plan_id" LIMIT 1),
    (SELECT p."monthly_price" FROM "plans" p WHERE p."id" = t."plan_id" LIMIT 1),
    0
  ),
  t."created_at",
  false,
  'migration_baseline',
  true
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1
  FROM "tenant_state_history" h
  WHERE h."tenant_id" = t."id"
    AND h."source" = 'migration_baseline'
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION capture_tenant_state_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_monthly_price numeric(10, 2);
  event_changed_at timestamp with time zone;
  event_status_changed boolean := false;
  event_source text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."status" IS NOT DISTINCT FROM OLD."status"
       AND NEW."plan_id" IS NOT DISTINCT FROM OLD."plan_id" THEN
      RETURN NEW;
    END IF;
    event_changed_at := clock_timestamp();
    event_status_changed := NEW."status" IS DISTINCT FROM OLD."status";
    event_source := 'tenant_state_change';
  ELSE
    event_changed_at := NEW."created_at";
    event_source := 'tenant_created';
  END IF;

  SELECT p."monthly_price"
  INTO current_monthly_price
  FROM "plans" p
  WHERE p."slug" = NEW."plan_id" OR p."id" = NEW."plan_id"
  ORDER BY (p."slug" = NEW."plan_id") DESC
  LIMIT 1;

  INSERT INTO "tenant_state_history" (
    "tenant_id", "plan_id", "status", "monthly_price", "changed_at",
    "status_changed", "source", "is_inferred"
  )
  VALUES (
    NEW."id",
    NEW."plan_id",
    NEW."status",
    COALESCE(current_monthly_price, 0),
    event_changed_at,
    event_status_changed,
    event_source,
    false
  );

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_state_history_capture ON "tenants";
--> statement-breakpoint
CREATE TRIGGER tenant_state_history_capture
AFTER INSERT OR UPDATE ON "tenants"
FOR EACH ROW
EXECUTE FUNCTION capture_tenant_state_history();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION capture_plan_monthly_price_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."monthly_price" IS NOT DISTINCT FROM OLD."monthly_price" THEN
    RETURN NEW;
  END IF;

  INSERT INTO "tenant_state_history" (
    "tenant_id", "plan_id", "status", "monthly_price", "changed_at",
    "status_changed", "source", "is_inferred"
  )
  SELECT
    t."id",
    t."plan_id",
    t."status",
    NEW."monthly_price",
    clock_timestamp(),
    false,
    'plan_price_change',
    false
  FROM "tenants" t
  WHERE t."plan_id" = NEW."slug" OR t."plan_id" = NEW."id";

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS plan_monthly_price_history_capture ON "plans";
--> statement-breakpoint
CREATE TRIGGER plan_monthly_price_history_capture
AFTER UPDATE OF "monthly_price" ON "plans"
FOR EACH ROW
EXECUTE FUNCTION capture_plan_monthly_price_history();
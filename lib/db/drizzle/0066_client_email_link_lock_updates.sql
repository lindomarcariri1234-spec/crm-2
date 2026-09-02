CREATE OR REPLACE FUNCTION "lock_clients_normalized_email_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_lock_key bigint;
  new_lock_key bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."email" IS NOT NULL AND btrim(NEW."email") <> '' THEN
      PERFORM pg_advisory_xact_lock(
        hashtextextended(lower(btrim(NEW."email")), 0)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."email" IS NOT DISTINCT FROM OLD."email"
    AND NEW."tenant_id" IS NOT DISTINCT FROM OLD."tenant_id"
  THEN
    RETURN NEW;
  END IF;

  IF OLD."email" IS NOT NULL AND btrim(OLD."email") <> '' THEN
    old_lock_key := hashtextextended(lower(btrim(OLD."email")), 0);
  END IF;
  IF NEW."email" IS NOT NULL AND btrim(NEW."email") <> '' THEN
    new_lock_key := hashtextextended(lower(btrim(NEW."email")), 0);
  END IF;

  IF old_lock_key IS NOT NULL
    AND new_lock_key IS NOT NULL
    AND old_lock_key <> new_lock_key
  THEN
    PERFORM pg_advisory_xact_lock(LEAST(old_lock_key, new_lock_key));
    PERFORM pg_advisory_xact_lock(GREATEST(old_lock_key, new_lock_key));
  ELSIF new_lock_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(new_lock_key);
  ELSIF old_lock_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(old_lock_key);
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "clients_normalized_email_write_lock" ON "clients";
--> statement-breakpoint
CREATE TRIGGER "clients_normalized_email_write_lock"
BEFORE INSERT OR UPDATE OF "email", "tenant_id" ON "clients"
FOR EACH ROW
EXECUTE FUNCTION "lock_clients_normalized_email_write"();
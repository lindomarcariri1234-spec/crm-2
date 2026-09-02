CREATE OR REPLACE FUNCTION "lock_clients_normalized_email_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."email" IS NOT NULL
    AND btrim(NEW."email") <> ''
    AND (
      TG_OP = 'INSERT'
      OR NEW."email" IS DISTINCT FROM OLD."email"
    )
  THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(lower(btrim(NEW."email")), 0)
    );
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "clients_normalized_email_write_lock" ON "clients";
--> statement-breakpoint
CREATE TRIGGER "clients_normalized_email_write_lock"
BEFORE INSERT OR UPDATE OF "email" ON "clients"
FOR EACH ROW
EXECUTE FUNCTION "lock_clients_normalized_email_write"();
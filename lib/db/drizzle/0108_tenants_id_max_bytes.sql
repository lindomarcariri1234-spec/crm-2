DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_id_max_bytes_check'
      AND conrelid = 'public.tenants'::regclass
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_id_max_bytes_check
      CHECK (octet_length(id) <= 64) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_id_max_bytes_check;

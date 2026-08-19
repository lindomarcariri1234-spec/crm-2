ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS trigger_config json DEFAULT '{}';

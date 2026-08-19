ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS auto_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS "chatbot_messages"
  ADD COLUMN IF NOT EXISTS "media_mime_type" text,
  ADD COLUMN IF NOT EXISTS "media_file_name" text;
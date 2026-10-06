CREATE TABLE IF NOT EXISTS "instagram_data_deletion_requests" (
  "confirmation_code" text PRIMARY KEY NOT NULL,
  "completed_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "chatbot_conversations_instagram_account_idx"
  ON "chatbot_conversations" (("metadata" ->> 'instagramUserId'))
  WHERE "channel" = 'instagram';

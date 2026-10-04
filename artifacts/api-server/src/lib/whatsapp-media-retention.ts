import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { safeErrorLogFields } from "./safe-error-log";

export const WHATSAPP_INBOUND_MEDIA_RETENTION_DAYS = 90;
const RETENTION_MS = WHATSAPP_INBOUND_MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 250;

export function getWhatsAppInboundMediaExpirationAt(sentAt: Date): Date {
  return new Date(sentAt.getTime() + RETENTION_MS);
}

export interface WhatsAppMediaRetentionResult {
  expiredMessages: number;
  errors: number;
}

/**
 * Removes old private-file references from inbound WhatsApp messages.
 * The UploadThing orphan cleanup runs immediately afterward and stages files
 * for deletion only when no database record still references them.
 */
export async function runWhatsAppInboundMediaRetentionCleanup(
  now = new Date(),
): Promise<WhatsAppMediaRetentionResult> {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  let expiredMessages = 0;
  let errors = 0;

  try {
    while (true) {
      const result = await db.execute(sql`
        WITH candidates AS MATERIALIZED (
          SELECT message.id
          FROM chatbot_messages AS message
          INNER JOIN chatbot_conversations AS conversation
            ON conversation.id = message.conversation_id
           AND conversation.tenant_id = message.tenant_id
          WHERE conversation.channel = 'whatsapp'
            AND message.role = 'user'
            AND message.media_url IS NOT NULL
            AND message.media_expired_at IS NULL
            AND message.sent_at < ${cutoff}
          ORDER BY message.sent_at, message.id
          LIMIT ${BATCH_SIZE}
          FOR UPDATE OF message SKIP LOCKED
        )
        UPDATE chatbot_messages AS message
        SET media_url = NULL,
            media_expired_at = ${now}
        FROM candidates
        WHERE message.id = candidates.id
        RETURNING message.id
      `);
      const rows = (result as unknown as { rows?: Array<{ id: string }> }).rows ?? [];
      expiredMessages += rows.length;
      if (rows.length < BATCH_SIZE) break;
    }
  } catch (error) {
    errors += 1;
    logger.error(
      { error: safeErrorLogFields(error), expiredMessages },
      "[whatsapp-media-retention] cleanup failed; remaining messages will be retried",
    );
  }

  logger.info(
    {
      retentionDays: WHATSAPP_INBOUND_MEDIA_RETENTION_DAYS,
      cutoffAt: cutoff.toISOString(),
      expiredMessages,
      errors,
    },
    "[whatsapp-media-retention] cleanup complete",
  );

  return { expiredMessages, errors };
}

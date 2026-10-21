import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendReminderHtmlEmail } from "@workspace/email";
import type { PoolClient } from "pg";
import { logger } from "./logger";
import { safeErrorLogFields } from "./safe-error-log";
import { generateId } from "./id";

export const WHATSAPP_INBOUND_MEDIA_RETENTION_DAYS = 90;
const RETENTION_MS = WHATSAPP_INBOUND_MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 250;
const FAILURE_STATE_KEY = "whatsapp_media_retention_failure_state";
const FAILURE_STATE_LABEL = "WhatsApp media retention operational failure state";
const ALERT_EMAIL_SETTING_KEY = "redis_alert_email";
const FAILURE_ALERT_THRESHOLD = 3;

interface RetentionFailureState {
  consecutiveFailures: number;
  alertSent: boolean;
}

function parseFailureState(value: unknown): RetentionFailureState {
  if (typeof value !== "string") return { consecutiveFailures: 0, alertSent: false };
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      Number.isSafeInteger((parsed as Record<string, unknown>)["consecutiveFailures"]) &&
      Number((parsed as Record<string, unknown>)["consecutiveFailures"]) >= 0 &&
      typeof (parsed as Record<string, unknown>)["alertSent"] === "boolean"
    ) {
      return {
        consecutiveFailures: Number((parsed as Record<string, unknown>)["consecutiveFailures"]),
        alertSent: (parsed as Record<string, unknown>)["alertSent"] as boolean,
      };
    }
  } catch {
    // Replace malformed operational metadata with a fresh aggregate state.
  }
  return { consecutiveFailures: 0, alertSent: false };
}

function isValidAlertEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function recordRetentionRun(errors: number): Promise<void> {
  let client: PoolClient | undefined;
  let shouldAlert = false;
  let consecutiveFailures = 0;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [FAILURE_STATE_KEY],
    );
    await client.query(
      `INSERT INTO public.platform_settings (id, key, value, label, type)
       VALUES ($1, $2, $3, $4, 'json')
       ON CONFLICT (key) DO NOTHING`,
      [generateId(), FAILURE_STATE_KEY, JSON.stringify({ consecutiveFailures: 0, alertSent: false }), FAILURE_STATE_LABEL],
    );
    const stored = await client.query<{ value: string | null }>(
      "SELECT value FROM public.platform_settings WHERE key = $1 FOR UPDATE",
      [FAILURE_STATE_KEY],
    );
    const previous = parseFailureState(stored.rows[0]?.value);
    consecutiveFailures = errors > 0
      ? Math.min(previous.consecutiveFailures + 1, 1_000_000)
      : 0;
    shouldAlert =
      errors > 0 &&
      consecutiveFailures >= FAILURE_ALERT_THRESHOLD &&
      !previous.alertSent;
    const next: RetentionFailureState = {
      consecutiveFailures,
      alertSent: errors > 0 ? previous.alertSent || shouldAlert : false,
    };
    await client.query(
      "UPDATE public.platform_settings SET value = $2, updated_at = NOW() WHERE key = $1",
      [FAILURE_STATE_KEY, JSON.stringify(next)],
    );
    await client.query("COMMIT");
  } catch {
    try {
      if (client) await client.query("ROLLBACK");
    } catch {
      // The cleanup result remains authoritative if alert bookkeeping is unavailable.
    }
    logger.warn(
      { errors },
      "[whatsapp-media-retention] could not persist consecutive failure state",
    );
    return;
  } finally {
    client?.release();
  }

  if (!shouldAlert) return;

  try {
    let configuredValue: string | null | undefined;
    try {
      const recipientResult = await pool.query<{ value: string | null }>(
        "SELECT value FROM public.platform_settings WHERE key = $1 LIMIT 1",
        [ALERT_EMAIL_SETTING_KEY],
      );
      configuredValue = recipientResult.rows[0]?.value?.trim();
    } catch {
      // Use the environment recipient when platform settings cannot be read.
    }
    const recipient = isValidAlertEmail(configuredValue)
      ? configuredValue
      : process.env["SUPERADMIN_EMAIL"]?.trim();
    if (!isValidAlertEmail(recipient)) {
      logger.warn(
        { consecutiveFailures, threshold: FAILURE_ALERT_THRESHOLD },
        "[whatsapp-media-retention] no valid alert recipient configured",
      );
      return;
    }

    const result = await sendReminderHtmlEmail({
      to: recipient,
      fromName: "VisiteCRM",
      subject: "[VisiteCRM] Falhas consecutivas na limpeza de mídia do WhatsApp",
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2>Falha na limpeza de mídia do WhatsApp</h2>
        <p>A rotina de retenção falhou em ${consecutiveFailures} execuções consecutivas.</p>
        <p>As mensagens afetadas serão tentadas novamente na próxima execução.</p>
      </div>`,
    });
    if (result.success) {
      logger.warn(
        { consecutiveFailures, threshold: FAILURE_ALERT_THRESHOLD },
        "[whatsapp-media-retention] operator alert sent",
      );
    } else {
      logger.error(
        { consecutiveFailures, threshold: FAILURE_ALERT_THRESHOLD },
        "[whatsapp-media-retention] operator alert delivery failed",
      );
    }
  } catch {
    logger.error(
      { consecutiveFailures, threshold: FAILURE_ALERT_THRESHOLD },
      "[whatsapp-media-retention] operator alert delivery failed",
    );
  }
}

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

  await recordRetentionRun(errors);
  return { expiredMessages, errors };
}

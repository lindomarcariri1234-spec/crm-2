// Force IPv4 for all outbound DNS lookups. In Replit's production container,
// IPv6 connectivity is limited — without this, outbound HTTPS connections to
// services like sea1.ingest.uploadthing.com fail with a silent Transport error.
// This must be set before any network calls (including UploadThing metadata
// registration and other SDK initializations).
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

// Patch globalThis.fetch for UploadThing CDN uploads — must be the first
// module imported so the patch is in place before any uploadthing module
// (express or server) is first required. See lib/fetch-patch.ts for details.
import { FETCH_PATCH_APPLIED } from "./lib/fetch-patch";

// NOTE: `app` is intentionally a dynamic import (see below, after the
// _uploadthingPatched assertion). Do NOT add a static `import app from "./app"`
// here — app.ts transitively loads uploadthing, which captures globalThis.fetch
// by value. The dynamic import ensures uploadthing can only load AFTER fetch-patch
// has already replaced globalThis.fetch, making the ordering structurally enforced.
import { logger } from "./lib/logger";
import { runMigrations } from "@workspace/db";
import { initStripeSync } from "./lib/stripeSync";
import { backfillEncryptedCredentials } from "./lib/credential-backfill";
import { seedPlansIfMissing } from "./lib/seed-plans";
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";
import { runBirthdayCron } from "./lib/birthday";
import { processNpsDispatch, processInstallmentDueReminders } from "./workers/reminder.worker";
import { runExpiredReservationsCron } from "./lib/expired-reservations";
import { runPipelineTripEndedCron } from "./services/pipeline-automation";
import { calculateScoresForAllTenants } from "./lib/client-scores";
import { runCampaignAutomationCron } from "./lib/campaign-automation";
import { runGemeoAlertsCron, runGemeoOpportunitiesCron } from "./lib/gemeo-cron";
import { runFavoriteLowAvailabilityAlertCron } from "./lib/favorite-alerts";
import { runAbandonedOrderReferralCleanup } from "./lib/abandoned-order-referrals";
import { runSeatReconciliationCron } from "./lib/seat-reconciliation";
import { runStripeHealthCheckCron } from "./lib/stripe-health-check";
import { getRedisConnection, waitForEvictionPolicyCheck, fetchUpstashDailyStats, getRedisWarningThresholdPct, maybeSendDailyLimitAlert } from "./lib/redis";
import { initSeatUpdateSubscriber, closeSeatUpdateSubscriber } from "./lib/realtime";
import { getReminderQueue, closeQueues } from "./queues/index";
import { startEmailWorker, stopEmailWorker } from "./workers/email.worker";
import { startReminderWorker, stopReminderWorker, retryFailedBookingEmails, retryFailedExpiryWarningEmails } from "./workers/reminder.worker";
import { startPdfWorker, stopPdfWorker } from "./workers/pdf.worker";
import { startCommissionSyncWorker, stopCommissionSyncWorker } from "./workers/commission-sync.worker";
import { startWhatsAppWorker, stopWhatsAppWorker } from "./workers/whatsapp.worker";
import { startCalendarSyncWorker, stopCalendarSyncWorker } from "./workers/calendar-sync.worker";
import { retryPendingReservationConfirmedWhatsApps } from "./services/checkout/reservation-confirmation-outbox";

process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ err: reason }, "Unhandled promise rejection — process kept alive");
});

process.on("uncaughtException", (err: Error) => {
  logger.fatal({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// CREDENTIAL_ENCRYPTION_KEY is mandatory in every environment because gateway
// credentials are encrypted at rest. Validating its shape here means the
// server will not boot with a missing/malformed key, instead of failing
// later at the first PATCH /store/settings or webhook fetch.
{
  const raw = process.env["CREDENTIAL_ENCRYPTION_KEY"];
  if (!raw) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is required. Generate one with " +
        "`node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` " +
        "and set it in the environment.",
    );
  }
  // Strip every whitespace character (the value sometimes arrives with stray
  // newlines, surrounding quotes, or copy-paste padding from the secrets UI).
  const cleaned = raw.replace(/\s+/g, "").replace(/^["']|["']$/g, "");
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes). ` +
        `Got a value of length ${cleaned.length}. ` +
        `Generate a fresh one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  // Re-export the cleaned value so downstream getKey() sees the canonical form.
  process.env["CREDENTIAL_ENCRYPTION_KEY"] = cleaned;
}

// Webhook secret validation — only warn when the corresponding integration key
// is present (i.e. the integration is intentionally configured). If neither
// STRIPE_SECRET_KEY nor MP_SECRET_KEY is set the payment gateway is inactive
// and the missing webhook secret is expected — no noise needed.
{
  const missing: string[] = [];
  if (!process.env["STRIPE_WEBHOOK_SECRET"] && process.env["STRIPE_SECRET_KEY"])
    missing.push("STRIPE_WEBHOOK_SECRET");
  if (!process.env["MP_WEBHOOK_SECRET"] && process.env["MP_SECRET_KEY"])
    missing.push("MP_WEBHOOK_SECRET");
  if (missing.length > 0) {
    logger.warn(
      { missing },
      "⚠️  Webhook secrets are not set; /api/webhooks/* endpoints will reject events with 400 until they are configured.",
    );
  }
}

// Hard runtime assertion: the _uploadthingPatched marker is set by fetch-patch.ts
// when it replaces globalThis.fetch.  This check runs in the module body AFTER all
// static imports have resolved but BEFORE the dynamic import of app below loads
// uploadthing's FetchHttpClient.  If it fails, fetch-patch.ts is broken or missing —
// abort rather than run with every upload producing "Invalid signature" 400 errors.
if (!(globalThis.fetch as { _uploadthingPatched?: boolean })._uploadthingPatched) {
  throw new Error(
    "[upload] FATAL: fetch-patch marker not set — fetch-patch.ts did not replace " +
    "globalThis.fetch before this assertion ran. " +
    "Ensure `import { FETCH_PATCH_APPLIED } from './lib/fetch-patch'` is a static " +
    "import in src/index.ts and that fetch-patch.ts calls patchGlobalFetch(). " +
    "All file uploads will produce 'Invalid signature' 400 errors until this is fixed.",
  );
}

// Confirm the globalThis.fetch patch ran before any uploadthing module loaded.
// If this log line is absent in startup logs, the patch is not active and
// UploadThing CDN uploads will fail with "Invalid signature" (SDK v7 bug).
logger.info(
  { fetchPatchApplied: FETCH_PATCH_APPLIED },
  "[upload] fetch-patch active — UploadThing CDN double-encode and Range header bug mitigated",
);

// UploadThing token validation — warn at startup so missing config is immediately visible.
if (!process.env["UPLOADTHING_TOKEN"]) {
  logger.warn(
    "⚠️  UPLOADTHING_TOKEN is not set; all file upload endpoints (/api/uploadthing) will fail with 'Missing token' until it is configured.",
  );
} else {
  logger.info("[uploadthing] UPLOADTHING_TOKEN is configured — file uploads are enabled.");
}

const __serverDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__serverDir, "../../../lib/db/drizzle");

async function applyMigrations() {
  try {
    await runMigrations(migrationsFolder);
    logger.info("Drizzle migrations complete");
  } catch (err) {
    logger.error({ err }, "Drizzle migration failed");
  }
  // Idempotently seed plan rows so a freshly-deployed/empty database does not
  // leave billing, onboarding, and plan selection broken. Insert-only — never
  // clobbers operator edits made via /admin/plans.
  await seedPlansIfMissing();
  // The credential backfill is intentionally OUTSIDE the try/catch above so
  // a failure (bad encryption key, DB error mid-run) is fatal and aborts
  // boot — leaving plaintext credentials half-encrypted is worse than
  // refusing to start.
  await backfillEncryptedCredentials();
  logger.info("Credential backfill complete");
}


// ── Graceful shutdown ──
const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutdown signal received");
  await Promise.all([stopEmailWorker(), stopReminderWorker(), stopPdfWorker(), stopCommissionSyncWorker(), stopWhatsAppWorker(), stopCalendarSyncWorker(), closeQueues(), closeSeatUpdateSubscriber()]);
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ── Load app (dynamic import so uploadthing loads AFTER fetch-patch) ──
// app.ts transitively loads uploadthing, which captures globalThis.fetch by value
// inside its Effect-Platform FetchHttpClient.  A static import would resolve app.ts
// and all its transitive deps during ESM module graph evaluation — potentially before
// the module body assertion above.  A dynamic import is deferred to runtime, after
// all static imports (including fetch-patch) have already been evaluated and the
// _uploadthingPatched marker has been confirmed present.
// DO NOT change this to a static import.
const { default: app } = await import("./app");

// ── Bind HTTP port IMMEDIATELY so the Cloud Run startup probe gets a 200
//    from /api/healthz without waiting for migrations or Redis. ──
const server = app.listen(port, (err) => {
  if (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "EADDRINUSE" && process.env["NODE_ENV"] !== "production") {
      logger.warn({ port }, "Port already in use — dev workflow skipped (deployment server holds this port)");
      process.exit(0);
    }
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

// Handle EADDRINUSE via the error event (Node.js http.Server canonical path)
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE" && process.env["NODE_ENV"] !== "production") {
    logger.warn({ port }, "Port already in use — dev workflow skipped (deployment server holds this port)");
    process.exit(0);
  }
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

// ── Run migrations + backfill in the background ──
// applyMigrations() only throws when the credential backfill fails. In that
// case we abort: half-encrypted credentials are worse than a clean restart.
applyMigrations()
  .catch((err) => {
    logger.error({ err }, "Credential backfill failed — aborting boot");
    process.exit(1);
  })
  .then(() => {
    // Initialize Stripe sync engine (non-fatal — warns if STRIPE_SECRET_KEY not set)
    // Sequence: getStripeSync() → findOrCreateManagedWebhook() → syncBackfill()
    void initStripeSync();
  })
  .then(() => {
    // ── Background: cron + BullMQ workers (non-fatal if Redis is unavailable) ──
    void (async () => {
      // Birthday cron (node-cron, runs in-process, no Redis required)
      cron.schedule("0 0 * * *", () => {
        logger.info("[birthday] Daily cron triggered");
        runBirthdayCron().catch((err) => logger.error({ err }, "[birthday] Cron failed"));
      }, { timezone: "America/Sao_Paulo" });

      cron.schedule("0 2 * * *", () => {
        logger.info("[pipeline-trip-ended] Daily cron triggered");
        runPipelineTripEndedCron().catch((err) => logger.error({ err }, "[pipeline-trip-ended] Cron failed"));
      }, { timezone: "America/Sao_Paulo" });

      cron.schedule("0 3 * * *", () => {
        logger.info("[client-scores] Daily scores cron triggered");
        calculateScoresForAllTenants().catch((err) => logger.error({ err }, "[client-scores] Cron failed"));
      }, { timezone: "America/Sao_Paulo" });

      cron.schedule("0 6 * * *", () => {
        logger.info("[gemeo-alerts] Daily alerts cron triggered");
        runGemeoAlertsCron().catch((err) => logger.error({ err }, "[gemeo-alerts] Cron failed"));
      }, { timezone: "America/Sao_Paulo" });

      cron.schedule("0 7 * * 1", () => {
        logger.info("[gemeo-opportunities] Weekly opportunities cron triggered");
        runGemeoOpportunitiesCron().catch((err) => logger.error({ err }, "[gemeo-opportunities] Cron failed"));
      }, { timezone: "America/Sao_Paulo" });

      cron.schedule("0 10 * * *", () => {
        logger.info("[favorite-alerts] Daily low-availability alert cron triggered");
        runFavoriteLowAvailabilityAlertCron().catch((err) => logger.error({ err }, "[favorite-alerts] Cron failed"));
      }, { timezone: "America/Sao_Paulo" });

      cron.schedule("0 5 * * *", () => {
        logger.info("[abandoned-referrals] Daily sweep triggered");
        runAbandonedOrderReferralCleanup().catch((err) => logger.error({ err }, "[abandoned-referrals] Cron failed"));
      }, { timezone: "America/Sao_Paulo" });

      cron.schedule("0 4 * * *", () => {
        logger.info("[seat-reconciliation] Daily seat counter reconciliation triggered");
        runSeatReconciliationCron().catch((err) => logger.error({ err }, "[seat-reconciliation] Cron failed"));
      }, { timezone: "America/Sao_Paulo" });

      cron.schedule("0 8 * * *", () => {
        logger.info("[stripe-health] Daily Stripe price health-check triggered");
        runStripeHealthCheckCron().catch((err) => logger.error({ err }, "[stripe-health] Cron failed"));
      }, { timezone: "America/Sao_Paulo" });

      cron.schedule("0 * * * *", () => {
        logger.info("[campaign-automation] Daily automation cron triggered");
        runCampaignAutomationCron().catch((err) => logger.error({ err }, "[campaign-automation] Cron failed"));
      }, { timezone: "America/Sao_Paulo" });

      retryPendingReservationConfirmedWhatsApps().catch((err) =>
        logger.error({ err }, "[whatsapp-outbox] Startup retry failed"),
      );
      cron.schedule("*/5 * * * *", () => {
        retryPendingReservationConfirmedWhatsApps().catch((err) =>
          logger.error({ err }, "[whatsapp-outbox] Pending retry failed"),
        );
      }, { timezone: "America/Sao_Paulo" });

      // ── Seat-map SSE pub/sub fan-out (non-fatal, no-op when Redis absent) ──
      initSeatUpdateSubscriber();

      // ── Log Upstash daily usage on startup (non-fatal) ──
      fetchUpstashDailyStats()
        .then((stats) => {
          if (!stats) return;
          const threshold = getRedisWarningThresholdPct();
          if (stats.usagePct >= threshold) {
            logger.warn(
              {
                commandCount: stats.commandCount,
                maxCommands: stats.maxCommands,
                usagePct: Math.round(stats.usagePct * 10) / 10,
                warningThresholdPct: threshold,
              },
              `[redis-stats] ⚠️  Daily request usage is at ${Math.round(stats.usagePct)}% of the ${stats.maxCommands.toLocaleString()} limit (${stats.commandCount.toLocaleString()} used). Consider reducing polling or upgrading the plan.`,
            );
            maybeSendDailyLimitAlert(stats);
          } else {
            logger.info(
              {
                commandCount: stats.commandCount,
                maxCommands: stats.maxCommands,
                usagePct: Math.round(stats.usagePct * 10) / 10,
              },
              `[redis-stats] Daily request usage: ${stats.commandCount.toLocaleString()} / ${stats.maxCommands.toLocaleString()} (${Math.round(stats.usagePct)}%)`,
            );
          }
        })
        .catch((err) => logger.warn({ err }, "[redis-stats] Failed to check daily usage on startup"));

      // ── Hourly Redis daily-limit alert check ──
      // Polls usage once per hour and emails the superadmin when the configured
      // threshold is crossed. The alert itself is rate-limited to 1/hour inside
      // maybeSendDailyLimitAlert() so duplicate cron runs never flood the inbox.
      cron.schedule("0 * * * *", () => {
        fetchUpstashDailyStats()
          .then((stats) => {
            if (!stats) return;
            maybeSendDailyLimitAlert(stats);
          })
          .catch((err) => logger.warn({ err }, "[redis-daily-limit] Hourly check failed"));
      });

      // ENABLE_WORKERS: opt-in flag for BullMQ worker initialization.
      // Defaults to true in production and false in development so that
      // Redis connections are not established when not needed locally.
      const workersEnabledEnv = process.env["ENABLE_WORKERS"];
      const workersEnabled =
        workersEnabledEnv !== undefined
          ? workersEnabledEnv === "true"
          : process.env["NODE_ENV"] === "production";

      if (!workersEnabled) {
        logger.info("[queue] ENABLE_WORKERS is false — skipping BullMQ worker initialization");

        cron.schedule("*/5 * * * *", () => {
          runExpiredReservationsCron().catch((err) =>
            logger.error({ err }, "[expired-reservations] Cron failed"),
          );
        });
        logger.info("[expired-reservations] node-cron fallback registered (every 5 minutes)");

        cron.schedule("*/15 * * * *", () => {
          retryFailedBookingEmails().catch((err) =>
            logger.error({ err }, "[email-retry] node-cron fallback failed"),
          );
        });
        logger.info("[email-retry] node-cron fallback registered (every 15 minutes)");

        cron.schedule("*/15 * * * *", () => {
          retryFailedExpiryWarningEmails().catch((err) =>
            logger.error({ err }, "[expiry-warning-retry] node-cron fallback failed"),
          );
        });
        logger.info("[expiry-warning-retry] node-cron fallback registered (every 15 minutes)");

        cron.schedule("30 * * * *", () => {
          processNpsDispatch().catch((err) =>
            logger.error({ err }, "[nps-dispatch] node-cron fallback failed"),
          );
        });
        logger.info("[nps-dispatch] node-cron fallback registered (every hour at :30)");

        cron.schedule("0 8 * * *", () => {
          processInstallmentDueReminders().catch((err) =>
            logger.error({ err }, "[installment-due-reminder] node-cron fallback failed"),
          );
        }, { timezone: "America/Sao_Paulo" });
        logger.info("[installment-due-reminder] node-cron fallback registered (daily 08:00)");

        return;
      }

      // BullMQ: start workers if Redis is available
      const redisConn = getRedisConnection();
      if (redisConn) {
        try {
          // Await the eviction-policy check before initialising BullMQ workers.
          // This ensures our CONFIG SET (or the structured warning log) completes
          // before BullMQ runs its own internal eviction check, eliminating the
          // race condition that would otherwise cause the BullMQ console.warn to
          // fire even when the policy was successfully corrected.
          // A 5 s timeout prevents this from blocking startup indefinitely on
          // slow / rate-limited Redis instances.
          await Promise.race([
            waitForEvictionPolicyCheck(),
            new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
          ]);
          startEmailWorker();
          startReminderWorker();
          startPdfWorker();
          startCommissionSyncWorker();
          startWhatsAppWorker();
          startCalendarSyncWorker();
          logger.info("[queue] BullMQ workers started");
        } catch (err) {
          logger.error({ err }, "[queue] Failed to start BullMQ workers — continuing without them");
        }

        // Register repeatable reminder jobs (idempotent — BullMQ de-dups by key)
        const reminderQueue = getReminderQueue();
        if (reminderQueue) {
          const REMINDER_TZ = process.env["REMINDER_TZ"] ?? "America/Sao_Paulo";
          const REMINDER_CRON = process.env["REMINDER_CRON"] ?? "0 8 * * *";

          await reminderQueue.upsertJobScheduler(
            "boarding-reminder-daily",
            { pattern: REMINDER_CRON, tz: REMINDER_TZ },
            { name: "boarding_reminder", data: { type: "boarding_reminder" } },
          ).catch((err) => logger.error({ err }, "[reminders] Failed to schedule boarding reminder"));

          await reminderQueue.upsertJobScheduler(
            "payment-reminder-daily",
            { pattern: REMINDER_CRON, tz: REMINDER_TZ },
            { name: "payment_reminder", data: { type: "payment_reminder" } },
          ).catch((err) => logger.error({ err }, "[reminders] Failed to schedule payment reminder"));

          await reminderQueue.upsertJobScheduler(
            "expired-reservations-cleanup",
            { pattern: "*/5 * * * *" },
            { name: "expired_reservations_cleanup", data: { type: "expired_reservations_cleanup" } },
          ).catch((err) => logger.error({ err }, "[reminders] Failed to schedule expired reservations cleanup"));

          await reminderQueue.upsertJobScheduler(
            "failed-email-retry",
            { pattern: "*/15 * * * *" },
            { name: "failed_email_retry", data: { type: "failed_email_retry" } },
          ).catch((err) => logger.error({ err }, "[reminders] Failed to schedule failed-email retry"));

          await reminderQueue.upsertJobScheduler(
            "referral-expiry-notification-daily",
            { pattern: "0 9 * * *", tz: process.env["REMINDER_TZ"] ?? "America/Sao_Paulo" },
            { name: "referral_expiry_notification", data: { type: "referral_expiry_notification" } },
          ).catch((err) => logger.error({ err }, "[reminders] Failed to schedule referral expiry notification"));

          await reminderQueue.upsertJobScheduler(
            "referral-expiry-warning-daily",
            { pattern: "0 9 * * *", tz: process.env["REMINDER_TZ"] ?? "America/Sao_Paulo" },
            { name: "referral_expiry_warning", data: { type: "referral_expiry_warning" } },
          ).catch((err) => logger.error({ err }, "[reminders] Failed to schedule referral expiry warning"));

          await reminderQueue.upsertJobScheduler(
            "expiry-warning-email-retry",
            { pattern: "*/15 * * * *" },
            { name: "expiry_warning_email_retry", data: { type: "expiry_warning_email_retry" } },
          ).catch((err) => logger.error({ err }, "[reminders] Failed to schedule expiry-warning email retry"));

          await reminderQueue.upsertJobScheduler(
            "referral-bonus-release-notification-daily",
            { pattern: "0 9 * * *", tz: process.env["REMINDER_TZ"] ?? "America/Sao_Paulo" },
            { name: "referral_bonus_release_notification", data: { type: "referral_bonus_release_notification" } },
          ).catch((err) => logger.error({ err }, "[reminders] Failed to schedule referral bonus release notification"));

          await reminderQueue.upsertJobScheduler(
            "nps-dispatch-hourly",
            { pattern: "30 * * * *" },
            { name: "nps_dispatch", data: { type: "nps_dispatch" } },
          ).catch((err) => logger.error({ err }, "[reminders] Failed to schedule NPS dispatch"));

          await reminderQueue.upsertJobScheduler(
            "installment-due-reminder-daily",
            { pattern: process.env["REMINDER_CRON"] ?? "0 8 * * *", tz: process.env["REMINDER_TZ"] ?? "America/Sao_Paulo" },
            { name: "installment_due_reminder", data: { type: "installment_due_reminder" } },
          ).catch((err) => logger.error({ err }, "[reminders] Failed to schedule installment due reminder"));

          await reminderQueue.upsertJobScheduler(
            "seat-reconciliation-daily",
            { pattern: "0 4 * * *", tz: "America/Sao_Paulo" },
            { name: "seat_reconciliation", data: { type: "seat_reconciliation" } },
          ).catch((err) => logger.error({ err }, "[reminders] Failed to schedule seat reconciliation"));

          logger.info("[reminders] Repeatable reminder jobs registered");
        }
      } else {
        logger.warn("[queue] REDIS_URL not set — BullMQ workers not started, emails sent synchronously");

        cron.schedule("*/5 * * * *", () => {
          runExpiredReservationsCron().catch((err) =>
            logger.error({ err }, "[expired-reservations] Cron failed"),
          );
        });
        logger.info("[expired-reservations] node-cron fallback registered (every 5 minutes)");

        cron.schedule("*/15 * * * *", () => {
          retryFailedBookingEmails().catch((err) =>
            logger.error({ err }, "[email-retry] node-cron fallback failed"),
          );
        });
        logger.info("[email-retry] node-cron fallback registered (every 15 minutes)");

        cron.schedule("*/15 * * * *", () => {
          retryFailedExpiryWarningEmails().catch((err) =>
            logger.error({ err }, "[expiry-warning-retry] node-cron fallback failed"),
          );
        });
        logger.info("[expiry-warning-retry] node-cron fallback registered (every 15 minutes)");
      }
    })();
  });

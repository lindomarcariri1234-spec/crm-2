import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { runBirthdayCron } from "../lib/birthday";
import { runPipelineTripEndedCron } from "../services/pipeline-automation";
import { calculateScoresForAllTenants } from "../lib/client-scores";
import { runGemeoAlertsCron, runGemeoOpportunitiesCron } from "../lib/gemeo-cron";
import { runFavoriteLowAvailabilityAlertCron } from "../lib/favorite-alerts";
import { runAbandonedOrderReferralCleanup } from "../lib/abandoned-order-referrals";
import { runSeatReconciliationCron } from "../lib/seat-reconciliation";
import { runStripeHealthCheckCron } from "../lib/stripe-health-check";
import { runCampaignAutomationCron } from "../lib/campaign-automation";
import { runUploadThingOrphanCleanup } from "../lib/uploadthing-orphan-cleanup";
import { runExpiredReservationsCron } from "../lib/expired-reservations";
import { retryPendingReservationConfirmedWhatsApps } from "../services/checkout/reservation-confirmation-outbox";
import { retryPendingAttendanceReplies } from "../services/whatsapp-attendance";
import { fetchUpstashDailyStats, maybeSendDailyLimitAlert } from "../lib/redis";
import {
  retryFailedBookingEmails,
  retryFailedExpiryWarningEmails,
  processNpsDispatch,
  processInstallmentDueReminders,
  processTrialExpiryNotifications,
} from "../workers/reminder.worker";

/**
 * Serverless-platform (Vercel) cron entry points.
 *
 * On Replit these 20 jobs run in-process via `scheduleDistributedCron` /
 * `node-cron` (see src/index.ts). Vercel has no long-running process, so
 * each job is exposed here as a secured HTTP endpoint that Vercel Cron (or
 * an external scheduler, for jobs more frequent than Vercel Hobby's
 * once-daily limit) invokes directly.
 *
 * Every handler below is the exact function Replit's in-process scheduler
 * calls — no logic is duplicated. Vercel invokes each schedule at most once
 * per firing, so the Redis-lease dedup used by scheduleDistributedCron
 * (needed only to prevent duplicate *replicas* of a single long-running
 * process from double-firing) is intentionally not used here.
 */

const JOBS: Record<string, () => Promise<unknown>> = {
  birthday: runBirthdayCron,
  "pipeline-trip-ended": runPipelineTripEndedCron,
  "client-scores": calculateScoresForAllTenants,
  "gemeo-alerts": runGemeoAlertsCron,
  "gemeo-opportunities": runGemeoOpportunitiesCron,
  "favorite-alerts": runFavoriteLowAvailabilityAlertCron,
  "abandoned-referrals": runAbandonedOrderReferralCleanup,
  "seat-reconciliation": runSeatReconciliationCron,
  "stripe-health": runStripeHealthCheckCron,
  "installment-due-reminder": processInstallmentDueReminders,
  "trial-expiry": processTrialExpiryNotifications,
  "uploadthing-orphan": runUploadThingOrphanCleanup,
  // Sub-daily jobs — Vercel Hobby cannot schedule these natively (see
  // VERCEL_DEPLOYMENT.md). Endpoints exist regardless so Pro-plan cron or an
  // external scheduler (cron-job.org, GitHub Actions, Upstash QStash, etc.)
  // hitting this same secured URL works unchanged.
  "campaign-automation": runCampaignAutomationCron,
  "whatsapp-outbox": retryPendingReservationConfirmedWhatsApps,
  "chatbot-delivery": retryPendingAttendanceReplies,
  "expired-reservations": runExpiredReservationsCron,
  "email-retry": retryFailedBookingEmails,
  "expiry-warning-retry": retryFailedExpiryWarningEmails,
  "nps-dispatch": processNpsDispatch,
  "redis-daily-limit": async () => {
    const stats = await fetchUpstashDailyStats();
    if (stats) maybeSendDailyLimitAlert(stats);
  },
};

function isAuthorized(req: Request): boolean {
  const secret = process.env["CRON_SECRET"];
  if (!secret) return false;
  const header = req.headers["authorization"];
  return header === `Bearer ${secret}`;
}

const router: IRouter = Router();

router.all("/cron/:job", async (req: Request, res: Response) => {
  if (!process.env["CRON_SECRET"]) {
    logger.error("[cron] CRON_SECRET is not configured — refusing all /api/cron requests");
    res.status(503).json({ error: "CRON_SECRET_NOT_CONFIGURED" });
    return;
  }

  if (!isAuthorized(req)) {
    logger.warn({ job: req.params["job"], ip: req.ip }, "[cron] Unauthorized cron request rejected");
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  const jobParam = req.params["job"];
  const jobName = Array.isArray(jobParam) ? jobParam[0] : jobParam;
  if (!jobName) {
    res.status(404).json({ error: "UNKNOWN_JOB" });
    return;
  }
  const handler = JOBS[jobName];
  if (!handler) {
    res.status(404).json({ error: "UNKNOWN_JOB", job: jobName });
    return;
  }

  try {
    logger.info({ job: jobName }, "[cron] Job triggered via HTTP");
    const result = await handler();
    res.status(200).json({ ok: true, job: jobName, result: result ?? null });
  } catch (err) {
    logger.error({ err, job: jobName }, "[cron] Job failed");
    res.status(500).json({ ok: false, job: jobName, error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;

import { Queue, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import {
  approveSeparateQueueRedisCutover,
  areWorkersEnabled,
  getBullMQRedisSelection,
  getBullMQWorkerConnection,
  getBullMQQueueConnection,
  getRedisConnection,
  rejectSeparateQueueRedisCutover,
  waitForEvictionPolicyCheck,
} from "../lib/redis";
import { isKnownReminderSchedulerJob, REMINDER_SCHEDULER_NAME_BY_ID } from "./reminder-schedulers";
import { logger } from "../lib/logger";
import type { ReservationConfirmationEmailProps, ReservationCancellationEmailProps, BirthdayEmailProps, NewBookingNotificationEmailProps, ReferralBonusPaidEmailProps, ReferralConvertedEmailProps, ReferralExpiredEmailProps, ReferralExpiringSoonEmailProps, ReferralBonusReleasedEmailProps, ReferralWelcomeEmailProps, ReferralLoyaltyPointsEmailProps } from "@workspace/email";

export interface ReservationEmailJobData extends ReservationConfirmationEmailProps {
  emailLogId: string;
  tenantId: string;
  reservationId?: string;
}

export interface CancellationEmailJobData extends ReservationCancellationEmailProps {
  emailLogId: string;
  tenantId: string;
  reservationId?: string;
}

export interface BirthdayEmailJobData extends BirthdayEmailProps {
  tenantId: string;
  emailSubject?: string | null;
  senderName?: string | null;
  emailMessage?: string | null;
}

export interface NewBookingNotificationEmailJobData extends NewBookingNotificationEmailProps {
  emailLogId: string;
  tenantId: string;
  reservationId: string;
  recipients: string[];
  cc?: string[];
}

export interface ReferralBonusPaidEmailJobData extends ReferralBonusPaidEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralConvertedEmailJobData extends ReferralConvertedEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralExpiredEmailJobData extends ReferralExpiredEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralExpiringSoonEmailJobData extends ReferralExpiringSoonEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralBonusReleasedEmailJobData extends ReferralBonusReleasedEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralWelcomeEmailJobData extends ReferralWelcomeEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralLoyaltyPointsEmailJobData extends ReferralLoyaltyPointsEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReminderJobData {
  type: "boarding_reminder" | "payment_reminder" | "expired_reservations_cleanup" | "failed_email_retry" | "referral_expiry_notification" | "referral_expiry_warning" | "expiry_warning_email_retry" | "referral_bonus_release_notification" | "nps_dispatch" | "installment_due_reminder" | "seat_reconciliation" | "trial_expiry_notification" | "uploadthing_orphan_cleanup" | "chatbot_delivery_retry";
}

export interface PdfManifestJobData {
  type: "manifest";
  tenantId: string;
  tripId: string;
  recipientEmail: string;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface PdfVoucherJobData {
  type: "voucher";
  tenantId: string;
  reservationId: string;
  passengerName: string;
  agencyName: string;
  primaryColor: string;
  reservationNumber: string | null;
  status: string;
  voucherCode: string | null;
  reservationDate: string;
  paymentMethod: string | null;
  totalValue: number;
  paidValue: number;
  balance: number;
  seatsCount: number;
  tripName: string;
  tripDestination: string;
  tripDepartureDate: string | null;
  tripReturnDate: string | null;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export type PdfJobData = PdfManifestJobData | PdfVoucherJobData;

export interface CommissionSyncJobData {
  reservationId: string;
  tenantId: string;
}

export interface WhatsAppMessageJobData {
  phone: string;
  message: string;
  tenantId: string;
}

export interface OutboundDeliveryJobData {
  deliveryId: string;
  tenantId: string;
}

export interface ReservationConfirmedWhatsAppJobData {
  kind: "reservation-confirmed";
  outboxId: string;
}

export type WhatsAppNotificationJobData =
  | WhatsAppMessageJobData
  | ReservationConfirmedWhatsAppJobData;
export interface CalendarSyncJobData {
  type: "syncTrip" | "syncTripForUser" | "syncPayment" | "syncBirthday" | "deleteEventsForTrip";
  tripId?: string;
  paymentId?: string;
  clientId?: string;
  actorUserId?: string;
}

export interface CampaignEmailJobData {
  to: string;
  toName: string;
  subject: string;
  htmlContent: string;
  fromName: string;
  campaignId: string;
  clientId: string;
  tenantId: string;
}

const QUEUES = {
  EMAIL: "emails",
  REMINDERS: "reminders",
  PDF: "pdfs",
  COMMISSION_SYNC: "commission-sync",
  WHATSAPP: "whatsapp-notifications",
  CALENDAR_SYNC: "calendar-sync",
  OUTBOUND_DELIVERY: "outbound-deliveries",
} as const;

export type BullMQRedisCutoverBlocker = {
  queue: string;
  state: string;
  count: number;
  reason: string;
};

export type BullMQRedisCutoverStatus = {
  selectedRedis: "REDIS_URL" | "REDIS_QUEUE_URL" | "disabled";
  outcome: "not_checked" | "checking" | "not_configured" | "workers_disabled" | "blocked" | "approved" | "verified" | "reverted" | "same_resource";
  reason: string | null;
  blockerCount: number;
  blockedWorkCount: number;
  blockers: BullMQRedisCutoverBlocker[];
  checkedAt: string | null;
};

let bullMQRedisCutoverStatus: Omit<BullMQRedisCutoverStatus, "selectedRedis"> = {
  outcome: "not_checked",
  reason: null,
  blockerCount: 0,
  blockedWorkCount: 0,
  blockers: [],
  checkedAt: null,
};

type QueueProbeFailure = {
  category: string;
  commandName?: string;
};

let lastQueueProbeFailure: QueueProbeFailure | null = null;

function summarizeQueueProbeFailure(error: unknown): QueueProbeFailure {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const redisError = error as { command?: { name?: unknown } } | null;
  const rawCommandName = redisError?.command?.name;
  const commandName = typeof rawCommandName === "string" && /^[a-z][a-z0-9_-]{0,31}$/i.test(rawCommandName)
    ? rawCommandName.toLowerCase()
    : undefined;

  const category =
    /max(?:imum)? requests? limit|daily request limit|quota exceeded/.test(message) ? "daily_quota" :
    /wrongpass|noauth|authentication required/.test(message) ? "authentication" :
    /noperm|permission denied/.test(message) ? "permission_denied" :
    /unknown command|unsupported command/.test(message) ? "unsupported_command" :
    /maxmemory-policy|config.*not allowed/.test(message) ? "config_not_allowed" :
    /econnrefused|econnreset|etimedout|timeout|connection is closed|stream isn't writeable/.test(message) ? "connection" :
    error instanceof Error && error.name === "ReplyError" ? "redis_reply_error" :
    error instanceof Error ? "worker_error" : "unknown_error";

  return { category, ...(commandName ? { commandName } : {}) };
}

function updateBullMQRedisCutoverStatus(
  outcome: BullMQRedisCutoverStatus["outcome"],
  reason: string | null,
  blockers: BullMQRedisCutoverBlocker[] = [],
): void {
  bullMQRedisCutoverStatus = {
    outcome,
    reason,
    blockerCount: blockers.length,
    blockedWorkCount: blockers.reduce((sum, blocker) => sum + blocker.count, 0),
    blockers: blockers.map((blocker) => ({ ...blocker })),
    checkedAt: new Date().toISOString(),
  };
}

export function getBullMQRedisCutoverStatus(): BullMQRedisCutoverStatus {
  return {
    ...bullMQRedisCutoverStatus,
    selectedRedis: getBullMQRedisSelection(),
    blockers: bullMQRedisCutoverStatus.blockers.map((blocker) => ({ ...blocker })),
  };
}

/**
 * Check the legacy queue store before switching to REDIS_QUEUE_URL. If work
 * remains or inspection fails, leave routing on REDIS_URL; never strand jobs.
 */
export async function prepareBullMQQueueRedisCutover(): Promise<boolean> {
  updateBullMQRedisCutoverStatus("checking", null);
  const targetUrl = process.env["REDIS_QUEUE_URL"]?.trim();
  if (!targetUrl) {
    updateBullMQRedisCutoverStatus("not_configured", "REDIS_QUEUE_URL não está configurada");
    return false;
  }
  if (!areWorkersEnabled()) {
    updateBullMQRedisCutoverStatus("workers_disabled", "Os workers do BullMQ estão desativados");
    return false;
  }

  const legacyUrl = process.env["REDIS_URL"]?.trim();
  if (!legacyUrl || targetUrl === legacyUrl) {
    approveSeparateQueueRedisCutover();
    updateBullMQRedisCutoverStatus(
      legacyUrl ? "same_resource" : "approved",
      legacyUrl ? "REDIS_QUEUE_URL aponta para o mesmo recurso de REDIS_URL" : "REDIS_URL não está configurada; não há filas legadas para inspecionar",
    );
    return true;
  }

  const forcedCutoverUntil = Date.parse(process.env["FORCE_BULLMQ_REDIS_CUTOVER_UNTIL"] ?? "");
  if (Number.isFinite(forcedCutoverUntil) && forcedCutoverUntil > Date.now()) {
    approveSeparateQueueRedisCutover();
    updateBullMQRedisCutoverStatus(
      "approved",
      "Troca temporária autorizada até o prazo configurado; filas legadas não foram inspecionadas e podem conter jobs pendentes",
      [{ queue: "*", state: "inspection-skipped", count: 0, reason: "Troca autorizada sem inspecionar o Redis legado" }],
    );
    logger.warn(
      "[queue-cutover] Temporary forced cutover enabled; legacy Redis queues were not inspected and may retain pending jobs",
    );
    return true;
  }

  const legacyRedis = getRedisConnection();
  if (!legacyRedis) {
    logger.warn("[queue-cutover] Legacy Redis is configured but unavailable; keeping BullMQ on it");
    updateBullMQRedisCutoverStatus("blocked", "REDIS_URL está indisponível; é necessário inspecionar antes da troca", [
      { queue: "*", state: "inspection", count: 0, reason: "Conexão com o Redis legado indisponível" },
    ]);
    return false;
  }

  const queues: Queue[] = [];
  const blockers: Array<{ queue: string; state: string; count: number }> = [];
  try {
    queues.push(
      ...[...new Set(Object.values(QUEUES))].map(
        (name) => new Queue(name, { connection: legacyRedis }),
      ),
    );
    for (const queue of queues) {
      const counts = await queue.getJobCounts(
        "wait",
        "active",
        "failed",
        "paused",
        "waiting-children",
        "prioritized",
      );
      for (const [state, count] of Object.entries(counts)) {
        if (count > 0) blockers.push({ queue: queue.name, state, count });
      }

      const delayedJobs = await queue.getJobs(["delayed"], 0, -1, true);
      const nonMigratableDelayedJobs = delayedJobs.filter(
        (job) => queue.name !== QUEUES.REMINDERS || !isKnownReminderSchedulerJob(job),
      );
      if (nonMigratableDelayedJobs.length > 0) {
        blockers.push({ queue: queue.name, state: "delayed", count: nonMigratableDelayedJobs.length });
      }

      if (queue.name === QUEUES.REMINDERS) {
        const schedulers = await queue.getJobSchedulers();
        const unknownSchedulers = schedulers.filter(
          (scheduler) => REMINDER_SCHEDULER_NAME_BY_ID.get(scheduler.id ?? "") !== scheduler.name,
        );
        if (unknownSchedulers.length > 0) {
          blockers.push({ queue: queue.name, state: "unrecognized-schedulers", count: unknownSchedulers.length });
        }
      }
    }
  } catch (error) {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "unknown" },
      "[queue-cutover] Could not inspect the legacy Redis; continuing on it",
    );
    updateBullMQRedisCutoverStatus("blocked", "Não foi possível inspecionar as filas legadas; a troca não é segura", [
      { queue: "*", state: "inspection", count: 0, reason: "Falha ao inspecionar as filas" },
    ]);
    return false;
  } finally {
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
  }

  if (queues.length === 0) {
    updateBullMQRedisCutoverStatus("blocked", "Nenhuma fila legada foi inspecionada; a troca não é segura", [
      { queue: "*", state: "inspection", count: 0, reason: "Nenhuma inspeção de fila foi concluída" },
    ]);
    return false;
  }
  if (blockers.length > 0) {
    logger.warn(
      { blockers },
      "[queue-cutover] Legacy queues still contain work; continuing on the existing Redis until drained",
    );
    updateBullMQRedisCutoverStatus(
      "blocked",
      "Ainda há trabalho nas filas legadas; o BullMQ permanece em REDIS_URL",
      blockers.map((blocker) => ({
        ...blocker,
        reason: blocker.state === "unrecognized-schedulers"
          ? "Um agendador recorrente não reconhecido pode ser perdido na troca"
          : `${blocker.count} item(ns) no estado ${blocker.state} permanecem na fila legada`,
      })),
    );
    return false;
  }

  approveSeparateQueueRedisCutover();
  updateBullMQRedisCutoverStatus("approved", "As filas legadas estão vazias; verificando o novo Redis com um worker de teste");
  logger.info("[queue-cutover] Legacy queues are clear; BullMQ will use REDIS_QUEUE_URL");
  return true;
}

/** Prove a worker can consume from the selected queue Redis before serving traffic. */
export async function verifyBullMQWorkerConsumesProbe(timeoutMs = 10_000): Promise<boolean> {
  lastQueueProbeFailure = null;
  const queueName = "redis-queue-health";
  const jobId = `probe-${randomUUID()}`;
  const probeNonce = randomUUID();
  let queue: Queue | null = null;
  let worker: Worker | null = null;
  let probeWasQueued = false;
  let consumed = false;
  let resolveConsumed!: () => void;
  let rejectConsumed!: (error: Error) => void;
  const consumedPromise = new Promise<void>((resolve, reject) => {
    resolveConsumed = resolve;
    rejectConsumed = reject;
  });
  void consumedPromise.catch(() => {});

  const timeout = <T>(promise: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("queue_probe_timeout")), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });

  try {
    const workerConnection = getBullMQWorkerConnection();
    const producerConnection = getBullMQQueueConnection();
    if (!workerConnection || !producerConnection) return false;

    queue = new Queue(queueName, { connection: producerConnection });
    worker = new Worker(
      queueName,
      async (job) => job.data.nonce,
      { connection: workerConnection, concurrency: 1 },
    );
    worker.on("completed", (job, result) => {
      if (job.id === jobId) {
        if (result === probeNonce) {
          consumed = true;
          resolveConsumed();
        } else {
          rejectConsumed(new Error("queue_probe_result_mismatch"));
        }
      }
    });
    worker.on("failed", (job, error) => {
      if (job?.id === jobId) rejectConsumed(error ?? new Error("queue_probe_failed"));
    });
    worker.on("error", (error) => {
      const failure = summarizeQueueProbeFailure(error);
      lastQueueProbeFailure = failure;
      logger.warn(
        {
          ...failure,
          errorName: error instanceof Error ? error.name : "unknown",
        },
        "[queue-cutover] Probe worker error",
      );
      rejectConsumed(error instanceof Error ? error : new Error("queue_probe_worker_error"));
    });

    await timeout(waitForEvictionPolicyCheck());
    await timeout(worker.waitUntilReady());
    probeWasQueued = true;
    await timeout(queue.add(
      "redis-queue-startup-probe",
      { nonce: probeNonce },
      { jobId, removeOnComplete: true, removeOnFail: true },
    ));
    await timeout(consumedPromise);
    logger.info("[queue-cutover] Probe job was consumed by a BullMQ worker");
    return true;
  } catch (error) {
    const failure = summarizeQueueProbeFailure(error);
    lastQueueProbeFailure ??= failure;
    logger.warn(
      {
        ...lastQueueProbeFailure,
        errorName: error instanceof Error ? error.name : "unknown",
      },
      "[queue-cutover] Worker did not consume the probe; reverting to REDIS_URL",
    );
    return false;
  } finally {
    await worker?.close().catch(() => {});
    if (queue && probeWasQueued && !consumed) {
      await queue.remove(jobId).catch(() => {});
    }
    await queue?.close().catch(() => {});
  }
}

const LEGACY_RECOVERY_RETRY_MS = 60_000;
let legacyRecoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Recover only outbound-delivery jobs backed by a still-pending database
 * ledger row. Other legacy queues can produce external side effects and are
 * deliberately left in place for their own reconciliation paths.
 */
export async function recoverLegacyOutboundDeliveryJobs(): Promise<{
  inspectedQueues: number;
  migrated: number;
  skipped: number;
  inspectionComplete: boolean;
}> {
  const legacyUrl = process.env["REDIS_URL"]?.trim();
  const targetUrl = process.env["REDIS_QUEUE_URL"]?.trim();
  if (
    getBullMQRedisSelection() !== "REDIS_QUEUE_URL" ||
    !legacyUrl ||
    !targetUrl ||
    legacyUrl === targetUrl
  ) {
    return { inspectedQueues: 0, migrated: 0, skipped: 0, inspectionComplete: false };
  }

  const legacyConnection = getRedisConnection();
  const targetConnection = getBullMQQueueConnection();
  if (!legacyConnection || !targetConnection) {
    logger.warn("[queue-recovery] Redis connection unavailable; legacy jobs were not inspected");
    return { inspectedQueues: 0, migrated: 0, skipped: 0, inspectionComplete: false };
  }

  const queues: Queue[] = [];
  let targetQueue: Queue | null = null;
  let inspectedQueues = 0;
  let migrated = 0;
  let skipped = 0;
  let inspectionComplete = false;
  const queueInventory: Record<string, Record<string, number>> = {};
  try {
    const queueNames = [...new Set(Object.values(QUEUES))];
    queues.push(...queueNames.map((name) => new Queue(name, { connection: legacyConnection })));
    targetQueue = new Queue(QUEUES.OUTBOUND_DELIVERY, { connection: targetConnection });

    for (const queue of queues) {
      const counts = await queue.getJobCounts(
        "wait",
        "active",
        "failed",
        "paused",
        "waiting-children",
        "prioritized",
        "delayed",
      );
      queueInventory[queue.name] = Object.fromEntries(
        Object.entries(counts).filter(([, count]) => count > 0),
      );
      inspectedQueues++;
    }

    const sourceQueue = queues.find((queue) => queue.name === QUEUES.OUTBOUND_DELIVERY);
    if (!sourceQueue) throw new Error("legacy_outbound_queue_missing");
    const { isOutboundDeliveryPendingForQueueRecovery } = await import("../services/outbound-delivery.js");
    const candidates = await sourceQueue.getJobs(
      ["wait", "delayed", "paused", "prioritized"],
      0,
      -1,
      true,
    );

    for (const job of candidates) {
      const data = job.data as Partial<OutboundDeliveryJobData> | null;
      const deliveryId = typeof data?.deliveryId === "string" ? data.deliveryId : null;
      const tenantId = typeof data?.tenantId === "string" ? data.tenantId : null;
      const expectedJobId = deliveryId && tenantId
        ? `outbound-delivery:${tenantId}:${deliveryId}`
        : null;
      const state = await job.getState();
      if (
        !deliveryId ||
        !tenantId ||
        !expectedJobId ||
        job.id !== expectedJobId ||
        !["wait", "delayed", "paused", "prioritized"].includes(state) ||
        !(await isOutboundDeliveryPendingForQueueRecovery(deliveryId, tenantId))
      ) {
        skipped++;
        continue;
      }

      const rawMaxAttempts = Number(job.opts.attempts ?? 1);
      const maxAttempts = Number.isFinite(rawMaxAttempts) && rawMaxAttempts > 0
        ? Math.floor(rawMaxAttempts)
        : 1;
      const rawAttemptsMade = Number(job.attemptsMade ?? 0);
      const attemptsMade = Number.isFinite(rawAttemptsMade) && rawAttemptsMade > 0
        ? Math.floor(rawAttemptsMade)
        : 0;
      if (attemptsMade >= maxAttempts) {
        skipped++;
        continue;
      }

      const existing = await targetQueue.getJob(expectedJobId);
      if (existing) {
        const existingData = existing.data as Partial<OutboundDeliveryJobData> | null;
        const sameIdentity =
          existingData?.deliveryId === deliveryId && existingData?.tenantId === tenantId;
        const existingState = await existing.getState();
        if (!sameIdentity || !["completed", "failed"].includes(existingState)) {
          if (sameIdentity) {
            await job.remove();
            migrated++;
          } else {
            skipped++;
          }
          continue;
        }
        await existing.remove();
      }

      const remainingDelay = state === "delayed"
        ? Math.max(0, job.timestamp + job.delay - Date.now())
        : 0;
      await targetQueue.add(job.name, { deliveryId, tenantId }, {
        jobId: expectedJobId,
        delay: remainingDelay,
        attempts: Math.max(1, maxAttempts - attemptsMade),
        backoff: job.opts.backoff,
        priority: job.opts.priority,
        lifo: job.opts.lifo,
        removeOnComplete: job.opts.removeOnComplete,
        removeOnFail: job.opts.removeOnFail,
      });
      await job.remove();
      migrated++;
    }
    inspectionComplete = true;

    logger.info(
      {
        inspectedQueues,
        queueInventory,
        migrated,
        skipped,
      },
      "[queue-recovery] Legacy queue inspection completed",
    );
    return { inspectedQueues, migrated, skipped, inspectionComplete };
  } catch (error) {
    logger.warn(
      {
        errorName: error instanceof Error ? error.name : "unknown",
        inspectedQueues,
        migrated,
        skipped,
        inspectionComplete,
      },
      "[queue-recovery] Could not recover legacy jobs; remaining jobs were left untouched",
    );
    return { inspectedQueues, migrated, skipped, inspectionComplete };
  } finally {
    await Promise.all([
      ...queues.map((queue) => queue.close().catch(() => {})),
      targetQueue?.close().catch(() => {}) ?? Promise.resolve(),
    ]);
  }
}

function scheduleLegacyQueueRecoveryRetry(): void {
  if (legacyRecoveryRetryTimer || getBullMQRedisSelection() !== "REDIS_QUEUE_URL") return;
  legacyRecoveryRetryTimer = setTimeout(() => {
    legacyRecoveryRetryTimer = null;
    void recoverLegacyOutboundDeliveryJobs().then((result) => {
      if (!result.inspectionComplete) scheduleLegacyQueueRecoveryRetry();
    }).catch((error) => {
      logger.warn(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "[queue-recovery] Legacy Redis retry failed",
      );
      scheduleLegacyQueueRecoveryRetry();
    });
  }, LEGACY_RECOVERY_RETRY_MS);
  legacyRecoveryRetryTimer.unref?.();
}

export type ReferralEmailJobData = ReferralBonusPaidEmailJobData | ReferralConvertedEmailJobData | ReferralExpiredEmailJobData | ReferralExpiringSoonEmailJobData | ReferralBonusReleasedEmailJobData | ReferralWelcomeEmailJobData;

export async function prepareAndVerifyBullMQQueueRedisCutover(probeTimeoutMs = 10_000): Promise<boolean> {
  const cutoverApproved = await prepareBullMQQueueRedisCutover();
  if (!cutoverApproved) return false;
  if (await verifyBullMQWorkerConsumesProbe(probeTimeoutMs)) {
    updateBullMQRedisCutoverStatus("verified", "Um worker do BullMQ consumiu o teste em REDIS_QUEUE_URL");
    const recovery = await recoverLegacyOutboundDeliveryJobs();
    if (!recovery.inspectionComplete) scheduleLegacyQueueRecoveryRetry();
    return true;
  }

  rejectSeparateQueueRedisCutover();
  const failureDetail = lastQueueProbeFailure
    ? ` O Redis rejeitou ${lastQueueProbeFailure.commandName ?? "uma operação do worker"} (${lastQueueProbeFailure.category}).`
    : "";
  updateBullMQRedisCutoverStatus(
    "reverted",
    `O teste do worker falhou; o BullMQ voltou para REDIS_URL.${failureDetail}`,
    [{
      queue: "redis-queue-health",
      state: "probe",
      count: 1,
      reason: lastQueueProbeFailure
        ? `Falha ${lastQueueProbeFailure.category}${lastQueueProbeFailure.commandName ? ` na operação ${lastQueueProbeFailure.commandName}` : ""}`
        : "Nenhum worker consumiu o teste da troca",
    }],
  );
  return false;
}

let _emailQueue: Queue<ReservationEmailJobData> | null = null;
let _cancellationEmailQueue: Queue<CancellationEmailJobData> | null = null;
let _birthdayEmailQueue: Queue<BirthdayEmailJobData> | null = null;
let _newBookingNotificationEmailQueue: Queue<NewBookingNotificationEmailJobData> | null = null;
let _referralEmailQueue: Queue<ReferralEmailJobData> | null = null;
let _reminderQueue: Queue<ReminderJobData> | null = null;
let _pdfQueue: Queue<PdfJobData> | null = null;
let _commissionSyncQueue: Queue<CommissionSyncJobData> | null = null;

export function getEmailQueue(): Queue<ReservationEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_emailQueue) {
    _emailQueue = new Queue<ReservationEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _emailQueue;
}

export function getCancellationEmailQueue(): Queue<CancellationEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_cancellationEmailQueue) {
    _cancellationEmailQueue = new Queue<CancellationEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _cancellationEmailQueue;
}

export function getBirthdayEmailQueue(): Queue<BirthdayEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_birthdayEmailQueue) {
    _birthdayEmailQueue = new Queue<BirthdayEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _birthdayEmailQueue;
}

export function getNewBookingNotificationEmailQueue(): Queue<NewBookingNotificationEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_newBookingNotificationEmailQueue) {
    _newBookingNotificationEmailQueue = new Queue<NewBookingNotificationEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _newBookingNotificationEmailQueue;
}

export function getReferralEmailQueue(): Queue<ReferralEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_referralEmailQueue) {
    _referralEmailQueue = new Queue<ReferralEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _referralEmailQueue;
}

export function getReminderQueue(): Queue<ReminderJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_reminderQueue) {
    _reminderQueue = new Queue<ReminderJobData>(QUEUES.REMINDERS, {
      connection: conn,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _reminderQueue;
}

export function getPdfQueue(): Queue<PdfJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_pdfQueue) {
    _pdfQueue = new Queue<PdfJobData>(QUEUES.PDF, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _pdfQueue;
}

export function getCommissionSyncQueue(): Queue<CommissionSyncJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_commissionSyncQueue) {
    _commissionSyncQueue = new Queue<CommissionSyncJobData>(QUEUES.COMMISSION_SYNC, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _commissionSyncQueue;
}

let _calendarSyncQueue: Queue<CalendarSyncJobData> | null = null;

export function getCalendarSyncQueue(): Queue<CalendarSyncJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_calendarSyncQueue) {
    _calendarSyncQueue = new Queue<CalendarSyncJobData>(QUEUES.CALENDAR_SYNC, {
      connection: conn,
      defaultJobOptions: {
        // withCalendarRetry handles inline retries (30s/5min/20min, 4 attempts).
        // BullMQ attempts:2 is a safety net for paths not wrapped in withCalendarRetry
        // (e.g. deleteEvent calls). Avoids excessive multiplication for wrapped paths (4×2=8 max).
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _calendarSyncQueue;
}

let _campaignEmailQueue: Queue<CampaignEmailJobData> | null = null;

export function getCampaignEmailQueue(): Queue<CampaignEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;
  if (!_campaignEmailQueue) {
    _campaignEmailQueue = new Queue<CampaignEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _campaignEmailQueue;
}

let _whatsAppQueue: Queue<WhatsAppNotificationJobData> | null = null;
let _outboundDeliveryQueue: Queue<OutboundDeliveryJobData> | null = null;

export function getWhatsAppQueue(): Queue<WhatsAppNotificationJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_whatsAppQueue) {
    _whatsAppQueue = new Queue<WhatsAppNotificationJobData>(QUEUES.WHATSAPP, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _whatsAppQueue;
}

export function getOutboundDeliveryQueue(): Queue<OutboundDeliveryJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;
  if (!_outboundDeliveryQueue) {
    _outboundDeliveryQueue = new Queue<OutboundDeliveryJobData>(QUEUES.OUTBOUND_DELIVERY, {
      connection: conn,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return _outboundDeliveryQueue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    _emailQueue?.close().catch(() => {}),
    _cancellationEmailQueue?.close().catch(() => {}),
    _birthdayEmailQueue?.close().catch(() => {}),
    _newBookingNotificationEmailQueue?.close().catch(() => {}),
    _referralEmailQueue?.close().catch(() => {}),
    _reminderQueue?.close().catch(() => {}),
    _pdfQueue?.close().catch(() => {}),
    _commissionSyncQueue?.close().catch(() => {}),
    _calendarSyncQueue?.close().catch(() => {}),
    _campaignEmailQueue?.close().catch(() => {}),
    _whatsAppQueue?.close().catch(() => {}),
    _outboundDeliveryQueue?.close().catch(() => {}),
  ]);
  _emailQueue = null;
  _cancellationEmailQueue = null;
  _birthdayEmailQueue = null;
  _newBookingNotificationEmailQueue = null;
  _reminderQueue = null;
  _pdfQueue = null;
  _commissionSyncQueue = null;
  _calendarSyncQueue = null;
  _campaignEmailQueue = null;
  _whatsAppQueue = null;
  _outboundDeliveryQueue = null;
}

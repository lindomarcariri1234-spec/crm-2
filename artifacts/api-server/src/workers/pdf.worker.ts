import { Worker } from "bullmq";
import { getRedisConnection } from "../lib/redis";
import { attachCircuitBreaker } from "../lib/worker-circuit-breaker";
import { logger } from "../lib/logger";
import { db, auditLogsTable } from "@workspace/db";
import { generateId } from "../lib/id";
import { sendManifestEmail } from "@workspace/email";
import type { PdfJobData } from "../queues/index";

let _worker: Worker<PdfJobData> | null = null;

export function startPdfWorker(): Worker<PdfJobData> | null {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn("[pdf-worker] No Redis connection — worker not started");
    return null;
  }

  const isDev = process.env.NODE_ENV !== "production";

  _worker = new Worker<PdfJobData>(
    "pdfs",
    async (job) => {
      const { type, tenantId, userId, ipAddress, userAgent } = job.data;

      logger.info({ jobId: job.id, type }, "[pdf-worker] Processing job");

      if (type === "manifest") {
        const { tripId, tripName, manifestNumber, agencyName, recipientEmail, htmlContent, pdfBase64 } = job.data;
        const pdfBuffer = Buffer.from(pdfBase64, "base64");

        const result = await sendManifestEmail({
          to: recipientEmail,
          tripName,
          manifestNumber: manifestNumber ?? null,
          agencyName,
          htmlContent,
          pdfAttachment: pdfBuffer,
        });

        if (!result.success) {
          throw new Error(result.error ?? "sendManifestEmail failed");
        }

        await db.insert(auditLogsTable).values({
          id: generateId(),
          tenantId,
          userId,
          action: "manifest_sent",
          entityType: "trip",
          entityId: tripId,
          after: { channel: "email", to: recipientEmail.replace(/(.{2}).+(@.+)/, "$1***$2") },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        });

        logger.info({ tripId, recipient: recipientEmail.replace(/(.{2}).+(@.+)/, "$1***$2") }, "[pdf-worker] Manifest email sent");
      } else if (type === "voucher") {
        const { reservationId } = job.data;

        await db.insert(auditLogsTable).values({
          id: generateId(),
          tenantId,
          userId,
          action: "voucher_downloaded",
          entityType: "reservation",
          entityId: reservationId,
          after: { channel: "download" },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        });

        logger.info({ reservationId }, "[pdf-worker] Voucher download logged");
      } else {
        logger.warn({ type }, "[pdf-worker] Unknown PDF job type");
      }
    },
    isDev
      ? { connection: conn, concurrency: 1, stalledInterval: 60_000, drainDelay: 30 }
      : { connection: conn, concurrency: 2, stalledInterval: 15_000 },
  );

  _worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "[pdf-worker] Job failed");
  });

  attachCircuitBreaker(_worker, "pdf-worker");

  logger.info("[pdf-worker] Started");
  return _worker;
}

export async function stopPdfWorker(): Promise<void> {
  if (_worker) {
    await _worker.close().catch(() => {});
    _worker = null;
  }
}

export function isPdfWorkerRunning(): boolean {
  return _worker !== null;
}

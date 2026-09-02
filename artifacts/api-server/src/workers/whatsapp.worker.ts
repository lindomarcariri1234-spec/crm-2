import { Worker } from "bullmq";
import { getRedisConnection } from "../lib/redis";
import { attachCircuitBreaker } from "../lib/worker-circuit-breaker";
import { logger } from "../lib/logger";
import type { WhatsAppNotificationJobData, WhatsAppMessageJobData } from "../queues/index";
import { deliverReservationConfirmedWhatsApp } from "../services/checkout/reservation-confirmation-outbox";
import { dispatchOutboundMessage } from "../services/outbound-delivery";

let _worker: Worker<WhatsAppNotificationJobData> | null = null;

export function startWhatsAppWorker(): Worker<WhatsAppNotificationJobData> | null {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn("[whatsapp-worker] No Redis connection — worker not started");
    return null;
  }

  const isDev = process.env.NODE_ENV !== "production";

  _worker = new Worker<WhatsAppNotificationJobData>(
    "whatsapp-notifications",
    async (job) => {
      if ("kind" in job.data && job.data.kind === "reservation-confirmed") {
        const delivered = await deliverReservationConfirmedWhatsApp(job.data.outboxId);
        if (!delivered) throw new Error("reservation_confirmation_delivery_failed");
        return;
      }
      const msgData = job.data as WhatsAppMessageJobData;
      logger.info({ jobId: job.id, phone: msgData.phone }, "[whatsapp-worker] Processing job");
      const result = await dispatchOutboundMessage({
        tenantId: msgData.tenantId,
        eventType: "legacy_whatsapp_job",
        idempotencyKey: `legacy-whatsapp-job:${msgData.tenantId}:${job.id}`,
        recipient: { type: "direct", whatsapp: msgData.phone },
        email: {
          subject: "Mensagem da agência",
          html: `<p>${escapeHtml(msgData.message)}</p>`,
        },
        whatsapp: { text: msgData.message },
        origin: "legacy_whatsapp_worker",
        originChannel: "whatsapp",
      });
      const whatsappDelivery = result.deliveries.find((delivery) => delivery.channel === "whatsapp");
      if (whatsappDelivery?.status === "failed") {
        throw new Error(whatsappDelivery.lastError ?? "send_failed");
      }
    },
    isDev
      ? { connection: conn, concurrency: 1, stalledInterval: 60_000, drainDelay: 30 }
      : { connection: conn, concurrency: 5, stalledInterval: 15_000 },
  );

  _worker.on("failed", (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, "[whatsapp-worker] Job failed");
  });

  attachCircuitBreaker(_worker, "whatsapp-worker");

  return _worker;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br>");
}

export async function stopWhatsAppWorker(): Promise<void> {
  await _worker?.close().catch(() => {});
  _worker = null;
}

import { Worker } from "bullmq";
import { getRedisConnection } from "../lib/redis";
import { attachCircuitBreaker } from "../lib/worker-circuit-breaker";
import { logger } from "../lib/logger";
import type { OutboundDeliveryJobData } from "../queues";
import { processOutboundDelivery } from "../services/outbound-delivery";

let worker: Worker<OutboundDeliveryJobData> | null = null;

export function startOutboundDeliveryWorker(): Worker<OutboundDeliveryJobData> | null {
  const connection = getRedisConnection();
  if (!connection) {
    logger.warn("[outbound-delivery-worker] No Redis connection — worker not started");
    return null;
  }
  const isDev = process.env.NODE_ENV !== "production";
  worker = new Worker<OutboundDeliveryJobData>(
    "outbound-deliveries",
    async (job) => {
      const delivered = await processOutboundDelivery(job.data.deliveryId, job.data.tenantId);
      if (!delivered) logger.debug({ jobId: job.id }, "[outbound-delivery-worker] Delivery was already claimed or terminal");
    },
    isDev
      ? { connection, concurrency: 1, stalledInterval: 60_000, drainDelay: 30 }
      : { connection, concurrency: 5, stalledInterval: 15_000 },
  );
  worker.on("failed", (job, error) => {
    logger.warn({ jobId: job?.id, error: error.message }, "[outbound-delivery-worker] Job failed; ledger recovery will retry it");
  });
  attachCircuitBreaker(worker, "outbound-delivery-worker");
  return worker;
}

export async function stopOutboundDeliveryWorker(): Promise<void> {
  await worker?.close().catch(() => {});
  worker = null;
}
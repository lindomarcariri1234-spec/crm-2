import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logger, redisCircuit } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  redisCircuit: {
    isOpen: vi.fn(() => false),
    isTransient: vi.fn(() => false),
    recordTransient: vi.fn(),
    registerWorker: vi.fn(),
    reportDailyLimit: vi.fn(() => false),
  },
}));
vi.mock("../lib/logger", () => ({ logger }));
vi.mock("../lib/redis", () => ({
  isRedisDailyLimitCircuitOpen: redisCircuit.isOpen,
  isTransientRedisError: redisCircuit.isTransient,
  recordTransientRedisError: redisCircuit.recordTransient,
  registerRedisDailyLimitWorker: redisCircuit.registerWorker,
  reportRedisDailyLimitError: redisCircuit.reportDailyLimit,
  resetTransientRedisErrors: vi.fn(),
}));

import type { Worker } from "bullmq";
import { resetTransientRedisErrors } from "../lib/redis";
import { attachCircuitBreaker } from "../lib/worker-circuit-breaker";

describe("attachCircuitBreaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisCircuit.isOpen.mockReturnValue(false);
    redisCircuit.isTransient.mockReturnValue(false);
    redisCircuit.reportDailyLimit.mockReturnValue(false);
  });

  it("registers each worker with the shared circuit and reports daily-limit errors", () => {
    const unregister = vi.fn();
    redisCircuit.registerWorker.mockReturnValue(unregister);
    redisCircuit.reportDailyLimit.mockReturnValue(true);
    const worker = new EventEmitter();

    attachCircuitBreaker(worker as unknown as Worker<unknown>, "email-worker");
    worker.emit("error", new Error("max daily request limit"));
    worker.emit("closed");

    expect(redisCircuit.registerWorker).toHaveBeenCalledWith(worker);
    expect(redisCircuit.reportDailyLimit).toHaveBeenCalledWith(
      expect.objectContaining({ message: "max daily request limit" }),
    );
    expect(redisCircuit.recordTransient).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { workerName: "email-worker" },
      expect.stringContaining("daily-limit circuit"),
    );
    expect(unregister).toHaveBeenCalledOnce();
  });

  it("does not mark Redis healthy on worker readiness while the daily-limit circuit is open", () => {
    redisCircuit.registerWorker.mockReturnValue(vi.fn());
    redisCircuit.isOpen.mockReturnValue(true);
    const worker = new EventEmitter();

    attachCircuitBreaker(worker as unknown as Worker<unknown>, "email-worker");
    worker.emit("ready");
    expect(resetTransientRedisErrors).not.toHaveBeenCalled();

    redisCircuit.isOpen.mockReturnValue(false);
    worker.emit("ready");
    expect(resetTransientRedisErrors).toHaveBeenCalledOnce();
  });

  it("routes a rejected background run through the worker error handler", async () => {
    const failure = new Error("max daily request limit");
    redisCircuit.reportDailyLimit.mockReturnValue(true);
    const worker = new EventEmitter() as EventEmitter & {
      run: () => Promise<void>;
      resume: () => void;
    };
    worker.run = vi.fn().mockRejectedValue(failure);
    worker.resume = () => {
      void worker.run();
    };

    attachCircuitBreaker(worker as unknown as Worker<unknown>, "email-worker");
    worker.resume();
    await Promise.resolve();

    expect(redisCircuit.reportDailyLimit).toHaveBeenCalledWith(failure);
    expect(logger.warn).toHaveBeenCalledWith(
      { workerName: "email-worker" },
      expect.stringContaining("daily-limit circuit"),
    );
  });
});
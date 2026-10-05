import { afterEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/logger", () => ({ logger }));

import { createRedisDailyLimitCircuit } from "../lib/redis-daily-limit-circuit";

describe("Redis daily-limit circuit", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("pauses workers once and resumes them only after the shared probe succeeds", async () => {
    vi.useFakeTimers();
    const probe = vi.fn()
      .mockRejectedValueOnce(new Error("max daily request limit"))
      .mockResolvedValueOnce("PONG");
    const onOpened = vi.fn();
    const onRecovered = vi.fn();
    const worker = {
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
    };
    const circuit = createRedisDailyLimitCircuit({
      probe,
      onOpened,
      onRecovered,
      initialProbeDelayMs: 100,
      maxProbeDelayMs: 400,
    });
    circuit.registerWorker(worker);

    expect(circuit.reportError(new Error("max requests limit exceeded"))).toBe(true);
    expect(circuit.reportError(new Error("max daily request limit"))).toBe(true);
    expect(circuit.isOpen()).toBe(true);
    expect(onOpened).toHaveBeenCalledOnce();
    expect(worker.pause).toHaveBeenCalledOnce();
    expect(worker.pause).toHaveBeenCalledWith(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(probe).toHaveBeenCalledOnce();
    expect(worker.resume).not.toHaveBeenCalled();
    expect(circuit.isOpen()).toBe(true);

    await vi.advanceTimersByTimeAsync(199);
    expect(probe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    expect(probe).toHaveBeenCalledTimes(2);
    expect(worker.resume).toHaveBeenCalledOnce();
    expect(circuit.isOpen()).toBe(false);
    expect(onRecovered).toHaveBeenCalledOnce();
    circuit.stop();
  });

  it("does not open for unrelated errors and pauses workers registered during an outage", () => {
    const circuit = createRedisDailyLimitCircuit({
      probe: vi.fn().mockResolvedValue("PONG"),
      initialProbeDelayMs: 60_000,
    });
    const worker = {
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
    };

    expect(circuit.reportError(new Error("ECONNRESET"))).toBe(false);
    expect(circuit.isOpen()).toBe(false);
    expect(circuit.reportError(new Error("max daily request limit"))).toBe(true);
    circuit.registerWorker(worker);
    expect(worker.pause).toHaveBeenCalledOnce();

    circuit.stop();
  });
});
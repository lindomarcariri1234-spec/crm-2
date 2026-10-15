import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecute, mockInsert, mockUpdate, mockRunDeferredOrderAccounting } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockRunDeferredOrderAccounting: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: mockExecute,
    insert: mockInsert,
    update: mockUpdate,
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

vi.mock("./post-booking", () => ({
  runDeferredOrderAccounting: mockRunDeferredOrderAccounting,
}));

import { retryPendingDeferredOrderAccounting } from "./deferred-accounting-recovery.js";

describe("retryPendingDeferredOrderAccounting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rows: [{ id: "order-1" }] });
  });

  it("retries a failed accounting transaction on a later sweep without creating another payment", async () => {
    mockRunDeferredOrderAccounting
      .mockRejectedValueOnce(new Error("transient database failure"))
      .mockResolvedValueOnce(undefined);

    const first = await retryPendingDeferredOrderAccounting();
    const second = await retryPendingDeferredOrderAccounting();

    expect(first).toEqual({ scanned: 1, recovered: 0, failed: 1 });
    expect(second).toEqual({ scanned: 1, recovered: 1, failed: 0 });
    expect(mockRunDeferredOrderAccounting).toHaveBeenNthCalledWith(1, "order-1", {
      allowPartialPayment: true,
      throwOnDeferredError: true,
    });
    expect(mockRunDeferredOrderAccounting).toHaveBeenNthCalledWith(2, "order-1", {
      allowPartialPayment: true,
      throwOnDeferredError: true,
    });
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does nothing when there are no paid orders waiting for deferred accounting", async () => {
    mockExecute.mockResolvedValue({ rows: [] });

    await expect(retryPendingDeferredOrderAccounting()).resolves.toEqual({
      scanned: 0,
      recovered: 0,
      failed: 0,
    });
    expect(mockRunDeferredOrderAccounting).not.toHaveBeenCalled();
  });
});

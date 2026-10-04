import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDbExecute, mockLogError, mockLogInfo } = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
  mockLogError: vi.fn(),
  mockLogInfo: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: mockDbExecute },
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: mockLogInfo,
    warn: vi.fn(),
    error: mockLogError,
    debug: vi.fn(),
  },
}));

vi.mock("../lib/safe-error-log.js", () => ({
  safeErrorLogFields: vi.fn(() => ({ kind: "Error" })),
}));

import { runWhatsAppInboundMediaRetentionCleanup } from "./whatsapp-media-retention.js";

beforeEach(() => {
  mockDbExecute.mockReset();
  mockLogError.mockReset();
  mockLogInfo.mockReset();
});

describe("runWhatsAppInboundMediaRetentionCleanup", () => {
  it("expires media in bounded batches and is idempotent on later runs", async () => {
    const firstBatch = Array.from({ length: 250 }, (_, i) => ({ id: `message-${i}` }));
    mockDbExecute
      .mockResolvedValueOnce({ rows: firstBatch })
      .mockResolvedValueOnce({ rows: [{ id: "message-250" }] })
      .mockResolvedValueOnce({ rows: [] });
    const now = new Date("2026-10-04T12:00:00.000Z");

    const firstRun = await runWhatsAppInboundMediaRetentionCleanup(now);
    const secondRun = await runWhatsAppInboundMediaRetentionCleanup(now);

    expect(firstRun).toEqual({ expiredMessages: 251, errors: 0 });
    expect(secondRun).toEqual({ expiredMessages: 0, errors: 0 });
    expect(mockDbExecute).toHaveBeenCalledTimes(3);
  });

  it("reports database failures without preventing the orphan cleanup from running", async () => {
    mockDbExecute.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await runWhatsAppInboundMediaRetentionCleanup(
      new Date("2026-10-04T12:00:00.000Z"),
    );

    expect(result).toEqual({ expiredMessages: 0, errors: 1 });
    expect(mockLogError).toHaveBeenCalledOnce();
  });
});
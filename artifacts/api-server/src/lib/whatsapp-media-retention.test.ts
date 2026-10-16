import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbExecute,
  mockLogError,
  mockLogInfo,
  mockLogWarn,
  mockPoolConnect,
  mockPoolQuery,
  mockClientQuery,
  mockSendAlert,
} = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
  mockLogError: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockPoolConnect: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockClientQuery: vi.fn(),
  mockSendAlert: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: mockDbExecute },
  pool: {
    connect: mockPoolConnect,
    query: mockPoolQuery,
  },
}));

vi.mock("@workspace/email", () => ({
  sendReminderHtmlEmail: mockSendAlert,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
    debug: vi.fn(),
  },
}));

vi.mock("../lib/safe-error-log.js", () => ({
  safeErrorLogFields: vi.fn(() => ({ kind: "Error" })),
}));

import { runWhatsAppInboundMediaRetentionCleanup } from "./whatsapp-media-retention.js";

let storedFailureState: string | null = null;

beforeEach(() => {
  mockDbExecute.mockReset();
  mockLogError.mockReset();
  mockLogInfo.mockReset();
  mockLogWarn.mockReset();
  mockPoolConnect.mockReset();
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockSendAlert.mockReset();
  storedFailureState = null;

  mockClientQuery.mockImplementation(async (statement: string, values?: unknown[]) => {
    if (statement.includes("SELECT value FROM public.platform_settings WHERE key = $1 FOR UPDATE")) {
      return { rows: [{ value: storedFailureState }] };
    }
    if (statement.includes("UPDATE public.platform_settings SET value = $2")) {
      storedFailureState = String(values?.[1]);
    }
    return { rows: [] };
  });
  mockPoolConnect.mockResolvedValue({
    query: mockClientQuery,
    release: vi.fn(),
  });
  mockPoolQuery.mockResolvedValue({ rows: [{ value: "ops@example.com" }] });
  mockSendAlert.mockResolvedValue({ success: true });
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
    const privateMarkers = [
      "customer message body",
      "https://utfs.io/f/private-media-key",
      "private-media-key",
    ];
    mockDbExecute.mockRejectedValueOnce(
      new Error(`database unavailable ${privateMarkers.join(" ")}`),
    );

    const result = await runWhatsAppInboundMediaRetentionCleanup(
      new Date("2026-10-04T12:00:00.000Z"),
    );

    expect(result).toEqual({ expiredMessages: 0, errors: 1 });
    expect(mockLogError).toHaveBeenCalledWith(
      { error: { kind: "Error" }, expiredMessages: 0 },
      expect.stringContaining("remaining messages will be retried"),
    );
    const serializedLogs = JSON.stringify(mockLogError.mock.calls);
    for (const marker of privateMarkers) {
      expect(serializedLogs).not.toContain(marker);
    }
  });

  it("sends one aggregate-only alert after three consecutive failures and resets after recovery", async () => {
    mockDbExecute.mockRejectedValue(new Error("database unavailable"));

    for (let i = 0; i < 4; i++) {
      await runWhatsAppInboundMediaRetentionCleanup(new Date("2026-10-04T12:00:00.000Z"));
    }

    expect(mockSendAlert).toHaveBeenCalledTimes(1);
    const alert = mockSendAlert.mock.calls[0]?.[0];
    expect(alert).toMatchObject({ to: "ops@example.com" });
    expect(alert.html).toContain("3 execuções consecutivas");
    expect(alert.html).not.toContain("database unavailable");
    expect(alert.html).not.toContain("media-key");

    mockDbExecute.mockResolvedValue({ rows: [] });
    await runWhatsAppInboundMediaRetentionCleanup(new Date("2026-10-04T12:00:00.000Z"));
    expect(JSON.parse(storedFailureState ?? "{}")).toEqual({
      consecutiveFailures: 0,
      alertSent: false,
    });

    mockDbExecute.mockRejectedValue(new Error("database unavailable"));
    for (let i = 0; i < 3; i++) {
      await runWhatsAppInboundMediaRetentionCleanup(new Date("2026-10-04T12:00:00.000Z"));
    }
    expect(mockSendAlert).toHaveBeenCalledTimes(2);
  });
});
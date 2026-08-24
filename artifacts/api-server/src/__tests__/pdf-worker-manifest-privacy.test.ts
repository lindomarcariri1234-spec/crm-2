import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadManifestPanelForTenant,
  mockSendManifestEmail,
  mockGenerateManifestHtml,
  mockGenerateManifestPdf,
} = vi.hoisted(() => ({
  mockLoadManifestPanelForTenant: vi.fn(),
  mockSendManifestEmail: vi.fn(),
  mockGenerateManifestHtml: vi.fn(),
  mockGenerateManifestPdf: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })) },
  auditLogsTable: {},
}));
vi.mock("@workspace/email", () => ({ sendManifestEmail: mockSendManifestEmail }));
vi.mock("../lib/manifest-helpers.js", () => ({
  loadManifestPanelForTenant: mockLoadManifestPanelForTenant,
  generateManifestHtml: mockGenerateManifestHtml,
  generateManifestPdf: mockGenerateManifestPdf,
}));
vi.mock("../lib/redis.js", () => ({ getRedisConnection: vi.fn() }));
vi.mock("../lib/worker-circuit-breaker.js", () => ({ attachCircuitBreaker: vi.fn() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "audit-id") }));

import { processPdfJob } from "../workers/pdf.worker.js";

describe("manifest PDF worker privacy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails without sending when the queued tenant no longer owns the trip", async () => {
    mockLoadManifestPanelForTenant.mockResolvedValue(null);

    await expect(processPdfJob({
      type: "manifest",
      tenantId: "tenant-a",
      tripId: "trip-now-owned-by-b",
      recipientEmail: "recipient@example.com",
      userId: "user-a",
      ipAddress: null,
      userAgent: null,
    })).rejects.toThrow("no longer belongs to the queued tenant");

    expect(mockLoadManifestPanelForTenant).toHaveBeenCalledWith("tenant-a", "trip-now-owned-by-b");
    expect(mockGenerateManifestHtml).not.toHaveBeenCalled();
    expect(mockGenerateManifestPdf).not.toHaveBeenCalled();
    expect(mockSendManifestEmail).not.toHaveBeenCalled();
  });
});
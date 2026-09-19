import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSelect, mockDelete, mockLogger } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockDelete: vi.fn(),
  mockLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    delete: mockDelete,
  },
  referralAttemptLogsTable: {
    tenantId: "tenant_id",
    createdAt: "created_at",
    id: "id",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...parts: unknown[]) => parts),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  lt: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../lib/logger.js", () => ({ logger: mockLogger }));

import {
  DEFAULT_REFERRAL_ATTEMPT_LOG_RETENTION_DAYS,
  getReferralAttemptLogRetentionDays,
  runReferralAttemptLogCleanup,
} from "../lib/referral-attempt-log-cleanup.js";

function selectChain(rows: Array<{ tenantId: string }>) {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    groupBy: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function deleteChain(rows: Array<{ id: string }>) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ returning }));
  return { where, returning };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env["REFERRAL_ATTEMPT_LOG_RETENTION_DAYS"];
  mockLogger.error.mockReset();
  mockLogger.info.mockReset();
});

afterEach(() => {
  delete process.env["REFERRAL_ATTEMPT_LOG_RETENTION_DAYS"];
});

describe("runReferralAttemptLogCleanup", () => {
  it("uses the documented 90-day policy and deletes stale rows separately per tenant", async () => {
    mockSelect.mockReturnValue(selectChain([{ tenantId: "tenant-a" }, { tenantId: "tenant-b" }]));
    mockDelete
      .mockReturnValueOnce(deleteChain([{ id: "old-a-1" }, { id: "old-a-2" }]))
      .mockReturnValueOnce(deleteChain([{ id: "old-b-1" }]));

    const result = await runReferralAttemptLogCleanup();

    expect(result).toMatchObject({
      retentionDays: DEFAULT_REFERRAL_ATTEMPT_LOG_RETENTION_DAYS,
      tenantsScanned: 2,
      deletedRows: 3,
      failedTenants: 0,
    });
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ deletedRows: 3, tenantsScanned: 2 }),
      expect.stringContaining("Cleanup complete"),
    );
  });

  it("clamps unsafe retention settings instead of allowing immediate deletion", () => {
    process.env["REFERRAL_ATTEMPT_LOG_RETENTION_DAYS"] = "1";
    expect(getReferralAttemptLogRetentionDays()).toBe(7);

    process.env["REFERRAL_ATTEMPT_LOG_RETENTION_DAYS"] = "99999";
    expect(getReferralAttemptLogRetentionDays()).toBe(3650);

    process.env["REFERRAL_ATTEMPT_LOG_RETENTION_DAYS"] = "not-a-number";
    expect(getReferralAttemptLogRetentionDays()).toBe(90);
  });

  it("continues other tenants and reports a failed tenant when one delete fails", async () => {
    mockSelect.mockReturnValue(selectChain([{ tenantId: "tenant-a" }, { tenantId: "tenant-b" }]));
    mockDelete
      .mockReturnValueOnce({
        where: vi.fn(() => ({
          returning: vi.fn().mockRejectedValue(new Error("database unavailable")),
        })),
      })
      .mockReturnValueOnce(deleteChain([{ id: "old-b-1" }]));

    const result = await runReferralAttemptLogCleanup();

    expect(result).toMatchObject({ tenantsScanned: 2, deletedRows: 1, failedTenants: 1 });
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a", errorType: "Error" }),
      expect.stringContaining("Failed to clean tenant rows"),
    );
  });
});
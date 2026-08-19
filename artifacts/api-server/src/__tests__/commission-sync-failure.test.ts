import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockQueue,
  mockSyncReservationCommission,
  mockUpdate,
  mockLogError,
  mockLogInfo,
} = vi.hoisted(() => {
  const mockQueue = { add: vi.fn() };
  const mockSyncReservationCommission = vi.fn();
  const mockUpdate = vi.fn();
  const mockLogError = vi.fn();
  const mockLogInfo = vi.fn();
  return { mockQueue, mockSyncReservationCommission, mockUpdate, mockLogError, mockLogInfo };
});

vi.mock("../queues/index.js", () => ({
  getCommissionSyncQueue: vi.fn(() => mockQueue),
}));

vi.mock("../routes/payments.js", () => ({
  syncReservationCommission: mockSyncReservationCommission,
  recalculateClientFinancials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => ({
  db: { update: mockUpdate },
  reservationsTable: { id: "id", tenantId: "tenantId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col, val) => `eq:${String(val)}`),
  and: vi.fn((...args) => args),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { error: mockLogError, info: mockLogInfo, warn: vi.fn() },
}));

import { getCommissionSyncQueue } from "../queues/index.js";
import { enqueueCommissionSync, markCommissionSyncFailed, clearCommissionSyncStatus } from "../queues/commission-sync-helper.js";

const RESERVATION_ID = "res-001";
const TENANT_ID = "tenant-001";

function setupUpdateMock() {
  const whereMock = vi.fn().mockResolvedValue([]);
  const setMock = vi.fn(() => ({ where: whereMock }));
  mockUpdate.mockReturnValue({ set: setMock });
  return { setMock, whereMock };
}

describe("enqueueCommissionSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupUpdateMock();
  });

  it("enqueues a BullMQ job when Redis is available and does not update the reservation", async () => {
    mockQueue.add.mockResolvedValue({ id: "job-001" });

    await enqueueCommissionSync(RESERVATION_ID, TENANT_ID);

    expect(mockQueue.add).toHaveBeenCalledWith("commission-sync", {
      reservationId: RESERVATION_ID,
      tenantId: TENANT_ID,
    });
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("enqueued"),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("falls back to direct sync when enqueue throws; sets commissionSyncStatus=failed if direct sync also fails", async () => {
    mockQueue.add.mockRejectedValue(new Error("Redis unavailable"));
    mockSyncReservationCommission.mockRejectedValue(new Error("DB error"));
    const { setMock } = setupUpdateMock();

    await enqueueCommissionSync(RESERVATION_ID, TENANT_ID);

    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("Failed to enqueue"),
    );
    expect(mockSyncReservationCommission).toHaveBeenCalledWith(RESERVATION_ID, TENANT_ID);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("Direct commission sync failed"),
    );
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ commissionSyncStatus: "failed" }));
  });

  it("runs direct sync when queue is null (no Redis); clears commissionSyncStatus on success", async () => {
    vi.mocked(getCommissionSyncQueue).mockReturnValueOnce(null);
    mockSyncReservationCommission.mockResolvedValue(undefined);
    const { setMock } = setupUpdateMock();

    await enqueueCommissionSync(RESERVATION_ID, TENANT_ID);

    expect(mockSyncReservationCommission).toHaveBeenCalledWith(RESERVATION_ID, TENANT_ID);
    expect(setMock).toHaveBeenCalledWith({ commissionSyncStatus: null });
  });

  it("sets commissionSyncStatus=failed and logs an error when Redis is absent and direct sync fails", async () => {
    vi.mocked(getCommissionSyncQueue).mockReturnValueOnce(null);
    mockSyncReservationCommission.mockRejectedValue(new Error("DB timeout"));
    const { setMock } = setupUpdateMock();

    await enqueueCommissionSync(RESERVATION_ID, TENANT_ID);

    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("Direct commission sync failed"),
    );
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ commissionSyncStatus: "failed" }));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("never throws to the caller even when both queue and direct sync fail", async () => {
    mockQueue.add.mockRejectedValue(new Error("Redis down"));
    mockSyncReservationCommission.mockRejectedValue(new Error("DB error"));

    await expect(enqueueCommissionSync(RESERVATION_ID, TENANT_ID)).resolves.toBeUndefined();
  });
});

describe("markCommissionSyncFailed — worker retry exhaustion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupUpdateMock();
  });

  it("updates commissionSyncStatus to 'failed' for the given reservation", async () => {
    const { setMock, whereMock } = setupUpdateMock();

    await markCommissionSyncFailed(RESERVATION_ID, TENANT_ID);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({ commissionSyncStatus: "failed" });
    expect(whereMock).toHaveBeenCalled();
  });

  it("does not throw when the DB update itself fails", async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn().mockRejectedValue(new Error("DB down")) })),
    });

    await expect(markCommissionSyncFailed(RESERVATION_ID, TENANT_ID)).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("Failed to update commissionSyncStatus"),
    );
  });
});

describe("clearCommissionSyncStatus — stale marker cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupUpdateMock();
  });

  it("sets commissionSyncStatus to null for the given reservation", async () => {
    const { setMock, whereMock } = setupUpdateMock();

    await clearCommissionSyncStatus(RESERVATION_ID, TENANT_ID);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({ commissionSyncStatus: null });
    expect(whereMock).toHaveBeenCalled();
  });

  it("does not throw when the DB update itself fails", async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn().mockRejectedValue(new Error("DB down")) })),
    });

    await expect(clearCommissionSyncStatus(RESERVATION_ID, TENANT_ID)).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("Failed to clear commissionSyncStatus"),
    );
  });
});

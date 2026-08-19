import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockBroadcastSeatUpdate,
  mockExecute,
  mockWhere,
  mockSet,
  mockUpdate,
  mockTransaction,
} = vi.hoisted(() => {
  const mockWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn(() => ({ where: mockWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  const mockExecute = vi.fn();

  const mockTransaction = vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
    await callback({ execute: mockExecute, update: mockUpdate });
  });

  const mockBroadcastSeatUpdate = vi.fn().mockResolvedValue(undefined);

  return {
    mockBroadcastSeatUpdate,
    mockExecute,
    mockWhere,
    mockSet,
    mockUpdate,
    mockTransaction,
  };
});

vi.mock("@workspace/db", () => ({
  db: { transaction: mockTransaction },
  reservationsTable: {},
  tripsTable: {},
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@workspace/permissions", () => ({
  RESERVATION_STATUS: { PENDING: "pending", CANCELLED: "cancelled" },
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: mockBroadcastSeatUpdate,
}));

import { runExpiredReservationsCron } from "../lib/expired-reservations.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockWhere.mockResolvedValue(undefined);
  mockSet.mockReturnValue({ where: mockWhere });
  mockUpdate.mockReturnValue({ set: mockSet });
  mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
    await callback({ execute: mockExecute, update: mockUpdate });
  });
  mockBroadcastSeatUpdate.mockResolvedValue(undefined);
});

describe("runExpiredReservationsCron — broadcastSeatUpdate integration", () => {
  it("calls broadcastSeatUpdate exactly once per unique tripId when multiple reservations share the same trip", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { id: "r1", trip_id: "trip-A", tenant_id: "tenant-1", seats: ["1A"] },
        { id: "r2", trip_id: "trip-A", tenant_id: "tenant-1", seats: ["2B"] },
        { id: "r3", trip_id: "trip-A", tenant_id: "tenant-1", seats: ["3C"] },
      ],
    });

    await runExpiredReservationsCron();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockBroadcastSeatUpdate).toHaveBeenCalledOnce();
    expect(mockBroadcastSeatUpdate).toHaveBeenCalledWith("trip-A", "tenant-1");
  });

  it("calls broadcastSeatUpdate once per unique tripId across multiple distinct trips", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { id: "r1", trip_id: "trip-A", tenant_id: "tenant-1", seats: ["1A"] },
        { id: "r2", trip_id: "trip-B", tenant_id: "tenant-1", seats: ["2B"] },
        { id: "r3", trip_id: "trip-A", tenant_id: "tenant-1", seats: ["3C"] },
        { id: "r4", trip_id: "trip-B", tenant_id: "tenant-1", seats: ["4D"] },
      ],
    });

    await runExpiredReservationsCron();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockBroadcastSeatUpdate).toHaveBeenCalledTimes(2);
    expect(mockBroadcastSeatUpdate).toHaveBeenCalledWith("trip-A", "tenant-1");
    expect(mockBroadcastSeatUpdate).toHaveBeenCalledWith("trip-B", "tenant-1");
  });

  it("does not call broadcastSeatUpdate when there are no expired reservations", async () => {
    mockExecute.mockResolvedValue({ rows: [] });

    await runExpiredReservationsCron();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockBroadcastSeatUpdate).not.toHaveBeenCalled();
  });

  it("resolves successfully even if broadcastSeatUpdate rejects (fire-and-forget)", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { id: "r1", trip_id: "trip-X", tenant_id: "tenant-1", seats: ["1A"] },
      ],
    });
    mockBroadcastSeatUpdate.mockRejectedValue(new Error("SSE channel unavailable"));

    await expect(runExpiredReservationsCron()).resolves.toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("resolves successfully even if all broadcastSeatUpdate calls reject across multiple trips", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { id: "r1", trip_id: "trip-X", tenant_id: "tenant-1", seats: ["1A"] },
        { id: "r2", trip_id: "trip-Y", tenant_id: "tenant-1", seats: ["2B"] },
      ],
    });
    mockBroadcastSeatUpdate.mockRejectedValue(new Error("network failure"));

    await expect(runExpiredReservationsCron()).resolves.toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

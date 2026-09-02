import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockUpdate, mockSet, mockWhere } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: mockSelect, update: mockUpdate },
  reservationsTable: {
    id: "reservations.id",
    tenantId: "reservations.tenantId",
    clientId: "reservations.clientId",
    status: "reservations.status",
    tripId: "reservations.tripId",
    seats: "reservations.seats",
  },
  tripsTable: {
    id: "trips.id",
    tenantId: "trips.tenantId",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  eq: vi.fn((column: unknown, value: unknown) => ({ type: "eq", column, value })),
  inArray: vi.fn((column: unknown, values: unknown[]) => ({ type: "inArray", column, values })),
  asc: vi.fn((column: unknown) => ({ type: "asc", column })),
  sql: vi.fn(),
}));

import { reservationsTable, tripsTable } from "@workspace/db";
import { unlinkClientFromTrips } from "../services/unlink-client-from-trips.js";

describe("unlinkClientFromTrips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue([]);
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            for: () => Promise.resolve([]),
          }),
        }),
      }),
    });
  });

  it("cancels active reservations, releases their seats, and clears historical links", async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            for: () => Promise.resolve([
              { id: "reservation-1", tripId: "trip-1", status: "confirmed", seats: ["1", "2"] },
              { id: "reservation-2", tripId: "trip-2", status: "pending", seats: ["3"] },
            ]),
          }),
        }),
      }),
    });

    const tripIds = await unlinkClientFromTrips({ select: mockSelect, update: mockUpdate }, "tenant-1", "client-1");

    expect(tripIds).toEqual(["trip-1", "trip-2"]);
    expect(mockUpdate).toHaveBeenCalledWith(reservationsTable);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "cancelled",
      clientId: null,
      cancelledAt: expect.any(Date),
    }));
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ clientId: null }));
    expect(mockUpdate).toHaveBeenCalledWith(tripsTable);
  });

  it("does not touch capacity or historical links when there are no active reservations", async () => {
    const tripIds = await unlinkClientFromTrips({ select: mockSelect, update: mockUpdate }, "tenant-1", "client-1");

    expect(tripIds).toEqual([]);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith({ clientId: null });
  });

  it("propagates a failed transition so the surrounding transaction can roll back", async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            for: () => Promise.resolve([
              { id: "reservation-1", tripId: "trip-1", status: "confirmed", seats: ["1"] },
            ]),
          }),
        }),
      }),
    });
    mockWhere.mockRejectedValueOnce(new Error("trip update failed"));

    await expect(
      unlinkClientFromTrips({ select: mockSelect, update: mockUpdate }, "tenant-1", "client-1"),
    ).rejects.toThrow("trip update failed");
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
    expect(mockSet).not.toHaveBeenCalledWith({ clientId: null });
  });
});
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, flushAct, renderHook } from "./eventSourceHarness.js";

const { listRequests, mockNavigate, mockUseListTrips } = vi.hoisted(() => {
  const listRequests: Array<Record<string, unknown>> = [];
  const mockNavigate = vi.fn();
  const listData = {
    data: [],
    total: 0,
    stats: {
      total: 0,
      active: 0,
      totalCapacity: 0,
      occupiedSeats: 0,
      totalRevenue: 0,
    },
  };
  const mockUseListTrips = vi.fn((params: Record<string, unknown>) => {
    listRequests.push(params);
    return {
      data: listData,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: vi.fn(),
    };
  });
  return { listRequests, mockNavigate, mockUseListTrips };
});

vi.mock("wouter", () => ({
  useSearch: () => "",
  useLocation: () => ["/trips", mockNavigate],
}));

vi.mock("@workspace/api-client-react", () => ({
  useListTrips: mockUseListTrips,
  useGetMe: () => ({ data: { tenantId: "tenant-test", role: "agency_admin" } }),
  useCreateTrip: () => ({ mutateAsync: vi.fn() }),
  useDeleteTrip: () => ({ mutateAsync: vi.fn() }),
  useGetDashboardUpcomingTrips: () => ({ data: [] }),
}));

import { useTrips } from "../hooks/useTrips";

function latestListRequest(): Record<string, unknown> {
  const request = listRequests.at(-1);
  if (!request) throw new Error("useListTrips was not called");
  return request;
}

describe("useTrips filter pagination", () => {
  beforeEach(() => {
    listRequests.length = 0;
    mockNavigate.mockClear();
    mockUseListTrips.mockClear();
  });

  afterEach(async () => {
    await cleanupRoots();
  });

  it("keeps type and date on later pages and resets to page one when either changes", async () => {
    const { result } = await renderHook(() => useTrips());

    await flushAct(() => {
      result.current.setTypeFilter("excursao");
    });
    await flushAct(() => {
      result.current.setDateFilter("2026-09-15");
    });
    await flushAct(() => {
      result.current.setPage(3);
    });

    expect(result.current.page).toBe(3);
    expect(latestListRequest()).toMatchObject({
      type: "excursao",
      date: "2026-09-15",
      page: 3,
      limit: 12,
    });

    await flushAct(() => {
      result.current.setDateFilter("2026-09-20");
    });
    expect(result.current.page).toBe(1);
    expect(latestListRequest()).toMatchObject({
      type: "excursao",
      date: "2026-09-20",
      page: 1,
    });

    await flushAct(() => {
      result.current.setPage(2);
    });
    await flushAct(() => {
      result.current.setTypeFilter("pacote");
    });
    expect(result.current.page).toBe(1);
    expect(latestListRequest()).toMatchObject({
      type: "pacote",
      date: "2026-09-20",
      page: 1,
    });
  });
});
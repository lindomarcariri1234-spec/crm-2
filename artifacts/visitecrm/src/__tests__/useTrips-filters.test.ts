import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, flushAct, renderHook } from "./eventSourceHarness.js";

const { listRequests, mockNavigate, mockUseListTrips, routeState } = vi.hoisted(() => {
  const listRequests: Array<Record<string, unknown>> = [];
  const routeState = { search: "" };
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
  return { listRequests, mockNavigate, mockUseListTrips, routeState };
});

vi.mock("wouter", () => ({
  useSearch: () => routeState.search,
  useLocation: () => ["/trips", mockNavigate],
}));

vi.mock("@workspace/api-client-react", () => ({
  useListTrips: mockUseListTrips,
  useGetMe: () => ({ data: { tenantId: "tenant-test", role: "agency_admin" } }),
  useCreateTrip: () => ({ mutateAsync: vi.fn() }),
  useUpdateTrip: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
    routeState.search = "";
    mockNavigate.mockClear();
    mockUseListTrips.mockClear();
  });

  afterEach(async () => {
    await cleanupRoots();
  });

  it("hydrates filters from the initial query without rewriting it", async () => {
    routeState.search = "q=montanha&location=Recife&status=active&storePublication=published&type=excursao&date=2026-09-15&page=3";

    const { result } = await renderHook(() => useTrips());

    expect(result.current).toMatchObject({
      search: "montanha",
      locationFilter: "Recife",
      statusFilter: "active",
      storePublicationFilter: "published",
      typeFilter: "excursao",
      dateFilter: "2026-09-15",
      page: 3,
    });
    expect(latestListRequest()).toMatchObject({
      search: "montanha",
      location: "Recife",
      status: "active",
      storePublication: "published",
      type: "excursao",
      date: "2026-09-15",
      page: 3,
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("writes local filter changes to the query and keeps the page reset behavior", async () => {
    const { result, rerender } = await renderHook(() => useTrips());

    await flushAct(() => {
      result.current.setSearch("montanha");
    });
    await flushAct(() => {
      result.current.setPage(3);
    });
    expect(mockNavigate).toHaveBeenLastCalledWith(
      "?q=montanha&page=3",
      { replace: true },
    );

    await flushAct(() => {
      result.current.setTypeFilter("excursao");
    });
    expect(result.current.page).toBe(1);
    expect(mockNavigate).toHaveBeenLastCalledWith(
      "?q=montanha&type=excursao",
      { replace: true },
    );

    mockNavigate.mockClear();
    routeState.search = "q=montanha&type=excursao";
    await flushAct(() => rerender());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("adopts incoming query changes instead of overwriting them with stale filters", async () => {
    const { result, rerender } = await renderHook(() => useTrips());

    await flushAct(() => {
      result.current.setSearch("local-stale");
    });
    mockNavigate.mockClear();

    routeState.search = "q=historico&location=Crato&status=cancelled&type=pacote&date=2026-10-02&page=4";
    await flushAct(() => rerender());

    expect(result.current).toMatchObject({
      search: "historico",
      locationFilter: "Crato",
      statusFilter: "cancelled",
      typeFilter: "pacote",
      dateFilter: "2026-10-02",
      page: 4,
    });
    expect(latestListRequest()).toMatchObject({
      search: "historico",
      location: "Crato",
      status: "cancelled",
      type: "pacote",
      date: "2026-10-02",
      page: 4,
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("writes the location term to the URL, resets pagination, and restores it from a history URL", async () => {
    const { result, rerender } = await renderHook(() => useTrips());

    await flushAct(() => result.current.setPage(4));
    await flushAct(() => result.current.setLocationFilter("  São Paulo  "));

    expect(result.current.page).toBe(1);
    expect(result.current.locationFilter).toBe("  São Paulo  ");
    expect(latestListRequest()).toMatchObject({ location: "São Paulo", page: 1 });
    expect(new URLSearchParams(mockNavigate.mock.lastCall?.[0].slice(1)).get("location"))
      .toBe("  São Paulo  ");

    mockNavigate.mockClear();
    routeState.search = "location=Juazeiro+do+Norte&page=3";
    await flushAct(() => rerender());

    expect(result.current).toMatchObject({
      locationFilter: "Juazeiro do Norte",
      page: 3,
    });
    expect(latestListRequest()).toMatchObject({
      location: "Juazeiro do Norte",
      page: 3,
      limit: 12,
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("resets pagination for every list filter and clears all filters in one action", async () => {
    window.history.replaceState({}, "", "/trips");
    const { result, rerender } = await renderHook(() => useTrips());

    await flushAct(() => {
      result.current.setLocationFilter("Crato");
      result.current.setSearch("serra");
      result.current.setStatusFilter("active");
      result.current.setStorePublicationFilter("unpublished");
      result.current.setTypeFilter("excursao");
      result.current.setDateFilter("2026-09-15");
      result.current.setPage(5);
    });
    expect(result.current.page).toBe(5);
    routeState.search = "q=serra&location=Crato&status=active&storePublication=unpublished&type=excursao&date=2026-09-15&page=5";
    await flushAct(() => rerender());

    await flushAct(() => result.current.setLocationFilter("Fortaleza"));
    expect(result.current.page).toBe(1);
    await flushAct(() => result.current.setPage(4));
    await flushAct(() => result.current.setSearch("litoral"));
    expect(result.current.page).toBe(1);
    await flushAct(() => result.current.setPage(3));
    await flushAct(() => result.current.setStatusFilter("completed"));
    expect(result.current.page).toBe(1);

    routeState.search = "q=litoral&location=Fortaleza&status=completed&storePublication=unpublished&type=excursao&date=2026-09-15";
    await flushAct(() => rerender());
    await flushAct(() => {
      result.current.setPage(6);
      result.current.clearFilters();
    });

    expect(result.current).toMatchObject({
      search: "",
      locationFilter: "",
      statusFilter: "all",
      storePublicationFilter: "all",
      typeFilter: "all",
      dateFilter: "",
      page: 1,
      hasActiveFilters: false,
    });
    expect(latestListRequest()).toMatchObject({
      search: undefined,
      location: undefined,
      status: undefined,
      storePublication: undefined,
      type: undefined,
      date: undefined,
      page: 1,
    });
    expect(mockNavigate).toHaveBeenLastCalledWith("/trips", { replace: true });
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
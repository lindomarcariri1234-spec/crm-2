import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import {
  useListTrips, useCreateTrip, useDeleteTrip, useGetDashboardUpcomingTrips, useGetMe,
} from "@workspace/api-client-react";
import type { Trip } from "@workspace/api-client-react";
import { ROLES } from "@workspace/permissions";

const PAGE_SIZE = 12;
const EXPORT_BATCH_SIZE = 500;

type ExportTripsBatchHandler = (trips: Trip[]) => void;

interface TripFilters {
  search: string;
  statusFilter: string;
  typeFilter: string;
  dateFilter: string;
  page: number;
}

function parseTripFilters(searchStr: string): TripFilters {
  const params = new URLSearchParams(searchStr);
  return {
    search: params.get("q") ?? "",
    statusFilter: params.get("status") ?? "all",
    typeFilter: params.get("type") ?? "all",
    dateFilter: params.get("date") ?? "",
    page: parseInt(params.get("page") ?? "1") || 1,
  };
}

function tripFiltersMatch(left: TripFilters, right: TripFilters): boolean {
  return left.search === right.search
    && left.statusFilter === right.statusFilter
    && left.typeFilter === right.typeFilter
    && left.dateFilter === right.dateFilter
    && left.page === right.page;
}

function serializeTripFilters(filters: TripFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.statusFilter !== "all") params.set("status", filters.statusFilter);
  if (filters.typeFilter !== "all") params.set("type", filters.typeFilter);
  if (filters.dateFilter) params.set("date", filters.dateFilter);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params.toString();
}

export function useTrips() {
  const searchStr = useSearch();
  const [, navigate] = useLocation();

  const initialFiltersRef = useRef<TripFilters | null>(null);
  const initialFilters = initialFiltersRef.current ?? (initialFiltersRef.current = parseTripFilters(searchStr));
  const lastObservedSearchStrRef = useRef(searchStr);
  const pendingUrlFiltersRef = useRef<TripFilters | null>(null);

  const [search, setSearch] = useState(initialFilters.search);
  const [statusFilter, setStatusFilter] = useState(initialFilters.statusFilter);
  const [typeFilter, setTypeFilterState] = useState(initialFilters.typeFilter);
  const [dateFilter, setDateFilterState] = useState(initialFilters.dateFilter);
  const [page, setPage] = useState(initialFilters.page);
  const setTypeFilter = useCallback((value: string) => {
    setTypeFilterState(value);
    setPage(1);
  }, []);
  const setDateFilter = useCallback((value: string) => {
    setDateFilterState(value);
    setPage(1);
  }, []);

  useEffect(() => {
    const currentFilters = { search, statusFilter, typeFilter, dateFilter, page };

    if (lastObservedSearchStrRef.current !== searchStr) {
      lastObservedSearchStrRef.current = searchStr;
      const incomingFilters = parseTripFilters(searchStr);
      pendingUrlFiltersRef.current = incomingFilters;

      if (tripFiltersMatch(currentFilters, incomingFilters)) {
        pendingUrlFiltersRef.current = null;
        return;
      }

      setSearch(incomingFilters.search);
      setStatusFilter(incomingFilters.statusFilter);
      setTypeFilterState(incomingFilters.typeFilter);
      setDateFilterState(incomingFilters.dateFilter);
      setPage(incomingFilters.page);
      return;
    }

    const pendingUrlFilters = pendingUrlFiltersRef.current;
    if (pendingUrlFilters) {
      if (tripFiltersMatch(currentFilters, pendingUrlFilters)) {
        pendingUrlFiltersRef.current = null;
      }
      return;
    }

    const qs = serializeTripFilters(currentFilters);
    if (new URLSearchParams(searchStr).toString() === qs) return;
    navigate(qs ? `?${qs}` : window.location.pathname, { replace: true });
  }, [search, statusFilter, typeFilter, dateFilter, page, searchStr, navigate]);

  const hasActiveFilters = !!(search || statusFilter !== "all" || typeFilter !== "all" || dateFilter);

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setTypeFilter("all");
    setDateFilter("");
    setPage(1);
  };

  const { data: me } = useGetMe();
  const isVendedor = me?.role === ROLES.SALES;

  const { data: tripsData, isLoading, isError, error, refetch } = useListTrips({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
    date: dateFilter || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const createTrip = useCreateTrip();
  const deleteTrip = useDeleteTrip();
  const { data: upcomingTrips = [] } = useGetDashboardUpcomingTrips();

  const exportTrips = useCallback(async (onBatch: ExportTripsBatchHandler): Promise<number> => {
    const response = await fetch("/api/trips/export?format=ndjson", { credentials: "include" });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as
        | { error?: string; message?: string }
        | null;
      throw new Error(payload?.error ?? payload?.message ?? "Não foi possível preparar a exportação.");
    }

    if (!response.body) {
      throw new Error("O navegador não oferece suporte à exportação progressiva.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pendingLine = "";
    let batch: Trip[] = [];
    let total = 0;

    const processLine = (line: string) => {
      if (!line.trim()) return;
      const trip = JSON.parse(line) as Trip;
      batch.push(trip);
      total++;
      if (batch.length >= EXPORT_BATCH_SIZE) {
        onBatch(batch);
        batch = [];
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      pendingLine += decoder.decode(value, { stream: !done });
      const lines = pendingLine.split("\n");
      pendingLine = lines.pop() ?? "";
      for (const line of lines) processLine(line);
      if (done) break;
    }

    if (pendingLine) processLine(pendingLine);
    if (batch.length > 0) onBatch(batch);
    return total;
  }, []);

  const trips = tripsData?.data ?? [];

  const stats = useMemo(() => {
    const aggregate = tripsData?.stats;
    const totalCapacity = aggregate?.totalCapacity ?? 0;
    const occupiedSeats = aggregate?.occupiedSeats ?? 0;
    return {
      total: aggregate?.total ?? 0,
      active: aggregate?.active ?? 0,
      occupancyRate: totalCapacity > 0 ? Math.round(occupiedSeats / totalCapacity * 100) : 0,
      totalRevenue: aggregate?.totalRevenue ?? 0,
    };
  }, [tripsData?.stats]);

  const totalPages = Math.ceil((tripsData?.total ?? 0) / PAGE_SIZE);

  const handleDuplicate = async (trip: Trip) => {
    await createTrip.mutateAsync({
      data: {
        name: `${trip.name} (cópia)`,
        description: trip.description ?? undefined,
        destination: trip.destination,
        destinationCity: trip.destinationCity,
        destinationState: trip.destinationState,
        type: trip.type,
        category: trip.category,
        departureDate: trip.departureDate.split("T")[0],
        returnDate: trip.returnDate?.split("T")[0],
        totalCapacity: trip.totalCapacity,
        priceAdult: trip.priceAdult,
        priceChild: trip.priceChild ?? undefined,
        priceSenior: trip.priceSenior ?? undefined,
        inclusions: trip.inclusions,
        exclusions: trip.exclusions,
        seatLayout: trip.seatLayout ?? "2x2",
        vehicleType: trip.vehicleType ?? undefined,
        vehiclePlate: trip.vehiclePlate ?? undefined,
        driverName: trip.driverName ?? undefined,
        coverImage: trip.coverImage ?? undefined,
        boardingPoints: trip.boardingPoints ?? [],
        itinerary: trip.itinerary ?? undefined,
        fixedCosts: trip.fixedCosts ?? undefined,
        variableCosts: trip.variableCosts ?? undefined,
        gallery: trip.gallery ?? [],
      },
    });
    refetch();
  };

  const handleDelete = async (id: string) => {
    await deleteTrip.mutateAsync({ id });
    refetch();
  };

  return {
    trips, exportTrips, isLoading, isError, error, totalPages, upcomingTrips, stats, me, isVendedor,
    search, setSearch,
    statusFilter, setStatusFilter,
    typeFilter, setTypeFilter,
    dateFilter, setDateFilter,
    page, setPage,
    hasActiveFilters, clearFilters,
    refetch, deleteTrip,
    handleDuplicate, handleDelete,
  };
}

import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearch, useLocation } from "wouter";
import { parseISO } from "date-fns";
import {
  useListTrips, useCreateTrip, useDeleteTrip, useGetDashboardUpcomingTrips, useGetMe,
} from "@workspace/api-client-react";
import type { Trip } from "@workspace/api-client-react";
import { ROLES } from "@workspace/permissions";

const PAGE_SIZE = 12;
const EXPORT_BATCH_SIZE = 500;

type ExportTripsBatchHandler = (trips: Trip[]) => void;

export function useTrips() {
  const searchStr = useSearch();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState(() => new URLSearchParams(searchStr).get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState(() => new URLSearchParams(searchStr).get("status") ?? "all");
  const [typeFilter, setTypeFilter] = useState(() => new URLSearchParams(searchStr).get("type") ?? "all");
  const [dateFilter, setDateFilter] = useState(() => new URLSearchParams(searchStr).get("date") ?? "");
  const [page, setPage] = useState(() => parseInt(new URLSearchParams(searchStr).get("page") ?? "1") || 1);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (dateFilter) params.set("date", dateFilter);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    navigate(qs ? `?${qs}` : window.location.pathname, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, typeFilter, dateFilter, page]);

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

  const trips = useMemo(() => {
    let data = tripsData?.data ?? [];
    if (typeFilter !== "all") data = data.filter(t => t.type === typeFilter);
    if (dateFilter) {
      const from = new Date(dateFilter);
      data = data.filter(t => { try { return parseISO(t.departureDate) >= from; } catch { return true; } });
    }
    return data;
  }, [tripsData, typeFilter, dateFilter]);

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

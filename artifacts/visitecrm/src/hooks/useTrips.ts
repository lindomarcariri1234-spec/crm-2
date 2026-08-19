import { useState, useMemo, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { parseISO } from "date-fns";
import {
  useListTrips, useCreateTrip, useDeleteTrip, useGetDashboardUpcomingTrips, useGetMe,
} from "@workspace/api-client-react";
import type { Trip } from "@workspace/api-client-react";
import { ROLES, TRIP_STATUS } from "@workspace/permissions";

const PAGE_SIZE = 12;

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

  const { data: tripsData, isLoading, refetch } = useListTrips({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    page,
    limit: PAGE_SIZE,
  });

  const createTrip = useCreateTrip();
  const deleteTrip = useDeleteTrip();
  const { data: upcomingTrips = [] } = useGetDashboardUpcomingTrips();
  const { data: allTrips } = useListTrips({ limit: 100 });

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
    const all = allTrips?.data ?? [];
    const active = all.filter(t => t.status === TRIP_STATUS.ACTIVE || t.status === TRIP_STATUS.CONFIRMED);
    const totalSeats = active.reduce((acc, t) => acc + t.totalCapacity, 0);
    const occupiedSeats = active.reduce((acc, t) => acc + t.reservedSeats + t.confirmedSeats, 0);
    const totalRevenue = active.reduce((acc, t) => acc + (t.reservedSeats + t.confirmedSeats) * t.priceAdult, 0);
    return {
      total: all.length,
      active: active.length,
      occupancyRate: totalSeats > 0 ? Math.round(occupiedSeats / totalSeats * 100) : 0,
      totalRevenue,
    };
  }, [allTrips]);

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
    trips, isLoading, totalPages, upcomingTrips, stats, me, isVendedor,
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

import { useState, useMemo, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import {
  useListReservations, useGetReservationStats,
  useUpdateReservation, useCheckInReservation,
  useListTrips, useListUsers, useListBoardingLocations,
} from "@workspace/api-client-react";
import type { Reservation } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ROLES, RESERVATION_STATUS } from "@workspace/permissions";

export interface UseReservationsOptions {
  initialTripFilter?: string;
}

export function useReservations(options?: UseReservationsOptions) {
  const { toast } = useToast();
  const searchStr = useSearch();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState(() => new URLSearchParams(searchStr).get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState(() => new URLSearchParams(searchStr).get("status") ?? "");
  const [tripFilter, setTripFilter] = useState(() => new URLSearchParams(searchStr).get("trip") ?? options?.initialTripFilter ?? "");
  const [sellerFilter, setSellerFilter] = useState(() => new URLSearchParams(searchStr).get("seller") ?? "");
  const [dateFrom, setDateFrom] = useState(() => new URLSearchParams(searchStr).get("from") ?? "");
  const [dateTo, setDateTo] = useState(() => new URLSearchParams(searchStr).get("to") ?? "");
  const [hasAutoRetryFilter, setHasAutoRetryFilter] = useState(() => new URLSearchParams(searchStr).get("retry") === "1");
  const [page, setPage] = useState(() => parseInt(new URLSearchParams(searchStr).get("page") ?? "1") || 1);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (statusFilter) params.set("status", statusFilter);
    if (tripFilter) params.set("trip", tripFilter);
    if (sellerFilter) params.set("seller", sellerFilter);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (hasAutoRetryFilter) params.set("retry", "1");
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    navigate(qs ? `?${qs}` : window.location.pathname, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, tripFilter, sellerFilter, dateFrom, dateTo, hasAutoRetryFilter, page]);

  const hasActiveFilters = !!(search || statusFilter || tripFilter || sellerFilter || dateFrom || dateTo || hasAutoRetryFilter);

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setTripFilter("");
    setSellerFilter("");
    setDateFrom("");
    setDateTo("");
    setHasAutoRetryFilter(false);
    setPage(1);
  };

  const PAGE_SIZE = 20;

  const { data, isLoading, refetch } = useListReservations({
    status: statusFilter || undefined,
    tripId: tripFilter || undefined,
    search: search || undefined,
    createdById: sellerFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    hasAutoRetry: hasAutoRetryFilter || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const { data: stats, refetch: refetchStats } = useGetReservationStats();
  const { data: tripsData } = useListTrips({ limit: 100 });
  const { data: usersRaw } = useListUsers();
  const { data: boardingRaw } = useListBoardingLocations();

  const updateReservation = useUpdateReservation();
  const checkInReservation = useCheckInReservation();

  const sellers = useMemo(
    () => (usersRaw ?? []).filter(u => u.role === ROLES.SALES || u.role === ROLES.AGENCY_ADMIN),
    [usersRaw],
  );

  const boardingMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of (boardingRaw ?? [])) m[b.id] = b.name;
    return m;
  }, [boardingRaw]);

  const reservations = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleCheckin = async (r: Reservation) => {
    try {
      await checkInReservation.mutateAsync({ id: r.id });
      refetch();
      refetchStats();
    } catch {
      toast({ title: "Não foi possível confirmar o check-in", description: "Tente novamente ou contate o suporte.", variant: "destructive" });
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await updateReservation.mutateAsync({ id, data: { status: RESERVATION_STATUS.CANCELLED } });
      refetch();
      refetchStats();
    } catch {
      toast({ title: "Não foi possível cancelar a reserva", description: "Tente novamente ou contate o suporte.", variant: "destructive" });
    }
  };

  return {
    reservations, isLoading, total, totalPages, stats,
    tripsData, sellers, boardingMap,
    search, setSearch,
    statusFilter, setStatusFilter,
    tripFilter, setTripFilter,
    sellerFilter, setSellerFilter,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    hasAutoRetryFilter, setHasAutoRetryFilter,
    page, setPage,
    hasActiveFilters, clearFilters,
    refetch, refetchStats,
    handleCheckin, handleCancel,
  };
}

import { useState, useMemo, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useListTrips, useGetTrip, useListReservations, useUpdateReservation, useGetMe, useGetTenant } from "@workspace/api-client-react";
import { useSeatStream } from "@/hooks/useSeatStream";
import { RESERVATION_STATUS, TRIP_STATUS, hasPermission, RESOURCES, ACTIONS, type ReservationStatus } from "@workspace/permissions";
import { Client360Modal } from "@/components/client360-modal";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Bus, Edit, X, Check, Download, Send, Plus, DollarSign,
  List, UserRound, MapPin, ChevronDown, ClipboardCheck, AlertTriangle, ShoppingBag, Star,
} from "lucide-react";
import { STATUS_MAP } from "./constants";
import { formatCurrency, formatDate } from "./utils";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import type { FixedCostItem, VariableCostItem } from "./types";
import { PassengersOverviewFinancialDialog } from "./PassengersOverviewFinancialDialog";

interface TripFinancialReport {
  reservationCount: number;
  confirmedCount: number;
  pendingCount: number;
  cancelledCount: number;
  totalRevenue: number;
  totalPaid: number;
  totalPending: number;
  totalExpenses: number;
  netProfit: number;
  revenueByMethod: Record<string, number>;
  expensesByCategory: Record<string, number>;
}

export function PassengersOverview({ tripId: initialTripId }: { tripId: string }) {
  const [tripId, setTripId] = useState(initialTripId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStoreOrderId, setEditingStoreOrderId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ status: string; paymentMethod: string }>({ status: "", paymentMethod: "" });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [statusFilter, setStatusFilter] = useState("all");
  const [financialReportOpen, setFinancialReportOpen] = useState(false);
  const [client360Id, setClient360Id] = useState<string | null>(null);
  const [showCosts, setShowCosts] = useState(false);
  const [exportStatusFilter, setExportStatusFilterRaw] = useState(
    () => localStorage.getItem("passengersOverview:exportStatusFilter") ?? ""
  );
  const setExportStatusFilter = useCallback((v: string) => {
    localStorage.setItem("passengersOverview:exportStatusFilter", v);
    setExportStatusFilterRaw(v);
  }, []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkCancelling, setBulkCancelling] = useState(false);

  const { data: allTripsData } = useListTrips({ limit: 100 });
  const { data: trip } = useGetTrip(tripId, { query: { queryKey: ["/api/trips", tripId] } });
  const { data: reservations, refetch: refetchReservations } = useListReservations({ tripId, limit: 200 });
  const { eventCount: seatEventCount } = useSeatStream({ tripId, isPublic: false, enabled: !!tripId });
  useEffect(() => {
    if (seatEventCount === 0) return;
    void refetchReservations();
  }, [seatEventCount, refetchReservations]);
  const updateReservation = useUpdateReservation();
  const { data: me } = useGetMe();
  const tenantId = me?.tenantId ?? null;
  const { data: tenantData } = useGetTenant(tenantId ?? "", {
    query: { enabled: !!tenantId, queryKey: ["tenant", tenantId] },
  });
  const tenantSettings = ((tenantData as (typeof tenantData & { settings?: Record<string, unknown> }))?.settings ?? {}) as Record<string, unknown>;
  const seatMapEnabled = tenantSettings.seatMapEnabled !== false;
  const canViewFinancial = me ? hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.VIEW) : false;
  const { data: financialReport, isLoading: loadingReport } = useQuery<TripFinancialReport>({
    queryKey: ["trip-financial-report", tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/financial-report`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: financialReportOpen && !!tripId && canViewFinancial,
  });

  const filteredReservations = useMemo(() => {
    let data = reservations?.data ?? [];
    if (statusFilter !== "all") data = data.filter(r => r.status === statusFilter);
    return [...data].sort((a, b) => {
      let va: string | number = "";
      let vb: string | number = "";
      if (sort.key === "name") { va = a.client.name; vb = b.client.name; }
      else if (sort.key === "value") { va = a.totalValue; vb = b.totalValue; }
      else if (sort.key === "balance") { va = a.balance; vb = b.balance; }
      if (va < vb) return sort.dir === "asc" ? -1 : 1;
      if (va > vb) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [reservations, statusFilter, sort]);

  const stats = useMemo(() => {
    const all = reservations?.data ?? [];
    const confirmed = all.filter(r => r.status === RESERVATION_STATUS.CONFIRMED || r.status === RESERVATION_STATUS.COMPLETED);
    const pending = all.filter(r => r.status === RESERVATION_STATUS.PENDING);
    const freeCount = (Number(trip?.freeOrganizers) || 0) + (Number(trip?.freeGuides) || 0);
    const totalRevenue = all.reduce((acc, r) => acc + r.totalValue, 0);
    const amountReceived = all.reduce((acc, r) => acc + r.paidValue, 0);
    const amountPending = totalRevenue - amountReceived;
    const capacity = trip?.totalCapacity ?? 0;
    const occupancy = capacity > 0 ? Math.round((all.length + freeCount) / capacity * 100) : 0;
    const estimatedProfit = amountReceived - (trip?.priceAdult ? trip.priceAdult * 0.6 * all.length : 0);
    return { totalPassengers: all.length + freeCount, confirmed: confirmed.length + freeCount, confirmedPaying: confirmed.length, free: freeCount, pending: pending.length, totalRevenue, amountReceived, amountPending, occupancy, estimatedProfit };
  }, [reservations, trip]);

  const costSummary = useMemo(() => {
    const fixedItems = Array.isArray(trip?.fixedCosts)
      ? (trip.fixedCosts as unknown as FixedCostItem[])
      : [];
    const variableItems = Array.isArray(trip?.variableCosts)
      ? (trip.variableCosts as unknown as VariableCostItem[])
      : [];
    const capacity = trip?.totalCapacity ?? 0;
    const totalFixed = fixedItems.reduce((s, c) => s + c.value, 0);
    const totalVariablePax = variableItems.reduce((s, c) => s + c.valuePax, 0);
    const totalVariable = totalVariablePax * capacity;
    const totalCost = totalFixed + totalVariable;
    const costPerPax = capacity > 0 ? totalCost / capacity : 0;
    const grossRevenue = (trip?.priceAdult ?? 0) * capacity;
    const marginPct = grossRevenue > 0 ? Math.round(((grossRevenue - totalCost) / grossRevenue) * 100) : null;
    const hasCosts = fixedItems.length > 0 || variableItems.length > 0;
    return { fixedItems, variableItems, totalFixed, totalVariable, totalVariablePax, totalCost, costPerPax, marginPct, hasCosts };
  }, [trip]);

  const paymentMethodCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (reservations?.data ?? []).forEach(r => { const m = r.paymentMethod ?? "outro"; counts[m] = (counts[m] ?? 0) + 1; });
    return counts;
  }, [reservations]);

  const METHOD_LABELS = PAYMENT_METHOD_LABELS;

  const handlePassengersExport = () => {
    const a = document.createElement("a");
    const params = exportStatusFilter ? `?status=${exportStatusFilter}` : "";
    a.href = `/api/trips/${tripId}/passengers/export${params}`;
    a.download = "";
    a.click();
  };

  const toggleSort = (key: string) => setSort(prev => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }));

  const startEdit = (r: { id: string; status: string; paymentMethod?: string | null; storeOrderId?: string | null }) => {
    setEditingId(r.id);
    setEditingStoreOrderId(r.storeOrderId ?? null);
    setEditForm({ status: r.status, paymentMethod: r.paymentMethod ?? "" });
  };

  const doSaveEdit = async () => {
    if (!editingId) return;
    await updateReservation.mutateAsync({
      id: editingId,
      data: {
        status: editForm.status as ReservationStatus,
        paymentMethod: editForm.paymentMethod || undefined,
      },
    });
    setEditingId(null);
    setEditingStoreOrderId(null);
    setConfirmCancel(false);
    refetchReservations();
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (editForm.status === RESERVATION_STATUS.CANCELLED && editingStoreOrderId) {
      setConfirmCancel(true);
      return;
    }
    await doSaveEdit();
  };

  const STATUS_LABELS: Record<string, string> = {
    all: "Todos",
    [RESERVATION_STATUS.CONFIRMED]: "Confirmado",
    [RESERVATION_STATUS.PENDING]: "Pendente",
    [RESERVATION_STATUS.CANCELLED]: "Cancelado",
    [RESERVATION_STATUS.COMPLETED]: "Concluído",
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visible = filteredReservations.slice(0, 15).map(r => r.id);
    const allSelected = visible.every(id => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(prev => { const next = new Set(prev); visible.forEach(id => next.delete(id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); visible.forEach(id => next.add(id)); return next; });
    }
  };

  const selectedReservations = (reservations?.data ?? []).filter(r => selectedIds.has(r.id));
  const onlineOrderSelectedCount = selectedReservations.filter(r => r.storeOrderId).length;

  const doSaveBulkCancel = async () => {
    setBulkCancelling(true);
    try {
      await Promise.all(
        selectedReservations.map(r =>
          updateReservation.mutateAsync({ id: r.id, data: { status: RESERVATION_STATUS.CANCELLED } })
        )
      );
      setSelectedIds(new Set());
      setBulkCancelOpen(false);
      refetchReservations();
    } finally {
      setBulkCancelling(false);
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => history.back()}><ArrowLeft className="w-4 h-4" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Visão Geral de Passageiros</h1>
          <p className="text-muted-foreground text-sm">
            {trip?.name}
            {trip && (
              <>
                {" · "}
                {formatDate(trip.departureDate)}{trip.departureTime ? ` às ${trip.departureTime}` : ""}
                {trip.returnDate && (
                  <> — {formatDate(trip.returnDate)}{trip.returnTime ? ` às ${trip.returnTime}` : ""}</>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={tripId} onValueChange={v => setTripId(v)}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Selecionar viagem" />
            </SelectTrigger>
            <SelectContent>
              {(allTripsData?.data ?? []).map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={exportStatusFilter === "" ? "active" : exportStatusFilter}
            onValueChange={v => setExportStatusFilter(v === "active" ? "" : v)}
          >
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Ativos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value={RESERVATION_STATUS.CONFIRMED}>Confirmados</SelectItem>
              <SelectItem value={RESERVATION_STATUS.PENDING}>Pendentes</SelectItem>
              <SelectItem value={RESERVATION_STATUS.COMPLETED}>Concluídos</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handlePassengersExport} disabled={!tripId}><Download className="w-4 h-4 mr-2" />Exportar Passageiros</Button>
          <Link href={`/trips/${tripId}/passengers`}><Button variant="outline"><List className="w-4 h-4 mr-2" />Lista ANTT</Button></Link>
          {seatMapEnabled && <Link href={`/trips/${tripId}/seat-map`}><Button variant="outline"><Bus className="w-4 h-4 mr-2" />Mapa de Assentos</Button></Link>}
          <Link href={`/trips/${tripId}/checkin-panel`}><Button variant="outline" className="border-green-300 text-green-700 hover:bg-green-50"><ClipboardCheck className="w-4 h-4 mr-2" />Check-in ao Vivo</Button></Link>
          {trip && trip.status !== TRIP_STATUS.CANCELLED && trip.status !== TRIP_STATUS.DRAFT && (
            <Link href={`/trips/${tripId}/boarding-control`}><Button className="bg-blue-700 hover:bg-blue-800 text-white gap-2"><Bus className="w-4 h-4" />Central de Embarque</Button></Link>
          )}
          <Link href={`/trips/${tripId}/nps`}><Button variant="outline"><Star className="w-4 h-4 mr-2" />NPS</Button></Link>
          <Link href={`/trips/${tripId}/edit`}><Button variant="outline"><Edit className="w-4 h-4 mr-2" />Editar Viagem</Button></Link>
        </div>
      </div>

      {trip && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">Status da viagem:</span>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_MAP[trip.status]?.color ?? "bg-gray-100 text-gray-600"}`}>{STATUS_MAP[trip.status]?.label ?? trip.status}</span>
          {(trip.originCity || trip.originState) && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-blue-500" />
              <span>Saída de <strong className="text-blue-600">{[trip.originCity, trip.originState].filter(Boolean).join(", ")}</strong></span>
            </span>
          )}
          {(trip.departureTime || trip.returnTime) && (
            <span className="text-sm text-muted-foreground">
              {trip.departureTime && <>Partida: <strong>{trip.departureTime}</strong></>}
              {trip.departureTime && trip.returnTime && <> · </>}
              {trip.returnTime && <>Volta: <strong>{trip.returnTime}</strong></>}
            </span>
          )}
          {trip.driverName && <span className="text-sm text-muted-foreground">Motorista: <strong>{trip.driverName}</strong></span>}
          {trip.tourGuide && <span className="text-sm text-muted-foreground">Guia Turístico: <strong>{trip.tourGuide}</strong></span>}
          {trip.tripOrganizer && <span className="text-sm text-muted-foreground">Responsável: <strong>{trip.tripOrganizer}</strong></span>}
          {trip.vehicleType && <span className="text-sm text-muted-foreground">Veículo: <strong>{trip.vehicleType}</strong></span>}
          {trip.vehiclePlate && <span className="text-sm text-muted-foreground">Placa: <strong>{trip.vehiclePlate}</strong></span>}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: "Passageiros Confirmados", value: stats.confirmed, sub: `de ${trip?.totalCapacity ?? 0} assentos`, color: "text-green-600" },
          { label: "Reservas Pendentes", value: stats.pending, sub: "aguardando confirmação", color: "text-amber-600" },
          { label: "Receita Total", value: formatCurrency(stats.totalRevenue), sub: "valor das reservas", color: "text-blue-600" },
          { label: "A Receber", value: formatCurrency(stats.amountPending), sub: "saldo em aberto", color: "text-red-600" },
          { label: "Ocupação do Ônibus", value: `${stats.occupancy}%`, sub: "taxa de ocupação", color: "text-purple-600" },
          { label: "Lucro Estimado", value: formatCurrency(stats.estimatedProfit), sub: "receita recebida — custo estimado (60%)", color: "text-indigo-600" },
        ].map(s => (
          <div key={s.label} className="bg-card border rounded-lg p-4">
            <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {costSummary.hasCosts && (
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold">Resumo de Custos</h3>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowCosts(v => !v)} className="text-xs text-muted-foreground h-7">
              {showCosts ? "Ocultar detalhes" : "Ver detalhes"}
              <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform ${showCosts ? "rotate-180" : ""}`} />
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            {[
              { label: "Custos Fixos", value: formatCurrency(costSummary.totalFixed), color: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
              { label: `Custos Variáveis (${trip?.totalCapacity ?? 0} pax)`, value: formatCurrency(costSummary.totalVariable), color: "bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800" },
              { label: "Custo Total", value: formatCurrency(costSummary.totalCost), color: "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800" },
              { label: "Custo por Passageiro", value: formatCurrency(costSummary.costPerPax), color: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
              ...(costSummary.marginPct !== null ? [{ label: "Margem Estimada", value: `${costSummary.marginPct}%`, color: costSummary.marginPct >= 0 ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800" }] : []),
            ].map(chip => (
              <div key={chip.label} className={`flex flex-col px-4 py-2.5 rounded-lg border text-sm ${chip.color}`}>
                <span className="text-xs opacity-70 mb-0.5">{chip.label}</span>
                <span className="font-semibold text-base">{chip.value}</span>
              </div>
            ))}
          </div>

          {showCosts && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Custos Fixos</p>
                {costSummary.fixedItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nenhum custo fixo cadastrado</p>
                ) : (
                  <div className="space-y-1">
                    {costSummary.fixedItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-muted/30">
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-muted-foreground mr-2">{item.category}</span>
                          <span className="truncate">{item.description}</span>
                        </div>
                        <span className="font-medium shrink-0 ml-3">{formatCurrency(item.value)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs font-semibold pt-1 border-t px-2">
                      <span>Total Fixo</span>
                      <span>{formatCurrency(costSummary.totalFixed)}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Custos Variáveis</p>
                {costSummary.variableItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nenhum custo variável cadastrado</p>
                ) : (
                  <div className="space-y-1">
                    {costSummary.variableItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-muted/30">
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-muted-foreground mr-2">{item.category}</span>
                          <span className="truncate">{item.description}</span>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <span className="text-muted-foreground text-xs block">{formatCurrency(item.valuePax)}/pax</span>
                          <span className="font-medium">{formatCurrency(item.valuePax * (trip?.totalCapacity ?? 0))}</span>
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs font-semibold pt-1 border-t px-2">
                      <span>Total Variável ({trip?.totalCapacity ?? 0} pax)</span>
                      <span>{formatCurrency(costSummary.totalVariable)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Reservas por Status</h3>
          <div className="space-y-3">
            {[RESERVATION_STATUS.CONFIRMED, RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.COMPLETED].map(s => {
              const count = (reservations?.data ?? []).filter(r => r.status === s).length;
              const total = reservations?.total ?? 0;
              const pct = total > 0 ? Math.round(count / total * 100) : 0;
              const colors: Record<string, string> = {
                [RESERVATION_STATUS.CONFIRMED]: "bg-green-500",
                [RESERVATION_STATUS.PENDING]: "bg-amber-500",
                [RESERVATION_STATUS.CANCELLED]: "bg-red-500",
                [RESERVATION_STATUS.COMPLETED]: "bg-blue-500",
              };
              const labels: Record<string, string> = {
                [RESERVATION_STATUS.CONFIRMED]: "Confirmado",
                [RESERVATION_STATUS.PENDING]: "Pendente",
                [RESERVATION_STATUS.CANCELLED]: "Cancelado",
                [RESERVATION_STATUS.COMPLETED]: "Concluído",
              };
              return (
                <div key={s} className="space-y-1">
                  <div className="flex justify-between text-sm"><span>{labels[s] ?? s}</span><span className="font-medium">{count} ({pct}%)</span></div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${colors[s] ?? "bg-gray-400"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Forma de Pagamento</h3>
          <div className="space-y-3">
            {Object.entries(paymentMethodCounts).map(([method, count]) => {
              const total = reservations?.total ?? 0;
              const pct = total > 0 ? Math.round(count / total * 100) : 0;
              return (
                <div key={method} className="flex items-center gap-3 text-sm">
                  <span className="w-32 text-muted-foreground truncate">{METHOD_LABELS[method] ?? method}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="font-medium w-10 text-right">{pct}%</span>
                  <span className="text-muted-foreground w-6 text-right">{count}</span>
                </div>
              );
            })}
            {!Object.keys(paymentMethodCounts).length && <p className="text-sm text-muted-foreground">Sem dados de pagamento</p>}
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold">Lista de Reservas</h3>
          <div className="flex gap-2 flex-wrap items-center">
            {selectedIds.size > 0 && (
              <Button
                variant="destructive" size="sm"
                onClick={() => setBulkCancelOpen(true)}
              >
                <X className="w-4 h-4 mr-1" />Cancelar Selecionados ({selectedIds.size})
              </Button>
            )}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />Exportar</Button>
            <Button variant="outline" size="sm"><Send className="w-4 h-4 mr-2" />WhatsApp</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="p-2 w-8">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-primary"
                    checked={filteredReservations.slice(0, 15).length > 0 && filteredReservations.slice(0, 15).every(r => selectedIds.has(r.id))}
                    onChange={toggleSelectAll}
                    aria-label="Selecionar todos"
                  />
                </th>
                {[
                  { key: "name", label: "Passageiro" },
                  { key: "voucher", label: "Nº Reserva" },
                  { key: "seats", label: "Assento(s)" },
                  { key: "status", label: "Status" },
                  { key: "payment", label: "Pagamento" },
                  { key: "value", label: "Valor" },
                  { key: "balance", label: "Saldo" },
                  { key: "actions", label: "" },
                ].map(col => (
                  <th key={col.key} className={`text-left p-2 font-medium ${["name","value","balance","status"].includes(col.key) ? "cursor-pointer hover:text-primary" : ""}`}
                    onClick={() => ["name","value","balance","status"].includes(col.key) ? toggleSort(col.key) : undefined}>
                    {col.label} {sort.key === col.key ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredReservations.slice(0, 15).map(r => {
                const isEditing = editingId === r.id;
                const isSelected = selectedIds.has(r.id);
                return (
                  <tr key={r.id} className={`border-b ${isEditing ? "bg-primary/5" : isSelected ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                    <td className="p-2">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-primary"
                        checked={isSelected}
                        onChange={() => toggleSelect(r.id)}
                        aria-label={`Selecionar ${r.client.name}`}
                      />
                    </td>
                    <td className="p-2 font-medium">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button className="hover:underline text-left" onClick={() => setClient360Id(r.client.id)}>{r.client.name}</button>
                        {r.storeOrderId && (
                          <span title={`Pedido online: #${r.storeOrderId}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 text-xs font-medium cursor-default">
                            <ShoppingBag className="w-3 h-3" />Loja
                          </span>
                        )}
                        {(() => {
                          type CT = { reservationId: string; tripName: string; departureDate: string; returnDate: string | null };
                          const conflicts = (r as { conflictingTrips?: CT[] }).conflictingTrips ?? [];
                          if (!conflicts.length) return null;
                          const title = `Reserva em outra viagem no mesmo período:\n${conflicts.map(c => `• ${c.tripName} (${new Date(c.departureDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}${c.returnDate ? ` – ${new Date(c.returnDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""})`).join("\n")}`;
                          return (
                            <span title={title} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 text-xs font-medium cursor-help">
                              <AlertTriangle className="w-3 h-3" />Período conflitante
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="p-2"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{r.reservationNumber ?? r.voucherCode}</code></td>
                    <td className="p-2">{r.seats.join(", ") || "—"}</td>
                    <td className="p-2">
                      {isEditing ? (
                        <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                          <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED, RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.COMPLETED].map(s => (
                              <SelectItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.status === RESERVATION_STATUS.CONFIRMED ? "bg-green-100 text-green-700" : r.status === RESERVATION_STATUS.PENDING ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"}`}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {isEditing ? (
                        <Select value={editForm.paymentMethod} onValueChange={v => setEditForm(f => ({ ...f, paymentMethod: v }))}>
                          <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Pagamento" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pix">PIX</SelectItem>
                            <SelectItem value="credit_card">Cartão Crédito</SelectItem>
                            <SelectItem value="debit_card">Cartão Débito</SelectItem>
                            <SelectItem value="cash">Dinheiro</SelectItem>
                            <SelectItem value="bank_transfer">Transferência</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">{METHOD_LABELS[r.paymentMethod ?? ""] ?? r.paymentMethod ?? "—"}</span>
                      )}
                    </td>
                    <td className="p-2 font-medium">
                      {(() => {
                        const discount = (r as { discountTotal?: number | null }).discountTotal ?? 0;
                        if (discount > 0) {
                          return (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-muted-foreground line-through">{formatCurrency(r.totalValue + discount)}</span>
                              <span>{formatCurrency(r.totalValue)}</span>
                            </div>
                          );
                        }
                        return formatCurrency(r.totalValue);
                      })()}
                    </td>
                    <td className={`p-2 font-medium ${r.balance > 0 ? "text-red-600" : "text-green-600"}`}>{formatCurrency(r.balance)}</td>
                    <td className="p-2">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <Button size="icon" variant="default" className="h-6 w-6" onClick={saveEdit} disabled={updateReservation.isPending}><Check className="w-3 h-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingId(null)}><X className="w-3 h-3" /></Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 px-2" onClick={() => setClient360Id(r.client.id)}>
                            <UserRound className="w-3 h-3" /> Perfil 360°
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(r)} title="Editar"><Edit className="w-3 h-3" /></Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!filteredReservations.length && <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">Sem reservas</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Origem dos Clientes</h3>
          <span className="text-xs text-muted-foreground">Campo origem disponível ao cadastrar o cliente</span>
        </div>
        {(reservations?.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Sem reservas para exibir dados de origem</p>
        ) : (
          <div className="space-y-2">
            {(() => {
              const origins: Record<string, number> = {};
              (reservations?.data ?? []).forEach(r => {
                const src = (r.client as Record<string, unknown>).referralSource as string | undefined;
                const key = src ?? "Não informado";
                origins[key] = (origins[key] ?? 0) + 1;
              });
              const total = (reservations?.data ?? []).length;
              const colors = ["bg-blue-500", "bg-green-500", "bg-yellow-500", "bg-purple-500", "bg-gray-400"];
              return Object.entries(origins).slice(0, 5).map(([key, count], i) => {
                const pct = Math.round(count / total * 100);
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-sm"><span>{key}</span><span className="font-medium">{count} ({pct}%)</span></div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${colors[i % colors.length]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>

      <div className="bg-card border rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-sm">Ações Rápidas</h3>
        <div className="flex flex-wrap gap-2">
          <Link href={`/reservations?tripId=${tripId}&new=true`}><Button><Plus className="w-4 h-4 mr-2" />Adicionar Passageiro</Button></Link>
          <Button variant="outline"><Download className="w-4 h-4 mr-2" />Exportar PDF</Button>
          <Button variant="outline"><Send className="w-4 h-4 mr-2" />Enviar WhatsApp</Button>
          {canViewFinancial && (
            <Button variant="outline" onClick={() => setFinancialReportOpen(true)}>
              <DollarSign className="w-4 h-4 mr-2" />Relatório Financeiro
            </Button>
          )}
          <Button variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10"><X className="w-4 h-4 mr-2" />Encerrar Viagem</Button>
        </div>
      </div>

      {canViewFinancial && (
        <PassengersOverviewFinancialDialog
          open={financialReportOpen} onClose={setFinancialReportOpen}
          loadingReport={loadingReport} financialReport={financialReport as never}
          tripName={trip?.name}
        />
      )}
      <Client360Modal open={!!client360Id} onClose={() => setClient360Id(null)} clientId={client360Id} />

      <AlertDialog open={bulkCancelOpen} onOpenChange={o => { if (!o) setBulkCancelOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar {selectedIds.size} Reserva{selectedIds.size !== 1 ? "s" : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              Você está prestes a cancelar {selectedIds.size} reserva{selectedIds.size !== 1 ? "s" : ""}. As vagas serão devolvidas para a viagem. Esta ação não pode ser desfeita facilmente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {onlineOrderSelectedCount > 0 && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p>
                {onlineOrderSelectedCount === 1
                  ? "1 das reservas selecionadas veio de um pedido online. Cancelá-la também encerrará o pedido do cliente na loja."
                  : `${onlineOrderSelectedCount} das reservas selecionadas vieram de pedidos online. Cancelá-las também encerrará os pedidos dos clientes na loja.`}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setBulkCancelOpen(false)}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={doSaveBulkCancel}
              disabled={bulkCancelling}
            >
              {bulkCancelling ? "Cancelando..." : "Confirmar Cancelamento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCancel} onOpenChange={o => { if (!o) setConfirmCancel(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar Reserva</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja cancelar esta reserva? As vagas serão devolvidas para a viagem. Esta ação não pode ser desfeita facilmente.</AlertDialogDescription>
          </AlertDialogHeader>
          {editingStoreOrderId && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p>Esta reserva veio de um pedido online. Cancelá-la também encerrará o pedido do cliente na loja.</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmCancel(false)}>Voltar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doSaveEdit} disabled={updateReservation.isPending}>
              Confirmar Cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

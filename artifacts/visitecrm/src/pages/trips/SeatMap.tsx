import { useState, useMemo, useEffect } from "react";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useSeatStream } from "@/hooks/useSeatStream";
import {
  useListTrips, useGetTrip, useGetTripSeatMap, getGetTripSeatMapQueryKey,
  useListReservations, getListReservationsQueryKey, useListClients, useCreateReservation, useCreateClient,
  useRegenerateTripSeatMap, useGetCurrentSubscription, useGetMe, useGetTenant,
} from "@workspace/api-client-react";
import type { Seat } from "@workspace/api-client-react";
import { PlanFeatureWall, canUpgradeForFeature } from "@/components/plan-limit-wall";
import { getSeatColor, getCellIcon } from "@/components/SeatMapPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, Search, Users, AlertCircle, Download, RefreshCw } from "lucide-react";

export function SeatMap({ tripId: initialTripId }: { tripId: string }) {
  const [, navigate] = useLocation();
  const [tripId, setTripId] = useState(initialTripId);
  const [selectedSeat, setSelectedSeat] = useState<Seat | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [assignMode, setAssignMode] = useState<"search" | "manual">("search");
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualCpf, setManualCpf] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [optimisticSeats, setOptimisticSeats] = useState<Record<string, string>>({});
  const [showRenumberDialog, setShowRenumberDialog] = useState(false);
  const [isRenumbering, setIsRenumbering] = useState(false);
  const [renumberError, setRenumberError] = useState<string | null>(null);
  const [isDryRunLoading, setIsDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{ changes: { oldNumber: string; newNumber: string }[]; preserved: string[] } | null>(null);
  const [exportStatusFilter, setExportStatusFilter] = useState("");
  const [isSyncingCounters, setIsSyncingCounters] = useState(false);
  const [syncCountersError, setSyncCountersError] = useState<string | null>(null);
  const regenerateSeatMap = useRegenerateTripSeatMap();

  const { data: subData } = useGetCurrentSubscription();
  const { data: me } = useGetMe();
  const tenantId = me?.tenantId ?? null;
  const { data: tenantData } = useGetTenant(tenantId ?? "", {
    query: { enabled: !!tenantId, queryKey: ["tenant", tenantId] },
  });
  const tenantSettings = ((tenantData as (typeof tenantData & { settings?: Record<string, unknown> }))?.settings ?? {}) as Record<string, unknown>;
  const { data: allTripsData } = useListTrips({ limit: 100 });
  const { data: trip } = useGetTrip(tripId, { query: { queryKey: ["/api/trips", tripId] } });
  const queryClient = useQueryClient();
  const { data: seatMap, dataUpdatedAt } = useGetTripSeatMap(tripId, {
    query: { queryKey: getGetTripSeatMapQueryKey(tripId), refetchInterval: 30000 },
  });

  const { eventCount: seatEventCount } = useSeatStream({
    tripId,
    isPublic: false,
    enabled: !!tripId,
  });

  useEffect(() => {
    if (seatEventCount === 0) return;
    queryClient.invalidateQueries({ queryKey: getGetTripSeatMapQueryKey(tripId) });
    queryClient.invalidateQueries({ queryKey: getListReservationsQueryKey({ tripId }) });
  }, [seatEventCount, tripId, queryClient]);

  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((v) => v + 1), 60000);
    return () => window.clearInterval(id);
  }, []);
  const lastUpdatedMinutes = Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 60000));
  void nowTick;

  const { data: reservations } = useListReservations({ tripId });
  const { data: clientsData } = useListClients({ search: clientSearch || undefined, limit: 8 });
  const createReservation = useCreateReservation();
  const createClient = useCreateClient();

  const seats = useMemo(() => {
    if (!seatMap?.seats) return [];
    return [...seatMap.seats].sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });
  }, [seatMap]);

  const maxRow = useMemo(() => Math.max(...seats.map(s => s.row), 0), [seats]);
  const maxCol = useMemo(() => Math.max(...seats.map(s => s.col), 4), [seats]);
  const aisleAfterCol = Math.ceil(maxCol / 2);

  const seatCounts = useMemo(() => {
    const statusList = seats.map(s => optimisticSeats[s.number] ?? s.status);
    return {
      available: statusList.filter(st => st === "available").length,
      reserved: statusList.filter(st => st === "reserved" || st === "occupied").length,
      confirmed: statusList.filter(st => st === RESERVATION_STATUS.CONFIRMED).length,
      free: statusList.filter(st => st === "free").length,
      blocked: statusList.filter(st => st === "blocked").length,
    };
  }, [seats, optimisticSeats]);

  const freePassengerNames = useMemo(() => {
    return seats
      .filter(s => (optimisticSeats[s.number] ?? s.status) === "free")
      .map(s => ({ number: s.number, name: (s as Seat & { occupantName?: string | null }).occupantName ?? null }))
      .filter(fp => fp.name);
  }, [seats, optimisticSeats]);

  const getEffectiveStatus = (seat: Seat) => optimisticSeats[seat.number] ?? seat.status;

  const handleSeatClick = (seat: Seat) => {
    if (getEffectiveStatus(seat) !== "available") return;
    setSelectedSeat(seat);
    setAssignMode("search");
    setClientSearch("");
    setSelectedClientId(null);
    setManualName(""); setManualCpf(""); setManualPhone(""); setManualEmail("");
    setAssignError(null);
    setShowModal(true);
  };

  const handleAssign = async () => {
    if (!selectedSeat) return;
    setAssignError(null);
    setIsSaving(true);
    try {
      if (assignMode === "search") {
        if (!selectedClientId) { setAssignError("Selecione um cliente para continuar."); setIsSaving(false); return; }
        await createReservation.mutateAsync({
          data: {
            tripId,
            clientId: selectedClientId,
            seats: [selectedSeat.number],
            totalValue: trip?.priceAdult ?? 0,
            installments: 1,
          },
        });
        setOptimisticSeats(prev => ({ ...prev, [selectedSeat.number]: "reserved" }));
        setShowModal(false);
        setSelectedSeat(null);
      } else {
        if (!manualName) { setAssignError("Informe o nome do passageiro."); setIsSaving(false); return; }
        if (!manualEmail) { setAssignError("Informe o e-mail do passageiro."); setIsSaving(false); return; }
        const newClient = await createClient.mutateAsync({
          data: {
            name: manualName,
            email: manualEmail,
            whatsapp: manualPhone || "00000000000",
            cpf: manualCpf || "",
            allowMissingData: true,
          },
        });
        await createReservation.mutateAsync({
          data: {
            tripId,
            clientId: newClient.id,
            seats: [selectedSeat.number],
            totalValue: trip?.priceAdult ?? 0,
            installments: 1,
          },
        });
        setOptimisticSeats(prev => ({ ...prev, [selectedSeat.number]: "reserved" }));
        setShowModal(false);
        setSelectedSeat(null);
      }
    } catch (err: unknown) {
      const errCode = (err as { data?: { code?: string } })?.data?.code;
      if (errCode === "DUPLICATE_RESERVATION") {
        setAssignError("Este cliente já possui uma reserva ativa nesta viagem. Cancele a reserva existente antes de criar uma nova.");
      } else {
        setAssignError("Erro ao salvar reserva. Tente novamente.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const selectedClient = clientsData?.data?.find(c => c.id === selectedClientId);

  const handlePassengersExport = () => {
    const a = document.createElement("a");
    const params = exportStatusFilter ? `?status=${exportStatusFilter}` : "";
    a.href = `/api/trips/${tripId}/passengers/export${params}`;
    a.download = "";
    a.click();
  };

  const isBrazilianLayout = seatMap?.numberingType?.includes("brazilian");

  const pendingSeatCount = useMemo(() => {
    return seats.filter(s => {
      const eff = optimisticSeats[s.number] ?? s.status;
      return eff === "reserved" || eff === "occupied";
    }).length;
  }, [seats, optimisticSeats]);

  const confirmedSeatCount = useMemo(() => {
    return seats.filter(s => {
      const eff = optimisticSeats[s.number] ?? s.status;
      return eff === RESERVATION_STATUS.CONFIRMED;
    }).length;
  }, [seats, optimisticSeats]);

  const handleOpenRenumberDialog = async () => {
    setRenumberError(null);
    setDryRunResult(null);
    setIsDryRunLoading(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/regenerate-seat-map?dryRun=true`, { method: "POST" });
      if (!res.ok) throw new Error("Erro ao carregar prévia.");
      const data = await res.json() as { changes: { oldNumber: string; newNumber: string }[]; preserved: string[] };
      setDryRunResult(data);
    } catch {
      setRenumberError("Erro ao carregar prévia da renumeração.");
    } finally {
      setIsDryRunLoading(false);
    }
    setShowRenumberDialog(true);
  };

  const handleRenumber = async () => {
    setIsRenumbering(true);
    setRenumberError(null);
    try {
      await regenerateSeatMap.mutateAsync({ id: tripId });
      await queryClient.invalidateQueries({ queryKey: getGetTripSeatMapQueryKey(tripId) });
      setOptimisticSeats({});
      setDryRunResult(null);
      setShowRenumberDialog(false);
    } catch {
      setRenumberError("Erro ao renumerar. Tente novamente.");
    } finally {
      setIsRenumbering(false);
    }
  };

  const handleSyncCounters = async () => {
    setIsSyncingCounters(true);
    setSyncCountersError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/sync-seat-counters`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Erro ao sincronizar contadores.");
      }
      await queryClient.invalidateQueries({ queryKey: getGetTripSeatMapQueryKey(tripId) });
      await queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId] });
    } catch (e) {
      setSyncCountersError((e as Error).message || "Erro ao sincronizar contadores.");
    } finally {
      setIsSyncingCounters(false);
    }
  };

  const seatMapLocked = subData !== undefined &&
    !(subData.plan?.supportedFeatures ?? []).includes("seatMap");

  if (seatMapLocked) {
    return (
      <PlanFeatureWall
        featureLabel="Mapa de assentos"
        canUpgrade={canUpgradeForFeature(subData, "seatMap")}
      />
    );
  }

  if (tenantSettings.seatMapEnabled === false) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <AlertCircle className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Mapa de assentos desabilitado</h2>
        <p className="text-muted-foreground max-w-sm">
          O mapa de assentos está desabilitado nas configurações da agência.
        </p>
        <Link href="/configuracoes">
          <Button variant="outline">Ir para Configurações</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate("/trips")}><ArrowLeft className="w-4 h-4" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Mapa de Assentos</h1>
          <p className="text-muted-foreground text-sm">{trip?.name}</p>
        </div>
        <Badge variant="outline" className="text-xs">
          {lastUpdatedMinutes < 1 ? "Atualizado agora" : `Atualizado há ${lastUpdatedMinutes} min`}
        </Badge>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={tripId} onValueChange={v => { setTripId(v); setOptimisticSeats({}); }}>
            <SelectTrigger className="w-56">
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
          {isBrazilianLayout && (
            <Button variant="outline" onClick={handleOpenRenumberDialog} disabled={!tripId || isDryRunLoading}>
              <RefreshCw className={`w-4 h-4 mr-2${isDryRunLoading ? " animate-spin" : ""}`} />🇧🇷 Renumerar (Padrão Brasileiro)
            </Button>
          )}
          <Button variant="outline" onClick={handleSyncCounters} disabled={!tripId || isSyncingCounters}>
            <RefreshCw className={`w-4 h-4 mr-2${isSyncingCounters ? " animate-spin" : ""}`} />Sincronizar Contadores
          </Button>
          <Link href={`/trips/${tripId}/passengers`}><Button variant="outline"><Users className="w-4 h-4 mr-2" />Lista ANTT</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <div className="bg-card border rounded-xl p-6 space-y-6">
            <div className="flex items-center justify-between text-sm">
              <span>Layout: <strong>{seatMap?.layout === "2x1" ? "2x1 Premium" : "2x2 Padrão"}</strong></span>
              <span className="text-muted-foreground">{seatMap?.totalSeats ?? 0} assentos no total</span>
            </div>

            <div className="bg-gray-800 text-white text-center py-3 rounded-lg text-sm font-medium">FRENTE DO ONIBUS</div>

            <div className="space-y-2 max-w-xs mx-auto">
              {Array.from({ length: maxRow }).map((_, rowIdx) => {
                const rowNum = rowIdx + 1;
                const rowSeats = seats.filter(s => s.row === rowNum);
                const leftSeats = rowSeats.filter(s => s.col <= aisleAfterCol);
                const rightSeats = rowSeats.filter(s => s.col > aisleAfterCol);

                const renderSeat = (seat: Seat) => {
                  const seatType = (seat as Seat & { type?: string }).type;
                  const isNonSeat = ["wc", "stairs", "fridge", "blocked", "empty"].includes(seatType ?? "");
                  const effectiveStatus = getEffectiveStatus(seat);
                  const cellClass = `w-10 h-10 rounded-md text-xs font-bold flex items-center justify-center transition-all ${getSeatColor(effectiveStatus, false, seatType)}`;
                  if (isNonSeat) {
                    const labels: Record<string, string> = { wc: "Banheiro", stairs: "Escada", fridge: "Frigobar", blocked: "Bloqueado", empty: "" };
                    return (
                      <div key={seat.number} className={cellClass} title={labels[seatType ?? ""] ?? seatType ?? ""} aria-label={labels[seatType ?? ""] ?? seatType ?? ""}>
                        {getCellIcon(seatType)}
                      </div>
                    );
                  }
                  const isFree = effectiveStatus === "free";
                  const occupantName = isFree ? (seat as Seat & { occupantName?: string | null }).occupantName : undefined;
                  const tooltipText = isFree
                    ? `Assento ${seat.number} — Gratuidade${occupantName ? `: ${occupantName}` : ""}`
                    : `Assento ${seat.number} (${seatType ?? "padrão"}) — ${effectiveStatus}`;
                  const seatButton = (
                    <button
                      className={`${cellClass} relative`}
                      onClick={() => handleSeatClick(seat)}
                      title={tooltipText}
                      disabled={effectiveStatus !== "available"}
                    >
                      {getCellIcon(seatType, seat.number)}
                      {isFree && (
                        <span
                          className="absolute -top-1.5 -right-1.5 bg-white text-violet-700 text-[8px] font-black leading-none rounded-full w-4 h-4 flex items-center justify-center border border-violet-400 shadow-sm pointer-events-none"
                          aria-hidden="true"
                        >Grat</span>
                      )}
                    </button>
                  );
                  if (isFree && occupantName) {
                    return (
                      <div key={seat.number} className="flex flex-col items-center gap-0.5">
                        {seatButton}
                        <span className="text-[7px] text-violet-700 font-semibold leading-none max-w-10 truncate" title={occupantName}>
                          {occupantName.split(" ")[0]}
                        </span>
                      </div>
                    );
                  }
                  return <div key={seat.number}>{seatButton}</div>;
                };

                return (
                  <div key={rowNum} className="flex items-center gap-2 justify-center">
                    <div className="flex gap-1">{leftSeats.map(renderSeat)}</div>
                    <div className="w-5 text-center text-xs text-muted-foreground shrink-0">|</div>
                    <div className="flex gap-1">{rightSeats.map(renderSeat)}</div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-3 justify-center text-xs flex-wrap">
              {[
                { color: "bg-white border-2 border-gray-200", label: "Disponível" },
                { color: "bg-yellow-50 border-2 border-yellow-500", label: "VIP ★" },
                { color: "bg-blue-50 border-2 border-blue-400", label: "Acessível ♿" },
                { color: "bg-orange-400", label: "Reservado" },
                { color: "bg-green-500", label: "Confirmado" },
                { color: "bg-violet-500", label: "Gratuidade", tooltip: "Assento ocupado por passageiro isento (organizador, guia, etc.)" },
                { color: "bg-gray-300", label: "Bloqueado" },
                { color: "bg-cyan-100 border-2 border-cyan-300", label: "Banheiro 🚽" },
                { color: "bg-purple-100 border-2 border-purple-300", label: "Escada 🪜" },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5" title={"tooltip" in l ? l.tooltip : undefined}>
                  <div className={`w-4 h-4 rounded ${l.color}`} />
                  <span className={"tooltip" in l ? "text-muted-foreground underline decoration-dotted cursor-help" : "text-muted-foreground"}>{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-card border rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-sm">Resumo dos Assentos</h3>
            {[
              { label: "Disponíveis", count: seatCounts.available, color: "text-green-600" },
              { label: "Reservados", count: seatCounts.reserved, color: "text-orange-600" },
              { label: "Confirmados", count: seatCounts.confirmed, color: "text-primary" },
              { label: "Bloqueados", count: seatCounts.blocked, color: "text-gray-600" },
              { label: "Total", count: seats.length, color: "text-foreground" },
            ].map(s => (
              <div key={s.label} className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{s.label}</span>
                <span className={`font-bold ${s.color}`}>{s.count}</span>
              </div>
            ))}
            {seatCounts.free > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Gratuidades</span>
                  <span className="font-bold text-violet-600">{seatCounts.free}</span>
                </div>
                {freePassengerNames.length > 0 && (
                  <div className="pl-2 space-y-0.5">
                    {freePassengerNames.map(fp => (
                      <div key={fp.number} className="flex items-center gap-1.5 text-xs text-violet-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                        <span className="truncate" title={`${fp.name} — Assento ${fp.number}`}>
                          {fp.name} <span className="text-violet-400">({fp.number})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="pt-2 border-t">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Ocupação</span>
                <span className="font-semibold">{seats.length > 0 ? Math.round((seatCounts.reserved + seatCounts.confirmed) / seats.length * 100) : 0}%</span>
              </div>
              <div className="mt-1 w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: seats.length > 0 ? `${(seatCounts.reserved + seatCounts.confirmed) / seats.length * 100}%` : "0%" }} />
              </div>
            </div>
          </div>

          <div className="bg-card border rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-sm">Reservas Recentes</h3>
            {(reservations?.data ?? []).map(r => (
              <div key={r.id} className="flex items-center gap-2 text-sm">
                <div className="w-6 h-6 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                  <Users className="w-3 h-3 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium">{r.client.name}</p>
                  <p className="text-xs text-muted-foreground">Assento(s): {r.seats.join(", ")}</p>
                </div>
              </div>
            ))}
            {(!reservations?.data?.length) && <p className="text-sm text-muted-foreground text-center py-2">Sem reservas ainda</p>}
          </div>
        </div>
      </div>

      <Dialog open={showRenumberDialog} onOpenChange={v => { if (!isRenumbering) { setShowRenumberDialog(v); setRenumberError(null); setDryRunResult(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>🇧🇷 Renumerar Assentos (Padrão Brasileiro)</DialogTitle>
            <DialogDescription>
              Revise as mudanças abaixo antes de confirmar. Assentos confirmados são preservados com o número original.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {dryRunResult && (
              <>
                {dryRunResult.changes.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-orange-700 dark:text-orange-400">
                      {dryRunResult.changes.length} assento{dryRunResult.changes.length !== 1 ? "s" : ""} pendente{dryRunResult.changes.length !== 1 ? "s" : ""} com número alterado
                    </p>
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/60 border-b">
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Assento antigo</th>
                            <th className="text-center px-2 py-2 text-muted-foreground">→</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Assento novo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dryRunResult.changes.map((c, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="px-3 py-1.5 font-mono font-semibold text-orange-600">{c.oldNumber}</td>
                              <td className="px-2 py-1.5 text-center text-muted-foreground">→</td>
                              <td className="px-3 py-1.5 font-mono font-semibold text-green-600">{c.newNumber}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                    Nenhum assento pendente será renumerado.
                  </div>
                )}
                {dryRunResult.preserved.length > 0 && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Preservados ({dryRunResult.preserved.length} confirmado{dryRunResult.preserved.length !== 1 ? "s" : ""})
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {dryRunResult.preserved.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(", ")}
                    </p>
                    <p className="text-xs text-muted-foreground">Estes assentos mantêm o número original — bilhetes já emitidos não são afetados.</p>
                  </div>
                )}
              </>
            )}
            {renumberError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{renumberError}</span>
              </div>
            )}
            {syncCountersError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{syncCountersError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowRenumberDialog(false); setRenumberError(null); setDryRunResult(null); }} disabled={isRenumbering}>Cancelar</Button>
            <Button onClick={handleRenumber} disabled={isRenumbering}>
              {isRenumbering ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Renumerando...</> : "Confirmar Renumeração"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showModal} onOpenChange={() => { setShowModal(false); setSelectedSeat(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Assento {selectedSeat?.number} — Atribuir Passageiro</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button variant={assignMode === "search" ? "default" : "outline"} size="sm" className="flex-1" onClick={() => setAssignMode("search")}>Buscar Cliente</Button>
              <Button variant={assignMode === "manual" ? "default" : "outline"} size="sm" className="flex-1" onClick={() => setAssignMode("manual")}>Dados Manuais</Button>
            </div>

            {assignMode === "search" ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Buscar cliente pelo nome</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Nome do cliente..." value={clientSearch} onChange={e => { setClientSearch(e.target.value); setSelectedClientId(null); }} />
                  </div>
                </div>
                {clientsData?.data?.length ? (
                  <div className="border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                    {clientsData.data.map(c => (
                      <button
                        key={c.id}
                        className={`w-full text-left p-3 text-sm hover:bg-muted/50 border-b last:border-b-0 transition-colors ${selectedClientId === c.id ? "bg-primary/10 font-medium" : ""}`}
                        onClick={() => setSelectedClientId(c.id)}
                      >
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.whatsapp} · {c.email}</p>
                      </button>
                    ))}
                  </div>
                ) : clientSearch.length > 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-3">Nenhum cliente encontrado</p>
                ) : null}
                {selectedClient && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                    <p className="font-medium text-green-800">Selecionado: {selectedClient.name}</p>
                    <p className="text-green-600 text-xs">{selectedClient.whatsapp}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground bg-muted rounded-md p-2">Um novo cadastro de cliente será criado e a reserva será salva automaticamente.</p>
                <div className="space-y-2">
                  <Label>Nome Completo *</Label>
                  <Input placeholder="João da Silva" value={manualName} onChange={e => setManualName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>E-mail *</Label>
                  <Input type="email" placeholder="joao@email.com" value={manualEmail} onChange={e => setManualEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>CPF</Label>
                  <Input placeholder="000.000.000-00" value={manualCpf} onChange={e => setManualCpf(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>WhatsApp</Label>
                  <Input placeholder="(11) 99999-9999" value={manualPhone} onChange={e => setManualPhone(e.target.value)} />
                </div>
              </div>
            )}

            {assignError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{assignError}</span>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => { setShowModal(false); setSelectedSeat(null); setAssignError(null); }}>Cancelar</Button>
              <Button
                className="flex-1"
                disabled={isSaving || (assignMode === "search" ? !selectedClientId : !manualName)}
                onClick={handleAssign}
              >
                {isSaving ? "Reservando..." : "Confirmar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

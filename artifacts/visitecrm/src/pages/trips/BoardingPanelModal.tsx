import { useState, useMemo, useEffect, useRef } from "react";
import { useSeatStream } from "@/hooks/useSeatStream";
import { useToast } from "@/hooks/use-toast";
import {
  useGetTripBoardingPanel, useListReservations, useCheckInPassenger, useUndoCheckInPassenger,
  useSyncTripPassengers, useUpdatePassengerBoarding, useCheckInFreePassenger, useUndoCheckInFreePassenger,
} from "@workspace/api-client-react";
import type { BoardingPassenger, FreePassenger } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Search, MapPin, Users, ClipboardList, LogIn, RotateCcw, CheckCircle,
  UserRound, RefreshCw, MessageSquare, Pencil, Loader2, Star,
} from "lucide-react";
import { Client360Modal } from "@/components/client360-modal";
import { PassengerObsModal } from "./PassengerObsModal";
import type { BoardingPoint } from "./types";

function seatPositionLabel(seatNumber: string, numberingType?: string): string {
  if (!numberingType?.includes("brazilian_standard")) return "";
  const num = parseInt(seatNumber, 10);
  if (isNaN(num)) return "";
  return num % 2 !== 0 ? " (Janela)" : " (Corredor)";
}

export function BoardingPanelModal({ tripId, tripName, open, onClose }: { tripId: string; tripName: string; open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [client360Id, setClient360Id] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setSearch("");
      setBoardingFilter("__all__");
    }
  }, [tripId, open]);

  const { data: panel, isLoading, refetch } = useGetTripBoardingPanel(tripId, {
    query: { queryKey: ["boarding-panel", tripId], enabled: open && !!tripId },
  });

  // Listen to the admin seat-map SSE stream (non-public) so the boarding panel
  // auto-refreshes when a vitrine payment is confirmed and a reservation is created,
  // without requiring the admin to manually reload the page.
  const { eventCount } = useSeatStream({ tripId, isPublic: false, enabled: open && !!tripId });
  const prevEventCount = useRef(0);
  useEffect(() => {
    if (eventCount > prevEventCount.current) {
      prevEventCount.current = eventCount;
      refetch().catch(() => {});
    }
  }, [eventCount, refetch]);

  const { data: reservationsData } = useListReservations({ tripId, limit: 200 }, {
    query: { queryKey: ["reservations-boarding", tripId], enabled: open && !!tripId },
  });

  const reservationClientMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of reservationsData?.data ?? []) {
      if (r.clientId) map.set(r.id, r.clientId);
    }
    return map;
  }, [reservationsData]);

  const checkIn = useCheckInPassenger();
  const undoCheckIn = useUndoCheckInPassenger();
  const checkInFree = useCheckInFreePassenger();
  const undoCheckInFree = useUndoCheckInFreePassenger();
  const syncPassengers = useSyncTripPassengers();
  const updateBoarding = useUpdatePassengerBoarding();
  const [syncing, setSyncing] = useState(false);
  const [updatingLocationId, setUpdatingLocationId] = useState<string | null>(null);
  const [editingPassenger, setEditingPassenger] = useState<BoardingPassenger | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncPassengers.mutateAsync({ id: tripId });
      await refetch();
      if (result.created > 0) {
        toast({ title: `${result.created} passageiro(s) sincronizado(s)`, description: "O painel foi atualizado." });
      } else {
        toast({ title: "Tudo sincronizado", description: "Nenhum passageiro novo a adicionar." });
      }
    } catch {
      toast({ title: "Erro ao sincronizar passageiros", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const handleCheckIn = async (p: BoardingPassenger) => {
    try {
      await checkIn.mutateAsync({ reservationId: p.reservationId, id: p.id });
      await refetch();
      toast({ title: `${p.name} embarcou`, description: "Check-in individual registrado." });
    } catch {
      toast({ title: "Erro ao fazer check-in", variant: "destructive" });
    }
  };

  const handleUndoCheckIn = async (p: BoardingPassenger) => {
    try {
      await undoCheckIn.mutateAsync({ reservationId: p.reservationId, id: p.id });
      await refetch();
      toast({ title: "Check-in desfeito" });
    } catch {
      toast({ title: "Erro ao desfazer check-in", variant: "destructive" });
    }
  };

  const handleFreeCheckIn = async (fp: { id: string; name: string }) => {
    try {
      await checkInFree.mutateAsync({ id: tripId, fpId: fp.id });
      await refetch();
      toast({ title: `${fp.name} embarcou`, description: "Check-in registrado." });
    } catch {
      toast({ title: "Erro ao fazer check-in", variant: "destructive" });
    }
  };

  const handleFreeUndoCheckIn = async (fp: { id: string; name: string }) => {
    try {
      await undoCheckInFree.mutateAsync({ id: tripId, fpId: fp.id });
      await refetch();
      toast({ title: "Check-in desfeito" });
    } catch {
      toast({ title: "Erro ao desfazer check-in", variant: "destructive" });
    }
  };

  const handleBoardingLocationChange = async (p: BoardingPassenger, locationId: string | null) => {
    setUpdatingLocationId(p.id);
    try {
      await updateBoarding.mutateAsync({ tripId, passengerId: p.id, data: { boardingLocationId: locationId } });
      await refetch();
    } catch {
      toast({ title: "Erro ao atualizar local de embarque", variant: "destructive" });
    } finally {
      setUpdatingLocationId(null);
    }
  };

  const [boardingFilter, setBoardingFilter] = useState<string>("__all__");

  const boardingPoints: BoardingPoint[] = panel?.boardingPoints ?? [];
  const passengers = panel?.passengers ?? [];
  const freePassengers = panel?.freePassengers ?? [];

  const bpMap = useMemo(() => new Map(boardingPoints.map(bp => [bp.id, bp])), [boardingPoints]);

  const filtered = useMemo(() => {
    let list = passengers;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.seatNumber?.toLowerCase().includes(q) ||
        (p.reservationNumber ?? p.voucherCode).toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q)
      );
    }
    if (boardingFilter !== "__all__") {
      list = list.filter(p =>
        boardingFilter === "__none__"
          ? !p.boardingLocationId
          : p.boardingLocationId === boardingFilter
      );
    }
    return list;
  }, [passengers, search, boardingFilter]);

  const filteredFree = useMemo(() => {
    let list = freePassengers;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(fp =>
        fp.name.toLowerCase().includes(q) ||
        (fp.seatNumber ?? "").toLowerCase().includes(q)
      );
    }
    if (boardingFilter !== "__all__") {
      list = boardingFilter === "__none__" ? list : [];
    }
    return list;
  }, [freePassengers, search, boardingFilter]);

  const combinedList = useMemo(() => {
    const rows: ({ kind: "paid"; p: BoardingPassenger } | { kind: "free"; fp: FreePassenger })[] = [
      ...filtered.map(p => ({ kind: "paid" as const, p })),
      ...filteredFree.map(fp => ({ kind: "free" as const, fp })),
    ];
    const seatNum = (s: string | null | undefined) => {
      const n = s ? parseInt(s, 10) : NaN;
      return isNaN(n) ? null : n;
    };
    rows.sort((a, b) => {
      const na = seatNum(a.kind === "paid" ? a.p.seatNumber : a.fp.seatNumber);
      const nb = seatNum(b.kind === "paid" ? b.p.seatNumber : b.fp.seatNumber);
      if (na !== null && nb !== null) return na - nb;
      if (na !== null) return -1;
      if (nb !== null) return 1;
      return 0;
    });
    return rows;
  }, [filtered, filteredFree]);

  const boardingCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of passengers) {
      const key = p.boardingLocationId ?? "__none__";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [passengers]);

  const boardingPointStats = useMemo(() => {
    const map = new Map<string, { total: number; checkedIn: number }>();
    for (const p of passengers) {
      const key = p.boardingLocationId ?? "__none__";
      const cur = map.get(key) ?? { total: 0, checkedIn: 0 };
      map.set(key, { total: cur.total + 1, checkedIn: cur.checkedIn + (p.checkedInAt ? 1 : 0) });
    }
    return map;
  }, [passengers]);

  const pct = panel && panel.totalPassengers > 0
    ? Math.round((panel.checkedIn / panel.totalPassengers) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-primary" />
                Painel de Embarque — {tripName}
              </DialogTitle>
              {panel?.manifestNumber && (
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">Manifesto: {panel.manifestNumber}</p>
              )}
            </div>
            <Button
              size="sm" variant="outline" className="h-8 text-xs gap-1.5 mr-2"
              onClick={handleSync}
              disabled={syncing}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizando..." : "Sincronizar"}
            </Button>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <div className="bg-muted/50 border rounded-lg p-4 space-y-3">
              <div className="flex justify-between items-center text-sm">
                <div className="flex gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-700">{panel?.checkedIn ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Embarcados</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">{(panel?.totalPassengers ?? 0) - (panel?.checkedIn ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">Pendentes</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">{panel?.totalPassengers ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">{pct}%</p>
                  <p className="text-xs text-muted-foreground">embarque</p>
                </div>
              </div>
              <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-green-500" : pct >= 50 ? "bg-blue-500" : "bg-amber-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {boardingPoints.length > 0 && (
              <div className="border rounded-lg p-3 space-y-1.5 bg-background">
                <div className="flex items-center gap-1.5 mb-2">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Resumo por ponto de embarque</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {boardingPoints.map(bp => {
                    const stats = boardingPointStats.get(bp.id) ?? { total: 0, checkedIn: 0 };
                    const bpPct = stats.total > 0 ? Math.round((stats.checkedIn / stats.total) * 100) : 0;
                    return (
                      <button
                        key={bp.id}
                        type="button"
                        onClick={() => setBoardingFilter(boardingFilter === bp.id ? "__all__" : bp.id)}
                        className={`flex items-center gap-2 text-left rounded-md border px-3 py-2 transition-colors hover:bg-muted/60 ${boardingFilter === bp.id ? "border-primary bg-primary/5" : "border-border"}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{bp.name}{bp.time ? ` · ${bp.time}` : ""}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${bpPct >= 90 ? "bg-green-500" : bpPct >= 50 ? "bg-blue-500" : "bg-amber-500"}`}
                                style={{ width: `${bpPct}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              <span className="font-semibold text-green-700">{stats.checkedIn}</span>/{stats.total}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {boardingPointStats.has("__none__") && (() => {
                    const stats = boardingPointStats.get("__none__")!;
                    return (
                      <button
                        type="button"
                        onClick={() => setBoardingFilter(boardingFilter === "__none__" ? "__all__" : "__none__")}
                        className={`flex items-center gap-2 text-left rounded-md border px-3 py-2 transition-colors hover:bg-muted/60 ${boardingFilter === "__none__" ? "border-primary bg-primary/5" : "border-border border-dashed"}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-muted-foreground truncate">— Não definido —</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gray-400 transition-all"
                                style={{ width: stats.total > 0 ? `${Math.round((stats.checkedIn / stats.total) * 100)}%` : "0%" }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              <span className="font-semibold text-green-700">{stats.checkedIn}</span>/{stats.total}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, assento ou nº de reserva..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {boardingPoints.length > 0 && (
                <Select value={boardingFilter} onValueChange={setBoardingFilter}>
                  <SelectTrigger className="w-48 h-10 text-xs shrink-0">
                    <MapPin className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="Embarque..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos os pontos</SelectItem>
                    <SelectItem value="__none__">
                      — Não definido — {boardingCounts.get("__none__") ? `(${boardingCounts.get("__none__")})` : ""}
                    </SelectItem>
                    {boardingPoints.map(bp => (
                      <SelectItem key={bp.id} value={bp.id}>
                        {bp.name}{bp.time ? ` (${bp.time})` : ""}{boardingCounts.get(bp.id) ? ` · ${boardingCounts.get(bp.id)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="overflow-y-auto flex-1 space-y-1.5 pr-1">
              {filtered.length === 0 && filteredFree.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{passengers.length === 0 && freePassengers.length === 0 ? "Nenhum passageiro cadastrado nesta viagem" : "Nenhum resultado encontrado"}</p>
                </div>
              ) : (<>
              {combinedList.map(row => {
                if (row.kind === "free") {
                  const fp = row.fp;
                  const roleLabel = fp.role === "organizer" ? "Organizador" : fp.role === "guide" ? "Guia" : fp.role;
                  const isFreeCheckedIn = !!fp.checkedInAt;
                  return (
                    <div key={`free-${fp.id}`} className={`p-3 rounded-lg border ${isFreeCheckedIn ? "bg-green-50 border-green-200" : "bg-purple-50 border-purple-200"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {fp.seatNumber && (
                              <span className="font-mono text-xs bg-gray-100 border border-gray-300 px-2 py-0.5 rounded font-bold">{fp.seatNumber}{seatPositionLabel(fp.seatNumber, panel?.numberingType)}</span>
                            )}
                            <span className="font-medium text-sm">{fp.name}</span>
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold border border-purple-200">
                              <Star className="w-3 h-3" />
                              Gratuidade
                            </span>
                            {isFreeCheckedIn && (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold border border-green-200">
                                <CheckCircle className="w-3 h-3" />
                                {new Date(fp.checkedInAt!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-3 mt-0.5 flex-wrap text-xs text-muted-foreground">
                            {fp.cpf && <span>CPF: {fp.cpf}</span>}
                            <span>{roleLabel}</span>
                          </div>
                        </div>
                        <div className="shrink-0 ml-2">
                          {isFreeCheckedIn ? (
                            <Button
                              size="sm" variant="outline" className="h-8 text-xs text-muted-foreground gap-1"
                              onClick={() => handleFreeUndoCheckIn(fp)}
                              disabled={undoCheckInFree.isPending}
                            >
                              <RotateCcw className="w-3 h-3" /> Desfazer
                            </Button>
                          ) : (
                            <Button
                              size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white gap-1"
                              onClick={() => handleFreeCheckIn(fp)}
                              disabled={checkInFree.isPending}
                            >
                              <LogIn className="w-3 h-3" /> Embarcar
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
                const p = row.p;
                const isCheckedIn = !!p.checkedInAt;
                const currentLocationId = p.boardingLocationId ?? "";
                const isUpdatingThis = updatingLocationId === p.id;
                const hasObs = !!(p.observations || p.specialNeeds);
                return (
                  <div key={p.id} className={`p-3 rounded-lg border ${isCheckedIn ? "bg-green-50 border-green-200" : "bg-muted/30"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {p.seatNumber && (
                            <span className="font-mono text-xs bg-gray-100 border border-gray-300 px-2 py-0.5 rounded font-bold">{p.seatNumber}{seatPositionLabel(p.seatNumber, panel?.numberingType)}</span>
                          )}
                          <span className="font-medium text-sm">{p.name}</span>
                          {p.isGratuidade && (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold border border-amber-200">
                              <Star className="w-3 h-3" />
                              Gratuidade
                            </span>
                          )}
                          {hasObs && (
                            <span title={[p.specialNeeds, p.observations].filter(Boolean).join(" | ")}
                              className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 cursor-help">
                              <MessageSquare className="w-3 h-3" />
                            </span>
                          )}
                          {isCheckedIn && (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold border border-green-200">
                              <CheckCircle className="w-3 h-3" />
                              {new Date(p.checkedInAt!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-3 mt-0.5 flex-wrap text-xs text-muted-foreground">
                          <span>{p.clientName}</span>
                          {p.cpf && <span>CPF: {p.cpf}</span>}
                          <span className="font-mono opacity-70">{p.reservationNumber ?? p.voucherCode}</span>
                          {p.boardingLocationId && bpMap.get(p.boardingLocationId) && (
                            <span className="inline-flex items-center gap-1 text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 font-medium">
                              <MapPin className="w-3 h-3" />
                              {bpMap.get(p.boardingLocationId)!.name}
                              {bpMap.get(p.boardingLocationId)!.time ? ` · ${bpMap.get(p.boardingLocationId)!.time}` : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 ml-2 flex items-center gap-1">
                        <Button
                          size="sm" variant="outline" className={`h-8 w-8 p-0 ${hasObs ? "text-amber-600 border-amber-300" : ""}`}
                          onClick={() => setEditingPassenger(p)}
                          title="Editar informações do passageiro"
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        {reservationClientMap.get(p.reservationId) && (
                          <Button
                            size="sm" variant="outline" className="h-8 text-xs gap-1"
                            onClick={() => setClient360Id(reservationClientMap.get(p.reservationId)!)}
                          >
                            <UserRound className="w-3.5 h-3.5" /> Perfil 360°
                          </Button>
                        )}
                        {isCheckedIn ? (
                          <Button
                            size="sm" variant="outline" className="h-8 text-xs text-muted-foreground gap-1"
                            onClick={() => handleUndoCheckIn(p)}
                            disabled={undoCheckIn.isPending}
                          >
                            <RotateCcw className="w-3 h-3" /> Desfazer
                          </Button>
                        ) : (
                          <Button
                            size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white gap-1"
                            onClick={() => handleCheckIn(p)}
                            disabled={checkIn.isPending}
                          >
                            <LogIn className="w-3 h-3" /> Embarcar
                          </Button>
                        )}
                      </div>
                    </div>
                    {boardingPoints.length > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <Select
                          value={currentLocationId || "__none__"}
                          onValueChange={v => handleBoardingLocationChange(p, v === "__none__" ? null : v)}
                          disabled={isUpdatingThis}
                        >
                          <SelectTrigger className="h-7 text-xs flex-1 max-w-xs">
                            <SelectValue placeholder="Ponto de embarque..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Não definido —</SelectItem>
                            {boardingPoints.map(bp => (
                              <SelectItem key={bp.id} value={bp.id}>
                                {bp.name}{bp.time ? ` (${bp.time})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isUpdatingThis && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                      </div>
                    )}
                  </div>
                );
              })}
              </>)}
            </div>
          </>
        )}
      </DialogContent>
      <Client360Modal open={!!client360Id} onClose={() => setClient360Id(null)} clientId={client360Id} />
      <PassengerObsModal
        passenger={editingPassenger}
        tripId={tripId}
        open={!!editingPassenger}
        onClose={() => setEditingPassenger(null)}
        onSaved={() => refetch()}
      />
    </Dialog>
  );
}

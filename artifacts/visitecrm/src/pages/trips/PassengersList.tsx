import { useState, useMemo, useEffect } from "react";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  useGetTrip, useGetTripBoardingPanel, useCheckInPassenger, useUndoCheckInPassenger,
  useSyncTripPassengers, useUpdatePassengerBoarding,
} from "@workspace/api-client-react";
import { useSeatStream } from "@/hooks/useSeatStream";
import type { BoardingPassenger } from "@workspace/api-client-react";
import { storeApi } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft, Search, Download, RefreshCw, Share2, Loader2, MapPin, Calendar,
  MessageSquare, Pencil, RotateCcw, LogIn, CheckCircle, Mail, MessageCircle,
  AlertTriangle,
} from "lucide-react";
import { PassengerObsModal } from "./PassengerObsModal";
import type { BoardingPoint } from "./types";
import { printPassengersManifest } from "./PassengersListManifest";
import { sumPassengerFinancials } from "./passengerFinancials";
import { PassengersListShareDialog } from "./PassengersListShareDialog";
import { WhatsAppBroadcastModal } from "./WhatsAppBroadcastModal";

import { formatCpf, formatDate, formatCurrency, formatBRLPlain } from "@/lib/utils";
import { AGE_CATEGORY_LABELS } from "@/lib/labels";
import { isValidBrazilWhatsAppPhone } from "@workspace/shared";

type ColKey = "nome" | "cpf" | "birthDate" | "seatNumber" | "ageCategory" | "whatsapp" | "checkedInAt" | "boardingLocation" | "totalValue" | "paidValue" | "balance" | "obsDoc" | "assinatura";

/** Pure filter predicate — exported for unit-testing. */
export function filterPassengers(
  passengers: BoardingPassenger[],
  opts: { search: string; categoryFilter: string; boardingStatusFilter: string },
): BoardingPassenger[] {
  const { search, categoryFilter, boardingStatusFilter } = opts;
  return passengers.filter(p => {
    if (search) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !(p.cpf ?? "").toLowerCase().includes(q)) return false;
    }
    if (categoryFilter !== "all" && p.ageCategory !== categoryFilter) return false;
    if (boardingStatusFilter === "embarcado" && !p.checkedInAt) return false;
    if (boardingStatusFilter === "pendente" && p.checkedInAt) return false;
    return true;
  });
}

/**
 * Boarding reminders use the passenger's direct contact when present, then
 * fall back to the booking client's WhatsApp/phone contact.
 */
export function lacksValidWhatsAppReminderContact(
  passenger: Pick<BoardingPassenger, "passengerPhone" | "whatsapp" | "phone">,
): boolean {
  const reminderContact = passenger.passengerPhone || passenger.whatsapp || passenger.phone || "";
  return !isValidBrazilWhatsAppPhone(reminderContact);
}

const PASSENGER_COLS: { key: ColKey; label: string }[] = [
  { key: "nome", label: "Nome" },
  { key: "cpf", label: "CPF" },
  { key: "birthDate", label: "Dt. Nascimento" },
  { key: "seatNumber", label: "Poltrona" },
  { key: "ageCategory", label: "Categoria" },
  { key: "boardingLocation", label: "Ponto de Embarque" },
  { key: "whatsapp", label: "WhatsApp/Telefone" },
  { key: "checkedInAt", label: "Embarque" },
  { key: "totalValue", label: "Valor Total" },
  { key: "paidValue", label: "Valor Pago" },
  { key: "balance", label: "Saldo" },
  { key: "obsDoc", label: "Obs / Doc." },
  { key: "assinatura", label: "Assinatura" },
];

const DEFAULT_COLS: Record<ColKey, boolean> = {
  nome: true, cpf: true, birthDate: false, seatNumber: true,
  ageCategory: false, boardingLocation: false, whatsapp: false, checkedInAt: false,
  totalValue: false, paidValue: false, balance: false,
  obsDoc: false, assinatura: false,
};

const FINANCIAL_COL_KEYS: ColKey[] = ["totalValue", "paidValue", "balance"];

export function PassengersList({ tripId }: { tripId: string }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [boardingStatusFilter, setBoardingStatusFilter] = useState("all");
  const [isSyncing, setIsSyncing] = useState(false);
  const [exportStatusFilter, setExportStatusFilterRaw] = useState(
    () => localStorage.getItem("passengersList:exportStatusFilter") ?? ""
  );
  const setExportStatusFilter = (v: string) => {
    localStorage.setItem("passengersList:exportStatusFilter", v);
    setExportStatusFilterRaw(v);
  };
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(DEFAULT_COLS);

  const { data: trip } = useGetTrip(tripId, { query: { queryKey: ["/api/trips", tripId] } });
  const { data: panel, isLoading, refetch } = useGetTripBoardingPanel(tripId, {
    query: { queryKey: ["boarding-panel-antt", tripId] },
  });
  const { eventCount: seatEventCount } = useSeatStream({ tripId, isPublic: false, enabled: !!tripId });
  useEffect(() => {
    if (seatEventCount === 0) return;
    void refetch();
  }, [seatEventCount, refetch]);

  const checkIn = useCheckInPassenger();
  const undoCheckIn = useUndoCheckInPassenger();
  const syncMutation = useSyncTripPassengers();
  const updateBoarding = useUpdatePassengerBoarding();
  const [updatingLocationId, setUpdatingLocationId] = useState<string | null>(null);
  const [editingPassenger, setEditingPassenger] = useState<BoardingPassenger | null>(null);

  const [whatsappBroadcastOpen, setWhatsappBroadcastOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [sharePhone, setSharePhone] = useState("");
  const [shareLoading, setShareLoading] = useState(false);

  const handleShareEmail = async () => {
    if (!shareEmail.trim()) return;
    setShareLoading(true);
    try {
      await storeApi.sendManifest(tripId, { channel: "email", to: shareEmail.trim() });
      toast({ title: "Manifesto enviado por e-mail", description: `Enviado para ${shareEmail.trim()}` });
      setShareEmail("");
      setShareOpen(false);
    } catch (err) {
      toast({ title: "Erro ao enviar e-mail", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setShareLoading(false);
    }
  };

  const handleShareWhatsApp = async () => {
    if (!sharePhone.trim()) return;
    setShareLoading(true);
    try {
      const result = await storeApi.sendManifest(tripId, { channel: "whatsapp", to: sharePhone.trim() });
      if (result.whatsappUrl) {
        window.open(result.whatsappUrl, "_blank");
      }
      setSharePhone("");
      setShareOpen(false);
    } catch (err) {
      toast({ title: "Erro ao gerar link WhatsApp", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setShareLoading(false);
    }
  };

  const allPassengers = panel?.passengers ?? [];
  const boardingPoints: BoardingPoint[] = panel?.boardingPoints ?? [];

  const getBoardingPointName = (id: string | null | undefined) => {
    if (!id) return "";
    return boardingPoints.find(bp => bp.id === id)?.name ?? id;
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

  const toggleCol = (key: ColKey) =>
    setVisibleCols(prev => ({ ...prev, [key]: !prev[key] }));

  const filtered = useMemo(
    () => filterPassengers(allPassengers, { search, categoryFilter, boardingStatusFilter }),
    [allPassengers, search, categoryFilter, boardingStatusFilter],
  );
  const financialTotals = useMemo(() => sumPassengerFinancials(filtered), [filtered]);
  const showFinancialTotals = FINANCIAL_COL_KEYS.some(key => visibleCols[key]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await syncMutation.mutateAsync({ id: tripId });
      await refetch();
      if (result.created > 0) {
        toast({ title: `${result.created} passageiro(s) adicionado(s)`, description: "O manifesto foi atualizado." });
      } else {
        toast({ title: "Tudo sincronizado", description: "Nenhum passageiro novo a adicionar." });
      }
    } catch {
      toast({ title: "Erro ao sincronizar", variant: "destructive" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCheckIn = async (p: BoardingPassenger) => {
    try {
      await checkIn.mutateAsync({ reservationId: p.reservationId, id: p.id });
      await refetch();
      toast({ title: `${p.name} embarcou`, description: "Check-in registrado." });
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

  const getPassengerContact = (p: BoardingPassenger) =>
    p.whatsapp ?? p.phone ?? "—";

  const handlePassengersExport = () => {
    const a = document.createElement("a");
    const params = exportStatusFilter ? `?status=${exportStatusFilter}` : "";
    a.href = `/api/trips/${tripId}/passengers/export${params}`;
    a.download = "";
    a.click();
  };

  const handleCsvExport = () => {
    const activeCols = PASSENGER_COLS.filter(c => visibleCols[c.key]);
    const header = ["Nº", ...activeCols.map(c => c.label), "Gratuidade", "Telefone Passageiro", "Tipo Doc.", "Nec. Especiais", "Observações"];
    const freeRoleLabel: Record<string, string> = { organizer: "Organizador", guide: "Guia de Turismo" };
    const rows = filtered.map((p, i) => {
      const values: string[] = [String(i + 1)];
      for (const col of activeCols) {
        switch (col.key) {
          case "nome": values.push(p.name); break;
          case "cpf": values.push(formatCpf(p.cpf)); break;
          case "birthDate": values.push(p.birthDate ? formatDate(p.birthDate) : ""); break;
          case "seatNumber": values.push(p.seatNumber ?? ""); break;
          case "ageCategory": values.push(AGE_CATEGORY_LABELS[p.ageCategory] ?? p.ageCategory); break;
          case "boardingLocation": values.push(getBoardingPointName(p.boardingLocationId)); break;
          case "whatsapp": values.push(getPassengerContact(p)); break;
          case "checkedInAt": values.push(p.checkedInAt ? "Sim" : "Não"); break;
          case "totalValue": values.push(p.totalValue != null ? formatBRLPlain(parseFloat(p.totalValue)) : ""); break;
          case "paidValue": values.push(p.paidValue != null ? formatBRLPlain(parseFloat(p.paidValue)) : ""); break;
          case "balance": values.push(p.balance != null ? formatBRLPlain(parseFloat(p.balance)) : ""); break;
          case "obsDoc": values.push([p.documentType, p.observations].filter(Boolean).join(" | ")); break;
          case "assinatura": values.push(""); break;
        }
      }
      values.push(p.isGratuidade ? "Sim" : "");
      values.push(p.passengerPhone ?? "");
      values.push(p.documentType ?? "");
      values.push(p.specialNeeds ?? "");
      values.push(p.observations ?? "");
      return values;
    });
    const freePassengers = panel?.freePassengers ?? [];
    const freeRows = freePassengers.map((fp, i) => {
      const values: string[] = [String(filtered.length + i + 1)];
      for (const col of activeCols) {
        switch (col.key) {
          case "nome": values.push(fp.name); break;
          case "cpf": values.push(formatCpf(fp.cpf)); break;
          case "birthDate": values.push(""); break;
          case "seatNumber": values.push(fp.seatNumber ?? ""); break;
          case "ageCategory": values.push(`Gratuidade — ${freeRoleLabel[fp.role] ?? fp.role}`); break;
          case "boardingLocation": values.push(""); break;
          case "whatsapp": values.push(fp.whatsapp ?? ""); break;
          case "checkedInAt": values.push("—"); break;
          case "totalValue": values.push("—"); break;
          case "paidValue": values.push("—"); break;
          case "balance": values.push("—"); break;
          case "obsDoc": values.push(""); break;
          case "assinatura": values.push(""); break;
        }
      }
      values.push("Sim"); // freePassengers are always gratuidade
      values.push("");
      values.push("");
      values.push("");
      values.push("");
      return values;
    });
    const csv = [header, ...rows, ...freeRows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = (panel?.tripName ?? tripId).replace(/[^a-zA-Z0-9\-_]/g, "_");
    a.download = `relacao-passageiros-${safeName}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePdfPrint = () => {
    printPassengersManifest(panel as never, trip as never, allPassengers, getBoardingPointName, formatCpf, AGE_CATEGORY_LABELS, panel?.freePassengers ?? [], visibleCols, trip?.totalCapacity);
  };

  const CATEGORY_LABELS: Record<string, string> = { all: "Todas as categorias", ...AGE_CATEGORY_LABELS };
  const BOARDING_LABELS: Record<string, string> = { all: "Todos", embarcado: "Embarcado", pendente: "Pendente" };

  const checkedInCount = allPassengers.filter(p => p.checkedInAt).length;
  const visibleColCount = PASSENGER_COLS.filter(c => visibleCols[c.key]).length + 1;


  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => history.back()}><ArrowLeft className="w-4 h-4" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Lista de Passageiros — ANTT</h1>
          <p className="text-muted-foreground text-sm">
            {panel?.tripName ?? "Carregando..."}
            {trip && <span> · <MapPin className="inline w-3 h-3 mr-0.5" />{trip.destinationCity}, {trip.destinationState}</span>}
            {panel?.departureDate && (() => {
              const d = parseISO(panel.departureDate);
              const timeStr = format(d, "HH:mm");
              return (
                <span> · <Calendar className="inline w-3 h-3 mr-0.5" />{format(d, "dd/MM/yyyy", { locale: ptBR })}{timeStr !== "00:00" ? ` às ${timeStr}` : ""}</span>
              );
            })()}
            {panel && (
              <span className="ml-3 font-medium text-foreground">{checkedInCount}/{panel.totalPassengers} embarcados</span>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select
            value={exportStatusFilter === "" ? "active" : exportStatusFilter}
            onValueChange={v => setExportStatusFilter(v === "active" ? "" : v)}
          >
            <SelectTrigger className="w-36 h-8"><SelectValue placeholder="Ativos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value={RESERVATION_STATUS.CONFIRMED}>Confirmados</SelectItem>
              <SelectItem value={RESERVATION_STATUS.PENDING}>Pendentes</SelectItem>
              <SelectItem value={RESERVATION_STATUS.COMPLETED}>Concluídos</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handlePassengersExport} disabled={isLoading || allPassengers.length === 0}><Download className="w-4 h-4 mr-2" />Exportar Passageiros</Button>
          <Button variant="outline" size="sm" onClick={handleCsvExport} disabled={isLoading || allPassengers.length === 0}><Download className="w-4 h-4 mr-2" />CSV</Button>
          <Button variant="outline" size="sm" onClick={() => { const a = document.createElement("a"); a.href = `/api/trips/${tripId}/manifest/pdf`; a.download = ""; a.click(); }} disabled={isLoading || allPassengers.length === 0}><Download className="w-4 h-4 mr-2" />Exportar Manifesto</Button>
          <Button variant="outline" size="sm" onClick={handlePdfPrint} disabled={isLoading || allPassengers.length === 0}><Download className="w-4 h-4 mr-2" />Imprimir / PDF</Button>
          <Button variant="outline" size="sm" onClick={() => setWhatsappBroadcastOpen(true)} disabled={isLoading || (allPassengers.length === 0 && (panel?.freePassengers ?? []).length === 0)} className="text-green-700 border-green-300 hover:bg-green-50"><MessageCircle className="w-4 h-4 mr-2" />Enviar WhatsApp</Button>
          <Button variant="outline" size="sm" onClick={() => setShareOpen(true)} disabled={isLoading || allPassengers.length === 0}><Share2 className="w-4 h-4 mr-2" />Compartilhar</Button>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}><RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />{isSyncing ? "Sincronizando..." : "Sincronizar"}</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou CPF..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={boardingStatusFilter} onValueChange={setBoardingStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(BOARDING_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="bg-card border rounded-xl p-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">Colunas visíveis (impressão e CSV exportam conforme seleção):</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {PASSENGER_COLS.map(col => (
            <label key={col.key} className="flex items-center gap-1.5 cursor-pointer select-none text-sm">
              <input
                type="checkbox"
                checked={visibleCols[col.key]}
                onChange={() => toggleCol(col.key)}
                className="w-4 h-4 accent-primary"
              />
              {col.label}
            </label>
          ))}
        </div>
      </div>

      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                {visibleCols.nome && <th className="text-left p-3 font-medium whitespace-nowrap">Passageiro</th>}
                {visibleCols.cpf && <th className="text-left p-3 font-medium whitespace-nowrap">CPF</th>}
                {visibleCols.birthDate && <th className="text-left p-3 font-medium whitespace-nowrap">Dt. Nascimento</th>}
                {visibleCols.seatNumber && <th className="text-left p-3 font-medium whitespace-nowrap">Poltrona</th>}
                {visibleCols.ageCategory && <th className="text-left p-3 font-medium whitespace-nowrap">Categoria</th>}
                {visibleCols.boardingLocation && <th className="text-left p-3 font-medium whitespace-nowrap">Ponto de Embarque</th>}
                {visibleCols.whatsapp && <th className="text-left p-3 font-medium whitespace-nowrap">WhatsApp/Telefone</th>}
                {visibleCols.checkedInAt && <th className="text-center p-3 font-medium whitespace-nowrap">Embarque</th>}
                {visibleCols.totalValue && <th className="text-right p-3 font-medium whitespace-nowrap">Valor Total</th>}
                {visibleCols.paidValue && <th className="text-right p-3 font-medium whitespace-nowrap">Valor Pago</th>}
                {visibleCols.balance && <th className="text-right p-3 font-medium whitespace-nowrap">Saldo</th>}
                {visibleCols.obsDoc && <th className="text-left p-3 font-medium whitespace-nowrap">Obs / Doc.</th>}
                {visibleCols.assinatura && <th className="text-left p-3 font-medium whitespace-nowrap">Assinatura</th>}
                <th className="text-center p-3 font-medium whitespace-nowrap">Ação</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: visibleColCount }).map((_, j) => <td key={j} className="p-3"><Skeleton className="h-4 w-full" /></td>)}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={visibleColCount} className="text-center py-10 text-muted-foreground">Nenhum passageiro encontrado</td></tr>
              ) : (
                filtered.map((p, i) => {
                  const embarcou = !!p.checkedInAt;
                  const lacksReminderContact = lacksValidWhatsAppReminderContact(p);
                  return (
                    <tr key={p.id} className={`border-b hover:bg-muted/30 ${embarcou ? "bg-green-50/40" : ""}`}>
                      {visibleCols.nome && (
                        <td className="p-3 font-medium whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {p.name === "A preencher" ? (
                              <span className="italic text-amber-600 text-sm">A preencher</span>
                            ) : p.name}
                            {p.name === "A preencher" && (
                              <span title="Clique no lápis para preencher os dados deste passageiro"
                                className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 cursor-help text-xs font-normal">
                                Pendente
                              </span>
                            )}
                            {p.isGratuidade && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 text-xs font-normal">
                                Gratuidade
                              </span>
                            )}
                            {lacksReminderContact && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 cursor-help text-xs font-normal"
                                aria-label="Sem lembrete pelo WhatsApp: contato inválido"
                                title="Este passageiro não receberá lembretes pelo WhatsApp até que o contato seja corrigido."
                              >
                                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                                Sem lembrete WhatsApp
                              </span>
                            )}
                            {!!(p.observations || p.specialNeeds) && (
                              <span title={[p.specialNeeds, p.observations].filter(Boolean).join(" | ")}
                                className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 cursor-help">
                                <MessageSquare className="w-3 h-3" />
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {visibleCols.cpf && <td className="p-3 text-muted-foreground text-xs">{formatCpf(p.cpf)}</td>}
                      {visibleCols.birthDate && (
                        <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">
                          {p.birthDate ? formatDate(p.birthDate) : "—"}
                        </td>
                      )}
                      {visibleCols.seatNumber && (
                        <td className="p-3 whitespace-nowrap">
                          {p.ageCategory === "baby" && p.seatNumber === null ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 text-xs font-normal">
                              No colo
                            </span>
                          ) : (
                            p.seatNumber ?? "—"
                          )}
                        </td>
                      )}
                      {visibleCols.ageCategory && (
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            p.ageCategory === "adult" ? "bg-blue-100 text-blue-700" :
                            p.ageCategory === "child" ? "bg-amber-100 text-amber-700" :
                            p.ageCategory === "senior" ? "bg-purple-100 text-purple-700" :
                            "bg-gray-100 text-gray-700"
                          }`}>
                            {AGE_CATEGORY_LABELS[p.ageCategory] ?? p.ageCategory}
                          </span>
                        </td>
                      )}
                      {visibleCols.boardingLocation && (
                        <td className="p-3 whitespace-nowrap">
                          {boardingPoints.length > 0 ? (
                            <div className="flex items-center gap-1">
                              <Select
                                value={p.boardingLocationId ?? "__none__"}
                                onValueChange={v => handleBoardingLocationChange(p, v === "__none__" ? null : v)}
                                disabled={updatingLocationId === p.id}
                              >
                                <SelectTrigger className="h-7 text-xs w-40">
                                  <SelectValue placeholder="— Não definido —" />
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
                              {updatingLocationId === p.id && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">{getBoardingPointName(p.boardingLocationId) || "—"}</span>
                          )}
                        </td>
                      )}
                      {visibleCols.whatsapp && (
                        <td className="p-3 text-sm whitespace-nowrap">{getPassengerContact(p)}</td>
                      )}
                      {visibleCols.checkedInAt && (
                        <td className="p-3 text-center">
                          {embarcou ? (
                            <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium">
                              <CheckCircle className="w-4 h-4" /> Embarcado
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">Pendente</span>
                          )}
                        </td>
                      )}
                      {visibleCols.totalValue && (
                        <td className="p-3 text-right text-xs tabular-nums whitespace-nowrap">
                          {p.totalValue != null ? formatCurrency(parseFloat(p.totalValue)) : "—"}
                        </td>
                      )}
                      {visibleCols.paidValue && (
                        <td className="p-3 text-right text-xs tabular-nums whitespace-nowrap">
                          {p.paidValue != null ? formatCurrency(parseFloat(p.paidValue)) : "—"}
                        </td>
                      )}
                      {visibleCols.balance && (
                        <td className="p-3 text-right text-xs tabular-nums whitespace-nowrap">
                          {p.balance != null ? (
                            <span className={parseFloat(p.balance) > 0 ? "text-red-600 font-medium" : "text-green-700"}>
                              {formatCurrency(parseFloat(p.balance))}
                            </span>
                          ) : "—"}
                        </td>
                      )}
                      {visibleCols.obsDoc && (
                        <td className="p-3 text-xs text-muted-foreground max-w-[180px]">
                          {[p.documentType, p.observations].filter(Boolean).join(" | ") || "—"}
                        </td>
                      )}
                      {visibleCols.assinatura && <td className="p-3"></td>}
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm" variant="ghost"
                            className={`h-7 w-7 p-0 ${!!(p.observations || p.specialNeeds) ? "text-amber-600" : "text-muted-foreground"}`}
                            title="Editar observações do passageiro"
                            onClick={() => setEditingPassenger(p)}
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                          {embarcou ? (
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700" onClick={() => handleUndoCheckIn(p)}>
                              <RotateCcw className="w-3 h-3 mr-1" />Desfazer
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-green-700 hover:text-green-800" onClick={() => handleCheckIn(p)}>
                              <LogIn className="w-3 h-3 mr-1" />Check-in
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
              {!isLoading && showFinancialTotals && (
                <tr data-testid="passenger-financial-totals" className="border-t-2 bg-muted/30 font-semibold">
                  {PASSENGER_COLS.filter(col => visibleCols[col.key]).map((col, index) => {
                    const isFinancial = FINANCIAL_COL_KEYS.includes(col.key);
                    const value = isFinancial
                      ? financialTotals[col.key as keyof typeof financialTotals]
                      : 0;
                    const isBalance = col.key === "balance";
                    return (
                      <td
                        key={col.key}
                        className={`p-3 ${isFinancial ? "text-right text-xs tabular-nums whitespace-nowrap" : "text-left"}`}
                      >
                        {isFinancial ? (
                          <span className={isBalance && value > 0 ? "text-red-600" : isBalance ? "text-green-700" : undefined}>
                            {index === 0 && <span className="mr-2 text-muted-foreground">Totais:</span>}
                            {formatCurrency(value)}
                          </span>
                        ) : index === 0 ? (
                          "Totais"
                        ) : null}
                      </td>
                    );
                  })}
                  <td className="p-3" aria-hidden="true" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Exibindo {filtered.length} de {allPassengers.length} passageiro(s)
        </p>
      )}

      <PassengerObsModal
        passenger={editingPassenger}
        tripId={tripId}
        open={!!editingPassenger}
        onClose={() => setEditingPassenger(null)}
        onSaved={() => refetch()}
      />

      <PassengersListShareDialog
        open={shareOpen} onClose={setShareOpen}
        shareEmail={shareEmail} setShareEmail={setShareEmail}
        sharePhone={sharePhone} setSharePhone={setSharePhone}
        shareLoading={shareLoading}
        handleShareEmail={handleShareEmail} handleShareWhatsApp={handleShareWhatsApp}
      />

      <WhatsAppBroadcastModal
        open={whatsappBroadcastOpen}
        onClose={() => setWhatsappBroadcastOpen(false)}
        tripId={tripId}
        passengers={allPassengers}
        freePassengers={panel?.freePassengers ?? []}
      />
    </div>
  );
}

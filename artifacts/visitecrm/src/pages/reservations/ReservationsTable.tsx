import type { Reservation } from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, MoreHorizontal, Eye, QrCode, CheckCircle, XCircle,
  CalendarCheck, Pencil, Tag, RefreshCcw, Download, Upload, AlertTriangle,
} from "lucide-react";
import { STATUS_COLORS, STATUS_LABELS, METHOD_LABELS } from "./constants";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getReservationFinancialSummary, type ReservationWithFinancialLinks } from "./financial";

interface ReservationsTableProps {
  reservations: Reservation[];
  isLoading: boolean;
  tripsData: { data: { id: string; name: string }[] } | undefined;
  sellers: { id: string; name: string }[];
  boardingMap: Record<string, string>;
  search: string;
  setSearch: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  tripFilter: string;
  setTripFilter: (v: string) => void;
  sellerFilter: string;
  setSellerFilter: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  hasAutoRetryFilter: boolean;
  setHasAutoRetryFilter: (v: boolean) => void;
  page: number;
  setPage: (v: number | ((p: number) => number)) => void;
  total: number;
  totalPages: number;
  onViewDetail: (id: string) => void;
  onEdit: (id: string) => void;
  onVoucher: (r: Reservation) => void;
  onCheckin: (r: Reservation) => void;
  onCancel: (id: string, storeOrderId: string | null) => void;
  setClient360Id: (id: string | null) => void;
  onImport: () => void;
}

export function ReservationsTable({
  reservations, isLoading, tripsData, sellers, boardingMap,
  search, setSearch, statusFilter, setStatusFilter,
  tripFilter, setTripFilter, sellerFilter, setSellerFilter,
  dateFrom, setDateFrom, dateTo, setDateTo,
  hasAutoRetryFilter, setHasAutoRetryFilter,
  page, setPage, total, totalPages,
  onViewDetail, onEdit, onVoucher, onCheckin, onCancel, setClient360Id, onImport,
}: ReservationsTableProps) {
  const { isCliente } = usePermissions();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 bg-card p-4 rounded-lg border">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, nº reserva, CPF..." className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={statusFilter || "all"} onValueChange={v => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value={RESERVATION_STATUS.PENDING}>Pendente</SelectItem>
            <SelectItem value={RESERVATION_STATUS.CONFIRMED}>Confirmada</SelectItem>
            <SelectItem value={RESERVATION_STATUS.COMPLETED}>Concluída</SelectItem>
            <SelectItem value={RESERVATION_STATUS.CANCELLED}>Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tripFilter || "all"} onValueChange={v => { setTripFilter(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Viagem" /></SelectTrigger>
          <SelectContent className="max-h-48">
            <SelectItem value="all">Todas as viagens</SelectItem>
            {tripsData?.data.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {sellers.length > 0 && (
          <Select value={sellerFilter || "all"} onValueChange={v => { setSellerFilter(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Vendedor" /></SelectTrigger>
            <SelectContent className="max-h-48">
              <SelectItem value="all">Todos</SelectItem>
              {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="w-36" />
          <span className="text-muted-foreground text-xs">até</span>
          <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="w-36" />
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
          <input
            type="checkbox"
            checked={hasAutoRetryFilter}
            onChange={e => { setHasAutoRetryFilter(e.target.checked); setPage(1); }}
            className="rounded border-border"
          />
          E-mail auto-reenviado
        </label>
        {(search || statusFilter || tripFilter || sellerFilter || dateFrom || dateTo || hasAutoRetryFilter) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatusFilter(""); setTripFilter(""); setSellerFilter(""); setDateFrom(""); setDateTo(""); setHasAutoRetryFilter(false); setPage(1); }}>
            Limpar filtros
          </Button>
        )}
        {!isCliente && <>
          <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={onImport}>
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            Importar planilha
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => {
              const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
              const params = new URLSearchParams();
              if (statusFilter) params.set("status", statusFilter);
              if (search) params.set("search", search);
              if (tripFilter) params.set("tripId", tripFilter);
              if (sellerFilter) params.set("sellerId", sellerFilter);
              if (dateFrom) params.set("dateFrom", dateFrom);
              if (dateTo) params.set("dateTo", dateTo);
              if (hasAutoRetryFilter) params.set("hasAutoRetry", "true");
              const qs = params.toString();
              const url = `${BASE}/api/reservations/export${qs ? `?${qs}` : ""}`;
              const a = document.createElement("a");
              a.href = url;
              a.download = "";
              a.click();
            }}
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Exportar CSV
          </Button>
        </>}
      </div>

      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
        <Table className="min-w-[1200px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[245px]">Cliente / reserva</TableHead>
              <TableHead className="w-[165px]">Viagem</TableHead>
              <TableHead className="w-[150px]">Embarque e assentos</TableHead>
              <TableHead className="w-[130px]">Valor bruto / desconto</TableHead>
              <TableHead className="w-[110px]">Total líquido</TableHead>
              <TableHead className="w-[130px]">Pago / saldo</TableHead>
              <TableHead className="w-[145px]">Forma de pagamento</TableHead>
              <TableHead className="w-[95px]">Status</TableHead>
              <TableHead className="w-[52px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}
                </TableRow>
              ))
            ) : reservations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <CalendarCheck className="w-8 h-8 opacity-30" />
                    <p>Nenhuma reserva encontrada</p>
                    {(search || statusFilter || tripFilter) && <p className="text-xs">Tente ajustar os filtros de busca</p>}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              reservations.map(r => {
                const financial = getReservationFinancialSummary(r as ReservationWithFinancialLinks);
                const clientInitials = r.client?.name
                  ?.split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map(part => part[0])
                  .join("")
                  .toUpperCase() ?? "—";
                return (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    {(() => {
                      type CT = { reservationId: string; tripName: string; departureDate: string; returnDate: string | null };
                      const conflicts = (r as { conflictingTrips?: CT[] }).conflictingTrips ?? [];
                      const conflictTitle = conflicts.length > 0
                        ? `Reservas em viagens no mesmo período:\n${conflicts.map(c => `• ${c.tripName} (${new Date(c.departureDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}${c.returnDate ? ` – ${new Date(c.returnDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""})`).join("\n")}`
                        : undefined;
                      const storeOrderId = (r as { storeOrderId?: string | null }).storeOrderId;
                      return (
                        <div className="flex min-w-[220px] flex-col gap-1.5">
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">
                              {clientInitials}
                            </span>
                            {r.client?.id ? (
                              <button className="min-w-0 flex-1 text-left hover:underline" onClick={() => setClient360Id(r.client!.id)}>
                                <span className="block whitespace-normal text-sm font-semibold leading-5">{r.client?.name ?? "—"}</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">{r.client?.whatsapp}</span>
                              </button>
                            ) : (
                              <div className="min-w-0 flex-1">
                                <p className="whitespace-normal text-sm font-semibold leading-5">{r.client?.name ?? "—"}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">{r.client?.whatsapp}</p>
                              </div>
                            )}
                            {conflictTitle && (
                              <span title={conflictTitle} className="mt-0.5 inline-flex shrink-0 cursor-help items-center justify-center rounded-full bg-orange-100 p-0.5 text-orange-600" aria-label="Conflito de período">
                                <AlertTriangle className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </div>
                          <div className="ml-10 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="Número da reserva">
                              <Tag className="h-3 w-3" />
                              <span className="font-mono font-semibold">{r.reservationNumber ?? r.voucherCode}</span>
                            </span>
                            {storeOrderId && (
                              <span title={`Pedido online: #${storeOrderId}`} className="inline-flex cursor-default items-center rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">Loja</span>
                            )}
                            {r.hasAutoRetry && (
                              <Badge className="border-purple-200 bg-purple-50 text-xs text-purple-700" variant="outline">
                                <RefreshCcw className="mr-1 h-3 w-3" />
                                Auto-reenviado
                              </Badge>
                            )}
                            {r.isGratuidade && (
                              <span className="inline-flex cursor-default items-center rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Gratuidade</span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <p className="whitespace-normal text-sm font-medium leading-5">{r.trip?.name ?? "—"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{r.trip?.departureDate ? formatDate(r.trip.departureDate) : "—"}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <p className="whitespace-normal text-sm leading-5 text-muted-foreground">
                        {(r as { boardingLocationId?: string }).boardingLocationId
                          ? boardingMap[(r as { boardingLocationId?: string }).boardingLocationId!] ?? "—"
                          : "—"}
                      </p>
                      <div className="flex flex-wrap items-center gap-1">
                        {r.seats.slice(0, 3).map(s => <span key={s} className="rounded border border-primary/10 bg-primary/5 px-1.5 py-0.5 font-mono text-xs font-medium text-primary">{s}</span>)}
                        {r.seats.length > 3 && <span className="text-xs text-muted-foreground">+{r.seats.length - 3}</span>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="whitespace-nowrap">
                      <p className="text-sm font-medium">{formatCurrency(financial.subtotal)}</p>
                      {financial.gratuityAmount > 0 && (
                        <p className="mt-1 text-xs text-amber-700">
                          Cortesia − {formatCurrency(financial.gratuityAmount)}
                        </p>
                      )}
                      {financial.discount > 0 ? (
                        <p className="mt-1 text-xs text-destructive">
                          Desconto − {formatCurrency(financial.discount)}
                        </p>
                      ) : financial.gratuityAmount === 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">Sem desconto</p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm font-semibold text-primary">{formatCurrency(financial.total)}</TableCell>
                  <TableCell>
                    <div className="min-w-[125px] space-y-1.5 whitespace-nowrap">
                      <p className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">Pago</span>
                        <span className="font-medium text-green-700">{formatCurrency(financial.paid)}</span>
                      </p>
                      <p className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">Saldo</span>
                        <span className={`font-semibold ${financial.balance > 0 ? "text-destructive" : "text-green-700"}`}>{formatCurrency(financial.balance)}</span>
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{METHOD_LABELS[financial.paymentMethod ?? ""] ?? financial.paymentMethod ?? "—"}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-800"}`}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onViewDetail(r.id)}><Eye className="w-4 h-4 mr-2" /> Visualizar</DropdownMenuItem>
                        {r.status !== RESERVATION_STATUS.CANCELLED && <DropdownMenuItem onClick={() => onEdit(r.id)}><Pencil className="w-4 h-4 mr-2" /> Editar</DropdownMenuItem>}
                        <DropdownMenuItem onClick={() => onVoucher(r)}><QrCode className="w-4 h-4 mr-2" /> Ver Voucher</DropdownMenuItem>
                        {r.status !== RESERVATION_STATUS.CANCELLED && r.status !== RESERVATION_STATUS.COMPLETED && <DropdownMenuItem onClick={() => onCheckin(r)}><CheckCircle className="w-4 h-4 mr-2" /> Check-in</DropdownMenuItem>}
                        {r.status !== RESERVATION_STATUS.CANCELLED && <DropdownMenuItem className="text-destructive" onClick={() => onCancel(r.id, r.storeOrderId ?? null)}><XCircle className="w-4 h-4 mr-2" /> Cancelar Reserva</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Exibindo {Math.min((page - 1) * 20 + 1, total)}–{Math.min(page * 20, total)} de {total} reservas
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            <span className="flex items-center px-3 text-sm text-muted-foreground">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Próximo</Button>
          </div>
        </div>
      )}
    </>
  );
}

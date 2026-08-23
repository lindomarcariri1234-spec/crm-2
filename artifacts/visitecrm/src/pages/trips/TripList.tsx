import { useState } from "react";
import { Link } from "wouter";
import type { Trip } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus, Search, MapPin, Calendar, Users, Bus, Edit, Trash2, Eye,
  ChevronsLeft, ChevronsRight, LayoutGrid, List, ChevronLeft, ChevronRight,
  X, DollarSign, ClipboardList, AlertCircle, Copy, ShoppingBag, Images,
} from "lucide-react";
import { STATUS_MAP, TRIP_TYPES, TRIP_TYPE_LABELS } from "./constants";
import { formatCurrency, formatDate } from "./utils";
import { TripCountdown, OccupancyBar } from "./TripCountdown";
import { BoardingPanelModal } from "./BoardingPanelModal";
import { TripCard, PublishToStoreDialog } from "./TripCard";
import { useTrips } from "@/hooks/useTrips";
import { useGetMe, useGetTenant } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";

export function TripList() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [boardingTrip, setBoardingTrip] = useState<{ id: string; name: string } | null>(null);
  const [publishingTrip, setPublishingTrip] = useState<Trip | null>(null);

  const {
    trips, isLoading, totalPages, upcomingTrips, stats, isVendedor,
    search, setSearch, statusFilter, setStatusFilter,
    typeFilter, setTypeFilter, dateFilter, setDateFilter,
    page, setPage, deleteTrip, handleDuplicate, handleDelete,
    hasActiveFilters, clearFilters,
  } = useTrips();
  const { data: me } = useGetMe();
  const tenantId = me?.tenantId ?? null;
  const { data: tenantData } = useGetTenant(tenantId ?? "", {
    query: { enabled: !!tenantId, queryKey: ["tenant", tenantId] },
  });
  const tenantSettings = ((tenantData as (typeof tenantData & { settings?: Record<string, unknown> }))?.settings ?? {}) as Record<string, unknown>;
  const seatMapEnabled = tenantSettings.seatMapEnabled !== false;

  const onDelete = async (id: string) => {
    await handleDelete(id);
    setDeletingId(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Viagens"
        description={
          isVendedor ? "Visualize as excursões e pacotes disponíveis" : "Gerencie excursões e pacotes da agência"
        }
        actions={
          <>
          <Link href="/trips/calendar"><Button variant="outline"><Calendar className="w-4 h-4 mr-2" />Calendário</Button></Link>
          {!isVendedor && (
            <Link href="/trips/media"><Button variant="outline"><Images className="w-4 h-4 mr-2" />Mídia</Button></Link>
          )}
          {!isVendedor && (
            <Link href="/trips/new"><Button><Plus className="w-4 h-4 mr-2" />Nova Viagem</Button></Link>
          )}
          </>
        }
      />

      {isVendedor && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Você está no modo visualização. Apenas a agência pode criar ou editar viagens.</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total de Viagens", value: stats.total, icon: MapPin, color: "text-blue-600" },
          { label: "Viagens Ativas", value: stats.active, icon: Calendar, color: "text-green-600" },
          { label: "Taxa de Ocupação", value: `${stats.occupancyRate}%`, icon: Users, color: "text-amber-600" },
          { label: "Receita Estimada", value: formatCurrency(stats.totalRevenue), icon: DollarSign, color: "text-purple-600" },
        ].map(s => (
          <div key={s.label} className="bg-card border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={`w-4 h-4 ${s.color}`} />
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
            <p className="text-2xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2" />
        <div className="bg-card border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Próximas Partidas</h2>
            <Badge variant="outline" className="text-xs">{upcomingTrips.length}</Badge>
          </div>
          <div className="space-y-3">
            {upcomingTrips.slice(0, 3).map((trip) => (
              <div key={trip.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{trip.name}</p>
                    <p className="text-xs text-muted-foreground">{trip.destination}</p>
                  </div>
                  <TripCountdown date={trip.departureDate} />
                </div>
                <OccupancyBar reserved={trip.totalCapacity - trip.availableSeats} confirmed={0} free={0} total={trip.totalCapacity} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar viagens..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {TRIP_TYPES.map(t => <SelectItem key={t} value={t}>{TRIP_TYPE_LABELS[t] ?? t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFilter} onChange={e => { setDateFilter(e.target.value); setPage(1); }} className="w-40" title="Filtrar por data de saída (a partir de)" />
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="w-4 h-4 mr-1" />Limpar
          </Button>
        )}
        <div className="flex border rounded-md overflow-hidden ml-auto">
          <Button variant={viewMode === "grid" ? "default" : "ghost"} size="icon" className="rounded-none h-9 w-9" data-testid="view-grid" onClick={() => setViewMode("grid")}><LayoutGrid className="w-4 h-4" /></Button>
          <Button variant={viewMode === "list" ? "default" : "ghost"} size="icon" className="rounded-none h-9 w-9" data-testid="view-list" onClick={() => setViewMode("list")}><List className="w-4 h-4" /></Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      ) : trips.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhuma viagem encontrada</p>
          <p className="text-sm mt-1">{isVendedor ? "Nenhuma viagem disponível no momento" : "Crie sua primeira viagem para começar"}</p>
          {!isVendedor && <Link href="/trips/new"><Button className="mt-4">Nova Viagem</Button></Link>}
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trips.map(trip => (
            <TripCard key={trip.id} trip={trip} isVendedor={isVendedor} seatMapEnabled={seatMapEnabled} onDelete={() => setDeletingId(trip.id)} onDuplicate={() => handleDuplicate(trip)} onBoarding={() => setBoardingTrip({ id: trip.id, name: trip.name })} />
          ))}
        </div>
      ) : (
        <div className="bg-card border rounded-lg overflow-hidden">
          {trips.map((trip, i) => (
            <div key={trip.id} className={`flex items-center gap-4 p-4 ${i > 0 ? "border-t" : ""}`}>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{trip.name}</p>
                <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                  {trip.originCity && <><span className="text-blue-600 font-medium">{trip.originCity}</span><span>→</span></>}
                  <span>{trip.destinationCity}, {trip.destinationState}</span>
                  <span>·</span>
                  <span>{formatDate(trip.departureDate)}{trip.departureTime ? ` às ${trip.departureTime}` : ""}</span>
                  <TripCountdown date={trip.departureDate} time={trip.departureTime} />
                </p>
              </div>
              <div className="hidden md:block w-40">
                <OccupancyBar reserved={trip.reservedSeats} confirmed={trip.confirmedSeats} free={(Number(trip.freeOrganizers) || 0) + (Number(trip.freeGuides) || 0)} total={trip.totalCapacity} />
              </div>
              <Badge className={STATUS_MAP[trip.status]?.color}>{STATUS_MAP[trip.status]?.label ?? trip.status}</Badge>
              <div className="flex gap-1">
                <Link href={`/trips/${trip.id}/passengers-overview`}><Button size="icon" variant="ghost" className="h-8 w-8" title="Visão Geral"><Eye className="w-4 h-4" /></Button></Link>
                <Link href={`/trips/${trip.id}/passengers`}><Button size="icon" variant="ghost" className="h-8 w-8" title="Passageiros"><Users className="w-4 h-4" /></Button></Link>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-green-700" onClick={() => setBoardingTrip({ id: trip.id, name: trip.name })} title="Painel de Embarque"><ClipboardList className="w-4 h-4" /></Button>
                {seatMapEnabled && <Link href={`/trips/${trip.id}/seat-map`}><Button size="icon" variant="ghost" className="h-8 w-8" title="Mapa de Assentos"><Bus className="w-4 h-4" /></Button></Link>}
                {!isVendedor && <Link href={`/trips/${trip.id}/edit`}><Button size="icon" variant="ghost" className="h-8 w-8" title="Editar"><Edit className="w-4 h-4" /></Button></Link>}
                {!isVendedor && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleDuplicate(trip)} title="Duplicar"><Copy className="w-4 h-4" /></Button>}
                {!isVendedor && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeletingId(trip.id)} title="Excluir"><Trash2 className="w-4 h-4" /></Button>}
                {!isVendedor && <Button size="icon" variant="ghost" className="h-8 w-8 text-primary" onClick={() => setPublishingTrip(trip)} title="Publicar na Loja"><ShoppingBag className="w-4 h-4" /></Button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(1)}><ChevronsLeft className="w-4 h-4" /></Button>
          <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm text-muted-foreground">Página {page} de {totalPages}</span>
          <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
          <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(totalPages)}><ChevronsRight className="w-4 h-4" /></Button>
        </div>
      )}

      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirmar exclusão</DialogTitle></DialogHeader>
          <p className="text-muted-foreground">Tem certeza que deseja excluir esta viagem? Esta ação não pode ser desfeita.</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeletingId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deletingId && onDelete(deletingId)} disabled={deleteTrip.isPending}>
              {deleteTrip.isPending ? "Excluindo..." : "Excluir"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {boardingTrip && (
        <BoardingPanelModal
          tripId={boardingTrip.id}
          tripName={boardingTrip.name}
          open={!!boardingTrip}
          onClose={() => setBoardingTrip(null)}
        />
      )}

      {publishingTrip && (
        <PublishToStoreDialog
          trip={publishingTrip}
          open={!!publishingTrip}
          onClose={() => setPublishingTrip(null)}
        />
      )}
    </div>
  );
}

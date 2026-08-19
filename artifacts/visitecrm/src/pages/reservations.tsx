import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import type { Reservation } from "@workspace/api-client-react";
import { Client360Modal } from "@/components/client360-modal";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, CalendarCheck, CheckCircle, Clock, TrendingDown, AlertTriangle } from "lucide-react";
import { useReservations } from "@/hooks/useReservations";
import { fmt } from "./reservations/constants";
import { StatCard } from "./reservations/StatCard";
import { ReservationDetailModal } from "./reservations/ReservationDetailModal";
import { NewReservationWizard } from "./reservations/NewReservationWizard";
import { EditReservationModal } from "./reservations/EditReservationModal";
import { ReservationsTable } from "./reservations/ReservationsTable";
import { VoucherModal } from "./reservations/VoucherModal";
export { VoucherModal };

export default function Reservations() {
  const [, navigate] = useLocation();
  const [routeMatch, routeParams] = useRoute("/reservations/:id");
  const idFromRoute = routeMatch ? (routeParams as { id: string }).id : null;

  const [detailId, setDetailId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [voucherRes, setVoucherRes] = useState<Reservation | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [initialTripId, setInitialTripId] = useState<string | undefined>(undefined);
  const [initialClientId, setInitialClientId] = useState<string | undefined>(undefined);
  const [initialAmount, setInitialAmount] = useState<number | undefined>(undefined);
  const [initialDealId, setInitialDealId] = useState<string | undefined>(undefined);
  const [client360Id, setClient360Id] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<{ id: string; storeOrderId: string | null } | null>(null);
  const [confirmCheckinRes, setConfirmCheckinRes] = useState<Reservation | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tripId = params.get("tripId") ?? undefined;
    const clientId = params.get("clientId") ?? undefined;
    const amount = params.get("amount") ? parseFloat(params.get("amount")!) : undefined;
    const dealId = params.get("dealId") ?? undefined;
    const reservationIdParam = params.get("reservationId") ?? undefined;
    const openNew = params.get("new") === "true";
    if (openNew || tripId || clientId) {
      setInitialTripId(tripId); setInitialClientId(clientId); setInitialAmount(amount); setInitialDealId(dealId); setIsCreateOpen(true);
      params.delete("tripId"); params.delete("clientId"); params.delete("amount"); params.delete("dealId"); params.delete("new");
      const remaining = params.toString();
      history.replaceState(null, "", window.location.pathname + (remaining ? `?${remaining}` : ""));
    }
    if (reservationIdParam) {
      setDetailId(reservationIdParam);
      params.delete("reservationId");
      const remaining = params.toString();
      history.replaceState(null, "", window.location.pathname + (remaining ? `?${remaining}` : ""));
    }
  }, []);

  const {
    reservations, isLoading, total, totalPages, stats,
    tripsData, sellers, boardingMap,
    search, setSearch, statusFilter, setStatusFilter,
    tripFilter, setTripFilter, sellerFilter, setSellerFilter,
    dateFrom, setDateFrom, dateTo, setDateTo,
    hasAutoRetryFilter, setHasAutoRetryFilter,
    page, setPage, refetch, refetchStats,
    handleCheckin, handleCancel,
  } = useReservations();

  const activeDetailId = detailId ?? idFromRoute;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reservas</h1>
          <p className="text-muted-foreground text-sm">Gerencie todas as reservas de excursões</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> Nova Reserva</Button>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <StatCard icon={CalendarCheck} label="Total de Reservas" value={stats?.total ?? "—"} color="text-blue-600" />
        <StatCard icon={CheckCircle} label="Confirmadas" value={stats?.confirmed ?? "—"} color="text-green-600" />
        <StatCard icon={Clock} label="Pendentes" value={stats?.pending ?? "—"} color="text-yellow-600" />
        <StatCard icon={TrendingDown} label="Valor a Receber" value={stats ? fmt(stats.totalOutstanding) : "—"} color="text-orange-600" sub="Saldo em aberto" />
      </div>

      <ReservationsTable
        reservations={reservations} isLoading={isLoading} tripsData={tripsData} sellers={sellers} boardingMap={boardingMap}
        search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        tripFilter={tripFilter} setTripFilter={setTripFilter} sellerFilter={sellerFilter} setSellerFilter={setSellerFilter}
        dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo}
        hasAutoRetryFilter={hasAutoRetryFilter} setHasAutoRetryFilter={setHasAutoRetryFilter}
        page={page} setPage={setPage} total={total} totalPages={totalPages}
        onViewDetail={id => setDetailId(id)} onEdit={id => setEditId(id)}
        onVoucher={r => setVoucherRes(r)}
        onCheckin={r => setConfirmCheckinRes(r)} onCancel={(id, storeOrderId) => setConfirmCancel({ id, storeOrderId })}
        setClient360Id={setClient360Id}
      />

      <ReservationDetailModal reservationId={activeDetailId ?? ""} open={!!activeDetailId} onClose={() => { if (idFromRoute) navigate("/reservations"); setDetailId(null); }} />
      <NewReservationWizard
        open={isCreateOpen}
        onClose={() => { setIsCreateOpen(false); setInitialTripId(undefined); setInitialClientId(undefined); setInitialAmount(undefined); setInitialDealId(undefined); }}
        onSuccess={() => { refetch(); refetchStats(); setInitialTripId(undefined); setInitialClientId(undefined); setInitialAmount(undefined); setInitialDealId(undefined); }}
        initialTripId={initialTripId} initialClientId={initialClientId} initialAmount={initialAmount} dealId={initialDealId}
      />
      {editId && <EditReservationModal reservationId={editId} open={!!editId} onClose={() => setEditId(null)} onSuccess={() => { refetch(); refetchStats(); setEditId(null); }} />}
      <VoucherModal reservation={voucherRes} open={!!voucherRes} onClose={() => setVoucherRes(null)} />

      <AlertDialog open={!!confirmCancel} onOpenChange={o => { if (!o) setConfirmCancel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar Reserva</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja cancelar esta reserva? As vagas serão devolvidas para a viagem. Esta ação não pode ser desfeita facilmente.</AlertDialogDescription>
          </AlertDialogHeader>
          {confirmCancel?.storeOrderId && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p>Esta reserva veio de um pedido online. Cancelá-la também encerrará o pedido do cliente na loja.</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (confirmCancel) handleCancel(confirmCancel.id); setConfirmCancel(null); }}>
              Confirmar Cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmCheckinRes} onOpenChange={o => { if (!o) setConfirmCheckinRes(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Check-in</AlertDialogTitle>
            <AlertDialogDescription>
              Confirmar check-in para <strong>{confirmCheckinRes?.client?.name}</strong>? Voucher: <span className="font-mono font-semibold">{confirmCheckinRes?.voucherCode}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmCheckinRes) { handleCheckin(confirmCheckinRes); setConfirmCheckinRes(null); } }}>Confirmar Check-in</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Client360Modal open={!!client360Id} onClose={() => setClient360Id(null)} clientId={client360Id} />
    </div>
  );
}

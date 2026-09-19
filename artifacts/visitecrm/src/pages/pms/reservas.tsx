import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Ban,
  BedDouble,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Hotel,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

type Property = {
  id: string;
  name: string;
  propertyType?: string | null;
  city?: string | null;
  state?: string | null;
  currency?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
};

type RoomType = {
  id: string;
  name: string;
  code?: string | null;
  maxOccupancy: number;
  totalUnits: number;
  availableUnits: number;
  pricePerNight: number;
  totalForStay: number;
};

type Availability = {
  property: Property;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomTypes: RoomType[];
};

type ReservationSummary = {
  id: string;
  reservationNumber: string;
  property: { id: string; name: string };
  status: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  source: string;
  channel: string;
  createdAt: string;
  updatedAt: string;
  notes?: string | null;
  cancellationReason?: string | null;
};

type ReservationItem = {
  id: string;
  roomTypeId: string;
  quantity: number;
  adults: number;
  children: number;
  unitPrice: number;
  total: number;
  roomType?: { id?: string; name: string; code?: string | null };
  unit?: { id: string; name?: string; unitNumber?: string } | null;
};

type ReservationGuest = {
  id?: string;
  fullName: string;
  documentType?: string | null;
  documentNumber?: string | null;
  birthDate?: string | null;
  guestType: string;
  itemIndex?: number | null;
};

type PaymentAdjustment = {
  id: string;
  previousPaidAmount: number;
  newPaidAmount: number;
  deltaAmount: number;
  reason: string;
  createdAt: string;
};

type ReservationDetail = {
  reservation: ReservationSummary;
  property: Property;
  items: ReservationItem[];
  guests: ReservationGuest[];
  paymentAdjustments: PaymentAdjustment[];
};

type Unit = {
  id: string;
  name?: string | null;
  unitNumber?: string | null;
  roomType: { id: string; name: string; code?: string | null };
};

type GuestForm = { fullName: string; guestType: string };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (response.ok) return (await response.json()) as T;
  if (response.status === 401 || response.status === 403) {
    throw new Error("Você não tem permissão para consultar essa operação.");
  }
  if (response.status === 404) throw new Error("O registro solicitado não foi encontrado.");
  if (response.status === 409) throw new Error("A disponibilidade mudou. Atualize a consulta e tente novamente.");
  const errorBody = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  throw new Error(errorBody?.message ?? errorBody?.error ?? "Não foi possível concluir a operação. Tente novamente.");
}

function dateIn(offset: number) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatMoney(value: number | null | undefined, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(Number(value ?? 0));
}

function statusLabel(status: string) {
  status = status.toLowerCase();
  const labels: Record<string, string> = {
    held: "Pendente",
    confirmed: "Confirmada",
    cancelled: "Cancelada",
    checked_in: "Check-in",
    checked_out: "Check-out",
  };
  return labels[status] ?? status;
}

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  status = status.toLowerCase();
  if (status === "confirmed" || status === "checked_in") return "default";
  if (status === "cancelled") return "destructive";
  if (status === "held") return "outline";
  return "secondary";
}

function paymentState(reservation: ReservationSummary) {
  const total = Number(reservation.totalAmount);
  const paid = Number(reservation.paidAmount);
  const expectedBalance = Math.max(0, Math.round((total - paid) * 100) / 100);
  const balance = Number(reservation.balanceAmount);
  if (paid > total + 0.005) {
    return { label: "Pagamento excede o total; requer ajuste", className: "text-destructive" };
  }
  if (Math.abs(expectedBalance - balance) > 0.005) {
    return { label: "Saldo inconsistente; requer revisão", className: "text-destructive" };
  }
  if (balance <= 0.005) {
    return { label: "Pagamento integral", className: "text-primary" };
  }
  return { label: "Saldo pendente", className: "text-amber-700 dark:text-amber-400" };
}

export default function PmsReservas() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [propertyFilter, setPropertyFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [checkIn, setCheckIn] = useState(dateIn(1));
  const [checkOut, setCheckOut] = useState(dateIn(2));
  const [form, setForm] = useState({
    propertyId: "",
    adults: "2",
    children: "0",
    infants: "0",
    notes: "",
  });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [guests, setGuests] = useState<GuestForm[]>([{ fullName: "", guestType: "ADULT" }]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [cancelConfirming, setCancelConfirming] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [editCheckIn, setEditCheckIn] = useState("");
  const [editCheckOut, setEditCheckOut] = useState("");
  const [editAdults, setEditAdults] = useState("1");
  const [editChildren, setEditChildren] = useState("0");
  const [editInfants, setEditInfants] = useState("0");
  const [editNotes, setEditNotes] = useState("");
  const [editQuantities, setEditQuantities] = useState<Record<string, number>>({});
  const [editGuests, setEditGuests] = useState<GuestForm[]>([]);
  const [paymentAdjusting, setPaymentAdjusting] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReason, setPaymentReason] = useState("");

  const propertiesQuery = useQuery({
    queryKey: ["pms-properties"],
    queryFn: () => requestJson<Property[]>("/api/pms/properties"),
    staleTime: 60_000,
  });
  const reservationsQuery = useQuery({
    queryKey: ["pms-reservations", propertyFilter],
    queryFn: () =>
      requestJson<ReservationSummary[]>(
        `/api/pms/reservations?limit=100${propertyFilter ? `&propertyId=${encodeURIComponent(propertyFilter)}` : ""}`,
      ),
  });
  const availabilityQuery = useQuery({
    queryKey: ["pms-availability", form.propertyId, checkIn, checkOut],
    queryFn: () =>
      requestJson<Availability>(
        `/api/pms/availability?propertyId=${encodeURIComponent(form.propertyId)}&checkIn=${checkIn}&checkOut=${checkOut}`,
      ),
    enabled: Boolean(form.propertyId && checkIn && checkOut && checkIn < checkOut),
  });
  const detailQuery = useQuery({
    queryKey: ["pms-reservation", selectedId],
    queryFn: () => requestJson<ReservationDetail>(`/api/pms/reservations/${selectedId}`),
    enabled: Boolean(selectedId),
  });
  const editAvailabilityQuery = useQuery({
    queryKey: ["pms-edit-availability", detailQuery.data?.property.id, selectedId, editCheckIn, editCheckOut],
    queryFn: () =>
      requestJson<Availability>(
        `/api/pms/availability?propertyId=${encodeURIComponent(detailQuery.data!.property.id)}&checkIn=${editCheckIn}&checkOut=${editCheckOut}&excludeReservationId=${encodeURIComponent(selectedId)}`,
      ),
    enabled: Boolean(editing && selectedId && detailQuery.data?.property.id && editCheckIn && editCheckOut && editCheckIn < editCheckOut),
  });
  useEffect(() => {
    const detail = detailQuery.data;
    if (!detail) return;
    setEditCheckIn(detail.reservation.checkIn);
    setEditCheckOut(detail.reservation.checkOut);
    setEditAdults(String(detail.reservation.adults));
    setEditChildren(String(detail.reservation.children));
    setEditInfants(String(detail.reservation.infants));
    setEditNotes(detail.reservation.notes ?? "");
    setEditGuests(detail.guests.map(guest => ({ fullName: guest.fullName, guestType: guest.guestType })));
    const quantities = detail.items.reduce<Record<string, number>>((result, item) => {
      result[item.roomTypeId] = (result[item.roomTypeId] ?? 0) + item.quantity;
      return result;
    }, {});
    setEditQuantities(quantities);
    setEditing(false);
    setCancelConfirming(false);
    setCancelReason("");
  }, [detailQuery.data?.reservation.id, detailQuery.data?.reservation.updatedAt]);
  const unitsQuery = useQuery({
    queryKey: ["pms-property-units", detailQuery.data?.property.id],
    queryFn: () => requestJson<Unit[]>(`/api/pms/properties/${detailQuery.data!.property.id}/units`),
    enabled: Boolean(detailQuery.data?.property.id),
  });

  const filteredReservations = useMemo(() => {
    const rows = reservationsQuery.data ?? [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((reservation) =>
      [reservation.reservationNumber, reservation.property.name, reservation.status]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [reservationsQuery.data, searchTerm]);
  const selectedProperty = propertiesQuery.data?.find((property) => property.id === form.propertyId);
  const availability = availabilityQuery.data;
  const selectedRoomTypes = (availability?.roomTypes ?? []).filter((room) => (quantities[room.id] ?? 0) > 0);
  const estimatedTotal = selectedRoomTypes.reduce(
    (sum, room) => sum + (quantities[room.id] ?? 0) * Number(room.totalForStay),
    0,
  );

  const createReservation = useMutation({
    mutationFn: () => {
      if (!form.propertyId || !availability) throw new Error("Selecione a hospedagem e consulte a disponibilidade.");
      if (selectedRoomTypes.length === 0) throw new Error("Escolha ao menos um tipo de quarto.");
      if (guests.some((guest) => !guest.fullName.trim())) throw new Error("Informe o nome dos hóspedes principais.");
      return requestJson<ReservationDetail>("/api/pms/reservations", {
        method: "POST",
        body: JSON.stringify({
          propertyId: form.propertyId,
          source: "DIRECT",
          channel: "AGENCY",
          checkIn,
          checkOut,
          adults: Number(form.adults),
          children: Number(form.children),
          infants: Number(form.infants),
          currency: selectedProperty?.currency ?? "BRL",
          notes: form.notes.trim() || undefined,
          items: selectedRoomTypes.map((room) => ({
            roomTypeId: room.id,
            quantity: quantities[room.id],
            adults: Number(form.adults),
            children: Number(form.children),
            unitPrice: Number(room.pricePerNight),
          })),
          guests: guests.map((guest) => ({ ...guest, fullName: guest.fullName.trim() })),
        }),
      });
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["pms-reservations"] });
      setSelectedId(created.reservation.id);
      toast({ title: "Reserva criada", description: `A reserva ${created.reservation.reservationNumber} foi confirmada.` });
    },
    onError: (error: Error) => toast({ title: "Não foi possível criar a reserva", description: error.message, variant: "destructive" }),
  });

  const updateReservation = useMutation({
    mutationFn: () => {
      const availability = editAvailabilityQuery.data;
      if (!detailQuery.data || !availability) throw new Error("Consulte a disponibilidade para o novo período.");
      const selectedRoomTypes = availability.roomTypes.filter((room) => (editQuantities[room.id] ?? 0) > 0);
      if (selectedRoomTypes.length === 0) throw new Error("Escolha ao menos um tipo de quarto.");
      return requestJson<ReservationDetail>(`/api/pms/reservations/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({
          checkIn: editCheckIn,
          checkOut: editCheckOut,
          adults: Number(editAdults),
          children: Number(editChildren),
          infants: Number(editInfants),
          notes: editNotes.trim() || null,
          items: selectedRoomTypes.map((room) => ({
            roomTypeId: room.id,
            quantity: editQuantities[room.id],
            adults: Number(editAdults),
            children: Number(editChildren),
            unitPrice: Number(room.pricePerNight),
          })),
          guests: editGuests.map((guest) => ({
            fullName: guest.fullName.trim(),
            guestType: guest.guestType,
          })),
        }),
      });
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(["pms-reservation", selectedId], detail);
      queryClient.invalidateQueries({ queryKey: ["pms-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["pms-availability"] });
      setEditing(false);
      toast({ title: "Reserva atualizada", description: "Datas, itens e valores foram atualizados." });
    },
    onError: (error: Error) => toast({ title: "Não foi possível atualizar a reserva", description: error.message, variant: "destructive" }),
  });

  const cancelReservation = useMutation({
    mutationFn: () => {
      const reason = cancelReason.trim();
      if (reason.length < 3) throw new Error("Informe o motivo do cancelamento.");
      return requestJson<ReservationDetail>(`/api/pms/reservations/${selectedId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(["pms-reservation", selectedId], detail);
      queryClient.invalidateQueries({ queryKey: ["pms-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["pms-availability"] });
      setCancelConfirming(false);
      setCancelReason("");
      toast({ title: "Reserva cancelada", description: "A disponibilidade foi liberada para o período." });
    },
    onError: (error: Error) => toast({ title: "Não foi possível cancelar a reserva", description: error.message, variant: "destructive" }),
  });

  const adjustPayment = useMutation({
    mutationFn: () => {
      const paidAmount = Number(paymentAmount.replace(",", "."));
      const reason = paymentReason.trim();
      if (!Number.isFinite(paidAmount) || paidAmount < 0) throw new Error("Informe um valor recebido válido.");
      if (reason.length < 3) throw new Error("Informe o motivo do ajuste.");
      return requestJson<ReservationDetail>(`/api/pms/reservations/${selectedId}/payment-adjustments`, {
        method: "POST",
        body: JSON.stringify({ paidAmount, reason }),
      });
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(["pms-reservation", selectedId], detail);
      queryClient.invalidateQueries({ queryKey: ["pms-reservations"] });
      setPaymentAdjusting(false);
      setPaymentAmount("");
      setPaymentReason("");
      toast({ title: "Pagamento ajustado", description: "O valor recebido e o saldo foram recalculados." });
    },
    onError: (error: Error) => toast({ title: "Não foi possível ajustar o pagamento", description: error.message, variant: "destructive" }),
  });

  const saveAssignments = useMutation({
    mutationFn: () =>
      requestJson<ReservationDetail>(`/api/pms/reservations/${selectedId}/assignments`, {
        method: "PUT",
        body: JSON.stringify({
          assignments: (detailQuery.data?.items ?? []).map((item) => ({
            reservationUnitId: item.id,
            unitId: assignments[item.id] || null,
          })),
        }),
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(["pms-reservation", selectedId], detail);
      toast({ title: "Alocação salva", description: "As unidades da reserva foram atualizadas." });
    },
    onError: (error: Error) => toast({ title: "Não foi possível salvar a alocação", description: error.message, variant: "destructive" }),
  });

  function selectReservation(id: string) {
    setSelectedId(id);
    setAssignments({});
    setEditing(false);
    setCancelConfirming(false);
    setPaymentAdjusting(false);
    setPaymentAmount("");
    setPaymentReason("");
  }

  function resetNewReservation() {
    setSelectedId("");
    setEditing(false);
    setCancelConfirming(false);
    setForm((current) => ({ ...current, notes: "" }));
    setQuantities({});
    setGuests([{ fullName: "", guestType: "ADULT" }]);
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <span>PMS</span><ChevronRight className="h-4 w-4" /><span>Reservas diretas</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ClipboardList className="h-6 w-6 text-primary" /> Reservas diretas
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Transforme a disponibilidade da recepção em reservas confirmadas, com consulta rápida e alocação de unidades.
          </p>
        </div>
        <Button type="button" variant="outline" data-testid="button-refresh-reservations" onClick={() => reservationsQuery.refetch()} disabled={reservationsQuery.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${reservationsQuery.isFetching ? "animate-spin" : ""}`} /> Atualizar lista
        </Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,.8fr)]">
        <Card className="overflow-hidden border-primary/15">
          <CardHeader className="border-b bg-primary/[0.035] pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><Hotel className="h-4 w-4 text-primary" /> Nova reserva</CardTitle>
                <CardDescription className="mt-1">Consulte datas, selecione quartos e registre o hóspede principal.</CardDescription>
              </div>
              <Badge variant="outline" className="border-primary/25 bg-background text-primary">Venda direta</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="new-reservation-property">Hospedagem</Label>
                {propertiesQuery.isLoading ? <div className="h-10 animate-pulse rounded-md bg-muted" /> : (
                  <select id="new-reservation-property" data-testid="select-new-reservation-property" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.propertyId} onChange={(event) => { setForm((current) => ({ ...current, propertyId: event.target.value })); setQuantities({}); }}>
                    <option value="">Selecione uma hospedagem</option>
                    {(propertiesQuery.data ?? []).map((property) => <option key={property.id} value={property.id}>{property.name}{property.city ? ` — ${property.city}` : ""}</option>)}
                  </select>
                )}
              </div>
              <div className="space-y-1.5"><Label htmlFor="new-reservation-check-in">Entrada</Label><Input id="new-reservation-check-in" data-testid="input-new-reservation-check-in" type="date" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="new-reservation-check-out">Saída</Label><Input id="new-reservation-check-out" data-testid="input-new-reservation-check-out" type="date" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} /></div>
            </div>
            {propertiesQuery.isError && <InlineError text="Não foi possível carregar as hospedagens." />}
            {checkIn >= checkOut && <InlineError text="A saída precisa ser posterior à entrada." />}

            <div className="grid gap-3 sm:grid-cols-3">
              <NumberField id="new-reservation-adults" label="Adultos" value={form.adults} min={1} onChange={(value) => setForm((current) => ({ ...current, adults: value }))} />
              <NumberField id="new-reservation-children" label="Crianças" value={form.children} min={0} onChange={(value) => setForm((current) => ({ ...current, children: value }))} />
              <NumberField id="new-reservation-infants" label="Bebês" value={form.infants} min={0} onChange={(value) => setForm((current) => ({ ...current, infants: value }))} />
            </div>

            <section className="space-y-3" aria-labelledby="availability-heading">
              <div className="flex items-center justify-between gap-2">
                <div><h2 id="availability-heading" className="text-sm font-semibold">Disponibilidade para o período</h2><p className="text-xs text-muted-foreground">{availability ? `${availability.nights} noite(s) · selecione a quantidade por tipo` : "Escolha a hospedagem e as datas para consultar"}</p></div>
                {availabilityQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Consultando disponibilidade" />}
              </div>
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Tipo de quarto</TableHead><TableHead>Ocupação</TableHead><TableHead>Disponível</TableHead><TableHead>Diária</TableHead><TableHead className="text-right">Qtd.</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {availabilityQuery.isError && <TableRow><TableCell colSpan={5}><InlineError text="Não foi possível consultar a disponibilidade." /></TableCell></TableRow>}
                    {!availabilityQuery.isFetching && !availabilityQuery.isError && !availability && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground"><CalendarDays className="mx-auto mb-2 h-5 w-5 text-primary/60" />A disponibilidade aparecerá aqui.</TableCell></TableRow>}
                    {(availability?.roomTypes ?? []).map((room) => (
                      <TableRow key={room.id} data-testid={`row-room-type-${room.id}`}>
                        <TableCell><div className="font-medium">{room.name}</div><div className="text-xs text-muted-foreground">{room.code ?? "Sem código"}</div></TableCell>
                        <TableCell>{room.maxOccupancy} pessoa(s)</TableCell>
                        <TableCell><Badge variant={room.availableUnits > 0 ? "secondary" : "outline"}>{room.availableUnits} unidade(s)</Badge></TableCell>
                        <TableCell>{formatMoney(room.pricePerNight, selectedProperty?.currency ?? "BRL")}</TableCell>
                        <TableCell className="text-right"><Input aria-label={`Quantidade de ${room.name}`} data-testid={`input-room-quantity-${room.id}`} type="number" min={0} max={room.availableUnits} className="ml-auto h-8 w-20 text-right" value={quantities[room.id] ?? 0} onChange={(event) => setQuantities((current) => ({ ...current, [room.id]: Math.min(room.availableUnits, Math.max(0, Number(event.target.value) || 0)) }))} disabled={room.availableUnits === 0} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-[1fr_1.25fr]">
              <div className="space-y-3">
                <div><h2 className="text-sm font-semibold">Hóspedes principais</h2><p className="text-xs text-muted-foreground">Informe ao menos o nome do responsável pela reserva.</p></div>
                {guests.map((guest, index) => <div key={index} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1.5"><Label htmlFor={`guest-name-${index}`}>{index === 0 ? "Nome completo" : `Hóspede ${index + 1}`}</Label><Input id={`guest-name-${index}`} data-testid={`input-guest-name-${index}`} value={guest.fullName} placeholder="Nome do hóspede" onChange={(event) => setGuests((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, fullName: event.target.value } : item))} /></div>
                  {guests.length > 1 && <Button type="button" variant="ghost" size="icon" data-testid={`button-remove-guest-${index}`} aria-label="Remover hóspede" onClick={() => setGuests((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X className="h-4 w-4 text-muted-foreground" /></Button>}
                </div>)}
                <Button type="button" variant="outline" size="sm" data-testid="button-add-guest" onClick={() => setGuests((current) => [...current, { fullName: "", guestType: "ADULT" }])}><Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar hóspede</Button>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label htmlFor="new-reservation-notes">Observações</Label><textarea id="new-reservation-notes" data-testid="input-new-reservation-notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Preferências ou informações para a recepção" className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" /></div>
                <div className="flex items-end justify-between gap-4 rounded-md border border-primary/15 bg-primary/[0.035] p-3">
                  <div><p className="text-xs text-muted-foreground">Total estimado</p><p className="text-xl font-semibold text-primary">{formatMoney(estimatedTotal, selectedProperty?.currency ?? "BRL")}</p><p className="text-[11px] text-muted-foreground">Calculado para {availability?.nights ?? 0} noite(s)</p></div>
                  <Button type="button" data-testid="button-create-pms-reservation" onClick={() => createReservation.mutate()} disabled={createReservation.isPending || !availability || selectedRoomTypes.length === 0 || !form.propertyId}><Save className="mr-2 h-4 w-4" />{createReservation.isPending ? "Salvando..." : "Confirmar reserva"}</Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="border-b pb-4">
            <div className="flex items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4 text-primary" /> Reservas da agência</CardTitle><CardDescription className="mt-1">Diretas e confirmadas nesta hospedagem.</CardDescription></div><Badge variant="secondary">{filteredReservations.length}</Badge></div>
            <div className="grid gap-2 pt-2 sm:grid-cols-[1fr_1.2fr]">
              <select aria-label="Filtrar por propriedade" data-testid="select-filter-property" className="h-9 rounded-md border bg-background px-3 text-sm" value={propertyFilter} onChange={(event) => setPropertyFilter(event.target.value)}><option value="">Todas as propriedades</option>{(propertiesQuery.data ?? []).map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select>
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Pesquisar reservas" data-testid="input-search-reservations" className="h-9 pl-9" placeholder="Número, propriedade ou status" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /></div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {reservationsQuery.isLoading ? <div className="space-y-2 p-4"><div className="h-12 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded bg-muted" /></div> : reservationsQuery.isError ? <div className="p-6"><InlineError text="Não foi possível carregar as reservas." /><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => reservationsQuery.refetch()}>Tentar novamente</Button></div> : filteredReservations.length === 0 ? <EmptyState text={searchTerm || propertyFilter ? "Nenhuma reserva corresponde aos filtros." : "Nenhuma reserva direta encontrada."} /> : (
              <div className="max-h-[640px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Reserva</TableHead><TableHead>Período</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{filteredReservations.map((reservation) => <TableRow key={reservation.id} data-testid={`row-reservation-${reservation.id}`} className={`cursor-pointer transition-colors hover:bg-muted/60 ${selectedId === reservation.id ? "bg-primary/[0.07]" : ""}`} onClick={() => selectReservation(reservation.id)}><TableCell><div className="font-medium text-primary">{reservation.reservationNumber}</div><div className="max-w-[170px] truncate text-xs text-muted-foreground">{reservation.property.name}</div></TableCell><TableCell className="whitespace-nowrap text-xs">{formatDate(reservation.checkIn)}<br /><span className="text-muted-foreground">a {formatDate(reservation.checkOut)}</span></TableCell><TableCell><Badge variant={statusVariant(reservation.status)}>{statusLabel(reservation.status)}</Badge></TableCell><TableCell className="whitespace-nowrap text-right text-sm font-medium">{formatMoney(reservation.totalAmount)}</TableCell></TableRow>)}</TableBody></Table></div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedId && (
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="border-b bg-primary/[0.025] pb-4"><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4 text-primary" /> Detalhe da reserva</CardTitle><CardDescription>Confira hóspedes, valores e alocação de unidades.</CardDescription></div><Button type="button" variant="ghost" size="icon" data-testid="button-close-reservation-detail" aria-label="Fechar detalhe" onClick={() => setSelectedId("")}><X className="h-4 w-4" /></Button></div></CardHeader>
          <CardContent className="p-5">
            {detailQuery.isLoading ? <div className="h-32 animate-pulse rounded-md bg-muted" /> : detailQuery.isError || !detailQuery.data ? <InlineError text="Não foi possível carregar o detalhe da reserva." /> : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
                  <div className="text-sm text-muted-foreground">
                    {detailQuery.data.reservation.status.toLowerCase() === "cancelled"
                      ? <span>Cancelada: {detailQuery.data.reservation.cancellationReason || "motivo não informado"}</span>
                      : <span>Alterações de datas, quartos e hóspedes recalculam a disponibilidade antes de salvar.</span>}
                  </div>
                  {detailQuery.data.reservation.status.toLowerCase() !== "cancelled" && detailQuery.data.reservation.status.toLowerCase() !== "expired" && (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" data-testid="button-edit-pms-reservation" onClick={() => { setEditing(true); setCancelConfirming(false); }}>
                        <Pencil className="mr-2 h-4 w-4" /> Editar reserva
                      </Button>
                      <Button type="button" variant="outline" size="sm" data-testid="button-adjust-pms-payment" onClick={() => { setPaymentAdjusting(true); setPaymentAmount(String(detailQuery.data.reservation.paidAmount)); setPaymentReason(""); setEditing(false); setCancelConfirming(false); }}>
                        <CircleDollarSign className="mr-2 h-4 w-4" /> Ajustar pagamento
                      </Button>
                      <Button type="button" variant="destructive" size="sm" data-testid="button-cancel-pms-reservation" onClick={() => { setCancelConfirming(true); setEditing(false); }}>
                        <Ban className="mr-2 h-4 w-4" /> Cancelar
                      </Button>
                    </div>
                  )}
                </div>
                {cancelConfirming && (
                  <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/[0.04] p-4">
                    <div><p className="text-sm font-semibold">Confirmar cancelamento</p><p className="text-xs text-muted-foreground">A reserva deixará de bloquear a disponibilidade. O motivo ficará registrado no histórico.</p></div>
                    <textarea aria-label="Motivo do cancelamento" data-testid="input-pms-cancellation-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Informe o motivo do cancelamento" className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
                    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setCancelConfirming(false)}>Voltar</Button><Button type="button" variant="destructive" size="sm" data-testid="button-confirm-pms-cancellation" onClick={() => cancelReservation.mutate()} disabled={cancelReservation.isPending || cancelReason.trim().length < 3}>{cancelReservation.isPending ? "Cancelando..." : "Confirmar cancelamento"}</Button></div>
                  </div>
                )}
                {paymentAdjusting && (
                  <div className="space-y-3 rounded-md border border-primary/30 bg-primary/[0.04] p-4">
                    <div>
                      <p className="text-sm font-semibold">Ajustar pagamento recebido</p>
                      <p className="text-xs text-muted-foreground">Use esta ação para registrar um estorno, correção ou reaplicação. O histórico anterior será preservado.</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr]">
                      <div className="space-y-1.5">
                        <Label htmlFor="pms-payment-amount">Valor recebido</Label>
                        <Input id="pms-payment-amount" data-testid="input-pms-payment-amount" type="number" min={0} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pms-payment-reason">Motivo</Label>
                        <textarea id="pms-payment-reason" data-testid="input-pms-payment-reason" value={paymentReason} onChange={(event) => setPaymentReason(event.target.value)} placeholder="Ex.: estorno solicitado pelo hóspede" className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setPaymentAdjusting(false)}>Voltar</Button>
                      <Button type="button" size="sm" data-testid="button-confirm-pms-payment-adjustment" onClick={() => adjustPayment.mutate()} disabled={adjustPayment.isPending || paymentReason.trim().length < 3 || paymentAmount.trim() === ""}>
                        {adjustPayment.isPending ? "Salvando..." : "Salvar ajuste"}
                      </Button>
                    </div>
                  </div>
                )}
                {editing && (
                  <ReservationEditPanel
                    detail={detailQuery.data}
                    availability={editAvailabilityQuery.data}
                    availabilityLoading={editAvailabilityQuery.isFetching}
                    checkIn={editCheckIn}
                    checkOut={editCheckOut}
                    adults={editAdults}
                    children={editChildren}
                    infants={editInfants}
                    notes={editNotes}
                    quantities={editQuantities}
                    guests={editGuests}
                    onCheckInChange={setEditCheckIn}
                    onCheckOutChange={setEditCheckOut}
                    onAdultsChange={setEditAdults}
                    onChildrenChange={setEditChildren}
                    onInfantsChange={setEditInfants}
                    onNotesChange={setEditNotes}
                    onQuantityChange={(roomId, quantity) => setEditQuantities((current) => ({ ...current, [roomId]: quantity }))}
                    onGuestChange={(index, fullName) => setEditGuests((current) => current.map((guest, guestIndex) => guestIndex === index ? { ...guest, fullName } : guest))}
                    onSave={() => updateReservation.mutate()}
                    onCancel={() => setEditing(false)}
                    saving={updateReservation.isPending}
                  />
                )}
                <ReservationDetailView detail={detailQuery.data} units={unitsQuery.data ?? []} unitsLoading={unitsQuery.isLoading} assignments={assignments} onAssignmentChange={(itemId, unitId) => setAssignments((current) => ({ ...current, [itemId]: unitId }))} onSaveAssignments={() => saveAssignments.mutate()} savingAssignments={saveAssignments.isPending} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!selectedId && <div className="flex items-center justify-between rounded-md border border-dashed border-primary/20 bg-primary/[0.025] px-4 py-3 text-sm text-muted-foreground"><span>Selecione uma reserva na lista para acompanhar os detalhes e unidades.</span><Button type="button" variant="ghost" size="sm" data-testid="button-reset-new-reservation" onClick={resetNewReservation}>Limpar formulário</Button></div>}
    </div>
  );
}

function NumberField({ id, label, value, min, onChange }: { id: string; label: string; value: string; min: number; onChange: (value: string) => void }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} data-testid={`input-${id}`} type="number" min={min} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function InlineError({ text }: { text: string }) {
  return <div className="flex items-center gap-2 text-sm text-destructive" data-testid="status-pms-error"><AlertCircle className="h-4 w-4 shrink-0" />{text}</div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-5 py-12 text-center text-sm text-muted-foreground" data-testid="status-pms-empty"><ClipboardList className="mx-auto mb-2 h-6 w-6 text-primary/50" /><p>{text}</p><p className="mt-1 text-xs">A lista será atualizada após uma nova confirmação.</p></div>;
}

function ReservationEditPanel({ detail, availability, availabilityLoading, checkIn, checkOut, adults, children, infants, notes, quantities, guests, onCheckInChange, onCheckOutChange, onAdultsChange, onChildrenChange, onInfantsChange, onNotesChange, onQuantityChange, onGuestChange, onSave, onCancel, saving }: {
  detail: ReservationDetail;
  availability?: Availability;
  availabilityLoading: boolean;
  checkIn: string;
  checkOut: string;
  adults: string;
  children: string;
  infants: string;
  notes: string;
  quantities: Record<string, number>;
  guests: GuestForm[];
  onCheckInChange: (value: string) => void;
  onCheckOutChange: (value: string) => void;
  onAdultsChange: (value: string) => void;
  onChildrenChange: (value: string) => void;
  onInfantsChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onQuantityChange: (roomId: string, value: number) => void;
  onGuestChange: (index: number, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return <section className="space-y-4 rounded-md border border-primary/20 bg-primary/[0.025] p-4" data-testid="pms-reservation-edit-panel">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Editar reserva</h3><p className="text-xs text-muted-foreground">A nova disponibilidade é consultada sem contar esta própria reserva.</p></div><Button type="button" variant="ghost" size="sm" onClick={onCancel}>Fechar edição</Button></div>
    <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
      <div className="space-y-1.5"><Label htmlFor="edit-pms-check-in">Entrada</Label><Input id="edit-pms-check-in" data-testid="input-edit-pms-check-in" type="date" value={checkIn} onChange={(event) => onCheckInChange(event.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="edit-pms-check-out">Saída</Label><Input id="edit-pms-check-out" data-testid="input-edit-pms-check-out" type="date" value={checkOut} onChange={(event) => onCheckOutChange(event.target.value)} /></div>
      <div className="flex items-end text-sm text-muted-foreground">{availabilityLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recalculando disponibilidade…</> : availability ? `${availability.nights} noite(s)` : checkIn >= checkOut ? "A saída precisa ser posterior à entrada." : "Aguardando disponibilidade"}</div>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <NumberField id="edit-pms-adults" label="Adultos" value={adults} min={1} onChange={onAdultsChange} />
      <NumberField id="edit-pms-children" label="Crianças" value={children} min={0} onChange={onChildrenChange} />
      <NumberField id="edit-pms-infants" label="Bebês" value={infants} min={0} onChange={onInfantsChange} />
    </div>
    <div className="overflow-hidden rounded-md border">
      <Table><TableHeader><TableRow><TableHead>Tipo de quarto</TableHead><TableHead>Disponível</TableHead><TableHead>Diária</TableHead><TableHead className="text-right">Qtd.</TableHead></TableRow></TableHeader><TableBody>
        {availabilityLoading && <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">Consultando disponibilidade…</TableCell></TableRow>}
        {!availabilityLoading && !availability && <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">Informe um período válido.</TableCell></TableRow>}
        {(availability?.roomTypes ?? []).map((room) => <TableRow key={room.id}><TableCell><div className="font-medium">{room.name}</div><div className="text-xs text-muted-foreground">{room.code ?? "Sem código"}</div></TableCell><TableCell><Badge variant={room.availableUnits > 0 ? "secondary" : "outline"}>{room.availableUnits} unidade(s)</Badge></TableCell><TableCell>{formatMoney(room.pricePerNight, detail.property.currency ?? "BRL")}</TableCell><TableCell className="text-right"><Input aria-label={`Quantidade editada de ${room.name}`} data-testid={`input-edit-room-quantity-${room.id}`} type="number" min={0} max={room.availableUnits} className="ml-auto h-8 w-20 text-right" value={quantities[room.id] ?? 0} onChange={(event) => onQuantityChange(room.id, Math.min(room.availableUnits, Math.max(0, Number(event.target.value) || 0)))} disabled={room.availableUnits === 0} /></TableCell></TableRow>)}
      </TableBody></Table>
    </div>
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-2"><Label>Hóspedes</Label>{guests.length === 0 && <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">Nenhum hóspede registrado.</p>}{guests.map((guest, index) => <Input key={index} aria-label={`Nome editado do hóspede ${index + 1}`} data-testid={`input-edit-guest-name-${index}`} value={guest.fullName} onChange={(event) => onGuestChange(index, event.target.value)} placeholder={`Hóspede ${index + 1}`} />)}</div>
      <div className="space-y-1.5"><Label htmlFor="edit-pms-notes">Observações</Label><textarea id="edit-pms-notes" data-testid="input-edit-pms-notes" value={notes} onChange={(event) => onNotesChange(event.target.value)} className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" /></div>
    </div>
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancelar edição</Button><Button type="button" data-testid="button-save-pms-reservation-edit" onClick={onSave} disabled={saving || availabilityLoading || !availability || checkIn >= checkOut}>{saving ? "Salvando..." : "Salvar alterações"}</Button></div>
  </section>;
}

function ReservationDetailView({ detail, units, unitsLoading, assignments, onAssignmentChange, onSaveAssignments, savingAssignments }: { detail: ReservationDetail; units: Unit[]; unitsLoading: boolean; assignments: Record<string, string>; onAssignmentChange: (itemId: string, unitId: string) => void; onSaveAssignments: () => void; savingAssignments: boolean }) {
  const reservation = detail.reservation;
  const financialState = paymentState(reservation);
  const currentAssignment = (item: ReservationItem) => assignments[item.id] ?? item.unit?.id ?? "";
  const unitLabel = (unit: Unit) => unit.unitNumber ? `${unit.unitNumber} · ${unit.name ?? "Unidade"}` : unit.name ?? "Unidade";
  return <div className="space-y-5" data-testid={`detail-reservation-${reservation.id}`}>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <DetailMetric label="Reserva" value={reservation.reservationNumber} icon={<ClipboardList className="h-4 w-4" />} />
      <DetailMetric label="Período" value={`${formatDate(reservation.checkIn)} → ${formatDate(reservation.checkOut)}`} icon={<CalendarDays className="h-4 w-4" />} />
      <DetailMetric label="Hóspedes" value={`${reservation.adults} adultos · ${reservation.children} crianças`} icon={<UsersRound className="h-4 w-4" />} />
      <DetailMetric label="Total" value={formatMoney(reservation.totalAmount)} icon={<CircleDollarSign className="h-4 w-4" />} />
      <div className="rounded-md border bg-muted/20 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</p><Badge variant={statusVariant(reservation.status)} className="mt-1">{statusLabel(reservation.status)}</Badge></div>
    </div>
     <div className="grid gap-3 sm:grid-cols-2">
       <DetailMetric label="Recebido" value={formatMoney(reservation.paidAmount, detail.property.currency ?? "BRL")} icon={<CircleDollarSign className="h-4 w-4" />} />
       <div className="rounded-md border bg-muted/20 p-3">
         <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Saldo</p>
         <p className={`mt-1 text-sm font-semibold ${financialState.className}`}>{formatMoney(reservation.balanceAmount, detail.property.currency ?? "BRL")}</p>
         <p className={`mt-1 text-xs ${financialState.className}`} data-testid="pms-payment-state">{financialState.label}</p>
       </div>
     </div>
    <section className="rounded-md border bg-muted/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold">Histórico de ajustes</h3><p className="text-xs text-muted-foreground">Alterações no valor recebido ficam registradas para conferência.</p></div>
        <Badge variant="outline">{detail.paymentAdjustments.length} registro(s)</Badge>
      </div>
      {detail.paymentAdjustments.length > 0 && (
        <div className="mt-3 space-y-2">
          {detail.paymentAdjustments.map((adjustment) => (
            <div key={adjustment.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded border bg-background px-3 py-2 text-xs">
              <span>{formatMoney(adjustment.previousPaidAmount, detail.property.currency ?? "BRL")} → {formatMoney(adjustment.newPaidAmount, detail.property.currency ?? "BRL")}</span>
              <span className={adjustment.deltaAmount < 0 ? "text-destructive" : "text-primary"}>{adjustment.deltaAmount < 0 ? "Estorno" : "Recebimento"} {formatMoney(Math.abs(adjustment.deltaAmount), detail.property.currency ?? "BRL")}</span>
              <span className="text-muted-foreground">{adjustment.reason}</span>
              <time className="text-muted-foreground">{formatDate(adjustment.createdAt)}</time>
            </div>
          ))}
        </div>
      )}
    </section>
    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <section className="space-y-3"><div><h3 className="text-sm font-semibold">Itens e unidades</h3><p className="text-xs text-muted-foreground">Associe cada item a uma unidade para orientar a recepção.</p></div><div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Quarto</TableHead><TableHead>Hóspedes</TableHead><TableHead>Unidade</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{detail.items.map((item) => { const matchingUnits = units.filter((unit) => unit.roomType.id === item.roomTypeId); return <TableRow key={item.id}><TableCell><div className="font-medium">{item.roomType?.name ?? "Tipo de quarto"}</div><div className="text-xs text-muted-foreground">{item.quantity} unidade(s)</div></TableCell><TableCell className="text-sm">{item.adults} adultos{item.children ? ` · ${item.children} crianças` : ""}</TableCell><TableCell>{unitsLoading ? <div className="h-8 w-40 animate-pulse rounded bg-muted" /> : <select aria-label={`Unidade para ${item.roomType?.name ?? "item"}`} data-testid={`select-unit-${item.id}`} className="h-8 w-full min-w-[150px] rounded-md border bg-background px-2 text-xs" value={currentAssignment(item)} onChange={(event) => onAssignmentChange(item.id, event.target.value)}><option value="">Sem unidade</option>{matchingUnits.map((unit) => <option key={unit.id} value={unit.id}>{unitLabel(unit)}</option>)}</select>}</TableCell><TableCell className="text-right font-medium">{formatMoney(item.total, detail.property.currency ?? "BRL")}</TableCell></TableRow>; })}{detail.items.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">Nenhum item de quarto nesta reserva.</TableCell></TableRow>}</TableBody></Table></div><div className="flex justify-end"><Button type="button" size="sm" data-testid="button-save-assignments" onClick={onSaveAssignments} disabled={savingAssignments || unitsLoading}><Save className="mr-2 h-4 w-4" />{savingAssignments ? "Salvando..." : "Salvar alocação"}</Button></div></section>
      <section className="space-y-3"><div><h3 className="text-sm font-semibold">Hóspedes principais</h3><p className="text-xs text-muted-foreground">Informações registradas na criação da reserva.</p></div><div className="space-y-2">{detail.guests.map((guest, index) => { const guestType = guest.guestType.toLowerCase(); return <div key={guest.id ?? `${guest.fullName}-${index}`} className="flex items-center gap-3 rounded-md border p-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-medium">{guest.fullName}</p><p className="text-xs capitalize text-muted-foreground">{guestType === "adult" ? "Adulto" : guestType}</p></div><Check className="ml-auto h-4 w-4 text-primary" /></div>; })}{detail.guests.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhum hóspede informado.</p>}</div><div className="rounded-md bg-muted/30 p-3 text-sm"><div className="flex items-center gap-2 font-medium"><MapPin className="h-4 w-4 text-primary" /> {detail.property.name}</div><p className="mt-1 pl-6 text-xs text-muted-foreground">{detail.property.city}{detail.property.state ? ` · ${detail.property.state}` : ""} · Check-in {detail.property.checkInTime ?? "—"} · Check-out {detail.property.checkOutTime ?? "—"}</p></div></section>
    </div>
  </div>;
}

function DetailMetric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-md border bg-muted/20 p-3"><div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{icon}{label}</div><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>;
}
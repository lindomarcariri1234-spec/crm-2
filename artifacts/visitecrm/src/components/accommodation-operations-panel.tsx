import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, History, LockKeyhole, Plus, RefreshCw, BedDouble, Boxes, Trash2 } from "lucide-react";

type Room = {
  id: string;
  name: string;
  category: string;
  capacity: number;
  pricePerNight: number | null;
  occupied?: number;
  available?: number;
  blocked?: boolean;
};

type Rate = {
  id: string;
  roomId: string | null;
  reservationId: string | null;
  category: string | null;
  validFrom: string;
  validTo: string;
  pricingType: string;
  amount: number;
  priority: number;
  status: string;
};

type Block = {
  id: string;
  roomId: string | null;
  startDate: string;
  endDate: string;
  blockType: string;
  reason: string;
};

type Bed = {
  id: string;
  name: string;
  bedType: string;
  capacity: number;
  status: string;
};

type InventoryRow = {
  id: string;
  inventoryDate: string;
  status: string;
  capacityOverride: number | null;
  blockedReason: string | null;
  maintenanceReason: string | null;
};

type RateHistory = {
  id: string;
  rateId: string;
  action: string;
  previousValue: number | null;
  newValue: number | null;
  previousPeriod: string | null;
  newPeriod: string | null;
  changeReason: string | null;
  createdAt: string;
};

type Availability = {
  nights: number;
  rooms: Room[];
};

type Stay = {
  id: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: string;
  source: string;
  frozenTotal: number | null;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? body?.message ?? "Não foi possível concluir a operação");
  return body as T;
}

function isoToday(offset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function AccommodationOperationsPanel({ accommodationId }: { accommodationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checkIn, setCheckIn] = useState(isoToday(1));
  const [checkOut, setCheckOut] = useState(isoToday(2));
  const [rateForm, setRateForm] = useState({
    roomId: "",
    category: "",
    reservationId: "",
    validFrom: isoToday(1),
    validTo: isoToday(31),
    pricingType: "PER_ROOM",
    amount: "",
    priority: "0",
  });
  const [blockForm, setBlockForm] = useState({
    roomId: "",
    startDate: isoToday(1),
    endDate: isoToday(2),
    blockType: "maintenance",
    reason: "",
  });
  const [bedsRoomId, setBedsRoomId] = useState("");
  const [bedForm, setBedForm] = useState({ name: "", bedType: "single", capacity: "1" });
  const [inventoryRoomId, setInventoryRoomId] = useState("");
  const [inventoryForm, setInventoryForm] = useState({
    inventoryDate: isoToday(1),
    status: "available",
    capacityOverride: "",
    reason: "",
  });

  const ratesQuery = useQuery({
    queryKey: ["accommodation-rates", accommodationId],
    queryFn: () => requestJson<Rate[]>(`/api/accommodations/${accommodationId}/rates`),
  });
  const availabilityQuery = useQuery({
    queryKey: ["accommodation-availability", accommodationId, checkIn, checkOut],
    queryFn: () => requestJson<Availability>(`/api/accommodations/${accommodationId}/availability?checkIn=${checkIn}&checkOut=${checkOut}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(checkIn) && /^\d{4}-\d{2}-\d{2}$/.test(checkOut) && checkIn < checkOut,
  });
  const blocksQuery = useQuery({
    queryKey: ["accommodation-blocks", accommodationId],
    queryFn: () => requestJson<Block[]>(`/api/accommodations/${accommodationId}/blocks`),
  });
  const historyQuery = useQuery({
    queryKey: ["accommodation-rate-history", accommodationId],
    queryFn: () => requestJson<RateHistory[]>(`/api/accommodations/${accommodationId}/rate-history`),
  });
  const bedsQuery = useQuery({
    queryKey: ["accommodation-beds", bedsRoomId],
    queryFn: () => requestJson<Bed[]>(`/api/accommodation-rooms/${bedsRoomId}/beds`),
    enabled: Boolean(bedsRoomId),
  });
  const inventoryQuery = useQuery({
    queryKey: ["accommodation-inventory", inventoryRoomId, checkIn, checkOut],
    queryFn: () => requestJson<InventoryRow[]>(`/api/accommodation-rooms/${inventoryRoomId}/inventory?from=${checkIn}&to=${checkOut}`),
    enabled: Boolean(inventoryRoomId),
  });
  const staysQuery = useQuery({
    queryKey: ["accommodation-stays", accommodationId],
    queryFn: () => requestJson<Stay[]>(`/api/accommodation-stays?accommodationId=${accommodationId}`),
  });
  const createRate = useMutation({
    mutationFn: () => requestJson(`/api/accommodations/${accommodationId}/rates`, {
      method: "POST",
      body: JSON.stringify({
        ...rateForm,
        roomId: rateForm.roomId || null,
        reservationId: rateForm.reservationId || null,
        category: rateForm.category || null,
        amount: Number(rateForm.amount),
        priority: Number(rateForm.priority) || 0,
      }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accommodation-rates", accommodationId] });
      toast({ title: "Tarifa criada", description: "O valor ficou registrado com histórico." });
      setRateForm(f => ({ ...f, amount: "", roomId: "", category: "" }));
    },
    onError: (error: Error) => toast({ title: "Não foi possível criar a tarifa", description: error.message, variant: "destructive" }),
  });
  const createBlock = useMutation({
    mutationFn: () => requestJson(`/api/accommodations/${accommodationId}/blocks`, {
      method: "POST",
      body: JSON.stringify({ ...blockForm, roomId: blockForm.roomId || null }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accommodation-availability", accommodationId] });
      queryClient.invalidateQueries({ queryKey: ["accommodation-blocks", accommodationId] });
      toast({ title: "Bloqueio criado", description: "O quarto não será vendido nesse período." });
      setBlockForm(f => ({ ...f, reason: "" }));
    },
    onError: (error: Error) => toast({ title: "Não foi possível criar o bloqueio", description: error.message, variant: "destructive" }),
  });
  const updateRate = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "inactive" }) =>
      requestJson(`/api/accommodation-rates/${id}`, { method: "PATCH", body: JSON.stringify({ status, changeReason: status === "inactive" ? "Inativada no PMS" : "Reativada no PMS" }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accommodation-rates", accommodationId] });
      queryClient.invalidateQueries({ queryKey: ["accommodation-rate-history", accommodationId] });
      toast({ title: "Tarifa atualizada" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível atualizar a tarifa", description: error.message, variant: "destructive" }),
  });
  const deleteBlock = useMutation({
    mutationFn: (id: string) => requestJson(`/api/accommodation-room-blocks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accommodation-blocks", accommodationId] });
      queryClient.invalidateQueries({ queryKey: ["accommodation-availability", accommodationId] });
      toast({ title: "Bloqueio removido" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível remover o bloqueio", description: error.message, variant: "destructive" }),
  });
  const createBed = useMutation({
    mutationFn: () => requestJson(`/api/accommodation-rooms/${bedsRoomId}/beds`, { method: "POST", body: JSON.stringify({ ...bedForm, capacity: Number(bedForm.capacity) }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accommodation-beds", bedsRoomId] });
      setBedForm({ name: "", bedType: "single", capacity: "1" });
      toast({ title: "Cama adicionada" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível adicionar a cama", description: error.message, variant: "destructive" }),
  });
  const deleteBed = useMutation({
    mutationFn: (id: string) => requestJson(`/api/accommodation-room-beds/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accommodation-beds", bedsRoomId] });
      toast({ title: "Cama removida" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível remover a cama", description: error.message, variant: "destructive" }),
  });
  const saveInventory = useMutation({
    mutationFn: () => requestJson(`/api/accommodation-rooms/${inventoryRoomId}/inventory`, {
      method: "PUT",
      body: JSON.stringify({
        inventoryDate: inventoryForm.inventoryDate,
        status: inventoryForm.status,
        capacityOverride: inventoryForm.capacityOverride === "" ? null : Number(inventoryForm.capacityOverride),
        blockedReason: inventoryForm.status === "blocked" ? inventoryForm.reason || null : null,
        maintenanceReason: inventoryForm.status === "maintenance" ? inventoryForm.reason || null : null,
      }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accommodation-inventory", inventoryRoomId] });
      queryClient.invalidateQueries({ queryKey: ["accommodation-availability", accommodationId] });
      toast({ title: "Inventário diário salvo" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível salvar o inventário", description: error.message, variant: "destructive" }),
  });
  const stayAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "check-in" | "check-out" }) =>
      requestJson(`/api/accommodation-stays/${id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accommodation-stays", accommodationId] });
      queryClient.invalidateQueries({ queryKey: ["accommodation-availability", accommodationId] });
      toast({ title: "Estadia atualizada" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível atualizar a estadia", description: error.message, variant: "destructive" }),
  });

  const rooms = availabilityQuery.data?.rooms ?? [];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-primary" /> Disponibilidade por período</p>
             <p className="text-xs text-muted-foreground mt-1">A consulta soma estadias diretas, vendas da vitrine e alocações ativas de reservas de excursão.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => availabilityQuery.refetch()} disabled={availabilityQuery.isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${availabilityQuery.isFetching ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Entrada</Label><Input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} /></div>
          <div className="space-y-1"><Label>Saída</Label><Input type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)} /></div>
        </div>
        {availabilityQuery.isError ? <p className="text-sm text-destructive">Não foi possível carregar a disponibilidade.</p> : (
          <div className="rounded-md border bg-background">
            <Table>
              <TableHeader><TableRow><TableHead>Quarto</TableHead><TableHead>Categoria</TableHead><TableHead>Capacidade</TableHead><TableHead>Ocupado</TableHead><TableHead>Disponível</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {rooms.map(room => (
                  <TableRow key={room.id}>
                    <TableCell className="font-medium">{room.name}</TableCell>
                    <TableCell>{room.category}</TableCell>
                    <TableCell>{room.capacity}</TableCell>
                    <TableCell>{room.occupied ?? 0}</TableCell>
                    <TableCell className="font-semibold">{room.available ?? 0}</TableCell>
                    <TableCell><Badge variant={room.blocked ? "secondary" : "default"}>{room.blocked ? "Bloqueado" : "Disponível"}</Badge></TableCell>
                  </TableRow>
                ))}
                {rooms.length === 0 && <TableRow><TableCell colSpan={6} className="py-5 text-center text-sm text-muted-foreground">Nenhum quarto cadastrado.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border p-4 space-y-3">
          <div><p className="flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4 text-primary" /> Nova tarifa</p><p className="text-xs text-muted-foreground mt-1">A tarifa mais específica vence: quarto, categoria e prioridade.</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Quarto (opcional)</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={rateForm.roomId} onChange={e => setRateForm(f => ({ ...f, roomId: e.target.value }))}><option value="">Todos os quartos</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></div>
            <div className="space-y-1"><Label>Categoria (opcional)</Label><Input value={rateForm.category} placeholder="Standard" onChange={e => setRateForm(f => ({ ...f, category: e.target.value }))} /></div>
             <div className="col-span-2 space-y-1"><Label>Reserva específica (opcional)</Label><Input value={rateForm.reservationId} placeholder="ID da reserva para aplicar somente nela" onChange={e => setRateForm(f => ({ ...f, reservationId: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Início</Label><Input type="date" value={rateForm.validFrom} onChange={e => setRateForm(f => ({ ...f, validFrom: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Fim</Label><Input type="date" value={rateForm.validTo} onChange={e => setRateForm(f => ({ ...f, validTo: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Tipo</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={rateForm.pricingType} onChange={e => setRateForm(f => ({ ...f, pricingType: e.target.value }))}><option value="PER_ROOM">Por quarto</option><option value="PER_PERSON">Por Pax</option><option value="PER_BED">Por cama</option><option value="PACKAGE">Pacote</option></select></div>
            <div className="space-y-1"><Label>Valor por unidade</Label><Input type="number" min={0} step={0.01} value={rateForm.amount} onChange={e => setRateForm(f => ({ ...f, amount: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Prioridade</Label><Input type="number" value={rateForm.priority} onChange={e => setRateForm(f => ({ ...f, priority: e.target.value }))} /></div>
          </div>
          <Button onClick={() => createRate.mutate()} disabled={createRate.isPending || !rateForm.amount || rateForm.validFrom >= rateForm.validTo}>{createRate.isPending ? "Salvando..." : "Salvar tarifa"}</Button>
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <div><p className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole className="h-4 w-4 text-primary" /> Bloquear inventário</p><p className="text-xs text-muted-foreground mt-1">Use para manutenção, uso próprio ou bloqueio futuro.</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1"><Label>Quarto</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={blockForm.roomId} onChange={e => setBlockForm(f => ({ ...f, roomId: e.target.value }))}><option value="">Todos os quartos</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></div>
            <div className="space-y-1"><Label>Início</Label><Input type="date" value={blockForm.startDate} onChange={e => setBlockForm(f => ({ ...f, startDate: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Fim</Label><Input type="date" value={blockForm.endDate} onChange={e => setBlockForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Tipo</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={blockForm.blockType} onChange={e => setBlockForm(f => ({ ...f, blockType: e.target.value }))}><option value="maintenance">Manutenção</option><option value="owner_use">Uso próprio</option><option value="temporary">Bloqueio temporário</option></select></div>
            <div className="space-y-1"><Label>Motivo</Label><Input value={blockForm.reason} placeholder="Ex.: reforma do banheiro" onChange={e => setBlockForm(f => ({ ...f, reason: e.target.value }))} /></div>
          </div>
          <Button variant="outline" onClick={() => createBlock.mutate()} disabled={createBlock.isPending || !blockForm.reason.trim() || blockForm.startDate >= blockForm.endDate}>{createBlock.isPending ? "Bloqueando..." : "Criar bloqueio"}</Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border p-4 space-y-3">
          <div><p className="flex items-center gap-2 text-sm font-semibold"><Boxes className="h-4 w-4 text-primary" /> Inventário por data</p><p className="text-xs text-muted-foreground mt-1">Ajuste capacidade, fechamento ou manutenção de um quarto em uma data específica.</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1"><Label>Quarto</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={inventoryRoomId} onChange={e => setInventoryRoomId(e.target.value)}><option value="">Selecione</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></div>
            <div className="space-y-1"><Label>Data</Label><Input type="date" value={inventoryForm.inventoryDate} onChange={e => setInventoryForm(f => ({ ...f, inventoryDate: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Status</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={inventoryForm.status} onChange={e => setInventoryForm(f => ({ ...f, status: e.target.value }))}><option value="available">Disponível</option><option value="blocked">Bloqueado</option><option value="maintenance">Manutenção</option><option value="closed">Fechado</option></select></div>
            <div className="space-y-1"><Label>Capacidade nesta data</Label><Input type="number" min={0} value={inventoryForm.capacityOverride} placeholder="Padrão do quarto" onChange={e => setInventoryForm(f => ({ ...f, capacityOverride: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Motivo</Label><Input value={inventoryForm.reason} placeholder="Opcional" onChange={e => setInventoryForm(f => ({ ...f, reason: e.target.value }))} /></div>
          </div>
          <Button onClick={() => saveInventory.mutate()} disabled={saveInventory.isPending || !inventoryRoomId || !inventoryForm.inventoryDate}>{saveInventory.isPending ? "Salvando..." : "Salvar inventário"}</Button>
          {inventoryRoomId && <div className="rounded-md border"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Status</TableHead><TableHead>Capacidade</TableHead></TableRow></TableHeader><TableBody>{(inventoryQuery.data ?? []).map(row => <TableRow key={row.id}><TableCell>{row.inventoryDate}</TableCell><TableCell>{row.status === "maintenance" ? "Manutenção" : row.status === "blocked" ? "Bloqueado" : row.status === "closed" ? "Fechado" : "Disponível"}</TableCell><TableCell>{row.capacityOverride ?? "Padrão"}</TableCell></TableRow>)}{(inventoryQuery.data ?? []).length === 0 && <TableRow><TableCell colSpan={3} className="py-3 text-center text-xs text-muted-foreground">Nenhum ajuste no período consultado.</TableCell></TableRow>}</TableBody></Table></div>}
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <div><p className="flex items-center gap-2 text-sm font-semibold"><BedDouble className="h-4 w-4 text-primary" /> Camas individuais</p><p className="text-xs text-muted-foreground mt-1">Cadastre e acompanhe as camas que podem ser alocadas separadamente.</p></div>
          <div className="grid grid-cols-3 gap-2">
            <select className="h-9 rounded-md border bg-background px-3 text-sm col-span-3" value={bedsRoomId} onChange={e => setBedsRoomId(e.target.value)}><option value="">Selecione um quarto</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select>
            <Input placeholder="Nome (ex.: Cama 1)" value={bedForm.name} onChange={e => setBedForm(f => ({ ...f, name: e.target.value }))} />
            <select className="h-9 rounded-md border bg-background px-3 text-sm" value={bedForm.bedType} onChange={e => setBedForm(f => ({ ...f, bedType: e.target.value }))}><option value="single">Solteiro</option><option value="bunk">Beliche</option><option value="double">Casal</option></select>
            <Input type="number" min={1} max={4} value={bedForm.capacity} onChange={e => setBedForm(f => ({ ...f, capacity: e.target.value }))} />
          </div>
          <Button variant="outline" onClick={() => createBed.mutate()} disabled={createBed.isPending || !bedsRoomId || !bedForm.name.trim()}>{createBed.isPending ? "Salvando..." : "Adicionar cama"}</Button>
          <div className="rounded-md border"><Table><TableHeader><TableRow><TableHead>Cama</TableHead><TableHead>Tipo</TableHead><TableHead>Cap.</TableHead><TableHead /></TableRow></TableHeader><TableBody>{(bedsQuery.data ?? []).map(bed => <TableRow key={bed.id}><TableCell>{bed.name}</TableCell><TableCell>{bed.bedType}</TableCell><TableCell>{bed.capacity}</TableCell><TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => deleteBed.mutate(bed.id)} disabled={deleteBed.isPending} aria-label={`Remover ${bed.name}`}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell></TableRow>)}{bedsRoomId && (bedsQuery.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="py-3 text-center text-xs text-muted-foreground">Nenhuma cama cadastrada.</TableCell></TableRow>}{!bedsRoomId && <TableRow><TableCell colSpan={4} className="py-3 text-center text-xs text-muted-foreground">Selecione um quarto.</TableCell></TableRow>}</TableBody></Table></div>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole className="h-4 w-4 text-primary" /> Bloqueios ativos e futuros</p><p className="text-xs text-muted-foreground mt-1">Os bloqueios continuam separados do inventário diário e podem ser retirados sem apagar o quarto.</p></div><Badge variant="outline">{blocksQuery.data?.length ?? 0}</Badge></div>
        <div className="rounded-md border"><Table><TableHeader><TableRow><TableHead>Quarto</TableHead><TableHead>Período</TableHead><TableHead>Tipo</TableHead><TableHead>Motivo</TableHead><TableHead /></TableRow></TableHeader><TableBody>{(blocksQuery.data ?? []).map(block => <TableRow key={block.id}><TableCell>{block.roomId ? rooms.find(room => room.id === block.roomId)?.name ?? "Quarto" : "Todos os quartos"}</TableCell><TableCell>{block.startDate} a {block.endDate}</TableCell><TableCell>{block.blockType}</TableCell><TableCell>{block.reason}</TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => deleteBlock.mutate(block.id)} disabled={deleteBlock.isPending}>Remover</Button></TableCell></TableRow>)}{(blocksQuery.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="py-5 text-center text-sm text-muted-foreground">Nenhum bloqueio cadastrado.</TableCell></TableRow>}</TableBody></Table></div>
      </div>

      <div className="rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><p className="text-sm font-semibold">Estadias desta hospedagem</p><p className="text-xs text-muted-foreground mt-1">Inclui vendas diretas e estadias vinculadas a excursões.</p></div>
          <Badge variant="outline">{staysQuery.data?.length ?? 0} registro(s)</Badge>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Período</TableHead><TableHead>Origem</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {(staysQuery.data ?? []).map(stay => (
                <TableRow key={stay.id}>
                  <TableCell>{stay.checkIn} a {stay.checkOut} <span className="text-xs text-muted-foreground">({stay.nights} noite(s))</span></TableCell>
                  <TableCell>{stay.source === "STORE_ORDER" ? "Venda direta" : stay.source === "TRIP_RESERVATION" ? "Excursão" : stay.source}</TableCell>
                  <TableCell><Badge variant={stay.status === "checked_in" ? "default" : "secondary"}>{stay.status === "checked_in" ? "Check-in" : stay.status === "checked_out" ? "Check-out" : stay.status === "held" ? "Pendente" : stay.status}</Badge></TableCell>
                  <TableCell>{stay.frozenTotal == null ? "—" : `R$ ${Number(stay.frozenTotal).toFixed(2).replace(".", ",")}`}</TableCell>
                  <TableCell className="text-right">
                    {["held", "confirmed"].includes(stay.status) && <Button size="sm" variant="outline" onClick={() => stayAction.mutate({ id: stay.id, action: "check-in" })} disabled={stayAction.isPending}>Check-in</Button>}
                    {stay.status === "checked_in" && <Button size="sm" variant="outline" onClick={() => stayAction.mutate({ id: stay.id, action: "check-out" })} disabled={stayAction.isPending}>Check-out</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {(staysQuery.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="py-5 text-center text-sm text-muted-foreground">Nenhuma estadia encontrada.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <p className="text-sm font-semibold mb-3">Tarifas cadastradas</p>
        <div className="rounded-md border">
          <Table>
             <TableHeader><TableRow><TableHead>Período</TableHead><TableHead>Aplicação</TableHead><TableHead>Tipo</TableHead><TableHead>Valor</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
             <TableBody>{(ratesQuery.data ?? []).map(rate => <TableRow key={rate.id}><TableCell>{rate.validFrom} a {rate.validTo}</TableCell><TableCell>{rate.reservationId ? `Reserva ${rate.reservationId}` : rate.roomId ? rooms.find(room => room.id === rate.roomId)?.name ?? "Quarto" : rate.category ?? "Hospedagem"}</TableCell><TableCell>{rate.pricingType === "PER_PERSON" ? "Por Pax" : rate.pricingType === "PER_BED" ? "Por cama" : rate.pricingType === "PACKAGE" ? "Pacote" : "Por quarto"}</TableCell><TableCell>R$ {rate.amount.toFixed(2).replace(".", ",")}</TableCell><TableCell><Badge variant={rate.status === "active" ? "default" : "secondary"}>{rate.status === "active" ? "Ativa" : "Inativa"}</Badge></TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => updateRate.mutate({ id: rate.id, status: rate.status === "active" ? "inactive" : "active" })} disabled={updateRate.isPending}>{rate.status === "active" ? "Inativar" : "Ativar"}</Button></TableCell></TableRow>)}{(ratesQuery.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="py-5 text-center text-sm text-muted-foreground">Nenhuma tarifa por período cadastrada.</TableCell></TableRow>}</TableBody>
          </Table>
        </div>
      </div>

       <div className="rounded-lg border p-4">
         <p className="flex items-center gap-2 text-sm font-semibold mb-3"><History className="h-4 w-4 text-primary" /> Histórico de diárias</p>
         <div className="rounded-md border">
           <Table>
             <TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Alteração</TableHead><TableHead>Período</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
             <TableBody>{(historyQuery.data ?? []).map(item => <TableRow key={item.id}><TableCell>{new Date(item.createdAt).toLocaleString("pt-BR")}</TableCell><TableCell>{item.previousValue == null ? "Criada" : `R$ ${item.previousValue.toFixed(2).replace(".", ",")} → R$ ${(item.newValue ?? 0).toFixed(2).replace(".", ",")}`}</TableCell><TableCell>{item.newPeriod ?? "—"}</TableCell><TableCell>{item.changeReason ?? "—"}</TableCell></TableRow>)}{(historyQuery.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="py-5 text-center text-sm text-muted-foreground">Nenhuma alteração registrada.</TableCell></TableRow>}</TableBody>
           </Table>
         </div>
       </div>
    </div>
  );
}
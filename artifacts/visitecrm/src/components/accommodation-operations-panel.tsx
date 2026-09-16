import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, LockKeyhole, Plus, RefreshCw } from "lucide-react";

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
  category: string | null;
  validFrom: string;
  validTo: string;
  pricingType: string;
  amount: number;
  priority: number;
  status: string;
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
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function AccommodationOperationsPanel({ accommodationId }: { accommodationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checkIn, setCheckIn] = useState(isoToday(1));
  const [checkOut, setCheckOut] = useState(isoToday(2));
  const [rateForm, setRateForm] = useState({
    roomId: "",
    category: "",
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

  const ratesQuery = useQuery({
    queryKey: ["accommodation-rates", accommodationId],
    queryFn: () => requestJson<Rate[]>(`/api/accommodations/${accommodationId}/rates`),
  });
  const availabilityQuery = useQuery({
    queryKey: ["accommodation-availability", accommodationId, checkIn, checkOut],
    queryFn: () => requestJson<Availability>(`/api/accommodations/${accommodationId}/availability?checkIn=${checkIn}&checkOut=${checkOut}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(checkIn) && /^\d{4}-\d{2}-\d{2}$/.test(checkOut) && checkIn < checkOut,
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
      toast({ title: "Bloqueio criado", description: "O quarto não será vendido nesse período." });
      setBlockForm(f => ({ ...f, reason: "" }));
    },
    onError: (error: Error) => toast({ title: "Não foi possível criar o bloqueio", description: error.message, variant: "destructive" }),
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
            <p className="text-xs text-muted-foreground mt-1">A consulta considera estadias, bloqueios e manutenção. O estoque não depende da excursão.</p>
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
            <TableHeader><TableRow><TableHead>Período</TableHead><TableHead>Aplicação</TableHead><TableHead>Tipo</TableHead><TableHead>Valor</TableHead><TableHead>Prioridade</TableHead></TableRow></TableHeader>
            <TableBody>{(ratesQuery.data ?? []).map(rate => <TableRow key={rate.id}><TableCell>{rate.validFrom} a {rate.validTo}</TableCell><TableCell>{rate.roomId ? rooms.find(room => room.id === rate.roomId)?.name ?? "Quarto" : rate.category ?? "Hospedagem"}</TableCell><TableCell>{rate.pricingType === "PER_PERSON" ? "Por Pax" : rate.pricingType === "PER_BED" ? "Por cama" : rate.pricingType === "PACKAGE" ? "Pacote" : "Por quarto"}</TableCell><TableCell>R$ {rate.amount.toFixed(2).replace(".", ",")}</TableCell><TableCell>{rate.priority}</TableCell></TableRow>)}{(ratesQuery.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="py-5 text-center text-sm text-muted-foreground">Nenhuma tarifa por período cadastrada.</TableCell></TableRow>}</TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
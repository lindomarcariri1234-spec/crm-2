import { useState } from "react";
import {
  useListAccommodations,
  useCreateAccommodation,
  useUpdateAccommodation,
  useDeleteAccommodation,
  useListAccommodationRooms,
  useCreateAccommodationRoom,
  useUpdateAccommodationRoom,
  useDeleteAccommodationRoom,
  useListAuditLogs,
} from "@workspace/api-client-react";
import type {
  Accommodation,
  AccommodationRoom,
  AuditLog,
  CreateAccommodationRoomBody,
  CreateAccommodationBody,
  UpdateAccommodationBody,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ListLoadErrorRow } from "@/components/list-load-error";
import { Plus, Pencil, Trash2, Search, Hotel, Star, Images, ChevronLeft, ChevronRight, X, BedDouble } from "lucide-react";
import { GalleryUpload } from "@/components/gallery-upload";
import { AccommodationHelp } from "@/components/accommodation-help";
import { formatCurrencyBRL as formatCurrency } from "@/lib/utils";

const ACCOMMODATION_TYPES = ["Hotel", "Pousada", "Resort", "Hostel", "Chácara", "Chalé", "Outro"];
const AMENITY_OPTIONS = [
  "Café da manhã",
  "Piscina",
  "Wi-Fi",
  "Estacionamento",
  "Academia",
  "Spa",
  "Restaurante",
  "Ar-condicionado",
];
const STATUS_OPTIONS = ["active", "inactive"];
const statusLabel: Record<string, string> = { active: "Ativo", inactive: "Inativo" };
const roomAuditActionLabel: Record<string, string> = {
  room_created: "Criado",
  room_updated: "Editado",
  room_activated: "Ativado",
  room_deactivated: "Desativado",
  room_deleted: "Excluído",
};

function roomAuditDetails(log: AuditLog) {
  const value = (log.after ?? log.before);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type RoomMutationOperation = "save" | "delete" | "status";
type AccommodationMutationOperation = "create" | "update" | "delete";

function accommodationMutationErrorMessage(error: unknown, operation: AccommodationMutationOperation) {
  const responseData = (error as { response?: { data?: { code?: string } } })?.response?.data;
  const code = responseData?.code;
  if (code === "ACCOMMODATION_NOT_FOUND" || code === "NOT_FOUND") {
    return "Esta hospedagem não está mais disponível. Atualize a lista e tente novamente.";
  }
  if (code === "FORBIDDEN" || code === "FORBIDDEN_ROLE") {
    return "Você não tem permissão para alterar esta hospedagem.";
  }
  if (code === "VALIDATION_ERROR") {
    return "Confira os dados da hospedagem e tente novamente.";
  }
  if (code === "ACCOMMODATION_CREATE_FAILED") {
    return "Não foi possível criar a hospedagem. Tente novamente.";
  }
  if (operation === "delete") {
    return "Não foi possível excluir a hospedagem. A exclusão não foi aplicada. Tente novamente.";
  }
  return operation === "create"
    ? "Não foi possível criar a hospedagem. A alteração não foi aplicada. Tente novamente."
    : "Não foi possível salvar a hospedagem. A alteração não foi aplicada. Tente novamente.";
}

function roomMutationErrorMessage(error: unknown, operation: RoomMutationOperation, nextStatus?: string) {
  const responseData = (error as { response?: { data?: { code?: string } } })?.response?.data;
  const code = responseData?.code;
  if (code === "ROOM_CAPACITY_CONFLICT") {
    return "A capacidade não pode ser menor que a ocupação atual.";
  }
  if (code === "ROOM_OCCUPIED") {
    return "Não é possível excluir um quarto ocupado.";
  }
  if (code === "NOT_FOUND" || code === "ROOM_NOT_FOUND") {
    return "Este quarto não está mais disponível. Atualize a lista e tente novamente.";
  }
  if (code === "FORBIDDEN" || code === "FORBIDDEN_ROLE") {
    return "Você não tem permissão para alterar este quarto.";
  }
  if (operation === "status") {
    return nextStatus === "active"
      ? "Não foi possível ativar o quarto. O status não foi alterado. Tente novamente."
      : "Não foi possível inativar o quarto. O status não foi alterado. Tente novamente.";
  }
  return operation === "delete"
    ? "Não foi possível excluir o quarto. A exclusão não foi aplicada. Tente novamente."
    : "Não foi possível salvar o quarto. A alteração não foi aplicada. Tente novamente.";
}


export default function Hospedagens() {
  const { toast } = useToast();
  const { data: accommodations = [], isError, refetch } = useListAccommodations();
  const createAcc = useCreateAccommodation();
  const updateAcc = useUpdateAccommodation();
  const deleteAcc = useDeleteAccommodation();
  const [roomsFor, setRoomsFor] = useState<Accommodation | null>(null);
  const [roomForm, setRoomForm] = useState<CreateAccommodationRoomBody>({ name: "", category: "standard", capacity: 2 });
  const [editingRoom, setEditingRoom] = useState<AccommodationRoom | null>(null);
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const { data: rooms = [], refetch: refetchRooms } = useListAccommodationRooms(roomsFor?.id ?? "", {
    query: { enabled: !!roomsFor?.id, queryKey: ["accommodation-rooms", roomsFor?.id] },
  });
  const {
    data: roomAuditLogs = [],
    isLoading: roomAuditLoading,
    isError: roomAuditError,
    refetch: refetchRoomAuditLogs,
  } = useListAuditLogs(
    roomsFor
      ? {
          accommodationId: roomsFor.id,
          from: auditFrom || undefined,
          to: auditTo || undefined,
        }
      : undefined,
    {
      query: {
        enabled: !!roomsFor?.id,
        queryKey: ["accommodation-room-audit", roomsFor?.id, auditFrom, auditTo],
      },
    },
  );
  const createRoom = useCreateAccommodationRoom();
  const updateRoom = useUpdateAccommodationRoom();
  const deleteRoom = useDeleteAccommodationRoom();

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Accommodation | null>(null);
  const [form, setForm] = useState<Partial<CreateAccommodationBody & UpdateAccommodationBody>>({});
  const [amenities, setAmenities] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [galleryLightbox, setGalleryLightbox] = useState<{ name: string; urls: string[]; index: number } | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const filtered = accommodations.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.city ?? "").toLowerCase().includes(search.toLowerCase()) ||
      a.type.toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setEditing(null);
    setForm({});
    setAmenities([]);
    setGalleryUrls([]);
    setModalOpen(true);
  }

  function openEdit(a: Accommodation) {
    setEditing(a);
    setForm({
      name: a.name,
      pricePerNight: a.pricePerNight ?? undefined,
      totalRooms: a.totalRooms ?? undefined,
      status: a.status,
    });
    setAmenities(a.amenities ?? []);
    setGalleryUrls(a.gallery ?? []);
    setModalOpen(true);
  }

  function toggleAmenity(a: string) {
    setAmenities((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  async function handleSave() {
    try {
      if (editing) {
        await updateAcc.mutateAsync({
          id: editing.id,
          data: {
            name: form.name ?? undefined,
            pricePerNight: form.pricePerNight ?? undefined,
            status: (form as UpdateAccommodationBody).status ?? undefined,
            totalRooms: form.totalRooms ?? undefined,
            amenities,
            galleryUrls,
          },
        });
        toast({ title: "Hospedagem atualizada" });
      } else {
        if (!form.name || !(form as CreateAccommodationBody).type) {
          toast({ title: "Preencha nome e tipo", variant: "destructive" });
          return;
        }
        await createAcc.mutateAsync({
          data: {
            name: form.name!,
            type: (form as CreateAccommodationBody).type!,
            address: (form as CreateAccommodationBody).address ?? undefined,
            city: (form as CreateAccommodationBody).city ?? undefined,
            state: (form as CreateAccommodationBody).state ?? undefined,
            contactName: (form as CreateAccommodationBody).contactName ?? undefined,
            phone: (form as CreateAccommodationBody).phone ?? undefined,
            email: (form as CreateAccommodationBody).email ?? undefined,
            totalRooms: form.totalRooms ?? undefined,
            pricePerNight: form.pricePerNight ?? undefined,
            amenities,
            galleryUrls,
          },
        });
        toast({ title: "Hospedagem criada" });
      }
      setModalOpen(false);
      refetch();
    } catch (err: unknown) {
      toast({
        title: accommodationMutationErrorMessage(err, editing ? "update" : "create"),
        variant: "destructive",
      });
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAcc.mutateAsync({ id });
      toast({ title: "Hospedagem excluída" });
      setDeleteId(null);
      refetch();
    } catch (err: unknown) {
      toast({
        title: accommodationMutationErrorMessage(err, "delete"),
        variant: "destructive",
      });
    }
  }

  function openRooms(a: Accommodation) {
    setRoomsFor(a);
    setEditingRoom(null);
    setAuditFrom("");
    setAuditTo("");
    setRoomForm({ name: "", category: "standard", capacity: 2, pricePerNight: null, standardOccupancy: 2, currency: "BRL" });
  }

  async function handleRoomSave() {
    if (!roomsFor || !roomForm.name.trim()) return;
    try {
      if (editingRoom) {
        await updateRoom.mutateAsync({ id: editingRoom.id, data: roomForm });
      } else {
        await createRoom.mutateAsync({ id: roomsFor.id, data: roomForm });
      }
      setEditingRoom(null);
      setRoomForm({ name: "", category: "standard", capacity: 2, pricePerNight: null, standardOccupancy: 2, currency: "BRL" });
      await refetchRooms();
      toast({ title: editingRoom ? "Quarto atualizado" : "Quarto criado" });
    } catch (err: unknown) {
      toast({ title: roomMutationErrorMessage(err, "save"), variant: "destructive" });
    }
  }

  async function handleRoomDelete(room: AccommodationRoom) {
    try {
      await deleteRoom.mutateAsync({ id: room.id });
      await refetchRooms();
      toast({ title: "Quarto excluído" });
    } catch (err: unknown) {
      toast({ title: roomMutationErrorMessage(err, "delete"), variant: "destructive" });
    }
  }

  async function handleRoomStatusToggle(room: AccommodationRoom) {
    const nextStatus = room.status === "active" ? "inactive" : "active";
    try {
      await updateRoom.mutateAsync({ id: room.id, data: { status: nextStatus } });
      await Promise.all([refetchRooms(), refetchRoomAuditLogs()]);
      toast({ title: nextStatus === "active" ? "Quarto ativado" : "Quarto inativado" });
    } catch (err: unknown) {
      toast({ title: roomMutationErrorMessage(err, "status", nextStatus), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hospedagens</h1>
          <p className="text-sm text-muted-foreground">
            Base de referência com {accommodations.length} parceiro(s) para consulta comercial e operacional
          </p>
        </div>
        <Button data-testid="button-new-hospedagem" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Nova Hospedagem
        </Button>
      </div>

      <AccommodationHelp />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          data-testid="input-search-hospedagens"
          className="pl-9"
          placeholder="Buscar por nome, cidade, tipo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Cidade/UF</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Quartos</TableHead>
              <TableHead>Diária</TableHead>
              <TableHead>Avaliação</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <ListLoadErrorRow
                colSpan={9}
                onRetry={refetch}
                message="Não foi possível carregar as hospedagens."
              />
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                  <Hotel className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  Nenhuma hospedagem encontrada
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>{a.type}</TableCell>
                  <TableCell>
                    {a.city && a.state ? `${a.city}/${a.state}` : a.city ?? "—"}
                  </TableCell>
                  <TableCell>{a.contactName ?? "—"}</TableCell>
                  <TableCell>{a.totalRooms ?? "—"}</TableCell>
                  <TableCell>{formatCurrency(a.pricePerNight)}</TableCell>
                  <TableCell>
                    {a.rating != null ? (
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                        <span>{a.rating.toFixed(1)}</span>
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.status === "active" ? "default" : "secondary"}>
                      {statusLabel[a.status] ?? a.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {((a.gallery?.length ?? 0) > 0 || a.coverImage) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Ver fotos de ${a.name}`}
                          title={`Ver fotos (${(a.gallery?.length ?? 0) + (a.coverImage ? 1 : 0)})`}
                          onClick={() => {
                            const urls = [
                              ...(a.coverImage ? [a.coverImage] : []),
                              ...(a.gallery ?? []),
                            ];
                            setGalleryLightbox({ name: a.name, urls, index: 0 });
                          }}
                        >
                          <Images className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" aria-label={`Gerenciar quartos de ${a.name}`} title="Gerenciar quartos" onClick={() => openRooms(a)}>
                        <BedDouble className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Editar ${a.name}`} onClick={() => openEdit(a)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Excluir ${a.name}`}
                        onClick={() => setDeleteId(a.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Hospedagem" : "Nova Hospedagem"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <Label>Nome *</Label>
                <Input
                  value={form.name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              {!editing && (
                <div className="col-span-2 space-y-1">
                  <Label>Tipo *</Label>
                  <Select
                    value={(form as CreateAccommodationBody).type ?? ""}
                    onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOMMODATION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!editing && (
                <>
                  <div className="col-span-2 space-y-1">
                    <Label>Endereço</Label>
                    <Input
                      value={(form as CreateAccommodationBody).address ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Cidade</Label>
                    <Input
                      value={(form as CreateAccommodationBody).city ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Estado (UF)</Label>
                    <Input
                      value={(form as CreateAccommodationBody).state ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))
                      }
                      maxLength={2}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Nome do Contato</Label>
                    <Input
                      value={(form as CreateAccommodationBody).contactName ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Telefone</Label>
                    <Input
                      value={(form as CreateAccommodationBody).phone ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label>E-mail</Label>
                    <Input
                      value={(form as CreateAccommodationBody).email ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                </>
              )}
              <div className="space-y-1">
                <Label>Total de Quartos</Label>
                <Input
                  type="number"
                  value={form.totalRooms ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, totalRooms: Number(e.target.value) || undefined }))
                  }
                  min={0}
                />
              </div>
              <div className="space-y-1">
                <Label>Diária (R$)</Label>
                <Input
                  type="number"
                  value={form.pricePerNight ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      pricePerNight: Number(e.target.value) || undefined,
                    }))
                  }
                  min={0}
                  step={0.01}
                />
              </div>
              {editing && (
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select
                    value={(form as UpdateAccommodationBody).status ?? "active"}
                    onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {statusLabel[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!editing && (
                <div className="col-span-2 space-y-2">
                  <Label>Comodidades</Label>
                  <div className="flex flex-wrap gap-2">
                    {AMENITY_OPTIONS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => toggleAmenity(a)}
                        className={`px-2 py-1 rounded text-xs border transition-colors ${
                          amenities.includes(a)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:border-primary"
                        }`}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="col-span-2 space-y-2">
                <Label>Galeria de fotos</Label>
                <GalleryUpload
                  maxImages={10}
                  fileSizeMB="8"
                  value={galleryUrls}
                  onChange={setGalleryUrls}
                  onUploadingChange={setIsUploading}
                  disabled={isUploading}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={createAcc.isPending || updateAcc.isPending || isUploading}>
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!roomsFor} onOpenChange={(open) => { if (!open) setRoomsFor(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Quartos — {roomsFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 items-end gap-2 rounded-lg border bg-muted/30 p-3">
              <div className="space-y-1 md:col-span-2">
                <Label>Nome do quarto</Label>
                <Input value={roomForm.name} placeholder="Ex.: 101 ou Suíte 1" onChange={e => setRoomForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Categoria</Label>
                <Input value={roomForm.category ?? ""} placeholder="Standard" onChange={e => setRoomForm(f => ({ ...f, category: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Vagas</Label>
                <Input type="number" min={1} max={50} value={roomForm.capacity} onChange={e => setRoomForm(f => ({ ...f, capacity: Number(e.target.value) || 1 }))} />
              </div>
              <div className="space-y-1">
                <Label>Diária</Label>
                <Input type="number" min={0} step={0.01} placeholder="R$" value={roomForm.pricePerNight ?? ""} onChange={e => setRoomForm(f => ({ ...f, pricePerNight: e.target.value === "" ? null : Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label>Ocupação padrão</Label>
                <Input type="number" min={1} max={50} value={roomForm.standardOccupancy ?? ""} onChange={e => setRoomForm(f => ({ ...f, standardOccupancy: e.target.value === "" ? null : Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label>Configuração de camas</Label>
                <Input placeholder="Ex.: 1 cama casal" value={roomForm.bedConfiguration ?? ""} onChange={e => setRoomForm(f => ({ ...f, bedConfiguration: e.target.value || null }))} />
              </div>
              <div className="space-y-1">
                <Label>Banheiro</Label>
                <Input placeholder="Privativo" value={roomForm.bathroomType ?? ""} onChange={e => setRoomForm(f => ({ ...f, bathroomType: e.target.value || null }))} />
              </div>
              <div className="space-y-1">
                <Label>Andar</Label>
                <Input placeholder="Térreo" value={roomForm.floor ?? ""} onChange={e => setRoomForm(f => ({ ...f, floor: e.target.value || null }))} />
              </div>
              <div className="space-y-1 md:col-span-3">
                <Label>Descrição</Label>
                <Input placeholder="Observações para a operação" value={roomForm.description ?? ""} onChange={e => setRoomForm(f => ({ ...f, description: e.target.value || null }))} />
              </div>
              <Button className="w-full" onClick={handleRoomSave} disabled={createRoom.isPending || updateRoom.isPending || !roomForm.name.trim()}>
                {editingRoom ? "Salvar" : "Adicionar"}
              </Button>
            </div>
            {rooms.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Nenhum quarto cadastrado. Cadastre cada quarto individualmente para controlar a ocupação por viagem.
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Quarto</TableHead><TableHead>Categoria</TableHead><TableHead>Vagas</TableHead><TableHead>Diária</TableHead><TableHead>Ocupação</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {rooms.map(room => (
                      <TableRow key={room.id}>
                        <TableCell className="font-medium">{room.name}</TableCell>
                        <TableCell>{room.category}</TableCell>
                        <TableCell>{room.capacity}</TableCell>
                        <TableCell>{room.pricePerNight == null ? "—" : formatCurrency(room.pricePerNight)}</TableCell>
                        <TableCell>{room.occupied} / {room.capacity}</TableCell>
                        <TableCell><Badge variant={room.status === "active" ? "default" : "secondary"}>{room.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`${room.status === "active" ? "Inativar" : "Ativar"} quarto ${room.name}`}
                              onClick={() => handleRoomStatusToggle(room)}
                              disabled={updateRoom.isPending}
                            >
                              {room.status === "active" ? "Inativar" : "Ativar"}
                            </Button>
                            <Button size="icon" variant="ghost" aria-label={`Editar quarto ${room.name}`} onClick={() => { setEditingRoom(room); setRoomForm({ name: room.name, category: room.category, capacity: room.capacity, pricePerNight: room.pricePerNight, description: room.description, standardOccupancy: room.standardOccupancy, bedConfiguration: room.bedConfiguration, bathroomType: room.bathroomType, floor: room.floor, currency: room.currency }); }}><Pencil className="w-4 h-4" /></Button>
                            <Button size="icon" variant="ghost" className="text-destructive" aria-label={`Excluir quarto ${room.name}`} onClick={() => handleRoomDelete(room)} disabled={deleteRoom.isPending}><Trash2 className="w-4 h-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div>
                <h3 className="text-sm font-semibold">Histórico de alterações</h3>
                <p className="text-xs text-muted-foreground">
                  Registro de criação, edição, ativação, desativação e exclusão dos quartos desta hospedagem.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">De</Label>
                  <Input
                    type="date"
                    className="h-8 w-[140px] text-sm"
                    value={auditFrom}
                    onChange={e => setAuditFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Até</Label>
                  <Input
                    type="date"
                    className="h-8 w-[140px] text-sm"
                    value={auditTo}
                    onChange={e => setAuditTo(e.target.value)}
                  />
                </div>
                {(auditFrom || auditTo) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => { setAuditFrom(""); setAuditTo(""); }}
                  >
                    Limpar período
                  </Button>
                )}
              </div>
              {roomAuditError ? (
                <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p>
              ) : roomAuditLoading ? (
                <p className="text-sm text-muted-foreground">Carregando histórico...</p>
              ) : roomAuditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma alteração registrada no período.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border bg-background">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Operação</TableHead>
                        <TableHead>Quarto</TableHead>
                        <TableHead>Valores</TableHead>
                        <TableHead>Usuário</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roomAuditLogs.map(log => {
                        const details = roomAuditDetails(log);
                        const roomName = typeof details.name === "string" ? details.name : "Quarto removido";
                        const capacity = typeof details.capacity === "number" ? `${details.capacity} vaga(s)` : null;
                        const status = typeof details.status === "string" ? statusLabel[details.status] ?? details.status : null;
                        const values = [capacity, status].filter(Boolean).join(" · ");
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {new Date(log.createdAt).toLocaleString("pt-BR")}
                            </TableCell>
                            <TableCell className="text-xs">
                              {roomAuditActionLabel[log.action] ?? log.action}
                            </TableCell>
                            <TableCell className="text-xs font-medium">{roomName}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{values || "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{log.userId ?? "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Hospedagem</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir esta hospedagem?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && handleDelete(deleteId)}
              disabled={deleteAcc.isPending}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {galleryLightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setGalleryLightbox(null)}
        >
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10" onClick={(e) => e.stopPropagation()}>
            <p className="text-white/60 text-sm font-medium truncate max-w-xs">{galleryLightbox.name}</p>
            <div className="flex items-center gap-3">
              <span className="text-white/60 text-sm">{galleryLightbox.index + 1} / {galleryLightbox.urls.length}</span>
              <button
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                onClick={() => setGalleryLightbox(null)}
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          {galleryLightbox.urls.length > 1 && (
            <>
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
                onClick={(e) => { e.stopPropagation(); setGalleryLightbox((lb) => lb ? { ...lb, index: (lb.index - 1 + lb.urls.length) % lb.urls.length } : null); }}
                aria-label="Anterior"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
                onClick={(e) => { e.stopPropagation(); setGalleryLightbox((lb) => lb ? { ...lb, index: (lb.index + 1) % lb.urls.length } : null); }}
                aria-label="Próxima"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}
          <img
            src={galleryLightbox.urls[galleryLightbox.index]}
            alt={`${galleryLightbox.name} — foto ${galleryLightbox.index + 1}`}
            className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl mt-12"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import {
  useListAccommodations,
  useCreateAccommodation,
  useUpdateAccommodation,
  useDeleteAccommodation,
} from "@workspace/api-client-react";
import type {
  Accommodation,
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
import { Plus, Pencil, Trash2, Search, Hotel, Star, Images, ChevronLeft, ChevronRight, X } from "lucide-react";
import { GalleryUpload } from "@/components/gallery-upload";
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


export default function Hospedagens() {
  const { toast } = useToast();
  const { data: accommodations = [], refetch } = useListAccommodations();
  const createAcc = useCreateAccommodation();
  const updateAcc = useUpdateAccommodation();
  const deleteAcc = useDeleteAccommodation();

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
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as { message?: string })?.message
        || "Erro ao salvar hospedagem";
      toast({ title: msg, variant: "destructive" });
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAcc.mutateAsync({ id });
      toast({ title: "Hospedagem excluída" });
      setDeleteId(null);
      refetch();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as { message?: string })?.message
        || "Erro ao excluir";
      toast({ title: msg, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hospedagens</h1>
          <p className="text-sm text-muted-foreground">
            {accommodations.length} hospedagem(ns) cadastrada(s)
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Nova Hospedagem
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
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
            {filtered.length === 0 ? (
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
                      <Button variant="ghost" size="icon" onClick={() => openEdit(a)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
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

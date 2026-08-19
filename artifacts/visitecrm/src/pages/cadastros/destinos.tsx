import { useState } from "react";
import {
  useListDestinations,
  useCreateDestination,
  useUpdateDestination,
  useDeleteDestination,
} from "@workspace/api-client-react";
import type {
  Destination,
  CreateDestinationBody,
  UpdateDestinationBody,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, MapPin, Star } from "lucide-react";

const SEASONS = ["Janeiro-Março", "Abril-Junho", "Julho-Setembro", "Outubro-Dezembro", "Ano todo"];

export default function Destinos() {
  const { toast } = useToast();
  const { data: destinations = [], refetch } = useListDestinations();
  const createDest = useCreateDestination();
  const updateDest = useUpdateDestination();
  const deleteDest = useDeleteDestination();

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Destination | null>(null);
  const [form, setForm] = useState<Partial<CreateDestinationBody & UpdateDestinationBody>>({});
  const [attractionsInput, setAttractionsInput] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = destinations.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.city.toLowerCase().includes(search.toLowerCase()) ||
      d.state.toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setEditing(null);
    setForm({ country: "Brasil" });
    setAttractionsInput("");
    setModalOpen(true);
  }

  function openEdit(d: Destination) {
    setEditing(d);
    setForm({
      name: d.name,
      description: d.description ?? "",
      bestSeason: d.bestSeason ?? "",
      mainAttractions: d.mainAttractions,
      rating: d.rating ?? undefined,
    });
    setAttractionsInput((d.mainAttractions ?? []).join(", "));
    setModalOpen(true);
  }

  function parseAttractions(s: string): string[] {
    return s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async function handleSave() {
    try {
      if (editing) {
        const body: UpdateDestinationBody = {
          name: form.name ?? undefined,
          description: form.description ?? undefined,
          bestSeason: (form as UpdateDestinationBody).bestSeason ?? undefined,
          mainAttractions: parseAttractions(attractionsInput),
          rating: (form as UpdateDestinationBody).rating ?? undefined,
        };
        await updateDest.mutateAsync({ id: editing.id, data: body });
        toast({ title: "Destino atualizado" });
      } else {
        if (!form.name || !(form as CreateDestinationBody).city || !(form as CreateDestinationBody).state) {
          toast({ title: "Preencha nome, cidade e estado", variant: "destructive" });
          return;
        }
        const body: CreateDestinationBody = {
          name: form.name!,
          city: (form as CreateDestinationBody).city!,
          state: (form as CreateDestinationBody).state!,
          country: (form as CreateDestinationBody).country ?? "Brasil",
          description: form.description ?? undefined,
          bestSeason: (form as CreateDestinationBody).bestSeason ?? undefined,
          mainAttractions: parseAttractions(attractionsInput),
        };
        await createDest.mutateAsync({ data: body });
        toast({ title: "Destino criado" });
      }
      setModalOpen(false);
      refetch();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as { message?: string })?.message
        || "Erro ao salvar destino";
      toast({ title: msg, variant: "destructive" });
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDest.mutateAsync({ id });
      toast({ title: "Destino excluído" });
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
          <h1 className="text-2xl font-bold">Destinos</h1>
          <p className="text-sm text-muted-foreground">{destinations.length} destino(s) cadastrado(s)</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Novo Destino
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por nome, cidade, estado..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Destino</TableHead>
              <TableHead>Cidade/Estado</TableHead>
              <TableHead>País</TableHead>
              <TableHead>Melhor Época</TableHead>
              <TableHead>Atrações</TableHead>
              <TableHead>Avaliação</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                  <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  Nenhum destino encontrado
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>{`${d.city}/${d.state}`}</TableCell>
                  <TableCell>{d.country}</TableCell>
                  <TableCell>{d.bestSeason ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(d.mainAttractions ?? []).slice(0, 2).map((a) => (
                        <Badge key={a} variant="outline" className="text-xs">
                          {a}
                        </Badge>
                      ))}
                      {(d.mainAttractions ?? []).length > 2 && (
                        <Badge variant="outline" className="text-xs">
                          +{d.mainAttractions.length - 2}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {d.rating != null ? (
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                        <span>{d.rating.toFixed(1)}</span>
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(d)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(d.id)}
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Destino" : "Novo Destino"}</DialogTitle>
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
              {!editing ? (
                <>
                  <div className="space-y-1">
                    <Label>Cidade *</Label>
                    <Input
                      value={(form as CreateDestinationBody).city ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Estado (UF) *</Label>
                    <Input
                      value={(form as CreateDestinationBody).state ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))
                      }
                      maxLength={2}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label>País</Label>
                    <Input
                      value={(form as CreateDestinationBody).country ?? "Brasil"}
                      onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                    />
                  </div>
                </>
              ) : (
                <div className="col-span-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Localização: </span>
                  <span className="font-medium">
                    {editing.city}/{editing.state} — {editing.country}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">(não editável)</span>
                </div>
              )}
              <div className="col-span-2 space-y-1">
                <Label>Descrição</Label>
                <Textarea
                  value={form.description ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                />
              </div>
              <div className="space-y-1">
                <Label>Melhor Época</Label>
                <Input
                  value={(form as CreateDestinationBody).bestSeason ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, bestSeason: e.target.value }))}
                  placeholder={SEASONS[0]}
                  list="seasons-list"
                />
                <datalist id="seasons-list">
                  {SEASONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              {editing && (
                <div className="space-y-1">
                  <Label>Avaliação (0-10)</Label>
                  <Input
                    type="number"
                    value={(form as UpdateDestinationBody).rating ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, rating: Number(e.target.value) || undefined }))
                    }
                    min={0}
                    max={10}
                    step={0.1}
                  />
                </div>
              )}
              <div className="col-span-2 space-y-1">
                <Label>Principais Atrações (separadas por vírgula)</Label>
                <Textarea
                  value={attractionsInput}
                  onChange={(e) => setAttractionsInput(e.target.value)}
                  rows={2}
                  placeholder="Praia do Forte, Cristo Redentor, Parque Nacional..."
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={createDest.isPending || updateDest.isPending}>
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Destino</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir este destino?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && handleDelete(deleteId)}
              disabled={deleteDest.isPending}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import {
  useListBoardingLocations,
  useCreateBoardingLocation,
  useUpdateBoardingLocation,
  useDeleteBoardingLocation,
} from "@workspace/api-client-react";
import type { BoardingLocation, CreateBoardingLocationBody } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, Navigation } from "lucide-react";

type FormData = Partial<CreateBoardingLocationBody>;

const EMPTY_FORM: FormData = {
  name: "",
  city: "",
  state: "",
  address: "",
  reference: "",
};

export default function LocaisEmbarque() {
  const { toast } = useToast();
  const { data: locations = [], refetch } = useListBoardingLocations({
    query: { queryKey: ["boarding-locations"] },
  });
  const create = useCreateBoardingLocation();
  const update = useUpdateBoardingLocation();
  const remove = useDeleteBoardingLocation();

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BoardingLocation | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = locations.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.city.toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(loc: BoardingLocation) {
    setEditing(loc);
    setForm({
      name: loc.name,
      city: loc.city,
      state: loc.state,
      address: loc.address,
      reference: loc.reference ?? "",
    });
    setModalOpen(true);
  }

  function set(field: keyof FormData) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSave() {
    if (!form.name || !form.city || !form.state) {
      toast({ title: "Preencha os campos obrigatórios", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        name: form.name!,
        city: form.city!,
        state: form.state!,
        address: form.address ?? "",
        reference: form.reference || undefined,
      };
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: payload });
        toast({ title: "Local de embarque atualizado" });
      } else {
        await create.mutateAsync({ data: payload });
        toast({ title: "Local de embarque cadastrado" });
      }
      setModalOpen(false);
      refetch();
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await remove.mutateAsync({ id: deleteId });
      toast({ title: "Local de embarque removido" });
      setDeleteId(null);
      refetch();
    } catch {
      toast({ title: "Erro ao remover", variant: "destructive" });
    }
  }

  const isBusy = create.isPending || update.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Locais de Embarque</h1>
          <p className="text-sm text-muted-foreground">
            Pontos de coleta utilizados nas excursões da agência
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />Novo Local
        </Button>
      </div>

      <div className="flex items-center gap-2 max-w-sm">
        <Search className="w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou cidade..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Cidade / UF</TableHead>
              <TableHead>Endereço</TableHead>
              <TableHead>Referência</TableHead>
              <TableHead className="w-20">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                  <Navigation className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  {search ? "Nenhum resultado para a busca" : "Nenhum local cadastrado ainda"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(loc => (
                <TableRow key={loc.id}>
                  <TableCell className="font-medium">{loc.name}</TableCell>
                  <TableCell>{loc.city} / {loc.state.toUpperCase()}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {loc.address || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {loc.reference || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(loc)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteId(loc.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Local de Embarque" : "Novo Local de Embarque"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome <span className="text-destructive">*</span></Label>
              <Input placeholder="Rodoviária de Crato" value={form.name ?? ""} onChange={set("name")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cidade <span className="text-destructive">*</span></Label>
                <Input placeholder="Crato" value={form.city ?? ""} onChange={set("city")} />
              </div>
              <div className="space-y-1.5">
                <Label>Estado (UF) <span className="text-destructive">*</span></Label>
                <Input placeholder="CE" maxLength={2} value={form.state ?? ""} onChange={set("state")}
                  className="uppercase" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Endereço</Label>
              <Input
                placeholder="Av. Perimetral, s/n — em frente ao terminal"
                value={form.address ?? ""}
                onChange={set("address")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Referência / Ponto de Encontro</Label>
              <Input placeholder="Portão 3, em frente à farmácia" value={form.reference ?? ""} onChange={set("reference")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={isBusy}>
              {editing ? "Salvar alterações" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover local de embarque?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Viagens que referenciam este local manterão o nome salvo, mas não poderão reutilizá-lo a partir do catálogo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

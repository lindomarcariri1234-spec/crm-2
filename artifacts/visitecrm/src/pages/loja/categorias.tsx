import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { storeApi, StoreCategory, CategoryInput } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { FolderOpen, Plus, Pencil, Trash2, Loader2 } from "lucide-react";

function CategoryForm({
  category,
  categories,
  onSave,
  onClose,
}: {
  category?: StoreCategory;
  categories: StoreCategory[];
  onSave: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<CategoryInput>({
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    description: category?.description ?? "",
    imageUrl: category?.imageUrl ?? "",
    parentId: category?.parentId ?? undefined,
    position: category?.position ?? 0,
    isActive: category?.isActive ?? true,
  });

  function set(field: string, value: unknown) {
    setForm((p) => ({ ...p, [field]: value }));
    if (field === "name" && !category) {
      setForm((p) => ({
        ...p,
        slug: (value as string)
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
      }));
    }
  }

  async function handleSave() {
    if (!form.name) {
      toast({ title: "Nome é obrigatório", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      if (category) {
        await storeApi.updateCategory(category.id, form);
      } else {
        await storeApi.createCategory(form);
      }
      toast({ title: category ? "Categoria atualizada!" : "Categoria criada!" });
      onSave();
    } catch (err: unknown) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const parents = categories.filter((c) => c.id !== category?.id);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Nome *</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Slug</Label>
          <Input value={form.slug ?? ""} onChange={(e) => set("slug", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Categoria Pai</Label>
          <select
            value={form.parentId ?? ""}
            onChange={(e) => set("parentId", e.target.value || undefined)}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="">Nenhuma (raiz)</option>
            {parents.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Posição</Label>
          <Input
            type="number"
            value={form.position ?? 0}
            onChange={(e) => set("position", parseInt(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-2 col-span-2">
          <Label>Descrição</Label>
          <Input
            value={form.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div className="space-y-2 col-span-2">
          <Label>URL da Imagem</Label>
          <Input
            value={form.imageUrl ?? ""}
            onChange={(e) => set("imageUrl", e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div className="flex items-center gap-2 col-span-2">
          <Switch
            checked={form.isActive ?? true}
            onCheckedChange={(v) => set("isActive", v)}
          />
          <Label>Ativa</Label>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={handleSave} disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}

export default function LojaCategorias() {
  const { toast } = useToast();
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<StoreCategory | undefined>();
  const [showDialog, setShowDialog] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setCategories(await storeApi.getCategories());
    } catch (err: unknown) {
      toast({
        title: "Erro ao carregar categorias",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await storeApi.deleteCategory(id);
      setCategories((c) => c.filter((x) => x.id !== id));
      toast({ title: "Categoria excluída" });
    } catch (err: unknown) {
      toast({
        title: "Erro ao excluir",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Categorias</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {categories.length} categoria(s)
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setShowDialog(true);
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Nova Categoria
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : categories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhuma categoria ainda.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Pai</TableHead>
                <TableHead>Posição</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => (
                <TableRow key={cat.id}>
                  <TableCell className="font-medium">{cat.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{cat.slug}</TableCell>
                  <TableCell className="text-sm">
                    {cat.parentId
                      ? categories.find((c) => c.id === cat.parentId)?.name ?? "—"
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{cat.position}</TableCell>
                  <TableCell>
                    <Badge variant={cat.isActive ? "default" : "secondary"}>
                      {cat.isActive ? "Ativa" : "Inativa"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditing(cat);
                          setShowDialog(true);
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        disabled={deleting === cat.id}
                        onClick={() => handleDelete(cat.id)}
                      >
                        {deleting === cat.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar Categoria" : "Nova Categoria"}
            </DialogTitle>
          </DialogHeader>
          <CategoryForm
            category={editing}
            categories={categories}
            onSave={() => {
              setShowDialog(false);
              load();
            }}
            onClose={() => setShowDialog(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

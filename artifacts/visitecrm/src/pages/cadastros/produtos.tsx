import { useState } from "react";
import {
  useListProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useListProductCategories,
  useCreateProductCategory,
  useDeleteProductCategory,
} from "@workspace/api-client-react";
import type { Product, CreateProductBody, UpdateProductBody, ProductCategory } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, Package, Tag } from "lucide-react";
import { formatCurrencyBRL as formatCurrency } from "@/lib/utils";

const PRODUCT_COST_KEY = "product_costs";

function loadProductCosts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PRODUCT_COST_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveProductCost(productId: string, cost: number | undefined) {
  const all = loadProductCosts();
  if (cost != null && cost > 0) {
    all[productId] = cost;
  } else {
    delete all[productId];
  }
  localStorage.setItem(PRODUCT_COST_KEY, JSON.stringify(all));
}

function getProductCost(productId: string): number | undefined {
  return loadProductCosts()[productId];
}

const PRODUCT_TYPES = [
  "Seguro",
  "Transfer",
  "Passeio",
  "Ingresso",
  "Hospedagem",
  "Alimentação",
  "Kit",
  "Outro",
];


function CategoryManager({
  categories,
  onRefetch,
}: {
  categories: ProductCategory[];
  onRefetch: () => void;
}) {
  const { toast } = useToast();
  const createCategory = useCreateProductCategory();
  const deleteCategory = useDeleteProductCategory();

  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function handleNameChange(v: string) {
    setNewName(v);
    setNewSlug(
      v
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    );
  }

  async function handleCreate() {
    if (!newName.trim()) {
      toast({ title: "Digite um nome para a categoria", variant: "destructive" });
      return;
    }
    try {
      await createCategory.mutateAsync({
        data: {
          name: newName.trim(),
          slug: newSlug || newName.toLowerCase().replace(/\s+/g, "-"),
        },
      });
      toast({ title: "Categoria criada" });
      setNewName("");
      setNewSlug("");
      onRefetch();
    } catch {
      toast({ title: "Erro ao criar categoria", variant: "destructive" });
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCategory.mutateAsync({ id });
      toast({ title: "Categoria excluída" });
      setDeleteId(null);
      onRefetch();
    } catch {
      toast({ title: "Erro ao excluir categoria", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Nome da categoria"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
        />
        <Input
          value={newSlug}
          onChange={(e) => setNewSlug(e.target.value)}
          placeholder="slug-automatico"
          className="w-40 font-mono text-sm"
        />
        <Button onClick={handleCreate} disabled={createCategory.isPending}>
          <Plus className="w-4 h-4 mr-1" />
          Criar
        </Button>
      </div>
      {categories.length === 0 ? (
        <div className="text-center text-muted-foreground py-8 border-2 border-dashed rounded-lg">
          <Tag className="w-8 h-8 mx-auto mb-2 opacity-30" />
          Nenhuma categoria cadastrada
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead>Ordem</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.slug}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.isActive ? "default" : "secondary"} className="text-xs">
                      {c.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{c.sortOrder}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(c.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Categoria</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir esta categoria?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && handleDelete(deleteId)}
              disabled={deleteCategory.isPending}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Produtos() {
  const { toast } = useToast();
  const { data: products = [], refetch } = useListProducts();
  const { data: categories = [], refetch: refetchCategories } = useListProductCategories();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<
    Partial<CreateProductBody & UpdateProductBody & { cost?: number; categoryId?: string }>
  >({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.type.toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setEditing(null);
    setForm({ active: true, featured: false });
    setModalOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      price: p.price,
      promotionalPrice: p.promotionalPrice ?? undefined,
      stock: p.stock ?? undefined,
      active: p.active,
      featured: p.featured,
      cost: getProductCost(p.id),
    });
    setModalOpen(true);
  }

  async function handleSave() {
    try {
      if (editing) {
        await updateProduct.mutateAsync({
          id: editing.id,
          data: {
            name: form.name ?? undefined,
            price: form.price ?? undefined,
            promotionalPrice: form.promotionalPrice ?? undefined,
            stock: form.stock ?? undefined,
            active: (form as UpdateProductBody).active ?? undefined,
            featured: (form as UpdateProductBody).featured ?? undefined,
          },
        });
        saveProductCost(editing.id, form.cost);
        forceUpdate((n) => n + 1);
        toast({ title: "Produto atualizado" });
      } else {
        if (!form.name || !(form as CreateProductBody).type || form.price == null) {
          toast({ title: "Preencha nome, tipo e preço", variant: "destructive" });
          return;
        }
        const created = await createProduct.mutateAsync({
          data: {
            name: form.name!,
            type: (form as CreateProductBody).type!,
            price: form.price!,
            description: (form as CreateProductBody).description ?? undefined,
            promotionalPrice: form.promotionalPrice ?? undefined,
            stock: form.stock ?? undefined,
          },
        });
        if (created?.id) {
          saveProductCost(created.id, form.cost);
        }
        forceUpdate((n) => n + 1);
        toast({ title: "Produto criado" });
      }
      setModalOpen(false);
      refetch();
    } catch {
      toast({ title: "Erro ao salvar produto", variant: "destructive" });
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteProduct.mutateAsync({ id });
      toast({ title: "Produto excluído" });
      setDeleteId(null);
      refetch();
    } catch {
      toast({ title: "Erro ao excluir", variant: "destructive" });
    }
  }

  async function handleToggle(p: Product, field: "active" | "featured") {
    try {
      await updateProduct.mutateAsync({
        id: p.id,
        data: { [field]: !p[field] },
      });
      refetch();
    } catch {
      toast({ title: "Erro ao atualizar produto", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Produtos</h1>
          <p className="text-sm text-muted-foreground">
            {products.length} produto(s) cadastrado(s)
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Novo Produto
        </Button>
      </div>

      <Tabs defaultValue="produtos">
        <TabsList>
          <TabsTrigger value="produtos">
            <Package className="w-4 h-4 mr-2" />
            Produtos
          </TabsTrigger>
          <TabsTrigger value="categorias">
            <Tag className="w-4 h-4 mr-2" />
            Categorias ({categories.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="produtos" className="mt-4">
          <div className="space-y-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar por nome, tipo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="rounded-md border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Preço</TableHead>
                    <TableHead>Preço Promo</TableHead>
                    <TableHead>Custo</TableHead>
                    <TableHead>Estoque</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead>Destaque</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="text-center text-muted-foreground py-10"
                      >
                        <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        Nenhum produto encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((p) => {
                      const cost = getProductCost(p.id);
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{p.type}</Badge>
                          </TableCell>
                          <TableCell className="font-mono">{formatCurrency(p.price)}</TableCell>
                          <TableCell className="font-mono text-green-600">
                            {formatCurrency(p.promotionalPrice)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {cost != null ? formatCurrency(cost) : "—"}
                          </TableCell>
                          <TableCell>
                            {p.stock != null ? p.stock : "Ilimitado"}
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={p.active}
                              onCheckedChange={() => handleToggle(p, "active")}
                            />
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={p.featured}
                              onCheckedChange={() => handleToggle(p, "featured")}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(p)}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setDeleteId(p.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="categorias" className="mt-4">
          <CategoryManager categories={categories} onRefetch={refetchCategories} />
        </TabsContent>
      </Tabs>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Produto" : "Novo Produto"}</DialogTitle>
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
                    value={(form as CreateProductBody).type ?? ""}
                    onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRODUCT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!editing && categories.length > 0 && (
                <div className="col-span-2 space-y-1">
                  <Label>Categoria</Label>
                  <Select
                    value={form.categoryId ?? ""}
                    onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar categoria (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!editing && (
                <div className="col-span-2 space-y-1">
                  <Label>Descrição</Label>
                  <Textarea
                    value={(form as CreateProductBody).description ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, description: e.target.value }))
                    }
                    rows={2}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label>Preço (R$) *</Label>
                <Input
                  type="number"
                  value={form.price ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, price: Number(e.target.value) }))
                  }
                  min={0}
                  step={0.01}
                />
              </div>
              <div className="space-y-1">
                <Label>Preço Promocional (R$)</Label>
                <Input
                  type="number"
                  value={form.promotionalPrice ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      promotionalPrice: Number(e.target.value) || undefined,
                    }))
                  }
                  min={0}
                  step={0.01}
                />
              </div>
              <div className="space-y-1">
                <Label>Custo (R$)</Label>
                <Input
                  type="number"
                  value={form.cost ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cost: Number(e.target.value) || undefined }))
                  }
                  min={0}
                  step={0.01}
                  placeholder="Custo de aquisição"
                />
              </div>
              <div className="space-y-1">
                <Label>Estoque (vazio = ilimitado)</Label>
                <Input
                  type="number"
                  value={form.stock ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, stock: Number(e.target.value) || undefined }))
                  }
                  min={0}
                />
              </div>
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-2">
                  <Switch
                    id="active"
                    checked={(form as UpdateProductBody).active ?? true}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
                  />
                  <Label htmlFor="active">Ativo</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="featured"
                    checked={(form as UpdateProductBody).featured ?? false}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, featured: v }))}
                  />
                  <Label htmlFor="featured">Destaque</Label>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={createProduct.isPending || updateProduct.isPending}
            >
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Produto</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir este produto?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && handleDelete(deleteId)}
              disabled={deleteProduct.isPending}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { storeApi, StoreProduct, StoreCategory, ProductInput, VariantItem } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { CoverImageUpload } from "@/components/cover-image-upload";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Package,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Search,
  Eye,
  EyeOff,
  Star,
  X,
  Archive,
  ChevronLeft,
  ChevronRight,
  GripVertical,
} from "lucide-react";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const PRODUCT_TYPES = [
  { value: "package", label: "Pacote de Viagem" },
  { value: "tour", label: "Passeio / Tour" },
  { value: "service", label: "Serviço" },
  { value: "hotel", label: "Hospedagem" },
  { value: "transfer", label: "Transfer" },
  { value: "insurance", label: "Seguro" },
  { value: "product", label: "Produto" },
];

const PRODUCT_STATUSES = [
  { value: "draft", label: "Rascunho" },
  { value: "active", label: "Ativo" },
  { value: "archived", label: "Arquivado" },
];

function TagInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  function add() {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput("");
  }
  function remove(item: string) {
    onChange(values.filter((v) => v !== item));
  }
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder ?? "Digite e pressione Enter"}
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Adicionar
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="flex items-center gap-1 bg-muted px-2 py-1 rounded-md text-xs"
            >
              {v}
              <button onClick={() => remove(v)} className="text-muted-foreground hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function VariantsEditor({
  variants,
  basePrice,
  onChange,
}: {
  variants: VariantItem[];
  basePrice: number;
  onChange: (v: VariantItem[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Variantes</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([...variants, { name: "Nova Variante", options: [{ label: "Opção 1", price: basePrice }] }])
          }
        >
          <Plus className="w-3 h-3 mr-1" />
          Adicionar Variante
        </Button>
      </div>
      {variants.map((variant, vi) => (
        <Card key={vi}>
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-2 items-center">
              <Input
                value={variant.name}
                onChange={(e) => {
                  const v = variants.map((x, i) => i === vi ? { ...x, name: e.target.value } : x);
                  onChange(v);
                }}
                placeholder="Ex: Tipo de Quarto"
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => onChange(variants.filter((_, i) => i !== vi))}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
            {variant.options.map((opt, oi) => (
              <div key={oi} className="flex gap-2 items-center pl-4">
                <Input
                  value={opt.label}
                  onChange={(e) => {
                    const v = variants.map((x, i) =>
                      i === vi
                        ? { ...x, options: x.options.map((o, j) => j === oi ? { ...o, label: e.target.value } : o) }
                        : x
                    );
                    onChange(v);
                  }}
                  placeholder="Nome da opção"
                  className="flex-1"
                />
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">R$</span>
                  <Input
                    type="number"
                    value={opt.price}
                    onChange={(e) => {
                      const v = variants.map((x, i) =>
                        i === vi
                          ? { ...x, options: x.options.map((o, j) => j === oi ? { ...o, price: parseFloat(e.target.value) || 0 } : o) }
                          : x
                      );
                      onChange(v);
                    }}
                    className="w-28"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  onClick={() => {
                    const v = variants.map((x, i) =>
                      i === vi ? { ...x, options: x.options.filter((_, j) => j !== oi) } : x
                    );
                    onChange(v);
                  }}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-4 h-7 text-xs"
              onClick={() => {
                const v = variants.map((x, i) =>
                  i === vi ? { ...x, options: [...x.options, { label: "", price: basePrice }] } : x
                );
                onChange(v);
              }}
            >
              <Plus className="w-3 h-3 mr-1" />
              Adicionar opção
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ProductForm({
  product,
  categories,
  onSave,
  onClose,
}: {
  product?: StoreProduct;
  categories: StoreCategory[];
  onSave: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ProductInput>({
    name: product?.name ?? "",
    slug: product?.slug ?? "",
    type: product?.type ?? "package",
    categoryId: product?.categoryId ?? undefined,
    shortDescription: product?.shortDescription ?? "",
    description: product?.description ?? "",
    price: product?.price ?? "",
    salePrice: product?.salePrice ?? undefined,
    stockQuantity: product?.stockQuantity ?? undefined,
    destination: product?.destination ?? "",
    startDate: product?.startDate ?? "",
    endDate: product?.endDate ?? "",
    durationDays: product?.durationDays ?? undefined,
    images: product?.images ?? [],
    gallery: product?.gallery ?? [],
    features: product?.features ?? [],
    includes: product?.includes ?? [],
    excludes: product?.excludes ?? [],
    variants: product?.variants ?? [],
    isFeatured: product?.isFeatured ?? false,
    status: product?.status ?? "draft",
    metaTitle: product?.metaTitle ?? "",
    metaDescription: product?.metaDescription ?? "",
  });

  function set(field: string, value: unknown) {
    if (field === "name" && !product) {
      setForm((p) => ({
        ...p,
        name: value as string,
        slug: !p.slug ? slugify(value as string) : p.slug,
      }));
    } else {
      setForm((p) => ({ ...p, [field]: value }));
    }
  }

  const dragIdx = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  function moveImage(from: number, direction: -1 | 1) {
    const imgs = [...(form.images ?? [])];
    const to = from + direction;
    if (to < 0 || to >= imgs.length) return;
    [imgs[from], imgs[to]] = [imgs[to], imgs[from]];
    set("images", imgs);
  }

  function handleGripPointerDown(e: React.PointerEvent, i: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragIdx.current = i;
    setDragging(i);
  }

  function handleGripPointerMove(e: React.PointerEvent) {
    if (dragIdx.current === null) return;
    const grip = e.currentTarget as HTMLElement;
    grip.style.pointerEvents = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    grip.style.pointerEvents = "";
    const cell = el?.closest("[data-imgidx]") as HTMLElement | null;
    if (!cell) return;
    const targetIdx = parseInt(cell.dataset.imgidx ?? "-1", 10);
    if (isNaN(targetIdx) || targetIdx === dragIdx.current) return;
    const imgs = [...(form.images ?? [])];
    const [dragged] = imgs.splice(dragIdx.current, 1);
    imgs.splice(targetIdx, 0, dragged);
    dragIdx.current = targetIdx;
    setDragging(targetIdx);
    set("images", imgs);
  }

  function handleGripPointerUp() {
    dragIdx.current = null;
    setDragging(null);
  }

  async function handleSave() {
    if (!form.name) {
      toast({ title: "Nome é obrigatório", variant: "destructive" });
      return;
    }
    if (!form.price || parseFloat(form.price) <= 0) {
      toast({ title: "Preço é obrigatório e deve ser maior que zero", variant: "destructive" });
      return;
    }
    if (!form.slug) {
      setForm((p) => ({ ...p, slug: slugify(form.name) }));
    }
    setLoading(true);
    try {
      if (product) {
        await storeApi.updateProduct(product.id, form);
      } else {
        await storeApi.createProduct(form);
      }
      toast({ title: product ? "Produto atualizado!" : "Produto criado!" });
      onSave();
    } catch (err: unknown) {
      toast({
        title: "Erro ao salvar produto",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const isTrip = ["package", "tour", "transfer"].includes(form.type ?? "");

  return (
    <div className="max-h-[80vh] overflow-y-auto pr-1">
      <Tabs defaultValue="info">
        <TabsList className="mb-4">
          <TabsTrigger value="info">Informações</TabsTrigger>
          <TabsTrigger value="preco">Preço e Estoque</TabsTrigger>
          <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
        </TabsList>

        {/* ── INFORMAÇÕES BÁSICAS ── */}
        <TabsContent value="info" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label>Nome do Produto *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Slug (URL)</Label>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground whitespace-nowrap">/produto/</span>
                <Input
                  value={form.slug ?? ""}
                  onChange={(e) => set("slug", slugify(e.target.value))}
                  placeholder="nome-do-produto"
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={form.type ?? "package"} onValueChange={(v) => set("type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select
                value={form.categoryId ?? "none"}
                onValueChange={(v) => set("categoryId", v === "none" ? undefined : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhuma" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Descrição Curta</Label>
              <Input
                value={form.shortDescription ?? ""}
                onChange={(e) => set("shortDescription", e.target.value)}
                placeholder="Resumo exibido na listagem"
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Descrição Completa</Label>
              <Textarea
                value={form.description ?? ""}
                onChange={(e) => set("description", e.target.value)}
                rows={5}
                placeholder="Descrição detalhada do produto..."
              />
            </div>

            {isTrip && (
              <>
                <div className="space-y-2">
                  <Label>Destino</Label>
                  <Input
                    value={form.destination ?? ""}
                    onChange={(e) => set("destination", e.target.value)}
                    placeholder="Ex: Paris, França"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Duração (dias)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={form.durationDays ?? ""}
                    onChange={(e) => set("durationDays", e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Data de Saída</Label>
                  <Input
                    type="date"
                    value={form.startDate ?? ""}
                    onChange={(e) => set("startDate", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Data de Retorno</Label>
                  <Input
                    type="date"
                    value={form.endDate ?? ""}
                    onChange={(e) => set("endDate", e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Images */}
            <div className="col-span-2 space-y-2">
              <div className="flex items-center gap-2">
                <Label>Imagens do Produto</Label>
                <span className="text-xs text-muted-foreground">— a primeira é a capa exibida no catálogo</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(form.images ?? []).map((url, i) => {
                  const total = (form.images ?? []).length;
                  return (
                    <div
                      key={url + i}
                      data-imgidx={i}
                      className={`relative rounded-md transition-all ${dragging === i ? "opacity-60 ring-2 ring-primary ring-offset-1" : ""}`}
                    >
                      {i === 0 && (
                        <span className="absolute top-1.5 left-1.5 z-10 text-[10px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded-full pointer-events-none">
                          Capa
                        </span>
                      )}
                      {total > 1 && (
                        <div
                          className="absolute top-1.5 right-1.5 z-10 cursor-grab active:cursor-grabbing bg-black/50 rounded p-0.5 text-white touch-none select-none"
                          title="Arrastar para reordenar"
                          onPointerDown={(e) => handleGripPointerDown(e, i)}
                          onPointerMove={handleGripPointerMove}
                          onPointerUp={handleGripPointerUp}
                          onPointerCancel={handleGripPointerUp}
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                        </div>
                      )}
                      <CoverImageUpload
                        value={url}
                        onChange={(newUrl) => {
                          const updated = [...(form.images ?? [])];
                          if (newUrl) {
                            updated[i] = newUrl;
                          } else {
                            updated.splice(i, 1);
                          }
                          set("images", updated);
                        }}
                        previewClassName="h-36"
                        objectFit="cover"
                        emptyLabel="Clique ou arraste"
                      />
                      {total > 1 && (
                        <div className="absolute bottom-1.5 right-1.5 z-10 flex gap-1">
                          {i > 0 && (
                            <button
                              type="button"
                              onClick={() => moveImage(i, -1)}
                              className="bg-black/60 hover:bg-black/80 text-white rounded p-0.5 transition"
                              title="Mover para esquerda"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {i < total - 1 && (
                            <button
                              type="button"
                              onClick={() => moveImage(i, 1)}
                              className="bg-black/60 hover:bg-black/80 text-white rounded p-0.5 transition"
                              title="Mover para direita"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <CoverImageUpload
                  value=""
                  onChange={(newUrl) => {
                    if (newUrl) {
                      set("images", [...(form.images ?? []), newUrl]);
                    }
                  }}
                  previewClassName="h-36"
                  objectFit="cover"
                  emptyLabel={
                    (form.images ?? []).length === 0
                      ? "Clique ou arraste a imagem principal"
                      : "Adicionar imagem"
                  }
                />
              </div>
            </div>

            {/* Gallery */}
            <div className="col-span-2 space-y-2">
              <div className="flex items-center gap-2">
                <Label>Galeria Adicional</Label>
                <span className="text-xs text-muted-foreground">— fotos complementares exibidas na página do produto</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(form.gallery ?? []).map((url, i) => (
                  <div key={url + i} className="relative rounded-md">
                    <CoverImageUpload
                      value={url}
                      onChange={(newUrl) => {
                        const updated = [...(form.gallery ?? [])];
                        if (newUrl) {
                          updated[i] = newUrl;
                        } else {
                          updated.splice(i, 1);
                        }
                        set("gallery", updated);
                      }}
                      previewClassName="h-36"
                      objectFit="cover"
                      emptyLabel="Clique ou arraste"
                    />
                  </div>
                ))}
                <CoverImageUpload
                  value=""
                  onChange={(newUrl) => {
                    if (newUrl) {
                      set("gallery", [...(form.gallery ?? []), newUrl]);
                    }
                  }}
                  previewClassName="h-36"
                  objectFit="cover"
                  emptyLabel={
                    (form.gallery ?? []).length === 0
                      ? "Clique ou arraste para adicionar fotos da galeria"
                      : "Adicionar foto"
                  }
                />
              </div>
            </div>

            {/* Switches */}
            <div className="col-span-2 flex gap-6 pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isFeatured ?? false}
                  onCheckedChange={(v) => set("isFeatured", v)}
                />
                <Label>Destaque</Label>
              </div>
              <div className="space-y-0 flex items-center gap-2">
                <Label>Status:</Label>
                <Select value={form.status ?? "draft"} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger className="w-36 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── PREÇO E ESTOQUE ── */}
        <TabsContent value="preco" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Preço (R$)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.price ?? ""}
                onChange={(e) => set("price", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Preço Promocional (R$)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.salePrice ?? ""}
                onChange={(e) => set("salePrice", e.target.value || undefined)}
                placeholder="Deixe vazio se sem promoção"
              />
            </div>
            <div className="space-y-2">
              <Label>Estoque (vagas)</Label>
              <Input
                type="number"
                min="0"
                value={form.stockQuantity ?? ""}
                onChange={(e) => set("stockQuantity", e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Ilimitado se vazio"
              />
            </div>
          </div>

          {/* Variants */}
          <VariantsEditor
            variants={form.variants ?? []}
            basePrice={parseFloat(form.price ?? "0") || 0}
            onChange={(v) => set("variants", v)}
          />
        </TabsContent>

        {/* ── DETALHES ── */}
        <TabsContent value="detalhes" className="space-y-4">
          <TagInput
            label="Características / Diferenciais"
            values={form.features ?? []}
            onChange={(v) => set("features", v)}
            placeholder="Ex: Wi-Fi incluído, Guia bilíngue..."
          />
          <TagInput
            label="O que está incluído"
            values={form.includes ?? []}
            onChange={(v) => set("includes", v)}
            placeholder="Ex: Passagens aéreas, Café da manhã..."
          />
          <TagInput
            label="O que NÃO está incluído"
            values={form.excludes ?? []}
            onChange={(v) => set("excludes", v)}
            placeholder="Ex: Seguro viagem, Despesas pessoais..."
          />
        </TabsContent>

        {/* ── SEO ── */}
        <TabsContent value="seo" className="space-y-4">
          <div className="space-y-2">
            <Label>Título SEO</Label>
            <Input
              value={form.metaTitle ?? ""}
              onChange={(e) => set("metaTitle", e.target.value)}
              placeholder={form.name || "Título para mecanismos de busca"}
            />
            <p className="text-xs text-muted-foreground">Ideal: 50–60 caracteres. ({(form.metaTitle ?? "").length}/60)</p>
          </div>
          <div className="space-y-2">
            <Label>Meta Descrição</Label>
            <Textarea
              value={form.metaDescription ?? ""}
              onChange={(e) => set("metaDescription", e.target.value)}
              rows={3}
              placeholder="Descrição exibida nos resultados de busca..."
            />
            <p className="text-xs text-muted-foreground">Ideal: 120–160 caracteres. ({(form.metaDescription ?? "").length}/160)</p>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2 pt-4 border-t mt-4">
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={handleSave} disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {product ? "Salvar Alterações" : "Criar Produto"}
        </Button>
      </div>
    </div>
  );
}

export default function LojaProdutos() {
  const { toast } = useToast();
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editingProduct, setEditingProduct] = useState<StoreProduct | undefined>();
  const [showDialog, setShowDialog] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        storeApi.getProducts(),
        storeApi.getCategories(),
      ]);
      setProducts(p);
      setCategories(c);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Store not found")) {
        toast({
          title: "Configure sua loja primeiro",
          description: "Acesse Minha Loja > Configurações para criar sua loja.",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await storeApi.deleteProduct(id);
      setProducts((p) => p.filter((x) => x.id !== id));
      toast({ title: "Produto excluído" });
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

  async function togglePublish(product: StoreProduct) {
    try {
      const updated = await storeApi.updateProduct(product.id, {
        status: product.status === "active" ? "draft" : "active",
      });
      setProducts((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: unknown) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  async function toggleArchive(product: StoreProduct) {
    const newStatus = product.status === "archived" ? "active" : "archived";
    try {
      const updated = await storeApi.updateProduct(product.id, { status: newStatus });
      setProducts((p) => p.map((x) => (x.id === updated.id ? updated : x)));
      toast({ title: newStatus === "archived" ? "Produto arquivado" : "Produto reativado" });
    } catch (err: unknown) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  const filtered = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.destination ?? "").toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "all" || p.type === typeFilter;
    const matchStatus = statusFilter === "all" || p.status === statusFilter;
    const matchCategory = categoryFilter === "all" || p.categoryId === categoryFilter || (categoryFilter === "none" && !p.categoryId);
    return matchSearch && matchType && matchStatus && matchCategory;
  });

  const getCategoryName = (id?: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "—";

  const getTypeLabel = (type: string) =>
    PRODUCT_TYPES.find((t) => t.value === type)?.label ?? type;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Produtos da Loja</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {products.length} produto(s) cadastrado(s)
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingProduct(undefined);
            setShowDialog(true);
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Novo Produto
        </Button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar produtos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {PRODUCT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="draft">Rascunhos</SelectItem>
            <SelectItem value="archived">Arquivados</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            <SelectItem value="none">Sem categoria</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border overflow-hidden">
          <div className="py-12 text-center text-muted-foreground">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum produto encontrado.</p>
            {search || typeFilter !== "all" || statusFilter !== "all" ? (
              <p className="text-sm mt-1">Tente ajustar os filtros.</p>
            ) : (
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => { setEditingProduct(undefined); setShowDialog(true); }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Criar Primeiro Produto
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Preço</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {product.images[0] ? (
                        <img
                          src={product.images[0]}
                          alt={product.name}
                          className="w-10 h-10 rounded object-cover border"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded border bg-muted flex items-center justify-center">
                          <Package className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-sm">{product.name}</div>
                        {product.destination && (
                          <div className="text-xs text-muted-foreground">{product.destination}</div>
                        )}
                        {product.startDate && (
                          <div className="text-xs text-muted-foreground">
                            Saída: {new Date(product.startDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {getTypeLabel(product.type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {getCategoryName(product.categoryId)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {product.salePrice ? (
                      <div>
                        <span className="line-through text-muted-foreground mr-1 text-xs">
                          R$ {parseFloat(product.price).toFixed(2)}
                        </span>
                        <span className="text-green-600 font-medium">
                          R$ {parseFloat(product.salePrice).toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      <span>R$ {parseFloat(product.price).toFixed(2)}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant={product.status === "active" ? "default" : "secondary"} className="text-xs w-fit">
                        {product.status === "active" ? "Publicado" : product.status === "archived" ? "Arquivado" : "Rascunho"}
                      </Badge>
                      {product.isFeatured && (
                        <Badge variant="outline" className="text-yellow-600 text-xs w-fit">
                          <Star className="w-3 h-3 mr-1" />
                          Destaque
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => togglePublish(product)}
                        title={product.status === "active" ? "Despublicar" : "Publicar"}
                      >
                        {product.status === "active" ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-8 w-8 ${product.status === "archived" ? "text-amber-600 hover:text-amber-700" : "text-muted-foreground"}`}
                        onClick={() => toggleArchive(product)}
                        title={product.status === "archived" ? "Reativar" : "Arquivar"}
                      >
                        <Archive className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingProduct(product);
                          setShowDialog(true);
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        disabled={deleting === product.id}
                        onClick={() => handleDelete(product.id)}
                      >
                        {deleting === product.id ? (
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? "Editar Produto" : "Novo Produto"}
            </DialogTitle>
          </DialogHeader>
          <ProductForm
            product={editingProduct}
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

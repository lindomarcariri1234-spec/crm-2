import { useState, useEffect, useCallback } from "react";
import { localToday } from "@workspace/shared";
import { COMMISSION_STATUS } from "@workspace/permissions";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Store, Package, Calendar, DollarSign, LogOut, Plus, Pencil, Trash2,
  ChevronRight, TrendingUp, Clock, CheckCircle, AlertCircle, Eye, ClipboardList,
} from "lucide-react";

const STORAGE_KEY = "parceiro_token";
const BASE = import.meta.env.BASE_URL ?? "/";
const api = (path: string) => `${BASE}api${path}`;

function getToken(): string | null { return localStorage.getItem(STORAGE_KEY); }
function setToken(t: string) { localStorage.setItem(STORAGE_KEY, t); }
function clearToken() { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem("parceiro_profile"); }

interface PartnerProfile {
  id: string; name: string; email: string; cnpj: string | null;
  slug: string; description: string | null; phone: string | null;
  logo: string | null; status: string; commissionPct: string;
}
interface PartnerProduct {
  id: string; type: string; title: string; slug: string; description: string | null;
  price: string; maxCapacity: number; durationMinutes: number | null;
  meetingPoint: string | null; cancellationPolicy: string | null;
  origin: string | null; locationUrl: string | null;
  faq: Array<{ question: string; answer: string }>;
  images: string[]; status: string; createdAt: string;
}
type PartnerProductInput = Omit<Partial<PartnerProduct>, "price"> & { price?: number };
interface Commission {
  id: string; orderId: string; grossAmount: string; partnerAmount: string;
  status: string; period: string; createdAt: string;
  order: { orderNumber: string; customerName: string; totalAmount: string; status: string } | null;
}
interface PartnerOrderItem {
  id: string; orderId: string; productName: string; quantity: number; total: string;
  itemStatus: string; voucherCode: string | null; cancellationReason: string | null;
  metadata: Record<string, unknown> | null; orderNumber: string; customerName: string;
  customerEmail: string; paymentStatus: string; orderStatus: string; createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  passeio: "Passeio", transfer: "Transfer", experiencia: "Experiência", ingresso: "Ingresso",
};
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  active: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  paid: "bg-blue-100 text-blue-800 border-blue-200",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente", active: "Ativo", rejected: "Rejeitado", paid: "Pago", suspended: "Suspenso",
};

async function partnerFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(api(path), {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return null as unknown as T;
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null as unknown as T;
  return res.json() as Promise<T>;
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (profile: PartnerProfile) => void }) {
  const [storeSlug, setStoreSlug] = useState(() => new URLSearchParams(window.location.search).get("agency") ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await partnerFetch<{ token: string; partner: PartnerProfile }>("/partner/login", {
        method: "POST",
        body: JSON.stringify({ email, password, storeSlug: storeSlug.trim() }),
      });
      setToken(res.token);
      onLogin(res.partner);
    } catch (err) {
      toast({ title: "Erro ao entrar", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-700 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Store className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl">Portal do Parceiro</CardTitle>
          <CardDescription>Acesse sua conta para gerenciar produtos, disponibilidade e comissões</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label>Código da Agência</Label>
              <Input value={storeSlug} onChange={e => setStoreSlug(e.target.value)} required autoFocus placeholder="ex: minha-agencia" className="font-mono" />
              <p className="text-xs text-muted-foreground mt-1">Fornecido pela agência parceira</p>
            </div>
            <div>
              <Label>E-mail</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="seu@email.com" />
            </div>
            <div>
              <Label>Senha</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Product Form ─────────────────────────────────────────────────────────────
function ProductForm({
  initial, onSave, onCancel,
}: {
  initial?: Partial<PartnerProduct>;
  onSave: (data: PartnerProductInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    type: initial?.type ?? "passeio",
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    origin: initial?.origin ?? "",
    price: initial?.price ?? "",
    maxCapacity: initial?.maxCapacity ?? 10,
    durationMinutes: initial?.durationMinutes ?? "",
    meetingPoint: initial?.meetingPoint ?? "",
    locationUrl: initial?.locationUrl ?? "",
    cancellationPolicy: initial?.cancellationPolicy ?? "",
    faqText: (initial?.faq ?? []).map((item) => `${item.question} | ${item.answer}`).join("\n"),
  });
  function set(k: string, v: unknown) { setForm(f => ({ ...f, [k]: v })); }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Tipo</Label>
          <Select value={form.type} onValueChange={v => set("type", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TYPE_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Preço (R$)</Label>
          <Input type="number" min="0" step="0.01" value={form.price} onChange={e => set("price", e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Título</Label>
        <Input value={form.title} onChange={e => set("title", e.target.value)} required />
      </div>
      <div>
        <Label>Descrição</Label>
        <Textarea rows={3} value={form.description} onChange={e => set("description", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Capacidade máxima</Label>
          <Input type="number" min="1" value={form.maxCapacity} onChange={e => set("maxCapacity", Number(e.target.value))} />
        </div>
        <div>
          <Label>Duração (minutos)</Label>
          <Input type="number" min="1" value={form.durationMinutes} onChange={e => set("durationMinutes", e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Origem</Label>
        <Input value={form.origin} onChange={e => set("origin", e.target.value)} placeholder="Ex.: Centro de Juazeiro do Norte" />
      </div>
      <div>
        <Label>Ponto de encontro / Embarque</Label>
        <Input value={form.meetingPoint} onChange={e => set("meetingPoint", e.target.value)} />
      </div>
      <div>
        <Label>Link do mapa</Label>
        <Input type="url" value={form.locationUrl} onChange={e => set("locationUrl", e.target.value)} placeholder="https://maps.google.com/..." />
      </div>
      <div>
        <Label>Política de cancelamento</Label>
        <Textarea rows={2} value={form.cancellationPolicy} onChange={e => set("cancellationPolicy", e.target.value)} />
      </div>
      <div>
        <Label>FAQ (uma por linha: pergunta | resposta)</Label>
        <Textarea rows={3} value={form.faqText} onChange={e => set("faqText", e.target.value)} placeholder="O que levar? | Documento com foto e água." />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSave({
          type: form.type,
          title: form.title,
          description: form.description || null,
          origin: form.origin || null,
          price: Number(form.price),
          maxCapacity: Number(form.maxCapacity),
          durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
          meetingPoint: form.meetingPoint || null,
          locationUrl: form.locationUrl || null,
          cancellationPolicy: form.cancellationPolicy || null,
          faq: form.faqText.split("\n").map(line => line.split("|").map(part => part.trim())).filter(([question, answer]) => question && answer).map(([question, answer]) => ({ question, answer })),
        })}>Salvar</Button>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function PartnerDashboard({ profile, onLogout }: { profile: PartnerProfile; onLogout: () => void }) {
  const [products, setProducts] = useState<PartnerProduct[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [orders, setOrders] = useState<PartnerOrderItem[]>([]);
  const [availability, setAvailability] = useState<{ id: string; date: string; spotsTotal: number; spotsUsed: number }[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [avDate, setAvDate] = useState("");
  const [avSpots, setAvSpots] = useState(10);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingCommissions, setLoadingCommissions] = useState(true);
  const [productDialog, setProductDialog] = useState<{ open: boolean; product?: PartnerProduct }>({ open: false });
  const { toast } = useToast();

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const res = await partnerFetch<{ data: PartnerProduct[] }>("/partner/products");
      setProducts(res.data);
    } catch { /* ignore */ } finally { setLoadingProducts(false); }
  }, []);

  const loadCommissions = useCallback(async () => {
    setLoadingCommissions(true);
    try {
      const res = await partnerFetch<{ data: Commission[] }>("/partner/commissions");
      setCommissions(res.data);
    } catch { /* ignore */ } finally { setLoadingCommissions(false); }
  }, []);
  const loadOrders = useCallback(async () => {
    try {
      const res = await partnerFetch<{ data: PartnerOrderItem[] }>("/partner/orders");
      setOrders(res.data);
    } catch { /* visible sections remain usable if a request fails */ }
  }, []);

  const loadAvailability = useCallback(async (productId: string) => {
    try {
      const res = await partnerFetch<{ data: typeof availability }>(`/partner/products/${productId}/availability`);
      setAvailability(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadProducts(); void loadCommissions(); void loadOrders(); }, [loadProducts, loadCommissions, loadOrders]);
  useEffect(() => { if (selectedProductId) void loadAvailability(selectedProductId); }, [selectedProductId, loadAvailability]);

  async function saveProduct(data: PartnerProductInput) {
    try {
      if (productDialog.product) {
        await partnerFetch(`/partner/products/${productDialog.product.id}`, { method: "PUT", body: JSON.stringify(data) });
        toast({ title: "Produto atualizado" });
      } else {
        await partnerFetch("/partner/products", { method: "POST", body: JSON.stringify(data) });
        toast({ title: "Produto enviado para aprovação" });
      }
      setProductDialog({ open: false });
      void loadProducts();
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function deleteProduct(id: string) {
    if (!confirm("Remover produto?")) return;
    try {
      await partnerFetch(`/partner/products/${id}`, { method: "DELETE" });
      void loadProducts();
      toast({ title: "Produto removido" });
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function saveAvailability() {
    if (!selectedProductId || !avDate) return;
    try {
      await partnerFetch(`/partner/products/${selectedProductId}/availability`, {
        method: "PUT",
        body: JSON.stringify({ date: avDate, spotsTotal: avSpots }),
      });
      toast({ title: "Disponibilidade salva" });
      void loadAvailability(selectedProductId);
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
    }
  }
  async function updateOrderItem(item: PartnerOrderItem, data: Record<string, unknown>) {
    try {
      await partnerFetch(`/partner/order-items/${item.id}`, { method: "PUT", body: JSON.stringify(data) });
      toast({ title: data.status === "cancelled" ? "Item cancelado" : "Item atualizado" });
      void loadOrders();
    } catch (err) {
      toast({ title: "Erro ao atualizar item", description: (err as Error).message, variant: "destructive" });
    }
  }

  const totalPending = commissions
    .filter(c => c.status === COMMISSION_STATUS.PENDING)
    .reduce((s, c) => s + Number(c.partnerAmount), 0);
  const totalPaid = commissions
    .filter(c => c.status === "paid")
    .reduce((s, c) => s + Number(c.partnerAmount), 0);
  const thisMonth = localToday().slice(0, 7);
  const monthlyTotal = commissions
    .filter(c => c.period === thisMonth)
    .reduce((s, c) => s + Number(c.partnerAmount), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-semibold text-sm">{profile.name}</div>
              <div className="text-xs text-muted-foreground">{profile.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={STATUS_COLORS[profile.status] ?? ""}>
              {STATUS_LABELS[profile.status] ?? profile.status}
            </Badge>
            <Button variant="ghost" size="sm" onClick={onLogout}>
              <LogOut className="w-4 h-4 mr-1" /> Sair
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <Tabs defaultValue="dashboard">
          <TabsList className="mb-6">
            <TabsTrigger value="dashboard"><TrendingUp className="w-4 h-4 mr-1.5" />Resumo</TabsTrigger>
            <TabsTrigger value="products"><Package className="w-4 h-4 mr-1.5" />Produtos</TabsTrigger>
            <TabsTrigger value="availability"><Calendar className="w-4 h-4 mr-1.5" />Disponibilidade</TabsTrigger>
            <TabsTrigger value="orders"><ClipboardList className="w-4 h-4 mr-1.5" />Pedidos</TabsTrigger>
            <TabsTrigger value="commissions"><DollarSign className="w-4 h-4 mr-1.5" />Comissões</TabsTrigger>
          </TabsList>

          {/* ── Dashboard ── */}
          <TabsContent value="dashboard">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-blue-600">
                    {formatCurrency(totalPending)}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> A receber (pendente)
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-green-600">
                    {formatCurrency(totalPaid)}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" /> Total recebido
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-amber-600">
                    {formatCurrency(monthlyTotal)}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" /> Este mês ({thisMonth})
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <Card className="text-center p-4">
                <div className="text-3xl font-bold">{products.length}</div>
                <div className="text-xs text-muted-foreground mt-1">Produtos</div>
              </Card>
              <Card className="text-center p-4">
                <div className="text-3xl font-bold text-green-600">{products.filter(p => p.status === "active").length}</div>
                <div className="text-xs text-muted-foreground mt-1">Ativos</div>
              </Card>
              <Card className="text-center p-4">
                <div className="text-3xl font-bold text-yellow-600">{products.filter(p => p.status === "pending").length}</div>
                <div className="text-xs text-muted-foreground mt-1">Em aprovação</div>
              </Card>
              <Card className="text-center p-4">
                <div className="text-3xl font-bold">{commissions.length}</div>
                <div className="text-xs text-muted-foreground mt-1">Pedidos</div>
              </Card>
            </div>
            {commissions.slice(0, 5).length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Últimas comissões</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {commissions.slice(0, 5).map(c => (
                    <div key={c.id} className="flex items-center justify-between px-6 py-3 border-b last:border-0 text-sm">
                      <div>
                        <div className="font-medium">{c.order?.orderNumber ?? c.orderId.slice(0, 8)}</div>
                        <div className="text-xs text-muted-foreground">{c.order?.customerName}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-green-700">
                          {formatCurrency(Number(c.partnerAmount))}
                        </div>
                        <Badge className={`text-xs ${STATUS_COLORS[c.status] ?? ""}`}>{STATUS_LABELS[c.status] ?? c.status}</Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Products ── */}
          <TabsContent value="products">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Meus Produtos</h2>
              <Dialog open={productDialog.open} onOpenChange={open => setProductDialog(d => ({ ...d, open }))}>
                <DialogTrigger asChild>
                  <Button onClick={() => setProductDialog({ open: true, product: undefined })}>
                    <Plus className="w-4 h-4 mr-1.5" /> Novo Produto
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-xl">
                  <DialogHeader>
                    <DialogTitle>{productDialog.product ? "Editar Produto" : "Novo Produto"}</DialogTitle>
                  </DialogHeader>
                  <ProductForm
                    initial={productDialog.product}
                    onSave={saveProduct}
                    onCancel={() => setProductDialog({ open: false })}
                  />
                </DialogContent>
              </Dialog>
            </div>
            {loadingProducts ? (
              <div className="text-center text-muted-foreground py-12">Carregando...</div>
            ) : products.length === 0 ? (
              <Card className="text-center py-12">
                <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Nenhum produto cadastrado ainda.</p>
                <Button variant="outline" className="mt-4" onClick={() => setProductDialog({ open: true })}>
                  <Plus className="w-4 h-4 mr-1.5" /> Adicionar primeiro produto
                </Button>
              </Card>
            ) : (
              <div className="grid gap-4">
                {products.map(p => (
                  <Card key={p.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold truncate">{p.title}</span>
                            <Badge variant="outline" className="text-xs">{TYPE_LABELS[p.type] ?? p.type}</Badge>
                            <Badge className={`text-xs ${STATUS_COLORS[p.status] ?? ""}`}>{STATUS_LABELS[p.status] ?? p.status}</Badge>
                          </div>
                          <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-3">
                            <span>{formatCurrency(Number(p.price))}</span>
                            {p.durationMinutes && <span><Clock className="w-3 h-3 inline mr-0.5" />{p.durationMinutes} min</span>}
                            {p.maxCapacity && <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{p.maxCapacity} vagas</span>}
                          </div>
                          {p.meetingPoint && <div className="text-xs text-muted-foreground mt-1">📍 {p.meetingPoint}</div>}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="icon" variant="ghost" onClick={() => setProductDialog({ open: true, product: p })}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="text-red-500" onClick={() => deleteProduct(p.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Availability ── */}
          <TabsContent value="availability">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Selecionar Produto</CardTitle>
                  <CardDescription>Escolha um produto para gerenciar a disponibilidade por data</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {products.filter(p => p.status === "active").length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum produto ativo encontrado.</p>
                  ) : (
                    products.filter(p => p.status === "active").map(p => (
                      <div
                        key={p.id}
                        onClick={() => setSelectedProductId(p.id)}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors flex items-center justify-between ${selectedProductId === p.id ? "border-blue-500 bg-blue-50" : "hover:border-gray-300"}`}
                      >
                        <div>
                          <div className="font-medium text-sm">{p.title}</div>
                          <div className="text-xs text-muted-foreground">{TYPE_LABELS[p.type]}</div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Definir Disponibilidade</CardTitle>
                  <CardDescription>
                    {selectedProductId ? "Informe a data e quantidade de vagas" : "Selecione um produto à esquerda"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedProductId && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Data</Label>
                          <Input type="date" value={avDate} onChange={e => setAvDate(e.target.value)} min={localToday()} />
                        </div>
                        <div>
                          <Label>Vagas disponíveis</Label>
                          <Input type="number" min="0" value={avSpots} onChange={e => setAvSpots(Number(e.target.value))} />
                        </div>
                      </div>
                      <Button className="w-full" onClick={saveAvailability} disabled={!avDate}>
                        Salvar Disponibilidade
                      </Button>

                      {availability.length > 0 && (
                        <div className="mt-4">
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Datas cadastradas</div>
                          <div className="space-y-1">
                            {availability.slice(0, 10).map(a => (
                              <div key={a.id} className="flex items-center justify-between text-sm px-3 py-2 bg-slate-50 rounded-md">
                                <span className="font-mono">{a.date}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">{a.spotsUsed} usadas</span>
                                  <Badge variant="outline" className={a.spotsTotal - a.spotsUsed > 0 ? "border-green-300 text-green-700" : "border-red-300 text-red-700"}>
                                    {a.spotsTotal - a.spotsUsed} livres
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Operational orders: only the authenticated partner's items ── */}
          <TabsContent value="orders">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-lg font-semibold">Meus pedidos operacionais</h2>
                <p className="text-sm text-muted-foreground">Itens vendidos por você; pedidos mistos continuam separados.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadOrders()}>Atualizar</Button>
            </div>
            {orders.length === 0 ? (
              <Card className="text-center py-12"><ClipboardList className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">Nenhum item vendido ainda.</p></Card>
            ) : (
              <div className="space-y-3">
                {orders.map(item => (
                  <Card key={item.id}>
                    <CardContent className="py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex gap-2 items-center flex-wrap">
                            <span className="font-semibold">{item.productName}</span>
                            <Badge variant="outline">{item.itemStatus}</Badge>
                            <Badge variant="outline">{item.paymentStatus}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{item.orderNumber} · {item.customerName} · {item.quantity} un. · {formatCurrency(Number(item.total))}</p>
                          {typeof item.metadata?.["partnerDate"] === "string" && <p className="text-xs text-muted-foreground mt-1">Data escolhida: {String(item.metadata.partnerDate)}</p>}
                          {item.voucherCode && <p className="text-xs font-medium mt-1">Voucher: {item.voucherCode}</p>}
                          {item.cancellationReason && <p className="text-xs text-red-600 mt-1">Cancelado: {item.cancellationReason}</p>}
                        </div>
                        {item.itemStatus !== "cancelled" && item.paymentStatus === "paid" && (
                          <div className="flex gap-2 flex-wrap">
                            <Button size="sm" variant="outline" onClick={() => {
                              const voucherCode = prompt("Código do voucher:", item.voucherCode ?? "");
                              if (voucherCode) void updateOrderItem(item, { voucherCode, status: "confirmed" });
                            }}>Voucher</Button>
                            {item.itemStatus === "pending" && <Button size="sm" onClick={() => void updateOrderItem(item, { status: "confirmed" })}>Confirmar</Button>}
                            {item.itemStatus === "confirmed" && <Button size="sm" onClick={() => void updateOrderItem(item, { status: "fulfilled" })}>Concluir</Button>}
                            <Button size="sm" variant="destructive" onClick={() => {
                              const cancellationReason = prompt("Motivo do cancelamento:");
                              if (cancellationReason) void updateOrderItem(item, { status: "cancelled", cancellationReason });
                            }}>Cancelar item</Button>
                          </div>
                        )}
                        {item.itemStatus !== "cancelled" && item.paymentStatus !== "paid" && (
                          <p className="text-xs text-muted-foreground">Aguardando pagamento para liberar ações operacionais.</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Commissions ── */}
          <TabsContent value="commissions">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Extrato de Comissões</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <Card className="text-center p-4">
                <div className="text-xl font-bold text-amber-600">
                  {formatCurrency(totalPending)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Pendente</div>
              </Card>
              <Card className="text-center p-4">
                <div className="text-xl font-bold text-green-600">
                  {formatCurrency(totalPaid)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Recebido</div>
              </Card>
              <Card className="text-center p-4">
                <div className="text-xl font-bold">
                  {formatCurrency(monthlyTotal)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Este mês</div>
              </Card>
              <Card className="text-center p-4">
                <div className="text-xl font-bold">{commissions.length}</div>
                <div className="text-xs text-muted-foreground mt-1">Total pedidos</div>
              </Card>
            </div>

            {loadingCommissions ? (
              <div className="text-center text-muted-foreground py-12">Carregando...</div>
            ) : commissions.length === 0 ? (
              <Card className="text-center py-12">
                <DollarSign className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Nenhuma comissão registrada ainda.</p>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  {commissions.map(c => (
                    <div key={c.id} className="flex items-center justify-between px-6 py-4 border-b last:border-0">
                      <div>
                        <div className="font-medium text-sm">{c.order?.orderNumber ?? c.orderId.slice(0, 8)}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.order?.customerName} · {c.period} · {new Date(c.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-sm">
                          {formatCurrency(Number(c.partnerAmount))}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          de {formatCurrency(Number(c.grossAmount))}
                        </div>
                        <Badge className={`text-xs mt-0.5 ${STATUS_COLORS[c.status] ?? ""}`}>
                          {STATUS_LABELS[c.status] ?? c.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function ParceirosPortal() {
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    partnerFetch<PartnerProfile>("/partner/me")
      .then(p => setProfile(p))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  function handleLogin(p: PartnerProfile) { setProfile(p); }
  function handleLogout() { clearToken(); setProfile(null); }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!profile) return <LoginScreen onLogin={handleLogin} />;
  return <PartnerDashboard profile={profile} onLogout={handleLogout} />;
}

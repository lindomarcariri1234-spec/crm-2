import { useState, useEffect, useCallback } from "react";
import { localToday } from "@workspace/shared";
import { TENANT_STATUS } from "@workspace/permissions";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { ListLoadError } from "@/components/list-load-error";
import { Plus, Pencil, Download, CheckCircle, XCircle, Clock, Building2, Package, DollarSign, RefreshCw, Store } from "lucide-react";

interface Partner {
  id: string; name: string; email: string; cnpj: string | null;
  slug: string; description: string | null; phone: string | null;
  status: string; commissionPct: string; referralCommissionEligible: boolean; createdAt: string;
}
interface PartnerProduct {
  id: string; partnerId: string; type: string; title: string; slug: string;
  description: string | null; price: string; maxCapacity: number;
  durationMinutes: number | null; meetingPoint: string | null; status: string; createdAt: string;
}
interface CommissionReport {
  partnerId: string; partnerName: string; partnerEmail: string;
  grossAmount: number; partnerAmount: number; agencyAmount: number;
  pendingCount: number; paidCount: number; orderCount: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  [TENANT_STATUS.ACTIVE]: "bg-green-100 text-green-800 border-green-200",
  [TENANT_STATUS.SUSPENDED]: "bg-red-100 text-red-800 border-red-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  [TENANT_STATUS.ACTIVE]: "Ativo",
  [TENANT_STATUS.SUSPENDED]: "Suspenso",
  rejected: "Rejeitado",
};
const TYPE_LABELS: Record<string, string> = {
  passeio: "Passeio", transfer: "Transfer", experiencia: "Experiência", ingresso: "Ingresso",
};

function fmt(v: number) {
  return formatCurrency(v);
}

// ─── Create Partner Dialog ────────────────────────────────────────────────────
function CreatePartnerDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", cnpj: "", phone: "", description: "", commissionPct: "30", referralCommissionEligible: false, password: "" });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/parceiros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, commissionPct: Number(form.commissionPct) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast({ title: "Parceiro cadastrado com sucesso!" });
      setOpen(false);
      setForm({ name: "", email: "", cnpj: "", phone: "", description: "", commissionPct: "30", referralCommissionEligible: false, password: "" });
      onCreated();
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  function set(k: string, v: string | boolean) { setForm(f => ({ ...f, [k]: v })); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-1.5" />Novo Parceiro</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Cadastrar Parceiro</DialogTitle></DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Nome da empresa *</Label>
              <Input value={form.name} onChange={e => set("name", e.target.value)} required />
            </div>
            <div>
              <Label>E-mail de acesso *</Label>
              <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>CNPJ</Label>
              <Input value={form.cnpj} onChange={e => set("cnpj", e.target.value)} placeholder="00.000.000/0000-00" />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={e => set("phone", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Comissão agência (%) *</Label>
              <Input type="number" min="0" max="100" step="0.5" value={form.commissionPct} onChange={e => set("commissionPct", e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Parceiro recebe {100 - Number(form.commissionPct)}%</p>
            </div>
            <div>
              <Label>Senha inicial *</Label>
              <Input type="password" value={form.password} onChange={e => set("password", e.target.value)} required minLength={6} />
            </div>
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Elegível para comissão de indicação</Label>
              <p className="text-xs text-muted-foreground">Permite que campanhas paguem comissão por vendas atribuídas a este parceiro.</p>
            </div>
            <Switch checked={form.referralCommissionEligible} onCheckedChange={v => set("referralCommissionEligible", v)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Cadastrar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Partner Dialog ──────────────────────────────────────────────────────
function EditPartnerDialog({ partner, onSaved }: { partner: Partner; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    status: partner.status,
    commissionPct: partner.commissionPct,
    referralCommissionEligible: partner.referralCommissionEligible,
    password: "",
    phone: partner.phone ?? "",
    description: partner.description ?? "",
  });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        status: form.status,
        commissionPct: Number(form.commissionPct),
        referralCommissionEligible: form.referralCommissionEligible,
        phone: form.phone || null,
        description: form.description || null,
      };
      if (form.password) payload.password = form.password;
      const res = await fetch(`${import.meta.env.BASE_URL}api/parceiros/${partner.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast({ title: "Parceiro atualizado" });
      setOpen(false);
      onSaved();
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  function set(k: string, v: string | boolean) { setForm(f => ({ ...f, [k]: v })); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Pencil className="w-3.5 h-3.5 mr-1" />Editar</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Editar {partner.name}</DialogTitle></DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value={TENANT_STATUS.ACTIVE}>Ativo</SelectItem>
                  <SelectItem value={TENANT_STATUS.SUSPENDED}>Suspenso</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Comissão agência (%)</Label>
              <Input type="number" min="0" max="100" step="0.5" value={form.commissionPct} onChange={e => set("commissionPct", e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Nova senha (deixe vazio para não alterar)</Label>
            <Input type="password" value={form.password} onChange={e => set("password", e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <Label>Telefone</Label>
            <Input value={form.phone} onChange={e => set("phone", e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Elegível para comissão de indicação</Label>
              <p className="text-xs text-muted-foreground">Exige parceiro ativo e contrato comercial habilitado.</p>
            </div>
            <Switch checked={form.referralCommissionEligible} onCheckedChange={v => set("referralCommissionEligible", v)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Partner Products Panel ───────────────────────────────────────────────────
function PartnerProductsPanel({ partnerId }: { partnerId: string }) {
  const [products, setProducts] = useState<PartnerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${import.meta.env.BASE_URL}api/parceiros/${partnerId}/products`);
    if (res.ok) {
      const data = await res.json() as { data: PartnerProduct[] };
      setProducts(data.data);
    }
    setLoading(false);
  }, [partnerId]);

  useEffect(() => { void load(); }, [load]);

  async function updateStatus(productId: string, status: "active" | "rejected") {
    const res = await fetch(`${import.meta.env.BASE_URL}api/parceiros/${partnerId}/products/${productId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      toast({ title: status === TENANT_STATUS.ACTIVE ? "Listagem aprovada!" : "Listagem rejeitada" });
      void load();
    } else {
      toast({ title: "Erro ao atualizar", variant: "destructive" });
    }
  }

  async function createStoreProduct(p: PartnerProduct) {
    const slug = p.title.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      + "-" + p.id.slice(0, 6);
    const res = await fetch(`${import.meta.env.BASE_URL}api/store/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: p.type,
        name: p.title,
        slug,
        price: p.price,
        ...(p.description && { shortDescription: p.description }),
        partnerProductId: p.id,
        status: TENANT_STATUS.ACTIVE,
      }),
    });
    if (res.ok) {
      toast({ title: "Produto criado na vitrine!", description: `Slug: ${slug}` });
    } else {
      const body = await res.json() as { error?: string };
      toast({ title: "Erro ao criar produto", description: body.error ?? "Tente novamente", variant: "destructive" });
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground py-4">Carregando...</div>;
  if (products.length === 0) return <div className="text-sm text-muted-foreground py-4">Nenhum produto cadastrado.</div>;

  return (
    <div className="space-y-2">
      {products.map(p => (
        <div key={p.id} className="flex items-start justify-between gap-4 p-3 bg-slate-50 rounded-lg border">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">{p.title}</span>
              <Badge variant="outline" className="text-xs">{TYPE_LABELS[p.type] ?? p.type}</Badge>
              <Badge className={`text-xs ${STATUS_COLORS[p.status] ?? ""}`}>{STATUS_LABELS[p.status] ?? p.status}</Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {fmt(Number(p.price))} · {p.maxCapacity} vagas
              {p.durationMinutes ? ` · ${p.durationMinutes} min` : ""}
              {p.meetingPoint ? ` · 📍${p.meetingPoint}` : ""}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            {p.status === "pending" && (<>
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => updateStatus(p.id, TENANT_STATUS.ACTIVE as "active")}>
                <CheckCircle className="w-3.5 h-3.5 mr-1" />Aprovar
              </Button>
              <Button size="sm" variant="destructive" onClick={() => updateStatus(p.id, "rejected")}>
                <XCircle className="w-3.5 h-3.5 mr-1" />Rejeitar
              </Button>
            </>)}
            {p.status === TENANT_STATUS.ACTIVE && (
              <Button size="sm" variant="outline" onClick={() => void createStoreProduct(p)} title="Criar produto na vitrine vinculado a este parceiro">
                <Store className="w-3.5 h-3.5 mr-1" />Criar na Vitrine
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LojaParceiros() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(true);
  const [partnersError, setPartnersError] = useState<string | null>(null);
  const [expandedPartner, setExpandedPartner] = useState<string | null>(null);
  const [report, setReport] = useState<CommissionReport[]>([]);
  const [reportPeriod, setReportPeriod] = useState(localToday().slice(0, 7));
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const { toast } = useToast();

  const loadPartners = useCallback(async () => {
    setLoadingPartners(true);
    setPartnersError(null);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/parceiros`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { data: Partner[] };
      setPartners(data.data);
    } catch (err: unknown) {
      setPartnersError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPartners(false);
    }
  }, []);

  const loadReport = useCallback(async () => {
    setLoadingReport(true);
    setReportError(null);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/parceiros/commissions?period=${reportPeriod}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { data: CommissionReport[] };
      setReport(data.data);
    } catch (err: unknown) {
      setReportError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingReport(false);
    }
  }, [reportPeriod]);

  useEffect(() => { void loadPartners(); }, [loadPartners]);
  useEffect(() => { void loadReport(); }, [loadReport]);

  function downloadCsv() {
    const url = `${import.meta.env.BASE_URL}api/parceiros/commissions?period=${reportPeriod}&export=csv`;
    window.open(url, "_blank");
  }

  function openPdfReport() {
    const url = `${import.meta.env.BASE_URL}api/parceiros/commissions?period=${reportPeriod}&export=pdf`;
    window.open(url, "_blank");
  }

  const pendingApprovals = partners.filter(p => p.status === "pending").length;
  const activePartners = partners.filter(p => p.status === TENANT_STATUS.ACTIVE).length;
  const totalPendingPayout = report.reduce((s, r) => s + Number(r.partnerAmount), 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="w-6 h-6" /> Parceiros
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Gerencie fornecedores parceiros, listagens e repasses de comissão
          </p>
        </div>
        <CreatePartnerDialog onCreated={loadPartners} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="text-center p-4">
          <div className="text-2xl font-bold">{partners.length}</div>
          <div className="text-xs text-muted-foreground mt-1">Total parceiros</div>
        </Card>
        <Card className="text-center p-4">
          <div className="text-2xl font-bold text-green-600">{activePartners}</div>
          <div className="text-xs text-muted-foreground mt-1">Ativos</div>
        </Card>
        <Card className="text-center p-4">
          <div className="text-2xl font-bold text-yellow-600">{pendingApprovals}</div>
          <div className="text-xs text-muted-foreground mt-1">Aguardando aprovação</div>
        </Card>
        <Card className="text-center p-4">
          <div className="text-xl font-bold text-blue-600">{fmt(totalPendingPayout)}</div>
          <div className="text-xs text-muted-foreground mt-1">Repasse pendente (mês)</div>
        </Card>
      </div>

      <Tabs defaultValue="partners">
        <TabsList>
          <TabsTrigger value="partners">
            <Building2 className="w-4 h-4 mr-1.5" />Parceiros
            {pendingApprovals > 0 && <Badge className="ml-1.5 h-4 px-1 text-xs bg-yellow-500">{pendingApprovals}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="commissions">
            <DollarSign className="w-4 h-4 mr-1.5" />Relatório de Repasses
          </TabsTrigger>
        </TabsList>

        {/* ── Partners Tab ── */}
        <TabsContent value="partners" className="mt-4">
          {loadingPartners ? (
            <div className="text-center text-muted-foreground py-12">Carregando parceiros...</div>
          ) : partnersError ? (
            <Card>
              <CardContent>
                <ListLoadError onRetry={loadPartners} message={partnersError} />
              </CardContent>
            </Card>
          ) : partners.length === 0 ? (
            <Card className="text-center py-12">
              <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">Nenhum parceiro cadastrado ainda.</p>
              <p className="text-sm text-muted-foreground mt-1">Cadastre fornecedores de passeios, transfers e experiências.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {partners.map(p => (
                <Card key={p.id} className="overflow-hidden">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{p.name}</span>
                          <Badge className={`text-xs ${STATUS_COLORS[p.status] ?? ""}`}>{STATUS_LABELS[p.status] ?? p.status}</Badge>
                          <span className="text-xs text-muted-foreground">Comissão agência: {p.commissionPct}%</span>
                          <span className="text-xs text-muted-foreground">Repasse parceiro: {(100 - Number(p.commissionPct)).toFixed(1)}%</span>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1 flex gap-3">
                          <span>{p.email}</span>
                          {p.phone && <span>{p.phone}</span>}
                          {p.cnpj && <span>CNPJ: {p.cnpj}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExpandedPartner(expandedPartner === p.id ? null : p.id)}
                        >
                          <Package className="w-3.5 h-3.5 mr-1" />
                          {expandedPartner === p.id ? "Fechar" : "Produtos"}
                        </Button>
                        <EditPartnerDialog partner={p} onSaved={loadPartners} />
                      </div>
                    </div>

                    {expandedPartner === p.id && (
                      <div className="mt-4 pt-4 border-t">
                        <div className="text-sm font-medium mb-3 flex items-center gap-1.5">
                          <Package className="w-4 h-4" /> Produtos de {p.name}
                        </div>
                        <PartnerProductsPanel partnerId={p.id} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Commissions Tab ── */}
        <TabsContent value="commissions" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base">Relatório de Repasses Mensais</CardTitle>
                  <CardDescription>Consolidado por parceiro · Valores em Reais</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="month"
                    value={reportPeriod}
                    onChange={e => setReportPeriod(e.target.value)}
                    className="w-40"
                  />
                  <Button variant="outline" size="sm" onClick={loadReport} disabled={loadingReport}>
                    <RefreshCw className={`w-4 h-4 ${loadingReport ? "animate-spin" : ""}`} />
                  </Button>
                  <Button size="sm" variant="outline" onClick={openPdfReport} title="Abrir relatório para imprimir/salvar como PDF">
                    <Download className="w-4 h-4 mr-1.5" />PDF
                  </Button>
                  <Button size="sm" onClick={downloadCsv}>
                    <Download className="w-4 h-4 mr-1.5" />CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingReport ? (
                <div className="text-center py-8 text-muted-foreground">Carregando...</div>
              ) : reportError ? (
                <ListLoadError onRetry={loadReport} message={reportError} />
              ) : report.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhuma comissão registrada em {reportPeriod}.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parceiro</TableHead>
                      <TableHead className="text-right">Pedidos</TableHead>
                      <TableHead className="text-right">Volume Bruto</TableHead>
                      <TableHead className="text-right">Repasse Parceiro</TableHead>
                      <TableHead className="text-right">Receita Agência</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.map(r => (
                      <TableRow key={r.partnerId}>
                        <TableCell>
                          <div className="font-medium">{r.partnerName}</div>
                          <div className="text-xs text-muted-foreground">{r.partnerEmail}</div>
                        </TableCell>
                        <TableCell className="text-right">{r.orderCount}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(Number(r.grossAmount))}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-blue-700 font-semibold">{fmt(Number(r.partnerAmount))}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-green-700">{fmt(Number(r.agencyAmount))}</TableCell>
                        <TableCell className="text-center">
                          {r.paidCount === r.orderCount ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">
                              <CheckCircle className="w-3 h-3 mr-0.5" />Pago
                            </Badge>
                          ) : r.pendingCount > 0 ? (
                            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-xs">
                              <Clock className="w-3 h-3 mr-0.5" />Pendente
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">—</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-slate-50 font-semibold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">{report.reduce((s, r) => s + r.orderCount, 0)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(report.reduce((s, r) => s + Number(r.grossAmount), 0))}</TableCell>
                      <TableCell className="text-right font-mono text-blue-700">{fmt(report.reduce((s, r) => s + Number(r.partnerAmount), 0))}</TableCell>
                      <TableCell className="text-right font-mono text-green-700">{fmt(report.reduce((s, r) => s + Number(r.agencyAmount), 0))}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

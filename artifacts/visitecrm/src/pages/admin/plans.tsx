import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import {
  useListPlans,
  useCreatePlan,
  useUpdatePlan,
  useArchivePlan,
  useGetPlansStripeHealth,
  useListPlatformSettings,
  useUpdatePlatformSetting,
  type Plan,
  type PlanStripeHealthItem,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Archive, AlertTriangle, RefreshCw, CheckCircle2, ChevronDown, ChevronUp, Zap, Mail, Save } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListPlansQueryKey,
  useGetSystemHealth,
  getGetSystemHealthQueryKey,
  getGetPlansStripeHealthQueryKey,
  getListPlatformSettingsQueryKey,
  type SystemHealthStripeWebhookAuditEndpoint,
} from "@workspace/api-client-react";

interface PlanFormData {
  name: string;
  slug: string;
  description: string;
  monthlyPrice: string;
  annualPrice: string;
  maxUsers: number;
  maxClients: number;
  maxTrips: number;
  features: string;
  supportedFeatures: string;
  isActive: boolean;
  isFeatured: boolean;
}

const DEFAULT_FORM: PlanFormData = {
  name: "",
  slug: "",
  description: "",
  monthlyPrice: "0",
  annualPrice: "0",
  maxUsers: 5,
  maxClients: 100,
  maxTrips: 20,
  features: "",
  supportedFeatures: "",
  isActive: true,
  isFeatured: false,
};

interface PlanModalProps {
  plan: Plan | null;
  onClose: () => void;
}

function PlanModal({ plan, onClose }: PlanModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();

  const [form, setForm] = useState<PlanFormData>(
    plan
      ? {
          name: plan.name,
          slug: plan.slug,
          description: plan.description ?? "",
          monthlyPrice: plan.monthlyPrice,
          annualPrice: plan.annualPrice,
          maxUsers: plan.maxUsers,
          maxClients: plan.maxClients,
          maxTrips: plan.maxTrips,
          features: (plan.features ?? []).join(", "),
          supportedFeatures: (plan.supportedFeatures ?? []).join(", "),
          isActive: plan.isActive,
          isFeatured: plan.isFeatured,
        }
      : DEFAULT_FORM
  );

  const isLoading = createPlan.isPending || updatePlan.isPending;

  async function handleSave() {
    const data = {
      name: form.name,
      slug: form.slug,
      description: form.description || undefined,
      monthlyPrice: form.monthlyPrice,
      annualPrice: form.annualPrice,
      maxUsers: form.maxUsers,
      maxClients: form.maxClients,
      maxTrips: form.maxTrips,
      features: form.features ? form.features.split(",").map((f) => f.trim()).filter(Boolean) : [],
      supportedFeatures: form.supportedFeatures ? form.supportedFeatures.split(",").map((f) => f.trim()).filter(Boolean) : [],
      isActive: form.isActive,
      isFeatured: form.isFeatured,
    };
    try {
      if (plan) {
        await updatePlan.mutateAsync({ id: plan.id, data });
      } else {
        await createPlan.mutateAsync({ data });
      }
      await queryClient.invalidateQueries({ queryKey: getListPlansQueryKey() });
      toast({ title: plan ? "Plano atualizado" : "Plano criado com sucesso" });
      onClose();
    } catch {
      toast({ title: "Erro ao salvar plano", variant: "destructive" });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? "Editar Plano" : "Novo Plano"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Pro" />
            </div>
            <div>
              <Label className="text-sm font-medium">Slug</Label>
              <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="pro" />
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Descrição</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Para agências em crescimento" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Preço Mensal (R$)</Label>
              <Input type="number" value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })} />
            </div>
            <div>
              <Label className="text-sm font-medium">Preço Anual (R$)</Label>
              <Input type="number" value={form.annualPrice} onChange={(e) => setForm({ ...form, annualPrice: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-sm font-medium">Máx. Usuários</Label>
              <Input type="number" value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: parseInt(e.target.value) || 0 })} />
            </div>
            <div>
              <Label className="text-sm font-medium">Máx. Clientes</Label>
              <Input type="number" value={form.maxClients} onChange={(e) => setForm({ ...form, maxClients: parseInt(e.target.value) || 0 })} />
            </div>
            <div>
              <Label className="text-sm font-medium">Máx. Viagens</Label>
              <Input type="number" value={form.maxTrips} onChange={(e) => setForm({ ...form, maxTrips: parseInt(e.target.value) || 0 })} />
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Features de marketing (separadas por vírgula)</Label>
            <Input value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder="CRM, Relatórios, API" />
          </div>
          <div>
            <Label className="text-sm font-medium">Funcionalidades habilitadas (separadas por vírgula)</Label>
            <Input value={form.supportedFeatures} onChange={(e) => setForm({ ...form, supportedFeatures: e.target.value })} placeholder="referrals, coupons, seatMap" />
            <p className="text-xs text-muted-foreground mt-1">Chaves de funcionalidades desbloqueadas neste plano. Ex: <span className="font-mono">referrals</span>, <span className="font-mono">coupons</span>, <span className="font-mono">seatMap</span></p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-sm">Ativo</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.isFeatured} onCheckedChange={v => setForm(f => ({ ...f, isFeatured: v }))} />
              <Label className="text-sm">Destaque</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isLoading || !form.name || !form.slug}>
            {isLoading ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StripeWebhookAuditBanner() {
  const queryClient = useQueryClient();
  const { data: systemHealth } = useGetSystemHealth({
    query: { queryKey: getGetSystemHealthQueryKey(), refetchInterval: 60_000 },
  });
  const [rechecking, setRechecking] = useState(false);
  const { toast } = useToast();

  const audit = systemHealth?.stripeWebhookAudit;
  if (!audit || audit.status !== "duplicate") return null;

  const endpoints: SystemHealthStripeWebhookAuditEndpoint[] = audit.endpoints ?? [];

  async function handleRecheck() {
    setRechecking(true);
    try {
      const res = await fetch("/api/admin/stripe/audit-webhooks", { method: "POST" });
      if (!res.ok) throw new Error("recheck failed");
      const body = (await res.json()) as { audit: { status: string } };
      await queryClient.invalidateQueries({ queryKey: getGetSystemHealthQueryKey() });
      if (body.audit.status === "ok") {
        toast({ title: "Verificação concluída — nenhum webhook duplicado encontrado." });
      } else if (body.audit.status === "unknown") {
        toast({
          title: "Não foi possível verificar",
          description: "O Stripe não pôde ser consultado agora. Tente novamente em alguns instantes.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Ainda há webhooks duplicados",
          description: "Remova o endpoint extra no Dashboard do Stripe e tente novamente.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Erro ao reverificar — tente novamente.", variant: "destructive" });
    } finally {
      setRechecking(false);
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
      <AlertTriangle aria-hidden="true" className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" />
      <div className="text-sm flex-1">
        <p className="font-medium">
          {audit.duplicateCount} endpoints de webhook do Stripe ativos apontam para este app
        </p>
        <p className="text-amber-700 mt-0.5">
          Isso faz cada evento de cobrança ser processado múltiplas vezes (ex.: ativações de plano
          duplicadas). Remova o(s) endpoint(s) extra(s) no Dashboard do Stripe, mantendo apenas o
          gerenciado automaticamente.
        </p>
        {endpoints.length > 0 && (
          <ul className="mt-2 space-y-0.5 font-mono text-xs text-amber-700">
            {endpoints.map((ep) => (
              <li key={ep.id} title={ep.url}>
                {ep.id} — {ep.url}
              </li>
            ))}
          </ul>
        )}
        <Button
          size="sm"
          variant="outline"
          className="mt-3 border-amber-400 text-amber-800 hover:bg-amber-100"
          onClick={handleRecheck}
          disabled={rechecking}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${rechecking ? "animate-spin" : ""}`} />
          {rechecking ? "Verificando…" : "Re-verificar agora"}
        </Button>
      </div>
    </div>
  );
}

function StripeHealthBadge({ health }: { health: PlanStripeHealthItem | undefined }) {
  if (!health) return null;
  if (health.isFree) return null;

  const issues: string[] = [];
  if (!health.monthlyOk) issues.push("mensal");
  if (!health.annualOk) issues.push("anual");

  if (issues.length === 0) return null;

  return (
    <Badge
      variant="destructive"
      className="text-xs gap-1"
      title={`Preço Stripe ausente: ${issues.join(", ")}. Configure um preço com metadata planSlug="${health.slug}".`}
    >
      <AlertTriangle className="w-3 h-3" />
      Stripe: sem preço {issues.join(" & ")}
    </Badge>
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function StripeAlertRecipientSettings() {
  const { data: platformSettings = [], isLoading } = useListPlatformSettings();
  const updateSetting = useUpdatePlatformSetting();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const setting = platformSettings.find((item) => item.key === "stripe_health_alert_email");
  const [email, setEmail] = useState("");

  useEffect(() => {
    setEmail(setting?.value ?? "");
  }, [setting?.value]);

  const trimmedEmail = email.trim();
  const isDirty = trimmedEmail !== (setting?.value?.trim() ?? "");
  const emailError = trimmedEmail !== "" && !EMAIL_REGEX.test(trimmedEmail)
    ? "Insira um endereço de e-mail válido"
    : null;
  const fallbackEmail = setting?.fallbackValue?.trim();

  async function handleSave() {
    if (!setting || emailError) return;

    try {
      await updateSetting.mutateAsync({
        key: setting.key,
        data: { value: trimmedEmail || null },
      });
      await queryClient.invalidateQueries({ queryKey: getListPlatformSettingsQueryKey() });
      toast({
        title: trimmedEmail ? "E-mail de alerta do Stripe atualizado" : "Alerta do Stripe voltou a usar o e-mail padrão",
      });
    } catch {
      toast({ title: "Erro ao salvar e-mail de alerta do Stripe", variant: "destructive" });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Alertas de saúde do Stripe
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Receba um aviso quando algum plano pago não tiver um preço mensal ou anual válido no Stripe.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="animate-pulse text-sm text-muted-foreground">Carregando configuração...</div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="stripe-alert-email">E-mail para alertas</Label>
              <Input
                id="stripe-alert-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={fallbackEmail ?? "operacoes@empresa.com"}
                className={emailError ? "border-red-400 focus-visible:ring-red-400" : ""}
              />
              {emailError ? (
                <p className="text-xs text-red-600">{emailError}</p>
              ) : trimmedEmail ? (
                <p className="text-xs text-muted-foreground">Este endereço substitui o e-mail padrão da plataforma.</p>
              ) : fallbackEmail ? (
                <p className="text-xs text-muted-foreground">
                  Sem substituição: os alertas serão enviados para o e-mail padrão <span className="font-medium">{fallbackEmail}</span>.
                </p>
              ) : (
                <p className="text-xs text-amber-700">
                  Nenhum e-mail padrão foi configurado. Informe um endereço para receber os alertas.
                </p>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!setting || !isDirty || Boolean(emailError) || updateSetting.isPending}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {updateSetting.isPending ? "Salvando..." : "Salvar e-mail"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface StripeSeedSectionProps {
  stripeConfigured: boolean | undefined;
  unhealthyCount: number;
  isHealthLoading: boolean;
  onRefresh: () => void;
}

function StripeSeedSection({ stripeConfigured, unhealthyCount, isHealthLoading, onRefresh }: StripeSeedSectionProps) {
  const [expanded, setExpanded] = useState(false);

  // Don't render anything while Stripe is not configured (separate card handles that)
  if (!stripeConfigured) return null;

  const allHealthy = unhealthyCount === 0;

  if (allHealthy && !expanded) {
    return (
      <div className="flex items-start gap-2.5 rounded-md border border-green-200 bg-green-50 px-3 py-2.5">
        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-0.5">
          <p className="text-sm font-medium text-green-800">
            Preços Stripe configurados{" "}
            <span className="font-normal text-green-700">— todos os planos têm preços mensal e anual válidos</span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2 text-green-700 hover:text-green-900 hover:bg-green-100 mt-1"
            onClick={() => setExpanded(true)}
          >
            <ChevronDown className="w-3 h-3 mr-1.5" />
            Mostrar opções de seed
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card className={allHealthy ? "border-muted" : "border-destructive/30 bg-destructive/5"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          Seed de Preços Stripe
          {allHealthy && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-xs h-7 px-2 text-muted-foreground"
              onClick={() => setExpanded(false)}
            >
              <ChevronUp className="w-3 h-3 mr-1.5" />
              Recolher
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!allHealthy && (
          <div className="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">
              <span className="font-medium">{unhealthyCount} plano{unhealthyCount !== 1 ? "s" : ""} sem preço Stripe.</span>{" "}
              Clientes que tentarem assinar esses planos receberão um erro.
            </p>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Cada plano pago precisa de um preço Stripe ativo com{" "}
          <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">metadata.planSlug</span> igual ao slug do plano,
          usando a moeda <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">brl</span>.
          Execute o script de seed para criar automaticamente todos os preços ausentes:
        </p>
        <pre className="rounded-md bg-muted px-3 py-2 text-xs font-mono overflow-x-auto">
          pnpm --filter @workspace/api-server run seed:stripe-plans
        </pre>
        <p className="text-xs text-muted-foreground">
          Ou crie os preços manualmente no Dashboard do Stripe com{" "}
          <span className="font-mono">metadata.planSlug = &quot;&lt;slug&gt;&quot;</span> e intervalo correto (mensal/anual).
        </p>
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isHealthLoading}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isHealthLoading ? "animate-spin" : ""}`} />
            Verificar novamente
          </Button>
          {allHealthy && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setExpanded(false)}
            >
              Recolher
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPlans() {
  const { data: plans = [], isLoading } = useListPlans();
  const { data: stripeHealth, isLoading: isHealthLoading, refetch: refetchHealth } = useGetPlansStripeHealth();
  const archivePlan = useArchivePlan();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [modalPlan, setModalPlan] = useState<Plan | null | "new">(null);

  const healthBySlug: Record<string, PlanStripeHealthItem> = {};
  if (stripeHealth?.plans) {
    for (const h of stripeHealth.plans) {
      healthBySlug[h.slug] = h;
    }
  }

  const unhealthyCount = stripeHealth?.plans.filter((h: PlanStripeHealthItem) => !h.isFree && (!h.monthlyOk || !h.annualOk)).length ?? 0;

  async function handleArchive(id: string) {
    try {
      await archivePlan.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListPlansQueryKey() });
      toast({ title: "Plano arquivado" });
    } catch {
      toast({ title: "Erro ao arquivar plano", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Planos</h1>
          <p className="text-muted-foreground text-sm mt-1">{plans.length} plano{plans.length !== 1 ? "s" : ""} cadastrado{plans.length !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={() => setModalPlan("new")}>
          <Plus className="w-4 h-4 mr-2" />
          Novo Plano
        </Button>
      </div>

      <StripeWebhookAuditBanner />

      {stripeHealth?.stripeConfigured === false && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Stripe não configurado</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                Conecte o Stripe via Integrações ou defina <span className="font-mono">STRIPE_SECRET_KEY</span> para verificar a configuração de preços.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {stripeHealth?.stripeConfigured !== undefined && (
        <StripeSeedSection
          stripeConfigured={stripeHealth.stripeConfigured}
          unhealthyCount={unhealthyCount}
          isHealthLoading={isHealthLoading}
          onRefresh={() => {
            queryClient.invalidateQueries({ queryKey: getGetPlansStripeHealthQueryKey() });
            refetchHealth();
          }}
        />
      )}

      <StripeAlertRecipientSettings />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-pulse text-muted-foreground">Carregando planos...</div>
            </div>
          ) : plans.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-muted-foreground">Nenhum plano cadastrado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plano</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Preço Mensal</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Preço Anual</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Limites</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => {
                    const health = healthBySlug[plan.slug];
                    const hasMissingPrice = health && !health.isFree && (!health.monthlyOk || !health.annualOk);
                    return (
                      <tr key={plan.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${hasMissingPrice ? "bg-destructive/5" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium flex items-center gap-2 flex-wrap">
                            {plan.name}
                            {plan.isFeatured && <Badge variant="secondary" className="text-xs">Destaque</Badge>}
                            <StripeHealthBadge health={health} />
                          </div>
                          <div className="text-xs text-muted-foreground">{plan.slug}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {formatCurrency(Number(plan.monthlyPrice))}/mês
                            {health && !health.isFree && !health.monthlyOk && Number(plan.monthlyPrice) > 0 && (
                              <span title="Preço Stripe mensal não encontrado">
                                <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {formatCurrency(Number(plan.annualPrice))}/ano
                            {health && !health.isFree && !health.annualOk && Number(plan.annualPrice) > 0 && (
                              <span title="Preço Stripe anual não encontrado">
                                <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {plan.maxUsers} usuários · {plan.maxClients} clientes · {plan.maxTrips} viagens
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={plan.isActive ? "default" : "secondary"}>
                            {plan.isActive ? "Ativo" : "Arquivado"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setModalPlan(plan)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleArchive(plan.id)}
                              disabled={archivePlan.isPending}
                            >
                              <Archive className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {modalPlan && (
        <PlanModal
          plan={modalPlan === "new" ? null : modalPlan}
          onClose={() => setModalPlan(null)}
        />
      )}
    </div>
  );
}

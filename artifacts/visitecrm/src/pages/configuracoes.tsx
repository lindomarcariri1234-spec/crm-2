import { useState, useEffect, useCallback, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { CoverImageUpload } from "@/components/cover-image-upload";
import { storeApi } from "@/lib/storeApi";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useGetTenant,
  getGetTenantQueryKey,
  useUpdateTenant,
  useListSystemConfigs,
  useUpsertSystemConfig,
  useGetMe,
  useGetCalendarStatus,
  getGetCalendarStatusQueryKey,
  useDisconnectCalendar,
  useSyncCalendar,
  getCalendarConnectUrl,
  useGetCurrentSubscription,
  useUpgradeSubscription,
  useCreateStripeCheckout,
  useCreateCustomerPortalSession,
  getCurrentSubscriptionQueryKey,
  type PlanPublic,
  type SubscriptionInvoice,
} from "@workspace/api-client-react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import type {
  UpdateTenantBody,
  SystemConfig,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsNavigation } from "@/components/settings/SettingsNavigation";
import {
  buildAgencySettingsTabUrl,
  getLegacyBackupRedirect,
  getAgencySettingsAccess,
  normalizeAgencySettingsTabUrl,
} from "@/components/settings/agency-settings-access";
import {
  AgencySettingsDirtyContext,
  hasUnsavedAgencySettings,
  updateAgencySettingsDirtySources,
  useAgencySettingsDirty,
} from "@/components/settings/agency-settings-dirty";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { extractApiError } from "@/lib/apiError";
import {
  Building2,
  CreditCard,
  Puzzle,
  Bell,
  Palette,
  Key,
  CheckCircle2,
  Wifi,
  Users,
  UserPlus,
  Mail,
  Loader2,
  Trash2,
  Target,
  Lock,
  CalendarDays,
  RefreshCw,
  Link2,
  Unlink,
  ToggleLeft,
  Sparkles,
  AlertCircle,
  History,
  ShieldOff,
  Crown,
  Star,
  GitBranch,
  Plus,
  Pencil,
  X,
  Settings2,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  Save,
  Wrench,
} from "lucide-react";
import { formatCurrencyBRL } from "@/lib/utils";
import { interpolateWhatsAppPreview, renderWhatsAppPreview } from "@/lib/whatsappPreview";
import { ROLES, INVOICE_STATUS } from "@workspace/permissions";
import { FeaturesTab } from "./FeaturesTab";
import { LinkedDataIntegrityPanel } from "@/components/linked-data-integrity-panel";
import { FinancialMetricsOverview } from "@/components/financial-metrics-overview";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ──────────────────── Sales Goal Section ──────────────────── */
function SalesGoalSection() {
  const { toast } = useToast();
  const { data: configs = [], refetch } = useListSystemConfigs();
  const upsert = useUpsertSystemConfig();
  const currentGoal = (() => {
    const v = configs.find((c) => c.key === "salesMonthlyGoal")?.value;
    return typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : 50000;
  })();
  const [goalInput, setGoalInput] = useState("");
  useAgencySettingsDirty("agency", "sales-monthly-goal", goalInput !== String(currentGoal));

  useEffect(() => {
    setGoalInput(String(currentGoal));
  }, [currentGoal]);

  async function handleSaveGoal() {
    const parsed = parseFloat(goalInput);
    if (isNaN(parsed) || parsed <= 0) {
      toast({ title: "Valor inválido para a meta", variant: "destructive" });
      return;
    }
    try {
      await upsert.mutateAsync({ data: { key: "salesMonthlyGoal", value: parsed } });
      toast({ title: "Meta de vendas atualizada" });
      refetch();
    } catch {
      toast({ title: "Erro ao salvar meta", variant: "destructive" });
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3 mt-4">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Meta de Vendas Mensal</h3>
      </div>
      <p className="text-xs text-muted-foreground">Defina a meta de faturamento mensal por vendedor. Usada no painel de vendedores.</p>
      <div className="flex items-center gap-2 max-w-xs">
        <span className="text-sm text-muted-foreground">R$</span>
        <Input
          value={goalInput}
          onChange={(e) => setGoalInput(e.target.value)}
          placeholder="50000"
          type="number"
          min="0"
          step="1000"
        />
        <Button size="sm" onClick={handleSaveGoal} disabled={upsert.isPending}>
          Salvar
        </Button>
      </div>
    </div>
  );
}

/* ──────────────────── Agency Profile Tab ──────────────────── */
function AgencyProfileTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me, refetch: refetchMe } = useGetMe();
  const tenantId = me?.tenantId ?? null;
  const { data: fullTenant } = useGetTenant(tenantId ?? "", {
    query: {
      queryKey: getGetTenantQueryKey(tenantId ?? ""),
      enabled: !!tenantId,
    },
  });
  const updateTenant = useUpdateTenant();

  const [form, setForm] = useState<UpdateTenantBody>({});
  const [savedForm, setSavedForm] = useState<UpdateTenantBody>({});
  useAgencySettingsDirty("agency", "agency-profile", JSON.stringify(form) !== JSON.stringify(savedForm));
  const [prefixError, setPrefixError] = useState<string | null>(null);
  useEffect(() => {
    if (fullTenant) {
      const loadedForm = {
        name: fullTenant.name,
        cnpj: fullTenant.cnpj ?? "",
        logoUrl: fullTenant.logoUrl ?? "",
        address: fullTenant.address ?? "",
        city: fullTenant.city ?? "",
        state: fullTenant.state ?? "",
        zipCode: fullTenant.zipCode ?? "",
        whatsapp: fullTenant.whatsapp ?? "",
        phone: fullTenant.phone ?? "",
        website: fullTenant.website ?? "",
        reservationPrefix: fullTenant.reservationPrefix ?? "",
      };
      setForm(loadedForm);
      setSavedForm(loadedForm);
    } else if (me?.tenant) {
      const loadedFields = {
        name: me.tenant.name,
      };
      setForm((current) => ({ ...current, ...loadedFields }));
      setSavedForm((current) => ({ ...current, ...loadedFields }));
    }
  }, [fullTenant?.id, me?.tenant?.id]);

  async function handleSave() {
    if (!tenantId) {
      toast({ title: "Não foi possível identificar a agência", variant: "destructive" });
      return;
    }
    if (form.reservationPrefix != null && form.reservationPrefix !== "" && !/^[A-Z]{1,5}$/.test(form.reservationPrefix)) {
      setPrefixError("O prefixo deve conter apenas letras (1–5 caracteres)");
      return;
    }
    setPrefixError(null);
    try {
      const submitData = { ...form };
      if (fullTenant?.prefixLocked) {
        delete submitData.reservationPrefix;
      }
      await updateTenant.mutateAsync({ id: tenantId, data: submitData });
      setSavedForm(form);
      toast({ title: "Perfil da agência atualizado" });
      await queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
      refetchMe();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { code?: string; error?: string } } })?.response?.data;
      if (data?.code === "PREFIX_INVALID" || data?.code === "PREFIX_LOCKED") {
        setPrefixError(data.error ?? "Erro no prefixo");
      } else {
        toast({ title: extractApiError(err), variant: "destructive" });
      }
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-2xl border-[#DCE3E8] shadow-sm dark:border-border">
          <CardHeader>
            <CardTitle className="text-base">Identificação do empreendimento</CardTitle>
            <CardDescription>Dados usados para identificar sua agência no CRM e nos registros da operação.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[150px_minmax(0,1fr)]">
              <div className="space-y-2">
                <Label>Logo</Label>
                <CoverImageUpload
                  value={form.logoUrl ?? ""}
                  onChange={(logoUrl) => setForm((current) => ({ ...current, logoUrl }))}
                  previewClassName="h-28 w-28 rounded-xl"
                  emptyLabel="Adicionar logo"
                  placeholder="https://..."
                />
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Nome comercial</Label>
                  <Input
                    value={form.name ?? ""}
                    onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                    placeholder="Nome da agência ou estabelecimento"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>CNPJ</Label>
                  <Input
                    value={form.cnpj ?? ""}
                    onChange={(e) => setForm((current) => ({ ...current, cnpj: e.target.value }))}
                    placeholder="00.000.000/0000-00"
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>E-mail cadastrado</Label>
                  <Input value={fullTenant?.email ?? ""} readOnly disabled />
                  <p className="text-xs text-muted-foreground">O e-mail de acesso não é alterado por esta configuração.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-[#DCE3E8] shadow-sm dark:border-border">
          <CardHeader>
            <CardTitle className="text-base">Contato e localização</CardTitle>
            <CardDescription>Informações para atendimento aos viajantes e identificação do estabelecimento.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>WhatsApp de atendimento</Label>
                <Input
                  value={form.whatsapp ?? ""}
                  onChange={(e) => setForm((current) => ({ ...current, whatsapp: e.target.value }))}
                  placeholder="+55 (11) 99999-9999"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Telefone</Label>
                <Input
                  value={form.phone ?? ""}
                  onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Site</Label>
              <Input
                value={form.website ?? ""}
                onChange={(e) => setForm((current) => ({ ...current, website: e.target.value }))}
                placeholder="https://suaagencia.com.br"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Endereço</Label>
              <Input
                value={form.address ?? ""}
                onChange={(e) => setForm((current) => ({ ...current, address: e.target.value }))}
                placeholder="Rua, número e complemento"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_0.7fr]">
              <div className="space-y-1.5">
                <Label>Cidade</Label>
                <Input value={form.city ?? ""} onChange={(e) => setForm((current) => ({ ...current, city: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Input value={form.state ?? ""} onChange={(e) => setForm((current) => ({ ...current, state: e.target.value.toUpperCase().slice(0, 2) }))} maxLength={2} placeholder="CE" />
              </div>
              <div className="space-y-1.5">
                <Label>CEP</Label>
                <Input value={form.zipCode ?? ""} onChange={(e) => setForm((current) => ({ ...current, zipCode: e.target.value }))} placeholder="00000-000" inputMode="numeric" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-[#DCE3E8] shadow-sm dark:border-border">
        <CardHeader>
          <CardTitle className="text-base">Identificação de reservas e clientes</CardTitle>
          <CardDescription>O prefixo aparece nos códigos operacionais gerados pelo CRM.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Prefixo de identificação</Label>
              {fullTenant?.prefixLocked && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Lock className="h-3 w-3" /> Fixado
                </Badge>
              )}
            </div>
            {fullTenant?.prefixLocked ? (
              <>
                <div className="flex w-36 items-center gap-2 rounded-md border bg-muted px-3 py-2 font-mono text-sm">
                  <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span>{fullTenant.reservationPrefix || "—"}</span>
                </div>
                <p className="text-xs text-muted-foreground">Configurado permanentemente — não pode ser alterado.</p>
              </>
            ) : (
              <>
                <Input
                  value={form.reservationPrefix ?? ""}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 5);
                    setForm((current) => ({ ...current, reservationPrefix: value }));
                    setPrefixError(null);
                  }}
                  placeholder="Ex.: CHQ, AGT"
                  className={`w-36 font-mono ${prefixError ? "border-destructive" : ""}`}
                  maxLength={5}
                />
                <p className="text-xs text-muted-foreground">De 1 a 5 letras. O prefixo fica fixo após o primeiro salvamento.</p>
                {prefixError && <p className="text-xs text-destructive">{prefixError}</p>}
              </>
            )}
            <div className="space-y-0.5 text-xs text-muted-foreground">
              {(() => {
                const now = new Date();
                const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
                const prefix = (fullTenant?.prefixLocked ? fullTenant.reservationPrefix : form.reservationPrefix) || "CLI";
                return (
                  <>
                    <p>Exemplo de reserva: <span className="font-mono font-semibold text-foreground">{prefix}-EXC-{yyyymm}-00001</span></p>
                    <p>Exemplo de cliente: <span className="font-mono font-semibold text-foreground">{prefix}-{yyyymm}-00043</span></p>
                  </>
                );
              })()}
            </div>
          </div>
          <div className="flex justify-end border-t pt-4">
            <Button onClick={handleSave} disabled={updateTenant.isPending}>
              {updateTenant.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando...</>
              ) : "Salvar configuração geral"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <SalesGoalSection />
    </div>
  );
}

/* ──────────────────── Plan & Billing Tab ──────────────────── */

interface PixModalProps {
  invoice: SubscriptionInvoice;
  onClose: () => void;
  onPayWithCard?: () => void;
}

function PixModal({ invoice, onClose, onPayWithCard }: PixModalProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  function copyCode() {
    if (invoice.pixCode) {
      navigator.clipboard.writeText(invoice.pixCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Código PIX copiado!" });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            Pagamento via PIX
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary">
              {formatCurrencyBRL(invoice.amount)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{invoice.description}</p>
          </div>

          {invoice.pixQrCodeUrl && (
            <div className="flex justify-center">
              <img
                src={invoice.pixQrCodeUrl}
                alt="QR Code PIX"
                className="w-48 h-48 rounded-lg border"
              />
            </div>
          )}

          {invoice.pixCode && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">
                Ou copie o código PIX abaixo
              </p>
              <div className="flex gap-2">
                <Input
                  value={invoice.pixCode}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="sm" onClick={copyCode}>
                  {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : "Copiar"}
                </Button>
              </div>
            </div>
          )}

          {invoice.pixExpiresAt && (
            <p className="text-xs text-center text-muted-foreground">
              Válido até: {new Date(invoice.pixExpiresAt).toLocaleString("pt-BR")}
            </p>
          )}

          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p>• Após o pagamento, seu plano será ativado em até 1 hora.</p>
            <p>• Em caso de dúvidas, entre em contato com nosso suporte.</p>
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          {onPayWithCard && (
            <Button variant="outline" onClick={onPayWithCard} className="gap-2">
              <CreditCard className="w-4 h-4" />
              Pagar com Cartão
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CardPaymentFormProps {
  onSuccess: () => void;
  onError: (msg: string) => void;
}

function CardPaymentForm({ onSuccess, onError }: CardPaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);

  async function handlePay() {
    if (!stripe || !elements) return;
    setLoading(true);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    setLoading(false);
    if (error) {
      onError(error.message ?? "Erro ao processar pagamento");
    } else {
      onSuccess();
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      <Button onClick={handlePay} disabled={loading || !stripe} className="w-full">
        {loading ? "Processando..." : "Confirmar Pagamento"}
      </Button>
    </div>
  );
}

export interface CardPaymentModalProps {
  invoice: SubscriptionInvoice;
  clientSecret: string;
  publishableKey: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function CardPaymentModal({ invoice, clientSecret, publishableKey, onClose, onSuccess }: CardPaymentModalProps) {
  const { toast } = useToast();
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey]
  );

  function handleSuccess() {
    toast({ title: "Pagamento confirmado!", description: "Seu plano será ativado em instantes." });
    onSuccess();
    onClose();
  }

  function handleError(msg: string) {
    toast({ title: msg, variant: "destructive" });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            Pagamento com Cartão
          </DialogTitle>
          <DialogDescription>
            Informe os dados do cartão para pagar esta fatura com segurança.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary">{formatCurrencyBRL(invoice.amount)}</p>
            <p className="text-sm text-muted-foreground mt-1">{invoice.description}</p>
          </div>
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <CardPaymentForm onSuccess={handleSuccess} onError={handleError} />
          </Elements>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FEATURE_LABELS: Record<string, string> = {
  referrals: "Programa de Indicação",
  coupons: "Cupons de Desconto",
  seatMap: "Mapa de Assentos",
};

function PlanTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: subData, isLoading } = useGetCurrentSubscription();
  const upgrade = useUpgradeSubscription();
  const stripeCheckout = useCreateStripeCheckout();
  const customerPortal = useCreateCustomerPortalSession();
  const [showPixModal, setShowPixModal] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [cardPaymentState, setCardPaymentState] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  const [pendingInvoice, setPendingInvoice] = useState<SubscriptionInvoice | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<"monthly" | "annual">("monthly");

  const currentPlan = subData?.plan;
  const plans = subData?.plans ?? [];
  const usage = subData?.usage;

  const pendingFromList = subData?.invoices?.find(inv => inv.status === INVOICE_STATUS.PENDING && inv.pixCode);

  async function handleUpgrade(plan: PlanPublic) {
    try {
      const result = await upgrade.mutateAsync({ planId: plan.id, billingCycle: selectedCycle });

      // Stripe Checkout Session — redirect immediately
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }

      await queryClient.invalidateQueries({ queryKey: getCurrentSubscriptionQueryKey() });

      if (result.upgraded && result.trial) {
        toast({
          title: `Trial do ${plan.name} ativado!`,
          description: result.trialEndsAt
            ? `Seu trial vai até ${new Date(result.trialEndsAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Uma cobrança será gerada ao final.`
            : "Seu trial foi ativado com sucesso.",
        });
      } else if (result.upgraded) {
        toast({ title: `Plano ${plan.name} ativado!`, description: "Seu plano foi alterado com sucesso." });
      } else if (result.invoice) {
        // PIX fallback (when Stripe is not configured)
        setPendingInvoice(result.invoice);
        setShowPixModal(true);
      }
    } catch {
      toast({ title: "Erro ao fazer upgrade", variant: "destructive" });
    }
  }

  async function handlePayWithCard(invoice: SubscriptionInvoice) {
    try {
      const result = await stripeCheckout.mutateAsync({ id: invoice.id });
      setPendingInvoice(invoice);
      setCardPaymentState({ clientSecret: result.clientSecret, publishableKey: result.publishableKey });
      setShowPixModal(false);
      setShowCardModal(true);
    } catch {
      toast({ title: "Erro ao iniciar pagamento com cartão", variant: "destructive" });
    }
  }

  async function handleCustomerPortal() {
    try {
      const result = await customerPortal.mutateAsync();
      window.location.href = result.portalUrl;
    } catch {
      toast({ title: "Erro ao acessar portal de cobrança", variant: "destructive" });
    }
  }

  if (isLoading) {
    return <div className="animate-pulse text-muted-foreground py-8 text-center">Carregando plano...</div>;
  }

  const usageItems = usage
    ? [
        { label: "Clientes", used: usage.clients, max: usage.maxClients },
        { label: "Viagens", used: usage.trips, max: usage.maxTrips },
        { label: "Usuários", used: usage.users, max: usage.maxUsers },
      ]
    : [];

  return (
    <div className="space-y-6">
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge>{currentPlan?.name ?? subData?.tenant?.planId ?? "Starter"}</Badge>
            Plano atual
          </CardTitle>
          <CardDescription>
            {currentPlan
              ? `Você está no plano ${currentPlan.name} — ${Number(currentPlan.monthlyPrice) === 0 ? "Grátis" : `${formatCurrencyBRL(currentPlan.monthlyPrice)}/mês`}`
              : "Carregando informações do plano..."}
          </CardDescription>
        </CardHeader>
        {usageItems.length > 0 && (
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {usageItems.map((item) => {
                const pct = Math.min((item.used / item.max) * 100, 100);
                const isNearLimit = pct >= 80;
                return (
                  <div key={item.label}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span>{item.label}</span>
                      <span className={`text-muted-foreground ${isNearLimit ? "text-amber-600 font-medium" : ""}`}>
                        {item.used}/{item.max}
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full">
                      <div
                        className={`h-2 rounded-full transition-all ${isNearLimit ? "bg-amber-500" : "bg-primary"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
        {currentPlan && Number(currentPlan.monthlyPrice) > 0 && (
          <CardFooter className="pt-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleCustomerPortal}
              disabled={customerPortal.isPending}
            >
              {customerPortal.isPending ? (
                <><Loader2 className="w-3 h-3 animate-spin" />Aguarde...</>
              ) : (
                <><CreditCard className="w-3 h-3" />Gerenciar Assinatura</>
              )}
            </Button>
          </CardFooter>
        )}
      </Card>

      {pendingFromList && !showPixModal && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="font-medium text-amber-800">Pagamento pendente</p>
              <p className="text-sm text-amber-700">{pendingFromList.description} — {formatCurrencyBRL(pendingFromList.amount)}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-800"
              onClick={() => { setPendingInvoice(pendingFromList); setShowPixModal(true); }}
            >
              Ver PIX
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3 justify-end">
        <span className="text-sm text-muted-foreground">Ciclo de faturamento:</span>
        <div className="flex border rounded-lg overflow-hidden">
          <button
            className={`px-3 py-1.5 text-sm ${selectedCycle === "monthly" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setSelectedCycle("monthly")}
          >
            Mensal
          </button>
          <button
            className={`px-3 py-1.5 text-sm ${selectedCycle === "annual" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setSelectedCycle("annual")}
          >
            Anual <span className="text-xs opacity-75">(-17%)</span>
          </button>
        </div>
      </div>

      {(() => {
        const visiblePlans = plans.length > 0 ? plans : [
          { id: "starter", name: "Starter", slug: "starter", monthlyPrice: "0", annualPrice: "0", maxUsers: 3, maxClients: 500, maxTrips: 20, features: [], supportedFeatures: [], isActive: true, isFeatured: false, sortOrder: 1, trialDays: 0, createdAt: "", updatedAt: "", description: null },
        ] as PlanPublic[];

        // Union of all advanced features across every visible plan, in a stable order.
        const allFeatureSlugs = [
          ...new Set(visiblePlans.flatMap((p) => p.supportedFeatures ?? [])),
        ].filter((slug) => slug in FEATURE_LABELS);

        // For each feature, find the cheapest plan (by monthlyPrice) that includes it.
        const sortedByPrice = [...visiblePlans].sort((a, b) => Number(a.monthlyPrice) - Number(b.monthlyPrice));
        const minPlanForFeature: Record<string, string> = {};
        for (const slug of allFeatureSlugs) {
          const minPlan = sortedByPrice.find((p) => (p.supportedFeatures ?? []).includes(slug));
          if (minPlan) minPlanForFeature[slug] = minPlan.name;
        }

        return (
          <TooltipProvider>
          <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${visiblePlans.length === 3 ? "lg:grid-cols-3" : ""}`}>
            {visiblePlans.map((plan) => {
              const isCurrentPlan = plan.slug === subData?.tenant?.planId || plan.id === subData?.tenant?.planId;
              const price = selectedCycle === "annual" ? Number(plan.annualPrice) : Number(plan.monthlyPrice);
              const monthlyEquiv = selectedCycle === "annual" && Number(plan.annualPrice) > 0
                ? (Number(plan.annualPrice) / 12).toFixed(0)
                : null;
              const planFeatures = new Set(plan.supportedFeatures ?? []);
              return (
                <Card
                  key={plan.id}
                  className={isCurrentPlan ? "border-primary ring-1 ring-primary" : ""}
                >
                  {plan.isFeatured && (
                    <div className="text-center py-1 bg-primary text-primary-foreground text-xs font-medium rounded-t-lg -mt-px mx-px">
                      Mais popular
                    </div>
                  )}
                  <CardHeader>
                    <CardTitle className="text-base">{plan.name}</CardTitle>
                    <CardDescription className="text-lg font-bold text-foreground">
                      {price === 0
                        ? "Grátis"
                        : selectedCycle === "annual"
                          ? <>{formatCurrencyBRL(plan.annualPrice)}/ano {monthlyEquiv && <span className="text-xs font-normal text-muted-foreground">(≈ R$ {monthlyEquiv}/mês)</span>}</>
                          : `${formatCurrencyBRL(plan.monthlyPrice)}/mês`
                      }
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm text-muted-foreground">
                    <p>Até {plan.maxClients.toLocaleString("pt-BR")} clientes</p>
                    <p>Até {plan.maxTrips.toLocaleString("pt-BR")} viagens</p>
                    <p>Até {plan.maxUsers} usuários</p>
                    {plan.trialDays > 0 && (
                      <p className="text-primary font-medium">{plan.trialDays} dias grátis</p>
                    )}
                    {allFeatureSlugs.length > 0 && (
                      <div className="pt-2 mt-2 border-t space-y-1">
                        {allFeatureSlugs.map((slug) => {
                          const included = planFeatures.has(slug);
                          const minPlanName = minPlanForFeature[slug];
                          return (
                            <div
                              key={slug}
                              className={`flex items-center gap-1.5 text-xs ${included ? "text-foreground" : "text-muted-foreground/50"}`}
                            >
                              {included ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Lock className="w-3.5 h-3.5 shrink-0 cursor-default" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {minPlanName
                                      ? `Disponível a partir do plano ${minPlanName}`
                                      : "Não disponível neste plano"}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              {FEATURE_LABELS[slug]}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                  {!isCurrentPlan && (
                    <div className="px-6 pb-4">
                      <Button
                        className="w-full"
                        variant={plan.isFeatured ? "default" : "outline"}
                        onClick={() => handleUpgrade(plan)}
                        disabled={upgrade.isPending}
                      >
                        {upgrade.isPending ? "Processando..." : price === 0 ? "Mudar para Starter" : "Fazer upgrade"}
                      </Button>
                    </div>
                  )}
                  {isCurrentPlan && (
                    <div className="px-6 pb-4">
                      <div className="flex items-center justify-center gap-1 text-sm text-primary font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Plano atual
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          </TooltipProvider>
        );
      })()}

      {subData?.invoices && subData.invoices.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Faturas Anteriores</h3>
          <div className="rounded-md border divide-y text-sm">
            {subData.invoices.map((inv) => {
              const statusLabels: Record<string, string> = {
                [INVOICE_STATUS.PENDING]: "Pendente",
                [INVOICE_STATUS.PENDING_PAYMENT]: "Aguardando Pgto.",
                [INVOICE_STATUS.PROCESSING]: "Processando PIX",
                [INVOICE_STATUS.PAID]: "Pago",
                [INVOICE_STATUS.FAILED]: "Falhou",
                [INVOICE_STATUS.OVERDUE]: "Vencido",
                [INVOICE_STATUS.CANCELLED]: "Cancelado",
                canceled: "Cancelado",
              };
              const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
                [INVOICE_STATUS.PAID]: "default",
                [INVOICE_STATUS.FAILED]: "destructive",
                [INVOICE_STATUS.OVERDUE]: "destructive",
                [INVOICE_STATUS.CANCELLED]: "outline",
                canceled: "outline",
              };
              return (
                <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs text-muted-foreground">{inv.invoiceNumber ?? inv.id.slice(0, 8)}</p>
                    <p className="font-medium">{formatCurrencyBRL(inv.amount)}</p>
                    {inv.dueDate && (
                      <p className="text-xs text-muted-foreground">
                        Vence: {new Date(inv.dueDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                      </p>
                    )}
                  </div>
                  <Badge variant={statusVariants[inv.status] ?? "secondary"} className="text-xs">
                    {statusLabels[inv.status] ?? inv.status}
                  </Badge>
                  {(inv.status === INVOICE_STATUS.PENDING || inv.status === INVOICE_STATUS.PENDING_PAYMENT) && (
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => { setPendingInvoice(inv); setShowPixModal(true); }}>
                      Pagar
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showPixModal && pendingInvoice && (
        <PixModal
          invoice={pendingInvoice}
          onClose={() => setShowPixModal(false)}
          onPayWithCard={() => handlePayWithCard(pendingInvoice)}
        />
      )}

      {showCardModal && pendingInvoice && cardPaymentState && (
        <CardPaymentModal
          invoice={pendingInvoice}
          clientSecret={cardPaymentState.clientSecret}
          publishableKey={cardPaymentState.publishableKey}
          onClose={() => { setShowCardModal(false); setCardPaymentState(null); }}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: getCurrentSubscriptionQueryKey() })}
        />
      )}
    </div>
  );
}

/* ──────────────────── Status Badge (shared) ─────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <Badge className="text-xs bg-green-50 text-green-700 border border-green-200">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Conectado
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge className="text-xs bg-red-50 text-red-700 border border-red-200">
        <AlertCircle className="w-3 h-3 mr-1" />
        Erro
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      Não conectado
    </Badge>
  );
}

/* ──────────────────── Generic Integration Card (secure API) ─────────────── */
interface IntegrationFieldDef {
  key: string;
  label: string;
  secret: boolean;
  optional?: boolean;
}

interface IntegrationData {
  type: string;
  integrationId: string | null;
  label: string;
  name: string;
  config: Record<string, string>;
  maskedSecrets: Record<string, string | null>;
  environment: "production" | "test";
  enabled: boolean;
  isDefault: boolean;
  status: string;
  lastError: string | null;
  lastSyncAt: string | null;
  fieldDefs: IntegrationFieldDef[];
}

interface IntegrationLog {
  id: string;
  event: string;
  level: string;
  message: string;
  actorName: string | null;
  createdAt: string;
}

interface WhatsAppConnectionSummary {
  id: string;
  name: string;
  instanceName: string;
  enabled: boolean;
  status: string;
  isDefault: boolean;
}

function WhatsAppIntegrationCards() {
  const { data: me } = useGetMe();
  const canManage = me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.SUPER_ADMIN;
  const [connections, setConnections] = useState<WhatsAppConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadConnections = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/integrations/whatsapp_evolution/connections`, {
        credentials: "include",
      });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      setConnections(await res.json() as WhatsAppConnectionSummary[]);
    } catch {
      setLoadError(true);
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void loadConnections();
    else setLoading(false);
  }, [canManage, loadConnections]);

  if (!canManage || forbidden) return null;

  return (
    <div className="space-y-3 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Números do WhatsApp</h3>
          <p className="text-xs text-muted-foreground">
            As respostas dos tickets usam o mesmo número que recebeu a conversa.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={adding}>
          Adicionar número
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando números...
        </div>
      ) : loadError ? (
        <div className="flex items-center justify-between rounded-md border p-3 text-sm">
          <span className="text-muted-foreground">Não foi possível carregar as conexões WhatsApp.</span>
          <Button size="sm" variant="outline" onClick={() => void loadConnections()}>Tentar novamente</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {connections.map((connection) => (
            <IntegrationCard
              key={connection.id}
              type="whatsapp_evolution"
              integrationId={connection.id}
              onSaved={() => void loadConnections()}
            />
          ))}
          {(adding || connections.length === 0) && (
            <IntegrationCard
              type="whatsapp_evolution"
              createNew
              onSaved={() => {
                setAdding(false);
                void loadConnections();
              }}
              onCancel={connections.length > 0 ? () => setAdding(false) : undefined}
            />
          )}
        </div>
      )}
    </div>
  );
}

function IntegrationCard({
  type,
  integrationId,
  createNew = false,
  onSaved,
  onCancel,
}: {
  type: string;
  integrationId?: string;
  createNew?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const canManage = me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.SUPER_ADMIN;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [data, setData] = useState<IntegrationData | null>(null);
  const [formConfig, setFormConfig] = useState<Record<string, string>>({});
  const [formSecrets, setFormSecrets] = useState<Record<string, string>>({});
  const [cardName, setCardName] = useState("");
  const [environment, setEnvironment] = useState<"production" | "test">("production");
  const [enabled, setEnabled] = useState(false);
  const [dirty, setDirty] = useState(false);
  useAgencySettingsDirty("integrations", `integration-${type}-${integrationId ?? "new"}`, dirty);
  const [logs, setLogs] = useState<IntegrationLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const query = integrationId ? `?integrationId=${encodeURIComponent(integrationId)}` : "";
      const res = await fetch(`${BASE}/api/integrations/${type}${query}`, { credentials: "include" });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      const d: IntegrationData = await res.json();
      if (createNew) {
        d.integrationId = null;
        d.name = "";
        d.config = {};
        d.maskedSecrets = Object.fromEntries(d.fieldDefs.filter((field) => field.secret).map((field) => [field.key, null]));
        d.enabled = false;
        d.isDefault = false;
        d.status = "disconnected";
      }
      setData(d);
      setFormConfig(d.config);
      setFormSecrets({});
      setCardName(d.name);
      setEnvironment(d.environment);
      setEnabled(d.enabled);
      setDirty(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [createNew, integrationId, type]);

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/integrations/${type}/logs`, { credentials: "include" });
      if (!res.ok) return;
      setLogs(await res.json());
    } catch {
      // ignore
    }
  }, [type]);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    void loadConfig();
    void loadLogs();
  }, [canManage, loadConfig, loadLogs]);

  if (!canManage || forbidden) return null;

  const status = data?.status ?? "disconnected";
  const fieldDefs = data?.fieldDefs ?? [];
  const configFields = fieldDefs.filter((f) => !f.secret);
  const secretFields = fieldDefs.filter((f) => f.secret);
  const hasAnySecret = secretFields.some((f) => !!data?.maskedSecrets[f.key]);

  async function performTest() {
    setTesting(true);
    try {
      const res = await fetch(`${BASE}/api/integrations/${type}/test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(integrationId ? { integrationId } : {}),
          config: formConfig,
          secrets: formSecrets,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.ok) {
        toast({ title: "Conexão estabelecida com sucesso" });
      } else {
        toast({ title: d.message || "Falha ao conectar", variant: "destructive" });
      }
      await loadLogs();
    } catch {
      toast({ title: "Falha ao testar conexão", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/integrations/${type}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cardName,
          config: formConfig,
          secrets: formSecrets,
          environment,
          enabled,
          ...(integrationId ? { integrationId } : {}),
          ...(createNew ? { createNew: true } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao salvar");
      }
      const result = await res.json().catch(() => ({})) as {
        integrationId?: string;
        webhook?: { ok?: boolean; message?: string };
      };
      if (type === "whatsapp_evolution" && enabled && result.webhook) {
        toast({
          title: result.webhook.ok
            ? "Integração salva e recebimento configurado"
            : "Integração salva, mas o recebimento está pendente",
          description: result.webhook.message,
          ...(!result.webhook.ok ? { variant: "destructive" as const } : {}),
        });
      } else {
        toast({ title: "Integração salva com sucesso" });
      }
      setFormSecrets({});
      setDirty(false);
      await loadConfig();
      await loadLogs();
      onSaved?.();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Erro ao salvar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault() {
    if (!integrationId) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/integrations/${type}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId, isDefault: true }),
      });
      if (!res.ok) throw new Error("Erro ao definir o número padrão");
      toast({ title: "Número padrão atualizado" });
      await loadConfig();
      onSaved?.();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Erro ao definir o número padrão",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke() {
    setRevoking(true);
    try {
      const res = await fetch(`${BASE}/api/integrations/${type}/revoke`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(integrationId ? { integrationId } : {}),
      });
      if (!res.ok) throw new Error("Erro ao revogar");
      toast({ title: "Credenciais revogadas com sucesso" });
      await loadConfig();
      await loadLogs();
      onSaved?.();
    } catch {
      toast({ title: "Erro ao revogar credenciais", variant: "destructive" });
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Wifi className="w-4 h-4 text-muted-foreground" />
            {data?.label ?? type}
            {type === "whatsapp_evolution" && data?.isDefault && (
              <Badge variant="secondary" className="text-[10px]">Padrão</Badge>
            )}
          </CardTitle>
          <StatusBadge status={status} />
        </div>
        {cardName && <CardDescription className="text-xs">{cardName}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
          </div>
        ) : loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
            <span>Não foi possível carregar a configuração atual. Nenhuma alteração foi salva.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadConfig()} disabled={loading}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Nome da integração (opcional)</Label>
              <Input
                value={cardName}
                onChange={(e) => {
                  setCardName(e.target.value);
                  setDirty(true);
                }}
                placeholder="Ex: WhatsApp Principal"
              />
            </div>

            {configFields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-xs">
                  {f.label}
                  {f.optional ? " (opcional)" : ""}
                </Label>
                <Input
                  value={formConfig[f.key] ?? ""}
                  onChange={(e) => {
                    setFormConfig((c) => ({ ...c, [f.key]: e.target.value }));
                    setDirty(true);
                  }}
                />
              </div>
            ))}

            {secretFields.map((f) => {
              const masked = data?.maskedSecrets[f.key];
              return (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-xs">
                    {f.label}
                    {f.optional ? " (opcional)" : ""}
                  </Label>
                  <Input
                    type="password"
                    value={formSecrets[f.key] ?? ""}
                    onChange={(e) => {
                      setFormSecrets((s) => ({ ...s, [f.key]: e.target.value }));
                      setDirty(true);
                    }}
                    placeholder={masked ?? "Insira o valor"}
                    autoComplete="off"
                  />
                  {masked && (
                    <p className="text-[11px] text-muted-foreground">
                      Um valor já está salvo. Deixe em branco para mantê-lo.
                    </p>
                  )}
                </div>
              );
            })}

            <div className="flex items-center justify-between rounded-md border p-2.5">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Ambiente</Label>
                <p className="text-[11px] text-muted-foreground">
                  {environment === "production" ? "Produção" : "Teste (sandbox)"}
                </p>
              </div>
              <Select
                value={environment}
                onValueChange={(v) => {
                  setEnvironment(v as "production" | "test");
                  setDirty(true);
                }}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Produção</SelectItem>
                  <SelectItem value="test">Teste</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-md border p-2.5">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Ativar integração</Label>
                <p className="text-[11px] text-muted-foreground">
                  Quando ativo, a integração é usada pelo sistema.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(v) => {
                  setEnabled(v);
                  setDirty(true);
                }}
              />
            </div>

            {status === "error" && data?.lastError && (
              <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded p-2 break-words">
                {data.lastError}
              </div>
            )}

            {data?.lastSyncAt && (
              <p className="text-[11px] text-muted-foreground">
                Última verificação: {new Date(data.lastSyncAt).toLocaleString("pt-BR")}
              </p>
            )}

            {dirty && (
              <p className="text-[11px] text-amber-600">
                Alterações não salvas. "Testar Conexão" usa os valores atuais; salve para aplicá-los.
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {type === "whatsapp_evolution" && integrationId && !data?.isDefault && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void makeDefault()}
                  disabled={saving || testing}
                >
                  Tornar padrão
                </Button>
              )}
              {createNew && onCancel && (
                <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
                  Cancelar
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void performTest()}
                disabled={testing || saving}
                className="gap-1.5"
              >
                {testing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wifi className="w-3.5 h-3.5" />
                )}
                Testar Conexão
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving || testing}
                className="gap-1.5"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Salvar
              </Button>
              {hasAnySecret && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoking}
                      className="gap-1.5 text-destructive hover:text-destructive ml-auto"
                    >
                      {revoking ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ShieldOff className="w-3.5 h-3.5" />
                      )}
                      Revogar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revogar credenciais?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Isso irá apagar permanentemente as credenciais armazenadas e desativar a
                        integração. Você precisará inserir as credenciais novamente para reconectar.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void handleRevoke()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Sim, revogar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowLogs((s) => !s);
                  if (!showLogs) void loadLogs();
                }}
                className={`gap-1.5 ${!hasAnySecret ? "ml-auto" : ""}`}
              >
                <History className="w-3.5 h-3.5" />
                {showLogs ? "Ocultar logs" : "Ver logs"}
              </Button>
            </div>

            {showLogs && (
              <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground p-3 text-center">
                    Nenhum registro ainda.
                  </p>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="p-2 text-[11px] flex items-start gap-2">
                      <span
                        className={`mt-0.5 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                          log.level === "error"
                            ? "bg-red-500"
                            : log.level === "warn"
                              ? "bg-amber-500"
                              : "bg-green-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-foreground break-words">{log.message}</p>
                        <p className="text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString("pt-BR")}
                          {log.actorName ? ` • ${log.actorName}` : ""}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface DistributionHealth {
  enabled: boolean;
  environment: string;
  status: string;
  lastError: string | null;
  lastSyncAt: string | null;
  operations: number;
  successful: number;
  failed: number;
  averageLatencyMs: number | null;
  lastOperationAt: string | null;
}

function DistributionHealthCard() {
  const { data: me } = useGetMe();
  const canManage = me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.SUPER_ADMIN;
  const [health, setHealth] = useState<DistributionHealth | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void fetch(`${BASE}/api/distribution/health`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: DistributionHealth | null) => {
        if (active) setHealth(data);
      })
      .catch(() => {
        if (active) setHealth(null);
      });
    return () => {
      active = false;
    };
  }, [canManage]);

  if (!canManage) return null;
  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Saúde da distribuição turística</CardTitle>
        <CardDescription>
          Monitoramento do adaptador de referência. Ele funciona somente em teste e não chama fornecedores reais.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!health ? (
          <p className="text-sm text-muted-foreground">Ative a integração de referência para consultar a saúde.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><p className="text-muted-foreground text-xs">Operações</p><p className="font-semibold">{health.operations}</p></div>
            <div><p className="text-muted-foreground text-xs">Sucesso</p><p className="font-semibold text-emerald-700">{health.successful}</p></div>
            <div><p className="text-muted-foreground text-xs">Falhas</p><p className="font-semibold text-red-700">{health.failed}</p></div>
            <div><p className="text-muted-foreground text-xs">Latência média</p><p className="font-semibold">{health.averageLatencyMs === null ? "—" : `${health.averageLatencyMs} ms`}</p></div>
          </div>
        )}
        {health?.lastError && <p className="mt-3 text-xs text-red-700">{health.lastError}</p>}
        {health?.lastOperationAt && <p className="mt-3 text-xs text-muted-foreground">Última operação: {new Date(health.lastOperationAt).toLocaleString("pt-BR")}</p>}
      </CardContent>
    </Card>
  );
}

/* ──────────────────── Integrations Tab ──────────────────────────────────── */

function IntegrationsTab() {
  return (
    <div className="space-y-4">
      <Card className="border-blue-200 bg-blue-50/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Controles de comunicação multicanal</CardTitle>
          <CardDescription>
            Campanhas usam E-mail e WhatsApp. O Direct do Instagram fica restrito às conversas iniciadas pelo cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <div><p className="font-medium">Consentimento</p><p className="text-muted-foreground">Opt-out por canal é respeitado antes do envio.</p></div>
          <div><p className="font-medium">Disponibilidade</p><p className="text-muted-foreground">Contato ausente aparece como “ignorado” no histórico, sem tentativa artificial.</p></div>
          <div><p className="font-medium">Integração responsável</p><p className="text-muted-foreground">E-mail usa Resend; WhatsApp e Instagram exigem uma conexão ativa. Nenhum segredo é exibido.</p></div>
        </CardContent>
      </Card>
      <GoogleCalendarCard />
      <AICard />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <WhatsAppIntegrationCards />
        <InstagramDirectIntegrationCard />
        <IntegrationCard type="mercadopago" />
        <IntegrationCard type="google_analytics" />
        <IntegrationCard type="distribution_reference" />
      </div>
      <DistributionHealthCard />
    </div>
  );
}

interface InstagramMessagingStatus {
  appConfigured: boolean;
  connected: boolean;
  status: string;
  accountUsername: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  oauthRedirectUri: string | null;
  webhookUrl: string | null;
  deauthorizationUrl: string | null;
  dataDeletionUrl: string | null;
  requiredPermissions: string[];
}

function InstagramDirectIntegrationCard() {
  const [status, setStatus] = useState<InstagramMessagingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const callbackNotice = (() => {
    const result = new URLSearchParams(window.location.search).get("instagram");
    if (result === "connected") return "Instagram Direct conectado. As próximas DMs recebidas aparecerão na caixa multicanal.";
    if (result === "already_connected") return "Esta conta já está conectada a outra agência.";
    if (result === "authorization_denied") return "A autorização do Instagram foi cancelada.";
    if (result === "invalid_state") return "A tentativa de conexão expirou. Inicie a conexão novamente.";
    if (result === "connect_error") return "A Meta não concluiu a conexão ou a ativação do webhook. Revise as permissões e tente novamente.";
    return null;
  })();

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch(`${BASE}/api/instagram-messaging/status`, { credentials: "include" });
      if (!response.ok) throw new Error("status");
      setStatus(await response.json() as InstagramMessagingStatus);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const disconnect = async () => {
    if (!window.confirm("Desconectar o Instagram Direct? O histórico de mensagens será mantido.")) return;
    setBusy(true);
    try {
      const response = await fetch(`${BASE}/api/instagram-messaging/disconnect`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("disconnect");
      await loadStatus();
    } catch {
      setLoadError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Instagram Direct</CardTitle>
            <CardDescription className="mt-1">
              Receba DMs e responda pelo painel da agência. A conexão é feita com a conta profissional de cada agência.
            </CardDescription>
          </div>
          <Badge variant={status?.connected ? "default" : "secondary"}>
            {loading ? "Verificando" : status?.connected ? "Conectado" : status?.appConfigured ? "Desconectado" : "Meta pendente"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            Não foi possível consultar a conexão do Instagram.
            <Button className="ml-2" variant="outline" size="sm" onClick={() => { void loadStatus(); }}>
              Tentar novamente
            </Button>
          </div>
        )}
        {callbackNotice && <p className="text-sm text-muted-foreground" role="status">{callbackNotice}</p>}
        {status?.connected && (
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <p className="font-medium">{status.accountUsername ? `@${status.accountUsername}` : "Conta profissional conectada"}</p>
            {status.tokenExpiresAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                Acesso válido até {new Date(status.tokenExpiresAt).toLocaleDateString("pt-BR")}; a renovação é automática.
              </p>
            )}
          </div>
        )}
        {!status?.appConfigured && (
          <div className="rounded-md border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-950">
            <p>O app Meta do VisiteCRM ainda precisa ser criado e configurado. A conexão permanecerá desativada até essa etapa.</p>
            <p className="mt-2">
              Configure as Secrets do workspace <code>INSTAGRAM_APP_ID</code>, <code>INSTAGRAM_APP_SECRET</code> e <code>INSTAGRAM_WEBHOOK_VERIFY_TOKEN</code>.
            </p>
          </div>
        )}
        {status?.lastError && <p className="text-sm text-destructive" role="alert">{status.lastError}</p>}
        {(status?.oauthRedirectUri || status?.webhookUrl || status?.deauthorizationUrl || status?.dataDeletionUrl) && (
          <div className="space-y-2 text-xs">
            {status.oauthRedirectUri && (
              <div>
                <p className="font-medium">URL de retorno OAuth</p>
                <code className="mt-1 block break-all rounded bg-muted p-2">{status.oauthRedirectUri}</code>
              </div>
            )}
            {status.webhookUrl && (
              <div>
                <p className="font-medium">URL do webhook</p>
                <code className="mt-1 block break-all rounded bg-muted p-2">{status.webhookUrl}</code>
              </div>
            )}
            {status.deauthorizationUrl && (
              <div>
                <p className="font-medium">URL de desautorização</p>
                <code className="mt-1 block break-all rounded bg-muted p-2">{status.deauthorizationUrl}</code>
              </div>
            )}
            {status.dataDeletionUrl && (
              <div>
                <p className="font-medium">URL para exclusão de dados</p>
                <code className="mt-1 block break-all rounded bg-muted p-2">{status.dataDeletionUrl}</code>
              </div>
            )}
            <p className="text-muted-foreground">
              Permissões necessárias: {status.requiredPermissions.join(", ")}. Ative o campo de webhook messages. Para conectar agências fora dos papéis do app, conclua a análise da Meta e solicite acesso avançado; publique como Live para produção.
            </p>
            <p className="text-muted-foreground">
              Uma solicitação de exclusão da Meta remove a conexão e as conversas/mensagens do Instagram, mas mantém os cadastros compartilhados de clientes e o histórico de outros canais.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {status?.connected ? (
            <Button type="button" variant="outline" onClick={() => { void disconnect(); }} disabled={busy}>
              {busy ? "Desconectando..." : "Desconectar"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => window.location.assign(`${BASE}/api/instagram-messaging/connect`)}
              disabled={loading || !status?.appConfigured || busy}
            >
              Conectar Instagram
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ──────────────────── Inteligência Artificial Card ──────────────────── */
interface AILog {
  id: string;
  event: string;
  level: string;
  message: string;
  actorName: string | null;
  createdAt: string;
}

const AI_PROVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
  { value: "custom", label: "Compatível (OpenAI API)" },
];

const AI_PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-sonnet-latest" },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
  },
  custom: { baseUrl: "", model: "" },
};

// Curated model lists per provider for the model selector.
// Custom providers use a free-text input instead.
const AI_PROVIDER_MODELS: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "o1", label: "o1" },
    { value: "o3", label: "o3" },
    { value: "o3-mini", label: "o3-mini" },
  ],
  anthropic: [
    { value: "claude-opus-4-5", label: "Claude Opus" },
    { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
    { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
  ],
  gemini: [
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
  ],
  custom: [],
};

function AICard() {
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const canManage = me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.SUPER_ADMIN;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [aiName, setAiName] = useState("");
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [environment, setEnvironment] = useState<"production" | "test">("production");
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("disconnected");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [maskedAccessToken, setMaskedAccessToken] = useState<string | null>(null);
  const [logs, setLogs] = useState<AILog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [dirty, setDirty] = useState(false);
  useAgencySettingsDirty("integrations", "ai-integration", dirty);
  const [loadError, setLoadError] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/ai-integration`, { credentials: "include" });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setAiName(data.name ?? "");
      setProvider(data.provider ?? "openai");
      setBaseUrl(data.baseUrl ?? "");
      setDefaultModel(data.defaultModel ?? "");
      setEnvironment(data.environment ?? "production");
      setEnabled(data.enabled ?? false);
      setStatus(data.status ?? "disconnected");
      setLastSyncAt(data.lastSyncAt ?? null);
      setLastError(data.lastError ?? null);
      setHasApiKey(data.hasApiKey ?? false);
      setMaskedApiKey(data.maskedApiKey ?? null);
      setHasAccessToken(data.hasAccessToken ?? false);
      setMaskedAccessToken(data.maskedAccessToken ?? null);
      setDirty(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/ai-integration/logs`, { credentials: "include" });
      if (!res.ok) return;
      setLogs(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    void loadConfig();
    void loadLogs();
  }, [canManage, loadConfig, loadLogs]);

  if (!canManage || forbidden) return null;

  const defaults = AI_PROVIDER_DEFAULTS[provider] ?? AI_PROVIDER_DEFAULTS.openai!;
  const modelOptions = AI_PROVIDER_MODELS[provider] ?? [];

  async function performTest() {
    setTesting(true);
    try {
      const body: Record<string, unknown> = { provider, baseUrl, defaultModel };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      if (accessToken.trim()) body.accessToken = accessToken.trim();
      const res = await fetch(`${BASE}/api/ai-integration/test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        toast({ title: "Conexão estabelecida com sucesso" });
      } else {
        toast({ title: data.message || "Falha ao conectar", variant: "destructive" });
      }
      await loadLogs();
    } catch {
      toast({ title: "Falha ao testar conexão", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: aiName,
        provider,
        baseUrl,
        defaultModel,
        environment,
        enabled,
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      if (accessToken.trim()) body.accessToken = accessToken.trim();
      const res = await fetch(`${BASE}/api/ai-integration`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao salvar");
      }
      toast({ title: "Configuração de IA salva com sucesso" });
      setApiKey("");
      setAccessToken("");
      setDirty(false);
      await loadConfig();
      await loadLogs();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Erro ao salvar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke() {
    setRevoking(true);
    try {
      const res = await fetch(`${BASE}/api/ai-integration/revoke`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erro ao revogar");
      toast({ title: "Credenciais de IA revogadas" });
      await loadConfig();
      await loadLogs();
    } catch {
      toast({ title: "Erro ao revogar credenciais", variant: "destructive" });
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            Inteligência Artificial
          </CardTitle>
          <StatusBadge status={status} />
        </div>
        <CardDescription className="text-xs">
          Configure seu próprio provedor de IA para o assistente de Insights. Sem configuração,
          usamos o provedor gerenciado da plataforma.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
          </div>
        ) : loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
            <span>Não foi possível carregar a configuração atual. Nenhuma alteração foi salva.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadConfig()} disabled={loading}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Nome da integração (opcional)</Label>
              <Input
                value={aiName}
                onChange={(e) => {
                  setAiName(e.target.value);
                  setDirty(true);
                }}
                placeholder="Ex: OpenAI Produção"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Provedor</Label>
              <Select
                value={provider}
                onValueChange={(v) => {
                  setProvider(v);
                  setDefaultModel("");
                  setDirty(true);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Chave de API</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setDirty(true);
                }}
                placeholder={hasApiKey ? maskedApiKey ?? "••••••••" : "Insira sua chave de API"}
                autoComplete="off"
              />
              {hasApiKey && (
                <p className="text-[11px] text-muted-foreground">
                  Uma chave já está salva. Deixe em branco para mantê-la.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Token de Acesso (opcional)</Label>
              <Input
                type="password"
                value={accessToken}
                onChange={(e) => {
                  setAccessToken(e.target.value);
                  setDirty(true);
                }}
                placeholder={hasAccessToken ? maskedAccessToken ?? "••••••••" : "Insira o token (se exigido)"}
                autoComplete="off"
              />
              {hasAccessToken && (
                <p className="text-[11px] text-muted-foreground">
                  Um token já está salvo. Deixe em branco para mantê-lo.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Base URL {provider === "custom" ? "" : "(opcional)"}</Label>
              <Input
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setDirty(true);
                }}
                placeholder={defaults.baseUrl || "https://..."}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Modelo padrão {provider === "custom" ? "" : "(opcional)"}</Label>
              {provider === "custom" || modelOptions.length === 0 ? (
                <Input
                  value={defaultModel}
                  onChange={(e) => {
                    setDefaultModel(e.target.value);
                    setDirty(true);
                  }}
                  placeholder={defaults.model || "ex: gpt-4o"}
                />
              ) : (
                <Select
                  value={defaultModel || modelOptions[0]?.value || ""}
                  onValueChange={(v) => {
                    setDefaultModel(v);
                    setDirty(true);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex items-center justify-between rounded-md border p-2.5">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Ambiente</Label>
                <p className="text-[11px] text-muted-foreground">
                  {environment === "production" ? "Produção" : "Teste (sandbox)"}
                </p>
              </div>
              <Select
                value={environment}
                onValueChange={(v) => {
                  setEnvironment(v as "production" | "test");
                  setDirty(true);
                }}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Produção</SelectItem>
                  <SelectItem value="test">Teste</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-md border p-2.5">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Usar minha configuração</Label>
                <p className="text-[11px] text-muted-foreground">
                  Quando ativo, o assistente usa este provedor.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(v) => {
                  setEnabled(v);
                  setDirty(true);
                }}
              />
            </div>

            {status === "error" && lastError && (
              <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded p-2 break-words">
                {lastError}
              </div>
            )}

            {lastSyncAt && (
              <p className="text-[11px] text-muted-foreground">
                Última verificação: {new Date(lastSyncAt).toLocaleString("pt-BR")}
              </p>
            )}

            {dirty && (
              <p className="text-[11px] text-amber-600">
                Alterações não salvas. "Testar Conexão" usa os valores atuais; salve para aplicá-los.
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void performTest()}
                disabled={testing || saving}
                className="gap-1.5"
              >
                {testing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wifi className="w-3.5 h-3.5" />
                )}
                Testar Conexão
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving || testing}
                className="gap-1.5"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Salvar
              </Button>
              {(hasApiKey || hasAccessToken) && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoking}
                      className="gap-1.5 text-destructive hover:text-destructive"
                    >
                      {revoking ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ShieldOff className="w-3.5 h-3.5" />
                      )}
                      Revogar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revogar credenciais de IA?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Isso irá apagar permanentemente a chave de API e o token de acesso
                        armazenados. O assistente voltará a usar o provedor gerenciado da
                        plataforma.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void handleRevoke()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Sim, revogar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowLogs((s) => !s);
                  if (!showLogs) void loadLogs();
                }}
                className="gap-1.5 ml-auto"
              >
                <History className="w-3.5 h-3.5" />
                {showLogs ? "Ocultar logs" : "Ver logs"}
              </Button>
            </div>

            {showLogs && (
              <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground p-3 text-center">
                    Nenhum registro ainda.
                  </p>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="p-2 text-[11px] flex items-start gap-2">
                      <span
                        className={`mt-0.5 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                          log.level === "error"
                            ? "bg-red-500"
                            : log.level === "warn"
                              ? "bg-amber-500"
                              : "bg-green-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-foreground break-words">{log.message}</p>
                        <p className="text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString("pt-BR")}
                          {log.actorName ? ` • ${log.actorName}` : ""}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────── Google Calendar Card ──────────────────── */
function GoogleCalendarCard() {
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);

  const canConnect = me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.SALES || me?.role === ROLES.SUPER_ADMIN;

  const { data: status } = useGetCalendarStatus({
    query: { enabled: canConnect, queryKey: getGetCalendarStatusQueryKey() },
  });

  const disconnectMutation = useDisconnectCalendar({
    mutation: {
      onSuccess: () => {
        toast({ title: "Google Calendar desconectado" });
        queryClient.invalidateQueries({ queryKey: getGetCalendarStatusQueryKey() });
      },
      onError: () => toast({ title: "Erro ao desconectar", variant: "destructive" }),
    },
  });

  const syncMutation = useSyncCalendar({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `${data.synced} evento(s) sincronizado(s) com sucesso` });
        queryClient.invalidateQueries({ queryKey: getGetCalendarStatusQueryKey() });
      },
      onError: () => toast({ title: "Erro ao sincronizar", variant: "destructive" }),
    },
  });

  useEffect(() => {
    if (!canConnect) return;
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get("gcal");
    if (gcal === "success") {
      toast({ title: "Google Calendar conectado com sucesso!" });
      queryClient.invalidateQueries({ queryKey: getGetCalendarStatusQueryKey() });
      const url = new URL(window.location.href);
      url.searchParams.delete("gcal");
      window.history.replaceState({}, "", url.toString());
    } else if (gcal === "denied") {
      toast({ title: "Autorização negada pelo Google", variant: "destructive" });
      const url = new URL(window.location.href);
      url.searchParams.delete("gcal");
      window.history.replaceState({}, "", url.toString());
    } else if (gcal === "error") {
      toast({ title: "Erro ao conectar com Google Calendar", variant: "destructive" });
      const url = new URL(window.location.href);
      url.searchParams.delete("gcal");
      window.history.replaceState({}, "", url.toString());
    }
  }, [canConnect]);

  async function handleConnect() {
    setConnecting(true);
    try {
      const data = await getCalendarConnectUrl();
      if (data.url) window.location.href = data.url;
      else toast({ title: "Erro ao iniciar autenticação", variant: "destructive" });
    } catch {
      toast({ title: "Erro ao conectar", variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  }

  if (!canConnect) return null;

  const connected = status?.connected ?? false;
  const calendarStatus = status?.status as string | undefined;
  const isInvalid = calendarStatus === "invalid";
  const loading = disconnectMutation.isPending || connecting;
  const syncing = syncMutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-500" />
            Google Calendar
          </CardTitle>
          {isInvalid ? (
            <Badge className="text-xs bg-amber-50 text-amber-700 border border-amber-200">
              <AlertCircle className="w-3 h-3 mr-1" />
              Token expirado
            </Badge>
          ) : connected ? (
            <Badge className="text-xs bg-green-50 text-green-700 border border-green-200">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Conectado
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              Não conectado
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          Sincronize viagens, pagamentos e aniversários de clientes com sua agenda Google.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isInvalid && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p className="font-medium">Conexão expirada</p>
              <p className="mt-0.5 text-amber-700">
                Sua autorização com o Google Calendar expirou. Reconecte para retomar a sincronização automática.
              </p>
            </div>
          </div>
        )}
        {connected && !isInvalid && (
          <div className="text-xs text-muted-foreground space-y-1 bg-muted/40 rounded p-2">
            <p>
              <span className="font-medium">Eventos sincronizados:</span> {status?.eventsCount ?? 0}
            </p>
            {status?.lastSync && (
              <p>
                <span className="font-medium">Última sincronização:</span>{" "}
                {new Date(status.lastSync).toLocaleString("pt-BR")}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!connected || isInvalid ? (
            <Button size="sm" onClick={handleConnect} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              {isInvalid ? "Reconectar Google" : "Conectar com Google"}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => syncMutation.mutate({ data: { type: "all" } })}
                disabled={syncing}
                className="gap-1.5"
              >
                {syncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Sincronizar Agora
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    className="gap-1.5 text-destructive hover:text-destructive"
                  >
                    {loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Unlink className="w-3.5 h-3.5" />
                    )}
                    Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar Google Calendar?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Isso irá revogar o acesso ao seu Google Calendar e remover todos os eventos
                      sincronizados do sistema. Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => disconnectMutation.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Sim, desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ──────────────────── NPS Categories Section ──────────────────── */
function NpsCategoriesSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const tenantId = me?.tenantId ?? null;
  const { data: fullTenant } = useGetTenant(tenantId ?? "", {
    query: { queryKey: getGetTenantQueryKey(tenantId ?? ""), enabled: !!tenantId },
  });
  const updateTenant = useUpdateTenant();

  const currentSettings = (fullTenant?.settings as Record<string, unknown> | null | undefined) ?? {};
  const currentCategories = (currentSettings.npsCategories as { transport?: boolean; service?: boolean; organization?: boolean; guide?: boolean } | null | undefined) ?? null;

  const [transport, setTransport] = useState(currentCategories?.transport !== false);
  const [service, setService] = useState(currentCategories?.service !== false);
  const [organization, setOrganization] = useState(currentCategories?.organization !== false);
  const [guide, setGuide] = useState(currentCategories?.guide !== false);

  useEffect(() => {
    setTransport(currentCategories?.transport !== false);
    setService(currentCategories?.service !== false);
    setOrganization(currentCategories?.organization !== false);
    setGuide(currentCategories?.guide !== false);
  }, [fullTenant?.id]);

  async function handleSave() {
    if (!tenantId) return;
    try {
      await updateTenant.mutateAsync({
        id: tenantId,
        data: { npsCategories: { transport, service, organization, guide } },
      });
      await queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
      toast({ title: "Categorias NPS salvas com sucesso" });
    } catch {
      toast({ title: "Erro ao salvar categorias NPS", variant: "destructive" });
    }
  }

  const CATEGORIES = [
    { key: "transport" as const, label: "🚌 Transporte/Ônibus", value: transport, onChange: setTransport },
    { key: "service" as const, label: "👥 Atendimento da equipe", value: service, onChange: setService },
    { key: "organization" as const, label: "📋 Organização da viagem", value: organization, onChange: setOrganization },
    { key: "guide" as const, label: "🎤 Guia/Monitoria", value: guide, onChange: setGuide },
  ];

  return (
    <div className="rounded-md border p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Categorias do formulário NPS</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Escolha quais categorias de satisfação aparecem no formulário enviado ao cliente.
          Agências sem guia, por exemplo, podem desativar a categoria Guia/Monitoria.
        </p>
      </div>
      <div className="divide-y rounded-md border">
        {CATEGORIES.map((cat) => (
          <div key={cat.key} className="flex items-center justify-between px-4 py-3">
            <Label className="cursor-pointer text-sm">{cat.label}</Label>
            <Switch checked={cat.value} onCheckedChange={cat.onChange} />
          </div>
        ))}
      </div>
      <Button size="sm" onClick={handleSave} disabled={updateTenant.isPending}>
        {updateTenant.isPending ? (
          <>
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            Salvando...
          </>
        ) : (
          <>
            <Save className="w-3.5 h-3.5 mr-1.5" />
            Salvar categorias
          </>
        )}
      </Button>
    </div>
  );
}

/* ──────────────────── Notifications Tab ──────────────────── */
function NotificationsTab() {
  const { toast } = useToast();
  const { data: configs = [], refetch } = useListSystemConfigs();
  const upsert = useUpsertSystemConfig();

  const notifConfig = (configs.find((c) => c.key === "notifications")?.value ?? {}) as Record<
    string,
    boolean
  >;

  const NOTIFICATIONS = [
    { key: "newReservation", label: "Nova reserva criada" },
    { key: "paymentReceived", label: "Pagamento recebido" },
    { key: "checkinDone", label: "Check-in realizado" },
    { key: "npsResponse", label: "Nova resposta NPS" },
    { key: "campaignSent", label: "Campanha enviada" },
    { key: "referralConverted", label: "Indicação convertida" },
    { key: "tripReminder", label: "Lembrete de viagem (7 dias)" },
    { key: "birthdayAlert", label: "Alerta de aniversário" },
    { key: "overduePayment", label: "Pagamentos vencidos" },
    { key: "unpaidReservation", label: "Reservas confirmadas sem pagamento" },
    { key: "lowOccupancy", label: "Viagens com baixa ocupação (<50%)" },
  ];

  async function handleToggle(key: string, value: boolean) {
    try {
      await upsert.mutateAsync({
        data: { key: "notifications", value: { ...notifConfig, [key]: value } },
      });
      refetch();
    } catch {
      toast({ title: "Erro ao salvar preferência", variant: "destructive" });
    }
  }

  const npsAutoSend = (configs.find((c) => c.key === "npsAutoSend")?.value ?? false) as boolean;
  const npsHoursAfterReturn = (configs.find((c) => c.key === "npsHoursAfterReturn")?.value ?? 24) as number;
  const [npsHoursInput, setNpsHoursInput] = useState<number>(npsHoursAfterReturn);
  useAgencySettingsDirty("notifications", "nps-hours", npsHoursInput !== npsHoursAfterReturn);

  useEffect(() => {
    setNpsHoursInput(npsHoursAfterReturn);
  }, [npsHoursAfterReturn]);

  async function handleNpsAutoSendToggle(value: boolean) {
    try {
      await upsert.mutateAsync({ data: { key: "npsAutoSend", value } });
      refetch();
    } catch {
      toast({ title: "Erro ao salvar configuração", variant: "destructive" });
    }
  }

  async function handleNpsHoursSave() {
    try {
      await upsert.mutateAsync({ data: { key: "npsHoursAfterReturn", value: npsHoursInput } });
      refetch();
      toast({ title: "Configuração salva!" });
    } catch {
      toast({ title: "Erro ao salvar configuração", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Escolha quais eventos geram notificações no sistema.
        </p>
        <div className="rounded-md border divide-y">
          {NOTIFICATIONS.map((n) => (
            <div key={n.key} className="flex items-center justify-between px-4 py-3">
              <Label className="cursor-pointer">{n.label}</Label>
              <Switch
                checked={notifConfig[n.key] ?? true}
                onCheckedChange={(v) => handleToggle(n.key, v)}
                disabled={upsert.isPending}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Pesquisa NPS automática</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Envie automaticamente uma pesquisa de satisfação para os passageiros após o retorno da viagem.
          </p>
        </div>
        <div className="flex items-center justify-between">
          <Label className="cursor-pointer text-sm">Ativar envio automático de NPS</Label>
          <Switch
            checked={npsAutoSend}
            onCheckedChange={handleNpsAutoSendToggle}
            disabled={upsert.isPending}
          />
        </div>
        {npsAutoSend && (
          <div className="flex items-center gap-3">
            <Label className="text-sm whitespace-nowrap">Horas após o retorno</Label>
            <Input
              type="number"
              min={1}
              max={720}
              step={1}
              value={npsHoursInput}
              onChange={(e) => setNpsHoursInput(e.target.value === "" ? 0 : Number(e.target.value))}
              className="w-24"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleNpsHoursSave}
              disabled={upsert.isPending || !Number.isInteger(npsHoursInput) || npsHoursInput < 1 || npsHoursInput > 720}
            >
              Salvar
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          O link da pesquisa é enviado por e-mail. As respostas aparecem no painel{" "}
          <strong>NPS</strong>.
        </p>
      </div>

      <NpsCategoriesSection />

      <WhatsAppNotificationsSection />
    </div>
  );
}

/* ──────────────────── WhatsApp Notifications Section ──────────────────── */
const WA_DEFAULT_MSGS = {
  reservationConfirmed:
    "✅ Olá, {nome}! Sua reserva na viagem *{viagem}* foi confirmada. Partida em *{data}*. Referência: *{referencia}*. Qualquer dúvida, fale com {agencia}.",
  paymentReceived:
    "✅ Pagamento recebido! Olá, {nome}. Confirmamos *R$ {valor}*. Saldo restante: *R$ {saldo_restante}*. Obrigado! {agencia}",
  boardingReminder:
    "🚌 Olá, {nome}! Lembrete: sua viagem para *{viagem}* está marcada para *{data}*. Local de embarque: *{local_saida}* — {horario}. Boa viagem! {agencia}",
  cadastroRealizado:
    "👋 Olá, {nome}! Seu cadastro na viagem *{viagem}* foi realizado com sucesso. Referência: *{referencia}*. Em breve entraremos em contato. {agencia}",
  pagamentoPendente:
    "💰 Olá, {nome}! Sua viagem *{viagem}* parte em breve (*{data}*) e ainda há um saldo pendente de *R$ {saldo_restante}*. Regularize para garantir sua vaga. {agencia}",
};

interface WaSettings {
  reservationConfirmed: boolean;
  reservationConfirmedMessage?: string | null;
  paymentReceived: boolean;
  paymentReceivedMessage?: string | null;
  boardingReminder: boolean;
  boardingReminderMessage?: string | null;
  boardingReminderDaysBeforeTrip?: number[];
  cadastroRealizado: boolean;
  cadastroRealizadoMessage?: string | null;
  pagamentoPendente: boolean;
  pagamentoPendenteMessage?: string | null;
  pagamentoPendenteDaysBeforeTrip?: number;
}

function WhatsAppNotificationsSection() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<WaSettings>({
    reservationConfirmed: true,
    paymentReceived: true,
    boardingReminder: true,
    cadastroRealizado: false,
    pagamentoPendente: false,
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useAgencySettingsDirty("notifications", "whatsapp-notifications", dirty);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState(false);

  const BASE = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE_URL ?? "";

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    setSettingsLoadError(false);
    try {
      const response = await fetch(`${BASE}/api/whatsapp-notifications/settings`, { credentials: "include" });
      if (!response.ok) throw new Error("load_failed");
      setSettings(await response.json());
    } catch {
      setSettingsLoadError(true);
    } finally {
      setLoadingSettings(false);
    }
  }, [BASE]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function update(patch: Partial<WaSettings>) {
    setSettings((s) => ({ ...s, ...patch }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/whatsapp-notifications/settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!r.ok) throw new Error("Erro ao salvar");
      const saved = await r.json();
      setSettings(saved);
      setDirty(false);
      toast({ title: "Configurações salvas!" });
    } catch {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const TYPES = [
    {
      key: "cadastroRealizado" as const,
      msgKey: "cadastroRealizadoMessage" as const,
      label: "Cadastro realizado",
      hint: "Disparada quando uma nova reserva é criada (status pendente). Variáveis: {nome}, {viagem}, {referencia}, {agencia}",
      defaultMsg: WA_DEFAULT_MSGS.cadastroRealizado,
    },
    {
      key: "reservationConfirmed" as const,
      msgKey: "reservationConfirmedMessage" as const,
      label: "Reserva confirmada",
      hint: "Disparada quando uma reserva é confirmada. Variáveis: {nome}, {viagem}, {data}, {referencia}, {agencia}",
      defaultMsg: WA_DEFAULT_MSGS.reservationConfirmed,
    },
    {
      key: "paymentReceived" as const,
      msgKey: "paymentReceivedMessage" as const,
      label: "Pagamento recebido",
      hint: "Disparada quando um pagamento é recebido. Variáveis: {nome}, {valor}, {saldo_restante}, {agencia}",
      defaultMsg: WA_DEFAULT_MSGS.paymentReceived,
    },
    {
      key: "pagamentoPendente" as const,
      msgKey: "pagamentoPendenteMessage" as const,
      label: "Saldo pendente antes da viagem",
      hint: "Lembrete enviado N dias antes da viagem quando há saldo em aberto. Variáveis: {nome}, {viagem}, {data}, {saldo_restante}, {agencia}",
      defaultMsg: WA_DEFAULT_MSGS.pagamentoPendente,
    },
    {
      key: "boardingReminder" as const,
      msgKey: "boardingReminderMessage" as const,
      label: "Lembrete de embarque",
      hint: "Enviada N dias antes do embarque. Variáveis: {nome}, {viagem}, {data}, {local_saida}, {horario}, {agencia}",
      defaultMsg: WA_DEFAULT_MSGS.boardingReminder,
    },
  ] as const;

  return (
    <div className="rounded-md border p-4 space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Notificações automáticas por WhatsApp</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Mensagens enviadas automaticamente para os clientes via WhatsApp quando eventos importantes acontecem.
          Requer WhatsApp configurado em <strong>Integrações</strong>.
        </p>
      </div>

      {settingsLoadError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
          <span>Não foi possível carregar as preferências atuais. Tente novamente antes de editar.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadSettings()} disabled={loadingSettings}>
            {loadingSettings && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Tentar novamente
          </Button>
        </div>
      )}

      {loadingSettings && (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando preferências de WhatsApp...
        </div>
      )}

      {TYPES.map((t) => (
        <div key={t.key} className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
          <div className="flex items-center justify-between">
            <Label className="cursor-pointer text-sm font-medium">{t.label}</Label>
            <Switch
              checked={settings[t.key] ?? false}
              onCheckedChange={(v) => update({ [t.key]: v })}
              disabled={loadingSettings || settingsLoadError || saving}
            />
          </div>
          {settings[t.key] && (
            <div className="space-y-2">
              {/* Extra numeric config per type */}
              {t.key === "pagamentoPendente" && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground shrink-0">Dias antes da viagem (1–30):</Label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    className="w-20 border rounded px-2 py-1 text-sm"
                    value={settings.pagamentoPendenteDaysBeforeTrip ?? 7}
                    onChange={(e) => update({ pagamentoPendenteDaysBeforeTrip: Math.min(30, Math.max(1, parseInt(e.target.value) || 7)) })}
                  />
                </div>
              )}
              {t.key === "boardingReminder" && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground shrink-0">Dias antes do embarque (1–14, ex: 1, 3, 7):</Label>
                    <input
                      type="text"
                      className="flex-1 border rounded px-2 py-1 text-sm"
                      placeholder="1"
                      value={(settings.boardingReminderDaysBeforeTrip ?? [1]).join(", ")}
                      onChange={(e) => {
                        const days = e.target.value
                          .split(",")
                          .map((v) => parseInt(v.trim()))
                          .filter((n) => !isNaN(n) && n >= 1 && n <= 14);
                        update({ boardingReminderDaysBeforeTrip: days.length > 0 ? days : [1] });
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Máximo 14 dias de antecedência.</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t.hint}</p>
              <Textarea
                rows={3}
                placeholder={t.defaultMsg}
                value={settings[t.msgKey] ?? ""}
                onChange={(e) => update({ [t.msgKey]: e.target.value || null })}
                className="text-sm resize-none font-mono"
                disabled={loadingSettings || settingsLoadError || saving}
              />
              <div className="space-y-1.5" aria-label={`Pré-visualização de ${t.label}`}>
                <p className="text-xs font-medium text-muted-foreground">Pré-visualização</p>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm leading-relaxed text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-50">
                  {renderWhatsAppPreview(
                    interpolateWhatsAppPreview(settings[t.msgKey] || t.defaultMsg),
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Exemplo com dados de um passageiro. A mensagem acima é atualizada enquanto você digita.
                </p>
              </div>
              {settings[t.msgKey] && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => update({ [t.msgKey]: null })}
                  disabled={loadingSettings || settingsLoadError || saving}
                >
                  Usar mensagem padrão
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      <Button size="sm" onClick={handleSave} disabled={saving || !dirty || loadingSettings || settingsLoadError} className="w-full">
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
        Salvar configurações de WhatsApp
      </Button>
    </div>
  );
}

/* ──────────────────── Customization Tab ──────────────────── */
function CustomizationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me, refetch: refetchMe } = useGetMe();
  const tenantId = me?.tenantId ?? null;
  const { data: fullTenant } = useGetTenant(tenantId ?? "", {
    query: {
      queryKey: getGetTenantQueryKey(tenantId ?? ""),
      enabled: !!tenantId,
    },
  });
  const updateTenant = useUpdateTenant();

  const [primaryColor, setPrimaryColor] = useState(me?.tenant?.primaryColor ?? "#3B82F6");
  const [secondaryColor, setSecondaryColor] = useState(me?.tenant?.secondaryColor ?? "#8B5CF6");
  const [logoUrl, setLogoUrl] = useState(me?.tenant?.logoUrl ?? "");
  const [savedBranding, setSavedBranding] = useState({
    primaryColor: me?.tenant?.primaryColor ?? "#3B82F6",
    secondaryColor: me?.tenant?.secondaryColor ?? "#8B5CF6",
    logoUrl: me?.tenant?.logoUrl ?? "",
  });
  const [uploadingCount, setUploadingCount] = useState(0);
  const handleUploadingChange = useCallback((uploading: boolean) => {
    setUploadingCount((n) => Math.max(0, n + (uploading ? 1 : -1)));
  }, []);

  const customizationDirty = primaryColor !== savedBranding.primaryColor
    || secondaryColor !== savedBranding.secondaryColor
    || logoUrl !== savedBranding.logoUrl;
  useAgencySettingsDirty("customization", "customization", customizationDirty);

  useEffect(() => {
    if (fullTenant) {
      setPrimaryColor(fullTenant.primaryColor ?? "#3B82F6");
      setSecondaryColor(fullTenant.secondaryColor ?? "#8B5CF6");
      setLogoUrl(fullTenant.logoUrl ?? "");
      setSavedBranding({
        primaryColor: fullTenant.primaryColor ?? "#3B82F6",
        secondaryColor: fullTenant.secondaryColor ?? "#8B5CF6",
        logoUrl: fullTenant.logoUrl ?? "",
      });
    }
  }, [fullTenant?.id]);

  async function handleSave() {
    if (!tenantId) {
      toast({ title: "Não foi possível identificar a agência", variant: "destructive" });
      return;
    }
    try {
      await updateTenant.mutateAsync({ id: tenantId, data: { primaryColor, secondaryColor, logoUrl } });
      setSavedBranding({ primaryColor, secondaryColor, logoUrl });
      toast({ title: "Personalização salva com sucesso" });
      await queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
      refetchMe();
    } catch {
      toast({ title: "Erro ao salvar personalização", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-4">
        <h3 className="font-semibold text-sm">Cores do painel</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Cor primária</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border border-border"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="font-mono uppercase"
                maxLength={7}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Cor secundária</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border border-border"
              />
              <Input
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="font-mono uppercase"
                maxLength={7}
              />
            </div>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <div className="w-16 h-8 rounded-md" style={{ backgroundColor: primaryColor }} />
          <div className="w-16 h-8 rounded-md" style={{ backgroundColor: secondaryColor }} />
          <div className="w-16 h-8 rounded-md bg-gradient-to-r" style={{ backgroundImage: `linear-gradient(to right, ${primaryColor}, ${secondaryColor})` }} />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Logotipo da Agência</h3>
        <p className="text-xs text-muted-foreground">
          Exibido no painel administrativo do sistema.
        </p>
        <CoverImageUpload
          fileSizeMB="2"
          value={logoUrl}
          onChange={setLogoUrl}
          onUploadingChange={handleUploadingChange}
          emptyLabel="Clique ou arraste o logo aqui"
          previewClassName="h-32"
          objectFit="contain"
        />
        <p className="text-xs text-muted-foreground">
          Recomendado: PNG com fundo transparente, tamanho mínimo 200x60px
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Favicon</h3>
        <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/20">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
            V
          </div>
          <p className="text-sm text-muted-foreground">
            Favicon gerado automaticamente a partir das iniciais do nome da agência
          </p>
        </div>
      </div>

      <Button onClick={handleSave} disabled={updateTenant.isPending || uploadingCount > 0}>
        {uploadingCount > 0 ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Aguardando upload...</>
        ) : updateTenant.isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</>
        ) : "Salvar personalização"}
      </Button>

      <div className="rounded-xl border border-dashed p-4">
        <h3 className="font-semibold text-sm">Configurações da Vitrine</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Cores, logo e banners públicos ficam juntos em Aparência; a entrega do QR Code PIX fica em Pagamentos.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <a className="font-medium text-primary underline-offset-4 hover:underline" href="/loja/configuracoes?tab=aparencia">
            Abrir aparência da Vitrine
          </a>
          <a className="font-medium text-primary underline-offset-4 hover:underline" href="/loja/configuracoes?tab=pagamento">
            Abrir pagamentos da Loja
          </a>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────── Team Tab ──────────────────── */
const roleLabels: Record<string, string> = {
  agencia: "Gestor",
  gerente: "Gerente",
  vendedor: "Vendedor",
  suporte: "Suporte",
  superadmin: "Super Admin",
  cliente: "Cliente",
};

const roleColors: Record<string, string> = {
  agencia: "bg-blue-100 text-blue-800",
  gerente: "bg-teal-100 text-teal-800",
  vendedor: "bg-green-100 text-green-800",
  suporte: "bg-orange-100 text-orange-800",
  superadmin: "bg-purple-100 text-purple-800",
  cliente: "bg-gray-100 text-gray-800",
};

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  avatarUrl?: string | null;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  accepted: boolean;
  expiresAt: string | null;
  createdAt: string;
}

function TeamTab() {
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  useAgencySettingsDirty("team", "team-invite", inviteOpen && Boolean(inviteEmail.trim()));
  const inviteRole = "vendedor" as const;
  const [inviting, setInviting] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function loadTeam() {
    setLoading(true);
    setLoadError(false);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch(`${BASE}/api/team/members`, { credentials: "include" }),
        fetch(`${BASE}/api/team/invites`, { credentials: "include" }),
      ]);
      if (!membersRes.ok || !invitesRes.ok) throw new Error("team_load_failed");
      const [allMembers, allInvites] = await Promise.all([
        membersRes.json() as Promise<TeamMember[]>,
        invitesRes.json() as Promise<PendingInvite[]>,
      ]);
      setMembers(allMembers.filter((m) => m.role === "vendedor"));
      setInvites(allInvites.filter((i) => !i.accepted && i.role === "vendedor"));
    } catch {
      setLoadError(true);
      toast({ title: "Erro ao carregar equipe", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTeam();
  }, []);

  async function handleInvite() {
    if (!inviteEmail.trim()) {
      toast({ title: "Informe o e-mail do convidado", variant: "destructive" });
      return;
    }
    setInviting(true);
    try {
      const res = await fetch(`${BASE}/api/team/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "limit_exceeded") {
          setLimitError(data.message ?? "Limite de usuários atingido. Faça upgrade para adicionar mais membros.");
          setInviteOpen(false);
        } else {
          toast({ title: data.error ?? "Erro ao convidar", variant: "destructive" });
        }
        return;
      }
      toast({
        title: "Convite registrado!",
        description: `${inviteEmail} receberá acesso ao criar uma conta com este e-mail.`,
      });
      setInviteOpen(false);
      setInviteEmail("");
      loadTeam();
    } catch {
      toast({ title: "Erro de conexão", variant: "destructive" });
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      const response = await fetch(`${BASE}/api/team/members/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("remove_failed");
      toast({ title: "Membro desativado" });
      await loadTeam();
    } catch {
      toast({ title: "Erro ao remover membro", variant: "destructive" });
    }
  }

  async function handleCancelInvite(id: string) {
    try {
      const response = await fetch(`${BASE}/api/team/invites/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("cancel_failed");
      toast({ title: "Convite cancelado" });
      await loadTeam();
    } catch {
      toast({ title: "Erro ao cancelar convite", variant: "destructive" });
    }
  }

  const isManager = me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.SUPER_ADMIN;

  return (
    <div className="space-y-4">
      {limitError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <span className="text-amber-600 mt-0.5">⚠️</span>
          <div className="flex-1">
            <p className="font-medium text-amber-900 text-sm">Limite de usuários atingido</p>
            <p className="text-amber-700 text-sm mt-0.5">{limitError}</p>
            <Button size="sm" variant="outline" className="mt-2 border-amber-400 text-amber-800 hover:bg-amber-100" onClick={() => window.location.href = "/configuracoes?tab=plan"}>
              Ver planos
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Gerencie os membros da sua equipe e convide vendedores.
          </p>
        </div>
        {isManager && (
          <Button onClick={() => { setLimitError(null); setInviteOpen(true); }}>
            <UserPlus className="w-4 h-4 mr-2" />
            Convidar Membro
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Carregando equipe...
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center" role="alert">
          <p className="text-sm text-muted-foreground">Não foi possível carregar os membros e convites. A lista pode estar desatualizada.</p>
          <Button variant="outline" size="sm" onClick={() => void loadTeam()}>Tentar novamente</Button>
        </div>
      ) : (
        <>
          {members.length === 0 && invites.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhum membro na equipe ainda.</p>
              {isManager && (
                <Button variant="outline" className="mt-3" onClick={() => setInviteOpen(true)}>
                  Convidar primeiro membro
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {members.length > 0 && (
                <div className="rounded-md border divide-y">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-4 px-4 py-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-semibold text-primary text-sm">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{m.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {m.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${roleColors[m.role] ?? "bg-gray-100 text-gray-800"}`}>
                          {roleLabels[m.role] ?? m.role}
                        </Badge>
                        <Badge variant={m.isActive ? "default" : "outline"} className={`text-xs ${m.isActive ? "bg-green-100 text-green-800" : ""}`}>
                          {m.isActive ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      {isManager && m.id !== me?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => handleRemove(m.id)}
                          title="Desativar membro"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {invites.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Convites Pendentes
                  </p>
                  <div className="rounded-md border divide-y bg-muted/20">
                    {invites.map((inv) => (
                      <div key={inv.id} className="flex items-center gap-4 px-4 py-3">
                        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                          <Mail className="w-4 h-4 text-amber-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate text-muted-foreground">{inv.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Convite enviado · expira em {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "7 dias"}
                          </p>
                        </div>
                        <Badge className="text-xs bg-amber-100 text-amber-800">
                          {roleLabels[inv.role] ?? inv.role}
                        </Badge>
                        <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
                          Aguardando
                        </Badge>
                        {isManager && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => handleCancelInvite(inv.id)}
                            title="Cancelar convite"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Convidar Membro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>E-mail do convidado</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="membro@agencia.com"
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              O convidado será adicionado como <span className="font-medium text-foreground">Vendedor</span>. Ele deverá criar uma conta no VisiteCRM com este e-mail para ter acesso automático à sua agência.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button>
            <Button onClick={handleInvite} disabled={inviting}>
              {inviting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Convidando...</> : "Convidar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ──────────────────── API Keys Tab ──────────────────── */
function ApiKeysTab() {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <Key className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <h3 className="text-sm font-medium">Gerenciamento de chaves ainda não disponível</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Esta tela ainda não está conectada a um serviço de criação e revogação de chaves.
        Nenhuma chave foi criada; não use os controles desta aba para configurar integrações.
      </p>
    </div>
  );
}


/* ──────────────────── Club Config Tab ──────────────────── */

const CLUB_TIERS = [
  { value: "bronze", label: "Bronze", icon: "🥉" },
  { value: "silver", label: "Prata", icon: "🥈" },
  { value: "gold", label: "Ouro", icon: "🥇" },
  { value: "diamond", label: "Diamante", icon: "💎" },
] as const;

interface ClubBenefitAdmin {
  id: string;
  tier: string;
  benefitKey: string;
  label: string;
  description: string | null;
  value: string | null;
  sortOrder: number;
}

type ClubBenefitDraft = { label: string; value: string; description: string };
type ClubBenefitCreatePayload = {
  tier: string;
  benefitKey: string;
  label: string;
  description: string | null;
  value: string | null;
  sortOrder: number;
};
type ClubBenefitCreateAttempt = {
  fingerprint: string;
  idempotencyKey: string;
  payload: ClubBenefitCreatePayload;
};
type StoredClubBenefitDraft = {
  version: 1;
  tier: string;
  draft: ClubBenefitDraft;
  attempt: ClubBenefitCreateAttempt | null;
};

export function ClubConfigTab() {
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const benefitDraftStorageKey = me?.tenantId
    ? `visitecrm:club-benefit-draft:v1:${me.tenantId}`
    : null;
  const [clubName, setClubName] = useState("Clube Visite");
  const [clubDescription, setClubDescription] = useState("");
  const [savedClubConfig, setSavedClubConfig] = useState({ clubName: "Clube Visite", clubDescription: "" });
  const [benefits, setBenefits] = useState<ClubBenefitAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [activeTier, setActiveTier] = useState<string>("bronze");
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const benefitDraftRef = useRef<ClubBenefitDraft>({ label: "", value: "", description: "" });
  const [benefitDraftStorageReady, setBenefitDraftStorageReady] = useState(false);
  const [benefitDraftStorageUnavailable, setBenefitDraftStorageUnavailable] = useState(false);
  const [hasRecoveredBenefitDraft, setHasRecoveredBenefitDraft] = useState(false);
  const [addingBenefit, setAddingBenefit] = useState(false);
  const addingBenefitRef = useRef(false);
  const addAttemptRef = useRef<ClubBenefitCreateAttempt | null>(null);
  const benefitDraftStorageReadyRef = useRef(false);
  const benefitDraftStorageReadableRef = useRef(false);
  const [deletingBenefitIds, setDeletingBenefitIds] = useState<Set<string>>(() => new Set());
  const deletingBenefitIdsRef = useRef(new Set<string>());
  const [editingBenefitId, setEditingBenefitId] = useState<string | null>(null);
  const [editingBenefitError, setEditingBenefitError] = useState<string | null>(null);
  const [editingBenefitDraft, setEditingBenefitDraft] = useState<ClubBenefitDraft>({
    label: "",
    value: "",
    description: "",
  });
  const [savingEditedBenefit, setSavingEditedBenefit] = useState(false);
  const savingEditedBenefitRef = useRef(false);
  const benefitsLoadedRef = useRef(false);
  const benefitsRefreshInFlightRef = useRef(false);
  const benefitMutationCountRef = useRef(0);
  const benefitRevisionRef = useRef(0);
  const clubSettingsDirty = clubName !== savedClubConfig.clubName
    || clubDescription !== savedClubConfig.clubDescription
    || Boolean(newLabel.trim() || newValue.trim() || newDescription.trim());
  useAgencySettingsDirty("clube", "club-settings", clubSettingsDirty);

  function persistBenefitDraft(
    draft: ClubBenefitDraft,
    attempt: ClubBenefitCreateAttempt | null = addAttemptRef.current,
    tier: string = activeTier,
  ) {
    if (!benefitDraftStorageKey || !benefitDraftStorageReadyRef.current) return;
    try {
      if (!draft.label && !draft.value && !draft.description && !attempt) {
        sessionStorage.removeItem(benefitDraftStorageKey);
      } else {
        const stored: StoredClubBenefitDraft = { version: 1, tier, draft, attempt };
        sessionStorage.setItem(benefitDraftStorageKey, JSON.stringify(stored));
      }
      if (!benefitDraftStorageReadableRef.current) {
        sessionStorage.getItem(benefitDraftStorageKey);
        benefitDraftStorageReadableRef.current = true;
      }
      setBenefitDraftStorageUnavailable(false);
    } catch {
      // Storage can be disabled by browser policy; keep the in-memory form usable.
      setBenefitDraftStorageUnavailable(true);
    }
  }

  useEffect(() => {
    const emptyDraft: ClubBenefitDraft = { label: "", value: "", description: "" };
    benefitDraftRef.current = emptyDraft;
    addAttemptRef.current = null;
    setNewLabel("");
    setNewValue("");
    setNewDescription("");
    setHasRecoveredBenefitDraft(false);
    setBenefitDraftStorageUnavailable(false);
    benefitDraftStorageReadyRef.current = false;
    benefitDraftStorageReadableRef.current = false;
    setBenefitDraftStorageReady(false);
    if (!benefitDraftStorageKey) return;

    try {
      const storedText = sessionStorage.getItem(benefitDraftStorageKey);
      benefitDraftStorageReadableRef.current = true;
      if (storedText) {
        let stored: Partial<StoredClubBenefitDraft> | null;
        try {
          stored = JSON.parse(storedText) as Partial<StoredClubBenefitDraft>;
        } catch {
          stored = null;
        }
        const draft = stored?.draft;
        const attempt = stored?.attempt;
        const draftIsValid = stored?.version === 1
          && CLUB_TIERS.some((tier) => tier.value === stored?.tier)
          && !!draft
          && typeof draft.label === "string"
          && typeof draft.value === "string"
          && typeof draft.description === "string";
        const attemptIsValid = attempt == null || (
          typeof attempt.fingerprint === "string"
          && typeof attempt.idempotencyKey === "string"
          && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt.idempotencyKey)
          && !!attempt.payload
          && CLUB_TIERS.some((tier) => tier.value === attempt.payload.tier)
          && typeof attempt.payload.benefitKey === "string"
          && typeof attempt.payload.label === "string"
          && (attempt.payload.description === null || typeof attempt.payload.description === "string")
          && (attempt.payload.value === null || typeof attempt.payload.value === "string")
          && Number.isInteger(attempt.payload.sortOrder)
        );
        if (draftIsValid && attemptIsValid) {
          benefitDraftRef.current = draft;
          setActiveTier(stored!.tier!);
          setNewLabel(draft.label);
          setNewValue(draft.value);
          setNewDescription(draft.description);
          addAttemptRef.current = attempt ?? null;
          setHasRecoveredBenefitDraft(Boolean(
            draft.label || draft.value || draft.description || attempt,
          ));
        } else {
          sessionStorage.removeItem(benefitDraftStorageKey);
        }
      }
      setBenefitDraftStorageUnavailable(false);
    } catch {
      setBenefitDraftStorageUnavailable(true);
      try {
        sessionStorage.removeItem(benefitDraftStorageKey);
      } catch {
        // Ignore storage cleanup failures.
      }
    }
    benefitDraftStorageReadyRef.current = true;
    setBenefitDraftStorageReady(true);
  }, [benefitDraftStorageKey]);

  function discardBenefitDraft() {
    const emptyDraft: ClubBenefitDraft = { label: "", value: "", description: "" };
    benefitDraftRef.current = emptyDraft;
    addAttemptRef.current = null;
    setNewLabel("");
    setNewValue("");
    setNewDescription("");
    setHasRecoveredBenefitDraft(false);
    persistBenefitDraft(emptyDraft, null);
  }

  const fetchClubBenefits = useCallback(async (): Promise<ClubBenefitAdmin[]> => {
    const response = await fetch(`${BASE}/api/club/benefits`, { credentials: "include" });
    if (!response.ok) throw new Error("load_benefits_failed");
    const result = await response.json() as { data?: ClubBenefitAdmin[] };
    if (!Array.isArray(result.data)) throw new Error("invalid_benefits_response");
    return result.data;
  }, []);

  const refreshClubBenefits = useCallback(async () => {
    if (!benefitsLoadedRef.current
      || benefitsRefreshInFlightRef.current
      || benefitMutationCountRef.current > 0) return;

    const revision = benefitRevisionRef.current;
    benefitsRefreshInFlightRef.current = true;
    try {
      const refreshedBenefits = await fetchClubBenefits();
      if (benefitRevisionRef.current === revision && benefitMutationCountRef.current === 0) {
        setBenefits(refreshedBenefits);
      }
    } catch {
      // Transient background refresh failures leave the current list intact and retry later.
    } finally {
      benefitsRefreshInFlightRef.current = false;
    }
  }, [fetchClubBenefits]);

  useEffect(() => {
    async function load() {
      try {
        const [cfgRes, initialBenefits] = await Promise.all([
          fetch(`${BASE}/api/club/config`, { credentials: "include" }),
          fetchClubBenefits(),
        ]);
        if (!cfgRes.ok) throw new Error("load_failed");
        const cfg = await cfgRes.json() as { clubName: string; description: string | null };
        setClubName(cfg.clubName ?? "Clube Visite");
        setClubDescription(cfg.description ?? "");
        setSavedClubConfig({
          clubName: cfg.clubName ?? "Clube Visite",
          clubDescription: cfg.description ?? "",
        });
        setBenefits(initialBenefits);
      } catch {
        toast({ title: "Erro ao carregar configurações do clube", variant: "destructive" });
      } finally {
        benefitsLoadedRef.current = true;
        setLoading(false);
      }
    }
    void load();
  }, [fetchClubBenefits, toast]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshClubBenefits();
    };
    const intervalId = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshClubBenefits]);

  async function handleSaveConfig() {
    setSavingConfig(true);
    try {
      const response = await fetch(`${BASE}/api/club/config`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubName, description: clubDescription || null }),
      });
      if (!response.ok) throw new Error("save_failed");
      setSavedClubConfig({ clubName, clubDescription });
      toast({ title: "Configurações do clube salvas!" });
    } catch {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleAddBenefit() {
    if (addingBenefitRef.current) return;
    const submittedDraft = { ...benefitDraftRef.current };
    if (!submittedDraft.label.trim()) return;
    const submittedBenefit = {
      tier: activeTier,
      benefitKey: submittedDraft.label.toLowerCase().replace(/\s+/g, "_").slice(0, 100),
      label: submittedDraft.label.trim(),
      description: submittedDraft.description.trim() || null,
      value: submittedDraft.value.trim() || null,
      sortOrder: benefits.filter((benefit) => benefit.tier === activeTier).length,
    };
    const fingerprint = JSON.stringify({
      tier: submittedBenefit.tier,
      benefitKey: submittedBenefit.benefitKey,
      label: submittedBenefit.label,
      description: submittedBenefit.description,
      value: submittedBenefit.value,
    });
    let attempt = addAttemptRef.current;
    if (!attempt || attempt.fingerprint !== fingerprint) {
      attempt = {
        fingerprint,
        idempotencyKey: crypto.randomUUID(),
        payload: submittedBenefit,
      };
      addAttemptRef.current = attempt;
    }
    persistBenefitDraft(benefitDraftRef.current, attempt);
    const requestBenefit = attempt.payload;
    addingBenefitRef.current = true;
    benefitRevisionRef.current += 1;
    benefitMutationCountRef.current += 1;
    setAddingBenefit(true);
    try {
      const res = await fetch(`${BASE}/api/club/benefits`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.idempotencyKey },
        body: JSON.stringify(requestBenefit),
      });
      if (!res.ok) throw new Error("add_benefit_failed");
      const data = await res.json() as { id: string };
      setBenefits((prev) => {
        if (prev.some((benefit) => benefit.id === data.id)) return prev;
        return [
          ...prev,
          {
            id: data.id,
            ...requestBenefit,
            sortOrder: prev.filter((benefit) => benefit.tier === requestBenefit.tier).length,
          },
        ];
      });
      if (addAttemptRef.current === attempt) addAttemptRef.current = null;
      if (benefitDraftRef.current.label === submittedDraft.label) {
        benefitDraftRef.current.label = "";
        setNewLabel("");
      }
      if (benefitDraftRef.current.value === submittedDraft.value) {
        benefitDraftRef.current.value = "";
        setNewValue("");
      }
      if (benefitDraftRef.current.description === submittedDraft.description) {
        benefitDraftRef.current.description = "";
        setNewDescription("");
      }
      setHasRecoveredBenefitDraft(false);
      persistBenefitDraft(benefitDraftRef.current, addAttemptRef.current);
      toast({ title: "Benefício adicionado!" });
    } catch {
      toast({ title: "Erro ao adicionar benefício", variant: "destructive" });
    } finally {
      addingBenefitRef.current = false;
      benefitMutationCountRef.current = Math.max(0, benefitMutationCountRef.current - 1);
      setAddingBenefit(false);
    }
  }

  async function handleDeleteBenefit(id: string) {
    if (deletingBenefitIdsRef.current.has(id)) return;
    deletingBenefitIdsRef.current.add(id);
    setDeletingBenefitIds(new Set(deletingBenefitIdsRef.current));
    benefitRevisionRef.current += 1;
    benefitMutationCountRef.current += 1;
    try {
      const response = await fetch(`${BASE}/api/club/benefits/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("delete_benefit_failed");
      setBenefits((prev) => prev.filter((b) => b.id !== id));
      toast({ title: "Benefício removido" });
    } catch {
      toast({ title: "Erro ao remover benefício", variant: "destructive" });
    } finally {
      deletingBenefitIdsRef.current.delete(id);
      setDeletingBenefitIds(new Set(deletingBenefitIdsRef.current));
      benefitMutationCountRef.current = Math.max(0, benefitMutationCountRef.current - 1);
    }
  }

  function startEditingBenefit(benefit: ClubBenefitAdmin) {
    setEditingBenefitId(benefit.id);
    setEditingBenefitError(null);
    setEditingBenefitDraft({
      label: benefit.label,
      value: benefit.value ?? "",
      description: benefit.description ?? "",
    });
  }

  async function handleUpdateBenefit(benefit: ClubBenefitAdmin) {
    if (savingEditedBenefitRef.current) return;
    const updatedFields = {
      label: editingBenefitDraft.label.trim(),
      value: editingBenefitDraft.value.trim() || null,
      description: editingBenefitDraft.description.trim() || null,
    };
    if (!updatedFields.label) return;

    savingEditedBenefitRef.current = true;
    setSavingEditedBenefit(true);
    benefitRevisionRef.current += 1;
    benefitMutationCountRef.current += 1;
    try {
      const response = await fetch(`${BASE}/api/club/benefits/${benefit.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedFields),
      });
      if (!response.ok) throw new Error("update_benefit_failed");

      setBenefits((previous) => previous.map((item) => (
        item.id === benefit.id ? { ...item, ...updatedFields } : item
      )));
      setEditingBenefitId(null);
      setEditingBenefitError(null);
      toast({ title: "Benefício atualizado!" });
    } catch {
      setEditingBenefitError("Não foi possível salvar. Seu rascunho foi mantido para você tentar novamente ou cancelar.");
      toast({ title: "Erro ao atualizar benefício", variant: "destructive" });
    } finally {
      savingEditedBenefitRef.current = false;
      setSavingEditedBenefit(false);
      benefitMutationCountRef.current = Math.max(0, benefitMutationCountRef.current - 1);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Carregando configurações do clube...
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-5">
      <Card className="overflow-hidden rounded-xl border-[#E7DED0] shadow-sm dark:border-border">
        <CardHeader className="border-b border-[#EEE7DC] bg-gradient-to-r from-amber-50/80 to-white px-5 py-4 dark:border-border dark:from-amber-950/20 dark:to-card">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <Crown className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Identidade do Clube</CardTitle>
              <CardDescription className="mt-1">
                Defina como o programa de benefícios aparece para os clientes.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="club-name">Nome do Clube</Label>
            <Input
              id="club-name"
              data-testid="club-name-input"
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              placeholder="Ex: Clube Visite Cariri"
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="club-description">
              Descrição <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="club-description"
              data-testid="club-description-input"
              value={clubDescription}
              onChange={(e) => setClubDescription(e.target.value)}
              placeholder="Uma frase sobre o clube para os clientes"
              maxLength={500}
            />
          </div>
          <div className="md:col-span-2 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Essas informações identificam o programa em toda a experiência do cliente.
            </p>
            <Button
              data-testid="club-save-identity"
              onClick={handleSaveConfig}
              disabled={savingConfig}
              className="sm:min-w-32"
            >
              {savingConfig ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando...</>
              ) : "Salvar identidade"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-xl border-[#DCE3E8] shadow-sm dark:border-border">
        <CardHeader className="gap-3 border-b bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Star className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Benefícios por nível</CardTitle>
              <CardDescription className="mt-1">
                Organize as vantagens e acompanhe quantas estão ativas em cada categoria.
              </CardDescription>
            </div>
          </div>
          <Button size="sm" variant="outline" asChild className="shrink-0">
            <a href="/embaixadores" data-testid="club-ambassadors-link" className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Ranking de Embaixadores
            </a>
          </Button>
        </CardHeader>
        <CardContent className="space-y-5 p-4 sm:p-5">
          <Tabs
            value={activeTier}
            onValueChange={(tier) => {
              setActiveTier(tier);
              persistBenefitDraft(benefitDraftRef.current, addAttemptRef.current, tier);
            }}
          >
            <TabsList aria-label="Nível do Clube" className="grid h-auto w-full grid-cols-2 gap-1.5 bg-muted/70 p-1.5 sm:grid-cols-4">
              {CLUB_TIERS.map((tier) => {
                const count = benefits.filter((benefit) => benefit.tier === tier.value).length;
                return (
                  <TabsTrigger
                    key={tier.value}
                    value={tier.value}
                    data-testid={`club-tier-tab-${tier.value}`}
                    className="min-h-11 justify-between gap-2 rounded-lg px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true">{tier.icon}</span>
                      <span>{tier.label}</span>
                    </span>
                    <Badge
                      variant="secondary"
                      data-testid={`club-tier-count-${tier.value}`}
                      className="h-5 min-w-5 justify-center px-1.5 text-[10px]"
                    >
                      {count}
                    </Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {CLUB_TIERS.map((tier) => {
              const tierBenefits = benefits.filter((benefit) => benefit.tier === tier.value);
              return (
                <TabsContent key={tier.value} value={tier.value} className="mt-5 space-y-4">
                  {tierBenefits.length === 0 ? (
                    <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-6 text-center">
                      <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-background text-lg shadow-sm" aria-hidden="true">
                        {tier.icon}
                      </span>
                      <p data-testid={`club-empty-tier-${tier.value}`} className="text-sm font-medium">
                        Nenhum benefício para {tier.label} ainda
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Adicione uma vantagem para destacar este nível do clube.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {tierBenefits.map((benefit) => (
                        <div
                          key={benefit.id}
                          data-testid={`club-benefit-${benefit.id}`}
                          className="flex items-start gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:bg-muted/20"
                        >
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-300">
                            <Star className="h-4 w-4" aria-hidden="true" />
                          </span>
                          {editingBenefitId === benefit.id ? (
                            <div className="min-w-0 flex-1 space-y-2">
                              <div
                                className="rounded-md border bg-muted/30 px-3 py-2 text-xs"
                                data-testid={`club-benefit-last-saved-${benefit.id}`}
                              >
                                <p className="font-medium">Última versão salva</p>
                                <p className="mt-1">{benefit.label}{benefit.value ? ` · ${benefit.value}` : ""}</p>
                                {benefit.description && (
                                  <p className="mt-0.5 text-muted-foreground">{benefit.description}</p>
                                )}
                              </div>
                              {editingBenefitError && (
                                <p
                                  role="alert"
                                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                                  data-testid={`club-edit-benefit-error-${benefit.id}`}
                                >
                                  {editingBenefitError} A versão acima continua salva.
                                </p>
                              )}
                              <Label htmlFor={`club-benefit-edit-label-${benefit.id}`} className="sr-only">
                                Nome do benefício
                              </Label>
                              <Input
                                id={`club-benefit-edit-label-${benefit.id}`}
                                data-testid={`club-edit-benefit-label-${benefit.id}`}
                                value={editingBenefitDraft.label}
                                onChange={(event) => {
                                  setEditingBenefitError(null);
                                  setEditingBenefitDraft((draft) => ({ ...draft, label: event.target.value }));
                                }}
                                maxLength={200}
                                aria-label={`Nome do benefício ${benefit.label}`}
                              />
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div>
                                  <Label htmlFor={`club-benefit-edit-value-${benefit.id}`} className="sr-only">
                                    Valor ou condição
                                  </Label>
                                  <Input
                                    id={`club-benefit-edit-value-${benefit.id}`}
                                    data-testid={`club-edit-benefit-value-${benefit.id}`}
                                    placeholder="Valor ou condição (opcional)"
                                    value={editingBenefitDraft.value}
                                    onChange={(event) => {
                                      setEditingBenefitError(null);
                                      setEditingBenefitDraft((draft) => ({ ...draft, value: event.target.value }));
                                    }}
                                    maxLength={200}
                                  />
                                </div>
                                <div>
                                  <Label htmlFor={`club-benefit-edit-description-${benefit.id}`} className="sr-only">
                                    Descrição do benefício
                                  </Label>
                                  <Input
                                    id={`club-benefit-edit-description-${benefit.id}`}
                                    data-testid={`club-edit-benefit-description-${benefit.id}`}
                                    placeholder="Detalhes adicionais (opcional)"
                                    value={editingBenefitDraft.description}
                                    onChange={(event) => {
                                      setEditingBenefitError(null);
                                      setEditingBenefitDraft((draft) => ({ ...draft, description: event.target.value }));
                                    }}
                                    maxLength={500}
                                  />
                                </div>
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  data-testid={`club-cancel-edit-benefit-${benefit.id}`}
                                  onClick={() => {
                                    setEditingBenefitId(null);
                                    setEditingBenefitError(null);
                                  }}
                                  disabled={savingEditedBenefit}
                                >
                                  Cancelar
                                </Button>
                                <Button
                                  type="button"
                                  data-testid={`club-save-edit-benefit-${benefit.id}`}
                                  onClick={() => void handleUpdateBenefit(benefit)}
                                  disabled={savingEditedBenefit || !editingBenefitDraft.label.trim()}
                                >
                                  {savingEditedBenefit ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando...</>
                                  ) : "Salvar"}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium">{benefit.label}</span>
                                  {benefit.value && <Badge variant="outline" className="text-xs">{benefit.value}</Badge>}
                                </div>
                                {benefit.description && (
                                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{benefit.description}</p>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  data-testid={`club-edit-benefit-${benefit.id}`}
                                  aria-label={`Editar benefício ${benefit.label}`}
                                  className="h-8 w-8 text-muted-foreground"
                                  onClick={() => startEditingBenefit(benefit)}
                                  disabled={!!editingBenefitId || deletingBenefitIds.has(benefit.id)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  data-testid={`club-delete-benefit-${benefit.id}`}
                                  aria-label={`Remover benefício ${benefit.label}`}
                                  className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => handleDeleteBenefit(benefit.id)}
                                  disabled={!!editingBenefitId || deletingBenefitIds.has(benefit.id)}
                                >
                                  {deletingBenefitIds.has(benefit.id) ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-xl border border-primary/15 bg-primary/[0.03] p-4">
                    <div className="mb-3">
                      <h4 className="text-sm font-semibold">Adicionar benefício</h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        A nova vantagem será incluída no nível {tier.label}.
                      </p>
                      {hasRecoveredBenefitDraft && (
                        <p className="mt-1 text-xs text-primary" role="status">
                          Rascunho recuperado desta sessão.
                        </p>
                      )}
                      {benefitDraftStorageReady && benefitDraftStorageUnavailable && (
                        <p
                          className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                          data-testid="club-benefit-storage-warning"
                          role="status"
                        >
                          Não foi possível salvar este rascunho neste navegador. Ele pode ser perdido
                          se você recarregar a página, mas ainda é possível adicionar o benefício.
                        </p>
                      )}
                    </div>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="club-benefit-label" className="sr-only">Nome do benefício</Label>
                        <Input
                          id="club-benefit-label"
                          data-testid="club-benefit-label-input"
                          placeholder="Ex.: 5% de desconto em todas as viagens"
                          value={newLabel}
                          onChange={(e) => {
                            const draft = { ...benefitDraftRef.current, label: e.target.value };
                            benefitDraftRef.current = draft;
                            setNewLabel(e.target.value);
                            persistBenefitDraft(draft);
                          }}
                          disabled={!benefitDraftStorageReady}
                          maxLength={200}
                        />
                      </div>
                      <div>
                        <Label htmlFor="club-benefit-value" className="sr-only">Valor ou condição</Label>
                        <Input
                          id="club-benefit-value"
                          data-testid="club-benefit-value-input"
                          placeholder="Valor ou condição (ex.: 5%)"
                          value={newValue}
                          onChange={(e) => {
                            const draft = { ...benefitDraftRef.current, value: e.target.value };
                            benefitDraftRef.current = draft;
                            setNewValue(e.target.value);
                            persistBenefitDraft(draft);
                          }}
                          disabled={!benefitDraftStorageReady}
                          maxLength={200}
                        />
                      </div>
                      <div>
                        <Label htmlFor="club-benefit-description" className="sr-only">Descrição do benefício</Label>
                        <Input
                          id="club-benefit-description"
                          data-testid="club-benefit-description-input"
                          placeholder="Detalhes adicionais (opcional)"
                          value={newDescription}
                          onChange={(e) => {
                            const draft = { ...benefitDraftRef.current, description: e.target.value };
                            benefitDraftRef.current = draft;
                            setNewDescription(e.target.value);
                            persistBenefitDraft(draft);
                          }}
                          disabled={!benefitDraftStorageReady}
                          maxLength={500}
                        />
                      </div>
                      <div className="sm:col-span-2 flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-xs text-muted-foreground">
                          {tier.icon} Nível selecionado: <strong className="font-medium text-foreground">{tier.label}</strong>
                        </span>
                        <div className="flex flex-wrap justify-end gap-2">
                          {(newLabel || newValue || newDescription || hasRecoveredBenefitDraft) && (
                            <Button
                              type="button"
                              variant="ghost"
                              data-testid="club-discard-benefit-draft"
                              onClick={discardBenefitDraft}
                              disabled={addingBenefit || !benefitDraftStorageReady}
                            >
                              Descartar rascunho
                            </Button>
                          )}
                          <Button
                            data-testid="club-add-benefit"
                            onClick={handleAddBenefit}
                            disabled={!benefitDraftStorageReady || addingBenefit || !newLabel.trim()}
                            className="sm:min-w-32"
                          >
                            {addingBenefit ? (
                              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adicionando...</>
                            ) : "Adicionar benefício"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              );
            })}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

/* ──────────────────── Pipeline Settings Tab ──────────────────── */
const PIPELINE_PRESET_COLORS = [
  "#6366F1","#3B82F6","#0EA5E9","#10B981","#06B6D4",
  "#F59E0B","#EF4444","#8B5CF6","#EC4899","#6B7280",
];

type PipelineCfg = { id: string; name: string; isDefault: boolean; hasDeals: boolean; createdAt: string };
type StageCfg = { id: string; name: string; color: string; position: number; pipelineId: string };

function PipelineSettingsTab() {
  const { toast } = useToast();

  const { data: pipelines, refetch: refetchPipelines } = useQuery<PipelineCfg[]>({
    queryKey: ["cfg-pipelines"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/pipelines`, { credentials: "include" });
      if (!r.ok) throw new Error("Erro ao carregar pipelines");
      return r.json();
    },
  });

  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const activePipeline = pipelines?.find(p => p.id === activePipelineId) ?? pipelines?.[0];

  const { data: stages, refetch: refetchStages } = useQuery<StageCfg[]>({
    queryKey: ["cfg-stages", activePipeline?.id],
    enabled: !!activePipeline?.id,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/pipeline/stages?pipelineId=${activePipeline!.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Erro ao carregar etapas");
      return r.json();
    },
  });

  // Pipeline CRUD state
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [renamingPipelineId, setRenamingPipelineId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // Stage CRUD state
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(PIPELINE_PRESET_COLORS[0]);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageValue, setEditingStageValue] = useState("");
  useAgencySettingsDirty(
    "pipelines",
    "pipeline-drafts",
    Boolean(
      (creatingPipeline && newPipelineName.trim())
      || (renamingPipelineId && renameValue.trim())
      || newStageName.trim()
      || (editingStageId && editingStageValue.trim()),
    ),
  );

  function reportRequestError(error: unknown) {
    toast({
      title: error instanceof Error ? error.message : "Não foi possível atualizar o pipeline.",
      variant: "destructive",
    });
  }

  async function createPipeline() {
    if (!newPipelineName.trim()) return;
    setLoadingAction("create-pipeline");
    try {
      const r = await fetch(`${BASE}/api/pipelines`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPipelineName.trim() }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ title: "Erro", description: d.message, variant: "destructive" }); return; }
      const p: PipelineCfg = await r.json();
      setNewPipelineName("");
      setCreatingPipeline(false);
      setActivePipelineId(p.id);
      await refetchPipelines();
    } catch (error) {
      reportRequestError(error);
    } finally { setLoadingAction(null); }
  }

  async function renamePipeline(id: string) {
    if (!renameValue.trim()) return;
    setLoadingAction(`rename-${id}`);
    try {
      const r = await fetch(`${BASE}/api/pipelines/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message ?? d.error ?? "Não foi possível renomear o pipeline.");
      }
      setRenamingPipelineId(null);
      await refetchPipelines();
    } catch (error) {
      reportRequestError(error);
    } finally { setLoadingAction(null); }
  }

  async function setDefault(id: string) {
    setLoadingAction(`default-${id}`);
    try {
      const r = await fetch(`${BASE}/api/pipelines/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ title: "Erro", description: d.message, variant: "destructive" }); return; }
      await refetchPipelines();
    } catch (error) {
      reportRequestError(error);
    } finally { setLoadingAction(null); }
  }

  async function deletePipeline(id: string) {
    setLoadingAction(`delete-${id}`);
    try {
      const r = await fetch(`${BASE}/api/pipelines/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ title: "Erro", description: d.message, variant: "destructive" }); return; }
      if (activePipeline?.id === id) setActivePipelineId(null);
      await refetchPipelines();
    } catch (error) {
      reportRequestError(error);
    } finally { setLoadingAction(null); }
  }

  async function addStage() {
    if (!newStageName.trim() || !activePipeline) return;
    setLoadingAction("add-stage");
    try {
      const r = await fetch(`${BASE}/api/pipeline/stages?pipelineId=${activePipeline.id}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newStageName.trim(), color: newStageColor }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message ?? d.error ?? "Não foi possível adicionar a etapa.");
      }
      setNewStageName("");
      await refetchStages();
    } catch (error) {
      reportRequestError(error);
    } finally { setLoadingAction(null); }
  }

  async function renameStage(stageId: string) {
    if (!editingStageValue.trim()) return;
    setLoadingAction(`rename-stage-${stageId}`);
    try {
      const r = await fetch(`${BASE}/api/pipeline/stages/${stageId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingStageValue.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message ?? d.error ?? "Não foi possível renomear a etapa.");
      }
      setEditingStageId(null);
      await refetchStages();
    } catch (error) {
      reportRequestError(error);
    } finally { setLoadingAction(null); }
  }

  async function deleteStage(stageId: string) {
    setLoadingAction(`delete-stage-${stageId}`);
    try {
      const r = await fetch(`${BASE}/api/pipeline/stages/${stageId}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ title: "Erro", description: d.message, variant: "destructive" }); return; }
      await refetchStages();
    } catch (error) {
      reportRequestError(error);
    } finally { setLoadingAction(null); }
  }

  const sortedStages = [...(stages ?? [])].sort((a, b) => a.position - b.position);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Left: Pipeline list */}
      <div className="md:col-span-1 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pipelines</h3>
          <Button size="sm" variant="outline" className="gap-1 h-7 px-2 text-xs" onClick={() => setCreatingPipeline(true)}>
            <Plus className="w-3 h-3" /> Novo
          </Button>
        </div>

        {creatingPipeline && (
          <div className="flex items-center gap-1">
            <Input
              value={newPipelineName}
              onChange={e => setNewPipelineName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") createPipeline(); if (e.key === "Escape") setCreatingPipeline(false); }}
              placeholder="Nome do pipeline"
              className="h-7 text-sm"
              autoFocus
            />
            <Button size="sm" className="h-7 px-2 shrink-0" onClick={createPipeline} disabled={loadingAction === "create-pipeline"}>
              {loadingAction === "create-pipeline" ? <Loader2 className="w-3 h-3 animate-spin" /> : "OK"}
            </Button>
            <button onClick={() => setCreatingPipeline(false)} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="space-y-1">
          {pipelines?.map(p => (
            <div
              key={p.id}
              className={`group flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${(activePipeline?.id === p.id) ? "border-primary bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/50"}`}
              onClick={() => setActivePipelineId(p.id)}
            >
              {renamingPipelineId === p.id ? (
                <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                  <Input
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") renamePipeline(p.id); if (e.key === "Escape") setRenamingPipelineId(null); }}
                    className="h-6 text-xs flex-1"
                    autoFocus
                  />
                  <Button size="sm" className="h-6 px-1.5 text-xs shrink-0" onClick={() => renamePipeline(p.id)}>OK</Button>
                  <button onClick={() => setRenamingPipelineId(null)} className="p-0.5 text-muted-foreground"><X className="w-3 h-3" /></button>
                </div>
              ) : (
                <>
                  <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm flex-1 truncate">{p.name}</span>
                  {p.isDefault && <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 shrink-0">Padrão</Badge>}
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => { setRenameValue(p.name); setRenamingPipelineId(p.id); }}
                      className="p-0.5 text-muted-foreground hover:text-foreground rounded"
                      title="Renomear"
                    ><Pencil className="w-3 h-3" /></button>
                    {!p.isDefault && (
                      <button
                        onClick={() => setDefault(p.id)}
                        disabled={loadingAction === `default-${p.id}`}
                        className="p-0.5 text-muted-foreground hover:text-amber-500 rounded"
                        title="Definir como padrão"
                      >
                        {loadingAction === `default-${p.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
                      </button>
                    )}
                    {p.hasDeals ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="p-0.5 text-muted-foreground/40 cursor-not-allowed rounded inline-flex">
                              <Trash2 className="w-3 h-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs max-w-[200px] text-center">
                            Mova ou exclua os negócios antes de excluir este pipeline
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button className="p-0.5 text-muted-foreground hover:text-destructive rounded" title="Excluir">
                            {loadingAction === `delete-${p.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir pipeline "{p.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Isso excluirá permanentemente todas as etapas deste pipeline.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deletePipeline(p.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: Stage management for selected pipeline */}
      <div className="md:col-span-2 space-y-3">
        {activePipeline ? (
          <>
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Etapas — {activePipeline.name}</h3>
            </div>

            <div className="space-y-1">
              {sortedStages.map((s, idx) => (
                <div key={s.id} className="group flex items-center gap-2 p-2 rounded-lg border bg-card">
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  {editingStageId === s.id ? (
                    <div className="flex items-center gap-1 flex-1">
                      <Input
                        value={editingStageValue}
                        onChange={e => setEditingStageValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") renameStage(s.id); if (e.key === "Escape") setEditingStageId(null); }}
                        className="h-6 text-xs flex-1"
                        autoFocus
                      />
                      <Button size="sm" className="h-6 px-1.5 text-xs shrink-0" onClick={() => renameStage(s.id)}>OK</Button>
                      <button onClick={() => setEditingStageId(null)} className="p-0.5 text-muted-foreground"><X className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm flex-1 truncate">{s.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">#{idx + 1}</span>
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => { setEditingStageValue(s.name); setEditingStageId(s.id); }}
                          className="p-0.5 text-muted-foreground hover:text-foreground rounded"
                        ><Pencil className="w-3 h-3" /></button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button className="p-0.5 text-muted-foreground hover:text-destructive rounded">
                              {loadingAction === `delete-stage-${s.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir etapa "{s.name}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Etapas com negócios ativos não podem ser excluídas.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteStage(s.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Add stage */}
            <div className="flex items-center gap-2 pt-1">
              <div className="flex items-center gap-1 flex-1">
                <Input
                  value={newStageName}
                  onChange={e => setNewStageName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addStage(); }}
                  placeholder="Nome da nova etapa..."
                  className="h-8 text-sm"
                />
                <div className="relative shrink-0">
                  <input
                    type="color"
                    value={newStageColor}
                    onChange={e => setNewStageColor(e.target.value)}
                    className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                  />
                  <div className="w-8 h-8 rounded border flex items-center justify-center" style={{ backgroundColor: newStageColor }} />
                </div>
              </div>
              <Button size="sm" className="h-8 gap-1 shrink-0" onClick={addStage} disabled={!newStageName.trim() || loadingAction === "add-stage"}>
                {loadingAction === "add-stage" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Adicionar
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Selecione um pipeline à esquerda
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────── Main Settings Page ──────────────────── */
export default function Configuracoes() {
  const [currentRoute, setLocation] = useLocation();
  const currentSearch = useSearch();
  const currentUrlRef = useRef(window.location.href);
  const currentHistoryStateRef = useRef(window.history.state);
  const { data: me } = useGetMe();
  const requestedTab = new URLSearchParams(currentSearch).get("tab");
  const { isAgencyAdmin, initialTab, navigationGroups, availableTabs } = getAgencySettingsAccess(
    me?.role,
    requestedTab,
  );
  const allowedTabs = availableTabs;
  useEffect(() => {
    if (requestedTab === "backup") {
      const destination = getLegacyBackupRedirect(me?.role);
      if (destination) {
        setLocation(destination);
      } else if (me) {
        setLocation(normalizeAgencySettingsTabUrl(window.location.href), { replace: true });
      }
      return;
    }
    if (!requestedTab || allowedTabs.has(requestedTab)) return;
    setLocation(normalizeAgencySettingsTabUrl(window.location.href), { replace: true });
  }, [allowedTabs, me, me?.role, requestedTab, setLocation]);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [dirtySources, setDirtySources] = useState<Record<string, string>>({});
  const [pendingExit, setPendingExit] = useState<
    { kind: "tab"; destination: string } | { kind: "route"; destination: string } | null
  >(null);
  const hasUnsavedChanges = hasUnsavedAgencySettings(dirtySources);
  const activeTabHasUnsavedChanges = hasUnsavedAgencySettings(dirtySources, activeTab);

  useEffect(() => {
    currentUrlRef.current = window.location.href;
    currentHistoryStateRef.current = window.history.state;
  }, [currentRoute, currentSearch]);

  const reportDirty = useCallback((section: string, source: string, isDirty: boolean) => {
    setDirtySources((current) =>
      updateAgencySettingsDirtySources(current, section, source, isDirty),
    );
  }, []);

  const commitTabChange = useCallback((nextTab: string) => {
    if (!allowedTabs.has(nextTab)) return;
    const nextUrl = buildAgencySettingsTabUrl(window.location.href, nextTab);
    window.history.pushState(window.history.state, "", nextUrl);
    currentUrlRef.current = new URL(nextUrl, window.location.origin).href;
    currentHistoryStateRef.current = window.history.state;
    setActiveTab(nextTab);
  }, [allowedTabs]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const guardHistoryNavigation = (event: PopStateEvent) => {
      const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const currentUrl = new URL(currentUrlRef.current);
      const currentRouteUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      if (destination === currentRouteUrl) return;

      event.stopImmediatePropagation();
      window.history.pushState(currentHistoryStateRef.current, "", currentRouteUrl);
      setPendingExit({ kind: "route", destination });
    };
    window.addEventListener("popstate", guardHistoryNavigation, true);
    return () => window.removeEventListener("popstate", guardHistoryNavigation, true);
  }, [hasUnsavedChanges]);

  const handleTabChange = useCallback((nextTab: string) => {
    if (nextTab === activeTab) return;
    if (activeTabHasUnsavedChanges) {
      setPendingExit({ kind: "tab", destination: nextTab });
      return;
    }
    commitTabChange(nextTab);
  }, [activeTab, activeTabHasUnsavedChanges, commitTabChange]);

  const handleRouteClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!hasUnsavedChanges || event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    const nextUrl = new URL(anchor.href, window.location.href);
    if (nextUrl.origin !== window.location.origin || nextUrl.pathname === window.location.pathname) return;

    event.preventDefault();
    event.stopPropagation();
    setPendingExit({
      kind: "route",
      destination: `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    });
  }, [hasUnsavedChanges]);

  const discardAndContinue = useCallback(() => {
    if (!pendingExit) return;
    if (pendingExit.kind === "tab") {
      setDirtySources((current) => Object.fromEntries(
        Object.entries(current).filter(([, section]) => section !== activeTab),
      ));
      commitTabChange(pendingExit.destination);
    } else {
      setDirtySources({});
      setLocation(pendingExit.destination);
    }
    setPendingExit(null);
  }, [activeTab, commitTabChange, pendingExit, setLocation]);

  useEffect(() => {
    const historyTab = requestedTab && allowedTabs.has(requestedTab) ? requestedTab : "agency";
    if (historyTab === activeTab) return;
    if (activeTabHasUnsavedChanges) {
      const currentTabUrl = buildAgencySettingsTabUrl(window.location.href, activeTab);
      setLocation(currentTabUrl, { replace: true });
      setPendingExit({ kind: "tab", destination: historyTab });
      return;
    }
    setActiveTab(historyTab);
  }, [activeTab, activeTabHasUnsavedChanges, allowedTabs, currentRoute, requestedTab, setLocation]);

  return (
    <AgencySettingsDirtyContext.Provider value={reportDirty}>
    <div className="visite-enter mx-auto max-w-[1440px] space-y-6" onClickCapture={handleRouteClickCapture}>
      <div className="relative overflow-hidden rounded-3xl border border-[#D9CBBE] bg-[#FFF9F0] px-5 py-6 shadow-[0_10px_28px_rgba(93,62,42,.07)] sm:px-7 dark:border-border dark:bg-card">
        <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full border-[16px] border-[#D8A646]/20" />
        <div className="relative">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4C8B5F]">
            BASTIDORES DA AGÊNCIA · CARIRI
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-[#5D3E2A] sm:text-3xl dark:text-foreground">
            {activeTab === "clube" ? "Clube de benefícios" : "Configurações"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[#71808C] dark:text-muted-foreground">
            {activeTab === "clube"
              ? "Configure a identidade e os benefícios do programa de relacionamento com seus clientes."
              : "Deixe a operação com a sua cara e mantenha os serviços essenciais prontos para a próxima saída."}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="space-y-4">
          <SettingsNavigation
            groups={navigationGroups}
            pageLabel="Seções do CRM"
            testIdPrefix="agency-settings"
            value={activeTab}
            onValueChange={handleTabChange}
            orientation="horizontal"
          />
          <div className="min-w-0">
          <TabsContent value="agency">
            <Card className="overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-[0_7px_22px_rgba(47,58,67,.05)] dark:border-border dark:bg-card">
              <CardHeader>
                <CardTitle>Dados gerais do estabelecimento</CardTitle>
                <CardDescription>
                  Identificação, contato e dados básicos da operação turística
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AgencyProfileTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plan">
            <Card className="overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-[0_7px_22px_rgba(47,58,67,.05)] dark:border-border dark:bg-card">
              <CardHeader>
                <CardTitle>Plano e Faturamento</CardTitle>
                <CardDescription>Gerencie seu plano e veja o uso dos recursos</CardDescription>
              </CardHeader>
              <CardContent>
                <PlanTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="integrations">
            <Card className="overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-[0_7px_22px_rgba(47,58,67,.05)] dark:border-border dark:bg-card">
              <CardHeader>
                <CardTitle>Integrações</CardTitle>
                <CardDescription>
                  Configure WhatsApp, pagamentos e outros serviços
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IntegrationsTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card className="overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-[0_7px_22px_rgba(47,58,67,.05)] dark:border-border dark:bg-card">
              <CardHeader>
                <CardTitle>Preferências de Notificação</CardTitle>
                <CardDescription>Escolha quais alertas você deseja receber</CardDescription>
              </CardHeader>
              <CardContent>
                <NotificationsTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="customization">
            <Card className="overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-[0_7px_22px_rgba(47,58,67,.05)] dark:border-border dark:bg-card">
              <CardHeader>
                <CardTitle>Personalização</CardTitle>
                <CardDescription>
                  Personalize a identidade visual do painel administrativo
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CustomizationTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="team">
            <Card className="overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-[0_7px_22px_rgba(47,58,67,.05)] dark:border-border dark:bg-card">
              <CardHeader>
                <CardTitle>Equipe da Agência</CardTitle>
                <CardDescription>
                  Gerencie os membros da sua equipe e convide novos vendedores
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TeamTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="apikeys">
            <Card className="overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-[0_7px_22px_rgba(47,58,67,.05)] dark:border-border dark:bg-card">
              <CardHeader>
                <CardTitle>Chaves de API</CardTitle>
                <CardDescription>
                  Gerencie chaves para integração com sistemas externos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ApiKeysTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="features">
            <Card className="overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-[0_7px_22px_rgba(47,58,67,.05)] dark:border-border dark:bg-card">
              <CardHeader>
                <CardTitle>Funcionalidades</CardTitle>
                <CardDescription>
                  Ative ou desative módulos do sistema para a sua agência
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FeaturesTab />
              </CardContent>
            </Card>
          </TabsContent>

          {isAgencyAdmin && (
            <TabsContent value="integrity">
              <div className="space-y-4">
                <LinkedDataIntegrityPanel />
                <FinancialMetricsOverview />
              </div>
            </TabsContent>
          )}

          <TabsContent value="clube">
            <Card className="overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-[0_7px_22px_rgba(47,58,67,.05)] dark:border-border dark:bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-amber-500" />
                  Clube Exclusivo
                </CardTitle>
                <CardDescription>
                  Configure o nome, descrição e benefícios por nível do clube de clientes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ClubConfigTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pipelines">
            <Card className="overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-[0_7px_22px_rgba(47,58,67,.05)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4" />
                  Pipelines de Vendas
                </CardTitle>
                <CardDescription>
                  Gerencie os pipelines e etapas do CRM da sua agência
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PipelineSettingsTab />
              </CardContent>
            </Card>
          </TabsContent>

        </div>
        </div>
      </Tabs>
      <AlertDialog open={pendingExit !== null} onOpenChange={(open) => { if (!open) setPendingExit(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações não salvas?</AlertDialogTitle>
            <AlertDialogDescription>
              Há mudanças nesta seção que ainda não foram salvas. Se continuar, elas serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction onClick={discardAndContinue}>
              {pendingExit?.kind === "tab" ? "Descartar e trocar de seção" : "Descartar e sair"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </AgencySettingsDirtyContext.Provider>
  );
}

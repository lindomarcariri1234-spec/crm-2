import { useState, useEffect, useCallback, useMemo } from "react";
import { CoverImageUpload } from "@/components/cover-image-upload";
import { storeApi } from "@/lib/storeApi";
import { useUser } from "@clerk/react";
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
import { parseBackupText, validateBackupDownload, type ParsedBackup } from "@/lib/backup-file";
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
  DatabaseBackup,
  Download,
  Upload,
  FileJson,
  XCircle,
  AlertTriangle,
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

  useEffect(() => {
    setGoalInput(String(currentGoal));
  }, [currentGoal]);

  async function handleSaveGoal() {
    const parsed = parseFloat(goalInput.replace(/\./g, "").replace(",", "."));
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

/* ──────────────────── Change Password Section ──────────────────── */
function ChangePasswordSection() {
  const { user } = useUser();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      toast({ title: "Usuário não autenticado", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "As senhas não coincidem", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "A nova senha deve ter pelo menos 8 caracteres", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      await user.updatePassword({ currentPassword, newPassword, signOutOfOtherSessions: false });
      toast({ title: "Senha alterada com sucesso" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Erro ao alterar senha";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3 mt-4">
      <div className="flex items-center gap-2">
        <Lock className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Alterar Senha</h3>
      </div>
      {user?.passwordEnabled === false ? (
        <p className="text-xs text-muted-foreground">
          Sua conta usa login pelo Google — não é necessário definir uma senha.
        </p>
      ) : (
        <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
          <div className="space-y-1">
            <Label htmlFor="currentPassword" className="text-xs">Senha Atual</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="newPassword" className="text-xs">Nova Senha</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirmPassword" className="text-xs">Confirmar Nova Senha</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <Button type="submit" size="sm" disabled={isLoading}>
            {isLoading && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
            Alterar Senha
          </Button>
        </form>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Backup de dados" — full-agency JSON export. Visible only to agency admins/superadmin. */
function BackupDataSection() {
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const canManage = me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.SUPER_ADMIN;
  const [isExporting, setIsExporting] = useState(false);
  const [lastExportSize, setLastExportSize] = useState<number | null>(null);

  if (!canManage) return null;

  async function handleExport() {
    setIsExporting(true);
    setLastExportSize(null);
    try {
      const res = await fetch("/api/backup/export", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string; message?: string }).message ?? (err as { error?: string }).error ?? "Erro ao gerar backup");
      }
      const blob = await validateBackupDownload(await res.blob(), res.headers.get("Content-Type"));
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "backup.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setLastExportSize(blob.size);
      toast({ title: "Backup gerado com sucesso!" });
    } catch (err) {
      toast({ title: "Erro ao gerar backup", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3 mt-4">
      <div className="flex items-center gap-2">
        <DatabaseBackup className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Backup de Dados</h3>
      </div>
      <p className="text-xs text-muted-foreground max-w-md">
        Baixe um arquivo JSON com todos os dados da sua agência: configurações, usuários, clientes
        (com notas, conquistas, destinos dos sonhos, favoritos e pontuação), fornecedores,
        hospedagens, destinos, veículos, viagens (com layouts de veículo, locais de embarque,
        custos, mídias e check-ins), reservas com passageiros e parcelas, documentos, modelos de
        mensagem, automações e campanhas, calendário, comissões, funil de vendas, fidelidade, clube
        de vantagens, indicações, pesquisas de satisfação (NPS), convites de equipe pendentes, loja
        (categorias, produtos, cupons, páginas, avaliações, pedidos e alertas de preço), catálogo de
        marketing (categorias, produtos e pedidos), parceiros de marketplace (com produtos e
        comissões), acertos financeiros, cupons da agência, metas de vendas e financeiro (pagamentos
        e despesas). Credenciais de autenticação e segredos de pagamento nunca são incluídos.
      </p>
      <div className="flex items-center gap-3">
        <Button onClick={handleExport} disabled={isExporting} size="sm" variant="outline">
          {isExporting ? (
            <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Gerando backup...</>
          ) : (
            <><DatabaseBackup className="w-3 h-3 mr-2" />Baixar backup (.json)</>
          )}
        </Button>
        {lastExportSize != null && (
          <span className="text-xs text-muted-foreground">Arquivo gerado: {formatBytes(lastExportSize)}</span>
        )}
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
  const [prefixError, setPrefixError] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const handleUploadingChange = useCallback((uploading: boolean) => {
    setUploadingCount((n) => Math.max(0, n + (uploading ? 1 : -1)));
  }, []);

  useEffect(() => {
    if (fullTenant) {
      setForm({
        name: fullTenant.name,
        logoUrl: fullTenant.logoUrl ?? "",
        primaryColor: fullTenant.primaryColor ?? "#3B82F6",
        secondaryColor: fullTenant.secondaryColor ?? "#8B5CF6",
        whatsapp: fullTenant.whatsapp ?? "",
        phone: fullTenant.phone ?? "",
        website: fullTenant.website ?? "",
        reservationPrefix: fullTenant.reservationPrefix ?? "",
      });
    } else if (me?.tenant) {
      setForm((f) => ({
        ...f,
        name: me.tenant!.name,
        logoUrl: me.tenant!.logoUrl ?? "",
        primaryColor: me.tenant!.primaryColor ?? "#3B82F6",
        secondaryColor: me.tenant!.secondaryColor ?? "#8B5CF6",
      }));
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
    <div className="space-y-4 max-w-xl">
      <div className="space-y-1">
        <Label>Nome da Agência</Label>
        <Input
          value={form.name ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label>Logo</Label>
        <CoverImageUpload
          fileSizeMB="2"
          value={form.logoUrl ?? ""}
          onChange={(url) => setForm((f) => ({ ...f, logoUrl: url }))}
          onUploadingChange={handleUploadingChange}
          emptyLabel="Clique ou arraste o logo aqui"
          previewClassName="h-32"
          objectFit="contain"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>WhatsApp</Label>
          <Input
            value={form.whatsapp ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))}
            placeholder="+55 (11) 99999-9999"
          />
        </div>
        <div className="space-y-1">
          <Label>Telefone</Label>
          <Input
            value={form.phone ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Website</Label>
        <Input
          value={form.website ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
          placeholder="https://suaagencia.com.br"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>Cor Primária</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.primaryColor ?? "#3B82F6"}
              onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
              className="h-9 w-14 cursor-pointer rounded border"
            />
            <Input
              value={form.primaryColor ?? "#3B82F6"}
              onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
              className="font-mono"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Cor Secundária</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.secondaryColor ?? "#8B5CF6"}
              onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))}
              className="h-9 w-14 cursor-pointer rounded border"
            />
            <Input
              value={form.secondaryColor ?? "#8B5CF6"}
              onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))}
              className="font-mono"
            />
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label>Prefixo de Identificação</Label>
          {fullTenant?.prefixLocked && (
            <Badge variant="secondary" className="text-xs gap-1">
              <Lock className="w-3 h-3" />
              Fixado
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {fullTenant?.prefixLocked ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted font-mono text-sm w-36">
                  <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span>{fullTenant.reservationPrefix || "—"}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Configurado permanentemente — não pode ser alterado.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Input
                  value={form.reservationPrefix ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 5);
                    setForm((f) => ({ ...f, reservationPrefix: v }));
                    setPrefixError(null);
                  }}
                  placeholder="Ex: CHQ, AGT..."
                  className={`font-mono w-36 ${prefixError ? "border-destructive" : ""}`}
                  maxLength={5}
                />
                <span className="text-xs text-muted-foreground">1–5 letras. Será fixado permanentemente ao salvar.</span>
              </div>
              {prefixError && (
                <p className="text-xs text-destructive">{prefixError}</p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Usado nos códigos de reservas e nos códigos de registro de clientes.</p>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {(() => {
              const now = new Date();
              const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
              const prefix = (fullTenant?.prefixLocked ? fullTenant.reservationPrefix : form.reservationPrefix) || "CLI";
              return (
                <>
                  <p>Reservas: <span className="font-mono font-semibold text-foreground">{prefix}-EXC-{yyyymm}-00001</span></p>
                  <p>Código de cliente: <span className="font-mono font-semibold text-foreground">{prefix}-{yyyymm}-00043</span></p>
                </>
              );
            })()}
          </div>
        </div>
      </div>
      <Button onClick={handleSave} disabled={updateTenant.isPending || uploadingCount > 0}>
        {uploadingCount > 0 ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Aguardando upload...</>
        ) : updateTenant.isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</>
        ) : "Salvar Perfil"}
      </Button>

      <SalesGoalSection />
      <ChangePasswordSection />
      <BackupDataSection />
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
            <div className="grid grid-cols-3 gap-4">
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
          <div className={`grid gap-4 ${visiblePlans.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
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
  label: string;
  name: string;
  config: Record<string, string>;
  maskedSecrets: Record<string, string | null>;
  environment: "production" | "test";
  enabled: boolean;
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

function IntegrationCard({ type }: { type: string }) {
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const canManage = me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.SUPER_ADMIN;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [data, setData] = useState<IntegrationData | null>(null);
  const [formConfig, setFormConfig] = useState<Record<string, string>>({});
  const [formSecrets, setFormSecrets] = useState<Record<string, string>>({});
  const [cardName, setCardName] = useState("");
  const [environment, setEnvironment] = useState<"production" | "test">("production");
  const [enabled, setEnabled] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [logs, setLogs] = useState<IntegrationLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/integrations/${type}`, { credentials: "include" });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      const d: IntegrationData = await res.json();
      setData(d);
      setFormConfig(d.config);
      setFormSecrets({});
      setCardName(d.name);
      setEnvironment(d.environment);
      setEnabled(d.enabled);
      setDirty(false);
    } catch {
      // silent — card stays in default state
    } finally {
      setLoading(false);
    }
  }, [type]);

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
        body: JSON.stringify({ config: formConfig, secrets: formSecrets }),
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
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao salvar");
      }
      toast({ title: "Integração salva com sucesso" });
      setFormSecrets({});
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
      const res = await fetch(`${BASE}/api/integrations/${type}/revoke`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erro ao revogar");
      toast({ title: "Credenciais revogadas com sucesso" });
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
            <Wifi className="w-4 h-4 text-muted-foreground" />
            {data?.label ?? type}
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
            Cada envio registra E-mail e WhatsApp como entregas independentes da mesma mensagem.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <div><p className="font-medium">Consentimento</p><p className="text-muted-foreground">Opt-out por canal é respeitado antes do envio.</p></div>
          <div><p className="font-medium">Disponibilidade</p><p className="text-muted-foreground">Contato ausente aparece como “ignorado” no histórico, sem tentativa artificial.</p></div>
          <div><p className="font-medium">Integração responsável</p><p className="text-muted-foreground">E-mail usa Resend e WhatsApp usa a integração configurada abaixo. Nenhum segredo é exibido.</p></div>
        </CardContent>
      </Card>
      <GoogleCalendarCard />
      <AICard />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <IntegrationCard type="whatsapp_evolution" />
        <IntegrationCard type="stripe_account" />
        <IntegrationCard type="mercadopago" />
        <IntegrationCard type="google_analytics" />
        <IntegrationCard type="distribution_reference" />
      </div>
      <DistributionHealthCard />
    </div>
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

  const loadConfig = useCallback(async () => {
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
      // silent — card stays in default state
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
          />
        </div>
        {npsAutoSend && (
          <div className="flex items-center gap-3">
            <Label className="text-sm whitespace-nowrap">Horas após o retorno</Label>
            <Input
              type="number"
              min={1}
              max={720}
              value={npsHoursInput}
              onChange={(e) => setNpsHoursInput(Number(e.target.value))}
              className="w-24"
            />
            <Button size="sm" variant="outline" onClick={handleNpsHoursSave}>
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

  const BASE = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE_URL ?? "";

  useEffect(() => {
    fetch(`${BASE}/api/whatsapp-notifications/settings`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setSettings(data); })
      .catch(() => {});
  }, [BASE]);

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

      {TYPES.map((t) => (
        <div key={t.key} className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
          <div className="flex items-center justify-between">
            <Label className="cursor-pointer text-sm font-medium">{t.label}</Label>
            <Switch
              checked={settings[t.key] ?? false}
              onCheckedChange={(v) => update({ [t.key]: v })}
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
                >
                  Usar mensagem padrão
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      <Button size="sm" onClick={handleSave} disabled={saving || !dirty} className="w-full">
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
  const [uploadingCount, setUploadingCount] = useState(0);
  const handleUploadingChange = useCallback((uploading: boolean) => {
    setUploadingCount((n) => Math.max(0, n + (uploading ? 1 : -1)));
  }, []);

  const [storeLogo, setStoreLogo] = useState("");
  const [storeLogoUploading, setStoreLogoUploading] = useState(false);
  const [storeLogoSaving, setStoreLogoSaving] = useState(false);
  const [pixQrDeliveryMode, setPixQrDeliveryMode] = useState<"screen" | "email" | "whatsapp" | "all">("screen");
  const [pixQrDeliverySaving, setPixQrDeliverySaving] = useState(false);
  const [hasStore, setHasStore] = useState(false);

  useEffect(() => {
    if (fullTenant) {
      setPrimaryColor(fullTenant.primaryColor ?? "#3B82F6");
      setSecondaryColor(fullTenant.secondaryColor ?? "#8B5CF6");
      setLogoUrl(fullTenant.logoUrl ?? "");
    }
  }, [fullTenant?.id]);

  useEffect(() => {
    storeApi.getSettings()
      .then((s) => {
        setStoreLogo(s.logo ?? "");
        setPixQrDeliveryMode(s.pixQrDeliveryMode ?? "screen");
        setHasStore(true);
      })
      .catch(() => {
        setHasStore(false);
      });
  }, []);

  async function handleSave() {
    if (!tenantId) {
      toast({ title: "Não foi possível identificar a agência", variant: "destructive" });
      return;
    }
    try {
      await updateTenant.mutateAsync({ id: tenantId, data: { primaryColor, secondaryColor, logoUrl } });
      toast({ title: "Personalização salva com sucesso" });
      await queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
      refetchMe();
    } catch {
      toast({ title: "Erro ao salvar personalização", variant: "destructive" });
    }
  }

  async function handleSaveStoreLogo() {
    setStoreLogoSaving(true);
    try {
      await storeApi.updateSettings({ logo: storeLogo });
      toast({ title: "Logo da loja salvo com sucesso" });
    } catch {
      toast({ title: "Erro ao salvar logo da loja", variant: "destructive" });
    } finally {
      setStoreLogoSaving(false);
    }
  }

  async function handleSavePixQrDelivery() {
    setPixQrDeliverySaving(true);
    try {
      await storeApi.updateSettings({ pixQrDeliveryMode });
      toast({ title: "Preferência de entrega do PIX salva" });
    } catch {
      toast({ title: "Erro ao salvar a preferência do PIX", variant: "destructive" });
    } finally {
      setPixQrDeliverySaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="space-y-4">
        <h3 className="font-semibold text-sm">Cores do sistema</h3>
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

      {hasStore && (
        <div className="border-t pt-6 space-y-2">
          <h3 className="font-semibold text-sm">Logo da Loja (Vitrine)</h3>
          <p className="text-xs text-muted-foreground">
            Exibido na vitrine pública, nos vouchers emitidos e no QR code de confirmação de pedidos.
          </p>
          <CoverImageUpload
            fileSizeMB="2"
            value={storeLogo}
            onChange={setStoreLogo}
            onUploadingChange={(uploading) => setStoreLogoUploading(uploading)}
            emptyLabel="Clique ou arraste o logo da loja aqui"
            previewClassName="h-32"
            objectFit="contain"
          />
          <p className="text-xs text-muted-foreground">
            Recomendado: PNG com fundo transparente, tamanho mínimo 200x60px
          </p>
          <Button
            onClick={handleSaveStoreLogo}
            disabled={storeLogoSaving || storeLogoUploading}
            variant="outline"
          >
            {storeLogoUploading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Aguardando upload...</>
            ) : storeLogoSaving ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</>
            ) : "Salvar logo da loja"}
          </Button>

          <div className="border-t pt-5 mt-5 space-y-3">
            <div>
              <h3 className="font-semibold text-sm">Entrega do QR Code PIX</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Escolha onde o cliente receberá o QR Code gerado no checkout. O código também fica
                disponível na confirmação e na consulta do pedido quando a opção de tela estiver ativa.
              </p>
            </div>
            <select
              value={pixQrDeliveryMode}
              onChange={(event) => setPixQrDeliveryMode(event.target.value as typeof pixQrDeliveryMode)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="screen">Somente na tela</option>
              <option value="email">E-mail</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="all">Tela, e-mail e WhatsApp</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Para e-mail e WhatsApp, os respectivos dados de contato precisam estar preenchidos e
              configurados para envio.
            </p>
            <Button
              onClick={handleSavePixQrDelivery}
              disabled={pixQrDeliverySaving}
              variant="outline"
            >
              {pixQrDeliverySaving ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</>
              ) : "Salvar entrega do QR Code"}
            </Button>
          </div>
        </div>
      )}
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
  const inviteRole = "vendedor" as const;
  const [inviting, setInviting] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);

  async function loadTeam() {
    setLoading(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch(`${BASE}/api/team/members`, { credentials: "include" }),
        fetch(`${BASE}/api/team/invites`, { credentials: "include" }),
      ]);
      if (membersRes.ok) {
        const all: TeamMember[] = await membersRes.json();
        setMembers(all.filter((m) => m.role === "vendedor"));
      }
      if (invitesRes.ok) {
        const all: PendingInvite[] = await invitesRes.json();
        setInvites(all.filter((i) => !i.accepted && i.role === "vendedor"));
      }
    } catch {
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
      await fetch(`${BASE}/api/team/members/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      toast({ title: "Membro desativado" });
      loadTeam();
    } catch {
      toast({ title: "Erro ao remover membro", variant: "destructive" });
    }
  }

  async function handleCancelInvite(id: string) {
    try {
      await fetch(`${BASE}/api/team/invites/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      toast({ title: "Convite cancelado" });
      loadTeam();
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
  const [keys] = useState([
    { id: "1", name: "Produção", key: "••••••••••••••••••••", createdAt: "2024-01-15", lastUsed: "Hoje" },
    { id: "2", name: "Desenvolvimento", key: "••••••••••••••••••••", createdAt: "2024-02-20", lastUsed: "Ontem" },
  ]);
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  function toggleVisible(id: string) {
    setVisible((v) => ({ ...v, [id]: !v[id] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Use chaves de API para integrar o VisiteCRM com sistemas externos.
        </p>
        <Button variant="outline">
          <Key className="w-4 h-4 mr-2" />
          Gerar nova chave
        </Button>
      </div>

      <div className="rounded-md border bg-background divide-y">
        {keys.map((k) => (
          <div key={k.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{k.name}</p>
                <p className="text-xs text-muted-foreground">
                  Criado em {k.createdAt} · Último uso: {k.lastUsed}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => toggleVisible(k.id)}>
                  {visible[k.id] ? "Ocultar" : "Mostrar"}
                </Button>
                <Button variant="outline" size="sm" className="text-destructive">
                  Revogar
                </Button>
              </div>
            </div>
            {visible[k.id] && (
              <div className="font-mono text-xs bg-muted rounded p-2 break-all">{k.key}</div>
            )}
          </div>
        ))}
      </div>
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

function ClubConfigTab() {
  const { toast } = useToast();
  const [clubName, setClubName] = useState("Clube Visite");
  const [clubDescription, setClubDescription] = useState("");
  const [benefits, setBenefits] = useState<ClubBenefitAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [activeTier, setActiveTier] = useState<string>("bronze");
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [addingBenefit, setAddingBenefit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [cfgRes, bnfRes] = await Promise.all([
          fetch(`${BASE}/api/club/config`, { credentials: "include" }),
          fetch(`${BASE}/api/club/benefits`, { credentials: "include" }),
        ]);
        const cfg = await cfgRes.json() as { clubName: string; description: string | null };
        const bnf = await bnfRes.json() as { data: ClubBenefitAdmin[] };
        setClubName(cfg.clubName ?? "Clube Visite");
        setClubDescription(cfg.description ?? "");
        setBenefits(bnf.data ?? []);
      } catch {
        toast({ title: "Erro ao carregar configurações do clube", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function handleSaveConfig() {
    setSavingConfig(true);
    try {
      await fetch(`${BASE}/api/club/config`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubName, description: clubDescription || null }),
      });
      toast({ title: "Configurações do clube salvas!" });
    } catch {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleAddBenefit() {
    if (!newLabel.trim()) return;
    setAddingBenefit(true);
    try {
      const res = await fetch(`${BASE}/api/club/benefits`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: activeTier,
          benefitKey: newLabel.toLowerCase().replace(/\s+/g, "_").slice(0, 100),
          label: newLabel.trim(),
          description: newDescription.trim() || null,
          value: newValue.trim() || null,
          sortOrder: benefits.filter((b) => b.tier === activeTier).length,
        }),
      });
      const data = await res.json() as { id: string };
      setBenefits((prev) => [
        ...prev,
        {
          id: data.id,
          tier: activeTier,
          benefitKey: newLabel.toLowerCase().replace(/\s+/g, "_").slice(0, 100),
          label: newLabel.trim(),
          description: newDescription.trim() || null,
          value: newValue.trim() || null,
          sortOrder: prev.filter((b) => b.tier === activeTier).length,
        },
      ]);
      setNewLabel("");
      setNewValue("");
      setNewDescription("");
      toast({ title: "Benefício adicionado!" });
    } catch {
      toast({ title: "Erro ao adicionar benefício", variant: "destructive" });
    } finally {
      setAddingBenefit(false);
    }
  }

  async function handleDeleteBenefit(id: string) {
    setDeletingId(id);
    try {
      await fetch(`${BASE}/api/club/benefits/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      setBenefits((prev) => prev.filter((b) => b.id !== id));
      toast({ title: "Benefício removido" });
    } catch {
      toast({ title: "Erro ao remover benefício", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  const tierBenefits = benefits.filter((b) => b.tier === activeTier);

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Carregando configurações do clube...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Crown className="w-4 h-4 text-amber-500" />
          Identidade do Clube
        </h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nome do Clube</Label>
            <Input
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              placeholder="Ex: Clube Visite Cariri"
              maxLength={100}
            />
          </div>
          <div className="space-y-1">
            <Label>Descrição <span className="text-xs text-muted-foreground">(opcional)</span></Label>
            <Input
              value={clubDescription}
              onChange={(e) => setClubDescription(e.target.value)}
              placeholder="Uma frase sobre o clube para os clientes"
              maxLength={500}
            />
          </div>
          <Button size="sm" onClick={handleSaveConfig} disabled={savingConfig}>
            {savingConfig ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Salvando...</> : "Salvar"}
          </Button>
        </div>
      </div>

      <div className="border-t pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500" />
            Benefícios por Nível
          </h3>
          <Button size="sm" variant="outline" asChild>
            <a href="/embaixadores" className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Ver Ranking de Embaixadores
            </a>
          </Button>
        </div>

        <Tabs value={activeTier} onValueChange={setActiveTier}>
          <TabsList>
            {CLUB_TIERS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1">
                <span>{t.icon}</span>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {CLUB_TIERS.map((t) => (
            <TabsContent key={t.value} value={t.value} className="space-y-3 mt-4">
              {tierBenefits.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum benefício cadastrado para {t.label} ainda.
                </p>
              ) : (
                <div className="space-y-2">
                  {tierBenefits.map((b) => (
                    <div key={b.id} className="flex items-start gap-3 p-3 border rounded-lg bg-card">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{b.label}</span>
                          {b.value && <Badge variant="outline" className="text-xs">{b.value}</Badge>}
                        </div>
                        {b.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{b.description}</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive h-7 w-7 p-0 shrink-0"
                        onClick={() => handleDeleteBenefit(b.id)}
                        disabled={deletingId === b.id}
                      >
                        {deletingId === b.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <p className="text-xs font-medium text-muted-foreground">Adicionar benefício para {t.label}</p>
                <Input
                  placeholder="Ex: 5% de desconto em todas as viagens"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  className="text-sm"
                  maxLength={200}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Valor (ex: 5%)"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    className="text-sm"
                    maxLength={200}
                  />
                  <Input
                    placeholder="Descrição (opcional)"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    className="text-sm"
                    maxLength={500}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleAddBenefit}
                  disabled={addingBenefit || !newLabel.trim()}
                >
                  {addingBenefit ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : null}
                  + Adicionar
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
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
    } finally { setLoadingAction(null); }
  }

  async function renamePipeline(id: string) {
    if (!renameValue.trim()) return;
    setLoadingAction(`rename-${id}`);
    try {
      await fetch(`${BASE}/api/pipelines/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      setRenamingPipelineId(null);
      await refetchPipelines();
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
    } finally { setLoadingAction(null); }
  }

  async function deletePipeline(id: string) {
    setLoadingAction(`delete-${id}`);
    try {
      const r = await fetch(`${BASE}/api/pipelines/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ title: "Erro", description: d.message, variant: "destructive" }); return; }
      if (activePipeline?.id === id) setActivePipelineId(null);
      await refetchPipelines();
    } finally { setLoadingAction(null); }
  }

  async function addStage() {
    if (!newStageName.trim() || !activePipeline) return;
    setLoadingAction("add-stage");
    try {
      await fetch(`${BASE}/api/pipeline/stages?pipelineId=${activePipeline.id}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newStageName.trim(), color: newStageColor }),
      });
      setNewStageName("");
      await refetchStages();
    } finally { setLoadingAction(null); }
  }

  async function renameStage(stageId: string) {
    if (!editingStageValue.trim()) return;
    setLoadingAction(`rename-stage-${stageId}`);
    try {
      await fetch(`${BASE}/api/pipeline/stages/${stageId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingStageValue.trim() }),
      });
      setEditingStageId(null);
      await refetchStages();
    } finally { setLoadingAction(null); }
  }

  async function deleteStage(stageId: string) {
    setLoadingAction(`delete-stage-${stageId}`);
    try {
      const r = await fetch(`${BASE}/api/pipeline/stages/${stageId}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ title: "Erro", description: d.message, variant: "destructive" }); return; }
      await refetchStages();
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

/* ──────────────────── Backup de Dados Tab ──────────────────── */
function formatBackupBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseBackupFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return match?.[1] ?? null;
}

interface BackupImportGroupResult {
  created: number;
  duplicate: number;
  skipped: number;
  errors: Array<{ sourceId?: string; label?: string; error: string }>;
}

interface BackupImportUserMatch {
  sourceId: string;
  email: string | null;
  name: string | null;
}

interface BackupImportReport {
  agencia: { updated: boolean };
  usuarios: { matched: number; fallbackToImporter: number; fallbackDetails: BackupImportUserMatch[] };
  clientes: BackupImportGroupResult;
  viagens: BackupImportGroupResult;
  reservas: BackupImportGroupResult;
  passageiros: BackupImportGroupResult;
  embarqueLocais: BackupImportGroupResult;
  checkins: BackupImportGroupResult;
  automacoes: BackupImportGroupResult;
  automacaoAcoes: BackupImportGroupResult;
  automacaoLogs: BackupImportGroupResult;
  indicacoes: BackupImportGroupResult;
  lojaProdutos: BackupImportGroupResult;
  lojaCupons: BackupImportGroupResult;
  lojaPedidos: BackupImportGroupResult;
  lojaItensPedido: BackupImportGroupResult;
  pagamentos: BackupImportGroupResult;
  despesas: BackupImportGroupResult;
}

const BACKUP_IMPORT_GROUP_LABELS: Record<keyof Omit<BackupImportReport, "agencia" | "usuarios">, string> = {
  clientes: "Clientes",
  viagens: "Viagens",
  reservas: "Reservas",
  passageiros: "Passageiros",
  embarqueLocais: "Locais de embarque",
  checkins: "Check-ins",
  automacoes: "Automações",
  automacaoAcoes: "Ações de automação",
  automacaoLogs: "Logs de automação",
  indicacoes: "Indicações",
  lojaProdutos: "Produtos da loja",
  lojaCupons: "Cupons da loja",
  lojaPedidos: "Pedidos da loja",
  lojaItensPedido: "Itens de pedido da loja",
  pagamentos: "Pagamentos",
  despesas: "Despesas",
};

function BackupImportReportView({ report }: { report: BackupImportReport }) {
  const groupKeys = Object.keys(BACKUP_IMPORT_GROUP_LABELS) as Array<keyof typeof BACKUP_IMPORT_GROUP_LABELS>;
  const totalErrors = groupKeys.reduce((acc, key) => acc + report[key].errors.length, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          Agência
        </div>
        <p className="text-muted-foreground mt-1">
          {report.agencia.updated
            ? "Configurações e marca da agência atualizadas com os dados do backup."
            : "Nenhum dado de agência encontrado para atualizar."}
        </p>
      </div>

      <div className="rounded-lg border p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Users className="w-4 h-4 text-muted-foreground" />
          Usuários (referência)
        </div>
        <p className="text-muted-foreground mt-1">
          {report.usuarios.matched} associados por e-mail a contas existentes
          {report.usuarios.fallbackToImporter > 0 && (
            <> · {report.usuarios.fallbackToImporter} sem conta correspondente (associados a você)</>
          )}
          .
        </p>
        {report.usuarios.fallbackDetails.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground list-disc list-inside">
            {report.usuarios.fallbackDetails.slice(0, 10).map((u, i) => (
              <li key={u.sourceId ?? i}>{u.name ?? "Sem nome"} {u.email ? `(${u.email})` : ""}</li>
            ))}
            {report.usuarios.fallbackDetails.length > 10 && (
              <li>e mais {report.usuarios.fallbackDetails.length - 10}...</li>
            )}
          </ul>
        )}
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left font-medium px-3 py-2">Tipo de registro</th>
              <th className="text-right font-medium px-3 py-2">Criados</th>
              <th className="text-right font-medium px-3 py-2">Já existiam</th>
              <th className="text-right font-medium px-3 py-2">Ignorados</th>
              <th className="text-right font-medium px-3 py-2">Erros</th>
            </tr>
          </thead>
          <tbody>
            {groupKeys.map((key) => {
              const g = report[key];
              const hasErrors = g.errors.length > 0;
              return (
                <tr key={key} className="border-t">
                  <td className="px-3 py-2">{BACKUP_IMPORT_GROUP_LABELS[key]}</td>
                  <td className="text-right px-3 py-2">{g.created}</td>
                  <td className="text-right px-3 py-2">{g.duplicate}</td>
                  <td className="text-right px-3 py-2">{g.skipped}</td>
                  <td className={`text-right px-3 py-2 ${hasErrors ? "text-destructive font-medium" : ""}`}>{g.errors.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalErrors > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-1">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="w-4 h-4" />
            Detalhes dos erros
          </div>
          <ul className="text-xs text-muted-foreground space-y-0.5 max-h-48 overflow-y-auto">
            {groupKeys.flatMap((key) =>
              report[key].errors.slice(0, 20).map((e, i) => (
                <li key={`${key}-${i}`}>
                  <span className="font-medium">{BACKUP_IMPORT_GROUP_LABELS[key]}:</span> {e.error}
                </li>
              )),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function BackupDataTab() {
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const [isGenerating, setIsGenerating] = useState(false);
  const [receivedBytes, setReceivedBytes] = useState(0);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedBackup, setParsedBackup] = useState<ParsedBackup | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState<BackupImportReport | null>(null);
  const [importIdempotencyKey, setImportIdempotencyKey] = useState<string | null>(null);

  async function handleGenerateBackup() {
    setIsGenerating(true);
    setReceivedBytes(0);
    try {
      const response = await fetch(`${BASE}/api/backup/export`, {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as
          | { error?: string; message?: string }
          | null;
        throw new Error(payload?.message ?? payload?.error ?? "Não foi possível gerar o backup.");
      }
      if (!response.body) {
        // Fallback for environments without streaming response support.
        const blob = await validateBackupDownload(await response.blob(), response.headers.get("Content-Type"));
        downloadBackupBlob(blob, response.headers.get("Content-Disposition"));
        setReceivedBytes(blob.size);
        toast({ title: "Backup gerado com sucesso", description: "O download do arquivo foi iniciado." });
        return;
      }

      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value as BlobPart);
          total += value.byteLength;
          setReceivedBytes(total);
        }
      }
      const blob = await validateBackupDownload(
        new Blob(chunks, { type: "application/json" }),
        response.headers.get("Content-Type"),
      );
      downloadBackupBlob(blob, response.headers.get("Content-Disposition"));
      toast({ title: "Backup gerado com sucesso", description: "O download do arquivo foi iniciado." });
    } catch (err) {
      toast({
        title: "Erro ao gerar backup",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    setImportReport(null);
    setParseError(null);
    setSelectedFile(null);
    setParsedBackup(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      setParseError("Selecione um arquivo .json gerado pela exportação de backup.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const parsed = parseBackupText(text);
        setSelectedFile(file);
        setParsedBackup(parsed);
        setConfirmOpen(true);
      } catch (error) {
        setParseError(error instanceof Error ? error.message : "Não foi possível validar o arquivo selecionado.");
      }
    };
    reader.onerror = () => setParseError("Não foi possível ler o arquivo selecionado.");
    reader.readAsText(file);
  }

  async function handleConfirmImport() {
    if (!parsedBackup) return;
    setConfirmOpen(false);
    setIsImporting(true);
    setImportReport(null);
    try {
      const idempotencyKey = importIdempotencyKey ?? crypto.randomUUID();
      setImportIdempotencyKey(idempotencyKey);
      const response = await fetch(`${BASE}/api/backup/import`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey, backup: parsedBackup }),
      });
      const payload = await response.json().catch(() => null) as
        | { report?: BackupImportReport; replayed?: boolean; message?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? payload?.error ?? "Não foi possível restaurar o backup.");
      }
      if (!payload?.report) {
        throw new Error("Resposta inesperada do servidor.");
      }
      setImportReport(payload.report);
      setImportIdempotencyKey(null);
      setSelectedFile(null);
      setParsedBackup(null);
      toast({
        title: payload.replayed ? "Backup já havia sido restaurado" : "Backup restaurado com sucesso",
        description: "Veja o relatório abaixo para os detalhes por tipo de registro.",
      });
    } catch (err) {
      toast({
        title: "Erro ao restaurar backup",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  }

  function downloadBackupBlob(blob: Blob, contentDisposition: string | null) {
    const filename = parseBackupFilename(contentDisposition) ?? `backup-agencia-${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
        <DatabaseBackup className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
        <div className="text-sm text-muted-foreground">
          Gere um arquivo .json com todos os dados da sua agência: clientes, viagens, reservas e
          passageiros, embarque e check-in, automações, indicações, loja, cupons, pagamentos,
          despesas e cadastros auxiliares. Nenhuma credencial de acesso é incluída no arquivo.
          Guarde-o em um local seguro — ele contém dados pessoais dos seus clientes.
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleGenerateBackup} disabled={isGenerating} className="gap-2">
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {isGenerating ? "Gerando backup..." : "Gerar e baixar backup"}
        </Button>
        {isGenerating && (
          <span className="text-sm text-muted-foreground">
            {receivedBytes > 0
              ? `Montando arquivo... ${formatBackupBytes(receivedBytes)} recebidos`
              : "Preparando exportação..."}
          </span>
        )}
      </div>

      {isGenerating && (
        <p className="text-xs text-muted-foreground">
          Para agências com muitos dados, isso pode levar alguns minutos. Não feche esta página
          enquanto o backup estiver sendo gerado.
        </p>
      )}

      <div className="border-t pt-4 space-y-3">
        <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
          <Upload className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="text-sm text-muted-foreground">
            Envie um arquivo .json gerado por esta exportação para restaurar os dados na sua
            agência. Usuários não são recriados — registros são associados a contas existentes
            pelo e-mail, ou a você quando não houver correspondência. Registros já existentes não
            são duplicados em uma nova tentativa.
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" asChild disabled={isImporting} className="gap-2 cursor-pointer">
            <label>
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileJson className="w-4 h-4" />}
              {isImporting ? "Restaurando backup..." : "Selecionar arquivo de backup (.json)"}
              <input type="file" accept=".json,application/json" className="hidden" disabled={isImporting} onChange={handleFileSelected} />
            </label>
          </Button>
        </div>

        {parseError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="w-4 h-4 shrink-0" />
            {parseError}
          </div>
        )}

        {importReport && (
          <div className="pt-2">
            <h3 className="text-sm font-medium mb-2">Relatório da restauração</h3>
            <BackupImportReportView report={importReport} />
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open) setConfirmOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar dados deste backup?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block mb-2">
                <strong>Origem:</strong>{" "}
                {String((parsedBackup?.tenant as { name?: string; slug?: string } | undefined)?.name
                  ?? (parsedBackup?.tenant as { slug?: string } | undefined)?.slug
                  ?? ((parsedBackup as Record<string, unknown> | null)?.meta as { tenantName?: string } | undefined)?.tenantName
                  ?? "Agência identificada no backup")}
                <br />
                <strong>Destino:</strong> {me?.tenant?.name ?? "sua agência atual"}
              </span>
              O arquivo <strong>{selectedFile?.name}</strong> será usado para recriar clientes,
              viagens, reservas, embarque/check-in, automações, indicações, loja e financeiro na
              sua agência. Registros já existentes serão identificados e ignorados — nenhum dado
              atual será removido. Esta ação não pode ser desfeita automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setSelectedFile(null); setParsedBackup(null); }}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmImport}>Restaurar backup</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ──────────────────── Main Settings Page ──────────────────── */
export default function Configuracoes() {
  const { data: me } = useGetMe();
  const isAgencyAdmin = me?.role === ROLES.AGENCY_ADMIN;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Gerencie as configurações da sua agência</p>
      </div>

      <Tabs defaultValue={new URLSearchParams(window.location.search).get("tab") ?? "agency"}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="agency" className="flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" />
            Agência
          </TabsTrigger>
          <TabsTrigger value="plan" className="flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5" />
            Plano
          </TabsTrigger>
          <TabsTrigger value="integrations" className="flex items-center gap-1.5">
            <Puzzle className="w-3.5 h-3.5" />
            Integrações
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5" />
            Notificações
          </TabsTrigger>
          <TabsTrigger value="customization" className="flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5" />
            Personalização
          </TabsTrigger>
          <TabsTrigger value="team" className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            Equipe
          </TabsTrigger>
          <TabsTrigger value="apikeys" className="flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5" />
            Chaves API
          </TabsTrigger>
          <TabsTrigger value="features" className="flex items-center gap-1.5">
            <ToggleLeft className="w-3.5 h-3.5" />
            Funcionalidades
          </TabsTrigger>
          <TabsTrigger value="clube" className="flex items-center gap-1.5">
            <Crown className="w-3.5 h-3.5" />
            Clube
          </TabsTrigger>
          <TabsTrigger value="pipelines" className="flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5" />
            Pipelines
          </TabsTrigger>
          {isAgencyAdmin && (
            <TabsTrigger value="backup" className="flex items-center gap-1.5">
              <DatabaseBackup className="w-3.5 h-3.5" />
              Backup de Dados
            </TabsTrigger>
          )}
          {isAgencyAdmin && (
            <TabsTrigger value="integrity" className="flex items-center gap-1.5" data-testid="tab-linked-data-integrity">
              <Wrench className="w-3.5 h-3.5" />
              Integridade
            </TabsTrigger>
          )}
        </TabsList>

        <div className="mt-4">
          <TabsContent value="agency">
            <Card>
              <CardHeader>
                <CardTitle>Perfil da Agência</CardTitle>
                <CardDescription>
                  Informações da agência, logotipo e cores do sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AgencyProfileTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plan">
            <Card>
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
            <Card>
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
            <Card>
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
            <Card>
              <CardHeader>
                <CardTitle>Personalização</CardTitle>
                <CardDescription>
                  Personalize cores, logotipo e aparência do sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CustomizationTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="team">
            <Card>
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
            <Card>
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
            <Card>
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
            <Card>
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
            <Card>
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

          {isAgencyAdmin && (
            <TabsContent value="backup">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DatabaseBackup className="w-4 h-4" />
                    Backup de Dados
                  </CardTitle>
                  <CardDescription>
                    Gere e baixe um backup completo dos dados da sua agência em um arquivo .json
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <BackupDataTab />
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}

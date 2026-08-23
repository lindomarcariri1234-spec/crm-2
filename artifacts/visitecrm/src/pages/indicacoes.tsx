import { useState, useEffect } from "react";
import { localToday } from "@workspace/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListReferrals,
  useUpdateReferral,
  useGetReferralStats,
  useGetReferralSettings,
  useUpdateReferralSettings,
  usePayReferralBonus,
  useResendExpiryWarning,
  useGetReferralAnalytics,
  useGetReferralShare,
  useGetReferralExpiryEmailStatus,
  useGetReferralBonusReleaseEmailStatus,
  useResendBonusRelease,
  useReverseReferralBonus,
  getReferralExportUrl,
  getReferralAnalyticsExportUrl,
  useGetMe,
  useListReferralCampaigns,
  useCreateReferralCampaign,
  useDeleteReferralCampaign,
  useUpdateReferralCampaign,
  useTestWhatsAppMessage,
  useGetCurrentSubscription,
} from "@workspace/api-client-react";
import type { Referral, ReferralSettings, ReferralTierConfig, ReferralAnalyticsPeriod, ReferralCampaign } from "@workspace/api-client-react";
import { REFERRAL_STATUS, ROLES } from "@workspace/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  DollarSign,
  TrendingUp,
  Settings,
  BarChart3,
  Check,
  Gift,
  Percent,
  Clock,
  Ban,
  Eye,
  Trophy,
  Medal,
  MessageCircle,
  Mail,
  Phone,
  Wallet,
  Star,
  ShieldAlert,
  Download,
  CheckSquare2,
  Share2,
  Copy,
  QrCode,
  Link2,
  XCircle,
  Loader2,
  FileSpreadsheet,
  FileText,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Flame,
  Pencil,
  Send,
  MousePointerClick,
} from "lucide-react";
import { ReferralAnalyticsCharts } from "@/components/referral-analytics-charts";
import { PlanFeatureWall, canUpgradeForFeature, getRequiredPlanLabel } from "@/components/plan-limit-wall";

const DEFAULT_TIERS: ReferralTierConfig[] = [
  { level: "bronze",  label: "Bronze",   minReferrals: 0,  bonusMultiplier: 1.0 },
  { level: "silver",  label: "Prata",    minReferrals: 5,  bonusMultiplier: 1.25 },
  { level: "gold",    label: "Ouro",     minReferrals: 15, bonusMultiplier: 1.5 },
  { level: "diamond", label: "Diamante", minReferrals: 30, bonusMultiplier: 2.0 },
];

const TIER_VISUAL: Record<string, { bg: string; color: string }> = {
  bronze:  { bg: "bg-amber-100",  color: "text-amber-700" },
  silver:  { bg: "bg-slate-100",  color: "text-slate-600" },
  gold:    { bg: "bg-yellow-100", color: "text-yellow-700" },
  diamond: { bg: "bg-cyan-100",   color: "text-cyan-700" },
};

function computeAdminTier(conversions: number, tiersConfig?: ReferralTierConfig[] | null): ReferralTierConfig {
  const tiers = tiersConfig && tiersConfig.length > 0
    ? [...tiersConfig].sort((a, b) => a.minReferrals - b.minReferrals)
    : DEFAULT_TIERS;
  let current = tiers[0];
  for (const t of tiers) {
    if (conversions >= t.minReferrals) current = t;
  }
  return current;
}

function ReferralTierBadge({ level, label }: { level: string; label: string }) {
  const visual = TIER_VISUAL[level] ?? { bg: "bg-gray-100", color: "text-gray-600" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${visual.bg} ${visual.color}`}>
      <Star className="w-3 h-3" />
      {label}
    </span>
  );
}

import { formatCurrencyBRL as fmtCurrency, formatDate as _formatDate, formatDateTime as _formatDateTime } from "@/lib/utils";

const fmtDate = (v: string | null | undefined) => v ? _formatDate(v) : "—";
const fmtDateTime = (v: string | null | undefined) => v ? _formatDateTime(v) : "—";

function fmtWhatsapp(w: string | null | undefined) {
  if (!w) return null;
  return w.replace(/\D/g, "");
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  [REFERRAL_STATUS.PENDING]: { label: "Pendente", variant: "secondary" },
  [REFERRAL_STATUS.COMPLETED]: { label: "Convertida", variant: "default" },
  [REFERRAL_STATUS.EXPIRED]: { label: "Expirada", variant: "destructive" },
  [REFERRAL_STATUS.CONVERTED]: { label: "Convertida", variant: "default" },
  [REFERRAL_STATUS.REVERSED]: { label: "Revertida", variant: "destructive" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

type EnrichedReferral = Referral & {
  referrerWhatsapp?: string | null;
  bonusReleasesAt?: string | null;
  bonusBlocked?: boolean;
  referrerSuccessfulReferrals?: number | null;
  reversalReason?: string | null;
  reversalAt?: string | null;
};

const ALERTS_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const REVERSAL_GAPS_PAGE_SIZE = 20;

interface ReferralReversalSkip {
  reservationId: string;
  reservationNumber: string | null;
  referralCode: string;
  referrerName: string | null;
}

interface ReferralReversalGapsResponse {
  gaps: ReferralReversalSkip[];
  total: number;
  limit: number;
  offset: number;
}

async function fetchReversalGaps(
  limit: number,
  offset: number,
): Promise<ReferralReversalGapsResponse> {
  const res = await fetch(
    `${ALERTS_BASE}/api/alerts/referral-reversal-skipped/gaps?limit=${limit}&offset=${offset}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error("Failed to fetch reversal gaps");
  return res.json();
}

export default function Indicacoes() {
  const canCopyImageToClipboard =
    typeof ClipboardItem !== "undefined" && !!navigator?.clipboard;

  const { data: subData } = useGetCurrentSubscription();
  const referralsLocked = subData !== undefined &&
    !(subData.plan?.supportedFeatures ?? []).includes("referrals");
  const referralsCanUpgrade = canUpgradeForFeature(subData, "referrals");

  const { toast } = useToast();
  const { data: referralsResponse, refetch } = useListReferrals();
  const referrals = ((referralsResponse as { data?: EnrichedReferral[] } | undefined)?.data ?? (Array.isArray(referralsResponse) ? referralsResponse as EnrichedReferral[] : [])) as EnrichedReferral[];
  const { data: stats } = useGetReferralStats();
  const { data: settings, refetch: refetchSettings } = useGetReferralSettings();
  const updateReferral = useUpdateReferral();
  const updateSettings = useUpdateReferralSettings();
  const payBonus = usePayReferralBonus();
  const resendWarning = useResendExpiryWarning();
  const resendBonus = useResendBonusRelease();
  const reverseBonus = useReverseReferralBonus();
  const testWhatsApp = useTestWhatsAppMessage();
  const { data: me } = useGetMe();
  const queryClient = useQueryClient();

  const [gapsPage, setGapsPage] = useState(0);
  const { data: gapsData } = useQuery<ReferralReversalGapsResponse>({
    queryKey: ["referral-reversal-gaps", gapsPage],
    queryFn: () =>
      fetchReversalGaps(REVERSAL_GAPS_PAGE_SIZE, gapsPage * REVERSAL_GAPS_PAGE_SIZE),
    staleTime: 60_000,
  });
  const reversalGaps = gapsData?.gaps ?? [];
  const totalGaps = gapsData?.total ?? 0;
  const gapsPageCount = Math.max(1, Math.ceil(totalGaps / REVERSAL_GAPS_PAGE_SIZE));

  // After resolving the last row on a page, step back so the user is never
  // stranded on an empty page while earlier pages still have gaps.
  useEffect(() => {
    if (gapsData && gapsData.gaps.length === 0 && gapsData.total > 0 && gapsPage > 0) {
      setGapsPage((p) => Math.max(0, p - 1));
    }
  }, [gapsData, gapsPage]);

  const [resolvingGapIds, setResolvingGapIds] = useState<Set<string>>(new Set());
  // The resolve endpoint is restricted to agency staff (superadmin can view but not act).
  const canResolveGaps =
    me?.role === ROLES.AGENCY_ADMIN ||
    me?.role === ROLES.AGENCY_MANAGER ||
    me?.role === ROLES.SALES ||
    me?.role === ROLES.SUPPORT;

  async function handleResolveGap(reservationId: string) {
    setResolvingGapIds((prev) => new Set(prev).add(reservationId));
    try {
      const res = await fetch(
        `${ALERTS_BASE}/api/alerts/referral-reversal-skipped/${encodeURIComponent(reservationId)}/resolve`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        toast({
          title: "Erro ao resolver reversão",
          description: "Não foi possível marcar a reversão como resolvida. Tente novamente.",
          variant: "destructive",
        });
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["alerts"] }),
        queryClient.invalidateQueries({ queryKey: ["referral-reversal-gaps"] }),
        refetch(),
      ]);
      toast({
        title: "Reversão resolvida",
        description: "O alerta foi baixado para esta reserva.",
      });
    } catch {
      toast({
        title: "Erro ao resolver reversão",
        description: "Falha de rede. Verifique sua conexão e tente novamente.",
        variant: "destructive",
      });
    } finally {
      setResolvingGapIds((prev) => {
        const next = new Set(prev);
        next.delete(reservationId);
        return next;
      });
    }
  }

  const [analyticsPeriod, setAnalyticsPeriod] = useState<ReferralAnalyticsPeriod>(90);
  const { data: analyticsData } = useGetReferralAnalytics(analyticsPeriod);

  const [whatsappTestPhone, setWhatsappTestPhone] = useState("");
  const [whatsappTestState, setWhatsappTestState] = useState<Record<string, { loading?: boolean; success?: boolean; error?: string }>>({});

  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedReferral, setSelectedReferral] = useState<EnrichedReferral | null>(null);
  const [payBonusDialogOpen, setPayBonusDialogOpen] = useState(false);
  const [payBonusTarget, setPayBonusTarget] = useState<EnrichedReferral | null>(null);
  const [reverseBonusDialogOpen, setReverseBonusDialogOpen] = useState(false);
  const [reverseBonusTarget, setReverseBonusTarget] = useState<EnrichedReferral | null>(null);
  const [reverseBonusReason, setReverseBonusReason] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [bonusFilter, setBonusFilter] = useState<"all" | "unpaid">("all");
  const [fraudFilter, setFraudFilter] = useState(false);
  const [bonusNotifiedFilter, setBonusNotifiedFilter] = useState<"all" | "notified" | "not_notified">("all");
  const [selectedBonusIds, setSelectedBonusIds] = useState<Set<string>>(new Set());
  const [bulkPayDialogOpen, setBulkPayDialogOpen] = useState(false);
  const [bulkPaying, setBulkPaying] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareReferralId, setShareReferralId] = useState<string | null>(null);
  const [shareReferral, setShareReferral] = useState<EnrichedReferral | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);

  const [campaignsDialogOpen, setCampaignsDialogOpen] = useState(false);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignFormData, setCampaignFormData] = useState({
    name: "", startsAt: "", endsAt: "",
    bonusType: "multiplier" as "multiplier" | "fixed_extra",
    bonusValue: "2", bannerText: "",
  });
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const { data: campaigns = [], refetch: refetchCampaigns } = useListReferralCampaigns();
  const createCampaign = useCreateReferralCampaign();
  const deleteCampaign = useDeleteReferralCampaign();
  const updateCampaign = useUpdateReferralCampaign();

  const shareQueryId = shareModalOpen ? shareReferralId : (detailModalOpen && selectedReferral ? selectedReferral.id : null);
  const { data: shareData, isLoading: shareLoading } = useGetReferralShare(shareQueryId);
  const [detailCopiedLink, setDetailCopiedLink] = useState(false);

  const expiryEmailStatusId = detailModalOpen && selectedReferral ? selectedReferral.id : null;
  const { data: expiryEmailStatus, refetch: refetchExpiryEmailStatus } = useGetReferralExpiryEmailStatus(expiryEmailStatusId);
  const { data: bonusReleaseEmailStatus, refetch: refetchBonusReleaseEmailStatus } = useGetReferralBonusReleaseEmailStatus(expiryEmailStatusId);

  const [localSettings, setLocalSettings] = useState<Partial<ReferralSettings>>({});

  function openSettings() {
    setLocalSettings({
      isEnabled: settings?.isEnabled ?? true,
      discountType: settings?.discountType ?? "percentage",
      discountValue: settings?.discountValue ?? "5.00",
      bonusType: settings?.bonusType ?? "credit",
      bonusValue: settings?.bonusValue ?? "10.00",
      expirationDays: settings?.expirationDays ?? 30,
      allowSelfReferral: settings?.allowSelfReferral ?? false,
      requireFirstPurchase: settings?.requireFirstPurchase ?? true,
      shareMessage: settings?.shareMessage ?? "",
      tiersConfig: settings?.tiersConfig ?? DEFAULT_TIERS,
      whatsappEnabled: settings?.whatsappEnabled ?? false,
      whatsappPhoneNumber: settings?.whatsappPhoneNumber ?? "",
      whatsappConvertedMessage: settings?.whatsappConvertedMessage ?? "",
      whatsappBonusPaidMessage: settings?.whatsappBonusPaidMessage ?? "",
      whatsappReversedMessage: settings?.whatsappReversedMessage ?? "",
      expiryWarning7DaysEnabled: settings?.expiryWarning7DaysEnabled ?? true,
      expiryWarning1DayEnabled: settings?.expiryWarning1DayEnabled ?? true,
      bonusReleaseEmailEnabled: settings?.bonusReleaseEmailEnabled ?? true,
      loyaltyPointsEmailEnabled: settings?.loyaltyPointsEmailEnabled ?? true,
      pointsPerReferral: settings?.pointsPerReferral ?? 0,
      gracePeriodDays: settings?.gracePeriodDays ?? 30,
      bonusValidityDays: settings?.bonusValidityDays ?? 30,
      discountExpirationDays: settings?.discountExpirationDays ?? 30,
      minPurchaseAmount: settings?.minPurchaseAmount ?? null,
      maxReferralsPerUser: settings?.maxReferralsPerUser ?? 0,
    });
    setSettingsModalOpen(true);
  }

  async function saveSettings() {
    try {
      await updateSettings.mutateAsync({
        data: {
          isEnabled: localSettings.isEnabled,
          discountType: localSettings.discountType,
          discountValue: localSettings.discountValue != null ? parseFloat(String(localSettings.discountValue)) : undefined,
          bonusType: localSettings.bonusType,
          bonusValue: localSettings.bonusValue != null ? parseFloat(String(localSettings.bonusValue)) : undefined,
          expirationDays: localSettings.expirationDays != null ? Number(localSettings.expirationDays) : undefined,
          allowSelfReferral: localSettings.allowSelfReferral,
          requireFirstPurchase: localSettings.requireFirstPurchase,
          shareMessage: localSettings.shareMessage as string | undefined,
          tiersConfig: localSettings.tiersConfig as ReferralTierConfig[] | undefined,
          whatsappEnabled: localSettings.whatsappEnabled,
          whatsappPhoneNumber: localSettings.whatsappPhoneNumber as string | undefined,
          whatsappConvertedMessage: localSettings.whatsappConvertedMessage as string | undefined,
          whatsappBonusPaidMessage: localSettings.whatsappBonusPaidMessage as string | undefined,
          whatsappReversedMessage: localSettings.whatsappReversedMessage as string | undefined,
          expiryWarning7DaysEnabled: localSettings.expiryWarning7DaysEnabled,
          expiryWarning1DayEnabled: localSettings.expiryWarning1DayEnabled,
          bonusReleaseEmailEnabled: localSettings.bonusReleaseEmailEnabled,
          loyaltyPointsEmailEnabled: localSettings.loyaltyPointsEmailEnabled,
          pointsPerReferral: localSettings.pointsPerReferral != null ? Number(localSettings.pointsPerReferral) : undefined,
          gracePeriodDays: (localSettings as Record<string, unknown>).gracePeriodDays != null ? Number((localSettings as Record<string, unknown>).gracePeriodDays) : undefined,
          bonusValidityDays: (localSettings as Record<string, unknown>).bonusValidityDays != null ? Number((localSettings as Record<string, unknown>).bonusValidityDays) : undefined,
          discountExpirationDays: (localSettings as Record<string, unknown>).discountExpirationDays != null ? Number((localSettings as Record<string, unknown>).discountExpirationDays) : undefined,
          minPurchaseAmount: (localSettings as Record<string, unknown>).minPurchaseAmount != null && String((localSettings as Record<string, unknown>).minPurchaseAmount).trim() !== "" ? parseFloat(String((localSettings as Record<string, unknown>).minPurchaseAmount)) : undefined,
          maxReferralsPerUser: (localSettings as Record<string, unknown>).maxReferralsPerUser != null ? Number((localSettings as Record<string, unknown>).maxReferralsPerUser) : undefined,
        },
      });
      toast({ title: "Configurações salvas com sucesso" });
      refetchSettings();
      setSettingsModalOpen(false);
    } catch {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    }
  }

  async function sendWhatsAppTest(type: "converted" | "bonusPaid" | "share") {
    const message = type === "converted"
      ? (localSettings.whatsappConvertedMessage as string | undefined) ?? ""
      : type === "bonusPaid"
      ? (localSettings.whatsappBonusPaidMessage as string | undefined) ?? ""
      : (localSettings.shareMessage as string | undefined) ?? "";
    if (!message.trim()) {
      toast({ title: "Preencha o texto da mensagem antes de testar", variant: "destructive" });
      return;
    }
    if (type !== "share" && !(localSettings.whatsappPhoneNumber as string | undefined)?.trim()) {
      toast({ title: "Configure o número WhatsApp da agência antes de testar", variant: "destructive" });
      return;
    }
    try {
      await testWhatsApp.mutateAsync({ body: { type, message } });
      toast({ title: "Mensagem de teste enviada!", description: "Verifique o WhatsApp configurado na agência." });
    } catch (err: unknown) {
      const apiError = (err as { data?: { error?: string } })?.data?.error;
      if (apiError === "credentials_not_configured") {
        toast({ title: "Credenciais Z-API não configuradas", description: "Configure ZAPI_INSTANCE_ID e ZAPI_TOKEN no servidor.", variant: "destructive" });
      } else if (apiError === "whatsapp_not_configured") {
        toast({ title: "Número WhatsApp não configurado", description: "Salve as configurações com um número válido primeiro.", variant: "destructive" });
      } else if (apiError === "empty_template") {
        toast({ title: "Mensagem vazia", variant: "destructive" });
      } else {
        toast({ title: "Erro ao enviar mensagem de teste", variant: "destructive" });
      }
    }
  }

  async function handleDeactivate(r: EnrichedReferral) {
    try {
      await updateReferral.mutateAsync({
        id: r.id,
        data: { isActive: false, status: "expired" },
      });
      toast({ title: "Indicação desativada" });
      refetch();
    } catch {
      toast({ title: "Erro ao desativar indicação", variant: "destructive" });
    }
  }

  function openPayBonusDialog(r: EnrichedReferral) {
    setPayBonusTarget(r);
    setPayBonusDialogOpen(true);
  }

  function openReverseBonusDialog(r: EnrichedReferral) {
    setReverseBonusTarget(r);
    setReverseBonusReason("");
    setReverseBonusDialogOpen(true);
  }

  async function confirmReverseBonus() {
    if (!reverseBonusTarget) return;
    if (!reverseBonusReason.trim()) {
      toast({ title: "Informe o motivo da reversão", variant: "destructive" });
      return;
    }
    try {
      const updated = await reverseBonus.mutateAsync({ id: reverseBonusTarget.id, body: { reason: reverseBonusReason.trim() } });
      toast({ title: "Bônus revertido com sucesso", description: "O indicador será notificado por e-mail." });
      refetch();
      setReverseBonusDialogOpen(false);
      setReverseBonusTarget(null);
      setReverseBonusReason("");
      if (selectedReferral?.id === updated.id) {
        setSelectedReferral(updated as EnrichedReferral);
      }
    } catch {
      toast({ title: "Erro ao reverter bônus", variant: "destructive" });
    }
  }

  async function confirmPayBonus() {
    if (!payBonusTarget) return;
    try {
      const updated = await payBonus.mutateAsync({ id: payBonusTarget.id });
      toast({ title: "Bônus marcado como pago! E-mail de confirmação enviado ao indicador." });
      refetch();
      setPayBonusDialogOpen(false);
      setPayBonusTarget(null);
      if (selectedReferral?.id === updated.id) {
        setSelectedReferral(updated as EnrichedReferral);
      }
    } catch {
      toast({ title: "Erro ao registrar pagamento de bônus", variant: "destructive" });
    }
  }

  function openDetail(r: EnrichedReferral) {
    setSelectedReferral(r);
    setDetailCopiedLink(false);
    setDetailModalOpen(true);
  }

  function openShare(r: EnrichedReferral) {
    setShareReferralId(r.id);
    setShareReferral(r);
    setCopiedLink(false);
    setShareModalOpen(true);
  }

  function buildWhatsAppShareUrl(phone: string, link: string, message: string, referrerName?: string | null, referralCode?: string | null, bonusAmount?: string | number | null) {
    const num = phone.replace(/\D/g, "");
    const bonusFormatted = bonusAmount != null ? fmtCurrency(bonusAmount) : "";
    const personalizedMessage = message
      .replace(/\{nome\}/g, referrerName ?? "")
      .replace(/\{codigo\}/g, referralCode ?? "")
      .replace(/\{bonus\}/g, bonusFormatted)
      .replace(/\{link\}/g, link);
    const linkAlreadyEmbedded = /\{link\}/.test(message);
    const text = personalizedMessage ? (linkAlreadyEmbedded ? personalizedMessage : `${personalizedMessage}\n${link}`) : link;
    return `https://wa.me/55${num}?text=${encodeURIComponent(text)}`;
  }

  function isValidWhatsapp(phone: string | null | undefined): phone is string {
    if (!phone) return false;
    const digits = phone.replace(/\D/g, "");
    return digits.length >= 10;
  }

  function canShareQrFile(): boolean {
    try {
      if (!navigator.canShare) return false;
      const probe = new File([""], "probe.png", { type: "image/png" });
      return navigator.canShare({ files: [probe] });
    } catch {
      return false;
    }
  }

  function buildWhatsAppQrFallbackUrl(phone: string, referralLink?: string): string {
    const num = phone.replace(/\D/g, "");
    const text = referralLink
      ? encodeURIComponent(`Seu link de indicação: ${referralLink}`)
      : "";
    return text ? `https://wa.me/55${num}?text=${text}` : `https://wa.me/55${num}`;
  }

  function downloadQrCode(dataUrl: string, code: string) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `qrcode-${code}.png`;
    a.click();
  }

  async function copyQrCodeToClipboard(dataUrl: string, code: string) {
    try {
      if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast({ title: "QR-code copiado!", description: "Imagem copiada para a área de transferência." });
      } else {
        downloadQrCode(dataUrl, code);
        toast({ title: "QR-code baixado", description: "Seu navegador não suporta cópia de imagem. O arquivo foi baixado." });
      }
    } catch {
      downloadQrCode(dataUrl, code);
      toast({ title: "QR-code baixado", description: "Não foi possível copiar a imagem. O arquivo foi baixado." });
    }
  }

  async function shareQrCodeViaWhatsApp(dataUrl: string, code: string, phone: string, referralLink?: string) {
    if (!canShareQrFile()) {
      window.open(buildWhatsAppQrFallbackUrl(phone, referralLink), "_blank", "noopener,noreferrer");
      downloadQrCode(dataUrl, code);
      toast({
        title: "QR-code baixado",
        description: "O WhatsApp foi aberto com o link de indicação. Anexe o QR-code baixado à conversa.",
      });
      return;
    }
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `qrcode-${code}.png`, { type: "image/png" });
      await navigator.share({ files: [file], title: "QR-code de indicação" });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      window.open(buildWhatsAppQrFallbackUrl(phone, referralLink), "_blank", "noopener,noreferrer");
      downloadQrCode(dataUrl, code);
      toast({
        title: "Não foi possível compartilhar a imagem",
        description: "O WhatsApp foi aberto. Baixe o QR-code e anexe manualmente.",
      });
    }
  }

  async function copyLink() {
    if (!shareData?.link) return;
    try {
      await navigator.clipboard.writeText(shareData.link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast({ title: "Não foi possível copiar o link", variant: "destructive" });
    }
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessage(true);
      setTimeout(() => setCopiedMessage(false), 2000);
    } catch {
      toast({ title: "Não foi possível copiar a mensagem", variant: "destructive" });
    }
  }

  async function handleSaveCampaign() {
    const { name, startsAt, endsAt, bonusType, bonusValue, bannerText } = campaignFormData;
    if (!name.trim() || !startsAt || !endsAt) {
      toast({ title: "Preencha todos os campos obrigatórios", variant: "destructive" }); return;
    }
    const bonusNum = parseFloat(bonusValue);
    if (isNaN(bonusNum) || bonusNum <= 0) {
      toast({ title: "Valor do bônus inválido", variant: "destructive" }); return;
    }
    try {
      if (editingCampaignId) {
        await updateCampaign.mutateAsync({
          id: editingCampaignId,
          name: name.trim(),
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          bonusType,
          bonusValue: bonusNum,
          bannerText: bannerText.trim() || null,
        });
        toast({ title: "Campanha atualizada com sucesso!" });
        setEditingCampaignId(null);
      } else {
        await createCampaign.mutateAsync({
          name: name.trim(),
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          bonusType,
          bonusValue: bonusNum,
          bannerText: bannerText.trim() || undefined,
        });
        toast({ title: "Campanha criada com sucesso!" });
      }
      setCampaignFormData({ name: "", startsAt: "", endsAt: "", bonusType: "multiplier", bonusValue: "2", bannerText: "" });
      setShowCampaignForm(false);
      refetchCampaigns();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "Erro ao criar campanha";
      toast({ title: msg, variant: "destructive" });
    }
  }

  function handleEditCampaign(c: ReferralCampaign) {
    const toLocalDatetime = (iso: string) => {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    setCampaignFormData({
      name: c.name,
      startsAt: toLocalDatetime(c.startsAt),
      endsAt: toLocalDatetime(c.endsAt),
      bonusType: c.bonusType as "multiplier" | "fixed_extra",
      bonusValue: String(c.bonusValue),
      bannerText: c.bannerText ?? "",
    });
    setEditingCampaignId(c.id);
    setShowCampaignForm(true);
  }

  async function handleDeleteCampaign(id: string) {
    try {
      await deleteCampaign.mutateAsync({ id });
      toast({ title: "Campanha excluída" });
      refetchCampaigns();
    } catch {
      toast({ title: "Erro ao excluir campanha", variant: "destructive" });
    }
  }

  function getCampaignStatus(c: ReferralCampaign): "active" | "upcoming" | "past" {
    const n = new Date();
    if (new Date(c.endsAt) < n) return "past";
    if (new Date(c.startsAt) > n) return "upcoming";
    return "active";
  }

  const activeCampaignAdmin = campaigns.find((c) => getCampaignStatus(c) === "active");

  async function confirmBulkPay() {
    setBulkPaying(true);
    let successCount = 0;
    let failCount = 0;
    for (const id of selectedBonusIds) {
      try {
        await payBonus.mutateAsync({ id });
        successCount++;
      } catch {
        failCount++;
      }
    }
    setBulkPaying(false);
    setBulkPayDialogOpen(false);
    setSelectedBonusIds(new Set());
    refetch();
    if (failCount === 0) {
      toast({ title: `${successCount} bônus ${successCount === 1 ? "marcado" : "marcados"} como pago${successCount === 1 ? "" : "s"}!` });
    } else {
      toast({ title: `${successCount} pagos, ${failCount} com erro`, variant: "destructive" });
    }
  }

  async function testWhatsappTemplate(messageType: "converted" | "bonusPaid" | "reversed" | "share") {
    const phone = whatsappTestPhone.trim();
    if (!phone) {
      toast({ title: "Informe um número de WhatsApp para teste", variant: "destructive" });
      return;
    }
    setWhatsappTestState(prev => ({ ...prev, [messageType]: { loading: true } }));
    try {
      const resp = await fetch("/api/referral-settings/whatsapp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone, messageType }),
      });
      const data = await resp.json() as { success: boolean; detail?: string; error?: string };
      if (data.success) {
        setWhatsappTestState(prev => ({ ...prev, [messageType]: { success: true } }));
      } else {
        setWhatsappTestState(prev => ({ ...prev, [messageType]: { error: data.detail ?? data.error ?? "Erro desconhecido" } }));
      }
    } catch {
      setWhatsappTestState(prev => ({ ...prev, [messageType]: { error: "Falha de conexão" } }));
    }
  }

  const suspiciousCount = referrals.filter((r) => r.fraudFlag).length;

  // Compute expiring-soon count from loaded referrals using expiresAt
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const expiringSoonCount = referrals.filter((r) => {
    if (r.status !== REFERRAL_STATUS.PENDING || !r.expiresAt) return false;
    const exp = new Date(r.expiresAt).getTime();
    return exp > now && exp <= now + sevenDaysMs;
  }).length;

  const filtered = referrals.filter((r) => {
    if (fraudFilter) return r.fraudFlag === true;
    if (statusFilter === "expiringSoon") {
      const exp = r.expiresAt ? new Date(r.expiresAt).getTime() : null;
      return r.status === REFERRAL_STATUS.PENDING && exp !== null && exp > now && exp <= now + sevenDaysMs;
    }
    const matchStatus = statusFilter === "all" || r.status === statusFilter;
    const matchBonus = bonusFilter === "all" || (bonusFilter === "unpaid" && !r.bonusPaid);
    const q = searchQuery.toLowerCase();
    const matchSearch = !q
      || r.code.toLowerCase().includes(q)
      || (r.referrerName ?? "").toLowerCase().includes(q)
      || (r.referrerEmail ?? "").toLowerCase().includes(q)
      || ((r as EnrichedReferral).referrerWhatsapp ?? "").toLowerCase().includes(q)
      || (r.referredEmail ?? "").toLowerCase().includes(q)
      || (r.referredName ?? "").toLowerCase().includes(q);
    return matchStatus && matchSearch && matchBonus;
  });

  const settingsDiscountPct = settings ? parseFloat(String(settings.discountValue)) : 5;
  const settingsBonusVal = settings ? parseFloat(String(settings.bonusValue)) : 10;
  const isEnabled = settings?.isEnabled ?? true;
  const tenantName = (me as { tenant?: { name?: string } } | undefined)?.tenant?.name ?? "Minha Agência";

  const pendingBonusCount = referrals.filter(r => r.status === REFERRAL_STATUS.COMPLETED && !r.bonusPaid).length;

  const pendingBonusReferrals = filtered.filter(r => r.status === REFERRAL_STATUS.COMPLETED && !r.bonusPaid);
  const allBonusSelected = pendingBonusReferrals.length > 0 && pendingBonusReferrals.every(r => selectedBonusIds.has(r.id));
  const selectedBonusTotal = referrals
    .filter(r => selectedBonusIds.has(r.id))
    .reduce((sum, r) => sum + (parseFloat(String(r.bonusAmount ?? "0")) || 0), 0);

  // Derive controlled tab value from filter state so the banner CTA is always reflected visually
  const activeTab = fraudFilter
    ? "suspicious"
    : statusFilter === "expiringSoon"
    ? "expiringSoon"
    : statusFilter === "completed" && bonusFilter === "unpaid"
    ? "completed-unpaid"
    : statusFilter === "all" || statusFilter === "pending" || statusFilter === "completed" || statusFilter === "expired"
    ? statusFilter
    : "all";

  function applyTab(tab: string) {
    setSelectedBonusIds(new Set());
    setFraudFilter(tab === "suspicious");
    setBonusFilter(tab === "completed-unpaid" ? "unpaid" : "all");
    setStatusFilter(
      tab === "suspicious" ? "all"
      : tab === "completed-unpaid" ? "completed"
      : tab === "expiringSoon" ? "expiringSoon"
      : tab
    );
    if (tab === "expiringSoon") setSearchQuery("");
  }

  function buildExportFilters() {
    return {
      status: statusFilter !== "all" && !fraudFilter && statusFilter !== "expiringSoon" ? statusFilter : undefined,
      search: searchQuery || undefined,
      bonusPaid: bonusFilter === "unpaid" ? false : undefined,
      fraudFlag: fraudFilter ? true : undefined,
      expiringSoon: statusFilter === "expiringSoon" ? true : undefined,
      bonusNotified: bonusNotifiedFilter === "all" ? undefined : bonusNotifiedFilter === "notified",
    };
  }

  function handleExportCsv() {
    const url = getReferralExportUrl(buildExportFilters());
    window.open(url, "_blank");
  }

  function handleExportExcel() {
    const url = getReferralExportUrl({ ...buildExportFilters(), format: "xlsx" });
    window.open(url, "_blank");
  }

  async function handleExportPdf() {
    const agencyName = (me as { tenant?: { name?: string } } | undefined)?.tenant?.name ?? "Agência";
    const agencyLogo = (me as { tenant?: { logoUrl?: string | null } } | undefined)?.tenant?.logoUrl ?? null;
    const dateStr = localToday();
    const filters = buildExportFilters();

    let exportRows: Array<{
      code: string; referrerName: string; referrerEmail: string;
      referredName: string; referredEmail: string; status: string;
      bonusAmount: string; discountAmount: string; bonusPaid: string;
      visitsCount: number; lastVisit: string;
      createdAt: string; convertedAt: string; expiresAt: string;
      fraudReason: string;
    }>;

    try {
      const jsonUrl = getReferralExportUrl({ ...filters, format: "json" });
      const resp = await fetch(jsonUrl, { credentials: "include" });
      if (!resp.ok) throw new Error("Falha ao buscar dados");
      const payload = await resp.json() as { rows: typeof exportRows };
      exportRows = payload.rows;
    } catch {
      toast({ title: "Erro ao gerar PDF", variant: "destructive" });
      return;
    }

    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const margin = 14;
    let y = margin;

    if (agencyLogo) {
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.crossOrigin = "anonymous";
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = agencyLogo;
        });
        const maxH = 14;
        const ratio = img.width / img.height;
        const imgW = Math.min(maxH * ratio, 40);
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d")!.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        pdf.addImage(dataUrl, "PNG", margin, y, imgW, maxH);
        y += maxH + 4;
      } catch {
        // logo failed — continue without it
      }
    }

    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text(agencyName, margin, y + 4);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(120, 120, 120);
    pdf.text(`Relatório de Indicações — ${dateStr}`, margin, y + 10);
    pdf.setTextColor(0, 0, 0);
    y += 18;

    const colHeaders = [
      "Código", "Indicador", "Indicado", "Status",
      "Bônus (R$)", "Desconto (R$)", "Bônus Pago", "Visitas",
      "Última visita", "Criado em", "Convertido em", "Expira em", "Motivo",
    ];
    const colWidths = [20, 30, 30, 18, 18, 18, 16, 12, 20, 20, 20, 20, 27];
    const rowHeight = 7;

    function drawTableHeader(yPos: number) {
      pdf.setFillColor(240, 240, 240);
      pdf.rect(margin, yPos, pageW - 2 * margin, rowHeight, "F");
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      let cx = margin;
      colHeaders.forEach((h, i) => {
        pdf.text(h, cx + 1, yPos + rowHeight - 2);
        cx += colWidths[i];
      });
      pdf.setFont("helvetica", "normal");
      return yPos + rowHeight;
    }

    y = drawTableHeader(y);

    exportRows.forEach((r, idx) => {
      if (y + rowHeight > pdf.internal.pageSize.getHeight() - margin) {
        pdf.addPage();
        y = drawTableHeader(margin);
      }
      if (idx % 2 === 1) {
        pdf.setFillColor(250, 250, 250);
        pdf.rect(margin, y, pageW - 2 * margin, rowHeight, "F");
      }
      const cells = [
        r.code, r.referrerName, r.referredName, r.status,
        r.bonusAmount, r.discountAmount, r.bonusPaid, String(r.visitsCount),
        r.lastVisit, r.createdAt, r.convertedAt, r.expiresAt, r.fraudReason,
      ];
      let cx = margin;
      cells.forEach((cell, i) => {
        const maxW = colWidths[i] - 2;
        const text = pdf.splitTextToSize(String(cell ?? ""), maxW)[0] as string ?? "";
        pdf.text(text, cx + 1, y + rowHeight - 2);
        cx += colWidths[i];
      });
      y += rowHeight;
    });

    pdf.save(`indicacoes-${dateStr}.pdf`);
  }

  if (referralsLocked) {
    return (
      <PlanFeatureWall
        featureLabel="Programa de Indicações"
        currentPlanLabel={subData?.plan?.name}
        requiredPlanLabel={getRequiredPlanLabel(subData, "referrals") ?? "Pro"}
        canUpgrade={referralsCanUpgrade}
      />
    );
  }

  return (
    <>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Programa de Indicações</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie indicações, conversões e pagamentos de bônus
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isEnabled && (
            <Badge variant="destructive" className="text-sm px-3 py-1">
              Programa desativado
            </Badge>
          )}
          {pendingBonusCount > 0 && (
            <Badge variant="outline" className="text-sm px-3 py-1 border-amber-400 text-amber-700 bg-amber-50">
              <Wallet className="w-3 h-3 mr-1" />
              {pendingBonusCount} bônus pendente{pendingBonusCount > 1 ? "s" : ""}
            </Badge>
          )}
          <Select
            value={bonusNotifiedFilter}
            onValueChange={(v) => setBonusNotifiedFilter(v as "all" | "notified" | "not_notified")}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Notif. bônus: Todos</SelectItem>
              <SelectItem value="notified">Notificados</SelectItem>
              <SelectItem value="not_notified">Não notificados</SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="w-4 h-4 mr-2" />
                Exportar
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportCsv}>
                <Download className="w-4 h-4 mr-2" />
                CSV (.csv)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportExcel}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPdf}>
                <FileText className="w-4 h-4 mr-2" />
                PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => { setCampaignsDialogOpen(true); setShowCampaignForm(false); }}>
            <Megaphone className="w-4 h-4 mr-2" />
            Campanhas
            {activeCampaignAdmin && (
              <span className="ml-1.5 w-2 h-2 rounded-full bg-green-500 inline-block" />
            )}
          </Button>
          <Button variant="outline" onClick={openSettings}>
            <Settings className="w-4 h-4 mr-2" />
            Configurações
          </Button>
        </div>
      </div>

      {/* Expiring soon alert — count derived from loaded referrals using expiresAt */}
      {expiringSoonCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <Clock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              {expiringSoonCount} {expiringSoonCount === 1 ? "código de indicação expira" : "códigos de indicação expiram"} nos próximos 7 dias
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Entre em contato com os clientes antes que percam o benefício.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100"
            onClick={() => applyTab("expiringSoon")}
          >
            Ver que expiram em breve
          </Button>
        </div>
      )}

      {/* Referral reversal gaps — cancelled reservations still owing a bonus reversal */}
      {totalGaps > 0 && (
        <Card className="border-red-300 bg-red-50/60">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <CardTitle className="text-base text-red-800">
                  {totalGaps} reversão(ões) de bônus de indicação não executada(s)
                </CardTitle>
                <CardDescription className="text-red-700">
                  Estas reservas foram canceladas, mas o bônus de indicação pode ter ficado
                  creditado indevidamente. Verifique cada caso e marque como resolvido após
                  estornar o bônus manualmente.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-red-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reserva</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Indicador</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reversalGaps.map((gap) => {
                    const resolving = resolvingGapIds.has(gap.reservationId);
                    return (
                      <TableRow key={gap.reservationId}>
                        <TableCell className="font-mono text-xs">
                          {gap.reservationNumber ?? gap.reservationId}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{gap.referralCode}</TableCell>
                        <TableCell className="text-sm">
                          {gap.referrerName ?? "Indicador desconhecido"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-300 text-red-700 hover:bg-red-100"
                            disabled={resolving || !canResolveGaps}
                            title={!canResolveGaps ? "Apenas a equipe da agência pode resolver" : undefined}
                            onClick={() => handleResolveGap(gap.reservationId)}
                          >
                            {resolving ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                Resolvendo…
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5 mr-1.5" />
                                Marcar como resolvido
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {totalGaps > REVERSAL_GAPS_PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                <p className="text-xs text-red-700">
                  Mostrando {gapsPage * REVERSAL_GAPS_PAGE_SIZE + 1}–
                  {gapsPage * REVERSAL_GAPS_PAGE_SIZE + reversalGaps.length} de {totalGaps}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-300 text-red-700 hover:bg-red-100"
                    disabled={gapsPage === 0}
                    onClick={() => setGapsPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                    Anterior
                  </Button>
                  <span className="text-xs text-red-700">
                    Página {gapsPage + 1} de {gapsPageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-300 text-red-700 hover:bg-red-100"
                    disabled={gapsPage >= gapsPageCount - 1}
                    onClick={() => setGapsPage((p) => p + 1)}
                  >
                    Próxima
                    <ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats Cards — period-scoped */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">Desempenho no período</p>
          <div className="flex items-center gap-1.5">
            {([30, 90, 180] as ReferralAnalyticsPeriod[]).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={analyticsPeriod === v ? "default" : "outline"}
                onClick={() => setAnalyticsPeriod(v)}
                className="text-xs h-6 px-2.5"
              >
                {v} dias
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4" />
                Indicações
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{analyticsData?.funnel.created ?? stats?.total ?? referrals.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">nos últimos {analyticsPeriod} dias</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Check className="w-4 h-4" />
                Convertidas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-600">{analyticsData?.funnel.converted ?? stats?.completed ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">nos últimos {analyticsPeriod} dias</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Taxa de conversão
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-primary">
                {analyticsData?.conversionRate ?? stats?.conversionRate ?? 0}%
              </p>
              {analyticsData && (analyticsData.funnel.created > 0 || analyticsData.prevConversionRate > 0) && (() => {
                const delta = analyticsData.conversionRate - analyticsData.prevConversionRate;
                return (
                  <p className={`text-xs mt-0.5 font-medium ${delta >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {delta >= 0 ? "+" : ""}{delta}pp vs. período anterior
                  </p>
                );
              })()}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Desconto concedido
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{fmtCurrency(analyticsData?.discountGiven ?? stats?.totalDiscountGiven ?? 0)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">nos últimos {analyticsPeriod} dias</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Program Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Percent className="w-4 h-4 text-primary" />
              Desconto para o indicado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{settingsDiscountPct}%</p>
            <p className="text-xs text-muted-foreground">{settings?.discountType === "percentage" ? "percentual" : "valor fixo"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Gift className="w-4 h-4 text-primary" />
              Bônus para quem indica
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmtCurrency(settingsBonusVal)}</p>
            <p className="text-xs text-muted-foreground">{settings?.bonusType === "credit" ? "crédito" : "dinheiro"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Validade do código
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{settings?.expirationDays ?? 30} dias</p>
            <p className="text-xs text-muted-foreground">após criação</p>
          </CardContent>
        </Card>
      </div>

      {/* Analytics Charts Section */}
      {analyticsData ? (
        <ReferralAnalyticsCharts
          data={analyticsData}
          period={analyticsPeriod}
          analyticsExportUrl={getReferralAnalyticsExportUrl(analyticsPeriod)}
        />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Analytics avançado de indicações
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-36 flex items-center justify-center text-muted-foreground text-sm">
              Carregando dados de analytics...
            </div>
          </CardContent>
        </Card>
      )}

      {/* Funnel (kept for at-a-glance view) */}
      {analyticsData && analyticsData.funnel.created > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Funil de conversão
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                { label: "Criadas", count: analyticsData.funnel.created, color: "#3B82F6" },
                { label: "Visitadas", count: analyticsData.funnel.visited, color: "#8B5CF6" },
                { label: "Convertidas", count: analyticsData.funnel.converted, color: "#10B981" },
                { label: "Bônus pago", count: analyticsData.funnel.bonusPaid, color: "#F59E0B" },
              ].map((step) => {
                const pct = analyticsData.funnel.created > 0 ? Math.round((step.count / analyticsData.funnel.created) * 100) : 0;
                return (
                  <div key={step.label} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-24 shrink-0">{step.label}</span>
                    <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                      <div
                        className="h-5 rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                        style={{ width: `${Math.max(pct, 3)}%`, backgroundColor: step.color }}
                      >
                        <span className="text-[10px] font-semibold text-white">{step.count}</span>
                      </div>
                    </div>
                    <span className="text-xs font-medium w-10 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tracking Funnel: visits → conversions from referral_tracking */}
      {analyticsData && analyticsData.trackingFunnel.uniqueVisitors > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MousePointerClick className="w-4 h-4 text-primary" />
              Visitas à landing page
            </CardTitle>
            <CardDescription>Visitantes únicos que clicaram no link de indicação</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                { label: "Clicaram no link", count: analyticsData.trackingFunnel.uniqueVisitors, color: "#6366F1" },
                { label: "Chegaram ao checkout", count: analyticsData.trackingFunnel.checkoutStarts, color: "#8B5CF6" },
                { label: "Converteram", count: analyticsData.trackingFunnel.converted, color: "#10B981" },
              ].map((step) => {
                const pct = analyticsData.trackingFunnel.uniqueVisitors > 0
                  ? Math.round((step.count / analyticsData.trackingFunnel.uniqueVisitors) * 100)
                  : 0;
                return (
                  <div key={step.label} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-32 shrink-0">{step.label}</span>
                    <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                      <div
                        className="h-5 rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                        style={{ width: `${Math.max(pct, 3)}%`, backgroundColor: step.color }}
                      >
                        <span className="text-[10px] font-semibold text-white">{step.count}</span>
                      </div>
                    </div>
                    <span className="text-xs font-medium w-10 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Referrals Table */}
      <Tabs value={activeTab} onValueChange={applyTab}>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <TabsList>
            <TabsTrigger value="all">Todas</TabsTrigger>
            <TabsTrigger value="pending">Pendentes</TabsTrigger>
            <TabsTrigger value="expiringSoon">
              <Clock className="w-3.5 h-3.5 mr-1 text-amber-500" />
              Expiram em breve
              {expiringSoonCount > 0 && (
                <Badge variant="outline" className="ml-1.5 px-1.5 py-0 text-xs h-4 border-amber-400 text-amber-700">
                  {expiringSoonCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed">Convertidas</TabsTrigger>
            <TabsTrigger value="completed-unpaid">
              Bônus pendente
              {pendingBonusCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 px-1.5 py-0 text-xs h-4">
                  {pendingBonusCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="expired">Expiradas</TabsTrigger>
            <TabsTrigger value="suspicious">
              <ShieldAlert className="w-3.5 h-3.5 mr-1" />
              Suspeitas
              {suspiciousCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 px-1.5 py-0 text-xs h-4">
                  {suspiciousCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <Input
            placeholder="Buscar por código, nome, e-mail ou WhatsApp..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSelectedBonusIds(new Set()); }}
            className="max-w-xs"
            disabled={fraudFilter || statusFilter === "expiringSoon"}
          />
          {activeTab === "completed-unpaid" && selectedBonusIds.size > 0 && (
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 shrink-0"
              onClick={() => setBulkPayDialogOpen(true)}
            >
              <CheckSquare2 className="w-3.5 h-3.5 mr-1.5" />
              Pagar selecionados ({selectedBonusIds.size})
            </Button>
          )}
          <span className="text-sm text-muted-foreground ml-auto">{filtered.length} indicações</span>
        </div>

        {["all", "pending", "expiringSoon", "completed", "completed-unpaid", "expired", "suspicious"].map((tabVal) => (
          <TabsContent key={tabVal} value={tabVal}>
            {filtered.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  {tabVal === "suspicious" ? "Nenhuma indicação suspeita encontrada" : "Nenhuma indicação encontrada"}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {tabVal === "completed-unpaid" && (
                        <TableHead className="w-8">
                          <Checkbox
                            checked={allBonusSelected}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedBonusIds(new Set(pendingBonusReferrals.map(r => r.id)));
                              } else {
                                setSelectedBonusIds(new Set());
                              }
                            }}
                          />
                        </TableHead>
                      )}
                      <TableHead>Código</TableHead>
                      <TableHead>Quem indicou</TableHead>
                      <TableHead>Indicado</TableHead>
                      <TableHead>Status</TableHead>
                      {tabVal === "suspicious" && <TableHead className="text-red-600">Motivo</TableHead>}
                      <TableHead>Bônus</TableHead>
                      <TableHead>Desconto</TableHead>
                      <TableHead>Visitas</TableHead>
                      <TableHead>Última visita</TableHead>
                      <TableHead>Expira em</TableHead>
                      <TableHead>Criado em</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        {tabVal === "completed-unpaid" && (
                          <TableCell>
                            <Checkbox
                              checked={selectedBonusIds.has(r.id)}
                              onCheckedChange={(checked) => {
                                setSelectedBonusIds(prev => {
                                  const next = new Set(prev);
                                  if (checked) next.add(r.id); else next.delete(r.id);
                                  return next;
                                });
                              }}
                            />
                          </TableCell>
                        )}
                        <TableCell className="font-mono font-semibold text-primary">{r.code}</TableCell>
                        <TableCell>
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                              <p className="font-medium text-sm leading-tight">
                                {r.referrerName ?? r.referrerId.slice(0, 8)}
                              </p>
                              {(() => {
                                const conversions = (r as EnrichedReferral).referrerSuccessfulReferrals ?? 0;
                                const t = computeAdminTier(conversions, settings?.tiersConfig);
                                return <ReferralTierBadge level={t.level} label={t.label} />;
                              })()}
                            </div>
                            {r.referrerEmail && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Mail className="w-2.5 h-2.5 shrink-0" />
                                {r.referrerEmail}
                              </p>
                            )}
                            {(r as EnrichedReferral).referrerWhatsapp && (
                              <a
                                href={`https://wa.me/55${fmtWhatsapp((r as EnrichedReferral).referrerWhatsapp)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-green-600 flex items-center gap-1 mt-0.5 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MessageCircle className="w-2.5 h-2.5 shrink-0" />
                                {(r as EnrichedReferral).referrerWhatsapp}
                              </a>
                            )}
                            {r.referrerPhone && !(r as EnrichedReferral).referrerWhatsapp && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Phone className="w-2.5 h-2.5 shrink-0" />
                                {r.referrerPhone}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm">{r.referredName ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{r.referredEmail ?? ""}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                          {!r.isActive && <Badge variant="outline" className="ml-1 text-xs">inativo</Badge>}
                        </TableCell>
                        {tabVal === "suspicious" && (
                          <TableCell>
                            <div className="flex items-start gap-1 text-red-600">
                              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span className="text-xs leading-snug">{r.fraudReason ?? "—"}</span>
                            </div>
                          </TableCell>
                        )}
                        <TableCell>
                          {r.status === REFERRAL_STATUS.REVERSED ? (
                            <div>
                              <p className="text-sm font-medium text-red-600 line-through">{fmtCurrency(r.bonusAmount)}</p>
                              <p className="text-xs text-red-500 flex items-center gap-0.5">
                                <XCircle className="w-2.5 h-2.5" />
                                Revertido
                              </p>
                              {(r as EnrichedReferral).reversalReason && (
                                <p className="text-xs text-red-400">
                                  {(r as EnrichedReferral).reversalReason === "reservation_cancelled" ? "Reserva cancelada" :
                                   (r as EnrichedReferral).reversalReason === "trip_cancelled" ? "Excursão cancelada" :
                                   (r as EnrichedReferral).reversalReason}
                                </p>
                              )}
                              
                            </div>
                          ) : r.status === REFERRAL_STATUS.COMPLETED ? (
                            <div>
                              <p className="text-sm font-medium text-green-600">{fmtCurrency(r.bonusAmount)}</p>
                              {r.bonusPaid ? (
                                <p className="text-xs text-green-700 flex items-center gap-0.5">
                                  <Check className="w-2.5 h-2.5" />
                                  Pago {r.bonusPaidAt ? `em ${fmtDate(r.bonusPaidAt)}` : ""}
                                </p>
                              ) : (r as EnrichedReferral).bonusBlocked && (r as EnrichedReferral).bonusReleasesAt ? (
                                <p className="text-xs text-slate-500 flex items-center gap-0.5">
                                  <Clock className="w-2.5 h-2.5" />
                                  Disponível em {fmtDate((r as EnrichedReferral).bonusReleasesAt)}
                                </p>
                              ) : (
                                <p className="text-xs text-amber-600">Pendente</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.discountApplied
                            ? fmtCurrency(r.discountAmount)
                            : `${r.discountValue}%`}
                        </TableCell>
                        <TableCell>{r.visitsCount ?? 0}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(r.lastVisit)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.expiresAt ? (() => {
                            const daysLeft = Math.ceil((new Date(r.expiresAt).getTime() - Date.now()) / 86400000);
                            if (daysLeft <= 0) return <Badge variant="destructive" className="text-xs">Expirado</Badge>;
                            if (daysLeft <= 3) return <Badge variant="outline" className="text-xs text-amber-600 border-amber-400 gap-1"><Clock className="w-3 h-3" />{fmtDate(r.expiresAt)}</Badge>;
                            return <span className="text-xs text-muted-foreground">{fmtDate(r.expiresAt)}</span>;
                          })() : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openDetail(r)} title="Ver detalhes">
                              <Eye className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              onClick={() => openShare(r)}
                              title="Compartilhar link de indicação"
                            >
                              <Share2 className="w-3 h-3" />
                            </Button>
                            {r.status === REFERRAL_STATUS.COMPLETED && !r.bonusPaid && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className={
                                  (r as EnrichedReferral).bonusBlocked
                                    ? "text-slate-400 cursor-not-allowed"
                                    : "text-green-600 hover:text-green-700 hover:bg-green-50"
                                }
                                onClick={() => { if (!(r as EnrichedReferral).bonusBlocked) openPayBonusDialog(r); }}
                                title={
                                  (r as EnrichedReferral).bonusBlocked && (r as EnrichedReferral).bonusReleasesAt
                                    ? `Bônus disponível em ${fmtDate((r as EnrichedReferral).bonusReleasesAt)}`
                                    : "Pagar bônus"
                                }
                              >
                                <Wallet className="w-3 h-3" />
                              </Button>
                            )}
                            {r.status === REFERRAL_STATUS.COMPLETED && (me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.AGENCY_MANAGER || me?.role === ROLES.SUPER_ADMIN) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => openReverseBonusDialog(r)}
                                title="Reverter bônus"
                              >
                                <XCircle className="w-3 h-3" />
                              </Button>
                            )}
                            {r.isActive && r.status === REFERRAL_STATUS.PENDING && (
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeactivate(r)} title="Desativar">
                                <Ban className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Share Link & QR-Code Dialog */}
      <Dialog open={shareModalOpen} onOpenChange={(open) => { setShareModalOpen(open); if (!open) { setCopiedLink(false); setCopiedMessage(false); setShareReferral(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-blue-600" />
              Compartilhar indicação
            </DialogTitle>
            <DialogDescription>
              Envie o link ou QR-code ao indicador para facilitar o compartilhamento.
            </DialogDescription>
          </DialogHeader>
          {shareLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
              <QrCode className="w-5 h-5 animate-pulse" />
              Gerando link e QR-code…
            </div>
          ) : shareData ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Link2 className="w-3.5 h-3.5" />
                  Link de indicação
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={shareData.link}
                    className="text-xs font-mono bg-muted/50 flex-1 min-w-0"
                  />
                  <Button size="sm" variant="outline" onClick={copyLink} className="shrink-0">
                    {copiedLink ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                {copiedLink && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Link copiado!
                  </p>
                )}
              </div>
              {settings?.shareMessage && (() => {
                const bonusFormatted = shareReferral?.bonusAmount != null ? fmtCurrency(shareReferral.bonusAmount) : "";
                const resolved = settings.shareMessage
                  .replace(/\{nome\}/g, shareReferral?.referrerName ?? "")
                  .replace(/\{codigo\}/g, shareReferral?.code ?? "")
                  .replace(/\{bonus\}/g, bonusFormatted)
                  .replace(/\{link\}/g, shareData.link);
                const preview = /\{link\}/.test(settings.shareMessage) ? resolved : `${resolved}\n${shareData.link}`;
                return (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <MessageCircle className="w-3.5 h-3.5" />
                      Mensagem
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyMessage(preview)}
                        className="ml-auto h-6 px-2 shrink-0"
                      >
                        {copiedMessage ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    </p>
                    {copiedMessage && (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Mensagem copiada!
                      </p>
                    )}
                    <div className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-foreground whitespace-pre-wrap break-words leading-relaxed">
                      {preview}
                    </div>
                  </div>
                );
              })()}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <QrCode className="w-3.5 h-3.5" />
                  QR-code
                </p>
                <div className="flex justify-center">
                  <img
                    src={shareData.qrCodeDataUrl}
                    alt="QR-code de indicação"
                    className="w-48 h-48 border rounded-lg p-2 bg-white"
                  />
                </div>
                <p className="text-xs text-center text-muted-foreground">
                  Escaneie para acessar o link de indicação
                </p>
                <div className="flex justify-center items-center gap-3 flex-wrap">
                  <a
                    href={shareData.qrCodeDataUrl}
                    download={`qrcode-${shareReferral?.code ?? "referral"}.png`}
                    className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar QR-code
                  </a>
                  <button
                    type="button"
                    onClick={() => copyQrCodeToClipboard(shareData.qrCodeDataUrl, shareReferral?.code ?? "referral")}
                    className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {canCopyImageToClipboard ? (
                      <><Copy className="w-3.5 h-3.5" />Copiar imagem</>
                    ) : (
                      <><Download className="w-3.5 h-3.5" />Baixar QR-code</>
                    )}
                  </button>
                  {isValidWhatsapp(shareReferral?.referrerWhatsapp) && (
                    <button
                      type="button"
                      onClick={() => shareQrCodeViaWhatsApp(shareData.qrCodeDataUrl, shareReferral?.code ?? "referral", shareReferral!.referrerWhatsapp!, shareData.link)}
                      className="inline-flex items-center gap-1.5 text-xs text-green-700 hover:text-green-800 font-medium"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Enviar QR-code pelo WhatsApp
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground text-sm">
              Erro ao gerar o link. Tente novamente.
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShareModalOpen(false)}>Fechar</Button>
            {shareData && (() => {
              const referrerPhone = shareReferral?.referrerWhatsapp;
              const hasWhatsapp = isValidWhatsapp(referrerPhone);
              const whatsappUrl = hasWhatsapp
                ? buildWhatsAppShareUrl(referrerPhone, shareData.link, settings?.shareMessage ?? "", shareReferral?.referrerName, shareReferral?.code, shareReferral?.bonusAmount)
                : null;
              return (
                <>
                  <Button
                    variant="outline"
                    className={hasWhatsapp ? "border-green-500 text-green-700 hover:bg-green-50" : "opacity-50 cursor-not-allowed"}
                    disabled={!hasWhatsapp}
                    title={hasWhatsapp ? undefined : "Indicador sem WhatsApp cadastrado"}
                    asChild={hasWhatsapp}
                  >
                    {hasWhatsapp ? (
                      <a href={whatsappUrl!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                        <MessageCircle className="w-4 h-4" />
                        Enviar via WhatsApp
                      </a>
                    ) : (
                      <span className="flex items-center gap-2">
                        <MessageCircle className="w-4 h-4" />
                        Enviar via WhatsApp
                      </span>
                    )}
                  </Button>
                  <Button onClick={copyLink} className="bg-blue-600 hover:bg-blue-700">
                    {copiedLink ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                    {copiedLink ? "Copiado!" : "Copiar link"}
                  </Button>
                </>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Pay Confirmation Dialog */}
      <Dialog open={bulkPayDialogOpen} onOpenChange={setBulkPayDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pagar bônus em lote</DialogTitle>
            <DialogDescription>
              Isso marcará os bônus selecionados como pagos e enviará e-mails de confirmação a cada indicador.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Indicações selecionadas</span>
              <span className="font-medium">{selectedBonusIds.size}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">Total a pagar</span>
              <span className="font-bold text-green-600 text-base">{fmtCurrency(selectedBonusTotal)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkPayDialogOpen(false)} disabled={bulkPaying}>
              Cancelar
            </Button>
            <Button onClick={confirmBulkPay} disabled={bulkPaying} className="bg-green-600 hover:bg-green-700">
              <CheckSquare2 className="w-4 h-4 mr-2" />
              {bulkPaying ? "Processando..." : `Confirmar ${selectedBonusIds.size} pagamento${selectedBonusIds.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Bonus Confirmation Dialog */}
      <Dialog open={payBonusDialogOpen} onOpenChange={setPayBonusDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar Pagamento de Bônus</DialogTitle>
            <DialogDescription>
              Isso marcará o bônus como pago e enviará um e-mail de confirmação ao indicador.
            </DialogDescription>
          </DialogHeader>
          {payBonusTarget && (
            <div className="space-y-3 py-2">
              <div className="bg-muted rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Indicador</span>
                  <span className="font-medium">{payBonusTarget.referrerName ?? payBonusTarget.referrerId.slice(0, 8)}</span>
                </div>
                {payBonusTarget.referrerEmail && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">E-mail</span>
                    <span className="text-sm">{payBonusTarget.referrerEmail}</span>
                  </div>
                )}
                {(payBonusTarget as EnrichedReferral).referrerWhatsapp && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">WhatsApp</span>
                    <span className="text-sm">{(payBonusTarget as EnrichedReferral).referrerWhatsapp}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2">
                  <span className="text-muted-foreground">Valor do bônus</span>
                  <span className="font-bold text-green-600 text-base">{fmtCurrency(payBonusTarget.bonusAmount)}</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayBonusDialogOpen(false)} disabled={payBonus.isPending}>
              Cancelar
            </Button>
            <Button onClick={confirmPayBonus} disabled={payBonus.isPending} className="bg-green-600 hover:bg-green-700">
              <Check className="w-4 h-4 mr-2" />
              {payBonus.isPending ? "Processando..." : "Confirmar pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reverse Bonus Confirmation Dialog */}
      <Dialog open={reverseBonusDialogOpen} onOpenChange={(open) => { setReverseBonusDialogOpen(open); if (!open) { setReverseBonusTarget(null); setReverseBonusReason(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <XCircle className="w-5 h-5" />
              Reverter Bônus de Indicação
            </DialogTitle>
            <DialogDescription>
              Esta ação reverterá o bônus, decrementará os ganhos do indicador e enviará uma notificação por e-mail. Não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          {reverseBonusTarget && (
            <div className="space-y-4 py-2">
              <div className="bg-muted rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Indicador</span>
                  <span className="font-medium">{reverseBonusTarget.referrerName ?? reverseBonusTarget.referrerId.slice(0, 8)}</span>
                </div>
                {reverseBonusTarget.referrerEmail && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">E-mail</span>
                    <span className="text-sm">{reverseBonusTarget.referrerEmail}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2">
                  <span className="text-muted-foreground">Valor do bônus</span>
                  <span className="font-bold text-red-600 text-base line-through">{fmtCurrency(reverseBonusTarget.bonusAmount)}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reversal-reason">Motivo da reversão <span className="text-red-500">*</span></Label>
                <Input
                  id="reversal-reason"
                  placeholder="Ex: Contestação do cliente, reembolso parcial..."
                  value={reverseBonusReason}
                  onChange={(e) => setReverseBonusReason(e.target.value)}
                  disabled={reverseBonus.isPending}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseBonusDialogOpen(false)} disabled={reverseBonus.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={confirmReverseBonus}
              disabled={reverseBonus.isPending || !reverseBonusReason.trim()}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <XCircle className="w-4 h-4 mr-2" />
              {reverseBonus.isPending ? "Processando..." : "Confirmar reversão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Modal */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalhes da Indicação</DialogTitle>
          </DialogHeader>
          {selectedReferral && (
            <div className="space-y-4">
              {/* Referrer info block */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dados do Indicador</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <p className="font-medium text-sm">{selectedReferral.referrerName ?? "—"}</p>
                    <span className="text-xs text-muted-foreground font-mono ml-auto">{selectedReferral.code}</span>
                  </div>
                  {selectedReferral.referrerEmail && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <a href={`mailto:${selectedReferral.referrerEmail}`} className="text-sm hover:underline text-blue-600">
                        {selectedReferral.referrerEmail}
                      </a>
                    </div>
                  )}
                  {(selectedReferral as EnrichedReferral).referrerWhatsapp && (
                    <div className="flex items-center gap-2">
                      <MessageCircle className="w-3.5 h-3.5 text-green-600 shrink-0" />
                      <a
                        href={`https://wa.me/55${fmtWhatsapp((selectedReferral as EnrichedReferral).referrerWhatsapp)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-green-600 hover:underline"
                      >
                        {(selectedReferral as EnrichedReferral).referrerWhatsapp}
                      </a>
                    </div>
                  )}
                  {selectedReferral.referrerPhone && !(selectedReferral as EnrichedReferral).referrerWhatsapp && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <p className="text-sm">{selectedReferral.referrerPhone}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <StatusBadge status={selectedReferral.status} />
                </div>
                <div>
                  <p className="text-muted-foreground">Indicado</p>
                  <p>{selectedReferral.referredName ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{selectedReferral.referredEmail ?? ""}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Desconto concedido</p>
                  <p>{selectedReferral.discountApplied ? fmtCurrency(selectedReferral.discountAmount) : "Não aplicado"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Bônus</p>
                  {selectedReferral.status === REFERRAL_STATUS.REVERSED ? (
                    <>
                      <p className="text-red-500 font-semibold line-through">{fmtCurrency(selectedReferral.bonusAmount)}</p>
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <XCircle className="w-3 h-3" />
                        Revertido
                        {(selectedReferral as EnrichedReferral).reversalReason === "trip_cancelled"
                          ? " — excursão cancelada"
                          : (selectedReferral as EnrichedReferral).reversalReason === "reservation_cancelled"
                          ? " — reserva cancelada"
                          : (selectedReferral as EnrichedReferral).reversalReason
                          ? ` — ${(selectedReferral as EnrichedReferral).reversalReason}`
                          : ""}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-green-600 font-semibold">{fmtCurrency(selectedReferral.bonusAmount)}</p>
                      {selectedReferral.bonusPaid ? (
                        <p className="text-xs text-green-700 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Pago {selectedReferral.bonusPaidAt ? `em ${fmtDateTime(selectedReferral.bonusPaidAt)}` : ""}
                        </p>
                      ) : (selectedReferral as EnrichedReferral).bonusBlocked && (selectedReferral as EnrichedReferral).bonusReleasesAt ? (
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Disponível em {fmtDate((selectedReferral as EnrichedReferral).bonusReleasesAt)}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-600">Pendente</p>
                      )}
                    </>
                  )}
                </div>
                {(() => {
                  const allByReferrer = referrals.filter(r => r.referrerId === selectedReferral.referrerId && r.status === REFERRAL_STATUS.COMPLETED);
                  const totalBonus = allByReferrer.reduce((s, r) => s + (parseFloat(String(r.bonusAmount ?? "0")) || 0), 0);
                  if (allByReferrer.length < 2) return null;
                  return (
                    <div>
                      <p className="text-muted-foreground">Total acumulado (indicador)</p>
                      <p className="font-semibold text-green-600">{fmtCurrency(totalBonus)}</p>
                      <p className="text-xs text-muted-foreground">{allByReferrer.length} conversões</p>
                    </div>
                  );
                })()}
                <div>
                  <p className="text-muted-foreground">Visitas à landing page</p>
                  <p>{selectedReferral.visitsCount ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Última visita</p>
                  <p>{fmtDate(selectedReferral.lastVisit)}</p>
                </div>
                {selectedReferral.utmSource && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">UTM</p>
                    <p className="text-xs">{[selectedReferral.utmSource, selectedReferral.utmMedium, selectedReferral.utmCampaign].filter(Boolean).join(" / ")}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">Criado em</p>
                  <p>{fmtDate(selectedReferral.createdAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Expira em</p>
                  <p>{fmtDate(selectedReferral.expiresAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Notif. liberação de bônus</p>
                  {selectedReferral.bonusReleaseNotifiedAt ? (
                    <div className="space-y-0.5">
                      <p className="text-xs text-green-700 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        {fmtDateTime(selectedReferral.bonusReleaseNotifiedAt)}
                      </p>
                      {bonusReleaseEmailStatus?.bonusRelease && (() => {
                        const s = bonusReleaseEmailStatus.bonusRelease.status;
                        if (s === "failed") return (
                          <p className="text-xs text-red-600 flex items-center gap-1 font-medium">
                            <XCircle className="w-3 h-3" />
                            Falha na entrega — contate por outro canal
                          </p>
                        );
                        if (s === "sent") return (
                          <p className="text-xs text-green-600 flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            Entregue
                          </p>
                        );
                        return (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Aguardando entrega
                          </p>
                        );
                      })()}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Não enviado</p>
                  )}
                </div>
                {selectedReferral.expiresAt && (
                  <>
                    <div>
                      <p className="text-muted-foreground">Aviso D-7 enviado em</p>
                      {selectedReferral.expiryWarning7SentAt ? (
                        <div className="space-y-0.5">
                          <p className="text-xs text-amber-700 flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            {fmtDateTime(selectedReferral.expiryWarning7SentAt)}
                          </p>
                          {expiryEmailStatus?.d7 && (() => {
                            const s = expiryEmailStatus.d7.status;
                            if (s === "failed") return (
                              <p className="text-xs text-red-600 flex items-center gap-1 font-medium">
                                <XCircle className="w-3 h-3" />
                                Falha na entrega — contate por outro canal
                              </p>
                            );
                            if (s === "sent") return (
                              <p className="text-xs text-green-600 flex items-center gap-1">
                                <Check className="w-3 h-3" />
                                Entregue
                              </p>
                            );
                            return (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Aguardando entrega
                              </p>
                            );
                          })()}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Não enviado</p>
                      )}
                    </div>
                    <div>
                      <p className="text-muted-foreground">Aviso D-1 enviado em</p>
                      {selectedReferral.expiryWarning1SentAt ? (
                        <div className="space-y-0.5">
                          <p className="text-xs text-amber-700 flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            {fmtDateTime(selectedReferral.expiryWarning1SentAt)}
                          </p>
                          {expiryEmailStatus?.d1 && (() => {
                            const s = expiryEmailStatus.d1.status;
                            if (s === "failed") return (
                              <p className="text-xs text-red-600 flex items-center gap-1 font-medium">
                                <XCircle className="w-3 h-3" />
                                Falha na entrega — contate por outro canal
                              </p>
                            );
                            if (s === "sent") return (
                              <p className="text-xs text-green-600 flex items-center gap-1">
                                <Check className="w-3 h-3" />
                                Entregue
                              </p>
                            );
                            return (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Aguardando entrega
                              </p>
                            );
                          })()}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Não enviado</p>
                      )}
                    </div>
                  </>
                )}
              </div>
              {selectedReferral.notes && (
                <div>
                  <p className="text-muted-foreground text-sm">Notas</p>
                  <p className="text-sm">{selectedReferral.notes}</p>
                </div>
              )}

              {/* Share section in detail modal — link copiável + QR-code */}
              <div className="border rounded-lg p-4 space-y-3 bg-blue-50/40">
                <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide flex items-center gap-1.5">
                  <Share2 className="w-3.5 h-3.5" />
                  Compartilhar indicação
                </p>
                {shareLoading && !shareModalOpen ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <QrCode className="w-4 h-4 animate-pulse" />
                    Gerando link e QR-code…
                  </div>
                ) : shareData && !shareModalOpen ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Link2 className="w-3 h-3" />
                        Link de indicação
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          readOnly
                          value={shareData.link}
                          className="text-xs font-mono bg-white/70 flex-1 min-w-0 h-7"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 shrink-0"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(shareData.link);
                              setDetailCopiedLink(true);
                              setTimeout(() => setDetailCopiedLink(false), 2000);
                            } catch {
                              toast({ title: "Não foi possível copiar o link", variant: "destructive" });
                            }
                          }}
                        >
                          {detailCopiedLink ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                      {detailCopiedLink && (
                        <p className="text-xs text-green-600 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Link copiado!
                        </p>
                      )}
                      {(() => {
                        const referrerPhone = selectedReferral.referrerWhatsapp;
                        const hasWhatsapp = isValidWhatsapp(referrerPhone);
                        const whatsappUrl = hasWhatsapp
                          ? buildWhatsAppShareUrl(referrerPhone, shareData.link, settings?.shareMessage ?? "", selectedReferral.referrerName, selectedReferral.code, selectedReferral.bonusAmount)
                          : null;
                        return (
                          <Button
                            size="sm"
                            variant="outline"
                            className={`mt-1 text-xs h-7 ${hasWhatsapp ? "border-green-500 text-green-700 hover:bg-green-50" : "opacity-50 cursor-not-allowed"}`}
                            disabled={!hasWhatsapp}
                            title={hasWhatsapp ? undefined : "Indicador sem WhatsApp cadastrado"}
                            asChild={hasWhatsapp}
                          >
                            {hasWhatsapp ? (
                              <a href={whatsappUrl!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5">
                                <MessageCircle className="w-3 h-3" />
                                Enviar via WhatsApp
                              </a>
                            ) : (
                              <span className="flex items-center gap-1.5">
                                <MessageCircle className="w-3 h-3" />
                                Enviar via WhatsApp
                              </span>
                            )}
                          </Button>
                        );
                      })()}
                    </div>
                    <div className="flex items-start gap-3">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                          <QrCode className="w-3 h-3" />
                          QR-code
                        </p>
                        <img
                          src={shareData.qrCodeDataUrl}
                          alt="QR-code de indicação"
                          className="w-24 h-24 border rounded-lg p-1 bg-white"
                        />
                      </div>
                      <div className="flex-1 min-w-0 pt-5">
                        <p className="text-xs text-muted-foreground leading-snug">
                          Envie o link ou mostre o QR-code ao indicador para que ele compartilhe com amigos.
                        </p>
                        <button
                          type="button"
                          onClick={() => copyQrCodeToClipboard(shareData.qrCodeDataUrl, selectedReferral.code ?? "referral")}
                          className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                        >
                          {canCopyImageToClipboard ? (
                            <><Copy className="w-3 h-3" />Copiar imagem</>
                          ) : (
                            <><Download className="w-3 h-3" />Baixar QR-code</>
                          )}
                        </button>
                        {isValidWhatsapp(selectedReferral.referrerWhatsapp) && (
                          <button
                            type="button"
                            onClick={() => shareQrCodeViaWhatsApp(shareData.qrCodeDataUrl, selectedReferral.code ?? "referral", selectedReferral.referrerWhatsapp!, shareData.link)}
                            className="mt-2 flex items-center gap-1.5 text-xs text-green-700 hover:text-green-800 font-medium"
                          >
                            <MessageCircle className="w-3 h-3" />
                            Enviar QR-code pelo WhatsApp
                          </button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 text-xs h-7 border-blue-300 text-blue-700 hover:bg-blue-100"
                          onClick={() => openShare(selectedReferral)}
                        >
                          <Share2 className="w-3 h-3 mr-1" />
                          Abrir em tela cheia
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
          <DialogFooter>
            {selectedReferral && selectedReferral.expiresAt && (() => {
              const msLeft = new Date(selectedReferral.expiresAt).getTime() - Date.now();
              const showD7 = msLeft >= 7 * 24 * 60 * 60 * 1000;
              const showD1 = msLeft >= 1 * 24 * 60 * 60 * 1000;
              if (!showD7 && !showD1) return null;
              return (
                <>
                  {showD7 && (
                    <Button
                      variant="outline"
                      className="border-amber-400 text-amber-700 hover:bg-amber-50"
                      disabled={resendWarning.isPending}
                      onClick={() => {
                        resendWarning.mutate(
                          { id: selectedReferral.id, window: 7 },
                          {
                            onSuccess: (updated) => {
                              setSelectedReferral((prev) => prev ? { ...prev, ...updated } : prev);
                              refetch();
                              refetchExpiryEmailStatus();
                              toast({ title: "Aviso D-7 reenviado com sucesso" });
                            },
                            onError: () => toast({ title: "Erro ao reenviar aviso D-7", variant: "destructive" }),
                          },
                        );
                      }}
                    >
                      <Mail className="w-4 h-4 mr-2" />
                      Reenviar aviso D-7
                    </Button>
                  )}
                  {showD1 && (
                    <Button
                      variant="outline"
                      className="border-amber-400 text-amber-700 hover:bg-amber-50"
                      disabled={resendWarning.isPending}
                      onClick={() => {
                        resendWarning.mutate(
                          { id: selectedReferral.id, window: 1 },
                          {
                            onSuccess: (updated) => {
                              setSelectedReferral((prev) => prev ? { ...prev, ...updated } : prev);
                              refetch();
                              refetchExpiryEmailStatus();
                              toast({ title: "Aviso D-1 reenviado com sucesso" });
                            },
                            onError: () => toast({ title: "Erro ao reenviar aviso D-1", variant: "destructive" }),
                          },
                        );
                      }}
                    >
                      <Mail className="w-4 h-4 mr-2" />
                      Reenviar aviso D-1
                    </Button>
                  )}
                </>
              );
            })()}
            {selectedReferral && selectedReferral.status === REFERRAL_STATUS.COMPLETED && !selectedReferral.bonusBlocked && !selectedReferral.bonusReleaseNotifiedAt && (
              <Button
                variant="outline"
                className="border-blue-400 text-blue-700 hover:bg-blue-50"
                disabled={resendBonus.isPending}
                onClick={() => {
                  resendBonus.mutate(
                    { id: selectedReferral.id },
                    {
                      onSuccess: (updated) => {
                        setSelectedReferral((prev) => prev ? { ...prev, ...updated } : prev);
                        refetch();
                        refetchBonusReleaseEmailStatus();
                        toast({ title: "Notificação de liberação de bônus reenviada com sucesso" });
                      },
                      onError: () => toast({ title: "Erro ao reenviar notificação de bônus", variant: "destructive" }),
                    },
                  );
                }}
              >
                <Mail className="w-4 h-4 mr-2" />
                Reenviar notificação de bônus
              </Button>
            )}
            {selectedReferral && selectedReferral.status === REFERRAL_STATUS.COMPLETED && !selectedReferral.bonusPaid && (
              <Button
                onClick={() => { setDetailModalOpen(false); openPayBonusDialog(selectedReferral); }}
                className="bg-green-600 hover:bg-green-700"
              >
                <Wallet className="w-4 h-4 mr-2" />
                Pagar Bônus
              </Button>
            )}
            {selectedReferral && selectedReferral.status === REFERRAL_STATUS.COMPLETED && (me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.AGENCY_MANAGER || me?.role === ROLES.SUPER_ADMIN) && (
              <Button
                variant="outline"
                className="border-red-300 text-red-700 hover:bg-red-50"
                onClick={() => { setDetailModalOpen(false); openReverseBonusDialog(selectedReferral); }}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Reverter bônus
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Modal */}
      <Dialog open={settingsModalOpen} onOpenChange={setSettingsModalOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurações do Programa de Indicações</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">

            {/* Ativação do Programa */}
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ativação do Programa</p>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Programa ativo</Label>
                  <p className="text-xs text-muted-foreground">Ativar ou desativar o programa de indicações</p>
                </div>
                <Switch
                  checked={localSettings.isEnabled ?? true}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, isEnabled: v }))}
                />
              </div>
            </div>

            {/* Benefícios para o Indicado */}
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Benefícios para o Indicado</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tipo de desconto</Label>
                  <Select
                    value={localSettings.discountType ?? "percentage"}
                    onValueChange={(v) => setLocalSettings((s) => ({ ...s, discountType: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentual (%)</SelectItem>
                      <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>
                    {localSettings.discountType === "fixed" ? "Desconto (R$)" : "Desconto (%)"}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={localSettings.discountValue ?? "5.00"}
                    onChange={(e) => setLocalSettings((s) => ({ ...s, discountValue: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Validade do benefício para o indicado (dias)</Label>
                <Input
                  type="number"
                  value={(localSettings as Record<string, unknown>).discountExpirationDays as number ?? 30}
                  onChange={(e) => setLocalSettings((s) => ({ ...(s as object), discountExpirationDays: parseInt(e.target.value) || 30 } as typeof s))}
                />
                <p className="text-xs text-muted-foreground">Por quantos dias o desconto gerado pelo código permanece válido após ser aplicado.</p>
              </div>
            </div>

            {/* Recompensa para o Indicador */}
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recompensa para o Indicador</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tipo de bônus</Label>
                  <Select
                    value={localSettings.bonusType ?? "credit"}
                    onValueChange={(v) => setLocalSettings((s) => ({ ...s, bonusType: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit">Crédito</SelectItem>
                      <SelectItem value="cash">Dinheiro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Bônus (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={localSettings.bonusValue ?? "10.00"}
                    onChange={(e) => setLocalSettings((s) => ({ ...s, bonusValue: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Período de carência do bônus (dias)</Label>
                <Input
                  type="number"
                  min="0"
                  value={(localSettings as Record<string, unknown>).gracePeriodDays as number ?? 30}
                  onChange={(e) => setLocalSettings((s) => ({ ...(s as object), gracePeriodDays: Math.max(0, parseInt(e.target.value) || 0) } as typeof s))}
                />
                <p className="text-xs text-muted-foreground">Quantos dias após a conversão o bônus fica retido antes de ser liberado ao indicador. O bônus é revertido automaticamente se a reserva ou excursão for cancelada nesse período.</p>
              </div>
              <div className="space-y-1">
                <Label>Validade do crédito/bônus do indicador (dias)</Label>
                <Input
                  type="number"
                  min="0"
                  value={(localSettings as Record<string, unknown>).bonusValidityDays as number ?? 30}
                  onChange={(e) => setLocalSettings((s) => ({ ...(s as object), bonusValidityDays: Math.max(0, parseInt(e.target.value) || 0) } as typeof s))}
                />
                <p className="text-xs text-muted-foreground">Por quantos dias o bônus permanece válido para resgate após ser liberado ao indicador. Use 0 para não expirar.</p>
              </div>
            </div>

            {/* Elegibilidade e Limites */}
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Elegibilidade e Limites</p>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Exigir primeira compra</Label>
                  <p className="text-xs text-muted-foreground">Bônus só é liberado após a primeira compra do indicado</p>
                </div>
                <Switch
                  checked={localSettings.requireFirstPurchase ?? true}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, requireFirstPurchase: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Permitir auto-indicação</Label>
                  <p className="text-xs text-muted-foreground">Permite que alguém use seu próprio código</p>
                </div>
                <Switch
                  checked={localSettings.allowSelfReferral ?? false}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, allowSelfReferral: v }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Valor mínimo de compra (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={String((localSettings as Record<string, unknown>).minPurchaseAmount ?? "")}
                  onChange={(e) => setLocalSettings((s) => ({ ...(s as object), minPurchaseAmount: e.target.value === "" ? null : e.target.value } as typeof s))}
                  placeholder="Sem mínimo"
                />
                <p className="text-xs text-muted-foreground">Valor mínimo do pedido para que o código de indicação seja aceito. Deixe em branco para não exigir.</p>
              </div>
              <div className="space-y-1">
                <Label>Máximo de indicações por indicador</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={String((localSettings as Record<string, unknown>).maxReferralsPerUser ?? 0)}
                  onChange={(e) => setLocalSettings((s) => ({ ...(s as object), maxReferralsPerUser: Math.max(0, parseInt(e.target.value) || 0) } as typeof s))}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">Número máximo de indicações que cada cliente pode fazer. Use 0 para ilimitado.</p>
              </div>
            </div>

            {/* Política de Códigos */}
            <div className="border rounded-lg p-3 space-y-3 bg-amber-50/60">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Política de Códigos</p>
              <div className="space-y-1">
                <Label>Validade de indicação pendente (dias)</Label>
                <Input
                  type="number"
                  value={localSettings.expirationDays ?? 30}
                  onChange={(e) => setLocalSettings((s) => ({ ...s, expirationDays: parseInt(e.target.value) || 30 }))}
                />
                <p className="text-xs text-muted-foreground">Por quantos dias uma indicação pendente aguarda conversão antes de expirar.</p>
              </div>
              <div className="rounded-md bg-amber-100/70 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
                <p className="font-medium">Códigos são permanentes e gerenciados pela agência</p>
                <p>Cada cliente possui um código único, gerado automaticamente no cadastro. Os códigos não expiram e não podem ser alterados ou regenerados pelo cliente — apenas a agência pode ativar ou bloquear um código. Ao desativar ou bloquear um cliente, seu código de indicação é bloqueado automaticamente.</p>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Mensagem de compartilhamento</Label>
              <Input
                value={localSettings.shareMessage as string ?? ""}
                onChange={(e) => setLocalSettings((s) => ({ ...s, shareMessage: e.target.value }))}
                placeholder="Use meu código e ganhe desconto na sua viagem!"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs text-green-700 border-green-400 hover:bg-green-50"
                disabled={testWhatsApp.isPending}
                onClick={() => sendWhatsAppTest("share")}
              >
                {testWhatsApp.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <MessageCircle className="w-3 h-3 mr-1" />}
                Testar mensagem
              </Button>
              <p className="text-xs text-muted-foreground">
                Variáveis disponíveis:{" "}
                <code className="bg-muted px-1 rounded">{"{nome}"}</code> nome do indicador,{" "}
                <code className="bg-muted px-1 rounded">{"{codigo}"}</code> código de indicação,{" "}
                <code className="bg-muted px-1 rounded">{"{link}"}</code> link de indicação,{" "}
                <code className="bg-muted px-1 rounded">{"{bonus}"}</code> valor do bônus.{" "}
                Ex.: <em>Olá {"{nome}"}! Use o código <strong>{"{codigo}"}</strong> ou acesse {"{link}"} e ganhe {"{bonus}"}.</em>
              </p>
              {(localSettings.shareMessage as string)?.trim() && (
                <p className="text-xs text-muted-foreground bg-muted/50 border rounded px-2 py-1.5">
                  <span className="font-medium text-muted-foreground">Pré-visualização:</span>{" "}
                  {(localSettings.shareMessage as string)
                    .replace(/\{nome\}/g, "João")
                    .replace(/\{codigo\}/g, "JOAO123")
                    .replace(/\{link\}/g, "https://exemplo.com.br/ind/JOAO123")
                    .replace(/\{bonus\}/g, fmtCurrency(settings?.bonusValue ?? 10))}
                </p>
              )}
              {localSettings.whatsappEnabled && (localSettings.shareMessage as string)?.trim() && (
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {whatsappTestState.share?.success && (
                    <p className="text-[11px] text-green-600 flex items-center gap-1 mr-auto"><Check className="w-3 h-3" /> Enviado com sucesso!</p>
                  )}
                  {whatsappTestState.share?.error && (
                    <p className="text-[11px] text-red-500 flex items-center gap-1 mr-auto"><XCircle className="w-3 h-3" /> {whatsappTestState.share.error}</p>
                  )}
                  <button
                    type="button"
                    disabled={!!whatsappTestState.share?.loading}
                    onClick={() => void testWhatsappTemplate("share")}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {whatsappTestState.share?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Testar via WhatsApp
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3 border rounded-lg p-3 bg-indigo-50/50">
              <Label className="flex items-center gap-1.5 font-semibold text-indigo-800">
                <span className="text-base">⭐</span>
                Pontos de fidelidade por indicação
              </Label>
              <div className="space-y-1">
                <Label className="text-xs">Pontos por indicação confirmada</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={String(localSettings.pointsPerReferral ?? 0)}
                  onChange={(e) => setLocalSettings((s) => ({ ...s, pointsPerReferral: Math.max(0, parseInt(e.target.value) || 0) }))}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  Quantos pontos de fidelidade o indicador ganha por indicação convertida. Use 0 para desativar.
                </p>
              </div>
            </div>

            <div className="space-y-3 border rounded-lg p-3 bg-amber-50/50">
              <Label className="flex items-center gap-1.5 font-semibold text-amber-800">
                <span className="text-base">⏰</span>
                Avisos de vencimento por e-mail
              </Label>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-normal">Aviso 7 dias antes</Label>
                  <p className="text-xs text-muted-foreground">Envia e-mail quando faltam 7 dias para o código vencer</p>
                </div>
                <Switch
                  checked={localSettings.expiryWarning7DaysEnabled ?? true}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, expiryWarning7DaysEnabled: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-normal">Aviso 1 dia antes</Label>
                  <p className="text-xs text-muted-foreground">Envia e-mail quando falta 1 dia para o código vencer</p>
                </div>
                <Switch
                  checked={localSettings.expiryWarning1DayEnabled ?? true}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, expiryWarning1DayEnabled: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-normal">Aviso de bônus liberado</Label>
                  <p className="text-xs text-muted-foreground">Envia e-mail ao indicador quando o período de carência de {(localSettings as Record<string, unknown>).gracePeriodDays != null ? Number((localSettings as Record<string, unknown>).gracePeriodDays) : (settings?.gracePeriodDays ?? 30)} dias expira e o bônus está disponível</p>
                </div>
                <Switch
                  checked={localSettings.bonusReleaseEmailEnabled ?? true}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, bonusReleaseEmailEnabled: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-normal">Pontos de fidelidade creditados</Label>
                  <p className="text-xs text-muted-foreground">Envia e-mail ao indicador quando pontos de fidelidade são creditados por uma indicação convertida</p>
                </div>
                <Switch
                  checked={(localSettings as Record<string, unknown>).loyaltyPointsEmailEnabled !== false}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, loyaltyPointsEmailEnabled: v }))}
                />
              </div>
            </div>

            <div className="space-y-3 border rounded-lg p-3 bg-green-50/50">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 font-semibold text-green-800">
                  <Phone className="w-4 h-4" />
                  Notificações WhatsApp
                </Label>
                <Switch
                  checked={localSettings.whatsappEnabled ?? false}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, whatsappEnabled: v }))}
                />
              </div>
              {localSettings.whatsappEnabled && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Número WhatsApp Business da agência</Label>
                    <Input
                      value={localSettings.whatsappPhoneNumber as string ?? ""}
                      onChange={(e) => setLocalSettings((s) => ({ ...s, whatsappPhoneNumber: e.target.value }))}
                      placeholder="5511999999999 (código do país + DDD + número)"
                    />
                    <p className="text-[11px] text-muted-foreground">Número configurado na sua instância Z-API. Apenas para referência — as mensagens são enviadas via Z-API.</p>
                  </div>
                  <div className="space-y-1 border border-dashed border-muted-foreground/30 rounded-md p-2.5 bg-muted/20">
                    <Label className="text-[11px] font-medium text-muted-foreground">Número de destino para teste</Label>
                    <Input
                      className="h-7 text-xs"
                      value={whatsappTestPhone}
                      onChange={(e) => setWhatsappTestPhone(e.target.value)}
                      placeholder="5511999999999 (DDI+DDD+número)"
                    />
                    <p className="text-[10px] text-muted-foreground">Use seu próprio WhatsApp para testar os modelos abaixo.</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Mensagem — conversão confirmada</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px] resize-y"
                      value={localSettings.whatsappConvertedMessage as string ?? ""}
                      onChange={(e) => setLocalSettings((s) => ({ ...s, whatsappConvertedMessage: e.target.value }))}
                      placeholder="Boa notícia! {nome} usou seu código {codigo} e comprou com a {agencia}. Seu bônus de R$ {valor} está sendo processado."
                    />
                    {(() => {
                      const len = ((localSettings.whatsappConvertedMessage as string) ?? "").length;
                      if (len === 0) return null;
                      const isWarn = len >= 800 && len < 1000;
                      const isError = len >= 1000;
                      return (
                        <p className={`text-[10px] text-right ${isError ? "text-red-500" : isWarn ? "text-amber-500" : "text-muted-foreground"}`}>
                          {len} caracteres{isError ? " · pode ser recusada pelo WhatsApp" : isWarn ? " · mensagem longa" : ""}
                        </p>
                      );
                    })()}
                    <p className="text-[11px] text-muted-foreground">
                      Variáveis:{" "}
                      <code className="bg-muted px-1 rounded">{"{nome}"}</code> nome do indicado,{" "}
                      <code className="bg-muted px-1 rounded">{"{codigo}"}</code> código de indicação,{" "}
                      <code className="bg-muted px-1 rounded">{"{agencia}"}</code> nome da agência,{" "}
                      <code className="bg-muted px-1 rounded">{"{valor}"}</code> valor do bônus.
                    </p>
                    {(localSettings.whatsappConvertedMessage as string)?.trim() && (
                      <p className="text-[11px] text-muted-foreground bg-muted/50 border rounded px-2 py-1.5">
                        <span className="font-medium text-muted-foreground">Pré-visualização:</span>{" "}
                        {(() => {
                          const sub = (tpl: string, key: string, value: string) =>
                            tpl.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value)
                               .replace(new RegExp(`\\{${key}\\}`, "g"), value);
                          const valorFormatted = (settings?.bonusValue ?? 10).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          let msg = localSettings.whatsappConvertedMessage as string;
                          msg = sub(msg, "nome", "Maria");
                          msg = sub(msg, "codigo", "JOAO123");
                          msg = sub(msg, "agencia", tenantName);
                          msg = sub(msg, "valor", valorFormatted);
                          return msg;
                        })()}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {whatsappTestState.converted?.success && (
                        <p className="text-[11px] text-green-600 flex items-center gap-1 mr-auto"><Check className="w-3 h-3" /> Enviado com sucesso!</p>
                      )}
                      {whatsappTestState.converted?.error && (
                        <p className="text-[11px] text-red-500 flex items-center gap-1 mr-auto"><XCircle className="w-3 h-3" /> {whatsappTestState.converted.error}</p>
                      )}
                      <button
                        type="button"
                        disabled={!!whatsappTestState.converted?.loading}
                        onClick={() => void testWhatsappTemplate("converted")}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {whatsappTestState.converted?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        Testar envio
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Mensagem — bônus pago</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px] resize-y"
                      value={localSettings.whatsappBonusPaidMessage as string ?? ""}
                      onChange={(e) => setLocalSettings((s) => ({ ...s, whatsappBonusPaidMessage: e.target.value }))}
                      placeholder="Seu bônus de R$ {{valor}} foi pago! Obrigado por indicar clientes para a {{agencia}}."
                    />
                    {(() => {
                      const len = ((localSettings.whatsappBonusPaidMessage as string) ?? "").length;
                      if (len === 0) return null;
                      const isWarn = len >= 800 && len < 1000;
                      const isError = len >= 1000;
                      return (
                        <p className={`text-[10px] text-right ${isError ? "text-red-500" : isWarn ? "text-amber-500" : "text-muted-foreground"}`}>
                          {len} caracteres{isError ? " · pode ser recusada pelo WhatsApp" : isWarn ? " · mensagem longa" : ""}
                        </p>
                      );
                    })()}
                    <p className="text-[11px] text-muted-foreground">
                      Variáveis:{" "}
                      <code className="bg-muted px-1 rounded">{"{nome}"}</code> nome do indicador,{" "}
                      <code className="bg-muted px-1 rounded">{"{codigo}"}</code> código de indicação,{" "}
                      <code className="bg-muted px-1 rounded">{"{bonus}"}</code> valor do bônus,{" "}
                      <code className="bg-muted px-1 rounded">{"{valor}"}</code> valor numérico,{" "}
                      <code className="bg-muted px-1 rounded">{"{agencia}"}</code> nome da agência.
                    </p>
                    {(localSettings.whatsappBonusPaidMessage as string)?.trim() && (
                      <p className="text-[11px] text-muted-foreground bg-muted/50 border rounded px-2 py-1.5">
                        <span className="font-medium text-muted-foreground">Pré-visualização:</span>{" "}
                        {(() => {
                          const sub = (tpl: string, key: string, value: string) =>
                            tpl.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value)
                               .replace(new RegExp(`\\{${key}\\}`, "g"), value);
                          const bonusFormatted = fmtCurrency(settings?.bonusValue ?? 10);
                          const valorFormatted = (settings?.bonusValue ?? 10).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          let msg = localSettings.whatsappBonusPaidMessage as string;
                          msg = sub(msg, "nome", "João");
                          msg = sub(msg, "codigo", "JOAO123");
                          msg = sub(msg, "bonus", bonusFormatted);
                          msg = sub(msg, "valor", valorFormatted);
                          msg = sub(msg, "agencia", tenantName);
                          return msg;
                        })()}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {whatsappTestState.bonusPaid?.success && (
                        <p className="text-[11px] text-green-600 flex items-center gap-1 mr-auto"><Check className="w-3 h-3" /> Enviado com sucesso!</p>
                      )}
                      {whatsappTestState.bonusPaid?.error && (
                        <p className="text-[11px] text-red-500 flex items-center gap-1 mr-auto"><XCircle className="w-3 h-3" /> {whatsappTestState.bonusPaid.error}</p>
                      )}
                      <button
                        type="button"
                        disabled={!!whatsappTestState.bonusPaid?.loading}
                        onClick={() => void testWhatsappTemplate("bonusPaid")}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {whatsappTestState.bonusPaid?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        Testar envio
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Mensagem de estorno (reversão de bônus)</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px] resize-y"
                      value={localSettings.whatsappReversedMessage as string ?? ""}
                      onChange={(e) => setLocalSettings((s) => ({ ...s, whatsappReversedMessage: e.target.value }))}
                      placeholder="Olá! A reserva de {{nome}} foi cancelada e o bônus de R$ {{valor}} foi estornado do seu saldo na {{agencia}}. Seu saldo atual é R$ {{saldo}}."
                    />
                    {(() => {
                      const len = ((localSettings.whatsappReversedMessage as string) ?? "").length;
                      if (len === 0) return null;
                      const isWarn = len >= 800 && len < 1000;
                      const isError = len >= 1000;
                      return (
                        <p className={`text-[10px] text-right ${isError ? "text-red-500" : isWarn ? "text-amber-500" : "text-muted-foreground"}`}>
                          {len} caracteres{isError ? " · pode ser recusada pelo WhatsApp" : isWarn ? " · mensagem longa" : ""}
                        </p>
                      );
                    })()}
                    <p className="text-[11px] text-muted-foreground">
                      Variáveis:{" "}
                      <code className="bg-muted px-1 rounded">{"{nome}"}</code> nome do indicado,{" "}
                      <code className="bg-muted px-1 rounded">{"{valor}"}</code> valor do bônus estornado,{" "}
                      <code className="bg-muted px-1 rounded">{"{agencia}"}</code> nome da agência,{" "}
                      <code className="bg-muted px-1 rounded">{"{saldo}"}</code> saldo atual.
                    </p>
                    {(localSettings.whatsappReversedMessage as string)?.trim() && (
                      <p className="text-[11px] text-muted-foreground bg-muted/50 border rounded px-2 py-1.5">
                        <span className="font-medium text-muted-foreground">Pré-visualização:</span>{" "}
                        {(() => {
                          const sub = (tpl: string, key: string, value: string) =>
                            tpl.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value)
                               .replace(new RegExp(`\\{${key}\\}`, "g"), value);
                          const valorFormatted = (settings?.bonusValue ?? 10).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          let msg = localSettings.whatsappReversedMessage as string;
                          msg = sub(msg, "nome", "Maria");
                          msg = sub(msg, "valor", valorFormatted);
                          msg = sub(msg, "agencia", tenantName);
                          msg = sub(msg, "saldo", "0,00");
                          return msg;
                        })()}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {whatsappTestState.reversed?.success && (
                        <p className="text-[11px] text-green-600 flex items-center gap-1 mr-auto"><Check className="w-3 h-3" /> Enviado com sucesso!</p>
                      )}
                      {whatsappTestState.reversed?.error && (
                        <p className="text-[11px] text-red-500 flex items-center gap-1 mr-auto"><XCircle className="w-3 h-3" /> {whatsappTestState.reversed.error}</p>
                      )}
                      <button
                        type="button"
                        disabled={!!whatsappTestState.reversed?.loading}
                        onClick={() => void testWhatsappTemplate("reversed")}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {whatsappTestState.reversed?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        Testar envio
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5" />
                Níveis de Gamificação
              </Label>
              <p className="text-xs text-muted-foreground">
                Configure os limiares de indicações convertidas e o multiplicador de bônus de cada nível.
              </p>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Nível</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Mín. convert.</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Multiplicador</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(localSettings.tiersConfig ?? DEFAULT_TIERS).map((tier, idx) => {
                      const visual = TIER_VISUAL[tier.level] ?? { bg: "bg-gray-100", color: "text-gray-600" };
                      return (
                        <tr key={tier.level}>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${visual.bg} ${visual.color}`}>
                              <Star className="w-3 h-3" />
                              {tier.label}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min={0}
                              value={tier.minReferrals}
                              disabled={idx === 0}
                              className="h-7 w-20 text-xs"
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                setLocalSettings((s) => {
                                  const tiers = [...(s.tiersConfig ?? DEFAULT_TIERS)];
                                  tiers[idx] = { ...tiers[idx], minReferrals: val };
                                  return { ...s, tiersConfig: tiers };
                                });
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={0.1}
                                step={0.05}
                                value={tier.bonusMultiplier}
                                className="h-7 w-20 text-xs"
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 1;
                                  setLocalSettings((s) => {
                                    const tiers = [...(s.tiersConfig ?? DEFAULT_TIERS)];
                                    tiers[idx] = { ...tiers[idx], bonusMultiplier: val };
                                    return { ...s, tiersConfig: tiers };
                                  });
                                }}
                              />
                              <span className="text-xs text-muted-foreground">×</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsModalOpen(false)}>Cancelar</Button>
            <Button onClick={saveSettings} disabled={updateSettings.isPending}>
              {updateSettings.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

    {/* Campaigns management dialog */}
    <Dialog open={campaignsDialogOpen} onOpenChange={setCampaignsDialogOpen}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" />
            Campanhas de Indicação
          </DialogTitle>
          <DialogDescription>
            Crie promoções temporárias de bônus — apenas uma campanha pode estar ativa por vez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Active campaign notice */}
          {activeCampaignAdmin && (
            <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              <Flame className="w-4 h-4 mt-0.5 shrink-0 text-green-600" />
              <span>
                <span className="font-semibold">Campanha ativa agora:</span> {activeCampaignAdmin.name} — termina em{" "}
                {new Date(activeCampaignAdmin.endsAt).toLocaleString("pt-BR")}
              </span>
            </div>
          )}

          {/* Create form toggle */}
          {!showCampaignForm ? (
            <Button variant="outline" onClick={() => setShowCampaignForm(true)}>
              <Megaphone className="w-4 h-4 mr-2" />
              Nova campanha
            </Button>
          ) : (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm">Nova campanha</p>
                <Button variant="ghost" size="sm" onClick={() => { setShowCampaignForm(false); setEditingCampaignId(null); setCampaignFormData({ name: "", startsAt: "", endsAt: "", bonusType: "multiplier", bonusValue: "2", bannerText: "" }); }}>
                  <XCircle className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-1">
                <Label>Nome da campanha *</Label>
                <Input
                  value={campaignFormData.name}
                  onChange={(e) => setCampaignFormData((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Bônus Duplo de Maio, Promoção Férias"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Início *</Label>
                  <Input
                    type="datetime-local"
                    value={campaignFormData.startsAt}
                    onChange={(e) => setCampaignFormData((f) => ({ ...f, startsAt: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Término *</Label>
                  <Input
                    type="datetime-local"
                    value={campaignFormData.endsAt}
                    onChange={(e) => setCampaignFormData((f) => ({ ...f, endsAt: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Tipo de bônus *</Label>
                  <Select
                    value={campaignFormData.bonusType}
                    onValueChange={(v) => setCampaignFormData((f) => ({ ...f, bonusType: v as "multiplier" | "fixed_extra" }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multiplier">Multiplicador (×) — ex: 2× o bônus base</SelectItem>
                      <SelectItem value="fixed_extra">Valor extra (R$) — ex: +R$ 20 ao bônus</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>
                    {campaignFormData.bonusType === "multiplier" ? "Multiplicador *" : "Valor extra (R$) *"}
                  </Label>
                  <Input
                    type="number"
                    min={campaignFormData.bonusType === "multiplier" ? 1 : 0.5}
                    step={campaignFormData.bonusType === "multiplier" ? 0.1 : 0.5}
                    value={campaignFormData.bonusValue}
                    onChange={(e) => setCampaignFormData((f) => ({ ...f, bonusValue: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    {campaignFormData.bonusType === "multiplier"
                      ? `Bônus base × ${campaignFormData.bonusValue || "?"} durante a campanha`
                      : `Bônus base + R$ ${campaignFormData.bonusValue || "?"} durante a campanha`}
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <Label>
                  Texto do banner{" "}
                  <span className="text-muted-foreground font-normal text-xs">(opcional)</span>
                </Label>
                <Input
                  value={campaignFormData.bannerText}
                  onChange={(e) => setCampaignFormData((f) => ({ ...f, bannerText: e.target.value }))}
                  placeholder="Ex: Bônus dobrado esse fim de semana!"
                />
                <p className="text-xs text-muted-foreground">
                  Exibido no app do cliente durante a campanha. Deixe vazio para texto automático.
                </p>
              </div>

              <Button onClick={handleSaveCampaign} disabled={createCampaign.isPending || updateCampaign.isPending}>
                {(createCampaign.isPending || updateCampaign.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {(createCampaign.isPending || updateCampaign.isPending)
                  ? "Salvando..."
                  : editingCampaignId ? "Salvar alterações" : "Criar campanha"}
              </Button>
            </div>
          )}

          {/* Campaigns list */}
          {campaigns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
              Nenhuma campanha criada ainda
            </div>
          ) : (
            <div className="space-y-2">
              {campaigns.map((c) => {
                const status = getCampaignStatus(c);
                return (
                  <div key={c.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {status === "active" ? (
                          <Badge className="bg-green-500 text-white">Ativa</Badge>
                        ) : status === "upcoming" ? (
                          <Badge variant="outline" className="border-blue-400 text-blue-600">Agendada</Badge>
                        ) : (
                          <Badge variant="secondary">Encerrada</Badge>
                        )}
                        <span className="font-medium text-sm">{c.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(c.startsAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                        {" → "}
                        {new Date(c.endsAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                      </p>
                      <p className="text-xs mt-0.5 font-medium">
                        {c.bonusType === "multiplier"
                          ? `× ${Number(c.bonusValue).toFixed(2).replace(".00","")} no bônus`
                          : `+ ${fmtCurrency(Number(c.bonusValue))} de bônus extra`}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {c.referralsCount ?? 0} conversão{(c.referralsCount ?? 0) !== 1 ? "ões" : ""} · {fmtCurrency(c.bonusPaidAmount ?? 0)} pagos
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => handleEditCampaign(c)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleDeleteCampaign(c.id)}
                        disabled={deleteCampaign.isPending}
                      >
                        <Ban className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

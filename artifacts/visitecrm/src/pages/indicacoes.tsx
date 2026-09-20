import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
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
  testWhatsAppMessage,
  useGetCurrentSubscription,
  useGetReferralCommissionReport,
  useReversePaidReferralBonus,
} from "@workspace/api-client-react";
import type { Referral, ReferralSettings, ReferralTierConfig, ReferralAnalyticsPeriod, ReferralCampaign } from "@workspace/api-client-react";
import { REFERRAL_STATUS, ROLES } from "@workspace/permissions";
import { getReferralCampaignRewardLabel, getReferralRewardLabel } from "@/lib/referral-labels";
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
import { ReferralOverview } from "@/components/referral-overview";
import { ReferralTableSection } from "@/components/referral-table-section";
import { ReferralCommissionSummary } from "@/components/referral-commission-summary";
import { ReferralAnalyticsSection } from "@/components/referral-analytics-section";
import { ReferralSettingsDialog } from "@/components/referral-settings-dialog";
import { ReferralCampaignsDialog, type CampaignDraft } from "@/components/referral-campaigns-dialog";
import { ReferralOperationalDialogs } from "@/components/referral-operational-dialogs";
import { ReferralShareDialog } from "@/components/referral-share-dialog";
import { ReferralDetailDialog } from "@/components/referral-detail-dialog";
import { PlanFeatureWall, canUpgradeForFeature, getRequiredPlanLabel } from "@/components/plan-limit-wall";
import type { LinkedData } from "@/lib/linked-data";

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

type EnrichedReferral = Referral & LinkedData & {
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
  const { data: commissionReport } = useGetReferralCommissionReport();
  const { data: settings, refetch: refetchSettings } = useGetReferralSettings();
  const updateReferral = useUpdateReferral();
  const updateSettings = useUpdateReferralSettings();
  const payBonus = usePayReferralBonus();
  const resendWarning = useResendExpiryWarning();
  const resendBonus = useResendBonusRelease();
  const reverseBonus = useReverseReferralBonus();
  const reversePaidBonus = useReversePaidReferralBonus();
  const { data: me } = useGetMe();
  const queryClient = useQueryClient();

  async function refreshReferralData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/referrals"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/stats"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/analytics"] }),
      queryClient.invalidateQueries({ queryKey: ["referrals", "commissions", "report"] }),
    ]);
  }

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
        refreshReferralData(),
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
  const {
    data: analyticsData,
    isLoading: analyticsLoading,
    isError: analyticsError,
  } = useGetReferralAnalytics(analyticsPeriod);

  const [whatsappTestPhone, setWhatsappTestPhone] = useState("");
  const [whatsappTestState, setWhatsappTestState] = useState<Record<string, { loading?: boolean; success?: boolean; error?: string }>>({});
  const [settingsWhatsappTestLoading, setSettingsWhatsappTestLoading] = useState(false);
  const whatsappTestInFlight = useRef(new Set<string>());

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
  const [referralsPage, setReferralsPage] = useState(1);
  const [selectedBonusIds, setSelectedBonusIds] = useState<Set<string>>(new Set());
  const [bulkPayDialogOpen, setBulkPayDialogOpen] = useState(false);
  const [bulkPaying, setBulkPaying] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareReferralId, setShareReferralId] = useState<string | null>(null);
  const [shareReferral, setShareReferral] = useState<EnrichedReferral | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);

  const referralListParams = {
    page: referralsPage,
    limit: 100,
    status: statusFilter !== "all" && statusFilter !== "expiringSoon" && !fraudFilter ? statusFilter : undefined,
    search: searchQuery.trim() || undefined,
    bonusPaid: bonusFilter === "unpaid" ? false : undefined,
    fraudFlag: fraudFilter ? true : undefined,
    expiringSoon: statusFilter === "expiringSoon" ? true : undefined,
    bonusNotified: bonusNotifiedFilter === "all" ? undefined : bonusNotifiedFilter === "notified",
  };
  const referralStatsParams = {
    status: referralListParams.status,
    search: referralListParams.search,
    bonusPaid: referralListParams.bonusPaid,
    fraudFlag: referralListParams.fraudFlag,
    expiringSoon: referralListParams.expiringSoon,
    bonusNotified: referralListParams.bonusNotified,
  };
  const { data: stats, isLoading: statsLoading, isError: statsError } = useGetReferralStats(referralStatsParams);
  const {
    data: referralsResponse,
    isLoading: referralsLoading,
    isFetching: referralsFetching,
    isError: referralsError,
  } = useListReferrals(referralListParams);
  const referrals = ((referralsResponse as { data?: EnrichedReferral[] } | undefined)?.data
    ?? (Array.isArray(referralsResponse) ? referralsResponse as EnrichedReferral[] : [])) as EnrichedReferral[];
  const referralsPagination = (referralsResponse as {
    pagination?: { page: number; limit: number; total: number; totalPages: number };
  } | undefined)?.pagination;
  const referralTotal = referralsPagination?.total ?? referrals.length;
  const referralPageCount = Math.max(1, referralsPagination?.totalPages ?? 1);

  useEffect(() => {
    setReferralsPage(1);
    setSelectedBonusIds(new Set());
  }, [searchQuery, statusFilter, bonusFilter, fraudFilter, bonusNotifiedFilter]);

  useEffect(() => {
    if (referralsPage > 1 && referralsPage > referralPageCount) {
      setReferralsPage(referralPageCount);
      setSelectedBonusIds(new Set());
    }
  }, [referralPageCount, referralsPage]);

  useEffect(() => {
    setSelectedBonusIds(new Set());
  }, [referralsPage]);

  useEffect(() => {
    if (!selectedReferral) return;
    const current = referrals.find((referral) => referral.id === selectedReferral.id);
    if (current) {
      setSelectedReferral((previous) => previous ? { ...previous, ...current } : current);
    }
  }, [referrals, selectedReferral?.id]);

  const [campaignsDialogOpen, setCampaignsDialogOpen] = useState(false);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignFormData, setCampaignFormData] = useState<CampaignDraft>({
    name: "", startsAt: "", endsAt: "",
    bonusType: "multiplier" as "multiplier" | "fixed_extra" | "fixed_bonus" | "percentage_bonus" | "reduced_bonus" | "no_reward",
    bonusValue: "2", bannerText: "",
    eligibleStoreProductIds: "",
    eligibleTierLevels: [] as string[],
    conversionCap: "",
    budgetAmount: "",
    shareMessage: "",
    materialUrl: "",
    publicRanking: true,
    eligibleActivitySegments: [] as Array<"active" | "occasional" | "inactive">,
    eligibleChannels: "",
    commissionType: "none" as "none" | "fixed" | "bonus_percentage",
    commissionValue: "0",
    commissionRecipientType: "ambassador" as "ambassador" | "partner",
    eligiblePartnerIds: "",
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
      await Promise.all([
        refetchSettings(),
        refreshReferralData(),
      ]);
      setSettingsModalOpen(false);
    } catch {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    }
  }

  function beginWhatsAppTest(scope: string): string | null {
    if (whatsappTestInFlight.current.has(scope)) return null;
    whatsappTestInFlight.current.add(scope);
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function endWhatsAppTest(scope: string) {
    whatsappTestInFlight.current.delete(scope);
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
    const scope = `settings:${type}`;
    const attemptId = beginWhatsAppTest(scope);
    if (!attemptId) return;
    setSettingsWhatsappTestLoading(true);
    try {
      await testWhatsAppMessage(
        { type, message },
        { headers: { "Idempotency-Key": attemptId } },
      );
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
    } finally {
      endWhatsAppTest(scope);
      setSettingsWhatsappTestLoading(false);
    }
  }

  async function handleDeactivate(r: EnrichedReferral) {
    try {
      await updateReferral.mutateAsync({
        id: r.id,
        data: { isActive: false, status: "expired" },
      });
      toast({ title: "Indicação desativada" });
      await refreshReferralData();
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
      const updated = reverseBonusTarget.bonusPaid
        ? await reversePaidBonus.mutateAsync({
            id: reverseBonusTarget.id,
            data: { reason: reverseBonusReason.trim(), confirmed: true },
          })
        : await reverseBonus.mutateAsync({
            id: reverseBonusTarget.id,
            data: { reason: reverseBonusReason.trim() },
          });
      toast({
        title: reverseBonusTarget.bonusPaid ? "Estorno financeiro registrado" : "Bônus revertido com sucesso",
        description: "O indicador será notificado por e-mail.",
      });
      await refreshReferralData();
      setReverseBonusDialogOpen(false);
      setReverseBonusTarget(null);
      setReverseBonusReason("");
      if (selectedReferral?.id === updated.id) {
        setSelectedReferral(updated as EnrichedReferral);
      }
    } catch {
      toast({
        title: reverseBonusTarget.bonusPaid ? "Erro ao registrar estorno financeiro" : "Erro ao reverter bônus",
        variant: "destructive",
      });
    }
  }

  async function confirmPayBonus() {
    if (!payBonusTarget) return;
    try {
      const updated = await payBonus.mutateAsync({ id: payBonusTarget.id });
      toast({ title: "Bônus marcado como pago! E-mail de confirmação enviado ao indicador." });
      await refreshReferralData();
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
    const { name, startsAt, endsAt, bonusType, bonusValue, bannerText, eligibleStoreProductIds, eligibleTierLevels, conversionCap, budgetAmount, shareMessage, materialUrl, publicRanking, eligibleActivitySegments, eligibleChannels, commissionType, commissionValue, commissionRecipientType, eligiblePartnerIds } = campaignFormData;
    if (!name.trim() || !startsAt || !endsAt) {
      toast({ title: "Preencha todos os campos obrigatórios", variant: "destructive" }); return;
    }
    const bonusNum = parseFloat(bonusValue);
    if (bonusType !== "no_reward" && (isNaN(bonusNum) || bonusNum <= 0)) {
      toast({ title: "Valor do bônus inválido", variant: "destructive" }); return;
    }
    const cVal = parseFloat(commissionValue) || 0;
    if (commissionType !== "none" && cVal <= 0) {
      toast({ title: "Valor da comissão inválido", variant: "destructive" }); return;
    }

    const payload = {
      name: name.trim(),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      bonusType,
      bonusValue: bonusType === "no_reward" ? 0 : bonusNum,
      bannerText: bannerText.trim() || undefined,
      eligibleStoreProductIds: eligibleStoreProductIds.split(",").map(s => s.trim()).filter(Boolean),
      eligibleTierLevels: eligibleTierLevels,
      conversionCap: conversionCap ? parseInt(conversionCap, 10) : null,
      budgetAmount: budgetAmount ? parseFloat(budgetAmount) : null,
      shareMessage: shareMessage.trim() || null,
      materialUrl: materialUrl.trim() || null,
      publicRanking,
      eligibleActivitySegments,
      eligibleChannels: eligibleChannels.split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
      commissionType,
      commissionValue: commissionType === "none" ? 0 : cVal,
      commissionRecipientType,
      eligiblePartnerIds: eligiblePartnerIds.split(",").map(s => s.trim()).filter(Boolean),
    };

    try {
      if (editingCampaignId) {
        await updateCampaign.mutateAsync({ id: editingCampaignId, ...payload, bannerText: payload.bannerText ?? null });
        toast({ title: "Campanha atualizada com sucesso!" });
        setEditingCampaignId(null);
      } else {
        await createCampaign.mutateAsync(payload);
        toast({ title: "Campanha criada com sucesso!" });
      }
      setCampaignFormData({
        name: "", startsAt: "", endsAt: "", bonusType: "multiplier", bonusValue: "2", bannerText: "",
        eligibleStoreProductIds: "", eligibleTierLevels: [], conversionCap: "", budgetAmount: "",
        shareMessage: "", materialUrl: "", publicRanking: true, eligibleActivitySegments: [], eligibleChannels: "", commissionType: "none", commissionValue: "0",
        commissionRecipientType: "ambassador", eligiblePartnerIds: ""
      });
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
      bonusType: c.bonusType as any,
      bonusValue: String(c.bonusValue),
      bannerText: c.bannerText ?? "",
      eligibleStoreProductIds: (c.eligibleStoreProductIds || []).join(", "),
      eligibleTierLevels: c.eligibleTierLevels || [],
      conversionCap: c.conversionCap ? String(c.conversionCap) : "",
      budgetAmount: c.budgetAmount ? String(c.budgetAmount) : "",
      shareMessage: c.shareMessage ?? "",
      materialUrl: c.materialUrl ?? "",
      publicRanking: c.publicRanking ?? true,
      eligibleActivitySegments: c.eligibleActivitySegments ?? [],
      eligibleChannels: (c.eligibleChannels ?? []).join(", "),
      commissionType: c.commissionType as any || "none",
      commissionValue: String(c.commissionValue || 0),
      commissionRecipientType: c.commissionRecipientType ?? "ambassador",
      eligiblePartnerIds: (c.eligiblePartnerIds ?? []).join(", "),
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
    await refreshReferralData();
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
    const scope = `explicit:${messageType}`;
    const attemptId = beginWhatsAppTest(scope);
    if (!attemptId) return;
    setWhatsappTestState(prev => ({ ...prev, [messageType]: { loading: true } }));
    try {
      await testWhatsAppMessage(
        { type: messageType, phone },
        { headers: { "Idempotency-Key": attemptId } },
      );
      setWhatsappTestState(prev => ({ ...prev, [messageType]: { success: true } }));
    } catch (err: unknown) {
      const apiError = (err as { data?: { error?: string; message?: string } })?.data;
      setWhatsappTestState(prev => ({
        ...prev,
        [messageType]: {
          error: apiError?.error ?? apiError?.message ?? "Erro ao enviar mensagem de teste",
        },
      }));
    } finally {
      endWhatsAppTest(scope);
    }
  }

  // The API applies every active filter before pagination. Do not filter this
  // page again locally: doing so makes the visible rows and global totals
  // disagree, especially when the current page is only a partial result.
  const filtered = referrals;
  const suspiciousCount = statsLoading || statsError ? null : (stats?.suspicious ?? 0);
  const expiringSoonCount = statsLoading || statsError ? null : (stats?.expiringSoon ?? 0);

  const settingsDiscountPct = settings ? parseFloat(String(settings.discountValue)) : 5;
  const settingsBonusVal = settings ? parseFloat(String(settings.bonusValue)) : 10;
  const isEnabled = settings?.isEnabled ?? true;
  const tenantName = (me as { tenant?: { name?: string } } | undefined)?.tenant?.name ?? "Minha Agência";

  const pendingBonusCount = statsLoading || statsError ? null : (stats?.pendingBonus ?? 0);

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
    setReferralsPage(1);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Programa de Indicações</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie indicações, conversões e pagamentos de bônus
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isEnabled && (
            <Badge variant="destructive" className="text-sm px-3 py-1">
              Programa desativado
            </Badge>
          )}
          {pendingBonusCount !== null && pendingBonusCount > 0 && (
            <Badge variant="outline" className="text-sm px-3 py-1 border-amber-400 text-amber-700 bg-amber-50">
              <Wallet className="w-3 h-3 mr-1" />
              {pendingBonusCount} bônus pendente{pendingBonusCount > 1 ? "s" : ""}
            </Badge>
          )}
          <Select
            value={bonusNotifiedFilter}
            onValueChange={(v) => {
              setReferralsPage(1);
              setBonusNotifiedFilter(v as "all" | "notified" | "not_notified");
            }}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Notif. bônus: Todos</SelectItem>
              <SelectItem value="notified">
                Notificados{stats?.bonusNotified != null ? ` (${stats.bonusNotified})` : ""}
              </SelectItem>
              <SelectItem value="not_notified">
                Não notificados{stats?.bonusNotNotified != null ? ` (${stats.bonusNotNotified})` : ""}
              </SelectItem>
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

      {/* Operational alerts use the filtered server-side aggregate, not the current page. */}
      {expiringSoonCount !== null && expiringSoonCount > 0 && (
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

      <ReferralOverview
        analyticsData={analyticsData}
        analyticsPeriod={analyticsPeriod}
        onAnalyticsPeriodChange={setAnalyticsPeriod}
        discountValue={settingsDiscountPct}
        discountType={settings?.discountType}
        bonusValue={settingsBonusVal}
        bonusLabel={getReferralRewardLabel(settings?.bonusType)}
        expirationDays={settings?.expirationDays ?? 30}
      />

      <ReferralCommissionSummary report={commissionReport} />

      <ReferralAnalyticsSection
        data={analyticsData}
        period={analyticsPeriod}
        isLoading={analyticsLoading}
        isError={analyticsError}
        analyticsExportUrl={getReferralAnalyticsExportUrl(analyticsPeriod)}
      />

      <ReferralTableSection
        referrals={referrals}
        settingsTiers={settings?.tiersConfig}
        currentUserRole={me?.role}
        activeTab={activeTab}
        searchQuery={searchQuery}
        bonusNotifiedFilter={bonusNotifiedFilter}
        onBonusNotifiedFilterChange={(value) => {
          setReferralsPage(1);
          setBonusNotifiedFilter(value);
        }}
        referralsLoading={referralsLoading}
        referralsFetching={referralsFetching}
        referralsError={referralsError}
        referralTotal={referralTotal}
        referralPageCount={referralPageCount}
        referralsPage={referralsPage}
        expiringSoonCount={expiringSoonCount}
        pendingBonusCount={pendingBonusCount}
        suspiciousCount={suspiciousCount}
        bonusNotifiedCount={statsLoading || statsError ? null : (stats?.bonusNotified ?? 0)}
        bonusNotNotifiedCount={statsLoading || statsError ? null : (stats?.bonusNotNotified ?? 0)}
        selectedBonusIds={selectedBonusIds}
        onSearchChange={(value) => {
          setReferralsPage(1);
          setSearchQuery(value);
          setSelectedBonusIds(new Set());
        }}
        onApplyTab={applyTab}
        onSelectedBonusIdsChange={setSelectedBonusIds}
        onPageChange={(page) => {
          setReferralsPage(page);
          setSelectedBonusIds(new Set());
        }}
        onOpenDetail={openDetail}
        onOpenShare={openShare}
        onOpenPayBonus={openPayBonusDialog}
        onOpenReverseBonus={openReverseBonusDialog}
        onDeactivate={handleDeactivate}
        onBulkPay={() => setBulkPayDialogOpen(true)}
      />


      <ReferralShareDialog
        open={shareModalOpen}
        onOpenChange={(open) => {
          setShareModalOpen(open);
          if (!open) { setCopiedLink(false); setCopiedMessage(false); setShareReferral(null); }
        }}
        data={shareData}
        loading={shareLoading}
        referral={shareReferral}
        shareMessage={settings?.shareMessage}
        copiedLink={copiedLink}
        copiedMessage={copiedMessage}
        canCopyImage={canCopyImageToClipboard}
        onCopyLink={copyLink}
        onCopyMessage={copyMessage}
        onCopyQr={copyQrCodeToClipboard}
        onWhatsappQr={shareQrCodeViaWhatsApp}
        whatsappUrl={shareData && isValidWhatsapp(shareReferral?.referrerWhatsapp)
          ? buildWhatsAppShareUrl(shareReferral!.referrerWhatsapp!, shareData.link, settings?.shareMessage ?? "", shareReferral?.referrerName, shareReferral?.code, shareReferral?.bonusAmount)
          : null}
        isValidWhatsapp={isValidWhatsapp}
        onClose={() => setShareModalOpen(false)}
      />

      <ReferralOperationalDialogs
        bulkOpen={bulkPayDialogOpen}
        onBulkOpenChange={setBulkPayDialogOpen}
        selectedCount={selectedBonusIds.size}
        selectedTotal={selectedBonusTotal}
        bulkPaying={bulkPaying}
        onConfirmBulk={confirmBulkPay}
        payOpen={payBonusDialogOpen}
        onPayOpenChange={setPayBonusDialogOpen}
        payTarget={payBonusTarget}
        payPending={payBonus.isPending}
        onConfirmPay={confirmPayBonus}
        reverseOpen={reverseBonusDialogOpen}
        onReverseOpenChange={(open) => {
          setReverseBonusDialogOpen(open);
          if (!open) {
            setReverseBonusTarget(null);
            setReverseBonusReason("");
          }
        }}
        reverseTarget={reverseBonusTarget}
        reverseReason={reverseBonusReason}
        onReverseReasonChange={setReverseBonusReason}
        reversePending={reverseBonus.isPending || reversePaidBonus.isPending}
        onConfirmReverse={confirmReverseBonus}
      />

      <ReferralDetailDialog
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        referral={selectedReferral}
        copiedLink={detailCopiedLink}
        shareLink={shareData?.link}
        onCopyLink={async () => {
          if (!shareData?.link) return;
          await navigator.clipboard.writeText(shareData.link);
          setDetailCopiedLink(true);
          setTimeout(() => setDetailCopiedLink(false), 2000);
        }}
        onPay={() => { setDetailModalOpen(false); openPayBonusDialog(selectedReferral!); }}
        onReverse={() => { setDetailModalOpen(false); openReverseBonusDialog(selectedReferral!); }}
        canReverse={me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.AGENCY_MANAGER || me?.role === ROLES.SUPER_ADMIN}
        expiryStatus={expiryEmailStatus}
        bonusStatus={bonusReleaseEmailStatus}
        resendPending={resendWarning.isPending || resendBonus.isPending}
        onResendExpiry={(kind) => {
          if (!selectedReferral) return;
          resendWarning.mutate({ id: selectedReferral.id, params: { window: (kind === "7" ? 7 : 1) as 1 | 7 } });
        }}
        onResendBonus={() => {
          if (!selectedReferral) return;
          resendBonus.mutate({ id: selectedReferral.id });
        }}
      />

      <ReferralSettingsDialog
        open={settingsModalOpen}
        onOpenChange={setSettingsModalOpen}
        draft={localSettings}
        setDraft={setLocalSettings}
        defaultTiers={DEFAULT_TIERS}
        settingsBonusValue={settingsBonusVal}
        tenantName={tenantName}
        whatsappTestPhone={whatsappTestPhone}
        setWhatsappTestPhone={setWhatsappTestPhone}
        whatsappTestState={whatsappTestState}
        settingsWhatsappTestLoading={settingsWhatsappTestLoading}
        updatePending={updateSettings.isPending}
        onSave={saveSettings}
        sendWhatsAppTest={sendWhatsAppTest}
        testWhatsappTemplate={testWhatsappTemplate}
      />

    </div>

    <ReferralCampaignsDialog
      open={campaignsDialogOpen}
      onOpenChange={setCampaignsDialogOpen}
      campaigns={campaigns}
      activeCampaign={activeCampaignAdmin}
      showForm={showCampaignForm}
      setShowForm={setShowCampaignForm}
      draft={campaignFormData}
      setDraft={setCampaignFormData}
      editingId={editingCampaignId}
      onEditingIdChange={setEditingCampaignId}
      onSave={handleSaveCampaign}
      onEdit={handleEditCampaign}
      onDelete={handleDeleteCampaign}
      deletePending={deleteCampaign.isPending}
    />

    </>
  );
}

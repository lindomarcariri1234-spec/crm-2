import { useState, useEffect, useCallback, type ReactElement } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useGetMe } from "@workspace/api-client-react";
import { clientPortalApi, type ClientPortalProfile, type ClientReferral, type ClientReferralCampaign } from "@/lib/clientPortalApi";
import { PublicStore } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ROLES, REFERRAL_STATUS } from "@workspace/permissions";
import QRCode from "qrcode";
import {
  Loader2, Copy, Check, Share2, MessageCircle, Clock, CheckCircle, XCircle,
  QrCode, Coins, AlertTriangle, Wallet, Award, History, Zap, Compass,
  Plane, Target, Star, Sparkles, ShieldCheck, Gift, Users
} from "lucide-react";
import { formatCurrencyBRL as formatCurrency } from "@/lib/utils";
import { formatBRL } from "@workspace/shared";

interface Props {
  slug: string;
  store: PublicStore;
}

const REFERRAL_STATUS_MAP: Record<string, { label: string; color: string; icon: ReactElement | null }> = {
  [REFERRAL_STATUS.PENDING]:   { label: "Pendente",   color: "bg-amber-100 text-amber-800 border-amber-200",  icon: <Clock className="w-3.5 h-3.5" /> },
  [REFERRAL_STATUS.COMPLETED]: { label: "Confirmada", color: "bg-emerald-100 text-emerald-800 border-emerald-200",    icon: <CheckCircle className="w-3.5 h-3.5" /> },
  [REFERRAL_STATUS.CONVERTED]: { label: "Convertida", color: "bg-blue-100 text-blue-800 border-blue-200",      icon: <CheckCircle className="w-3.5 h-3.5" /> },
  [REFERRAL_STATUS.EXPIRED]:   { label: "Expirada",   color: "bg-slate-100 text-slate-600 border-slate-200",    icon: <XCircle className="w-3.5 h-3.5" /> },
  [REFERRAL_STATUS.REVERSED]:  { label: "Revertida",  color: "bg-rose-100 text-rose-700 border-rose-200",        icon: <XCircle className="w-3.5 h-3.5" /> },
};

function ReferralStatusBadge({ status }: { status: string }) {
  const cfg = REFERRAL_STATUS_MAP[status] ?? { label: status, color: "bg-slate-100 text-slate-600", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

const REVERSAL_REASON_LABELS: Record<string, string> = {
  trip_cancelled: "Viagem cancelada",
  reservation_cancelled: "Reserva cancelada",
};

function reversalReasonLabel(reason: string): string {
  return REVERSAL_REASON_LABELS[reason] ?? reason;
}

function maskName(name: string | null): string {
  if (!name) return "Amigo indicado";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1, 3)}***`;
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

function maskEmail(email: string | null): string {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***@${domain}`;
}

function ReferralHistoryRow({ r, primaryColor }: { r: ClientReferral; primaryColor: string }) {
  const displayName = r.referredName ? maskName(r.referredName) : (r.referredEmail ? maskEmail(r.referredEmail) : "Amigo indicado");
  const dateLabel = (r.status === REFERRAL_STATUS.COMPLETED || r.status === REFERRAL_STATUS.CONVERTED) && r.convertedAt
    ? `Convertida em ${new Date(r.convertedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
    : r.status === REFERRAL_STATUS.EXPIRED && r.expiresAt
    ? `Expirou em ${new Date(r.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
    : `Indicada em ${new Date(r.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;

  const bonusValue = parseFloat(r.bonusAmount);

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-4 py-4 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors px-3 -mx-3 rounded-xl">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 text-lg font-bold shadow-sm"
        style={{ background: `${primaryColor}15`, color: primaryColor }}
      >
        {displayName.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-foreground truncate text-base">{displayName}</span>
            <ReferralStatusBadge status={r.status} />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{dateLabel}</span>
        </div>

        <div className="mt-1.5 space-y-1.5">
          {r.status === REFERRAL_STATUS.REVERSED && bonusValue > 0 && (
            <p className="text-sm font-medium text-rose-600 flex items-center gap-1.5">
              <XCircle className="w-4 h-4" /> Bônus de {formatBRL(bonusValue)} revertido
            </p>
          )}
          {r.status === REFERRAL_STATUS.REVERSED && r.reversalReason && (
            <p className="text-xs text-rose-500/80">
              Motivo: {reversalReasonLabel(r.reversalReason)}
            </p>
          )}

          {(r.status === REFERRAL_STATUS.COMPLETED || r.status === REFERRAL_STATUS.CONVERTED) && bonusValue > 0 && (
            <p className={`text-sm font-medium flex items-center gap-1.5 ${
              r.bonusCreditUsedAt
                ? "text-primary"
                : r.bonusPaid
                ? "text-emerald-600"
                : r.bonusBlocked
                ? "text-blue-600"
                : "text-amber-600"
            }`}>
              {r.bonusCreditUsedAt
                ? (() => {
                    const usedAmt = r.bonusCreditUsedAmount ? parseFloat(r.bonusCreditUsedAmount) : bonusValue;
                    return <><CheckCircle className="w-4 h-4" /> Cashback de {formatBRL(usedAmt)} utilizado</>;
                  })()
                : r.bonusPaid
                ? <><CheckCircle className="w-4 h-4" /> Bônus de {formatBRL(bonusValue)} liberado</>
                : r.bonusBlocked && r.bonusReleasesAt
                ? <><Clock className="w-4 h-4" /> Bônus de {formatBRL(bonusValue)} disponível em {new Date(r.bonusReleasesAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</>
                : <><Clock className="w-4 h-4" /> Bônus de {formatBRL(bonusValue)} pendente de liberação</>}
            </p>
          )}

          {(r.status === REFERRAL_STATUS.COMPLETED || r.status === REFERRAL_STATUS.CONVERTED) && r.loyaltyPoints != null && r.loyaltyPoints > 0 && (
            <p className="text-xs font-medium text-indigo-600 flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5" />
              +{r.loyaltyPoints.toLocaleString("pt-BR")} pontos creditados no programa de fidelidade
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 5;

function safeQrDarkColor(hex: string, fallback = "#111827"): string {
  const m = hex.replace("#", "").match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return fallback;
  const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.35 ? fallback : hex;
}

export default function MyReferralPage({ slug, store }: Props) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isSignedIn, isLoaded } = useUser();
  const { data: me, isLoading: meLoading } = useGetMe();

  const [profile, setProfile] = useState<ClientPortalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [referrals, setReferrals] = useState<ClientReferral[] | null>(null);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState<ClientReferralCampaign | null>(null);
  const [countdown, setCountdown] = useState<string>("");

  useEffect(() => {
    if (!activeCampaign) { setCountdown(""); return; }
    function calc() {
      const diff = new Date(activeCampaign!.endsAt).getTime() - Date.now();
      if (diff <= 0) { setCountdown(""); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(d > 0 ? `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m` : `${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`);
    }
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [activeCampaign]);

  useEffect(() => {
    if (store.referralsEnabled === false) {
      navigate(`/loja/${slug}`);
      return;
    }
    if (!isLoaded) return;
    if (!isSignedIn) {
      navigate(`/loja/${slug}/entrar?redirect=/perfil?tab=indicacoes`);
      return;
    }
    if (meLoading) return;
    if (me && me.role !== ROLES.CLIENT) {
      navigate(`/loja/${slug}`);
    }
  }, [isLoaded, isSignedIn, me?.role, meLoading, slug, navigate, store.referralsEnabled]);

  useEffect(() => {
    if (!isSignedIn || meLoading || (me && me.role !== ROLES.CLIENT)) return;
    clientPortalApi
      .getProfile()
      .then(setProfile)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [isSignedIn, meLoading, me?.role]);

  useEffect(() => {
    if (!isSignedIn || meLoading || (me && me.role !== ROLES.CLIENT)) return;
    setLoadingReferrals(true);
    clientPortalApi
      .getMyReferrals()
      .then((r) => {
        const sorted = [...r.data].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setReferrals(sorted);
      })
      .catch(() => setReferrals([]))
      .finally(() => setLoadingReferrals(false));
  }, [isSignedIn, meLoading, me?.role]);

  useEffect(() => {
    if (!isSignedIn || meLoading || (me && me.role !== ROLES.CLIENT)) return;
    clientPortalApi.getActiveReferralCampaign().then(setActiveCampaign).catch(() => setActiveCampaign(null));
  }, [isSignedIn, meLoading, me?.role]);

  const referralCode = profile?.referral?.code ?? null;
  const primaryColor = store.primaryColor ?? "#6366f1";
  const secondaryColor = store.secondaryColor ?? "#4f46e5";

  const shareLink = referralCode
    ? `${window.location.origin}/loja/${slug}/indicacao?code=${encodeURIComponent(referralCode)}`
    : null;

  const handleCopyLink = useCallback(async () => {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setLinkCopied(true);
    toast({ title: "Link copiado com sucesso!", description: "Envie para seus amigos para começar a ganhar." });
    setTimeout(() => setLinkCopied(false), 2500);
  }, [shareLink, toast]);

  const handleShareWhatsApp = useCallback(() => {
    if (!shareLink) return;
    const shareMessage = profile?.referral?.shareMessage;
    const message = shareMessage
      ? `${shareMessage}\n\n${shareLink}`
      : `Olá! Indico a ${store.name} para sua próxima viagem. Use meu link e aproveite condições exclusivas: ${shareLink}`;
    const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }, [shareLink, profile?.referral?.shareMessage, store.name]);

  const handleNativeShare = useCallback(async () => {
    if (!shareLink) return;
    if (!navigator.share) {
      await handleCopyLink();
      return;
    }
    const title = `Desconto Exclusivo — ${store.name}`;
    const text = `Use meu link para aproveitar benefícios especiais na ${store.name}!`;

    try {
      await navigator.share({ title, text, url: shareLink });
    } catch {
      // dismissed by user
    }
  }, [shareLink, store.name, handleCopyLink]);

  const generateQR = useCallback(async (link: string) => {
    setQrLoading(true);
    try {
      const canvas = document.createElement("canvas");
      await QRCode.toCanvas(canvas, link, {
        width: 512, margin: 2, errorCorrectionLevel: "H",
        color: { dark: safeQrDarkColor(primaryColor), light: "#FFFFFF" },
      });

      if (store.logoUrl) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const ctx = canvas.getContext("2d");
            if (!ctx) { resolve(); return; }
            const logoSize = Math.round(canvas.width * 0.22);
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            const halo = logoSize / 2 + 8;
            ctx.fillStyle = "#FFFFFF";
            ctx.beginPath();
            ctx.arc(cx, cy, halo, 0, Math.PI * 2);
            ctx.fill();
            ctx.drawImage(img, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = store.logoUrl!;
        });
      }
      setQrPreviewUrl(canvas.toDataURL("image/png"));
    } catch {
      // silently ignore
    } finally {
      setQrLoading(false);
    }
  }, [primaryColor, store.logoUrl]);

  useEffect(() => {
    if (!shareLink) return;
    generateQR(shareLink);
  }, [shareLink, generateQR]);

  const handleDownloadQR = useCallback(() => {
    if (!qrPreviewUrl || !referralCode) return;
    const anchor = document.createElement("a");
    anchor.href = qrPreviewUrl;
    anchor.download = `qrcode-indicacao-${referralCode}.png`;
    anchor.click();
  }, [qrPreviewUrl, referralCode]);

  if (!isLoaded || meLoading || loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-16 gap-4">
        <AlertTriangle className="w-14 h-14 text-muted-foreground/30" />
        <h2 className="text-xl font-semibold">Não foi possível carregar</h2>
        <p className="text-muted-foreground text-sm max-w-sm">
          Ocorreu um erro ao carregar suas informações. Verifique sua conexão e tente novamente.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>Tentar novamente</Button>
          <Button variant="ghost" onClick={() => navigate(`/loja/${slug}`)}>Voltar à loja</Button>
        </div>
      </div>
    );
  }

  if (!profile || !referralCode) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-16 gap-4">
        <Gift className="w-14 h-14 text-muted-foreground/30" />
        <h2 className="text-xl font-semibold">Programa de Indicação Indisponível</h2>
        <p className="text-muted-foreground text-sm max-w-sm">
          Seu código de indicação ainda não foi gerado. Entre em contato com a agência.
        </p>
        <Button variant="outline" onClick={() => navigate(`/loja/${slug}`)}>Voltar à loja</Button>
      </div>
    );
  }

  const ref = profile.referral;
  const isCodeActive = ref.referralCodeStatus === "active";
  const wallet = ref.wallet;

  const nextTierRemaining = ref.nextTierRemaining ?? (ref.nextTierMin !== null ? ref.nextTierMin - ref.completedReferrals : 0);
  const totalForNextTier = ref.completedReferrals + nextTierRemaining;
  const progressPercent = totalForNextTier > 0 ? Math.min(100, (ref.completedReferrals / totalForNextTier) * 100) : 100;
  const pointsPerReferral = ref.pointsPerReferral || 0;
  const hasLoyalty = !!profile.loyalty || pointsPerReferral > 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8 animate-in fade-in duration-500">

      {!isCodeActive && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {ref.referralCodeStatus === "blocked" ? "Conta de indicações bloqueada" : "Código cancelado"}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Não é possível utilizar os benefícios de indicação no momento. Contate a agência.
            </p>
          </div>
        </div>
      )}

      {/* 1. Share Center & Active Campaign */}
      <Card className="border-primary/20 shadow-lg overflow-hidden bg-card">
        {activeCampaign && countdown && (
          <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-white relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}>
            <div className="absolute -right-4 -top-12 opacity-10 pointer-events-none">
              <Sparkles className="w-32 h-32" />
            </div>
            <div className="flex items-center gap-3 relative z-10">
              <div className="bg-white/20 p-2.5 rounded-full shrink-0">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-lg leading-tight">
                  {activeCampaign.bannerText || (activeCampaign.bonusType === "multiplier" ? `Super Bônus ${activeCampaign.bonusValue}x` : `Bônus Extra Garantido!`)}
                </h3>
                <p className="text-white/90 text-sm mt-0.5 font-medium">Válido para convites enviados e convertidos no período.</p>
              </div>
            </div>
            <div className="bg-black/20 px-4 py-2 rounded-lg text-center shrink-0 relative z-10 flex flex-col sm:flex-row items-center gap-2 sm:gap-3">
              <span className="text-[11px] sm:text-xs text-white/80 uppercase tracking-wider font-semibold">Termina em</span>
              <span className="font-mono font-bold text-lg sm:text-xl tracking-tight">{countdown}</span>
            </div>
          </div>
        )}

        <div className="p-6 sm:p-8 bg-gradient-to-b from-primary/5 to-transparent">
          <div className="max-w-2xl mx-auto text-center mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-3">
              Convide amigos e ganhe recompensas
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base">
              Seus amigos recebem benefícios na primeira viagem e você ganha cashback e pontos de fidelidade a cada nova conversão confirmada.
            </p>
          </div>

          <div className="max-w-xl mx-auto">
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1 group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Share2 className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <input
                  readOnly
                  value={shareLink || ""}
                  className="w-full pl-11 pr-4 py-3.5 bg-background border border-input rounded-xl text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-shadow cursor-copy text-foreground"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
              </div>
              <Button size="lg" onClick={handleCopyLink} className="sm:w-auto w-full gap-2 h-[50px] rounded-xl text-sm font-semibold shadow-sm hover:shadow-md transition-all">
                {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                Copiar Link
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Button variant="outline" onClick={handleShareWhatsApp} className="h-auto py-3.5 flex-col gap-2 text-[#25D366] hover:text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366]/10 rounded-xl shadow-sm">
                <MessageCircle className="w-5 h-5" />
                <span className="text-xs font-semibold">WhatsApp</span>
              </Button>
              <Button variant="outline" onClick={() => setShowQrDialog(true)} className="h-auto py-3.5 flex-col gap-2 rounded-xl hover:bg-primary/5 border-primary/20 hover:border-primary/40 text-primary shadow-sm">
                <QrCode className="w-5 h-5" />
                <span className="text-xs font-semibold">QR Code</span>
              </Button>
              <Button variant="outline" onClick={handleNativeShare} className="h-auto py-3.5 flex-col gap-2 rounded-xl hover:bg-muted/50 shadow-sm text-foreground">
                <Share2 className="w-5 h-5" />
                <span className="text-xs font-semibold">Outros</span>
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* 2. Missions / Progress (Passport Vibe) */}
      <Card className="shadow-sm border-primary/10 overflow-hidden bg-card">
        <div className="bg-primary/5 px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-primary/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Sua Jornada de Benefícios</h3>
              <p className="text-sm text-muted-foreground">Acompanhe seu progresso e conquiste novos multiplicadores.</p>
            </div>
          </div>
          {ref.currentTierMultiplier > 1 && (
            <div className="flex items-center gap-2 bg-background px-3 py-1.5 rounded-lg border border-primary/20 shadow-sm">
              <Award className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Multiplicador {ref.currentTierMultiplier}x ativo</span>
            </div>
          )}
        </div>
        <CardContent className="p-6 sm:p-8">
          <div className="flex items-center justify-between mb-8 relative max-w-2xl mx-auto">
            {/* Line connecting the two nodes */}
            <div className="absolute left-8 right-8 top-1/2 -translate-y-1/2 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${progressPercent}%` }} />
            </div>
            {/* Current Tier Node */}
            <div className="relative z-10 flex flex-col items-center gap-3 bg-card px-2">
              <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-4 border-card shadow-md">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Nível Atual</p>
                <p className="text-lg font-bold text-foreground">{ref.currentTierLabel}</p>
              </div>
            </div>

            {/* Next Tier Node */}
            <div className="relative z-10 flex flex-col items-center gap-3 bg-card px-2">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center border-4 border-card shadow-md transition-colors ${progressPercent >= 100 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                <Target className="w-8 h-8" />
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Próximo Nível</p>
                <p className="text-lg font-bold text-foreground">{ref.nextTierLabel || "Máximo"}</p>
              </div>
            </div>
          </div>

          <div className="max-w-2xl mx-auto">
            {nextTierRemaining > 0 ? (
              <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 sm:p-5 flex items-start sm:items-center gap-4">
                <div className="bg-background p-2.5 rounded-full shadow-sm shrink-0 border border-primary/10">
                  <Plane className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Faltam <strong className="text-primary">{nextTierRemaining} conversões</strong> para alcançar o nível <strong>{ref.nextTierLabel}</strong>.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ao atingir a meta, você passará a receber <strong>{ref.nextTierMultiplier}x de bônus</strong> por cada indicação confirmada.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-5 flex items-start sm:items-center gap-4">
                <div className="bg-white p-2.5 rounded-full shadow-sm shrink-0 border border-amber-200">
                  <Award className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-amber-900">
                    <strong>Nível Máximo Alcançado!</strong>
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    Você já está aproveitando o teto de benefícios e multiplicadores da agência. Continue indicando para acumular mais prêmios na carteira.
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 3. Rewards Summary */}
      <div className={`grid grid-cols-1 gap-6 ${hasLoyalty ? 'md:grid-cols-2' : ''}`}>
        {/* Promotional Credit */}
        <Card className="border-primary/20 shadow-sm relative overflow-hidden bg-card">
          <div className="absolute right-0 top-0 w-32 h-32 bg-primary/5 rounded-bl-[100px] pointer-events-none" />
          <div className="p-6 relative z-10 flex flex-col h-full">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground leading-tight">Cashback</h3>
                <p className="text-sm text-muted-foreground">Desconto em viagens</p>
              </div>
            </div>

            <div className="mb-8 flex-1">
              <p className="text-4xl font-bold text-primary tracking-tight mb-1">{formatCurrency(wallet.availableCredit)}</p>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Saldo Disponível</p>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-5 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Pendente</p>
                <p className="text-sm font-bold text-foreground">{formatCurrency(wallet.pendingCredit)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5" /> Utilizado</p>
                <p className="text-sm font-bold text-foreground">{formatCurrency(wallet.usedCredit)}</p>
              </div>
            </div>

            {wallet.expiringCredit > 0 && wallet.expiringOn && (
              <div className="mt-5 flex items-start gap-2 bg-amber-50 text-amber-800 px-3 py-2.5 rounded-lg text-xs font-medium border border-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formatCurrency(wallet.expiringCredit)} expiram em {new Date(wallet.expiringOn).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
              </div>
            )}
          </div>
        </Card>

        {/* Loyalty Points */}
        {hasLoyalty && (
          <Card className="border-indigo-200 shadow-sm relative overflow-hidden bg-card">
            <div className="absolute right-0 top-0 w-32 h-32 bg-indigo-50 rounded-bl-[100px] pointer-events-none" />
            <div className="p-6 relative z-10 flex flex-col h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                  <Star className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground leading-tight">Pontos de Fidelidade</h3>
                  <p className="text-sm text-muted-foreground">Clube de vantagens</p>
                </div>
              </div>

              <div className="mb-8 flex-1">
                <p className="text-4xl font-bold text-indigo-600 tracking-tight mb-1">
                  {profile.loyalty ? profile.loyalty.availablePoints.toLocaleString("pt-BR") : "0"}
                </p>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pontos Acumulados</p>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-5 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5"><Coins className="w-3.5 h-3.5" /> Por indicação</p>
                  <p className="text-sm font-bold text-foreground">+{pointsPerReferral} pts</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> Nível atual</p>
                  <p className="text-sm font-bold text-foreground capitalize">{profile.loyalty?.tier || "Padrão"}</p>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* 4. History */}
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2 mb-4 text-foreground">
          <History className="w-5 h-5 text-muted-foreground" />
          Histórico de Indicações
        </h3>
        <Card className="shadow-sm border-border bg-card">
          {(!referrals || referrals.length === 0) && !loadingReferrals ? (
            <div className="py-16 px-4 flex flex-col items-center justify-center text-center">
              <div className="bg-primary/5 w-20 h-20 rounded-full flex items-center justify-center mb-5">
                <Users className="w-10 h-10 text-primary/40" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">Nenhuma indicação ainda</h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-8">
                Compartilhe seu link com amigos para iniciar seu histórico e acumular benefícios exclusivos.
              </p>
              <Button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="rounded-xl px-8 h-12 shadow-sm">
                Começar a indicar
              </Button>
            </div>
          ) : (
            <>
              <div className="p-4 sm:p-6 space-y-1">
                {referrals?.slice(0, visibleCount).map((r) => (
                  <ReferralHistoryRow key={r.id} r={r} primaryColor={primaryColor} />
                ))}
              </div>
              {referrals && referrals.length > visibleCount && (
                <div className="p-4 border-t border-border bg-muted/20 text-center">
                  <Button variant="outline" onClick={() => setVisibleCount(c => c + PAGE_SIZE)} className="bg-background rounded-xl">
                    Carregar mais
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
        <DialogContent className="sm:max-w-md text-center">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">Seu QR Code de Indicação</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-2 sm:p-4">
            {qrLoading ? (
              <div className="w-64 h-64 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : qrPreviewUrl ? (
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-border mb-6">
                <img src={qrPreviewUrl} alt="QR Code" className="w-64 h-64 object-contain" />
              </div>
            ) : null}
            <p className="text-sm text-muted-foreground mb-6">
              Peça para seu amigo escanear este código com a câmera do celular para acessar a loja com seus benefícios aplicados.
            </p>
            <Button onClick={handleDownloadQR} className="w-full sm:w-auto min-w-[200px] h-12 rounded-xl" disabled={!qrPreviewUrl}>
              Salvar Imagem
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

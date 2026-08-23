import { useState, useEffect, useCallback, type ReactElement } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useGetMe, useGetActiveCampaign } from "@workspace/api-client-react";
import { clientPortalApi, type ClientPortalProfile, type ClientReferral } from "@/lib/clientPortalApi";
import { PublicStore } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  Loader2, Copy, Check, Share2, Gift, MessageCircle, ExternalLink, Users,
  Clock, CheckCircle, XCircle, QrCode, Coins, AlertTriangle, ArrowRight,
  Wallet, Award, History, Zap
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
    <div className="flex flex-col sm:flex-row sm:items-start gap-4 py-4 border-b last:border-0 hover:bg-muted/10 transition-colors px-2 -mx-2 rounded-lg">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold shadow-sm"
        style={{ background: `${primaryColor}15`, color: primaryColor }}
      >
        {displayName.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground truncate">{displayName}</span>
            <ReferralStatusBadge status={r.status} />
          </div>
          <p className="text-xs text-muted-foreground whitespace-nowrap">{dateLabel}</p>
        </div>

        <div className="mt-2 space-y-1">
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
                ? "text-purple-600"
                : r.bonusPaid
                ? "text-emerald-600"
                : r.bonusBlocked
                ? "text-blue-600"
                : "text-amber-600"
            }`}>
              {r.bonusCreditUsedAt
                ? (() => {
                    const usedAmt = r.bonusCreditUsedAmount ? parseFloat(r.bonusCreditUsedAmount) : bonusValue;
                    return <><CheckCircle className="w-4 h-4" /> Crédito de {formatBRL(usedAmt)} utilizado no checkout</>;
                  })()
                : r.bonusPaid
                ? <><CheckCircle className="w-4 h-4" /> Bônus de {formatBRL(bonusValue)} liberado</>
                : r.bonusBlocked && r.bonusReleasesAt
                ? <><Clock className="w-4 h-4" /> Bônus de {formatBRL(bonusValue)} disponível em {new Date(r.bonusReleasesAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</>
                : <><Clock className="w-4 h-4" /> Bônus de {formatBRL(bonusValue)} pendente de liberação</>}
            </p>
          )}

          {(r.status === REFERRAL_STATUS.COMPLETED || r.status === REFERRAL_STATUS.CONVERTED) && r.loyaltyPoints != null && r.loyaltyPoints > 0 && (
            <p className="text-xs font-medium text-indigo-600 flex items-center gap-1.5 pt-1">
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

  const { data: activeCampaign } = useGetActiveCampaign();
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
    if (!shareLink || !navigator.share) return;
    const title = `Desconto Exclusivo — ${store.name}`;
    const text = `Use meu link para aproveitar benefícios especiais na ${store.name}!`;

    try {
      await navigator.share({ title, text, url: shareLink });
    } catch {
      // dismissed by user
    }
  }, [shareLink, store.name]);

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
  const nextTierMultiplier = ref.nextTierMultiplier ?? 1.5;
  const pointsPerReferral = ref.pointsPerReferral || 0;

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

      {activeCampaign && countdown && (
        <div
          className="rounded-xl p-5 text-white shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}
        >
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2.5 rounded-full shrink-0">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">
                {activeCampaign.bannerText || (activeCampaign.bonusType === "multiplier" ? `Super Bônus ${activeCampaign.bonusValue}x` : `Bônus Extra Garantido!`)}
              </h3>
              <p className="text-white/80 text-sm mt-0.5">Aproveite para indicar amigos agora mesmo.</p>
            </div>
          </div>
          <div className="bg-black/20 px-4 py-2 rounded-lg text-center shrink-0">
            <p className="text-[11px] text-white/70 uppercase tracking-wider font-semibold mb-0.5">Termina em</p>
            <p className="font-mono font-bold text-lg tracking-tight">{countdown}</p>
          </div>
        </div>
      )}

      {/* Share Section (Obvious Next Action) */}
      <Card className="border-primary/20 shadow-md overflow-hidden bg-card">
        <div className="bg-primary/5 p-6 sm:p-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold text-primary mb-2 flex items-center gap-2">
              <Share2 className="w-6 h-6" />
              Envie seu link e ganhe benefícios
            </h2>
            <p className="text-muted-foreground mb-6 text-sm sm:text-base">
              Ao utilizarem seu link de indicação, seus amigos recebem benefícios imediatos e você acumula crédito na carteira virtual a cada conversão confirmada.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1 group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <input
                  readOnly
                  value={shareLink || ""}
                  className="w-full pl-11 pr-4 py-3.5 bg-background border border-input rounded-xl text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-shadow cursor-copy"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
              </div>
              <Button size="lg" onClick={handleCopyLink} className="sm:w-auto w-full gap-2 h-12 rounded-xl text-sm font-semibold shadow-sm hover:shadow-md transition-all">
                {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                Copiar Link
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-card px-6 py-4 border-t flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
          <span className="text-sm font-medium text-muted-foreground shrink-0">Compartilhar via:</span>
          <div className="flex gap-3 w-full sm:w-auto">
            <Button variant="outline" onClick={handleShareWhatsApp} className="flex-1 sm:flex-none gap-2 text-[#25D366] hover:text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366]/10 rounded-lg">
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </Button>
            <Button variant="outline" onClick={() => setShowQrDialog(true)} className="flex-1 sm:flex-none gap-2 rounded-lg hover:bg-muted/50">
              <QrCode className="w-4 h-4" /> QR Code
            </Button>
            <Button variant="outline" onClick={handleNativeShare} className="flex-1 sm:flex-none gap-2 rounded-lg hover:bg-muted/50">
              <Share2 className="w-4 h-4" /> Outros
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Wallet & Loyalty */}
        <div className="lg:col-span-8 space-y-6">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
              <Wallet className="w-5 h-5 text-muted-foreground" />
              Carteira de Bônus
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="bg-primary/5 border-primary/20 sm:col-span-3">
                <CardContent className="p-6">
                  <p className="text-sm font-semibold text-primary/80 mb-1">Crédito Disponível</p>
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                    <div className="text-4xl font-bold text-primary tracking-tight">
                      {formatCurrency(wallet.availableCredit)}
                    </div>
                    <Button variant="default" className="w-full sm:w-auto rounded-lg shadow-sm" onClick={() => navigate(`/loja/${slug}`)}>
                      Utilizar Crédito
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                  {wallet.expiringCredit > 0 && wallet.expiringOn && (
                    <div className="mt-4 inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 rounded-md text-xs font-medium border border-primary/10">
                      <Clock className="w-3.5 h-3.5" />
                      Atenção: {formatCurrency(wallet.expiringCredit)} expiram em {new Date(wallet.expiringOn).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex flex-col justify-center">
                  <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
                    <Clock className="w-4 h-4" />
                    <span className="font-medium text-sm">Crédito Pendente</span>
                  </div>
                  <div className="text-2xl font-bold text-foreground">
                    {formatCurrency(wallet.pendingCredit)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">Em validação pela agência.</p>
                </CardContent>
              </Card>

              <Card className="shadow-sm hover:shadow-md transition-shadow sm:col-span-2">
                <CardContent className="p-5 flex flex-col justify-center">
                  <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
                    <CheckCircle className="w-4 h-4" />
                    <span className="font-medium text-sm">Crédito Utilizado</span>
                  </div>
                  <div className="text-2xl font-bold text-foreground">
                    {formatCurrency(wallet.usedCredit)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">Total histórico utilizado em reservas.</p>
                </CardContent>
              </Card>
            </div>
          </div>

          {pointsPerReferral > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-indigo-50 border border-indigo-100/50 rounded-xl p-5 shadow-sm">
              <div className="bg-indigo-100 text-indigo-600 p-3 rounded-full shrink-0 self-start sm:self-center">
                <Coins className="w-6 h-6" />
              </div>
              <div>
                <p className="text-base font-semibold text-indigo-900 mb-1">Dose dupla de benefícios</p>
                <p className="text-sm text-indigo-700/90 leading-relaxed">
                  Além do crédito promocional, você acumula <strong>{pointsPerReferral} pontos</strong> no programa de fidelidade a cada nova conversão. Suas indicações valem muito mais!
                  {profile.loyalty && <> Saldo atual: <strong>{profile.loyalty.availablePoints.toLocaleString("pt-BR")} pontos</strong>.</>}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Tier Progress */}
        <div className="lg:col-span-4">
          <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
            <Award className="w-5 h-5 text-muted-foreground" />
            Seu Nível
          </h3>
          <Card className="shadow-sm h-[calc(100%-2.5rem)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Nível Atual</p>
                  <p className="text-xl font-bold text-foreground">{ref.currentTierLabel}</p>
                </div>
                <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg shadow-inner">
                  {ref.currentTierMultiplier}x
                </div>
              </div>

              {nextTierRemaining > 0 ? (
                <div className="space-y-4 pt-4 border-t">
                  <div className="flex justify-between items-end text-sm">
                    <span className="font-medium text-foreground">Progresso</span>
                    <span className="text-muted-foreground font-semibold">
                      <span className="text-primary">{ref.completedReferrals}</span> / {ref.completedReferrals + nextTierRemaining}
                    </span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden shadow-inner">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${Math.min(100, (ref.completedReferrals / (ref.completedReferrals + nextTierRemaining)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed pt-1">
                    Faltam <strong>{nextTierRemaining} conversões</strong> para alcançar o nível <strong>{ref.nextTierLabel}</strong> e passar a receber <strong>{nextTierMultiplier}x</strong> de bônus por indicação.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center pt-6 border-t mt-2">
                  <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-3">
                    <Award className="w-6 h-6" />
                  </div>
                  <p className="font-semibold text-foreground">Nível Máximo Alcançado!</p>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    Você já está aproveitando o teto de benefícios e multiplicadores da agência.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* History */}
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
          <History className="w-5 h-5 text-muted-foreground" />
          Histórico de Indicações
        </h3>
        <Card className="shadow-sm">
          {(!referrals || referrals.length === 0) && !loadingReferrals ? (
            <div className="py-12 px-4 flex flex-col items-center justify-center text-center">
              <div className="bg-muted w-16 h-16 rounded-full flex items-center justify-center mb-4">
                <Users className="w-8 h-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-1">Nenhuma indicação ainda</h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-6">
                Compartilhe seu link com amigos para iniciar seu histórico e acumular créditos na carteira.
              </p>
              <Button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                Pegar meu link
              </Button>
            </div>
          ) : (
            <>
              <div className="p-4 sm:p-6 space-y-2">
                {referrals?.slice(0, visibleCount).map((r) => (
                  <ReferralHistoryRow key={r.id} r={r} primaryColor={primaryColor} />
                ))}
              </div>
              {referrals && referrals.length > visibleCount && (
                <div className="p-4 border-t bg-muted/20 text-center">
                  <Button variant="outline" onClick={() => setVisibleCount(c => c + PAGE_SIZE)} className="bg-background">
                    Carregar mais registros
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* QR Code Dialog */}
      <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
        <DialogContent className="sm:max-w-sm p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-center text-xl">Seu QR Code</DialogTitle>
          </DialogHeader>
          <div className="p-8 flex flex-col items-center">
            {qrLoading || !qrPreviewUrl ? (
              <div className="w-64 h-64 flex items-center justify-center bg-muted/30 rounded-xl mb-6">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="w-64 h-64 p-2 bg-white rounded-xl shadow-sm border mb-6">
                <img src={qrPreviewUrl} alt="QR Code" className="w-full h-full" />
              </div>
            )}
            <p className="text-sm text-center text-muted-foreground mb-6">
              Peça para seus amigos escanearem o código com a câmera do celular para acessarem os benefícios.
            </p>
            <div className="flex w-full gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowQrDialog(false)}>
                Fechar
              </Button>
              <Button className="flex-1 gap-2" onClick={handleDownloadQR} disabled={!qrPreviewUrl}>
                <Copy className="w-4 h-4" /> Baixar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

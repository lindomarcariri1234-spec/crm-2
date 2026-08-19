import { useState, useEffect, useRef, useCallback, type ReactElement } from "react";
import { toPng } from "html-to-image";
import { useLocation, useSearch } from "wouter";
import { clientPortalApi, type ClientPortalProfile, type ClientLoyalty, type ClientReferral, type FavoritesResponse, type ClientPortalReservation, type ClientLoyaltyTransaction, type ClientAchievementsResponse, type ClientMemoriesResponse, type DreamDestinationItem, type ClubBenefit, type ClubRankingResponse } from "@/lib/clientPortalApi";
import QRCode from "qrcode";
import { useGetMe, useGetActiveCampaign } from "@workspace/api-client-react";
import { RESERVATION_STATUS, REFERRAL_STATUS, INVOICE_STATUS } from "@workspace/permissions";
import { useSignIn, useClerk } from "@clerk/react";
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
import { Trash2, AlertTriangle, ChevronRight, ExternalLink } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarCheck,
  User,
  Share2,
  Copy,
  Check,
  CheckCircle,
  Clock,
  XCircle,
  Package,
  MapPin,
  QrCode,
  Gift,
  TrendingUp,
  Loader2,
  ShieldCheck,
  Mail,
  KeyRound,
  LayoutDashboard,
  Star,
  DollarSign,
  Plane,
  Users,
  Coins,
  ArrowRight,
  AlertCircle,
  Download,
  MessageCircle,
  Wallet,
  Heart,
  Trophy,
  Map,
  Globe,
  Camera,
  Crown,
  Medal,
  Sparkles,
} from "lucide-react";
import { formatCurrencyBRL as fmtCurrency, formatDateShort } from "@/lib/utils";
import { formatBRL, localToday } from "@workspace/shared";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  [RESERVATION_STATUS.PENDING]:   { label: "Aguardando",  variant: "secondary" },
  [RESERVATION_STATUS.CONFIRMED]: { label: "Confirmado",  variant: "default" },
  [RESERVATION_STATUS.COMPLETED]: { label: "Concluído",   variant: "default" },
  [RESERVATION_STATUS.CANCELLED]: { label: "Cancelado",   variant: "destructive" },
  [INVOICE_STATUS.PROCESSING]:    { label: "Processando", variant: "secondary" },
};

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_MAP[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case RESERVATION_STATUS.CONFIRMED: return <CheckCircle className="w-5 h-5 text-blue-500" />;
    case RESERVATION_STATUS.COMPLETED: return <CheckCircle className="w-5 h-5 text-green-500" />;
    case RESERVATION_STATUS.CANCELLED: return <XCircle className="w-5 h-5 text-red-500" />;
    case "processing": return <Package className="w-5 h-5 text-purple-500" />;
    default: return <Clock className="w-5 h-5 text-yellow-500" />;
  }
}

const fmtDate = (dateStr: string | null) => formatDateShort(dateStr) ?? "A confirmar";

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  return diff;
}

function daysUntilBirthday(birthDateStr: string | null): number | null {
  if (!birthDateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [, monthStr, dayStr] = birthDateStr.split("-");
  const month = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);
  if (isNaN(month) || isNaN(day)) return null;
  const year = today.getFullYear();
  let next = new Date(year, month, day);
  next.setHours(0, 0, 0, 0);
  if (next.getTime() < today.getTime()) {
    next = new Date(year + 1, month, day);
    next.setHours(0, 0, 0, 0);
  }
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

function ReservationCard({
  r,
  compact = false,
  onRedeemClick,
}: {
  r: ClientPortalProfile["reservations"][number];
  compact?: boolean;
  onRedeemClick?: () => void;
}) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const days = daysUntil(r.tripDepartureDate);
  const isImminent = days !== null && days >= 0 && days <= 30;

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function handleDownloadVoucher() {
    setDownloading(true);
    try {
      const res = await fetch(`${BASE}/api/client/reservations/${r.id}/voucher`, {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.message ?? err.error ?? "Erro ao gerar comprovante");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeTrip = r.tripName.replace(/[^a-z0-9]/gi, "_").slice(0, 30);
      a.href = url;
      a.download = `comprovante_${safeTrip}_${r.voucherCode}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Erro ao baixar comprovante",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-start gap-4 p-4">
          <div className="mt-1">
            <StatusIcon status={r.status} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <h4 className="font-semibold text-base leading-tight">{r.tripName}</h4>
                <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                  <MapPin className="w-3.5 h-3.5" />
                  {r.tripDestination}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {isImminent && days! > 0 && (
                  <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 text-xs">
                    {days} dia{days !== 1 ? "s" : ""}
                  </Badge>
                )}
                {days === 0 && (
                  <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 text-xs">
                    Hoje!
                  </Badge>
                )}
                <StatusBadge status={r.status} />
              </div>
            </div>

            {!compact && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Partida</p>
                  <p className="font-medium">{fmtDate(r.tripDepartureDate)}</p>
                </div>
                {r.tripReturnDate && (
                  <div>
                    <p className="text-muted-foreground text-xs">Retorno</p>
                    <p className="font-medium">{fmtDate(r.tripReturnDate)}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs">Total</p>
                  <p className="font-medium">{fmtCurrency(r.totalValue)}</p>
                </div>
              </div>
            )}

            {compact && (
              <div className="mt-2 flex gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Partida</p>
                  <p className="font-medium">{fmtDate(r.tripDepartureDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Total</p>
                  <p className="font-medium">{fmtCurrency(r.totalValue)}</p>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {r.reservationNumber && (
                <div className="flex items-center gap-1.5 text-xs bg-muted rounded px-2 py-1">
                  <CalendarCheck className="w-3 h-3 text-muted-foreground" />
                  <span className="font-mono">{r.reservationNumber}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs bg-muted rounded px-2 py-1">
                <QrCode className="w-3 h-3 text-muted-foreground" />
                <span className="font-mono">{r.voucherCode}</span>
              </div>
              {r.seatsCount > 0 && (
                <div className="flex items-center gap-1.5 text-xs bg-muted rounded px-2 py-1">
                  <Users className="w-3 h-3 text-muted-foreground" />
                  <span>{r.seatsCount} passageiro{r.seatsCount !== 1 ? "s" : ""}</span>
                </div>
              )}
              {r.boardingPointName && (
                <div className="flex items-center gap-1.5 text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded px-2 py-1">
                  <MapPin className="w-3 h-3" />
                  <span>
                    {r.boardingPointName}
                    {r.boardingPointTime ? ` — ${r.boardingPointTime}` : ""}
                  </span>
                </div>
              )}
              {r.balance > 0 && (
                <div className="flex items-center gap-1.5 text-xs bg-orange-50 border border-orange-200 text-orange-700 rounded px-2 py-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>Saldo pendente: {fmtCurrency(r.balance)}</span>
                </div>
              )}
              {r.balance > 0 && onRedeemClick && (
                <button
                  onClick={onRedeemClick}
                  className="flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded px-2 py-1 hover:bg-amber-100 transition-colors"
                >
                  <Coins className="w-3 h-3" />
                  <span>Usar pontos</span>
                </button>
              )}
            </div>

            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleDownloadVoucher}
                disabled={downloading}
              >
                {downloading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Download className="w-3 h-3" />
                )}
                {downloading ? "Gerando..." : "Baixar comprovante"}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Per-tier aurora-style gradient backgrounds (inline CSS)
const CARD_TIER_BG: Record<string, string> = {
  bronze:  "radial-gradient(ellipse at 80% 5%, rgba(251,146,60,0.55) 0%, transparent 50%), radial-gradient(ellipse at 15% 95%, rgba(180,83,9,0.45) 0%, transparent 50%), linear-gradient(135deg, #1c0a00 0%, #431407 50%, #1c0a00 100%)",
  silver:  "radial-gradient(ellipse at 80% 5%, rgba(148,163,184,0.55) 0%, transparent 50%), radial-gradient(ellipse at 15% 95%, rgba(71,85,105,0.45) 0%, transparent 50%), linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
  gold:    "radial-gradient(ellipse at 80% 5%, rgba(251,191,36,0.60) 0%, transparent 50%), radial-gradient(ellipse at 15% 95%, rgba(180,130,9,0.45) 0%, transparent 50%), linear-gradient(135deg, #1a0e00 0%, #3d2400 50%, #1a0e00 100%)",
  diamond: "radial-gradient(ellipse at 80% 5%, rgba(34,211,238,0.60) 0%, transparent 50%), radial-gradient(ellipse at 15% 95%, rgba(6,182,212,0.40) 0%, transparent 50%), linear-gradient(135deg, #050d1a 0%, #0c2a4a 50%, #0e4356 100%)",
};

const CARD_TIER_ICONS: Record<string, string> = {
  bronze:  "🥉",
  silver:  "🥈",
  gold:    "🥇",
  diamond: "💎",
};

const CARD_TIER_LABELS: Record<string, string> = {
  bronze:  "Bronze",
  silver:  "Prata",
  gold:    "Ouro",
  diamond: "Diamante",
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16) || 59,
    g: parseInt(clean.slice(2, 4), 16) || 130,
    b: parseInt(clean.slice(4, 6), 16) || 246,
  };
}

function getCardBg(primaryColor: string, tierLevel: string | null): string {
  if (tierLevel && CARD_TIER_BG[tierLevel]) return CARD_TIER_BG[tierLevel];
  const { r, g, b } = hexToRgb(primaryColor);
  return [
    `radial-gradient(ellipse at 80% 5%, rgba(${r},${g},${b},0.55) 0%, transparent 52%)`,
    `radial-gradient(ellipse at 15% 95%, rgba(${r},${g},${b},0.35) 0%, transparent 48%)`,
    `radial-gradient(ellipse at 50% 50%, rgba(${Math.min(r + 60, 255)},${Math.min(g + 20, 255)},${Math.min(b + 80, 255)},0.18) 0%, transparent 70%)`,
    "linear-gradient(135deg, #0f172a 0%, #1e1b4b 45%, #312e81 100%)",
  ].join(", ");
}

function ClienteCard({
  profile,
  primaryColor,
}: {
  profile: ClientPortalProfile;
  primaryColor: string;
}) {
  const { toast } = useToast();
  const [codeCopied, setCodeCopied] = useState(false);
  const [cardDownloading, setCardDownloading] = useState(false);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [storeQrCode, setStoreQrCode] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const displayName = profile.client?.name ?? profile.user?.name ?? "Viajante";
  const hasLoyalty = !!profile.loyalty;
  // Loyalty tier takes priority; fall back to referral tier when no loyalty program is active.
  const tierLevel = hasLoyalty ? (profile.loyalty!.tier ?? null) : null;
  const referralTierLevel = profile.referral?.currentTierLevel ?? null;
  const referralTierLabel = profile.referral?.currentTierLabel ?? null;
  const effectiveTierLevel = tierLevel ?? referralTierLevel;
  const tierLabel = tierLevel
    ? (CARD_TIER_LABELS[tierLevel] ?? tierLevel)
    : referralTierLabel;
  const loyaltyPoints = profile.loyalty?.availablePoints ?? null;
  const referralCode = profile.referral?.code ?? null;
  const customerCode = profile.client?.customerCode ?? null;
  const agencyName = profile.tenant?.name ?? "VisiteCRM";
  const logoUrl = profile.tenant?.logoUrl ?? null;
  const tierIcon = effectiveTierLevel ? (CARD_TIER_ICONS[effectiveTierLevel] ?? null) : null;
  const cardBg = getCardBg(primaryColor, effectiveTierLevel);
  const storePath = profile.tenant?.slug ? `/loja/${profile.tenant.slug}` : null;
  const storeUrl = storePath ? `${window.location.origin}${storePath}` : null;
  const securityCode = customerCode
    ? customerCode.replace(/\D/g, "").slice(-3).padStart(3, "0")
    : "•••";
  const loyaltyBenefits = [
    "Ofertas e condições exclusivas",
    "Pontos em cada viagem",
    "Prioridade em novidades",
    "Benefícios do seu nível",
  ];

  useEffect(() => {
    let active = true;
    if (!storeUrl) {
      setStoreQrCode(null);
      return () => { active = false; };
    }

    QRCode.toDataURL(storeUrl, {
      width: 192,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (active) setStoreQrCode(dataUrl);
      })
      .catch(() => {
        if (active) setStoreQrCode(null);
      });

    return () => { active = false; };
  }, [storeUrl]);

  function copyCustomerCode() {
    if (!customerCode) return;
    navigator.clipboard.writeText(customerCode).catch(() => {});
    setCodeCopied(true);
    toast({ title: "Código copiado!" });
    setTimeout(() => setCodeCopied(false), 2000);
  }

  const handleDownloadCard = useCallback(async () => {
    if (!cardRef.current) return;
    setCardDownloading(true);
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement("a");
      a.href = dataUrl;
      const safeName = displayName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
      a.download = `cartao_viajante_${safeName}.png`;
      a.click();
    } catch {
      toast({ title: "Erro ao gerar imagem", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setCardDownloading(false);
    }
  }, [displayName, toast]);

  const handleShareCard = useCallback(async () => {
    const profileUrl = window.location.href;
    const message = `Olá! Sou membro ${tierLabel ? `(nível ${tierLabel}) ` : ""}da ${agencyName}. Acesse meu perfil de viajante: ${profileUrl}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  }, [agencyName, tierLabel]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="w-full max-w-[420px] [perspective:1200px]">
        <div
          className={`relative aspect-[1.586/1] w-full transition-transform duration-700 [transform-style:preserve-3d] ${isCardFlipped ? "[transform:rotateY(180deg)]" : ""}`}
          aria-label={`Cartão de viajante — ${isCardFlipped ? "verso" : "frente"}`}
        >
          {/* Front face. Keep this ref on the front so downloads never include the back. */}
          <div
            ref={cardRef}
            className="absolute inset-0 rounded-2xl overflow-hidden shadow-2xl text-white select-none [backface-visibility:hidden]"
            style={{ background: cardBg }}
            aria-hidden={isCardFlipped}
          >
            {/* Aurora shimmer lines */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute top-1/3 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              <div className="absolute top-2/3 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/6 to-transparent" />
              <div className="absolute top-4 left-1/3 w-1 h-1 rounded-full bg-white/25" />
              <div className="absolute top-10 right-1/4 w-0.5 h-0.5 rounded-full bg-white/20" />
              <div className="absolute bottom-6 left-1/2 w-0.5 h-0.5 rounded-full bg-white/15" />
            </div>

            <div className="relative h-full p-5 flex flex-col justify-between">
              {/* Top row: logo + agency name (left) · "CARTÃO DO VIAJANTE" + chip (right) */}
              <div className="relative flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={agencyName}
                      className="h-10 w-10 rounded-full object-contain bg-white/15 p-0.5 shrink-0 shadow-md"
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-white/20 border border-white/30 flex items-center justify-center font-bold text-white text-base shrink-0 shadow-md">
                      {agencyName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[8px] text-white/50 uppercase tracking-widest leading-none mb-0.5">Agência</p>
                    <p className="text-[11px] font-bold truncate text-white leading-tight drop-shadow-sm">{agencyName}</p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <div className="text-right leading-none">
                    <p className="text-[7px] text-white/50 uppercase tracking-widest">Cartão do</p>
                    <p className="text-[10px] font-extrabold text-white uppercase tracking-wide">Viajante ✈</p>
                  </div>
                  {/* EMV chip */}
                  <svg width="30" height="23" viewBox="0 0 36 28" className="opacity-90" aria-hidden="true">
                    <rect x="1" y="1" width="34" height="26" rx="4" fill="#C9A227" stroke="#E8C14A" strokeWidth="0.8"/>
                    <rect x="12" y="1" width="12" height="26" fill="#B8901E" opacity="0.55"/>
                    <rect x="1" y="9.5" width="34" height="9" fill="#B8901E" opacity="0.55"/>
                    <line x1="12" y1="1" x2="12" y2="27" stroke="#E8C14A" strokeWidth="0.4" opacity="0.5"/>
                    <line x1="24" y1="1" x2="24" y2="27" stroke="#E8C14A" strokeWidth="0.4" opacity="0.5"/>
                    <line x1="1" y1="9.5" x2="35" y2="9.5" stroke="#E8C14A" strokeWidth="0.4" opacity="0.5"/>
                    <line x1="1" y1="18.5" x2="35" y2="18.5" stroke="#E8C14A" strokeWidth="0.4" opacity="0.5"/>
                  </svg>
                </div>
              </div>

              {/* Center: customer code (prominent) */}
              <div className="relative">
                <p className="text-[8px] text-white/45 uppercase tracking-[0.2em] mb-1">Código do Cliente</p>
                {customerCode ? (
                  <p className="text-[20px] font-mono font-bold text-white tracking-[0.05em] drop-shadow-md leading-tight">
                    {customerCode}
                  </p>
                ) : (
                  <p className="text-base font-mono font-semibold text-white/70 tracking-[0.22em] drop-shadow-sm">
                    •••• •••• •••• ••••
                  </p>
                )}
                {hasLoyalty && (
                  <p className="text-[9px] text-white/55 mt-1 font-mono tracking-wide">
                    {(loyaltyPoints ?? 0).toLocaleString("pt-BR")} pts disponíveis
                  </p>
                )}
              </div>

              {/* Bottom row: name · tier · referral code */}
              <div className="relative flex items-end justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[7px] text-white/45 uppercase tracking-wider mb-0.5">Viajante</p>
                  <p className="text-[12px] font-bold uppercase truncate drop-shadow-sm leading-tight text-white">
                    {displayName}
                  </p>
                </div>

                <div className="text-center shrink-0">
                  <p className="text-[7px] text-white/45 uppercase tracking-wider mb-0.5">Nível</p>
                  <p className="text-[11px] font-bold text-white drop-shadow-sm leading-tight">
                    {tierLabel ? (tierIcon ? `${tierIcon} ${tierLabel}` : tierLabel) : "Membro"}
                  </p>
                </div>

                {referralCode && (
                  <div className="text-right shrink-0">
                    <p className="text-[7px] text-white/45 uppercase tracking-wider mb-0.5">Indicação</p>
                    <p className="text-[11px] font-mono font-bold text-white drop-shadow-sm leading-tight">
                      {referralCode}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Back face */}
          <div
            className="absolute inset-0 rounded-2xl overflow-hidden shadow-2xl text-white select-none [backface-visibility:hidden] [transform:rotateY(180deg)]"
            style={{ background: cardBg }}
            aria-hidden={!isCardFlipped}
          >
            <div className="absolute inset-0 bg-slate-950/25" />
            <div className="relative h-full py-4 flex flex-col">
              <div className="h-9 bg-black/90 shadow-inner" aria-label="Tarja magnética" />
              <div className="flex-1 px-5 pt-3 pb-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[8px] text-white/55 uppercase tracking-[0.2em] mb-1.5">Benefícios do programa</p>
                  <ul className="space-y-1.5">
                    {loyaltyBenefits.map((benefit) => (
                      <li key={benefit} className="flex items-center gap-1.5 text-[10px] font-medium text-white/95">
                        <Check className="w-3 h-3 shrink-0 text-white/80" />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="rounded bg-white/90 px-2 py-1 text-slate-900 min-w-[66px]">
                      <p className="text-[6px] font-bold uppercase tracking-wider text-slate-500">CVV · Cód. segurança</p>
                      <p className="font-mono text-base font-bold tracking-[0.25em] leading-none">{securityCode}</p>
                    </div>
                    <p className="text-[8px] leading-tight text-white/60">Uso exclusivo<br />do viajante</p>
                  </div>
                </div>

                {storeQrCode ? (
                  <div className="shrink-0 rounded-lg bg-white p-1.5 shadow-lg">
                    <img
                      src={storeQrCode}
                      alt={`QR code para a vitrine ${agencyName}`}
                      className="w-[78px] h-[78px]"
                    />
                    <p className="mt-0.5 text-center text-[6px] font-bold uppercase tracking-wide text-slate-700">Acesse a vitrine</p>
                  </div>
                ) : (
                  <div className="w-[90px] text-center text-[8px] leading-tight text-white/60">
                    Vitrine indisponível
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Customer code copy button */}
      {customerCode && (
        <button
          onClick={copyCustomerCode}
          className="mx-auto flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted hover:bg-muted/80 transition-colors group"
          title="Copiar código de cliente"
        >
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Cód. cliente</span>
          <span className="font-mono text-xs font-semibold text-foreground">{customerCode}</span>
          {codeCopied
            ? <Check className="w-3 h-3 text-green-500" />
            : <Copy className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors" />}
        </button>
      )}

      <div className="flex flex-wrap justify-center gap-2 mt-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => setIsCardFlipped((flipped) => !flipped)}
          aria-pressed={isCardFlipped}
        >
          <QrCode className="w-3.5 h-3.5" />
          {isCardFlipped ? "Ver frente" : "Virar cartão"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={handleDownloadCard}
          disabled={cardDownloading}
        >
          {cardDownloading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          {cardDownloading ? "Gerando..." : "Baixar cartão"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={handleShareCard}
        >
          <MessageCircle className="w-3.5 h-3.5" />
          Compartilhar
        </Button>
      </div>
    </div>
  );
}

const STAR_LABELS = ["", "Péssimo", "Ruim", "Regular", "Bom", "Ótimo"];

function StarRating({
  value,
  onChange,
  label,
  hint,
}: {
  value: number | null;
  onChange: (v: number) => void;
  label: string;
  hint?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const isActive = (star: number) =>
    hovered !== null ? star <= hovered : value !== null && star <= value;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onChange(star)}
            className="p-0.5 transition-transform hover:scale-110 focus:outline-none"
          >
            <Star
              className={`w-6 h-6 transition-colors ${
                isActive(star)
                  ? "fill-amber-400 text-amber-400"
                  : "fill-none text-muted-foreground/30"
              }`}
            />
          </button>
        ))}
        {value !== null && value > 0 && (
          <span className="ml-1.5 text-xs text-muted-foreground">{STAR_LABELS[value]}</span>
        )}
      </div>
    </div>
  );
}

function NpsCard({
  reservation,
  npsCategories,
}: {
  reservation: ClientPortalProfile["reservations"][number];
  npsCategories?: { transport?: boolean; service?: boolean; organization?: boolean; guide?: boolean } | null;
}) {
  const { toast } = useToast();
  const showTransport = npsCategories ? (npsCategories.transport !== false) : true;
  const showService = npsCategories ? (npsCategories.service !== false) : true;
  const showOrganization = npsCategories ? (npsCategories.organization !== false) : true;
  const showGuide = npsCategories ? (npsCategories.guide !== false) : true;
  const [score, setScore] = useState<number | null>(null);
  const [scoreTransport, setScoreTransport] = useState<number | null>(null);
  const [scoreService, setScoreService] = useState<number | null>(null);
  const [scoreOrganization, setScoreOrganization] = useState<number | null>(null);
  const [scoreGuide, setScoreGuide] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (score === null) return;
    setSubmitting(true);
    try {
      await clientPortalApi.submitNps({
        reservationId: reservation.id,
        score,
        scoreTransport: scoreTransport,
        scoreService: scoreService,
        scoreOrganization: scoreOrganization,
        scoreGuide: scoreGuide,
        comment: comment || null,
      });
      setSubmitted(true);
    } catch {
      toast({ title: "Erro ao enviar avaliação", description: "Tente novamente mais tarde.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">Obrigado pela avaliação!</p>
            <p className="text-xs text-green-600">Seu feedback é muito importante para nós.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Star className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold">Como foi sua experiência?</p>
            <p className="text-xs text-muted-foreground">{reservation.tripName}</p>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            Em uma escala de 0 a 10, o quanto você recomendaria esta viagem a um amigo?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 11 }, (_, i) => {
              const isSelected = score === i;
              const colorClass =
                i <= 6
                  ? isSelected
                    ? "bg-red-500 text-white border-red-500"
                    : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                  : i <= 8
                  ? isSelected
                    ? "bg-yellow-500 text-white border-yellow-500"
                    : "bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100"
                  : isSelected
                  ? "bg-green-500 text-white border-green-500"
                  : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100";
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setScore(i)}
                  className={`w-9 h-9 rounded border font-semibold text-sm transition-colors ${colorClass}`}
                >
                  {i}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Nada provável</span>
            <span>Extremamente provável</span>
          </div>
        </div>
        {(showTransport || showService || showOrganization || showGuide) && (
          <div className="space-y-3 pt-2 border-t">
            <p className="text-xs text-muted-foreground">Avalie cada aspecto da viagem (opcional)</p>
            {showTransport && (
              <StarRating
                value={scoreTransport}
                onChange={setScoreTransport}
                label="🚌 Transporte/Ônibus"
              />
            )}
            {showService && (
              <StarRating
                value={scoreService}
                onChange={setScoreService}
                label="👥 Atendimento da equipe"
              />
            )}
            {showOrganization && (
              <StarRating
                value={scoreOrganization}
                onChange={setScoreOrganization}
                label="📋 Organização da viagem"
              />
            )}
            {showGuide && (
              <StarRating
                value={scoreGuide}
                onChange={setScoreGuide}
                label="🎤 Guia/Monitoria"
              />
            )}
          </div>
        )}
        <textarea
          placeholder="Conte-nos mais sobre sua experiência (opcional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
          maxLength={2000}
        />
        <Button
          size="sm"
          disabled={score === null || submitting}
          onClick={handleSubmit}
          className="w-full"
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Enviando...
            </>
          ) : (
            "Enviar avaliação"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function BirthdayBonusCard({
  daysLeft,
  storeUrl,
}: {
  daysLeft: number;
  storeUrl: string | null;
}) {
  return (
    <div className="rounded-xl overflow-hidden shadow-md">
      <div
        className="p-4 text-white"
        style={{ background: "linear-gradient(135deg, #ec4899, #f59e0b)" }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Gift className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base leading-tight">🎉 Seu aniversário está chegando!</p>
            <p className="text-sm text-white/90 mt-0.5">
              {daysLeft === 1
                ? "Falta apenas 1 dia"
                : `Faltam apenas ${daysLeft} dias`}{" "}
              para o seu aniversário e preparamos uma condição especial para você.
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-white/15 border border-white/25 p-3">
          <p className="text-sm font-semibold">🎁 Bônus de Aniversário Exclusivo</p>
          <p className="text-xs text-white/85 mt-1 leading-relaxed">
            Aproveite benefícios e vantagens especiais para celebrar essa data com uma viagem
            inesquecível. Fique atento às próximas novidades e garanta sua próxima experiência com
            condições exclusivas.
          </p>
        </div>

        {storeUrl && (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 w-full border-white/50 text-white bg-white/10 hover:bg-white/20 hover:text-white"
            onClick={() => (window.location.href = storeUrl)}
          >
            Ver Pacotes Especiais
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function BirthdayTodayCard({
  firstName,
  storeUrl,
}: {
  firstName: string;
  storeUrl: string | null;
}) {
  return (
    <div className="rounded-xl overflow-hidden shadow-md">
      <div
        className="p-4 text-white"
        style={{ background: "linear-gradient(135deg, #ec4899, #f59e0b)" }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0 text-xl leading-none">
            🎂
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base leading-tight">Feliz Aniversário! 🎉</p>
            <p className="text-sm text-white/90 mt-0.5">
              Hoje é o seu dia, <span className="font-semibold">{firstName}</span>! Que seja um
              dia incrível, repleto de alegria, amor e novas aventuras pelo mundo.
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-white/15 border border-white/25 p-3">
          <p className="text-sm font-semibold">🎁 Bônus de Aniversário Exclusivo</p>
          <p className="text-xs text-white/85 mt-1 leading-relaxed">
            Preparamos condições especiais para você celebrar esse momento com uma viagem
            inesquecível. Aproveite os benefícios exclusivos de aniversariante e garanta sua
            próxima experiência com vantagens únicas.
          </p>
        </div>

        {storeUrl && (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 w-full border-white/50 text-white bg-white/10 hover:bg-white/20 hover:text-white"
            onClick={() => (window.location.href = storeUrl)}
          >
            Ver Pacotes Especiais
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function BirthdayGreetingCard({
  firstName,
  storeUrl,
}: {
  firstName: string;
  storeUrl: string | null;
}) {
  return (
    <div className="rounded-xl overflow-hidden shadow-md">
      <div
        className="p-4 text-white"
        style={{ background: "linear-gradient(135deg, #ec4899, #f59e0b)" }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0 text-xl leading-none">
            🥳
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base leading-tight">Amanhã é seu dia!</p>
            <p className="text-sm text-white/90 mt-0.5">
              Parabéns antecipado, <span className="font-semibold">{firstName}</span>! 🎉
              Que seu aniversário seja repleto de alegria e novas aventuras.
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-white/15 border border-white/25 p-3">
          <p className="text-sm font-semibold">🎁 Bônus de Aniversário Exclusivo</p>
          <p className="text-xs text-white/85 mt-1 leading-relaxed">
            Preparamos condições especiais para você celebrar essa data com uma viagem
            inesquecível. Fique atento às próximas novidades e garanta sua próxima experiência com
            benefícios exclusivos de aniversariante.
          </p>
        </div>

        {storeUrl && (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 w-full border-white/50 text-white bg-white/10 hover:bg-white/20 hover:text-white"
            onClick={() => (window.location.href = storeUrl)}
          >
            Ver Pacotes Especiais
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function hasAnyPreference(client: ClientPortalProfile["client"]): boolean {
  if (!client) return false;
  return !!(
    client.musicalPreferences ||
    client.favoriteDrink ||
    client.dreamDestinations.length > 0 ||
    client.foodPreferences ||
    client.travelPreference ||
    client.travelInterests.length > 0 ||
    client.likesPhotosVideos !== null ||
    client.preferredDestinationTypes.length > 0
  );
}

function PreferencesSummaryCard({
  client,
  onGoToPreferences,
}: {
  client: ClientPortalProfile["client"];
  onGoToPreferences: () => void;
}) {
  const filled = hasAnyPreference(client);

  if (!filled) {
    return (
      <button
        type="button"
        className="w-full text-left flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 hover:bg-violet-100 transition-colors"
        onClick={onGoToPreferences}
      >
        <Sparkles className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-violet-800">Personalize sua experiência</p>
          <p className="text-xs text-violet-600 mt-0.5">
            Conte-nos seus destinos dos sonhos e preferências de viagem para recomendações personalizadas.
          </p>
        </div>
        <ArrowRight className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
      </button>
    );
  }

  const destinations = client?.dreamDestinations ?? [];
  const travelPreference = client?.travelPreference ?? null;
  const destinationTypes = client?.preferredDestinationTypes ?? [];
  const interests = client?.travelInterests ?? [];

  const visibleDestinations = destinations.slice(0, 4);
  const extraDestinations = destinations.length - visibleDestinations.length;

  return (
    <button
      type="button"
      className="w-full text-left rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 hover:bg-violet-100 transition-colors"
      onClick={onGoToPreferences}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-500 shrink-0" />
          <p className="text-sm font-semibold text-violet-800">Suas preferências</p>
        </div>
        <span className="text-xs text-violet-500 flex items-center gap-0.5">
          Editar <ArrowRight className="w-3 h-3" />
        </span>
      </div>
      <div className="space-y-1.5">
        {visibleDestinations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-violet-600 shrink-0">
              <Globe className="w-3 h-3 inline mr-0.5" />
              Sonhos:
            </span>
            {visibleDestinations.map((d) => (
              <span
                key={d}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-medium border border-violet-200"
              >
                {d}
              </span>
            ))}
            {extraDestinations > 0 && (
              <span className="text-xs text-violet-500">+{extraDestinations}</span>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-violet-600">
          {travelPreference && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {travelPreference}
            </span>
          )}
          {destinationTypes.length > 0 && (
            <span className="flex items-center gap-1">
              <Map className="w-3 h-3" />
              {destinationTypes.slice(0, 2).join(", ")}
              {destinationTypes.length > 2 ? ` +${destinationTypes.length - 2}` : ""}
            </span>
          )}
          {interests.length > 0 && (
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3" />
              {interests.slice(0, 2).join(", ")}
              {interests.length > 2 ? ` +${interests.length - 2}` : ""}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function InicioTab({
  profile,
  primaryColor,
  onTabChange,
  onGoToReservasFiltered,
}: {
  profile: ClientPortalProfile;
  primaryColor: string;
  onTabChange: (tab: string) => void;
  onGoToReservasFiltered: () => void;
}) {
  const today = localToday();
  const displayName = profile.client?.name ?? profile.user?.name ?? "Viajante";
  const firstName = displayName.split(" ")[0];

  const upcoming = profile.reservations.filter(
    (r) =>
      r.status !== RESERVATION_STATUS.COMPLETED &&
      r.status !== RESERVATION_STATUS.CANCELLED &&
      (!r.tripDepartureDate || r.tripDepartureDate >= today),
  );

  const nextTrip = upcoming[0] ?? null;
  const days = nextTrip ? daysUntil(nextTrip.tripDepartureDate) : null;

  const totalReferrals = profile.referral.totalReferrals;
  const loyaltyPoints = profile.loyalty?.availablePoints ?? null;

  const pendingBalance = profile.reservations.filter(
    (r) => r.balance > 0 && r.status !== RESERVATION_STATUS.CANCELLED,
  );

  // 30 days ago in Brazil timezone (today is already Brazil date)
  const thirtyDaysAgoDate = new Date(today + "T12:00:00");
  thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
  const thirtyDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(thirtyDaysAgoDate);

  const bdDays = daysUntilBirthday(profile.client?.birthDate ?? null);

  const npsTrips = profile.reservations.filter(
    (r) =>
      !!r.tripReturnDate &&
      r.tripReturnDate <= today &&
      r.tripReturnDate >= thirtyDaysAgoStr &&
      r.status !== RESERVATION_STATUS.CANCELLED &&
      !r.npsSubmitted,
  );

  const kpis = [
    {
      icon: <Plane className="w-5 h-5" />,
      label: "Próxima Viagem",
      value: nextTrip
        ? fmtDate(nextTrip.tripDepartureDate)
        : "—",
      sub: nextTrip
        ? nextTrip.tripName
        : "Nenhuma viagem agendada",
      color: "text-blue-600",
      bg: "bg-blue-50",
      onClick: () => onTabChange("reservas"),
    },
    {
      icon: <DollarSign className="w-5 h-5" />,
      label: "Total Gasto",
      value: fmtCurrency(profile.stats?.totalSpent ?? 0),
      sub: `em ${profile.reservations.filter(r => r.status === RESERVATION_STATUS.CONFIRMED || r.status === RESERVATION_STATUS.COMPLETED).length} reserva(s)`,
      color: "text-green-600",
      bg: "bg-green-50",
      onClick: () => onTabChange("reservas"),
    },
    {
      icon: <Coins className="w-5 h-5" />,
      label: "Pontos de Fidelidade",
      value: loyaltyPoints !== null ? loyaltyPoints.toLocaleString("pt-BR") : "—",
      sub: loyaltyPoints !== null ? "pontos disponíveis" : "Sem programa ativo",
      color: "text-amber-600",
      bg: "bg-amber-50",
      onClick: () => loyaltyPoints !== null && onTabChange("fidelidade"),
    },
    {
      icon: <Share2 className="w-5 h-5" />,
      label: "Indicações",
      value: totalReferrals.toString(),
      sub: `${profile.referral.completedReferrals} confirmada(s)`,
      color: "text-purple-600",
      bg: "bg-purple-50",
      onClick: () => onTabChange("indicacoes"),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <ClienteCard profile={profile} primaryColor={primaryColor} />
        <div className="px-1">
          <p className="text-sm text-muted-foreground">
            Bem-vindo(a) de volta, <span className="font-semibold text-foreground">{firstName}</span>!
            {nextTrip && days !== null && days >= 0 && (
              <span>
                {" "}
                {days === 0
                  ? "Sua próxima viagem é hoje! 🎉"
                  : days === 1
                  ? "Sua próxima viagem é amanhã!"
                  : `Sua próxima viagem começa em ${days} dias.`}
              </span>
            )}
          </p>
          {!nextTrip && profile.tenant?.slug && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => (window.location.href = `/loja/${profile.tenant!.slug}/produtos`)}
            >
              Ver Pacotes
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <Card
            key={k.label}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={k.onClick}
          >
            <CardContent className="p-4">
              <div className={`w-9 h-9 rounded-lg ${k.bg} ${k.color} flex items-center justify-center mb-3`}>
                {k.icon}
              </div>
              <p className="text-xs text-muted-foreground mb-0.5">{k.label}</p>
              <p className="text-xl font-bold leading-tight">{k.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{k.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {bdDays === 0 && (
        <BirthdayTodayCard
          firstName={firstName}
          storeUrl={profile.tenant?.slug ? `/loja/${profile.tenant.slug}/produtos` : null}
        />
      )}

      {bdDays === 1 && (
        <BirthdayGreetingCard
          firstName={firstName}
          storeUrl={profile.tenant?.slug ? `/loja/${profile.tenant.slug}/produtos` : null}
        />
      )}

      {bdDays !== null && bdDays >= 2 && bdDays <= 90 && (
        <BirthdayBonusCard
          daysLeft={bdDays}
          storeUrl={profile.tenant?.slug ? `/loja/${profile.tenant.slug}/produtos` : null}
        />
      )}

      {pendingBalance.length > 0 && (
        <button
          type="button"
          className="w-full text-left flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 hover:bg-orange-100 transition-colors"
          onClick={onGoToReservasFiltered}
        >
          <AlertCircle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-orange-800">
              Você tem {pendingBalance.length} reserva{pendingBalance.length !== 1 ? "s" : ""} com pagamento pendente
            </p>
            <p className="text-xs text-orange-600 mt-0.5">
              Regularize para garantir sua viagem. Clique para ver as reservas.
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
        </button>
      )}

      {npsTrips.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Como foi sua viagem?
          </h3>
          {npsTrips.map((r) => (
            <NpsCard key={r.id} reservation={r} npsCategories={profile.tenant?.npsCategories} />
          ))}
        </div>
      )}

      <PreferencesSummaryCard
        client={profile.client}
        onGoToPreferences={() => onTabChange("preferencias")}
      />

      {nextTrip && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Próxima Viagem
          </h3>
          <ReservationCard r={nextTrip} compact={false} />
        </div>
      )}

      {upcoming.length > 1 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Outras viagens agendadas
            </h3>
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => onTabChange("reservas")}>
              Ver todas
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
          <div className="space-y-3">
            {upcoming.slice(1, 3).map((r) => (
              <ReservationCard key={r.id} r={r} compact />
            ))}
          </div>
        </div>
      )}

      {profile.reservations.length === 0 && (
        <div className="text-center py-8">
          <CalendarCheck className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">
            Suas reservas aparecerão aqui após a compra de um pacote.
          </p>
        </div>
      )}
    </div>
  );
}

function ReservasTab({
  profile,
  filter,
  onClearFilter,
  loyalty,
  onRefresh,
}: {
  profile: ClientPortalProfile;
  filter?: "com-saldo" | null;
  onClearFilter?: () => void;
  loyalty?: ClientLoyalty | null;
  onRefresh?: () => void;
}) {
  const { toast } = useToast();
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemReservationId, setRedeemReservationId] = useState("");
  const [redeemPoints, setRedeemPoints] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);

  const primaryColor = profile.tenant?.primaryColor ?? "#3B82F6";

  function openRedeem(reservationId: string, balance: number) {
    if (!loyalty) return;
    const maxPts = Math.min(loyalty.availablePoints, Math.ceil(balance / loyalty.realPerPoint));
    setRedeemReservationId(reservationId);
    setRedeemPoints(String(maxPts));
    setRedeemOpen(true);
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!loyalty || !redeemReservationId) return;
    const pts = parseInt(redeemPoints, 10);
    if (isNaN(pts) || pts <= 0) return;
    setRedeemLoading(true);
    try {
      const result = await clientPortalApi.redeemLoyaltyPoints(redeemReservationId, pts);
      toast({
        title: "Pontos resgatados com sucesso!",
        description: `${result.pointsRedeemed.toLocaleString("pt-BR")} pts → ${formatBRL(result.discountAmount)} de desconto aplicado.`,
      });
      setRedeemOpen(false);
      setRedeemPoints("");
      setRedeemReservationId("");
      onRefresh?.();
    } catch (err) {
      toast({
        title: "Erro ao resgatar pontos",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setRedeemLoading(false);
    }
  }

  const today = localToday();
  const all = profile.reservations;
  const canRedeem = !!loyalty && loyalty.availablePoints >= loyalty.minRedeemPoints;

  const upcoming = all.filter(
    (r) =>
      r.status !== RESERVATION_STATUS.COMPLETED &&
      r.status !== RESERVATION_STATUS.CANCELLED &&
      (!r.tripDepartureDate || r.tripDepartureDate >= today),
  );
  const past = all.filter(
    (r) =>
      r.status === RESERVATION_STATUS.CANCELLED ||
      r.status === RESERVATION_STATUS.COMPLETED ||
      (!!r.tripDepartureDate && r.tripDepartureDate < today),
  );

  if (!all.length) {
    return (
      <div className="text-center py-16">
        <CalendarCheck className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
        <h3 className="font-semibold text-lg mb-1">Nenhuma reserva encontrada</h3>
        <p className="text-muted-foreground text-sm">
          Suas reservas aparecerão aqui após a compra de um pacote.
        </p>
        {profile.tenant?.slug && (
          <Button
            className="mt-4"
            onClick={() => (window.location.href = `/loja/${profile.tenant!.slug}/produtos`)}
            style={{ backgroundColor: profile.tenant.primaryColor }}
          >
            Ver Pacotes
          </Button>
        )}
      </div>
    );
  }

  const redeemReservation = all.find((r) => r.id === redeemReservationId);
  const maxRedeemPoints = redeemReservation && loyalty
    ? Math.min(loyalty.availablePoints, Math.ceil(redeemReservation.balance / loyalty.realPerPoint))
    : 0;
  const redeemPointsNum = parseInt(redeemPoints, 10) || 0;
  const estimatedDiscount = loyalty ? redeemPointsNum * loyalty.realPerPoint : 0;

  const redeemModal = redeemOpen && loyalty ? (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !redeemLoading && setRedeemOpen(false)} />
      <div className="relative bg-background rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div>
          <h3 className="font-bold text-lg">Usar pontos nesta reserva</h3>
          <p className="text-sm text-muted-foreground">{redeemReservation?.tripName}</p>
        </div>
        <form onSubmit={handleRedeem} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reservasRedeemInput">Pontos a resgatar</Label>
            <Input
              id="reservasRedeemInput"
              type="number"
              min={loyalty.minRedeemPoints}
              max={maxRedeemPoints}
              value={redeemPoints}
              onChange={(e) => setRedeemPoints(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Disponível: {loyalty.availablePoints.toLocaleString("pt-BR")} pts · Máx. nesta reserva: {maxRedeemPoints.toLocaleString("pt-BR")} pts
            </p>
          </div>
          {redeemPointsNum >= loyalty.minRedeemPoints && (
            <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pontos usados:</span>
                <span className="font-semibold">{redeemPointsNum.toLocaleString("pt-BR")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Desconto estimado:</span>
                <span className="font-bold text-green-600">
                  {formatBRL(estimatedDiscount)}
                </span>
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setRedeemOpen(false)} disabled={redeemLoading}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={redeemLoading || redeemPointsNum < loyalty.minRedeemPoints || redeemPointsNum > maxRedeemPoints}
              style={{ backgroundColor: primaryColor }}
              className="text-white"
            >
              {redeemLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar resgate"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  if (filter === "com-saldo") {
    const withBalance = all.filter(
      (r) => r.balance > 0 && r.status !== RESERVATION_STATUS.CANCELLED,
    );
    return (
      <>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-semibold text-orange-800">
                {withBalance.length} reserva{withBalance.length !== 1 ? "s" : ""} com pagamento pendente
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={onClearFilter}
            >
              Ver todas
              <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
          {withBalance.length === 0 ? (
            <div className="text-center py-10">
              <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-400" />
              <p className="text-muted-foreground text-sm">Nenhuma reserva com saldo pendente.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {withBalance.map((r) => (
                <ReservationCard
                  key={r.id}
                  r={r}
                  onRedeemClick={canRedeem ? () => openRedeem(r.id, r.balance) : undefined}
                />
              ))}
            </div>
          )}
        </div>
        {redeemModal}
      </>
    );
  }

  return (
    <div className="space-y-8">
      {upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Próximas Viagens
          </h2>
          <div className="space-y-3">
            {upcoming.map((r) => (
              <ReservationCard
                key={r.id}
                r={r}
                onRedeemClick={canRedeem && r.balance > 0 ? () => openRedeem(r.id, r.balance) : undefined}
              />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Histórico
          </h2>
          <div className="space-y-3">
            {past.map((r) => (
              <ReservationCard key={r.id} r={r} />
            ))}
          </div>
        </section>
      )}

      {redeemModal}
    </div>
  );
}

type ResetStep = "idle" | "sending" | "code_sent" | "submitting" | "done";

function SegurancaSection({ email }: { email: string }) {
  const { toast } = useToast();
  const { signIn } = useSignIn();
  const { signOut } = useClerk();
  const [step, setStep] = useState<ResetStep>("idle");
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  function clerkErrorMessage(err: unknown): string {
    if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
    if (err instanceof Error) return err.message;
    return "Tente novamente.";
  }

  async function handleSendCode() {
    if (!signIn) return;
    setStep("sending");
    setFieldError(null);
    try {
      const initResult = await signIn.create({ identifier: email });
      if (initResult.error) throw initResult.error;
      const sendResult = await signIn.resetPasswordEmailCode.sendCode();
      if (sendResult.error) throw sendResult.error;
      setStep("code_sent");
      toast({ title: "Código enviado!", description: `Verifique sua caixa de entrada em ${email}.` });
    } catch (err) {
      setStep("idle");
      toast({
        title: "Erro ao enviar código",
        description: clerkErrorMessage(err),
        variant: "destructive",
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    if (!code.trim()) { setFieldError("Informe o código recebido."); return; }
    if (password.length < 8) { setFieldError("A senha deve ter ao menos 8 caracteres."); return; }
    if (password !== confirmPassword) { setFieldError("As senhas não coincidem."); return; }
    if (!signIn) return;
    setStep("submitting");
    try {
      const verifyResult = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
      if (verifyResult.error) throw verifyResult.error;
      const submitResult = await signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: false });
      if (submitResult.error) throw submitResult.error;
      setStep("done");
      toast({ title: "Senha atualizada!", description: "Sua nova senha foi definida com sucesso." });
    } catch (err) {
      setStep("code_sent");
      setFieldError(clerkErrorMessage(err));
    }
  }

  function handleCancel() {
    setStep("idle");
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setFieldError(null);
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await clientPortalApi.deleteMyAccount();
      await signOut();
    } catch (err) {
      setDeleting(false);
      toast({
        title: "Erro ao excluir conta",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          Segurança
        </CardTitle>
        <CardDescription>Gerencie o acesso à sua conta.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3">
          <Mail className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          <div>
            <p className="text-sm font-medium">E-mail</p>
            <p className="text-sm text-muted-foreground">
              Seu e-mail de login é <span className="font-mono">{email}</span>. Por motivos de
              segurança, a alteração de e-mail não está disponível neste portal — entre em
              contato com a sua agência caso precise atualizá-lo.
            </p>
          </div>
        </div>

        <Separator />

        <div className="flex items-start gap-3">
          <KeyRound className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium mb-1">Senha</p>

            {step === "done" ? (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check className="w-4 h-4" />
                Senha atualizada com sucesso!
              </div>
            ) : step === "idle" || step === "sending" ? (
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <p className="text-sm text-muted-foreground">
                  Clique no botão para receber um código de verificação no seu e-mail e definir uma nova senha.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSendCode}
                  disabled={step === "sending" || !email}
                  className="shrink-0"
                >
                  {step === "sending" && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  Alterar senha
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3 mt-1">
                <p className="text-sm text-muted-foreground">
                  Enviamos um código de verificação para <span className="font-mono">{email}</span>. Insira o código abaixo e escolha uma nova senha.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-code" className="text-xs">Código de verificação</Label>
                  <Input
                    id="reset-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="000000"
                    className="font-mono w-40"
                    maxLength={8}
                    autoComplete="one-time-code"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-password" className="text-xs">Nova senha</Label>
                    <Input
                      id="reset-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-confirm" className="text-xs">Confirmar nova senha</Label>
                    <Input
                      id="reset-confirm"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repita a senha"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                {fieldError && (
                  <p className="text-xs text-destructive">{fieldError}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button type="submit" size="sm" disabled={step === "submitting"}>
                    {step === "submitting" && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                    Salvar nova senha
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={handleCancel} disabled={step === "submitting"}>
                    Cancelar
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>

        <Separator />

        <div className="flex items-start gap-3">
          <Trash2 className="w-4 h-4 mt-0.5 text-destructive shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive mb-1">Excluir minha conta</p>
            <p className="text-sm text-muted-foreground mb-3">
              Remove permanentemente o seu acesso ao portal. Seus dados de reservas são preservados na agência.
              Esta ação não pode ser desfeita.
            </p>
            <AlertDialog
              open={deleteDialogOpen}
              onOpenChange={(open) => {
                setDeleteDialogOpen(open);
                if (!open) setDeleteConfirmText("");
              }}
            >
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleting}>
                  {deleting && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  Excluir minha conta
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir conta do portal?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Seu acesso ao portal será removido imediatamente. Você será desconectado e não poderá mais entrar com este e-mail.
                    Seus históricos de reservas e pagamentos ficam registrados na agência.
                    Esta ação é permanente e irreversível.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="px-1 py-2">
                  <Label htmlFor="delete-confirm" className="text-sm mb-1.5 block">
                    Para confirmar, digite <span className="font-semibold">EXCLUIR</span> abaixo:
                  </Label>
                  <Input
                    id="delete-confirm"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="EXCLUIR"
                    disabled={deleting}
                    autoComplete="off"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    disabled={deleting || deleteConfirmText !== "EXCLUIR"}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleting && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                    Sim, excluir minha conta
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DadosTab({ profile, onUpdated }: { profile: ClientPortalProfile; onUpdated: (updated: ClientPortalProfile["client"]) => void }) {
  const { toast } = useToast();
  const client = profile.client;
  const user = profile.user;

  const [name, setName] = useState(client?.name ?? user?.name ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [cpf, setCpf] = useState(client?.cpf ?? user?.cpf ?? "");
  const [birthDate, setBirthDate] = useState(client?.birthDate ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await clientPortalApi.updateProfile({
        name: name || undefined,
        phone: phone || null,
        cpf: cpf || null,
        birthDate: birthDate || null,
      });
      onUpdated(updated);
      toast({ title: "Dados atualizados!", description: "Suas informações foram salvas." });
    } catch (err) {
      toast({
        title: "Erro ao salvar",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const email = client?.email ?? user?.email ?? "";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informações Pessoais</CardTitle>
          <CardDescription>Mantenha seus dados atualizados para facilitar suas reservas.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="portal-name">Nome completo</Label>
                <Input
                  id="portal-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portal-email">E-mail</Label>
                <Input
                  id="portal-email"
                  value={email}
                  disabled
                  className="bg-muted"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portal-phone">Telefone / WhatsApp</Label>
                <Input
                  id="portal-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 99999-9999"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portal-cpf">CPF</Label>
                <Input
                  id="portal-cpf"
                  value={cpf}
                  onChange={(e) => setCpf(e.target.value)}
                  placeholder="000.000.000-00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portal-birthdate">Data de nascimento</Label>
                <Input
                  id="portal-birthdate"
                  type="date"
                  value={birthDate ?? ""}
                  onChange={(e) => setBirthDate(e.target.value)}
                />
              </div>
            </div>

            <div className="pt-2">
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Salvar Alterações
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <SegurancaSection email={email} />
    </div>
  );
}

const REFERRAL_STATUS_MAP: Record<string, { label: string; color: string; icon: ReactElement | null }> = {
  [REFERRAL_STATUS.PENDING]:   { label: "Pendente",   color: "bg-yellow-100 text-yellow-800",  icon: <Clock className="w-3.5 h-3.5" /> },
  [REFERRAL_STATUS.COMPLETED]: { label: "Confirmada", color: "bg-green-100 text-green-800",    icon: <CheckCircle className="w-3.5 h-3.5" /> },
  [REFERRAL_STATUS.CONVERTED]: { label: "Convertida", color: "bg-blue-100 text-blue-800",      icon: <CheckCircle className="w-3.5 h-3.5" /> },
  [REFERRAL_STATUS.EXPIRED]:   { label: "Expirada",   color: "bg-slate-100 text-slate-500",    icon: <XCircle className="w-3.5 h-3.5" /> },
};

function ReferralStatusBadge({ status }: { status: string }) {
  const cfg = REFERRAL_STATUS_MAP[status] ?? { label: status, color: "bg-slate-100 text-slate-600", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function maskName(name: string | null): string {
  if (!name) return "Pessoa indicada";
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

function ReferralRow({ r, primaryColor }: { r: ClientReferral; primaryColor: string }) {
  const displayName = r.referredName ? maskName(r.referredName) : (r.referredEmail ? maskEmail(r.referredEmail) : "Pessoa indicada");
  const dateLabel = (r.status === REFERRAL_STATUS.COMPLETED || r.status === REFERRAL_STATUS.CONVERTED) && r.convertedAt
    ? `Convertida em ${new Date(r.convertedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
    : r.status === REFERRAL_STATUS.EXPIRED && r.expiresAt
    ? `Expirou em ${new Date(r.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
    : `Indicada em ${new Date(r.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;

  const bonusValue = parseFloat(r.bonusAmount);

  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold mt-0.5"
        style={{ background: `${primaryColor}22`, color: primaryColor }}
      >
        {displayName.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{displayName}</span>
          <ReferralStatusBadge status={r.status} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{dateLabel}</p>
        {r.status === REFERRAL_STATUS.REVERSED && bonusValue > 0 && (
          <p className="text-xs mt-1 font-medium text-red-500">
            ✕ Bônus de {formatBRL(bonusValue)} revertido
          </p>
        )}
        {r.status === REFERRAL_STATUS.REVERSED && r.reversalReason && (
          <p className="text-[11px] text-red-400 mt-0.5">
            Motivo: {REVERSAL_REASON_LABELS[r.reversalReason] ?? r.reversalReason}
          </p>
        )}
        {(r.status === REFERRAL_STATUS.COMPLETED || r.status === REFERRAL_STATUS.CONVERTED) && bonusValue > 0 && (
          <p className={`text-xs mt-1 font-medium ${
            r.bonusCreditUsedAt
              ? "text-purple-600"
              : r.bonusPaid
              ? "text-green-600"
              : r.bonusBlocked
              ? "text-blue-600"
              : "text-orange-500"
          }`}>
            {r.bonusCreditUsedAt
              ? (() => {
                  const usedAmt = r.bonusCreditUsedAmount ? parseFloat(r.bonusCreditUsedAmount) : bonusValue;
                  return `✓ Crédito de ${formatBRL(usedAmt)} usado no checkout`;
                })()
              : r.bonusPaid
              ? `✓ Bônus de ${formatBRL(bonusValue)} pago`
              : r.bonusBlocked && r.bonusReleasesAt
              ? `🔒 Bônus de ${formatBRL(bonusValue)} disponível em ${new Date(r.bonusReleasesAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
              : `⏳ Bônus de ${formatBRL(bonusValue)} aguardando pagamento`}
          </p>
        )}
        {(r.status === REFERRAL_STATUS.COMPLETED || r.status === REFERRAL_STATUS.CONVERTED) && r.loyaltyPoints != null && r.loyaltyPoints > 0 && (
          <p className="text-xs mt-0.5 font-medium text-indigo-600 inline-flex items-center gap-1">
            <Coins className="w-3 h-3" />
            {r.loyaltyPoints.toLocaleString("pt-BR")} pontos creditados
          </p>
        )}
      </div>
    </div>
  );
}

const REVERSAL_REASON_LABELS: Record<string, string> = {
  trip_cancelled: "Viagem cancelada",
  reservation_cancelled: "Reserva cancelada",
};

const VALID_STATUS_FILTERS = ["all", "pending", "confirmed", "expired", "reversed"] as const;
type StatusFilter = (typeof VALID_STATUS_FILTERS)[number];

function parseStatusFilter(value: string | null): StatusFilter {
  if (value && (VALID_STATUS_FILTERS as readonly string[]).includes(value)) {
    return value as StatusFilter;
  }
  return "all";
}

const PAGE_SIZE = 10;

function IndicacoesTab({ profile }: { profile: ClientPortalProfile }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [loadingQr, setLoadingQr] = useState(false);
  const [referrals, setReferrals] = useState<ClientReferral[] | null>(null);
  const [loadingReferrals, setLoadingReferrals] = useState(true);
  const searchStr = useSearch();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const fromUrl = new URLSearchParams(searchStr).get("status");
    return fromUrl ? parseStatusFilter(fromUrl) : "all";
  });
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string | null>(null);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const { data: activeCampaign } = useGetActiveCampaign();
  const [countdown, setCountdown] = useState<string>("");

  const referral = profile.referral;
  const tenant = profile.tenant;
  const code = referral.code;
  const referralCodeStatus = referral.referralCodeStatus ?? "active";
  const isCodeActive = referralCodeStatus === "active";
  const shareLink = code && tenant?.slug
    ? `${window.location.origin}/loja/${tenant.slug}/indicacao?code=${code}`
    : null;
  const primaryColor = tenant?.primaryColor ?? "#3B82F6";
  const tenantLogoUrl = tenant?.logoUrl ?? null;

  const shareMessage = referral.shareMessage ?? "Use meu código e ganhe desconto na sua viagem!";
  const whatsappUrl = shareLink
    ? `https://wa.me/?text=${encodeURIComponent(`${shareMessage}\n\nMeu código: ${code}\n\n${shareLink}`)}`
    : null;

  // Sync status filter with URL query param
  useEffect(() => {
    const fromUrl = new URLSearchParams(searchStr).get("status");
    setStatusFilter(fromUrl ? parseStatusFilter(fromUrl) : "all");
  }, [searchStr]);

  // Campaign countdown
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
    clientPortalApi.getMyReferrals()
      .then((r) => setReferrals(r.data))
      .catch(() => setReferrals([]))
      .finally(() => setLoadingReferrals(false));
  }, []);

  const isConverted = (status: string) => status === REFERRAL_STATUS.COMPLETED || status === REFERRAL_STATUS.CONVERTED;

  const { paidBonus, pendingBonus, creditUsedBonus } = (referrals ?? []).reduce(
    (acc, r) => {
      if (r.status === REFERRAL_STATUS.COMPLETED || r.status === REFERRAL_STATUS.CONVERTED) {
        const amount = parseFloat(r.bonusAmount) || 0;
        if (r.bonusCreditUsedAt) {
          const usedAmt = r.bonusCreditUsedAmount ? parseFloat(r.bonusCreditUsedAmount) : amount;
          acc.creditUsedBonus += usedAmt;
          const remaining = amount - usedAmt;
          if (remaining > 0.005 && !r.bonusPaid) acc.pendingBonus += remaining;
        } else if (r.bonusPaid) {
          acc.paidBonus += amount;
        } else {
          acc.pendingBonus += amount;
        }
      }
      return acc;
    },
    { paidBonus: 0, pendingBonus: 0, creditUsedBonus: 0 },
  );

  const hasBonus = paidBonus > 0 || pendingBonus > 0 || creditUsedBonus > 0;

  // Detect the first time hasBonus transitions false → true within a session
  const hasBonusInitializedRef = useRef(false);
  const prevHasBonusRef = useRef<boolean>(false);
  useEffect(() => {
    if (loadingReferrals) return;
    if (!hasBonusInitializedRef.current) {
      hasBonusInitializedRef.current = true;
      prevHasBonusRef.current = hasBonus;
      return;
    }
    if (!prevHasBonusRef.current && hasBonus) {
      toast({
        title: "🎉 Primeiro bônus desbloqueado!",
        description: "Sua indicação foi confirmada e você ganhou seu primeiro bônus. Parabéns!",
      });
    }
    prevHasBonusRef.current = hasBonus;
  }, [hasBonus, loadingReferrals, toast]);

  const filteredReferrals = (referrals ?? []).filter((r) => {
    if (statusFilter === "pending") return r.status === REFERRAL_STATUS.PENDING;
    if (statusFilter === "confirmed") return r.status === REFERRAL_STATUS.COMPLETED || r.status === REFERRAL_STATUS.CONVERTED;
    if (statusFilter === "expired") return r.status === REFERRAL_STATUS.EXPIRED;
    if (statusFilter === "reversed") return r.status === REFERRAL_STATUS.REVERSED;
    return true;
  });

  const visibleReferrals = filteredReferrals.slice(0, visibleCount);
  const hasMore = filteredReferrals.length > visibleCount;

  const filterCounts = {
    all: referrals?.length ?? 0,
    pending: (referrals ?? []).filter((r) => r.status === REFERRAL_STATUS.PENDING).length,
    confirmed: (referrals ?? []).filter((r) => isConverted(r.status)).length,
    expired: (referrals ?? []).filter((r) => r.status === REFERRAL_STATUS.EXPIRED).length,
    reversed: (referrals ?? []).filter((r) => r.status === REFERRAL_STATUS.REVERSED).length,
  };

  function copyCode() {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast({ title: "Código copiado!" });
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function copyLink() {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopiedLink(true);
      toast({ title: "Link copiado!" });
      setTimeout(() => setCopiedLink(false), 2000);
    });
  }

  async function downloadQr() {
    if (!shareLink) return;
    setLoadingQr(true);
    try {
      const dataUrl = await QRCode.toDataURL(shareLink, { width: 256, margin: 2 });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `qr-indicacao-${code}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      toast({ title: "Erro ao gerar QR Code", variant: "destructive" });
    } finally {
      setLoadingQr(false);
    }
  }

  // Generate QR preview for dialog
  const generateQR = useCallback(async () => {
    if (!shareLink) return;
    setLoadingQr(true);
    try {
      const url = await QRCode.toDataURL(shareLink, { width: 256, margin: 2 });
      setQrPreviewUrl(url);
    } catch {
      toast({ title: "Erro ao gerar QR Code", variant: "destructive" });
    } finally {
      setLoadingQr(false);
    }
  }, [shareLink, toast]);

  const handleOpenQrDialog = useCallback(() => {
    setShowQrDialog(true);
    if (!qrPreviewUrl) generateQR();
  }, [qrPreviewUrl, generateQR]);

  const handleDownloadQR = useCallback(() => {
    if (!qrPreviewUrl || !code) return;
    const anchor = document.createElement("a");
    anchor.href = qrPreviewUrl;
    anchor.download = `qrcode-indicacao-${code}.png`;
    anchor.click();
  }, [qrPreviewUrl, code]);

  const handleShareQR = useCallback(async () => {
    if (!qrPreviewUrl || !code) return;
    try {
      const resp = await fetch(qrPreviewUrl);
      const blob = await resp.blob();
      const file = new File([blob], `qrcode-indicacao-${code}.png`, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Código de indicação" });
      } else {
        handleDownloadQR();
      }
    } catch {
      handleDownloadQR();
    }
  }, [qrPreviewUrl, code, handleDownloadQR]);

  if (!code) {
    return (
      <div className="text-center py-16">
        <Gift className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
        <h3 className="font-semibold text-lg mb-1">Código de indicação não disponível</h3>
        <p className="text-muted-foreground text-sm max-w-sm mx-auto">
          Seu código de indicação será gerado automaticamente após a confirmação da sua primeira reserva.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Suspended code banner */}
      {!isCodeActive && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {referralCodeStatus === "blocked" ? "Código bloqueado" : "Código cancelado"}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {referralCodeStatus === "blocked"
                ? "Seu código de indicação foi temporariamente bloqueado. Entre em contato com a agência para mais informações."
                : "Seu código de indicação foi cancelado. Entre em contato com a agência para mais informações."}
            </p>
          </div>
        </div>
      )}

      {/* Campaign banner */}
      {activeCampaign && countdown && (
        <div
          className="rounded-xl p-4 text-white text-center shadow-md animate-in fade-in slide-in-from-top-2 duration-500"
          style={{ background: `linear-gradient(135deg, ${primaryColor}dd, ${primaryColor}bb)` }}
        >
          <div className="flex items-center justify-center gap-2 font-bold text-base mb-1">
            <span className="text-lg">🔥</span>
            <span>
              {activeCampaign.bannerText
                ? activeCampaign.bannerText
                : activeCampaign.bonusType === "multiplier"
                  ? `Bônus ${activeCampaign.bonusValue}× por tempo limitado!`
                  : `Bônus extra de R$ ${Number(activeCampaign.bonusValue).toFixed(2).replace(".", ",")} nesta campanha!`}
            </span>
          </div>
          <p className="text-white/80 text-xs">
            Termina em{" "}
            <span className="font-mono font-semibold text-white bg-black/20 px-1.5 py-0.5 rounded">
              {countdown}
            </span>
          </p>
        </div>
      )}

      <div
        className="rounded-2xl p-6 text-white"
        style={{ background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)` }}
      >
        <div className="flex items-center gap-3 mb-3">
          {tenantLogoUrl ? (
            <img src={tenantLogoUrl} alt="Logo" className="w-10 h-10 rounded-full object-contain bg-white/20 p-1" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Gift className="w-5 h-5 text-white" />
            </div>
          )}
          <div>
            <p className="text-white font-semibold text-sm">Programa de Indicação</p>
            <p className="text-white/70 text-xs">{tenant?.name ?? "VisiteCRM"}</p>
          </div>
        </div>

        <p className="text-white/80 text-sm mb-1">Seu código de indicação</p>
        <div className="flex items-center gap-3 mb-1">
          <span
            className="text-2xl font-mono font-extrabold tracking-widest"
            style={{ color: isCodeActive ? "#ffffff" : "#9ca3af" }}
          >
            {code}
          </span>
          {isCodeActive ? (
            <button
              onClick={copyCode}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
              title="Copiar código"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
              <AlertTriangle className="w-3.5 h-3.5" />
              {referralCodeStatus === "blocked" ? "Bloqueado" : "Cancelado"}
            </span>
          )}
        </div>
        <p className="text-white/70 text-sm mb-4">
          Compartilhe com amigos e ganhe bônus a cada indicação confirmada.
        </p>

        {isCodeActive && (
          <div className="flex flex-wrap gap-2">
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 rounded-lg text-sm font-medium transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp
              </a>
            )}
            {shareLink && (
              <button
                onClick={handleOpenQrDialog}
                disabled={loadingQr}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
              >
                {loadingQr ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                QR Code
              </button>
            )}
          </div>
        )}
      </div>

      {shareLink && (
        <Card>
          <CardContent className="pt-4">
            <Label className="text-sm font-medium">Link de indicação</Label>
            <div className="flex gap-2 mt-2">
              <Input value={shareLink} readOnly className="font-mono text-xs bg-muted" />
              <Button variant="outline" size="icon" onClick={copyLink} title="Copiar link">
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tier Card */}
      {(() => {
        const tierLevel = referral.currentTierLevel ?? "bronze";
        const tierLabel = referral.currentTierLabel ?? "Bronze";
        const multiplier = referral.currentTierMultiplier ?? 1;
        const progress = referral.tierProgress ?? 0;
        const nextMin = referral.nextTierMin;
        const nextLabel = referral.nextTierLabel;
        const TIER_COLORS: Record<string, { bg: string; text: string; badge: string; badgeText: string }> = {
          bronze:  { bg: "from-amber-600 to-amber-500",    text: "text-amber-900",  badge: "bg-amber-100",  badgeText: "text-amber-700" },
          silver:  { bg: "from-slate-500 to-slate-400",    text: "text-slate-900",  badge: "bg-slate-100",  badgeText: "text-slate-600" },
          gold:    { bg: "from-yellow-500 to-yellow-400",  text: "text-yellow-900", badge: "bg-yellow-100", badgeText: "text-yellow-700" },
          diamond: { bg: "from-cyan-500 to-cyan-400",      text: "text-cyan-900",   badge: "bg-cyan-100",   badgeText: "text-cyan-700" },
        };
        const tc = TIER_COLORS[tierLevel] ?? TIER_COLORS.bronze;
        const completed = referral.completedReferrals;
        return (
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Seu nível de indicador</p>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold ${tc.badge} ${tc.badgeText}`}>
                    <Star className="w-3.5 h-3.5" />
                    {tierLabel}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground mb-0.5">Multiplicador de bônus</p>
                  <span className="text-xl font-extrabold" style={{ color: primaryColor }}>
                    {multiplier}×
                  </span>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                  <span>{tierLabel} ({completed} conv.)</span>
                  {nextLabel ? <span>{nextLabel} ({nextMin} conv.)</span> : <span>Nível máximo!</span>}
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${tc.bg} transition-all duration-700`}
                    style={{ width: `${nextLabel ? progress : 100}%` }}
                  />
                </div>
                {nextLabel && nextMin != null && (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Faltam {Math.max(nextMin - completed, 0)} indicações confirmadas para {nextLabel}
                  </p>
                )}
                {!nextLabel && (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Parabéns! Você está no nível máximo.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <div className={`grid gap-3 ${hasBonus ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <TrendingUp className="w-5 h-5 mx-auto mb-1.5" style={{ color: primaryColor }} />
            <p className="text-xl font-bold">{referral.totalReferrals}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <CheckCircle className="w-5 h-5 mx-auto mb-1.5 text-green-500" />
            <p className="text-xl font-bold">{referral.completedReferrals}</p>
            <p className="text-xs text-muted-foreground">Confirmadas</p>
          </CardContent>
        </Card>
        {hasBonus ? (
          <>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <Clock className="w-5 h-5 mx-auto mb-1.5 text-orange-400" />
                <p className="text-xl font-bold text-orange-500">
                  {formatBRL(pendingBonus)}
                </p>
                <p className="text-xs text-muted-foreground">Bônus a receber</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <Wallet className="w-5 h-5 mx-auto mb-1.5 text-green-500" />
                <p className="text-xl font-bold text-green-600">
                  {formatBRL(paidBonus)}
                </p>
                <p className="text-xs text-muted-foreground">Bônus recebido</p>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="col-span-2">
            <CardContent className="pt-4 pb-4 px-4">
              <div className="flex items-start gap-3 mb-3">
                <Gift className="w-5 h-5 shrink-0 text-muted-foreground/40 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground leading-snug">
                    {referral.completedReferrals === 0
                      ? "Indique amigos e ganhe bônus!"
                      : "Bônus em processamento"}
                  </p>
                  <p className="text-xs text-muted-foreground/60 leading-snug">
                    {referral.completedReferrals === 0
                      ? "Falta apenas 1 indicação confirmada para seu primeiro bônus!"
                      : "Você já tem indicações confirmadas — o bônus será exibido em breve."}
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {referral.completedReferrals} confirmada{referral.completedReferrals !== 1 ? "s" : ""}
                  </span>
                  <span>Meta: 1 para 1º bônus</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: referral.completedReferrals >= 1 ? "100%" : "0%",
                      backgroundColor: primaryColor,
                    }}
                  />
                </div>
                {referral.nextTierMin != null && referral.completedReferrals < referral.nextTierMin && (
                  <p className="text-xs text-muted-foreground/50 pt-0.5">
                    Chegue a {referral.nextTierMin} indicações e suba para o nível {referral.nextTierLabel} com bônus ainda maiores!
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* "Como funciona" explainer */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Como funciona</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { step: "1", text: "Compartilhe seu código ou link com amigos" },
            { step: "2", text: "Seu amigo acessa a loja e faz uma compra usando seu código" },
            { step: "3", text: "Você recebe um bônus quando a reserva for confirmada" },
          ].map(({ step, text }) => (
            <div key={step} className="flex items-start gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold"
                style={{ background: primaryColor }}
              >
                {step}
              </div>
              <p className="text-sm text-muted-foreground pt-0.5">{text}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Referral list card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Minhas Indicações</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Bonus summary pills */}
          {!loadingReferrals && hasBonus && (
            <div className="flex gap-2 flex-wrap mb-4">
              {paidBonus > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
                  <CheckCircle className="w-3.5 h-3.5" />
                  {formatBRL(paidBonus)} recebido
                </span>
              )}
              {pendingBonus > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200">
                  <Clock className="w-3.5 h-3.5" />
                  {formatBRL(pendingBonus)} a receber
                </span>
              )}
              {creditUsedBonus > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">
                  <Wallet className="w-3.5 h-3.5" />
                  {formatBRL(creditUsedBonus)} usado como crédito
                </span>
              )}
            </div>
          )}

          {/* Filter tabs */}
          {(referrals ?? []).length > 0 && (
            <div className="flex gap-1 overflow-x-auto pb-2 mb-3">
              {([
                { key: "all", label: "Todas" },
                { key: "pending", label: "Pendentes" },
                { key: "confirmed", label: "Confirmadas" },
                { key: "expired", label: "Expiradas" },
                { key: "reversed", label: "Canceladas" },
              ] as { key: StatusFilter; label: string }[]).map((f) => {
                const active = statusFilter === f.key;
                const count = filterCounts[f.key];
                return (
                  <button
                    key={f.key}
                    onClick={() => {
                      setStatusFilter(f.key);
                      setVisibleCount(PAGE_SIZE);
                    }}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      active
                        ? "text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                    style={active ? { backgroundColor: primaryColor } : undefined}
                  >
                    {f.label} {count > 0 && `(${count})`}
                  </button>
                );
              })}
            </div>
          )}

          {loadingReferrals ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 items-start py-3 border-b last:border-0">
                  <Skeleton className="w-9 h-9 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : !referrals || referrals.length === 0 ? (
            <div className="text-center py-10">
              <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
              <p className="font-medium text-sm mb-1">Nenhuma indicação ainda</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                Compartilhe seu código acima e acompanhe aqui quando seus amigos se cadastrarem.
              </p>
            </div>
          ) : filteredReferrals.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground">Nenhuma indicação nesta categoria.</p>
            </div>
          ) : (
            <div>
              {visibleReferrals.map((r) => (
                <ReferralRow key={r.id} r={r} primaryColor={primaryColor} />
              ))}
              {hasMore && (
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="w-full mt-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors border-t"
                >
                  Ver mais ({filteredReferrals.length - visibleCount} restantes)
                </button>
              )}
              {visibleCount > PAGE_SIZE && !hasMore && (
                <button
                  onClick={() => setVisibleCount(PAGE_SIZE)}
                  className="w-full mt-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors border-t"
                >
                  Mostrar menos
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* QR Code dialog */}
      <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
        <DialogContent className="max-w-xs w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-4 h-4" />
              QR Code de indicação
            </DialogTitle>
            <DialogDescription>
              Escaneie para acessar sua página de indicação.
            </DialogDescription>
          </DialogHeader>
          {qrPreviewUrl && (
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="rounded-xl border p-3 bg-white shadow-sm">
                <img
                  src={qrPreviewUrl}
                  alt="QR Code de indicação"
                  className="w-56 h-56 object-contain"
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Código: <span className="font-mono font-semibold">{code}</span>
              </p>
              <div className="flex gap-2 w-full">
                <Button className="flex-1 gap-2" onClick={handleDownloadQR}>
                  <Download className="w-4 h-4" />
                  Baixar
                </Button>
                {typeof navigator !== "undefined" &&
                "canShare" in navigator &&
                navigator.canShare({ files: [new File([], "test.png", { type: "image/png" })] }) ? (
                  <Button variant="outline" className="flex-1 gap-2" onClick={handleShareQR}>
                    <Share2 className="w-4 h-4" />
                    Compartilhar
                  </Button>
                ) : (
                  <Button variant="outline" className="flex-1 gap-2" onClick={copyLink}>
                    {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copiedLink ? "Copiado!" : "Copiar link"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TIER_CONFIG: Record<string, { label: string; color: string; bg: string; min: number; next: number | null; nextLabel: string | null }> = {
  bronze:  { label: "Bronze",   color: "text-amber-700",  bg: "bg-amber-100",  min: 0,    next: 500,  nextLabel: "Prata" },
  silver:  { label: "Prata",    color: "text-slate-500",  bg: "bg-slate-100",  min: 500,  next: 1500, nextLabel: "Ouro" },
  gold:    { label: "Ouro",     color: "text-yellow-500", bg: "bg-yellow-50",  min: 1500, next: 5000, nextLabel: "Diamante" },
  diamond: { label: "Diamante", color: "text-cyan-500",   bg: "bg-cyan-50",    min: 5000, next: null, nextLabel: null },
};

function tierLabel(tier: string): string {
  return TIER_CONFIG[tier.toLowerCase()]?.label ?? tier;
}

function TierBadge({ tier }: { tier: string }) {
  const cfg = TIER_CONFIG[tier.toLowerCase()];
  if (!cfg) return <Badge variant="outline">{tier}</Badge>;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-semibold ${cfg.bg} ${cfg.color}`}>
      <Star className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  );
}

const TRANSACTION_TYPE_MAP: Record<string, { label: string; sign: "+" | "-"; color: string; icon?: ReactElement }> = {
  earn:     { label: "Ganho",          sign: "+", color: "text-green-600" },
  redeem:   { label: "Resgate",        sign: "-", color: "text-red-600" },
  bonus:    { label: "Bônus",          sign: "+", color: "text-purple-600" },
  expire:   { label: "Expirado",       sign: "-", color: "text-orange-500" },
  refund:   { label: "Estorno",        sign: "+", color: "text-blue-600" },
  adjust:   { label: "Ajuste",         sign: "+", color: "text-slate-500" },
  referral: { label: "Bônus indicação",sign: "+", color: "text-indigo-600", icon: <Users className="w-3.5 h-3.5" /> },
};

const TIER_BENEFITS_DEFAULT: Record<string, string[]> = {
  bronze: ["Acúmulo de pontos em todas as reservas"],
  silver: ["Acúmulo de pontos em todas as reservas", "Atendimento prioritário", "Acesso antecipado a promoções"],
  gold: ["Acúmulo de pontos em todas as reservas", "Atendimento VIP", "Brindes exclusivos", "Desconto especial em pacotes"],
  diamond: ["Todos os benefícios Ouro", "Consultor exclusivo", "Upgrade gratuito em viagens", "Convites para lançamentos exclusivos"],
};

const TIER_DISPLAY_ICONS: Record<string, string> = {
  bronze: "🥉", silver: "🥈", gold: "🥇", diamond: "💎",
};

function FidelidadeTab({
  loyalty,
  primaryColor,
  reservations,
  onRefresh,
  txRefreshKey = 0,
}: {
  loyalty: ClientLoyalty | null;
  primaryColor: string;
  reservations: ClientPortalReservation[];
  onRefresh: () => void;
  txRefreshKey?: number;
}) {
  const { toast } = useToast();
  const [txItems, setTxItems] = useState<ClientLoyaltyTransaction[]>([]);
  const [txPage, setTxPage] = useState(1);
  const [txHasMore, setTxHasMore] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [txInitialized, setTxInitialized] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemReservationId, setRedeemReservationId] = useState("");
  const [redeemPoints, setRedeemPoints] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);

  useEffect(() => {
    if (loyalty && !txInitialized) {
      setTxInitialized(true);
      loadTransactions(1, true);
    }
  }, [loyalty]);

  // Force reload when a redemption happens from another tab (e.g. ReservasTab)
  useEffect(() => {
    if (txInitialized && txRefreshKey > 0) {
      loadTransactions(1, true);
    }
  }, [txRefreshKey]);

  async function loadTransactions(page: number, reset = false) {
    setTxLoading(true);
    try {
      const result = await clientPortalApi.getLoyaltyTransactions(page);
      setTxItems((prev) => (reset ? result.data : [...prev, ...result.data]));
      setTxHasMore(result.hasMore);
      setTxPage(page);
    } catch {
      if (reset && loyalty) setTxItems(loyalty.recentTransactions);
    } finally {
      setTxLoading(false);
    }
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!redeemReservationId || !loyalty) return;
    const pts = parseInt(redeemPoints, 10);
    if (isNaN(pts) || pts <= 0) return;
    setRedeemLoading(true);
    try {
      const result = await clientPortalApi.redeemLoyaltyPoints(redeemReservationId, pts);
      toast({
        title: "Pontos resgatados com sucesso!",
        description: `${result.pointsRedeemed.toLocaleString("pt-BR")} pts → ${formatBRL(result.discountAmount)} de desconto aplicado.`,
      });
      setRedeemOpen(false);
      setRedeemPoints("");
      setRedeemReservationId("");
      onRefresh();
      loadTransactions(1, true);  // refresh extrato immediately — don't wait for profile reload
    } catch (err) {
      toast({
        title: "Erro ao resgatar pontos",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setRedeemLoading(false);
    }
  }

  if (!loyalty) {
    return (
      <div className="text-center py-16">
        <Coins className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
        <h3 className="font-semibold text-lg mb-1">Programa de fidelidade não ativo</h3>
        <p className="text-muted-foreground text-sm max-w-sm mx-auto">
          Esta agência ainda não possui um programa de fidelidade. Fique atento às novidades!
        </p>
      </div>
    );
  }

  const tier = loyalty.tier.toLowerCase();
  const tierCfg = TIER_CONFIG[tier] ?? TIER_CONFIG["bronze"];
  const nextTierName = tierCfg.nextLabel;
  const progress = tierCfg.next !== null
    ? Math.min(((loyalty.totalPoints - tierCfg.min) / (tierCfg.next - tierCfg.min)) * 100, 100)
    : 100;
  const pointsToNext = tierCfg.next !== null ? Math.max(tierCfg.next - loyalty.totalPoints, 0) : 0;
  const equivalentValue = formatBRL(loyalty.availablePoints * loyalty.realPerPoint);

  const pendingReservations = reservations.filter(
    (r) => r.balance > 0 && r.status !== RESERVATION_STATUS.CANCELLED,
  );

  const selectedReservation = pendingReservations.find((r) => r.id === redeemReservationId);
  const maxRedeemPoints = selectedReservation
    ? Math.min(loyalty.availablePoints, Math.ceil(selectedReservation.balance / loyalty.realPerPoint))
    : loyalty.availablePoints;
  const redeemPointsNum = parseInt(redeemPoints, 10) || 0;
  const estimatedDiscount = redeemPointsNum * loyalty.realPerPoint;

  const displayedTransactions = txInitialized ? txItems : loyalty.recentTransactions;
  const tierBenefitsMap: Record<string, string[]> = (loyalty.tierBenefits as Record<string, string[]> | null) ?? TIER_BENEFITS_DEFAULT;

  return (
    <div className="space-y-4">
      {/* Hero card */}
      <div
        className="rounded-2xl p-6 text-white"
        style={{ background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)` }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-white/80 text-sm mb-1">Pontos disponíveis</p>
            <p className="text-4xl font-extrabold leading-none">
              {loyalty.availablePoints.toLocaleString("pt-BR")}
            </p>
            <p className="text-white/70 text-sm mt-1">≈ {equivalentValue} em valor</p>
          </div>
          <TierBadge tier={loyalty.tier} />
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-white/80 text-xs mb-1.5">
            <span>{tierLabel(loyalty.tier)}</span>
            {nextTierName && <span>{nextTierName}</span>}
          </div>
          <div className="h-2 rounded-full bg-white/20 overflow-hidden">
            <div className="h-full rounded-full bg-white/80 transition-all duration-700" style={{ width: `${progress}%` }} />
          </div>
          {nextTierName && pointsToNext > 0 && (
            <p className="text-white/70 text-xs mt-1.5">
              Faltam {pointsToNext.toLocaleString("pt-BR")} pontos para {nextTierName}
            </p>
          )}
          {!nextTierName && <p className="text-white/70 text-xs mt-1.5">Você está no nível máximo!</p>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Pontos acumulados</p>
            <p className="text-xl font-bold">{loyalty.totalPoints.toLocaleString("pt-BR")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Acúmulo</p>
            <p className="text-xl font-bold">{loyalty.pointsPerReal} pts/R$</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Mínimo para resgate</p>
            <p className="text-xl font-bold">{loyalty.minRedeemPoints.toLocaleString("pt-BR")} pts</p>
          </CardContent>
        </Card>
      </div>

      {/* Tier Benefits */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="w-4 h-4" style={{ color: primaryColor }} />
            Benefícios por nível
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 border-t">
            {(["bronze", "silver", "gold", "diamond"] as const).map((t) => {
              const cfg = TIER_CONFIG[t];
              const benefits = tierBenefitsMap[t] ?? [];
              const isCurrentTier = t === tier;
              return (
                <div key={t} className={`p-3 ${isCurrentTier ? "bg-muted/50" : ""}`}>
                  <div className={`text-xs font-bold mb-2 flex items-center gap-1 ${cfg.color}`}>
                    <span>{TIER_DISPLAY_ICONS[t]}</span>
                    <span>{cfg.label}</span>
                    {isCurrentTier && (
                      <span className="ml-auto text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full whitespace-nowrap">
                        seu nível
                      </span>
                    )}
                  </div>
                  {benefits.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Sem benefícios</p>
                  ) : (
                    <ul className="space-y-1">
                      {benefits.map((b, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                          <span className="mt-0.5 shrink-0 text-primary">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Redeem Points */}
      {pendingReservations.length > 0 && loyalty.availablePoints >= loyalty.minRedeemPoints && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="w-4 h-4" style={{ color: primaryColor }} />
              Usar pontos em reservas
            </CardTitle>
            <CardDescription>
              Aplique seus {loyalty.availablePoints.toLocaleString("pt-BR")} pontos como desconto nas reservas com saldo pendente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingReservations.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/30">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.tripName}</p>
                    <p className="text-xs text-muted-foreground">
                      Saldo pendente: {formatBRL(r.balance)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      setRedeemReservationId(r.id);
                      setRedeemPoints(String(Math.min(loyalty.availablePoints, Math.ceil(r.balance / loyalty.realPerPoint))));
                      setRedeemOpen(true);
                    }}
                  >
                    <Coins className="w-3.5 h-3.5 mr-1.5" />
                    Resgatar
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Redemption Modal */}
      {redeemOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !redeemLoading && setRedeemOpen(false)} />
          <div className="relative bg-background rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div>
              <h3 className="font-bold text-lg">Resgatar pontos</h3>
              <p className="text-sm text-muted-foreground">{selectedReservation?.tripName}</p>
            </div>
            <form onSubmit={handleRedeem} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="redeemPointsInput">Pontos a resgatar</Label>
                <Input
                  id="redeemPointsInput"
                  type="number"
                  min={loyalty.minRedeemPoints}
                  max={maxRedeemPoints}
                  value={redeemPoints}
                  onChange={(e) => setRedeemPoints(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Disponível: {loyalty.availablePoints.toLocaleString("pt-BR")} pts · Máx. para esta reserva: {maxRedeemPoints.toLocaleString("pt-BR")} pts
                </p>
              </div>
              {redeemPointsNum >= loyalty.minRedeemPoints && (
                <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pontos usados:</span>
                    <span className="font-semibold">{redeemPointsNum.toLocaleString("pt-BR")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Desconto estimado:</span>
                    <span className="font-bold text-green-600">
                      {formatBRL(estimatedDiscount)}
                    </span>
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setRedeemOpen(false)} disabled={redeemLoading}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={redeemLoading || redeemPointsNum < loyalty.minRedeemPoints || redeemPointsNum > maxRedeemPoints}
                  style={{ backgroundColor: primaryColor }}
                  className="text-white"
                >
                  {redeemLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar resgate"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Extrato de pontos</CardTitle>
          <CardDescription>{loyalty.programName}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {displayedTransactions.length === 0 && !txLoading ? (
            <div className="text-center py-10">
              <Coins className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Nenhuma transação registrada ainda.</p>
            </div>
          ) : (
            <div className="divide-y">
              {displayedTransactions.map((t) => {
                const type = TRANSACTION_TYPE_MAP[t.type] ?? { label: t.type, sign: "+" as const, color: "text-slate-500" };
                return (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{t.description}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                        {type.icon && <span className="inline-flex">{type.icon}</span>}
                        {type.label} · {new Date(t.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                      </p>
                    </div>
                    <div className="ml-4 shrink-0 text-right">
                      <p className={`text-sm font-bold ${type.color}`}>
                        {type.sign}{Math.abs(t.points).toLocaleString("pt-BR")} pts
                      </p>
                      {t.runningBalance !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          saldo: {t.runningBalance.toLocaleString("pt-BR")}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {txLoading && (
                <div className="py-4 text-center">
                  <Loader2 className="w-4 h-4 mx-auto animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          )}
          {txHasMore && !txLoading && (
            <div className="p-4 border-t">
              <Button variant="outline" size="sm" className="w-full" onClick={() => loadTransactions(txPage + 1)}>
                Carregar mais
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PreferenciasTab({
  profile,
  onUpdated,
}: {
  profile: ClientPortalProfile;
  onUpdated: (updated: ClientPortalProfile["client"]) => void;
}) {
  const { toast } = useToast();
  const c = profile.client;

  const [musicalPreferences, setMusicalPreferences] = useState(c?.musicalPreferences ?? "");
  const [favoriteDrink, setFavoriteDrink] = useState(c?.favoriteDrink ?? "");
  const [dreamDestinations, setDreamDestinations] = useState<string[]>(c?.dreamDestinations ?? []);
  const [dreamInput, setDreamInput] = useState("");
  const [foodPreferences, setFoodPreferences] = useState(c?.foodPreferences ?? "");
  const [birthDate, setBirthDate] = useState(c?.birthDate ?? "");
  const [travelInterests, setTravelInterests] = useState<string[]>(c?.travelInterests ?? []);
  const [likesPhotosVideos, setLikesPhotosVideos] = useState<boolean | null>(c?.likesPhotosVideos ?? null);
  const [preferredDestinationTypes, setPreferredDestinationTypes] = useState<string[]>(c?.preferredDestinationTypes ?? []);
  const [travelPreference, setTravelPreference] = useState(c?.travelPreference ?? "");
  const [saving, setSaving] = useState(false);

  const DESTINATION_TYPES = ["Praia", "Serra/Montanha", "Aventura", "Cultural", "Religioso", "Ecoturismo", "Campo/Fazenda", "Cidade/Urbano", "Internacional"];
  const TRAVEL_INTERESTS_OPTIONS = ["Gastronomia", "Natureza", "Cultura e história", "Compras", "Aventura", "Religiosidade", "Descanso", "Ecoturismo", "Arte e música", "Fotografia"];
  const TRAVEL_STYLES = ["Em grupo", "A dois (casal)", "Em família", "Sozinho(a)"];

  function toggleMulti(arr: string[], val: string, setArr: (v: string[]) => void) {
    setArr(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  }

  function addDream() {
    const v = dreamInput.trim();
    if (v && !dreamDestinations.includes(v)) {
      setDreamDestinations((prev) => [...prev, v]);
    }
    setDreamInput("");
  }

  async function handleSave() {
    setSaving(true);
    try {
      await clientPortalApi.updatePreferences({
        musicalPreferences: musicalPreferences || null,
        favoriteDrink: favoriteDrink || null,
        dreamDestinations,
        foodPreferences: foodPreferences || null,
        birthDate: birthDate || null,
        travelInterests,
        likesPhotosVideos,
        preferredDestinationTypes,
        travelPreference: travelPreference || null,
      });
      if (c) {
        onUpdated({
          ...c,
          musicalPreferences: musicalPreferences || null,
          favoriteDrink: favoriteDrink || null,
          dreamDestinations,
          foodPreferences: foodPreferences || null,
          birthDate: birthDate || null,
          travelInterests,
          likesPhotosVideos,
          preferredDestinationTypes,
          travelPreference: travelPreference || null,
        });
      }
      toast({ title: "Preferências salvas!", description: "Suas informações foram atualizadas." });
    } catch {
      toast({ title: "Erro ao salvar", description: "Tente novamente mais tarde.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (!c) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Complete seu cadastro para personalizar suas preferências de viagem.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h3 className="font-semibold text-base">Suas preferências de viagem</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Essas informações nos ajudam a criar experiências mais personalizadas para você.
        </p>
      </div>

      <div className="grid gap-5">
        <div className="space-y-1.5">
          <Label htmlFor="musicalPreferences">🎵 Música ou estilo musical favorito</Label>
          <Input
            id="musicalPreferences"
            placeholder="Ex: Sertanejo, MPB, Rock…"
            value={musicalPreferences}
            onChange={(e) => setMusicalPreferences(e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="favoriteDrink">🥤 Bebida favorita</Label>
          <Input
            id="favoriteDrink"
            placeholder="Ex: Suco de laranja, Café, Vinho…"
            value={favoriteDrink}
            onChange={(e) => setFavoriteDrink(e.target.value)}
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label>🌎 Destinos dos seus sonhos</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Ex: Paris, Fernando de Noronha…"
              value={dreamInput}
              onChange={(e) => setDreamInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDream();
                }
              }}
              maxLength={200}
            />
            <Button type="button" variant="outline" size="sm" onClick={addDream} className="shrink-0">
              Adicionar
            </Button>
          </div>
          {dreamDestinations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {dreamDestinations.map((dest, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-3 py-0.5 text-sm"
                >
                  {dest}
                  <button
                    type="button"
                    onClick={() => setDreamDestinations((prev) => prev.filter((_, j) => j !== i))}
                    className="ml-0.5 text-blue-400 hover:text-blue-700 leading-none"
                    aria-label={`Remover ${dest}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="foodPreferences">🍽️ Comida favorita</Label>
          <Input
            id="foodPreferences"
            placeholder="Ex: Churrasco, Frutos do mar, Pizza…"
            value={foodPreferences}
            onChange={(e) => setFoodPreferences(e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="birthDate">🎂 Data de aniversário</Label>
          <Input
            id="birthDate"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            max={localToday()}
          />
        </div>

        <div className="space-y-2">
          <Label>
            🏖️ Tipo de destino preferido{" "}
            <span className="text-muted-foreground text-xs font-normal">(pode escolher mais de um)</span>
          </Label>
          <div className="flex flex-wrap gap-2">
            {DESTINATION_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleMulti(preferredDestinationTypes, type, setPreferredDestinationTypes)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  preferredDestinationTypes.includes(type)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>
            🎯 Principais interesses durante a viagem{" "}
            <span className="text-muted-foreground text-xs font-normal">(pode escolher mais de um)</span>
          </Label>
          <div className="flex flex-wrap gap-2">
            {TRAVEL_INTERESTS_OPTIONS.map((interest) => (
              <button
                key={interest}
                type="button"
                onClick={() => toggleMulti(travelInterests, interest, setTravelInterests)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  travelInterests.includes(interest)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {interest}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>📸 Você gosta de registrar suas viagens com fotos e vídeos?</Label>
          <div className="flex gap-2">
            {([true, false] as const).map((val) => (
              <button
                key={String(val)}
                type="button"
                onClick={() => setLikesPhotosVideos(val)}
                className={`px-5 py-2 rounded-md text-sm border transition-colors ${
                  likesPhotosVideos === val
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {val ? "Sim" : "Não"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>🚌 Como você prefere viajar?</Label>
          <div className="flex flex-wrap gap-2">
            {TRAVEL_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setTravelPreference(travelPreference === style ? "" : style)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  travelPreference === style
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
        {saving ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Salvando…
          </>
        ) : (
          "Salvar preferências"
        )}
      </Button>
    </div>
  );
}

function FavoriteCard({
  name,
  imageUrl,
  price,
  salePrice,
  destination,
  link,
  onRemove,
}: {
  name: string;
  imageUrl: string | null;
  price: string;
  salePrice: string | null;
  destination: string | null;
  link: string | null;
  onRemove: () => void;
}) {
  const [, navigate] = useLocation();
  const displayPrice = salePrice ?? price;
  const hasDiscount = !!salePrice;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex gap-3 p-3">
          <div className="w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-blue-100 to-blue-200">
            {imageUrl ? (
              <img src={imageUrl} alt={name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <MapPin className="w-6 h-6 text-blue-300" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm line-clamp-2 leading-tight mb-1">{name}</h4>
            {destination && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <MapPin className="w-3 h-3" /> {destination}
              </div>
            )}
            <div className="flex items-center gap-2 mt-auto">
              {hasDiscount && (
                <span className="text-xs text-muted-foreground line-through">
                  R$ {parseFloat(price).toFixed(2)}
                </span>
              )}
              <span className="text-sm font-bold text-primary">
                R$ {parseFloat(displayPrice).toFixed(2)}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0 justify-center">
            {link && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-3"
                onClick={() => navigate(link)}
              >
                Ver
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50"
              onClick={onRemove}
              title="Remover dos favoritos"
            >
              <Heart className="w-4 h-4 fill-current" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FavoritosTab({ tenantSlug }: { tenantSlug: string | null }) {
  const { toast } = useToast();
  const [data, setData] = useState<FavoritesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clientPortalApi
      .getFavorites()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleRemove(itemType: "trip" | "product", itemId: string) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        trips: itemType === "trip" ? prev.trips.filter((t) => t.tripId !== itemId) : prev.trips,
        products: itemType === "product" ? prev.products.filter((p) => p.productId !== itemId) : prev.products,
      };
    });
    try {
      await clientPortalApi.removeFavorite(itemType, itemId);
    } catch {
      clientPortalApi.getFavorites().then(setData).catch(() => {});
      toast({ title: "Erro ao remover favorito", description: "Tente novamente.", variant: "destructive" });
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const total = (data?.trips.length ?? 0) + (data?.products.length ?? 0);

  if (total === 0) {
    return (
      <div className="text-center py-16">
        <Heart className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
        <h3 className="font-semibold text-lg mb-1">Nenhum favorito ainda</h3>
        <p className="text-muted-foreground text-sm max-w-xs mx-auto">
          Toque no ❤ nos cards da loja para guardar suas viagens preferidas aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data?.trips.map((trip) => (
        <FavoriteCard
          key={trip.favoriteId}
          name={trip.name}
          imageUrl={trip.imageUrl}
          price={trip.price}
          salePrice={trip.salePrice}
          destination={trip.destination}
          link={tenantSlug ? `/loja/${tenantSlug}/produtos/${trip.productSlug}` : null}
          onRemove={() => handleRemove("trip", trip.tripId)}
        />
      ))}
      {data?.products.map((product) => (
        <FavoriteCard
          key={product.favoriteId}
          name={product.name}
          imageUrl={product.imageUrl}
          price={product.price}
          salePrice={product.salePrice}
          destination={null}
          link={tenantSlug ? `/loja/${tenantSlug}/produtos/${product.productSlug}` : null}
          onRemove={() => handleRemove("product", product.productId)}
        />
      ))}
    </div>
  );
}

const BADGE_META: Record<string, { name: string; description: string; emoji: string; earnedClass: string }> = {
  primeira_viagem:    { name: "Primeira Viagem",      description: "Realizou sua primeira viagem conosco",    emoji: "✈️", earnedClass: "bg-blue-50 border-blue-200" },
  viajante_frequente: { name: "Viajante Frequente",   description: "5 ou mais viagens confirmadas",           emoji: "⭐", earnedClass: "bg-yellow-50 border-yellow-200" },
  explorador:         { name: "Explorador",            description: "10 ou mais viagens realizadas",           emoji: "🗺️", earnedClass: "bg-green-50 border-green-200" },
  grande_aventureiro: { name: "Grande Aventureiro",   description: "20 ou mais viagens realizadas",           emoji: "🏆", earnedClass: "bg-purple-50 border-purple-200" },
  explorador_brasil:  { name: "Explorador do Brasil", description: "Visitou 5 ou mais estados brasileiros",   emoji: "🇧🇷", earnedClass: "bg-emerald-50 border-emerald-200" },
  embaixador:         { name: "Embaixador",            description: "Indicou 3 ou mais amigos com sucesso",   emoji: "👥", earnedClass: "bg-pink-50 border-pink-200" },
  aniversariante:     { name: "Aniversariante do Mês",description: "Parabéns pelo seu aniversário neste mês!",emoji: "🎂", earnedClass: "bg-orange-50 border-orange-200" },
  cliente_fiel:       { name: "Cliente Fiel",         description: "Membro ativo do programa de fidelidade", emoji: "💎", earnedClass: "bg-indigo-50 border-indigo-200" },
};

function ConquistasTab() {
  const [data, setData] = useState<ClientAchievementsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clientPortalApi.getAchievements().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
    );
  }

  const earned = (data?.badges ?? []).filter(b => b.earned);
  const locked = (data?.badges ?? []).filter(b => !b.earned);

  return (
    <div className="space-y-6">
      {earned.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Conquistas desbloqueadas ({earned.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {earned.map(badge => {
              const meta = BADGE_META[badge.key] ?? { name: badge.name, description: badge.description, emoji: "🏅", earnedClass: "bg-yellow-50 border-yellow-200" };
              return (
                <div key={badge.key} className={`rounded-xl border-2 p-4 text-center space-y-1.5 shadow-sm ${meta.earnedClass}`}>
                  <div className="text-3xl">{meta.emoji}</div>
                  <div className="font-semibold text-sm leading-tight">{meta.name}</div>
                  <div className="text-xs text-muted-foreground leading-tight">{meta.description}</div>
                  {badge.earnedAt && (
                    <div className="text-xs text-muted-foreground pt-1 border-t border-black/10">{formatDateShort(badge.earnedAt)}</div>
                  )}
                  {badge.target != null && (
                    <div className="mt-1">
                      <div className="h-1.5 rounded-full bg-black/10">
                        <div className="h-1.5 rounded-full bg-current" style={{ width: `${Math.round(((badge.progress ?? 0) / badge.target) * 100)}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {locked.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Ainda por desbloquear ({locked.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {locked.map(badge => {
              const meta = BADGE_META[badge.key] ?? { name: badge.name, description: badge.description, emoji: "🔒", earnedClass: "" };
              return (
                <div key={badge.key} className="rounded-xl border-2 border-dashed border-muted p-4 text-center space-y-1.5 bg-muted/30 opacity-60">
                  <div className="text-3xl grayscale">{meta.emoji}</div>
                  <div className="font-semibold text-sm leading-tight text-muted-foreground">{meta.name}</div>
                  <div className="text-xs text-muted-foreground leading-tight">{meta.description}</div>
                  {badge.target != null && (
                    <div className="mt-1">
                      <div className="h-1.5 rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-muted-foreground/40" style={{ width: `${Math.round(((badge.progress ?? 0) / badge.target) * 100)}%` }} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{badge.progress ?? 0}/{badge.target}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {earned.length === 0 && locked.length === 0 && (
        <div className="text-center py-16">
          <Trophy className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="font-semibold text-lg mb-1">Nenhuma conquista ainda</h3>
          <p className="text-muted-foreground text-sm">Faça sua primeira viagem para começar a desbloquear conquistas!</p>
        </div>
      )}
    </div>
  );
}

const BRAZIL_STATE_GRID = [
  { uf: "RR", name: "Roraima",              col: 3,  row: 1 },
  { uf: "AP", name: "Amapá",               col: 6,  row: 1 },
  { uf: "AM", name: "Amazonas",            col: 2,  row: 2 },
  { uf: "PA", name: "Pará",               col: 4,  row: 2 },
  { uf: "MA", name: "Maranhão",           col: 6,  row: 2 },
  { uf: "PI", name: "Piauí",             col: 7,  row: 2 },
  { uf: "CE", name: "Ceará",             col: 8,  row: 2 },
  { uf: "RN", name: "Rio Grande do Norte",col: 9,  row: 2 },
  { uf: "AC", name: "Acre",              col: 1,  row: 3 },
  { uf: "RO", name: "Rondônia",          col: 2,  row: 3 },
  { uf: "TO", name: "Tocantins",         col: 4,  row: 3 },
  { uf: "BA", name: "Bahia",            col: 6,  row: 3 },
  { uf: "PB", name: "Paraíba",          col: 8,  row: 3 },
  { uf: "PE", name: "Pernambuco",       col: 9,  row: 3 },
  { uf: "AL", name: "Alagoas",          col: 10, row: 3 },
  { uf: "SE", name: "Sergipe",          col: 10, row: 2 },
  { uf: "MT", name: "Mato Grosso",      col: 3,  row: 4 },
  { uf: "GO", name: "Goiás",           col: 5,  row: 4 },
  { uf: "DF", name: "Distrito Federal", col: 6,  row: 4 },
  { uf: "MG", name: "Minas Gerais",    col: 7,  row: 4 },
  { uf: "ES", name: "Espírito Santo",  col: 9,  row: 4 },
  { uf: "MS", name: "Mato Grosso do Sul", col: 4, row: 5 },
  { uf: "SP", name: "São Paulo",       col: 6,  row: 5 },
  { uf: "RJ", name: "Rio de Janeiro",  col: 8,  row: 5 },
  { uf: "PR", name: "Paraná",         col: 6,  row: 6 },
  { uf: "SC", name: "Santa Catarina", col: 6,  row: 7 },
  { uf: "RS", name: "Rio Grande do Sul", col: 6, row: 8 },
];

function MapaTab() {
  const [data, setData] = useState<ClientAchievementsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clientPortalApi.getAchievements().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton className="h-96 rounded-xl" />;

  const visitedStates = new Set(data?.stats.visitedStates ?? []);
  const totalTrips = data?.stats.totalTrips ?? 0;
  const visitedCount = visitedStates.size;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-bold text-primary">{totalTrips}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Viagens realizadas</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-bold text-primary">{visitedCount}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Estados visitados</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-bold text-primary">{data?.stats.uniqueDestinations.length ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Destinos únicos</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Map className="w-4 h-4" />
            Brasil — estados visitados
          </CardTitle>
          <CardDescription>
            {visitedCount} de 27 estados ({Math.round((visitedCount / 27) * 100)}%)
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          <div
            className="grid gap-1 w-full"
            style={{ gridTemplateColumns: "repeat(10, minmax(0, 1fr))", gridTemplateRows: "repeat(8, 2rem)" }}
          >
            {BRAZIL_STATE_GRID.map(state => {
              const visited = visitedStates.has(state.uf);
              return (
                <div
                  key={state.uf}
                  title={state.name}
                  style={{ gridColumn: state.col, gridRow: state.row }}
                  className={[
                    "flex items-center justify-center rounded text-xs font-bold cursor-default select-none transition-all",
                    visited
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground",
                  ].join(" ")}
                >
                  {state.uf}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-primary inline-block" />
              Visitado
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-muted border inline-block" />
              Não visitado
            </span>
          </div>
        </CardContent>
      </Card>

      {visitedCount > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Estados que você conheceu</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {BRAZIL_STATE_GRID.filter(s => visitedStates.has(s.uf)).map(s => (
                <span key={s.uf} className="inline-flex items-center gap-1 bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-xs font-medium">
                  {s.uf} · {s.name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {visitedCount === 0 && (
        <div className="text-center py-8">
          <p className="text-muted-foreground text-sm">Nenhum estado visitado ainda. Faça sua primeira viagem!</p>
        </div>
      )}
    </div>
  );
}

function SonhosTab() {
  const [items, setItems] = useState<DreamDestinationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    clientPortalApi.getDreamDestinations()
      .then(d => setItems(d.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const addDestination = async () => {
    const val = input.trim();
    if (!val || items.length >= 30 || saving) return;
    setSaving(true);
    try {
      const created = await clientPortalApi.addDreamDestination(val);
      setItems(prev => [created, ...prev]);
      setInput("");
    } catch {
      toast({ title: "Erro ao adicionar destino", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const removeDestination = async (id: string) => {
    setSaving(true);
    try {
      await clientPortalApi.removeDreamDestination(id);
      setItems(prev => prev.filter(d => d.id !== id));
    } catch {
      toast({ title: "Erro ao remover destino", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">🌎 Quero Conhecer</h2>
        <p className="text-sm text-muted-foreground">
          Salve os destinos dos seus sonhos. Usamos essas informações para criar ofertas personalizadas para você.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Ex: Fernando de Noronha, Bariloche, Paris…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDestination(); } }}
          maxLength={200}
          disabled={saving}
          className="flex-1"
        />
        <Button type="button" onClick={addDestination} disabled={!input.trim() || saving || items.length >= 30} size="sm" className="shrink-0">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Adicionar"}
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-14 border-2 border-dashed border-muted rounded-xl">
          <Globe className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <h3 className="font-semibold text-base mb-1">Sua lista está vazia</h3>
          <p className="text-muted-foreground text-sm">Adicione destinos que você sonha em conhecer!</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{items.length} destino{items.length !== 1 ? "s" : ""} na lista</p>
          {items.map((dest) => (
            <div key={dest.id} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 group hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2.5">
                <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="font-medium text-sm">{dest.destinationName}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                onClick={() => removeDestination(dest.id)}
                disabled={saving}
              >
                <span className="text-lg leading-none">×</span>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryCertificate({ memory }: { memory: ClientMemoriesResponse["memories"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 transition-colors"
      >
        <Trophy className="w-3 h-3" />
        Certificado
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 text-center space-y-4 border-4 border-amber-300"
            onClick={(e) => e.stopPropagation()}
          >
            <Trophy className="w-12 h-12 mx-auto text-amber-500" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Certificado de Viagem</p>
              <h2 className="text-xl font-bold text-gray-900">{memory.tripName}</h2>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 space-y-1">
              <div className="flex items-center justify-center gap-1 text-sm text-amber-800">
                <MapPin className="w-3.5 h-3.5" />
                <span>{memory.tripDestination}</span>
              </div>
              <p className="text-xs text-amber-600">
                {formatDateShort(memory.tripDepartureDate)}
                {memory.tripReturnDate ? ` – ${formatDateShort(memory.tripReturnDate)}` : ""}
              </p>
            </div>
            <p className="text-xs text-gray-500 italic">Confirma que você viveu esta experiência inesquecível.</p>
            <button className="text-xs text-muted-foreground underline" onClick={() => setOpen(false)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function MemoriasTab() {
  const [data, setData] = useState<ClientMemoriesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clientPortalApi.getMemories().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
      </div>
    );
  }

  const memories = data?.memories ?? [];

  if (memories.length === 0) {
    return (
      <div className="text-center py-16">
        <Camera className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
        <h3 className="font-semibold text-lg mb-1">Nenhuma memória ainda</h3>
        <p className="text-muted-foreground text-sm max-w-xs mx-auto">
          Suas viagens passadas aparecerão aqui com fotos e recordações.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{memories.length} viagem{memories.length !== 1 ? "s" : ""} na sua história</p>
      {memories.map(memory => (
        <Card key={memory.reservationId} className="overflow-hidden">
          <div className="flex">
            {memory.tripCoverImage ? (
              <div className="w-24 sm:w-32 shrink-0 overflow-hidden bg-muted">
                <img
                  src={memory.tripCoverImage}
                  alt={memory.tripName}
                  className="w-full h-full object-cover"
                  style={{ minHeight: "7rem" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            ) : (
              <div className="w-24 sm:w-32 shrink-0 bg-muted flex items-center justify-center min-h-28">
                <Plane className="w-8 h-8 text-muted-foreground/30" />
              </div>
            )}
            <div className="flex-1 p-4 space-y-2 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm leading-tight truncate">{memory.tripName}</h3>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 shrink-0" />
                    <span className="truncate">{memory.tripDestination}{memory.tripDestinationState ? ` — ${memory.tripDestinationState}` : ""}</span>
                  </p>
                </div>
                {memory.npsSubmitted && (
                  <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5 shrink-0">
                    <CheckCircle className="w-3 h-3" />
                    Avaliado
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDateShort(memory.tripDepartureDate)}
                {memory.tripReturnDate ? ` → ${formatDateShort(memory.tripReturnDate)}` : ""}
              </div>
              {memory.media.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {memory.media.slice(0, 5).map(m => (
                    <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer"
                      className="block w-10 h-10 rounded overflow-hidden bg-muted border hover:ring-2 hover:ring-primary transition-all">
                      <img src={m.url} alt={m.caption ?? ""} className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    </a>
                  ))}
                  {memory.media.length > 5 && (
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground border">
                      +{memory.media.length - 5}
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-2 border-t mt-1">
                <a
                  href={clientPortalApi.getVoucherUrl(memory.reservationId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border bg-card hover:bg-muted transition-colors"
                >
                  <Download className="w-3 h-3" />
                  Baixar Voucher
                </a>
                <MemoryCertificate memory={memory} />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function maskDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0] ?? name;
  return `${parts[0]} ${(parts[parts.length - 1] ?? "").charAt(0).toUpperCase()}.`;
}

const TIER_LABELS: Record<string, string> = { bronze: "Bronze", silver: "Prata", gold: "Ouro", diamond: "Diamante" };
const TIER_ICONS: Record<string, string> = { bronze: "🥉", silver: "🥈", gold: "🥇", diamond: "💎" };
const TIER_COLORS: Record<string, string> = {
  bronze: "border-amber-200 bg-amber-50",
  silver: "border-slate-200 bg-slate-50",
  gold: "border-yellow-200 bg-yellow-50",
  diamond: "border-cyan-200 bg-cyan-50",
};
const TIER_ORDER = ["bronze", "silver", "gold", "diamond"];

function ClubeTab({ profile }: { profile: ClientPortalProfile }) {
  const { toast } = useToast();
  const [config, setConfig] = useState<{ clubName: string; description: string | null } | null>(null);
  const [benefits, setBenefits] = useState<ClubBenefit[]>([]);
  const [ranking, setRanking] = useState<ClubRankingResponse | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [optIn, setOptIn] = useState<boolean>(profile.client?.ambassadorOptIn ?? false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [cfg, bnf, rnk] = await Promise.all([
          clientPortalApi.getClubConfig(),
          clientPortalApi.getClubBenefits(),
          clientPortalApi.getClubRanking(),
        ]);
        setConfig(cfg);
        setBenefits(bnf.data);
        setRanking(rnk);
      } catch {
        // club might not be configured yet — silently ignore
      } finally {
        setLoadingData(false);
      }
    }
    void load();
  }, []);

  async function handleToggleOptIn() {
    const newVal = !optIn;
    setToggling(true);
    try {
      await clientPortalApi.setAmbassadorOptIn(newVal);
      setOptIn(newVal);
      toast({
        title: newVal ? "Você está no ranking de Embaixadores!" : "Você saiu do ranking.",
        description: newVal ? "Seu nome aparecerá mascarado no leaderboard público." : undefined,
      });
    } catch {
      toast({ title: "Erro ao atualizar configuração", variant: "destructive" });
    } finally {
      setToggling(false);
    }
  }

  const currentTier = profile.loyalty?.tier ?? "bronze";
  const tierIndex = TIER_ORDER.indexOf(currentTier);
  const upperTiers = TIER_ORDER.slice(tierIndex + 1);
  const currentBenefits = benefits.filter((b) => b.tier === currentTier);
  const upperTierBenefits = upperTiers
    .map((t) => ({ tier: t, benefits: benefits.filter((b) => b.tier === t) }))
    .filter(({ benefits: bs }) => bs.length > 0);

  const month = ranking?.month
    ? new Date(ranking.month + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" })
    : "";

  return (
    <div className="space-y-6">
      {/* Club header */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-amber-500 to-yellow-400 p-6 text-white">
          <div className="flex items-center gap-3">
            <Crown className="w-8 h-8" />
            <div>
              <h2 className="text-xl font-bold">{config?.clubName ?? "Clube Visite"}</h2>
              {config?.description && (
                <p className="text-sm opacity-90 mt-0.5">{config.description}</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="relative inline-flex">
              <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/30 relative z-10">
                {TIER_ICONS[currentTier]} {TIER_LABELS[currentTier] ?? currentTier}
              </Badge>
              <span className="absolute inset-0 rounded-full animate-ping bg-white/30 z-0" />
            </span>
            <span className="text-sm opacity-75">Seu nível atual</span>
          </div>
        </div>
      </Card>

      {/* Current tier benefits */}
      {loadingData ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : currentBenefits.length > 0 ? (
        <Card className={`border ${TIER_COLORS[currentTier]}`}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <span>{TIER_ICONS[currentTier]}</span>
              Seus benefícios — {TIER_LABELS[currentTier] ?? currentTier}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {currentBenefits.map((b) => (
                <li key={b.id} className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-sm font-medium">{b.label}</span>
                    {b.value && <Badge variant="outline" className="ml-2 text-xs">{b.value}</Badge>}
                    {b.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{b.description}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* All upper tier previews */}
      {upperTierBenefits.map(({ tier, benefits: tierBs }, idx) => (
        <Card key={tier} className={`border border-dashed ${TIER_COLORS[tier] ?? ""}`}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <span>{TIER_ICONS[tier]}</span>
                {idx === 0 ? "Próximo nível" : "Nível"} — {TIER_LABELS[tier] ?? tier}
              </CardTitle>
              <Badge variant="outline" className="text-xs">
                {idx === 0 ? "Em breve" : "Futuro"}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Suba para {TIER_LABELS[tier] ?? tier} e desbloqueie:
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 opacity-60">
              {tierBs.map((b) => (
                <li key={b.id} className="flex items-start gap-2">
                  <Star className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-sm font-medium">{b.label}</span>
                    {b.value && <Badge variant="outline" className="ml-2 text-xs">{b.value}</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      {/* Ambassador opt-in */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            Ranking de Embaixadores
          </CardTitle>
          <CardDescription>
            Apareça no ranking público de top indicadores e viajantes do mês.
            {profile.client?.name
              ? ` Seu nome será exibido como "${maskDisplayName(profile.client.name)}" — parcialmente mascarado.`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {optIn ? "Participando do ranking" : "Fora do ranking"}
              </p>
              <p className="text-xs text-muted-foreground">
                {optIn
                  ? "Seu nome aparece mascarado no leaderboard público"
                  : "Ative para aparecer entre os top embaixadores"}
              </p>
            </div>
            <Button
              variant={optIn ? "default" : "outline"}
              size="sm"
              onClick={handleToggleOptIn}
              disabled={toggling}
              className="gap-1.5 shrink-0"
            >
              {toggling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Crown className="w-3.5 h-3.5" />
              )}
              {optIn ? "Sair do ranking" : "Participar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Ranking leaderboard */}
      {ranking && (ranking.referrers.length > 0 || ranking.travelers.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Share2 className="w-4 h-4 text-muted-foreground" />
                Top Indicadores — {month}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {ranking.referrers.length === 0 ? (
                <p className="text-xs text-muted-foreground px-6 pb-4">Nenhum indicador este mês.</p>
              ) : (
                <div className="divide-y">
                  {ranking.referrers.map((r) => (
                    <div key={r.rank} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-base w-6 text-center shrink-0">
                        {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`}
                      </span>
                      <span className="flex-1 text-sm font-medium truncate">{r.name}</span>
                      <Badge variant="secondary" className="text-xs tabular-nums shrink-0">
                        {r.count}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Plane className="w-4 h-4 text-muted-foreground" />
                Top Viajantes — {month}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {ranking.travelers.length === 0 ? (
                <p className="text-xs text-muted-foreground px-6 pb-4">Nenhum viajante este mês.</p>
              ) : (
                <div className="divide-y">
                  {ranking.travelers.map((r) => (
                    <div key={r.rank} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-base w-6 text-center shrink-0">
                        {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`}
                      </span>
                      <span className="flex-1 text-sm font-medium truncate">{r.name}</span>
                      <Badge variant="secondary" className="text-xs tabular-nums shrink-0">
                        {r.count}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * Valid values for the `?tab=<value>` query parameter on this page.
 *
 * Deep-link format: `/perfil?tab=<value>`
 *
 * Examples:
 *   /perfil?tab=reservas      → opens the Reservas (bookings) tab
 *   /perfil?tab=fidelidade    → opens the Fidelidade (loyalty) tab
 *   /perfil?tab=indicacoes    → opens the Indicações (referrals) tab
 *   /perfil?tab=dados         → opens the Meus Dados tab
 *   /perfil?tab=favoritos     → opens the Favoritos tab
 *
 * Invalid or missing values fall back to "inicio".
 */
const VALID_PERFIL_TABS = ["inicio", "reservas", "dados", "indicacoes", "fidelidade", "preferencias", "favoritos", "conquistas", "mapa", "sonhos", "memorias", "clube"];

export default function PerfilPage() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const { data: me } = useGetMe();
  const [profile, setProfile] = useState<ClientPortalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState(() => {
    const t = new URLSearchParams(searchStr).get("tab");
    return VALID_PERFIL_TABS.includes(t ?? "") ? t! : "inicio";
  });
  const [reservationFilter, setReservationFilter] = useState<"com-saldo" | null>(null);
  const [loyaltyTxKey, setLoyaltyTxKey] = useState(0);

  useEffect(() => {
    const t = new URLSearchParams(searchStr).get("tab");
    if (t && VALID_PERFIL_TABS.includes(t)) setActiveTab(t);
  }, [searchStr]);

  useEffect(() => {
    clientPortalApi
      .getProfile()
      .then(setProfile)
      .catch((err) => setError(err.message ?? "Erro ao carregar perfil"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">{error ?? "Não foi possível carregar o perfil."}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/")}>
          Voltar
        </Button>
      </div>
    );
  }

  const primaryColor = profile.tenant?.primaryColor ?? "#3B82F6";

  return (
    <div>
      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          if (tab === "reservas") setReservationFilter(null);
          setActiveTab(tab);
          const params = new URLSearchParams(searchStr);
          params.set("tab", tab);
          navigate(`?${params.toString()}`, { replace: true });
        }}
      >
        <TabsList className="mb-6 w-full sm:w-auto flex-wrap h-auto gap-1">
          <TabsTrigger value="inicio" className="flex items-center gap-1.5">
            <LayoutDashboard className="w-4 h-4" />
            Início
          </TabsTrigger>
          <TabsTrigger value="reservas" className="flex items-center gap-1.5">
            <CalendarCheck className="w-4 h-4" />
            Reservas
            {profile.reservations.length > 0 && (
              <Badge variant="secondary" className="ml-0.5 text-xs px-1.5 py-0">
                {profile.reservations.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="dados" className="flex items-center gap-1.5">
            <User className="w-4 h-4" />
            Meus Dados
          </TabsTrigger>
          <TabsTrigger value="indicacoes" className="flex items-center gap-1.5">
            <Share2 className="w-4 h-4" />
            Indicações
          </TabsTrigger>
          <TabsTrigger value="fidelidade" className="flex items-center gap-1.5">
            <Star className="w-4 h-4" />
            Fidelidade
            {profile.loyalty !== null && (profile.loyalty?.availablePoints ?? 0) > 0 && (
              <Badge variant="secondary" className="ml-0.5 text-xs px-1.5 py-0">
                {(profile.loyalty?.availablePoints ?? 0).toLocaleString("pt-BR")}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="preferencias" className="flex items-center gap-1.5">
            <Heart className="w-4 h-4" />
            Preferências
          </TabsTrigger>
          <TabsTrigger value="favoritos" className="flex items-center gap-1.5">
            <Heart className="w-4 h-4 fill-current text-red-400" />
            Favoritos
          </TabsTrigger>
          <TabsTrigger value="conquistas" className="flex items-center gap-1.5">
            <Trophy className="w-4 h-4" />
            Conquistas
          </TabsTrigger>
          <TabsTrigger value="mapa" className="flex items-center gap-1.5">
            <Map className="w-4 h-4" />
            Mapa
          </TabsTrigger>
          <TabsTrigger value="sonhos" className="flex items-center gap-1.5">
            <Globe className="w-4 h-4" />
            Sonhos
          </TabsTrigger>
          <TabsTrigger value="memorias" className="flex items-center gap-1.5">
            <Camera className="w-4 h-4" />
            Memórias
          </TabsTrigger>
          <TabsTrigger value="clube" className="flex items-center gap-1.5">
            <Crown className="w-4 h-4" />
            Clube
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inicio">
          <InicioTab
            profile={profile}
            primaryColor={primaryColor}
            onTabChange={(tab) => {
              if (tab === "reservas") setReservationFilter(null);
              setActiveTab(tab);
            }}
            onGoToReservasFiltered={() => {
              setReservationFilter("com-saldo");
              setActiveTab("reservas");
            }}
          />
        </TabsContent>

        <TabsContent value="reservas">
          <ReservasTab
            profile={profile}
            filter={reservationFilter}
            onClearFilter={() => setReservationFilter(null)}
            loyalty={profile.loyalty}
            onRefresh={() => {
              clientPortalApi.getProfile().then(setProfile).catch(() => {});
              setLoyaltyTxKey((k) => k + 1);
            }}
          />
        </TabsContent>

        <TabsContent value="dados">
          <DadosTab
            profile={profile}
            onUpdated={(updated) => {
              setProfile((prev) => prev ? { ...prev, client: updated } : prev);
            }}
          />
        </TabsContent>

        <TabsContent value="indicacoes">
          <IndicacoesTab profile={profile} />
        </TabsContent>

        <TabsContent value="fidelidade">
          <FidelidadeTab
            loyalty={profile.loyalty}
            primaryColor={primaryColor}
            reservations={profile.reservations}
            txRefreshKey={loyaltyTxKey}
            onRefresh={() => {
              clientPortalApi.getProfile().then(setProfile).catch(() => {});
            }}
          />
        </TabsContent>

        <TabsContent value="preferencias">
          <PreferenciasTab
            profile={profile}
            onUpdated={(updated) => {
              setProfile((prev) => prev ? { ...prev, client: updated } : prev);
            }}
          />
        </TabsContent>

        <TabsContent value="favoritos">
          <FavoritosTab tenantSlug={profile.tenant?.slug ?? null} />
        </TabsContent>

        <TabsContent value="conquistas">
          <ConquistasTab />
        </TabsContent>

        <TabsContent value="mapa">
          <MapaTab />
        </TabsContent>

        <TabsContent value="sonhos">
          <SonhosTab />
        </TabsContent>

        <TabsContent value="memorias">
          <MemoriasTab />
        </TabsContent>

        <TabsContent value="clube">
          <ClubeTab profile={profile} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

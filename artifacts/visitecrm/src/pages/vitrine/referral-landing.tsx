import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useGetMe } from "@workspace/api-client-react";
import { PublicStore, publicStoreApi, ReferralValidation, PublicApiError } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Gift, Tag, Users, ArrowRight, CheckCircle, AlertTriangle } from "lucide-react";
import { ROLES } from "@workspace/permissions";
import { setStorefrontReferralCode } from "@/lib/storefrontAttribution";
import { FIRST_PURCHASE_REFERRAL_MESSAGE } from "./referral-messages";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";

interface Props {
  slug: string;
  store: PublicStore;
}

function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    code: params.get("code") ?? params.get("ref") ?? null,
  };
}

export default function ReferralLanding({ slug, store }: Props) {
  const [, navigate] = useLocation();
  const { isSignedIn, isLoaded } = useUser();
  const { data: me } = useGetMe();
  const { colors } = useVitrineTheme();
  const [referralInfo, setReferralInfo] = useState<ReferralValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [tracked, setTracked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuspended, setIsSuspended] = useState(false);

  const { code } = getUrlParams();

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn && me?.role === ROLES.CLIENT) {
      navigate("/perfil?tab=indicacoes");
    }
  }, [isLoaded, isSignedIn, me?.role]);

  const trackVisit = useCallback((code: string) => {
    // VitrineLayout owns the network event for every page. This landing only
    // stores the validated code so that owner can emit a single safe event.
    setStorefrontReferralCode(slug, code);
    setTracked(true);
  }, [slug]);

  useEffect(() => {
    if (!code) {
      setLoading(false);
      setError("Código de indicação não encontrado na URL.");
      return;
    }

    // Validate the code
    publicStoreApi.getReferralInfo(slug, code)
      .then((info) => {
        setReferralInfo(info);
        // Track the visit
        trackVisit(code);
      })
      .catch((err: unknown) => {
        if (err instanceof PublicApiError && err.code === "REFERRAL_CODE_SUSPENDED") {
          setIsSuspended(true);
          setError("Este código de indicação está suspenso e não pode ser utilizado no momento.");
        } else {
          setError("Este código de indicação é inválido ou expirou.");
        }
      })
      .finally(() => setLoading(false));
  }, [code, slug, trackVisit]);

  function goToStore() {
    navigate(`/loja/${slug}`);
  }

  function goToProducts() {
    navigate(`/loja/${slug}/produtos`);
  }

  if (store.referralsEnabled === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 py-16">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Gift className="w-8 h-8 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Indicações indisponíveis</h1>
        <p className="text-muted-foreground mb-6 max-w-sm">
          O programa de indicações desta loja não está disponível no momento.
        </p>
         <Button onClick={goToStore} style={{ background: colors.primary, color: colors.primaryForeground }}>
          Ver a loja
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[calc(100dvh-4.5rem)] items-center justify-center px-4 py-16" style={{ background: `linear-gradient(135deg, ${colors.primarySoft}, ${colors.secondarySoft})` }}>
        <Loader2 className="h-9 w-9 animate-spin" style={{ color: colors.primary }} />
      </div>
    );
  }

  if (error || !referralInfo) {
    return (
      <div className="flex min-h-[calc(100dvh-4.5rem)] flex-col items-center justify-center px-4 py-16 text-center">
        <div className={`mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ${isSuspended ? "bg-amber-100" : "bg-red-100"}`}>
          {isSuspended ? (
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          ) : (
            <Tag className="w-8 h-8 text-red-500" />
          )}
        </div>
        <h1 className="text-2xl font-bold mb-2">
          {isSuspended ? "Código suspenso" : "Código inválido"}
        </h1>
        <p className="text-muted-foreground mb-6 max-w-sm">
          {error ?? "Este código de indicação não existe ou já foi utilizado."}
        </p>
         <Button onClick={goToStore} style={{ background: colors.primary, color: colors.primaryForeground }}>
          Ver a loja mesmo assim
        </Button>
      </div>
    );
  }

  const discountType = referralInfo.discountType ?? "percentage";
  const isFixed = discountType === "fixed";
  const discountAmount = isFixed
    ? (referralInfo.discountValue ?? 0)
    : (referralInfo.discountPercent ?? 5);
  const discountLabel = isFixed
    ? `R$ ${discountAmount.toFixed(2).replace(".", ",")}`
    : `${discountAmount}%`;
  const referrerName = referralInfo.referrerName ?? "um amigo";
  const storeHasLogo = !!store.logoUrl;

  return (
    <div className="min-h-[calc(100dvh-4.5rem)]" style={{ background: `linear-gradient(135deg, ${colors.primarySoft}, ${colors.secondarySoft})` }}>
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-10 text-center sm:py-16">
        {/* Logo */}
        {storeHasLogo ? (
          <img src={store.logoUrl ?? ""} alt={store.name} className="h-16 mx-auto object-contain rounded-xl" />
        ) : (
           <h2 className="text-2xl font-semibold tracking-[-0.03em]" style={{ color: colors.primary }}>{store.name}</h2>
        )}

        {/* Main hero */}
        <div className="space-y-3">
          <div
             className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl shadow-lg"
             style={{ background: colors.gradientHero }}
          >
            <Gift className="w-10 h-10 text-white" />
          </div>
           <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
             Você foi indicado por <span style={{ color: colors.primary }}>{referrerName}</span>!
          </h1>
          <p className="text-muted-foreground text-lg">
            Aproveite um desconto exclusivo na sua primeira compra
          </p>
          {referralInfo.firstPurchaseOnly && (
            <p role="note" className="text-sm text-muted-foreground max-w-md mx-auto">
              {FIRST_PURCHASE_REFERRAL_MESSAGE}
            </p>
          )}
        </div>

        {/* Discount Badge */}
        <div
           className="space-y-2 rounded-[1.75rem] p-6 text-white shadow-xl sm:p-8"
           style={{ background: colors.gradientHero }}
        >
          <p className="text-white/80 text-sm uppercase tracking-widest font-medium">Seu desconto exclusivo</p>
          <p className="text-6xl font-extrabold">{discountLabel}</p>
          <p className="text-white/80 text-sm">OFF em qualquer produto</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <span className="bg-white/20 rounded-full px-4 py-1 text-sm font-mono font-bold tracking-widest">
              {code}
            </span>
            {tracked && (
              <CheckCircle className="w-5 h-5 text-white/80" />
            )}
          </div>
        </div>

        {/* How it works */}
         <div className="space-y-4 rounded-[1.5rem] border border-white/70 bg-white/70 p-6 text-left shadow-sm backdrop-blur-sm">
          <h3 className="font-semibold text-center">Como funciona</h3>
          <div className="space-y-3">
            {[
              { icon: Tag, text: `Seu código "${code}" já está salvo automaticamente` },
              { icon: Users, text: "Escolha seu produto favorito e finalize a compra" },
              { icon: Gift, text: `${discountLabel} de desconto aplicado automaticamente no checkout` },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-start gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                   style={{ background: colors.primarySoft }}
                >
                   <span className="text-xs font-bold" style={{ color: colors.primary }}>{i + 1}</span>
                </div>
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Perks */}
         <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { icon: CheckCircle, label: "Seguro e confiável" },
            { icon: Tag, label: `${discountLabel} OFF garantido` },
            { icon: Gift, label: "Sem limites de produtos" },
          ].map(({ icon: Icon, label }, i) => (
            <div key={i} className="space-y-2 rounded-2xl border border-white/60 bg-white/55 p-3 text-center">
               <Icon className="mx-auto h-5 w-5" style={{ color: colors.primary }} />
              <p className="text-xs font-medium">{label}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="space-y-3">
          <Button
            size="lg"
            className="w-full text-white font-semibold text-base h-12 rounded-xl shadow-lg"
             style={{ background: colors.gradientHero, color: colors.primaryForeground }}
            onClick={goToProducts}
          >
            Ver produtos com desconto
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={goToStore}
          >
            Explorar a loja
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {store.name} · Programa de Indicações · Desconto válido na primeira compra
        </p>
      </div>
    </div>
  );
}

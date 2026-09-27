import { useState, useEffect, useMemo } from "react";
import { localToday } from "@workspace/shared";
import { useLocation } from "wouter";
import {
  publicStoreApi,
  PublicStore,
  StoreProduct,
  StoreCategory,
  StoreReview,
} from "@/lib/storeApi";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/vitrine/SectionHeader";
import { PremiumProductCard } from "@/components/vitrine/PremiumProductCard";
import { FlashSaleCountdown } from "@/components/vitrine/FlashSaleCountdown";
import { getStoredValue } from "./utils/storage";
import { FIRST_PURCHASE_REFERRAL_MESSAGE } from "./referral-messages";
import {
  MapPin,
  Star,
  ChevronRight,
  ArrowRight,
  Quote,
  Gift,
  X,
  ShieldCheck,
  Headphones,
  CreditCard,
  Sparkles,
  Search,
  Calendar,
  Users,
  Clock,
} from "lucide-react";

interface DestinationGroup {
  destination: string;
  image: string | null;
  priceFrom: number;
  durationDays: number | null;
  count: number;
  sales: number;
}

function ReferralWelcomeBanner({
  slug,
  primaryColor,
}: {
  slug: string;
  primaryColor: string;
}) {
  const [visible, setVisible] = useState(false);
  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [discountLabel, setDiscountLabel] = useState<string>("5%");
  const [firstPurchaseOnly, setFirstPurchaseOnly] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isWelcome = params.get("welcome") === "true";
    const refCode = params.get("ref");
    if (!isWelcome || !refCode) return;

    setVisible(true);
    setFirstPurchaseOnly(false);

    const storedName = getStoredValue("referral_referrer_name");
    if (storedName) setReferrerName(storedName);

    publicStoreApi
      .getReferralInfo(slug, refCode)
      .then((info) => {
        if (info?.referrerName) setReferrerName(info.referrerName);
        setFirstPurchaseOnly(info?.firstPurchaseOnly === true);
        if (info) {
          const type = info.discountType ?? "percentage";
          const val =
            type === "fixed"
              ? info.discountValue ?? 0
              : info.discountPercent ?? 5;
          setDiscountLabel(
            type === "fixed"
              ? `R$ ${val.toFixed(2).replace(".", ",")}`
              : `${val}%`,
          );
        }
      })
      .catch(() => {});
  }, [slug]);

  if (!visible) return null;

  return (
    <div
      data-testid="banner-referral-welcome"
      className="relative flex items-center gap-3 border-b border-white/10 px-4 py-3.5 text-white shadow-lg"
      style={{
        background: `linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor}cc 100%)`,
      }}
    >
      <Gift className="w-6 h-6 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm md:text-base">
          {referrerName
            ? `Você foi indicado por ${referrerName}! 🎉`
            : "Você chegou por indicação! 🎉"}
        </p>
        <p className="text-white/85 text-xs md:text-sm">
          Ganhe <strong>{discountLabel} de desconto</strong> na sua reserva. O
          código já está salvo para você!
        </p>
        {firstPurchaseOnly && (
          <p role="note" className="text-white/80 text-xs md:text-sm">
            {FIRST_PURCHASE_REFERRAL_MESSAGE}
          </p>
        )}
      </div>
      <button
        onClick={() => setVisible(false)}
        data-testid="button-dismiss-referral"
        className="shrink-0 rounded-full p-2 transition-colors hover:bg-white/20"
        aria-label="Fechar"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

const TRUST_ITEMS = [
  {
    icon: ShieldCheck,
    title: "Reserva segura",
    desc: "Pagamento protegido e confirmação imediata",
  },
  {
    icon: Headphones,
    title: "Atendimento próximo",
    desc: "Suporte humano por WhatsApp em todas as etapas",
  },
  {
    icon: CreditCard,
    title: "Parcele sua viagem",
    desc: "Diversas formas de pagamento e parcelamento",
  },
  {
    icon: Sparkles,
    title: "Experiências selecionadas",
    desc: "Roteiros escolhidos a dedo pela nossa equipe",
  },
];

export default function VitrineHome({
  slug,
  store,
}: {
  slug: string;
  store: PublicStore;
}) {
  const [, navigate] = useLocation();
  const { colors } = useVitrineTheme();
  const [featured, setFeatured] = useState<StoreProduct[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [reviews, setReviews] = useState<StoreReview[]>([]);
  const [allProducts, setAllProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);

  const [destino, setDestino] = useState("");
  const [dataIda, setDataIda] = useState("");
  const [passageiros, setPassageiros] = useState("");
  const [tipo, setTipo] = useState("");
  const [orcamento, setOrcamento] = useState("");
  const todayStr = localToday(); // Brazil calendar date (America/Sao_Paulo)

  useEffect(() => {
    Promise.allSettled([
      publicStoreApi.getProducts(slug, { featured: true, limit: 6 }),
      publicStoreApi.getCategories(slug),
      publicStoreApi.getReviews(slug, { limit: 6 }),
      publicStoreApi.getProducts(slug, { limit: 200 }),
    ])
      .then(([p, c, r, all]) => {
        if (p.status === "fulfilled") setFeatured(p.value.data);
        if (c.status === "fulfilled") setCategories(c.value);
        if (r.status === "fulfilled") setReviews(r.value);
        if (all.status === "fulfilled") setAllProducts(all.value.data);
      })
      .finally(() => setLoading(false));
  }, [slug]);

  const avgRating =
    reviews.length > 0
      ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length
      : null;

  const destinations = useMemo(
    () =>
      Array.from(
        new Set(
          allProducts
            .map((p) => p.destination)
            .filter((d): d is string => !!d && d.trim().length > 0),
        ),
      ).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [allProducts],
  );
  const hasDestinations = destinations.length > 0;

  const flashSales = useMemo(() => {
    const now = Date.now();
    return allProducts
      .filter(
        (p) =>
          p.onSale &&
          p.salePrice &&
          p.saleEndsAt &&
          new Date(p.saleEndsAt).getTime() > now,
      )
      .sort(
        (a, b) =>
          new Date(a.saleEndsAt!).getTime() - new Date(b.saleEndsAt!).getTime(),
      );
  }, [allProducts]);

  const destinationGroups = useMemo<DestinationGroup[]>(() => {
    const map = new Map<string, DestinationGroup>();
    for (const p of allProducts) {
      const dest = p.destination?.trim();
      if (!dest) continue;
      const priceNum = parseFloat(p.salePrice ?? p.price);
      const img = p.thumbnail ?? p.images?.[0] ?? p.gallery?.[0] ?? null;
      const existing = map.get(dest);
      if (!existing) {
        map.set(dest, {
          destination: dest,
          image: img,
          priceFrom: Number.isFinite(priceNum) ? priceNum : Infinity,
          durationDays: p.durationDays ?? null,
          count: 1,
          sales: p.salesCount ?? 0,
        });
      } else {
        existing.count += 1;
        existing.sales += p.salesCount ?? 0;
        if (Number.isFinite(priceNum) && priceNum < existing.priceFrom)
          existing.priceFrom = priceNum;
        if (!existing.image && img) existing.image = img;
        if (existing.durationDays == null && p.durationDays != null)
          existing.durationDays = p.durationDays;
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.sales - a.sales || b.count - a.count)
      .slice(0, 8);
  }, [allProducts]);

  const soonestSaleEnd = flashSales[0]?.saleEndsAt ?? null;

  function submitSmartSearch(e: React.FormEvent) {
    e.preventDefault();
    const qs = new URLSearchParams();
    const destinoTrim = destino.trim();
    if (destinoTrim) {
      if (hasDestinations) qs.set("destination", destinoTrim);
      else qs.set("search", destinoTrim);
    }
    if (dataIda) qs.set("departureFrom", dataIda);
    if (passageiros) qs.set("minSeats", passageiros);
    if (tipo) qs.set("type", tipo);
    if (orcamento) qs.set("maxPrice", orcamento);
    const str = qs.toString();
    navigate(`/loja/${slug}/produtos${str ? `?${str}` : ""}`);
  }

  return (
    <div className="min-h-[100dvh] overflow-hidden bg-slate-50 text-slate-900">
      {store.referralsEnabled !== false && (
        <ReferralWelcomeBanner slug={slug} primaryColor={colors.primary} />
      )}

      {/* Hero */}
      <section
        data-testid="section-hero"
        className="relative isolate overflow-visible"
      >
        {store.bannerUrl ? (
          <>
            {/* Desktop banner (≥640 px) — always rendered */}
            <img
              src={store.bannerUrl}
              alt={store.name}
              className={`absolute inset-0 h-full w-full object-cover${store.bannerMobileUrl ? " hidden sm:block" : ""}`}
            />
            {/* Mobile banner (<640 px) — only when a separate one is configured */}
            {store.bannerMobileUrl && (
              <img
                src={store.bannerMobileUrl}
                alt={store.name}
                className="absolute inset-0 h-full w-full object-cover sm:hidden"
              />
            )}
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: colors.gradientHero }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: store.bannerUrl
              ? "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.30) 40%, rgba(0,0,0,0.65) 100%)"
              : "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.35) 100%)",
          }}
        />

        <div className="relative mx-auto flex min-h-[550px] max-w-6xl flex-col items-center justify-center px-5 py-20 text-center text-white sm:min-h-[590px] md:items-start md:text-left lg:px-8">
          {store.logoUrl && (
            <img
              src={store.logoUrl}
              alt={store.name}
              data-testid="img-store-logo-hero"
              className="mb-6 h-16 w-auto rounded-2xl bg-white/95 p-2 shadow-xl sm:h-20"
            />
          )}
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] backdrop-blur-md">
            <MapPin className="h-3.5 w-3.5" />
            Viagens & Excursões
          </span>
          <h1 data-testid="text-store-seo-title" className="max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.055em] drop-shadow-md sm:text-6xl md:text-7xl">
            {store.seoTitle ?? store.name}
          </h1>
          {store.description && (
            <p data-testid="text-store-description" className="mt-5 max-w-xl text-base leading-relaxed text-white/90 drop-shadow sm:text-lg">
              {store.description}
            </p>
          )}

          <form
            data-testid="form-smart-search"
            onSubmit={submitSmartSearch}
            className="mt-8 w-full max-w-5xl rounded-[1.75rem] border border-white/70 bg-white p-3 text-left shadow-[0_24px_70px_rgba(15,23,42,0.24)] sm:p-4 md:mt-10"
          >
            <div className="mb-3 flex flex-col gap-1 px-2 sm:flex-row sm:items-baseline sm:justify-between sm:px-3">
              <strong className="text-sm tracking-[-0.01em] text-slate-900">Encontre seu próximo destino</strong>
              <span className="text-xs text-slate-500">Use os filtros para planejar com mais tranquilidade.</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 lg:items-stretch">
              <label className="flex min-h-14 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 focus-within:border-slate-400 lg:border-0 lg:border-r lg:rounded-none">
                <MapPin className="h-5 w-5 shrink-0" style={{ color: colors.primary }} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    Destino
                  </span>
                  {hasDestinations ? (
                    <select
                      data-testid="select-search-destination"
                      value={destino}
                      onChange={(e) => setDestino(e.target.value)}
                      className="min-w-0 bg-transparent text-sm font-semibold text-slate-800 outline-none"
                    >
                      <option value="">Todos os destinos</option>
                      {destinations.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      data-testid="input-search-destination"
                      value={destino}
                      onChange={(e) => setDestino(e.target.value)}
                      placeholder="Para onde você quer viajar?"
                      className="min-w-0 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
                    />
                  )}
                </span>
              </label>

              <label className="flex min-h-14 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 focus-within:border-slate-400 lg:border-0 lg:border-r lg:rounded-none">
                <Calendar className="h-5 w-5 shrink-0" style={{ color: colors.primary }} />
                <span className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    Data de ida
                  </span>
                  <input
                    data-testid="input-search-date"
                    type="date"
                    value={dataIda}
                    min={todayStr}
                    onChange={(e) => setDataIda(e.target.value)}
                    className="bg-transparent text-sm font-semibold text-slate-800 outline-none"
                  />
                </span>
              </label>

              <label className="flex min-h-14 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 focus-within:border-slate-400 lg:border-0 lg:border-r lg:rounded-none">
                <Sparkles className="h-5 w-5 shrink-0" style={{ color: colors.primary }} />
                <span className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    Experiência
                  </span>
                  <select
                    data-testid="select-search-type"
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value)}
                    className="bg-transparent text-sm font-semibold text-slate-800 outline-none"
                  >
                    <option value="">Todos os tipos</option>
                    <option value="package">Pacotes</option>
                    <option value="tour">Passeios</option>
                    <option value="hotel">Hospedagem</option>
                    <option value="service">Serviços</option>
                    <option value="cruise">Cruzeiros</option>
                  </select>
                </span>
              </label>

              <label className="flex min-h-14 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 focus-within:border-slate-400 lg:border-0 lg:border-r lg:rounded-none">
                <CreditCard className="h-5 w-5 shrink-0" style={{ color: colors.accent }} />
                <span className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    Orçamento
                  </span>
                  <select
                    data-testid="select-search-budget"
                    value={orcamento}
                    onChange={(e) => setOrcamento(e.target.value)}
                    className="bg-transparent text-sm font-semibold text-slate-800 outline-none"
                  >
                    <option value="">Qualquer valor</option>
                    <option value="500">Até R$ 500</option>
                    <option value="1000">Até R$ 1.000</option>
                    <option value="2500">Até R$ 2.500</option>
                    <option value="5000">Até R$ 5.000</option>
                  </select>
                </span>
              </label>

              <label className="flex min-h-14 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 focus-within:border-slate-400 lg:border-0 lg:border-r lg:rounded-none">
                <Users className="h-5 w-5 shrink-0" style={{ color: colors.primary }} />
                <span className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    Passageiros
                  </span>
                  <select
                    data-testid="select-search-passengers"
                    value={passageiros}
                    onChange={(e) => setPassageiros(e.target.value)}
                    className="bg-transparent text-sm font-semibold text-slate-800 outline-none"
                  >
                    <option value="">Qualquer</option>
                    {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? "passageiro" : "passageiros"}
                      </option>
                    ))}
                  </select>
                </span>
              </label>

              <Button
                data-testid="button-smart-search"
                type="submit"
                size="lg"
                className="min-h-14 shrink-0 gap-1.5 rounded-xl font-semibold shadow-sm lg:col-span-1"
                style={{
                  background: colors.primary,
                  color: colors.primaryForeground,
                }}
              >
                <Search className="h-4 w-4" />
                Encontrar Viagens
              </Button>
            </div>
          </form>

          <button
            data-testid="button-view-all-hero"
            onClick={() => navigate(`/loja/${slug}/produtos`)}
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-white/90 underline-offset-4 transition-transform hover:translate-x-1 hover:underline"
          >
            Ver todos os pacotes
            <ArrowRight className="h-4 w-4" />
          </button>

          {store.contactWhatsapp && (
            <a
              data-testid="link-whatsapp-hero"
              href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}?text=${encodeURIComponent("Olá! Quero ajuda para escolher uma experiência de viagem.")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-white/90 underline-offset-4 hover:underline"
            >
              <Headphones className="h-4 w-4" />
              Falar com um especialista
            </a>
          )}

          {avgRating !== null && (
            <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-sm backdrop-blur">
              <span className="flex items-center gap-0.5 text-amber-300">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`h-4 w-4 ${
                      i < Math.round(avgRating)
                        ? "fill-current"
                        : "text-white/40"
                    }`}
                  />
                ))}
              </span>
              <span className="font-semibold">{avgRating.toFixed(1)}</span>
              <span className="text-white/80">
                ({reviews.length} avaliações)
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Trust strip */}
      <section data-testid="section-trust" className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-5 gap-y-7 px-5 py-9 lg:grid-cols-4 lg:px-8">
          {TRUST_ITEMS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
                style={{ background: colors.primarySoft, color: colors.primary }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div data-testid="content-storefront" className="mx-auto max-w-6xl space-y-20 px-5 py-16 lg:px-8 lg:py-20">
        {flashSales.length > 0 && (
          <section data-testid="section-flash-sales">
            <SectionHeader
              eyebrow="Ofertas"
              title="Ofertas Relâmpago"
              subtitle="Promoções por tempo limitado — aproveite antes que terminem."
              action={
                <Button
                  data-testid="button-view-all-sales"
                  variant="ghost"
                  onClick={() => navigate(`/loja/${slug}/produtos`)}
                  className="gap-1 rounded-full"
                  style={{ color: colors.primary }}
                >
                  Ver todos
                  <ChevronRight className="h-4 w-4" />
                </Button>
              }
            />
            {soonestSaleEnd && (
              <FlashSaleCountdown
                endsAt={soonestSaleEnd}
                variant="banner"
                className="mb-6 rounded-2xl border border-orange-200 bg-orange-50 text-orange-900"
              />
            )}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {flashSales.slice(0, 6).map((product) => (
                <PremiumProductCard
                  key={product.id}
                  product={product}
                  slug={slug}
                  whatsapp={store.contactWhatsapp}
                />
              ))}
            </div>
          </section>
        )}

        {categories.length > 0 && (
          <section data-testid="section-categories">
            <SectionHeader
              eyebrow="Explore"
              title="Categorias"
              subtitle="Encontre a experiência perfeita para a sua próxima viagem."
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  data-testid={`button-category-${cat.id}`}
                  onClick={() =>
                    navigate(`/loja/${slug}/produtos?categoryId=${cat.id}`)
                  }
                  className="group relative flex h-40 items-end overflow-hidden rounded-[1.35rem] border border-slate-200/70 p-4 text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl sm:h-48"
                  style={
                    cat.imageUrl
                      ? undefined
                      : { background: colors.gradientHero }
                  }
                >
                  {cat.imageUrl && (
                    <>
                      <img
                        src={cat.imageUrl}
                        alt={cat.name}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                    </>
                  )}
                  <span className="relative flex w-full items-center justify-between text-sm font-bold text-white sm:text-base">
                    {cat.name}
                    <ChevronRight className="h-4 w-4 opacity-80 transition-transform group-hover:translate-x-1" />
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {(loading || featured.length > 0) && (
          <section data-testid="section-featured-products">
            <SectionHeader
              eyebrow="Imperdível"
              title="Pacotes em Destaque"
              subtitle="As experiências mais procuradas, escolhidas para você."
              action={
                <Button
                  data-testid="button-view-all-featured"
                  variant="ghost"
                  onClick={() => navigate(`/loja/${slug}/produtos`)}
                  className="gap-1 rounded-full"
                  style={{ color: colors.primary }}
                >
                  Ver todos
                  <ChevronRight className="h-4 w-4" />
                </Button>
              }
            />
            {loading ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-80 animate-pulse rounded-2xl border bg-muted"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {featured.map((product) => (
                  <PremiumProductCard
                    key={product.id}
                    product={product}
                    slug={slug}
                    whatsapp={store.contactWhatsapp}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {destinationGroups.length > 0 && (
          <section data-testid="section-destinations">
            <SectionHeader
              eyebrow="Tendências"
              title="Destinos mais procurados"
              subtitle="Os lugares preferidos dos nossos viajantes."
            />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
              {destinationGroups.map((g) => (
                <button
                  key={g.destination}
                  data-testid={`button-destination-${g.destination}`}
                  onClick={() =>
                    navigate(
                      `/loja/${slug}/produtos?destination=${encodeURIComponent(g.destination)}`,
                    )
                  }
                  className="group relative flex h-52 items-end overflow-hidden rounded-[1.35rem] border border-slate-200/70 text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl first:col-span-2 md:first:col-span-2 md:first:row-span-2"
                  style={
                    g.image ? undefined : { background: colors.gradientHero }
                  }
                >
                  {g.image && (
                    <img
                      src={g.image}
                      alt={g.destination}
                        loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                  )}
                   <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-900/25 to-transparent" />
                  <div className="relative w-full p-4 text-white">
                    <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-white/80">
                      <MapPin className="h-3.5 w-3.5" />
                      {g.count} {g.count === 1 ? "pacote" : "pacotes"}
                    </div>
                    <h3 className="mt-0.5 text-lg font-bold leading-tight drop-shadow">
                      {g.destination}
                    </h3>
                    <div className="overflow-hidden transition-all duration-300 md:max-h-0 md:opacity-0 md:group-hover:max-h-28 md:group-hover:opacity-100">
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/90">
                        {Number.isFinite(g.priceFrom) && (
                          <span className="font-semibold">
                            A partir de {formatCurrency(g.priceFrom)}
                          </span>
                        )}
                        {g.durationDays != null && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {g.durationDays}{" "}
                            {g.durationDays === 1 ? "dia" : "dias"}
                          </span>
                        )}
                      </div>
                      <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold">
                        Ver Detalhes
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {!loading && allProducts.length === 0 && (
          <section data-testid="state-empty-products" className="flex flex-col items-center rounded-[1.75rem] border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <div
              className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: colors.primarySoft }}
            >
              <Sparkles className="h-10 w-10" style={{ color: colors.primary }} />
            </div>
             <h2 className="mb-3 text-3xl font-semibold tracking-tight">Em breve, novidades!</h2>
             <p className="mb-6 max-w-sm text-sm leading-relaxed text-slate-500">
              Estamos preparando pacotes incríveis para você. Fique de olho — novidades chegam em breve!
            </p>
            {store.contactWhatsapp && (
              <a
                data-testid="link-whatsapp-empty-state"
                href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: colors.primary }}
              >
                Fale conosco no WhatsApp
              </a>
            )}
          </section>
        )}

        {reviews.length > 0 && (
          <section data-testid="section-reviews">
            <SectionHeader
              eyebrow="Depoimentos"
              title="O que dizem nossos clientes"
              subtitle="Avaliações reais de viajantes satisfeitos."
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  data-testid={`card-review-${review.id}`}
                  className="flex min-h-56 flex-col gap-3 rounded-[1.35rem] border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
                >
                  <Quote
                     className="h-7 w-7 shrink-0"
                    style={{ color: colors.accent }}
                  />
                  <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
                    {review.comment ?? "Excelente experiência!"}
                  </p>
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                         style={{ color: colors.accent }}
                         className={`h-3.5 w-3.5 ${
                          i < review.rating
                            ? "fill-yellow-400 text-yellow-400"
                             : "fill-slate-200 text-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="mt-auto flex items-center gap-2 border-t pt-3">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      style={{
                        background: colors.primary,
                        color: colors.primaryForeground,
                      }}
                    >
                      {(review.customerName ?? "?")[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {review.customerName ?? "Cliente"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(review.createdAt).toLocaleDateString("pt-BR", {
                          month: "long",
                          year: "numeric",
                          timeZone: "America/Sao_Paulo",
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <section
          data-testid="section-storefront-cta"
          className="relative overflow-hidden rounded-[1.75rem] px-6 py-14 text-center text-white shadow-xl sm:px-10"
          style={{ background: colors.gradientCta }}
        >
          <div className="relative z-10">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">Planeje com confiança</span>
          <h3 className="mt-3 text-3xl font-semibold tracking-tight md:text-5xl">
            Pronto para a próxima aventura?
          </h3>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/85 md:text-base">
            Descubra nossos roteiros e garanta a sua vaga com facilidade e segurança.
          </p>
          <Button
            data-testid="button-explore-products-cta"
            size="lg"
            onClick={() => navigate(`/loja/${slug}/produtos`)}
            className="mt-7 rounded-full bg-white px-6 font-bold shadow-lg hover:bg-white/90"
            style={{ color: colors.primary }}
          >
            Explorar pacotes
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          {store.contactWhatsapp && (
            <a
              data-testid="link-whatsapp-cta"
              href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}?text=${encodeURIComponent("Olá! Quero ajuda para escolher uma experiência de viagem.")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white/85 underline-offset-4 hover:text-white hover:underline"
            >
              <Headphones className="h-4 w-4" />
              Conversar com a equipe local
            </a>
          )}
          </div>
        </section>

        {store.paymentMethods.length > 0 && (
          <section data-testid="section-payment-methods" className="rounded-[1.35rem] border border-slate-200 bg-white p-7 text-center">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">Formas de pagamento disponíveis</h3>
            <div className="flex flex-wrap justify-center gap-3">
              {store.paymentMethods.map((m) => (
                <Badge
                  key={m}
                  variant="secondary"
                  className="px-4 py-2 text-sm"
                >
                  {m === "pix"
                    ? "PIX"
                    : m === "boleto"
                      ? "Boleto"
                      : m === "credit_card"
                        ? "Cartão de Crédito"
                        : m === "debit_card"
                          ? "Cartão de Débito"
                          : m === "transfer"
                            ? "Transferência"
                            : m}
                </Badge>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isWelcome = params.get("welcome") === "true";
    const refCode = params.get("ref");
    if (!isWelcome || !refCode) return;

    setVisible(true);

    const storedName = getStoredValue("referral_referrer_name");
    if (storedName) setReferrerName(storedName);

    publicStoreApi
      .getReferralInfo(slug, refCode)
      .then((info) => {
        if (info?.referrerName) setReferrerName(info.referrerName);
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
      className="relative text-white px-4 py-4 flex items-center gap-3 shadow-lg"
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
      </div>
      <button
        onClick={() => setVisible(false)}
        className="shrink-0 p-1 rounded-full hover:bg-white/20 transition-colors"
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
    <div>
      {store.referralsEnabled !== false && (
        <ReferralWelcomeBanner slug={slug} primaryColor={colors.primary} />
      )}

      {/* Hero */}
      <section className="relative overflow-hidden">
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

        <div className="relative mx-auto flex min-h-[460px] max-w-5xl flex-col items-center justify-center px-4 py-20 text-center text-white md:min-h-[540px]">
          {store.logoUrl && (
            <img
              src={store.logoUrl}
              alt={store.name}
              className="mb-6 h-20 w-auto rounded-2xl bg-white/95 p-2 shadow-lg"
            />
          )}
          <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] backdrop-blur">
            <MapPin className="h-3.5 w-3.5" />
            Viagens & Excursões
          </span>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight drop-shadow-md md:text-6xl">
            {store.seoTitle ?? store.name}
          </h1>
          {store.description && (
            <p className="mt-4 max-w-2xl text-base text-white/90 drop-shadow md:text-xl">
              {store.description}
            </p>
          )}

          <form
            onSubmit={submitSmartSearch}
            className="mt-8 w-full max-w-3xl rounded-3xl bg-white/95 p-3 text-left shadow-2xl backdrop-blur md:rounded-full md:p-2"
          >
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-0">
              <label className="flex flex-1 items-center gap-2 px-3 py-2 md:py-1">
                <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Destino
                  </span>
                  {hasDestinations ? (
                    <select
                      value={destino}
                      onChange={(e) => setDestino(e.target.value)}
                      className="min-w-0 bg-transparent text-sm text-foreground outline-none"
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
                      value={destino}
                      onChange={(e) => setDestino(e.target.value)}
                      placeholder="Para onde você quer viajar?"
                      className="min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    />
                  )}
                </span>
              </label>

              <span className="hidden h-9 w-px bg-border md:block" />

              <label className="flex items-center gap-2 px-3 py-2 md:py-1">
                <Calendar className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="flex flex-col">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Data de ida
                  </span>
                  <input
                    type="date"
                    value={dataIda}
                    min={todayStr}
                    onChange={(e) => setDataIda(e.target.value)}
                    className="bg-transparent text-sm text-foreground outline-none"
                  />
                </span>
              </label>

              <span className="hidden h-9 w-px bg-border lg:block" />

              <label className="flex items-center gap-2 px-3 py-2 md:py-1">
                <Sparkles className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="flex flex-col">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Experiência
                  </span>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value)}
                    className="bg-transparent text-sm text-foreground outline-none"
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

              <span className="hidden h-9 w-px bg-border lg:block" />

              <label className="flex items-center gap-2 px-3 py-2 md:py-1">
                <CreditCard className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="flex flex-col">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Orçamento
                  </span>
                  <select
                    value={orcamento}
                    onChange={(e) => setOrcamento(e.target.value)}
                    className="bg-transparent text-sm text-foreground outline-none"
                  >
                    <option value="">Qualquer valor</option>
                    <option value="500">Até R$ 500</option>
                    <option value="1000">Até R$ 1.000</option>
                    <option value="2500">Até R$ 2.500</option>
                    <option value="5000">Até R$ 5.000</option>
                  </select>
                </span>
              </label>

              <span className="hidden h-9 w-px bg-border md:block" />

              <label className="flex items-center gap-2 px-3 py-2 md:py-1">
                <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="flex flex-col">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Passageiros
                  </span>
                  <select
                    value={passageiros}
                    onChange={(e) => setPassageiros(e.target.value)}
                    className="bg-transparent text-sm text-foreground outline-none"
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
                type="submit"
                size="lg"
                className="shrink-0 gap-1.5 rounded-full font-semibold md:ml-1"
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
            onClick={() => navigate(`/loja/${slug}/produtos`)}
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white/90 underline-offset-4 hover:underline"
          >
            Ver todos os pacotes
            <ArrowRight className="h-4 w-4" />
          </button>

          {store.contactWhatsapp && (
            <a
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
      <section className="border-b bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 py-8 lg:grid-cols-4">
          {TRUST_ITEMS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
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

      <div className="mx-auto max-w-6xl space-y-16 px-4 py-14">
        {flashSales.length > 0 && (
          <section>
            <SectionHeader
              eyebrow="Ofertas"
              title="Ofertas Relâmpago"
              subtitle="Promoções por tempo limitado — aproveite antes que terminem."
              action={
                <Button
                  variant="ghost"
                  onClick={() => navigate(`/loja/${slug}/produtos`)}
                  className="gap-1"
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
                className="mb-6"
              />
            )}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
          <section>
            <SectionHeader
              eyebrow="Explore"
              title="Categorias"
              subtitle="Encontre a experiência perfeita para a sua próxima viagem."
            />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() =>
                    navigate(`/loja/${slug}/produtos?categoryId=${cat.id}`)
                  }
                  className="group relative flex h-32 items-end overflow-hidden rounded-2xl border border-black/5 p-4 text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
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
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                    </>
                  )}
                  <span className="relative flex w-full items-center justify-between font-semibold text-white">
                    {cat.name}
                    <ChevronRight className="h-4 w-4 opacity-80 transition-transform group-hover:translate-x-1" />
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {(loading || featured.length > 0) && (
          <section>
            <SectionHeader
              eyebrow="Imperdível"
              title="Pacotes em Destaque"
              subtitle="As experiências mais procuradas, escolhidas para você."
              action={
                <Button
                  variant="ghost"
                  onClick={() => navigate(`/loja/${slug}/produtos`)}
                  className="gap-1"
                >
                  Ver todos
                  <ChevronRight className="h-4 w-4" />
                </Button>
              }
            />
            {loading ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-80 animate-pulse rounded-2xl border bg-muted"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
          <section>
            <SectionHeader
              eyebrow="Tendências"
              title="Destinos mais procurados"
              subtitle="Os lugares preferidos dos nossos viajantes."
            />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {destinationGroups.map((g) => (
                <button
                  key={g.destination}
                  onClick={() =>
                    navigate(
                      `/loja/${slug}/produtos?destination=${encodeURIComponent(g.destination)}`,
                    )
                  }
                  className="group relative flex h-52 items-end overflow-hidden rounded-2xl border border-black/5 text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
                  style={
                    g.image ? undefined : { background: colors.gradientHero }
                  }
                >
                  {g.image && (
                    <img
                      src={g.image}
                      alt={g.destination}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
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
          <section className="flex flex-col items-center py-12 text-center">
            <div
              className="flex h-20 w-20 items-center justify-center rounded-full mb-6"
              style={{ background: colors.primarySoft }}
            >
              <Sparkles className="h-10 w-10" style={{ color: colors.primary }} />
            </div>
            <h2 className="text-2xl font-bold mb-3">Em breve, novidades!</h2>
            <p className="text-muted-foreground max-w-sm mb-6">
              Estamos preparando pacotes incríveis para você. Fique de olho — novidades chegam em breve!
            </p>
            {store.contactWhatsapp && (
              <a
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
          <section>
            <SectionHeader
              eyebrow="Depoimentos"
              title="O que dizem nossos clientes"
              subtitle="Avaliações reais de viajantes satisfeitos."
            />
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
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
                        className={`h-3.5 w-3.5 ${
                          i < review.rating
                            ? "fill-yellow-400 text-yellow-400"
                            : "fill-gray-200 text-gray-200"
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
          className="relative overflow-hidden rounded-3xl px-6 py-12 text-center text-white shadow-xl"
          style={{ background: colors.gradientCta }}
        >
          <h3 className="text-2xl font-bold md:text-3xl">
            Pronto para a próxima aventura?
          </h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/90 md:text-base">
            Descubra nossos roteiros e garanta a sua vaga com facilidade e
            segurança.
          </p>
          <Button
            size="lg"
            onClick={() => navigate(`/loja/${slug}/produtos`)}
            className="mt-6 rounded-full bg-white font-bold hover:bg-white/90"
            style={{ color: colors.primary }}
          >
            Explorar pacotes
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </section>

        {store.paymentMethods.length > 0 && (
          <section className="rounded-2xl bg-muted/40 p-8 text-center">
            <h3 className="mb-3 text-lg font-bold">Formas de Pagamento</h3>
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

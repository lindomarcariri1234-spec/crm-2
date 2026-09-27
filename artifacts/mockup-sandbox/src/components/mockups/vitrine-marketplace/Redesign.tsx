// @ts-nocheck
import "./_group.css";
import "./Redesign.css";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Compass,
  CreditCard,
  Gift,
  Headphones,
  MapPin,
  Menu,
  Mountain,
  Quote,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import { FlashSaleCountdown } from "./_shared/FlashSaleCountdown";
import { PremiumProductCard } from "./_shared/PremiumProductCard";

type PublicStore = any;
type StoreProduct = any;
type StoreCategory = any;
type StoreReview = any;

const formatCurrency = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const localToday = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts();
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

// This mirrors the storefront theme hook in Current. Brand surfaces below read
// exclusively from its colors, so a real agency theme can flow through intact.
const useVitrineTheme = () => ({
  colors: {
    primary: "#1E5B8C",
    secondary: "#4C8B5F",
    accent: "#D8A646",
    primaryForeground: "#fff",
    primarySoft: "#1E5B8C18",
    accentSoft: "#D8A64622",
    gradientHero: "linear-gradient(135deg,#1E5B8C,#17486f 55%,#4C8B5F)",
    gradientCta: "linear-gradient(135deg,#1E5B8C,#D8A646)",
  },
});

const image = (name: string) => `/__mockup/images/${name}`;
const saleEnd = new Date(Date.now() + 1000 * 60 * 60 * 24 * 4 + 1000 * 60 * 60 * 8).toISOString();

const MOCK_PRODUCTS: StoreProduct[] = [
  {
    id: "araripe-trilha",
    name: "A manhã mais bonita da Chapada",
    slug: "manha-na-chapada-do-araripe",
    type: "tour",
    price: "248",
    salePrice: "198",
    onSale: true,
    saleEndsAt: saleEnd,
    thumbnail: image("redesign-araripe.png"),
    images: [],
    gallery: [],
    destination: "Chapada do Araripe",
    durationDays: 1,
    salesCount: 47,
    includes: ["Guia local", "Transporte"],
    features: [],
    isFeatured: true,
    shortDescription: "Mirantes, trilha leve e uma pausa com vista para o Cariri.",
  },
  {
    id: "caldas-aguas",
    name: "Um dia entre as águas de Caldas",
    slug: "aguas-de-caldas",
    type: "tour",
    price: "320",
    onSale: false,
    thumbnail: image("redesign-caldas.png"),
    images: [],
    gallery: [],
    destination: "Caldas, Barbalha",
    durationDays: 1,
    salesCount: 39,
    includes: ["Anfitrião local", "Traslado"],
    features: [],
    isFeatured: true,
    shortDescription: "Fontes naturais, sombra boa e tempo para aproveitar sem pressa.",
  },
  {
    id: "santana-historias",
    name: "Pedra Cariri e histórias antigas",
    slug: "pedra-cariri-e-historias-antigas",
    type: "package",
    price: "460",
    onSale: false,
    thumbnail: image("redesign-santana.png"),
    images: [],
    gallery: [],
    destination: "Santana do Cariri",
    durationDays: 1,
    salesCount: 33,
    includes: ["Museu", "Almoço regional"],
    features: [],
    isFeatured: true,
    shortDescription: "Um roteiro pelo território, pela paleontologia e por quem vive aqui.",
  },
  {
    id: "nova-olinda-cultura",
    name: "Nova Olinda por quem é daqui",
    slug: "nova-olinda-por-quem-e-daqui",
    type: "tour",
    price: "285",
    onSale: false,
    thumbnail: image("redesign-nova-olinda.png"),
    images: [],
    gallery: [],
    destination: "Nova Olinda",
    durationDays: 1,
    salesCount: 27,
    includes: ["Guia local"],
    features: [],
    isFeatured: false,
  },
  {
    id: "fim-de-semana",
    name: "Dois dias para sentir o Cariri",
    slug: "dois-dias-para-sentir-o-cariri",
    type: "package",
    price: "920",
    salePrice: "790",
    onSale: true,
    saleEndsAt: saleEnd,
    thumbnail: image("cariri-chapada-araripe-hero.png"),
    images: [],
    gallery: [],
    destination: "Chapada do Araripe",
    durationDays: 2,
    salesCount: 22,
    includes: ["Hospedagem", "Roteiro guiado"],
    features: [],
    isFeatured: false,
  },
];

const MOCK_CATEGORIES: StoreCategory[] = [
  { id: "natureza", name: "Natureza e trilhas", imageUrl: image("redesign-araripe.png") },
  { id: "aguas", name: "Águas e descanso", imageUrl: image("redesign-caldas.png") },
  { id: "cultura", name: "Cultura viva", imageUrl: image("redesign-nova-olinda.png") },
  { id: "historia", name: "Histórias do Cariri", imageUrl: image("redesign-santana.png") },
];

const MOCK_REVIEWS: StoreReview[] = [
  {
    id: "review-1",
    comment: "Foi como conhecer o Cariri pela porta da frente. Nosso guia sabia o nome de cada lugar e de cada pessoa pelo caminho.",
    rating: 5,
    customerName: "Marina A.",
    createdAt: "2025-07-16T12:00:00.000Z",
  },
  {
    id: "review-2",
    comment: "Tudo no ritmo certo: paisagens lindas, boas conversas e nenhum daqueles passeios corridos.",
    rating: 5,
    customerName: "Rafael M.",
    createdAt: "2025-06-08T12:00:00.000Z",
  },
  {
    id: "review-3",
    comment: "Voltamos com vontade de ficar mais alguns dias. A equipe cuidou de cada detalhe com muito carinho.",
    rating: 5,
    customerName: "Lívia C.",
    createdAt: "2025-05-23T12:00:00.000Z",
  },
];

const publicStoreApi = {
  getProducts: async (_slug: string, opts: any = {}) => ({
    data: opts.featured ? MOCK_PRODUCTS.filter((product) => product.isFeatured).slice(0, 3) : MOCK_PRODUCTS,
    total: MOCK_PRODUCTS.length,
    page: 1,
    limit: 200,
  }),
  getCategories: async (_slug: string) => MOCK_CATEGORIES,
  getReviews: async (_slug: string) => MOCK_REVIEWS,
  getReferralInfo: async (_slug: string, _code: string) => ({
    referrerName: "uma pessoa querida",
    discountPercent: 5,
    discountType: "percentage",
  }),
};

const TRUST_ITEMS = [
  { icon: ShieldCheck, title: "Reserva segura", desc: "Pagamento protegido e confirmação imediata" },
  { icon: Headphones, title: "Gente de verdade", desc: "Atendimento próximo antes e durante a viagem" },
  { icon: CreditCard, title: "Pague do seu jeito", desc: "Opções simples para organizar sua viagem" },
  { icon: Compass, title: "Conhecimento local", desc: "Roteiros escolhidos por quem vive o destino" },
];

type DestinationGroup = {
  destination: string;
  image: string | null;
  priceFrom: number;
  durationDays: number | null;
  count: number;
  sales: number;
};

function SectionHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rd-section-heading">
      <div>
        <div className="rd-section-eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function ReferralWelcomeBanner({ slug, primaryColor }: { slug: string; primaryColor: string }) {
  const [visible, setVisible] = useState(false);
  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [discountLabel, setDiscountLabel] = useState("5%");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isWelcome = params.get("welcome") === "true";
    const refCode = params.get("ref");
    if (!isWelcome || !refCode) return;
    setVisible(true);
    publicStoreApi.getReferralInfo(slug, refCode).then((info) => {
      if (info?.referrerName) setReferrerName(info.referrerName);
      if (!info) return;
      const type = info.discountType ?? "percentage";
      const val = type === "fixed" ? info.discountValue ?? 0 : info.discountPercent ?? 5;
      setDiscountLabel(type === "fixed" ? `R$ ${val.toFixed(2).replace(".", ",")}` : `${val}%`);
    }).catch(() => {});
  }, [slug]);

  if (!visible) return null;
  return (
    <div className="rd-referral" style={{ background: `linear-gradient(110deg, ${primaryColor}, ${primaryColor}d9)` }}>
      <Gift size={21} aria-hidden="true" />
      <div className="rd-referral-copy">
        <strong>{referrerName ? `Você chegou por indicação de ${referrerName}.` : "Você chegou por indicação."}</strong>
        Ganhe <b>{discountLabel} de desconto</b> na sua reserva. O código já está salvo para você.
      </div>
      <button className="rd-dismiss" onClick={() => setVisible(false)} aria-label="Fechar aviso">
        <X size={17} />
      </button>
    </div>
  );
}

function StoreHeader({
  slug,
  store,
  primary,
}: {
  slug: string;
  store: PublicStore;
  primary: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = (target: string) => { window.location.hash = target; };
  const links = [
    ["Início", `/loja/${slug}`],
    ["Roteiros", `/loja/${slug}/produtos`],
    ["Calendário", `/loja/${slug}/calendario`],
    ["Consultar pedido", `/loja/${slug}/consultar-pedido`],
  ];

  function submitHeaderSearch(event: FormEvent) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query) navigate(`/loja/${slug}/produtos?search=${encodeURIComponent(query)}`);
    setSearchOpen(false);
  }

  return (
    <header className="rd-header" style={{ background: primary }}>
      <div className="rd-head-inner">
        <button className="rd-brand" onClick={() => navigate(`/loja/${slug}`)} aria-label={`Início: ${store.name}`}>
          <span className="rd-brand-mark">
            {store.logoUrl ? <img src={store.logoUrl} alt="" /> : (store.name ?? "V").charAt(0)}
          </span>
          <span className="rd-brand-name">{store.name}</span>
        </button>
        <nav className="rd-nav rd-desktop-nav" aria-label="Navegação principal">
          {links.map(([label, href], index) => (
            <a className={index === 1 ? "rd-nav-cta" : ""} key={label} href={`#${href}`}>{label}</a>
          ))}
          {store.contactWhatsapp && (
            <a href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          )}
        </nav>
        <div className="rd-head-actions">
          <button className="rd-head-icon" onClick={() => setSearchOpen((current) => !current)} aria-label={searchOpen ? "Fechar busca" : "Buscar"}>
            {searchOpen ? <X size={18} /> : <Search size={18} />}
          </button>
          <button className="rd-head-icon md:hidden" onClick={() => setMenuOpen((current) => !current)} aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}>
            {menuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>
      {searchOpen && (
        <div className="rd-header-search">
          <form onSubmit={submitHeaderSearch}>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Buscar destinos e roteiros" autoFocus />
            <button type="submit">Buscar</button>
          </form>
        </div>
      )}
      {menuOpen && (
        <nav className="rd-mobile-panel" aria-label="Navegação móvel">
          {links.map(([label, href]) => (
            <a key={label} href={`#${href}`} onClick={() => setMenuOpen(false)}>{label}</a>
          ))}
          {store.contactWhatsapp && (
            <a href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>
              WhatsApp
            </a>
          )}
          <a href={`/loja/${slug}/entrar`} onClick={() => setMenuOpen(false)}>Entrar</a>
          <a href={`/loja/${slug}/cadastrar`} onClick={() => setMenuOpen(false)}>Criar conta</a>
        </nav>
      )}
    </header>
  );
}

export function VitrineHome({
  slug,
  store,
}: {
  slug: string;
  store: PublicStore;
}) {
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
  const todayStr = localToday();
  const navigate = (target: string) => { window.location.hash = target; };

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      publicStoreApi.getProducts(slug, { featured: true, limit: 6 }),
      publicStoreApi.getCategories(slug),
      publicStoreApi.getReviews(slug, { limit: 6 }),
      publicStoreApi.getProducts(slug, { limit: 200 }),
    ])
      .then(([products, cats, customerReviews, all]) => {
        if (!active) return;
        if (products.status === "fulfilled") setFeatured(products.value.data);
        if (cats.status === "fulfilled") setCategories(cats.value);
        if (customerReviews.status === "fulfilled") setReviews(customerReviews.value);
        if (all.status === "fulfilled") setAllProducts(all.value.data);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  const avgRating = reviews.length > 0
    ? reviews.reduce((total, review) => total + review.rating, 0) / reviews.length
    : null;

  const destinations = useMemo(
    () => Array.from(new Set(allProducts.map((product) => product.destination)
      .filter((value): value is string => !!value && value.trim().length > 0)))
      .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [allProducts],
  );
  const hasDestinations = destinations.length > 0;

  const flashSales = useMemo(() => {
    const now = Date.now();
    return allProducts
      .filter((product) => product.onSale && product.salePrice && product.saleEndsAt && new Date(product.saleEndsAt).getTime() > now)
      .sort((a, b) => new Date(a.saleEndsAt).getTime() - new Date(b.saleEndsAt).getTime());
  }, [allProducts]);

  const destinationGroups = useMemo<DestinationGroup[]>(() => {
    const map = new Map<string, DestinationGroup>();
    for (const product of allProducts) {
      const destination = product.destination?.trim();
      if (!destination) continue;
      const price = parseFloat(product.salePrice ?? product.price);
      const photo = product.thumbnail ?? product.images?.[0] ?? product.gallery?.[0] ?? null;
      const current = map.get(destination);
      if (!current) {
        map.set(destination, {
          destination,
          image: photo,
          priceFrom: Number.isFinite(price) ? price : Infinity,
          durationDays: product.durationDays ?? null,
          count: 1,
          sales: product.salesCount ?? 0,
        });
      } else {
        current.count += 1;
        current.sales += product.salesCount ?? 0;
        if (Number.isFinite(price) && price < current.priceFrom) current.priceFrom = price;
        if (!current.image && photo) current.image = photo;
        if (current.durationDays == null && product.durationDays != null) current.durationDays = product.durationDays;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales || b.count - a.count).slice(0, 8);
  }, [allProducts]);

  function submitSmartSearch(event: FormEvent) {
    event.preventDefault();
    const query = new URLSearchParams();
    const destination = destino.trim();
    if (destination) {
      if (hasDestinations) query.set("destination", destination);
      else query.set("search", destination);
    }
    if (dataIda) query.set("departureFrom", dataIda);
    if (passageiros) query.set("minSeats", passageiros);
    if (tipo) query.set("type", tipo);
    if (orcamento) query.set("maxPrice", orcamento);
    const queryString = query.toString();
    navigate(`/loja/${slug}/produtos${queryString ? `?${queryString}` : ""}`);
  }

  const themeVars = {
    "--rd-primary": colors.primary,
    "--rd-secondary": colors.secondary,
    "--rd-accent": colors.accent,
    "--rd-primary-soft": colors.primarySoft,
    "--rd-hero-gradient": colors.gradientHero,
    "--rd-cta-gradient": colors.gradientCta,
    "--rd-eyebrow": "#c6f2e8",
  } as React.CSSProperties;

  const productLink = (
    <button className="rd-section-link" onClick={() => navigate(`/loja/${slug}/produtos`)}>
      Ver todos <ChevronRight size={15} />
    </button>
  );

  const paymentLabels: Record<string, string> = {
    pix: "PIX",
    boleto: "Boleto",
    credit_card: "Cartão de crédito",
    debit_card: "Cartão de débito",
    transfer: "Transferência",
  };

  return (
    <div className="rd-page" style={themeVars}>
      {store.referralsEnabled !== false && (
        <ReferralWelcomeBanner slug={slug} primaryColor={colors.primary} />
      )}
      <StoreHeader slug={slug} store={store} primary={colors.primary} />

      <main>
        <section className="rd-hero">
          {store.bannerUrl ? (
            <>
              <img
                src={store.bannerUrl}
                alt={store.name}
                className={`rd-hero-img${store.bannerMobileUrl ? " hidden sm:block" : ""}`}
              />
              {store.bannerMobileUrl && (
                <img src={store.bannerMobileUrl} alt={store.name} className="rd-hero-img sm:hidden" />
              )}
            </>
          ) : (
            <div className="rd-hero-fallback" />
          )}
          <div
            className="rd-hero-shade"
            style={{
              background: store.bannerUrl
                ? "linear-gradient(90deg, rgba(7,34,48,.70) 0%, rgba(8,41,55,.44) 52%, rgba(7,34,48,.1) 100%), linear-gradient(0deg, rgba(6,30,42,.34), transparent 58%)"
                : "linear-gradient(90deg, rgba(7,34,48,.26), rgba(7,34,48,.04)), linear-gradient(0deg, rgba(6,30,42,.3), transparent 58%)",
            }}
          />
          <div className="rd-hero-inner">
            {store.logoUrl && <img src={store.logoUrl} alt={store.name} className="rd-logo" />}
            <div className="rd-eyebrow"><MapPin size={14} /> Viagens com olhar local</div>
            <h1>{store.seoTitle ?? store.name}</h1>
            {store.description && <p className="rd-hero-copy">{store.description}</p>}
            <div className="rd-hero-links">
              <button className="rd-text-link" onClick={() => navigate(`/loja/${slug}/produtos`)}>
                Conheça nossos roteiros <ArrowRight size={16} />
              </button>
              {store.contactWhatsapp && (
                <a
                  className="rd-text-link"
                  href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}?text=${encodeURIComponent("Olá! Quero ajuda para escolher uma experiência de viagem.")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Headphones size={15} /> Converse com a equipe local
                </a>
              )}
            </div>
            {avgRating !== null && (
              <div className="rd-rating" aria-label={`${avgRating.toFixed(1)} de 5 estrelas`}>
                <span className="rd-stars">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star key={index} size={13} fill={index < Math.round(avgRating) ? "currentColor" : "none"} />
                  ))}
                </span>
                <b>{avgRating.toFixed(1)}</b>
                <span>{reviews.length} avaliações de viajantes</span>
              </div>
            )}
          </div>
        </section>

        <div className="rd-search-wrap">
          <form className="rd-search" onSubmit={submitSmartSearch}>
            <div className="rd-search-top">
              <strong>Comece pelo que você tem em mente</strong>
              <span>Encontre um roteiro no seu ritmo.</span>
            </div>
            <div className="rd-search-grid">
              <div className="rd-field">
                <MapPin size={19} />
                <span>
                  <label htmlFor="rd-destination">Destino</label>
                  {hasDestinations ? (
                    <select id="rd-destination" value={destino} onChange={(event) => setDestino(event.target.value)}>
                      <option value="">Todos os destinos</option>
                      {destinations.map((destination) => <option key={destination} value={destination}>{destination}</option>)}
                    </select>
                  ) : (
                    <input id="rd-destination" value={destino} onChange={(event) => setDestino(event.target.value)} placeholder="Para onde?" />
                  )}
                </span>
              </div>
              <div className="rd-field">
                <CalendarDays size={18} />
                <span>
                  <label htmlFor="rd-date">Data de ida</label>
                  <input id="rd-date" type="date" value={dataIda} min={todayStr} onChange={(event) => setDataIda(event.target.value)} />
                </span>
              </div>
              <div className="rd-field">
                <Sparkles size={18} />
                <span>
                  <label htmlFor="rd-type">Experiência</label>
                  <select id="rd-type" value={tipo} onChange={(event) => setTipo(event.target.value)}>
                    <option value="">Todos os tipos</option>
                    <option value="package">Pacotes</option>
                    <option value="tour">Passeios</option>
                    <option value="hotel">Hospedagem</option>
                    <option value="service">Serviços</option>
                    <option value="cruise">Cruzeiros</option>
                  </select>
                </span>
              </div>
              <div className="rd-field">
                <CreditCard size={18} />
                <span>
                  <label htmlFor="rd-budget">Orçamento</label>
                  <select id="rd-budget" value={orcamento} onChange={(event) => setOrcamento(event.target.value)}>
                    <option value="">Qualquer valor</option>
                    <option value="500">Até R$ 500</option>
                    <option value="1000">Até R$ 1.000</option>
                    <option value="2500">Até R$ 2.500</option>
                    <option value="5000">Até R$ 5.000</option>
                  </select>
                </span>
              </div>
              <div className="rd-field">
                <Users size={18} />
                <span>
                  <label htmlFor="rd-passengers">Viajantes</label>
                  <select id="rd-passengers" value={passageiros} onChange={(event) => setPassageiros(event.target.value)}>
                    <option value="">Qualquer número</option>
                    {Array.from({ length: 8 }, (_, index) => index + 1).map((number) => (
                      <option key={number} value={number}>{number} {number === 1 ? "pessoa" : "pessoas"}</option>
                    ))}
                  </select>
                </span>
              </div>
              <button className="rd-search-submit" type="submit"><Search size={16} /> Encontrar roteiros</button>
            </div>
          </form>
        </div>

        <section className="rd-trust" aria-label="Por que viajar com a gente">
          {TRUST_ITEMS.map(({ icon: Icon, title, desc }) => (
            <div className="rd-trust-item" key={title}>
              <span className="rd-trust-icon"><Icon size={19} /></span>
              <div><strong>{title}</strong><small>{desc}</small></div>
            </div>
          ))}
        </section>

        <div className="rd-content">
          {flashSales.length > 0 && (
            <section className="rd-section">
              <SectionHeading
                eyebrow="Uma boa hora para ir"
                title="Ofertas que valem a viagem"
                subtitle="Seleções especiais para descobrir novos lugares sem deixar a oportunidade passar."
                action={productLink}
              />
              {flashSales[0]?.saleEndsAt && (
                <div className="rd-sale-note">Condições especiais por tempo limitado</div>
              )}
              {flashSales[0]?.saleEndsAt && <FlashSaleCountdown endsAt={flashSales[0].saleEndsAt} variant="banner" className="mb-5" />}
              <div className="rd-product-grid">
                {flashSales.slice(0, 3).map((product) => (
                  <PremiumProductCard key={product.id} product={product} slug={slug} whatsapp={store.contactWhatsapp} />
                ))}
              </div>
            </section>
          )}

          {categories.length > 0 && (
            <section className="rd-section">
              <SectionHeading
                eyebrow="Explore com calma"
                title="Que tipo de viagem combina com você?"
                subtitle="Da primeira trilha à conversa que fica na memória: escolha um caminho para começar."
              />
              <div className="rd-category-grid">
                {categories.map((category) => (
                  <button
                    className="rd-category"
                    key={category.id}
                    onClick={() => navigate(`/loja/${slug}/produtos?categoryId=${category.id}`)}
                    style={!category.imageUrl ? { background: colors.gradientHero } : undefined}
                  >
                    {category.imageUrl && <img src={category.imageUrl} alt="" loading="lazy" />}
                    <span className="rd-category-title">{category.name}<ArrowRight size={16} /></span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {(loading || featured.length > 0) && (
            <section className="rd-section">
              <SectionHeading
                eyebrow="Escolhas de quem conhece"
                title="Roteiros em destaque"
                subtitle="Experiências selecionadas pela equipe, com espaço para aproveitar cada lugar."
                action={productLink}
              />
              {loading ? (
                <div className="rd-product-grid">
                  {Array.from({ length: 3 }).map((_, index) => <div className="rd-skeleton" key={index} />)}
                </div>
              ) : (
                <div className="rd-product-grid">
                  {featured.map((product) => (
                    <PremiumProductCard key={product.id} product={product} slug={slug} whatsapp={store.contactWhatsapp} />
                  ))}
                </div>
              )}
            </section>
          )}

          {destinationGroups.length > 0 && (
            <section className="rd-section">
              <SectionHeading
                eyebrow="Perto de você, longe da rotina"
                title="Lugares para guardar na memória"
                subtitle="Cada destino tem um ritmo próprio. Veja o que nossos viajantes mais procuram."
                action={productLink}
              />
              <div className="rd-destination-grid">
                {destinationGroups.map((group) => (
                  <button
                    className="rd-destination"
                    key={group.destination}
                    onClick={() => navigate(`/loja/${slug}/produtos?destination=${encodeURIComponent(group.destination)}`)}
                    style={!group.image ? { background: colors.gradientHero } : undefined}
                  >
                    {group.image && <img src={group.image} alt={group.destination} loading="lazy" />}
                    <div className="rd-destination-content">
                      <div className="rd-destination-count"><MapPin size={13} /> {group.count} {group.count === 1 ? "roteiro" : "roteiros"}</div>
                      <h3>{group.destination}</h3>
                      <p>
                        {Number.isFinite(group.priceFrom) && `A partir de ${formatCurrency(group.priceFrom)}`}
                        {group.durationDays != null && ` · ${group.durationDays} ${group.durationDays === 1 ? "dia" : "dias"}`}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {!loading && allProducts.length === 0 && (
            <section className="rd-section rd-empty">
              <span className="rd-empty-mark"><Mountain size={27} /></span>
              <h2>Estamos preparando os próximos caminhos.</h2>
              <p>Em breve, novos roteiros e experiências locais estarão por aqui. Enquanto isso, nossa equipe pode ajudar a pensar na sua viagem.</p>
              {store.contactWhatsapp && (
                <a className="rd-cta-button" href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">
                  Fale com a equipe <ArrowRight size={16} />
                </a>
              )}
            </section>
          )}

          {reviews.length > 0 && (
            <section className="rd-section">
              <SectionHeading
                eyebrow="Histórias de quem foi"
                title="O Cariri visto por outros viajantes"
                subtitle="Relatos reais de quem voltou para casa com mais do que fotografias."
              />
              <div className="rd-reviews">
                {reviews.map((review) => (
                  <article className="rd-review" key={review.id}>
                    <Quote className="rd-review-quote" size={21} />
                    <p>{review.comment ?? "Uma experiência excelente do começo ao fim."}</p>
                    <div className="rd-review-stars">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Star key={index} size={12} fill={index < review.rating ? "currentColor" : "none"} />
                      ))}
                    </div>
                    <div className="rd-review-author">
                      <span className="rd-review-avatar">{(review.customerName ?? "?")[0].toUpperCase()}</span>
                      <span>
                        <strong>{review.customerName ?? "Viajante"}</strong>
                        <small>{new Date(review.createdAt).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" })}</small>
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="rd-section rd-cta">
            <div className="rd-cta-copy">
              <div className="rd-eyebrow">A gente ajuda você a começar</div>
              <h2>Qual vai ser a sua próxima história?</h2>
              <p>Explore os roteiros com tranquilidade ou fale com quem conhece cada curva deste lugar.</p>
            </div>
            <div className="rd-cta-actions">
              <button className="rd-cta-button" onClick={() => navigate(`/loja/${slug}/produtos`)}>
                Ver todos os roteiros <ArrowRight size={17} />
              </button>
              {store.contactWhatsapp && (
                <a className="rd-cta-contact" href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}?text=${encodeURIComponent("Olá! Quero ajuda para escolher uma experiência de viagem.")}`} target="_blank" rel="noopener noreferrer">
                  <Headphones size={15} /> Conversar com a equipe local
                </a>
              )}
            </div>
          </section>

          {(store.paymentMethods ?? []).length > 0 && (
            <section className="rd-payments">
              <h3>Formas de pagamento disponíveis</h3>
              <div className="rd-payment-list">
                {store.paymentMethods.map((method: string) => (
                  <span className="rd-payment" key={method}>{paymentLabels[method] ?? method}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      <footer className="rd-footer">
        <div className="rd-footer-inner">
          <div>
            <div className="rd-footer-brand">
              <span className="rd-brand-mark">{store.logoUrl ? <img src={store.logoUrl} alt="" /> : (store.name ?? "V").charAt(0)}</span>
              <strong>{store.name}</strong>
            </div>
            {store.description && <p>{store.description}</p>}
            <div className="rd-socials">
              {store.socialInstagram && (
                <a href={`https://instagram.com/${store.socialInstagram.replace("@", "")}`} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                  <span className="text-xs font-bold">ig</span>
                </a>
              )}
              {store.socialFacebook && <a href={store.socialFacebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook"><span className="text-xs font-bold">f</span></a>}
              {store.socialYoutube && <a href={store.socialYoutube} target="_blank" rel="noopener noreferrer" aria-label="YouTube"><span className="text-xs font-bold">yt</span></a>}
            </div>
          </div>
          <div>
            <h3>Explore</h3>
            <div className="rd-footer-links">
              <a href={`#/loja/${slug}`}>Início</a>
              <a href={`#/loja/${slug}/produtos`}>Ver roteiros</a>
              <a href={`#/loja/${slug}/calendario`}>Calendário de saídas</a>
              <a href={`#/loja/${slug}/consultar-pedido`}>Consultar pedido</a>
            </div>
          </div>
          <div>
            <h3>Fale com a equipe</h3>
            <div className="rd-contact-list">
              {store.contactEmail && <a href={`mailto:${store.contactEmail}`}>{store.contactEmail}</a>}
              {store.contactPhone && <a href={`tel:${store.contactPhone}`}>{store.contactPhone}</a>}
              {store.contactAddress && <span>{store.contactAddress}</span>}
            </div>
          </div>
        </div>
        <div className="rd-copyright">© {Number(localToday().slice(0, 4))} {store.name} · Powered by VisiteCRM</div>
      </footer>
    </div>
  );
}

const PREVIEW_STORE = {
  id: "store-visite-cariri",
  slug: "visite-cariri",
  name: "Visite Cariri",
  description: "O Cariri tem muitos jeitos de surpreender. Descubra paisagens, encontros e histórias com quem chama esta região de casa.",
  seoTitle: "Viaje mais perto do que é real.",
  contactWhatsapp: "5588999990000",
  contactEmail: "contato@visitecariri.com.br",
  contactPhone: "(88) 99999-0000",
  contactAddress: "Juazeiro do Norte, CE",
  paymentMethods: ["pix", "credit_card", "boleto"],
  primaryColor: "#1E5B8C",
  secondaryColor: "#4C8B5F",
  accentColor: "#D8A646",
  logoUrl: null,
  bannerUrl: image("cariri-chapada-araripe-hero.png"),
  bannerMobileUrl: null,
  referralsEnabled: false,
  isActive: true,
  maintenanceMode: false,
  socialInstagram: "@visitecariri",
  socialFacebook: null,
  socialYoutube: null,
  isVisible: true,
} as any;

export default function Redesign() {
  return <VitrineHome slug={PREVIEW_STORE.slug} store={PREVIEW_STORE} />;
}
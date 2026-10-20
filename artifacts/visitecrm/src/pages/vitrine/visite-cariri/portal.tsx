import "./portal.css";
import { useEffect, useMemo, useState } from "react";
import { formatDateBR, localToday } from "@workspace/shared";
import { useLocation } from "wouter";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Compass, Leaf, Mail, MapPin, Mountain, Phone, ShieldCheck, Sparkles, Star } from "lucide-react";
import { publicStoreApi, type PublicStore, type StoreCategory, type StoreProduct } from "@/lib/storeApi";
import { PremiumProductCard } from "@/components/vitrine/PremiumProductCard";
import { destinationPath, destinationSlug, findDestination, selectFeaturedOrRealProducts, selectUpcomingDepartures } from "./portalData";
import logo from "@assets/0_Visite_Cariri_Icone_1792531437771.png";
import regionPhoto from "@assets/1_regiao-do-Cariri-1_1792531550009.jpg";
import parkPhoto from "@assets/0_Parque_Estadual_Sítio_Fundão_1792531550009.jpg";
import churchPhoto from "@assets/2_Paroquia-Sagrado-Coracao-de-Jesus-Juazeiro-do-Norte-CE-1_1792531550010.jpg";
import lookoutPhoto from "@assets/4_Mirante-da-Macauba-em-Barbalha-Ce_1792531550011.jpg";
import rosarioPhoto from "@assets/7_Igreja-do-Rosario-em-Barbalha-Ce_1792531550012.jpg";
import hortoPhoto from "@assets/8_Igreja-Bom-Jesus-do-Horto-1_1792531550013.jpg";

const base = "/loja/visite-cariri";
const places = [
  { name: "Parque Estadual Sítio Fundão", city: "Cariri Cearense", image: parkPhoto, type: "Natureza" },
  { name: "Paróquia Sagrado Coração de Jesus", city: "Juazeiro do Norte", image: churchPhoto, type: "Juazeiro do Norte" },
  { name: "Mirante da Macaúba", city: "Barbalha", image: lookoutPhoto, type: "Barbalha" },
  { name: "Igreja do Rosário", city: "Barbalha", image: rosarioPhoto, type: "Barbalha" },
  { name: "Igreja Bom Jesus do Horto", city: "Cariri Cearense", image: hortoPhoto, type: "Cariri Cearense" },
];

function usePortalProducts(slug: string) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    publicStoreApi.getProducts(slug, { limit: 200, group: "travel" })
      .then((res) => { if (live) setProducts(res.data); })
      .catch(() => { if (live) setError(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [slug]);
  return { products, loading, error };
}

export function VisiteCaririHome({ slug, store }: { slug: string; store: PublicStore }) {
  const [, navigate] = useLocation();
  const { products, loading, error } = usePortalProducts(slug);
  const selection = useMemo(() => selectFeaturedOrRealProducts(products), [products]);
  const today = localToday();
  const upcomingDepartures = useMemo(() => selectUpcomingDepartures(products, today), [products, today]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState(false);
  const [reviews, setReviews] = useState<Awaited<ReturnType<typeof publicStoreApi.getReviews>>>([]);
  useEffect(() => {
    let live = true;
    publicStoreApi.getCategories(slug)
      .then((items) => { if (live) setCategories(items); })
      .catch(() => { if (live) setCategoriesError(true); })
      .finally(() => { if (live) setCategoriesLoading(false); });
    return () => { live = false; };
  }, [slug]);
  useEffect(() => {
    let live = true;
    publicStoreApi.getReviews(slug, { limit: 6 })
      .then((items) => { if (live) setReviews(items); })
      .catch(() => { if (live) setReviews([]); });
    return () => { live = false; };
  }, [slug]);
  const contactLink = store.contactWhatsapp
    ? `https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}?text=${encodeURIComponent("Olá! Gostaria de saber mais sobre experiências no Cariri.")}`
    : store.contactEmail ? `mailto:${store.contactEmail}` : null;
  return (
    <div className="cariri-portal">
      <section className="cariri-hero" data-testid="section-cariri-hero">
        <img src={regionPhoto} alt="Vista da região do Cariri Cearense" className="cariri-hero-image" />
        <div className="cariri-hero-shade" />
        <div className="cariri-hero-content">
          <div className="cariri-kicker"><span /> CARIRI CEARENSE · CEARÁ</div>
          <div className="cariri-hero-copy">
            <p className="cariri-overline">Visite Cariri Cearense Receptivo</p>
            <h1>Um lugar que<br /><em>fica com você.</em></h1>
            <p className="cariri-lede">{store.tagline || "Entre a Chapada, a cultura viva e os caminhos de fé, descubra o Cariri no seu próprio ritmo."}</p>
            <div className="cariri-hero-actions">
              <button className="cariri-button cariri-button-yellow" data-testid="button-explore-trips" onClick={() => navigate(`${base}/produtos?group=travel`)}>Encontrar experiências <ArrowRight size={17} /></button>
              <button className="cariri-text-button" data-testid="button-discover-region" onClick={() => navigate(`${base}/destinos`)}>Conheça a região <ArrowDown size={15} /></button>
            </div>
          </div>
          <div className="cariri-hero-mark"><img src={logo} alt="Símbolo Visite Cariri" /><span>Território<br />de encontros</span></div>
          <div className="cariri-scroll-note">Visite Cariri Cearense <span /></div>
        </div>
      </section>

      <section className="cariri-intro" data-testid="section-cariri-intro">
        <div className="cariri-intro-label"><span>01</span> UM CONVITE AO CARIRI</div>
        <div className="cariri-intro-grid">
          <h2>Não é só chegar.<br /><em>É sentir o caminho.</em></h2>
          <div>
            <p>O Cariri se revela em camadas: a paisagem da Chapada do Araripe, a força das romarias, a arte feita à mão e a hospitalidade que transforma visita em lembrança.</p>
            <button className="cariri-inline-link" data-testid="link-about-region" onClick={() => navigate(`${base}/sobre`)}>Um pouco sobre nós <ArrowUpRight size={16} /></button>
          </div>
        </div>
        <div className="cariri-ribbon">
          <span><Mountain size={18} /> CHAPADA DO ARARIPE</span><i />
          <span><Leaf size={18} /> NATUREZA E CULTURA</span><i />
          <span><Compass size={18} /> CAMINHOS COM SENTIDO</span>
        </div>
      </section>

      <section className="cariri-categories" data-testid="section-cariri-categories">
        <div className="cariri-section-heading">
          <div><div className="cariri-intro-label"><span>EXPLORAR</span> CATEGORIAS DA LOJA</div><h2>Escolha por onde<br /><em>começar.</em></h2></div>
        </div>
        {categoriesLoading ? (
          <div className="cariri-category-skeletons" aria-label="Carregando categorias"><span /><span /><span /></div>
        ) : categoriesError ? (
          <div className="cariri-category-empty" data-testid="status-categories-unavailable">Não foi possível carregar as categorias agora. <button data-testid="button-retry-categories" onClick={() => window.location.reload()}>Tentar novamente</button></div>
        ) : categories.length > 0 ? (
          <div className="cariri-category-grid">
            {categories.map((category) => <button key={category.id} data-testid={`link-store-category-${category.id}`} className="cariri-category-card" onClick={() => navigate(`${base}/produtos?categoryId=${encodeURIComponent(category.id)}`)}>
              {category.imageUrl ? <img src={category.imageUrl} alt="" loading="lazy" /> : <span className="cariri-category-monogram" aria-hidden="true">{category.name.slice(0, 1)}</span>}
              <span className="cariri-category-name">{category.name}</span><ArrowUpRight size={17} />
            </button>)}
          </div>
        ) : (
          <div className="cariri-category-empty" data-testid="empty-store-categories">As categorias da loja ainda não foram publicadas.</div>
        )}
      </section>

      <section className="cariri-places" data-testid="section-cariri-places">
        <div className="cariri-section-heading">
          <div><div className="cariri-intro-label"><span>02</span> LUGARES PARA SE DEMORAR</div><h2>O Cariri, <em>de perto.</em></h2></div>
          <button className="cariri-inline-link" data-testid="link-all-destinations" onClick={() => navigate(`${base}/destinos`)}>Explorar destinos <ArrowRight size={16} /></button>
        </div>
        <div className="cariri-place-grid">
            {places.slice(0, 4).map((place, i) => (
            <button className={`cariri-place-card cariri-place-${i + 1}`} key={place.name} data-testid={`card-place-${i + 1}`} onClick={() => navigate(destinationPath(destinationSlug(place.name)))}>
              <img src={place.image} alt={place.name} loading="lazy" />
              <span className="cariri-place-number">0{i + 1}</span><span className="cariri-place-info"><small>{place.city} · {place.type}</small><strong>{place.name}</strong></span><span className="cariri-place-arrow"><ArrowUpRight size={18} /></span>
            </button>
          ))}
        </div>
      </section>

      {reviews.length > 0 && <section className="cariri-reviews" data-testid="section-cariri-reviews">
        <div className="cariri-section-heading"><div><div className="cariri-intro-label"><span>RELATOS</span> AVALIAÇÕES PUBLICADAS</div><h2>Quem já viveu<br /><em>conta.</em></h2></div></div>
        <div className="cariri-review-grid">{reviews.map((review) => <article key={review.id} className="cariri-review-card" data-testid={`card-public-review-${review.id}`}>
          <div className="cariri-review-stars" aria-label={`${review.rating} de 5 estrelas`} data-testid={`rating-review-${review.id}`}>{Array.from({ length: 5 }, (_, i) => <Star key={i} size={14} fill={i < review.rating ? "currentColor" : "none"} />)}</div>
          {review.title && <h3>{review.title}</h3>}
          {review.comment && <p>{review.comment}</p>}
          <div className="cariri-review-byline"><span>{review.reviewerName}</span>{review.verifiedPurchase && <small>Compra verificada</small>}</div>
          {review.reply && <div className="cariri-review-reply"><b>Resposta da agência</b><p>{review.reply}</p></div>}
        </article>)}</div>
      </section>}

      <section className="cariri-experiences" data-testid="section-cariri-experiences">
        <div className="cariri-experience-aside">
          <div className="cariri-intro-label"><span>03</span> VIVA A EXPERIÊNCIA</div>
          <h2>{selection.usesFallback ? <>Experiências<br /><em>para descobrir.</em></> : <>Seu próximo<br /><em>capítulo começa aqui.</em></>}</h2>
          <p>Encontre passeios e viagens publicados pela nossa equipe. Datas, valores e disponibilidade aparecem nos detalhes de cada experiência.</p>
          <button className="cariri-button cariri-button-light" data-testid="button-view-all-experiences" onClick={() => navigate(`${base}/produtos?group=travel`)}>Ver experiências <ArrowRight size={17} /></button>
          <button className="cariri-calendar-link" data-testid="button-view-departure-calendar" onClick={() => navigate(`${base}/calendario`)}>Ver calendário de saídas <ArrowUpRight size={15} /></button>
          <div className="cariri-stamp"><Sparkles size={19} /><span>Feito para<br />descobrir</span></div>
        </div>
        <div className="cariri-experience-list">
          {loading ? <div className="cariri-product-skeleton" aria-label="Carregando experiências" /> : error ? (
            <div className="cariri-empty"><p>Não foi possível carregar as experiências agora.</p><button data-testid="button-retry-experiences" onClick={() => window.location.reload()}>Tentar novamente</button></div>
          ) : selection.products.length ? selection.products.map((product) => <PremiumProductCard key={product.id} product={product} slug={slug} whatsapp={store.contactWhatsapp} />) : (
            <div className="cariri-empty" data-testid="empty-featured-experiences"><Compass size={28} /><p>As experiências em destaque estão sendo preparadas.</p><button data-testid="button-empty-experiences-catalog" onClick={() => navigate(`${base}/produtos?group=travel`)}>Ver catálogo disponível</button></div>
          )}
        </div>
      </section>

      {upcomingDepartures.length > 0 && <section className="cariri-upcoming" data-testid="section-upcoming-departures">
        <div className="cariri-upcoming-heading">
          <div><div className="cariri-intro-label"><span>AGENDA</span> DATAS NO CATÁLOGO</div><h2>Próximas <em>saídas.</em></h2></div>
          <p>Datas exibidas conforme cadastradas nos produtos públicos da loja.</p>
        </div>
        <div className="cariri-upcoming-list">
          {upcomingDepartures.map(({ product, date }) => <button key={product.id} className="cariri-upcoming-card" data-testid={`departure-product-${product.id}`} onClick={() => navigate(`${base}/produtos/${product.slug}`)}>
            <span className="cariri-upcoming-date">{formatDateBR(date)}</span>
            <strong>{product.name}</strong>
            <span className="cariri-upcoming-detail">Ver detalhes da experiência <ArrowUpRight size={15} /></span>
          </button>)}
        </div>
        <p className="cariri-upcoming-disclaimer" data-testid="text-upcoming-disclaimer">A data não confirma vaga disponível nem reserva. Consulte os detalhes e as condições do produto.</p>
      </section>}

      <section className="cariri-story" data-testid="section-cariri-story">
        <img src={lookoutPhoto} alt="Paisagem vista do Mirante da Macaúba" loading="lazy" />
        <div className="cariri-story-panel"><div className="cariri-intro-label"><span>04</span> MAIS QUE UM DESTINO</div><h2>O tempo muda<br />quando a gente<br /><em>olha em volta.</em></h2><p>Escolha um roteiro, faça uma pergunta, comece por onde fizer sentido. A equipe da Visite Cariri pode ajudar a organizar sua visita.</p>
          {contactLink ? <a href={contactLink} target={store.contactWhatsapp ? "_blank" : undefined} rel={store.contactWhatsapp ? "noreferrer" : undefined} className="cariri-inline-link" data-testid="link-cariri-contact">Fale com a equipe <ArrowUpRight size={16} /></a> : <button data-testid="button-cariri-contact" className="cariri-inline-link" onClick={() => navigate(`${base}/contato`)}>Informações de contato <ArrowRight size={16} /></button>}
        </div>
      </section>

      <section className="cariri-cta-band" data-testid="section-cariri-cta"><div><span>PRONTO PARA O CARIRI?</span><h2>Vamos achar seu caminho.</h2></div><button className="cariri-button cariri-button-brown" data-testid="button-plan-trip" onClick={() => navigate(`${base}/produtos?group=travel`)}>Planejar minha visita <ArrowRight size={17} /></button></section>
    </div>
  );
}

export function VisiteCaririDestinations({ store }: { store: PublicStore }) {
  const [, navigate] = useLocation();
  return <div className="cariri-portal cariri-subpage">
    <header className="cariri-page-hero"><div className="cariri-intro-label"><span>CARIRI</span> UM TERRITÓRIO DE CAMINHOS</div><h1>Descubra o que<br /><em>te chama.</em></h1><p>Natureza, fé, memória e arte popular se encontram em diferentes cidades do Cariri Cearense.</p><button className="cariri-button cariri-button-yellow" onClick={() => navigate(`${base}/produtos?group=travel`)} data-testid="button-destinations-book">Ver experiências disponíveis <ArrowRight size={17} /></button><img src={regionPhoto} alt="Panorama urbano da região do Cariri" /></header>
    <section className="cariri-destination-grid" data-testid="destination-list">{places.map((p, i) => {
      const destinationFilter = p.city === "Cariri Cearense" ? "" : `&destination=${encodeURIComponent(p.city)}`;
      return <article key={p.name} className="cariri-destination-card" data-testid={`destination-${i + 1}`}><button className="cariri-destination-image" type="button" data-testid={`button-open-destination-${i + 1}`} onClick={() => navigate(destinationPath(destinationSlug(p.name)))} aria-label={`Ver destino ${p.name}`}><img src={p.image} alt="" loading="lazy" /><span>{p.type}</span></button><div className="cariri-destination-copy"><small><MapPin size={13} /> {p.city}</small><h2>{p.name}</h2><p>Consulte o catálogo para verificar as experiências publicadas pela agência.</p><button className="cariri-inline-link" onClick={() => navigate(destinationPath(destinationSlug(p.name)))} data-testid={`button-detail-destination-${i + 1}`}>Detalhes do destino <ArrowUpRight size={15} /></button><button className="cariri-inline-link" onClick={() => navigate(`${base}/produtos?group=travel${destinationFilter}`)} data-testid={`button-search-destination-${i + 1}`}>Ver experiências no catálogo <ArrowRight size={15} /></button></div></article>;
    })}</section>
    <section className="cariri-note-band" data-testid="destination-catalog-note"><ShieldCheck size={22} /><p>Os lugares apresentados são inspiração para sua visita. As experiências efetivamente disponíveis, seus valores e condições são informados no catálogo e nas páginas de cada produto.</p><button onClick={() => navigate(`${base}/produtos?group=travel`)} data-testid="button-see-catalog">Abrir catálogo <ArrowRight size={15} /></button></section>
    {store.contactWhatsapp && <a className="cariri-contact-float" href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" aria-label="Fale com a equipe pelo WhatsApp" data-testid="link-destinations-whatsapp"><Phone size={17} /> Fale com a equipe</a>}
  </div>;
}

export function VisiteCaririDestinationDetail({ destinationSlug: slug }: { destinationSlug: string }) {
  const [, navigate] = useLocation();
  const destination = useMemo(() => findDestination(slug, places), [slug]);
  if (!destination) {
    return <div className="cariri-portal cariri-destination-not-found" data-testid="status-destination-not-found">
      <p>Este destino não está na seleção regional.</p>
      <button className="cariri-button cariri-button-brown" data-testid="button-return-destinations" onClick={() => navigate(`${base}/destinos`)}><ArrowLeft size={16} /> Voltar aos destinos</button>
    </div>;
  }
  const destinationFilter = destination.city === "Cariri Cearense" ? "" : `&destination=${encodeURIComponent(destination.city)}`;
  return <div className="cariri-portal cariri-destination-detail" data-testid="page-destination-detail">
    <section className="cariri-destination-detail-hero">
      <img src={destination.image} alt={destination.name} />
      <div className="cariri-destination-detail-shade" />
      <div className="cariri-destination-detail-copy">
        <button className="cariri-detail-back" data-testid="button-back-destinations" onClick={() => navigate(`${base}/destinos`)}><ArrowLeft size={16} /> Todos os destinos</button>
        <span className="cariri-detail-caption" data-testid="text-destination-caption">{destination.city}</span>
        <h1 data-testid="text-destination-title">{destination.name}</h1>
        <p>Uma referência visual compartilhada pela Visite Cariri Cearense Receptivo.</p>
      </div>
    </section>
    <section className="cariri-destination-detail-body">
      <div><div className="cariri-intro-label"><span>DESTINO</span> CARIRI CEARENSE</div><h2>{destination.name}</h2><p>Esta página apresenta o destino identificado pela imagem fornecida. Não há informações confirmadas aqui sobre horários, acesso ou disponibilidade de passeios.</p></div>
      <div className="cariri-detail-actions">
        <button className="cariri-button cariri-button-brown" data-testid="button-destination-catalog" onClick={() => navigate(`${base}/produtos?group=travel${destinationFilter}`)}>Consultar catálogo de experiências <ArrowRight size={17} /></button>
        <button className="cariri-inline-link" data-testid="button-destination-calendar" onClick={() => navigate(`${base}/calendario`)}>Ver calendário de saídas <ArrowUpRight size={16} /></button>
      </div>
      <small className="cariri-destination-disclaimer" data-testid="text-destination-availability">Consulte os detalhes de cada experiência para verificar informações, condições e disponibilidade publicadas pela agência.</small>
    </section>
  </div>;
}

export function VisiteCaririAbout({ store }: { store: PublicStore }) {
  const [, navigate] = useLocation();
  return <div className="cariri-portal cariri-subpage">
    <section className="cariri-about-hero" data-testid="section-about-hero"><img src={churchPhoto} alt="Paróquia Sagrado Coração de Jesus em Juazeiro do Norte" /><div><div className="cariri-intro-label"><span>VISITE CARIRI</span> RECEPTIVO</div><h1>Receber bem<br />também é <em>mostrar.</em></h1><p>{store.description || "A Visite Cariri Cearense Receptivo convida você a conhecer a região por meio de experiências e passeios publicados nesta loja."}</p></div></section>
    <section className="cariri-about-body"><div className="cariri-intro-label"><span>01</span> SOBRE A AGÊNCIA</div><h2>Uma visita começa<br /><em>com uma boa conversa.</em></h2><p>{store.tagline || "Conte com nossa equipe para encontrar as informações certas antes de reservar. Cada experiência possui sua própria descrição, valores e condições."}</p><div className="cariri-about-links"><button className="cariri-button cariri-button-brown" onClick={() => navigate(`${base}/produtos?group=travel`)} data-testid="button-about-catalog">Conhecer experiências <ArrowRight size={17} /></button>{store.contactWhatsapp && <a className="cariri-inline-link" href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" data-testid="link-about-whatsapp">Fale pelo WhatsApp <ArrowUpRight size={16} /></a>}</div></section>
    <section className="cariri-policy-grid" data-testid="section-store-policies">{[
      ["Cancelamento", store.cancellationPolicy],
      ["Privacidade", store.privacyPolicy],
      ["Termos de uso", store.termsOfService],
      ["Devoluções", store.returnPolicy],
    ].filter(([, text]) => Boolean(text)).map(([title, text]) => <article key={title}><span>INFORMAÇÕES DA LOJA</span><h3>{title}</h3><p>{text}</p></article>)}
      {!store.cancellationPolicy && !store.privacyPolicy && !store.termsOfService && !store.returnPolicy && <div className="cariri-policy-empty" data-testid="empty-store-policies">As políticas da loja serão exibidas aqui quando estiverem disponíveis.</div>}
    </section>
    <section className="cariri-contact-panel" data-testid="section-store-contact"><div><div className="cariri-intro-label"><span>CONTATO</span> ESTAMOS POR AQUI</div><h2>Vamos conversar<br /><em>sobre sua viagem?</em></h2></div><div>{store.contactWhatsapp && <a href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" data-testid="link-about-whatsapp-contact"><Phone size={17} /> WhatsApp · {store.contactWhatsapp}</a>}{store.contactPhone && <a href={`tel:${store.contactPhone}`} data-testid="link-about-phone"><Phone size={17} /> {store.contactPhone}</a>}{store.contactEmail && <a href={`mailto:${store.contactEmail}`} data-testid="link-about-email"><Mail size={17} /> {store.contactEmail}</a>}{store.contactAddress && <p data-testid="text-about-address"><MapPin size={17} /> {store.contactAddress}</p>}{!store.contactPhone && !store.contactEmail && !store.contactWhatsapp && !store.contactAddress && <p data-testid="empty-about-contact">Os dados de contato não estão disponíveis no momento.</p>}</div></section>
  </div>;
}

type InstitutionalPage = "booking" | "faq" | "contact" | "privacy" | "terms" | "cancellation";

const institutionalCopy: Record<InstitutionalPage, { eyebrow: string; title: [string, string]; intro: string }> = {
  booking: {
    eyebrow: "COMO RESERVAR",
    title: ["Do primeiro olhar", "à sua reserva."],
    intro: "A compra continua nos fluxos oficiais desta loja. Use o catálogo para comparar as experiências publicadas e siga as opções mostradas na página de cada produto.",
  },
  faq: {
    eyebrow: "DÚVIDAS FREQUENTES",
    title: ["Perguntas antes", "de partir?"],
    intro: "Aqui ficam as respostas publicadas pela agência. Quando ainda não houver perguntas disponíveis, nossa equipe pode orientar pelos canais de contato cadastrados.",
  },
  contact: {
    eyebrow: "CONTATO",
    title: ["Vamos conversar", "sobre o Cariri?"],
    intro: "Use os canais oficiais cadastrados pela Visite Cariri Cearense Receptivo.",
  },
  privacy: {
    eyebrow: "PRIVACIDADE",
    title: ["Sua privacidade", "importa."],
    intro: "Consulte o texto de privacidade publicado pela loja.",
  },
  terms: {
    eyebrow: "TERMOS DE USO",
    title: ["Informações", "da loja."],
    intro: "Consulte os termos de uso publicados pela loja.",
  },
  cancellation: {
    eyebrow: "CANCELAMENTO E DEVOLUÇÃO",
    title: ["Condições de", "cancelamento."],
    intro: "As condições abaixo são as políticas publicadas pela loja. Confira também as condições específicas apresentadas na página da experiência antes de concluir sua compra.",
  },
};

export function VisiteCaririInstitutionalPage({ page, store }: { page: InstitutionalPage; store: PublicStore }) {
  const [, navigate] = useLocation();
  const copy = institutionalCopy[page];
  const policy = page === "privacy"
    ? store.privacyPolicy
    : page === "terms"
      ? store.termsOfService
      : page === "cancellation"
        ? [store.cancellationPolicy, store.returnPolicy].filter(Boolean).join("\n\n")
        : null;
  const hasContact = Boolean(store.contactWhatsapp || store.contactEmail || store.contactPhone || store.contactAddress);
  return (
    <div className="cariri-portal cariri-subpage">
      <header className="cariri-info-hero" data-testid={`section-${page}-hero`}>
        <div className="cariri-intro-label"><span>VISITE CARIRI</span> {copy.eyebrow}</div>
        <h1>{copy.title[0]}<br /><em>{copy.title[1]}</em></h1>
        <p>{copy.intro}</p>
        {page === "booking" && <button className="cariri-button cariri-button-yellow" data-testid="button-booking-catalog" onClick={() => navigate(`${base}/produtos?group=travel`)}>Abrir experiências <ArrowRight size={17} /></button>}
      </header>

      {page === "booking" && (
        <section className="cariri-booking-steps" data-testid="section-booking-steps">
          {[
            ["01", "Escolha uma experiência", "Abra o catálogo e selecione uma opção publicada pela agência."],
            ["02", "Confira os detalhes", "Leia a descrição, valores, datas e condições que estiverem disponíveis na página do produto."],
            ["03", "Siga a opção de compra", "Use a ação apresentada pelo produto — reservar ou adicionar ao carrinho, conforme o caso."],
            ["04", "Conclua no checkout", "Revise o pedido e siga as etapas do checkout existente. Para consultar um pedido depois, use a área de acompanhamento."],
          ].map(([number, title, description]) => <article key={number} data-testid={`booking-step-${number}`}><span>{number}</span><h2>{title}</h2><p>{description}</p></article>)}
          <div className="cariri-booking-actions">
            <button className="cariri-button cariri-button-brown" data-testid="button-booking-calendar" onClick={() => navigate(`${base}/calendario`)}>Ver calendário <ArrowRight size={16} /></button>
            <button className="cariri-inline-link" data-testid="button-booking-orders" onClick={() => navigate(`${base}/consultar-pedido`)}>Consultar pedido <ArrowUpRight size={16} /></button>
          </div>
        </section>
      )}

      {page === "faq" && (
        <section className="cariri-info-content" data-testid="section-faq-content">
          <div className="cariri-policy-empty" data-testid="empty-faq">Ainda não há perguntas frequentes publicadas pela loja.</div>
          <button className="cariri-button cariri-button-brown" data-testid="button-faq-contact" onClick={() => navigate(`${base}/contato`)}>Ver canais de contato <ArrowRight size={16} /></button>
        </section>
      )}

      {page === "contact" && (
        <section className="cariri-info-content" data-testid="section-contact-content">
          {hasContact ? <div className="cariri-info-contact">
            {store.contactWhatsapp && <a href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" data-testid="link-contact-whatsapp"><Phone size={18} /> WhatsApp <span>{store.contactWhatsapp}</span><ArrowUpRight size={15} /></a>}
            {store.contactPhone && <a href={`tel:${store.contactPhone}`} data-testid="link-contact-phone"><Phone size={18} /> Telefone <span>{store.contactPhone}</span><ArrowUpRight size={15} /></a>}
            {store.contactEmail && <a href={`mailto:${store.contactEmail}`} data-testid="link-contact-email"><Mail size={18} /> E-mail <span>{store.contactEmail}</span><ArrowUpRight size={15} /></a>}
            {store.contactAddress && <div data-testid="text-contact-address"><MapPin size={18} /> Endereço <span>{store.contactAddress}</span></div>}
          </div> : <div className="cariri-policy-empty" data-testid="empty-contact">Os canais de contato não estão disponíveis no momento.</div>}
        </section>
      )}

      {(page === "privacy" || page === "terms" || page === "cancellation") && (
        <section className="cariri-info-content" data-testid={`section-${page}-content`}>
          {policy ? <article className="cariri-policy-document" data-testid={`text-${page}-policy`}><p>{policy}</p></article> : <div className="cariri-policy-empty" data-testid={`empty-${page}-policy`}>Esta política ainda não foi informada pela loja.</div>}
          {page === "cancellation" && !store.cancellationPolicy && !store.returnPolicy && <p className="cariri-policy-caveat" data-testid="text-cancellation-availability">Consulte a página da experiência e entre em contato com a equipe antes de concluir sua compra para esclarecer condições específicas.</p>}
        </section>
      )}
      <footer className="cariri-info-footer"><button className="cariri-inline-link" data-testid={`button-${page}-catalog`} onClick={() => navigate(`${base}/produtos?group=travel`)}>Ver experiências <ArrowRight size={16} /></button><button className="cariri-inline-link" data-testid={`button-${page}-home`} onClick={() => navigate(base)}>Voltar ao início <ArrowUpRight size={16} /></button></footer>
    </div>
  );
}


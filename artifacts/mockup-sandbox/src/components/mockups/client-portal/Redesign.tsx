import "./_group.css";
import "./Redesign.css";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowRight, CalendarCheck, Camera, Check, CheckCircle2, Copy, Crown,
  Download, Globe, Heart, LayoutDashboard, LogOut, Map, MapPin, Menu,
  MessageCircle, Plane, QrCode, Share2, ShieldCheck, Sparkles, Star, Trophy,
  User, UserCircle, X, DollarSign,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Reservation = {
  id: string;
  status: string;
  tripName: string;
  tripDestination: string;
  tripDepartureDate: string;
  tripReturnDate: string;
  financialSummary: { totalAmount: number; amountRemaining: number };
};

const profile = {
  user: { name: "Marina Alves", email: "marina.alves@email.com" },
  client: {
    name: "Marina Alves",
    customerCode: "VC-20481",
    dreamDestinations: ["Lençóis Maranhenses", "Patagônia"],
    travelPreference: "Viagens em grupo",
    preferredDestinationTypes: ["Natureza", "Praia"],
    travelInterests: ["Cultura", "Gastronomia"],
  },
  tenant: { name: "Visite Cariri", slug: "visite-cariri", logoUrl: null as string | null, primaryColor: "#1E5B8C" },
  reservations: [{
    id: "res-1",
    status: "confirmed",
    tripName: "Chapada dos Veadeiros",
    tripDestination: "Goiás, Brasil",
    tripDepartureDate: "2026-12-17",
    tripReturnDate: "2026-12-20",
    financialSummary: { totalAmount: 3280, amountRemaining: 0 },
  }] as Reservation[],
  referral: { code: "MARINA10", totalReferrals: 3, completedReferrals: 2 },
  stats: { totalSpent: 6840 },
  loyalty: { availablePoints: 1240, tier: "silver" },
};

const tabs: { key: string; label: string; icon: LucideIcon; badge?: string }[] = [
  { key: "inicio", label: "Início", icon: LayoutDashboard },
  { key: "reservas", label: "Reservas", icon: CalendarCheck, badge: "1" },
  { key: "dados", label: "Meus Dados", icon: User },
  { key: "indicacoes", label: "Indicações", icon: Share2 },
  { key: "fidelidade", label: "Fidelidade", icon: Star, badge: "1.240" },
  { key: "preferencias", label: "Preferências", icon: Heart },
  { key: "favoritos", label: "Favoritos", icon: Heart },
  { key: "conquistas", label: "Conquistas", icon: Trophy },
  { key: "mapa", label: "Mapa", icon: Map },
  { key: "sonhos", label: "Sonhos", icon: Globe },
  { key: "memorias", label: "Memórias", icon: Camera },
  { key: "clube", label: "Clube", icon: Crown },
];

const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (s: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${s}T12:00:00`));
const daysUntil = (s: string) => Math.max(0, Math.round((new Date(`${s}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000));

export function Redesign() {
  const [tab, setTab] = useState("inicio");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const next = profile.reservations[0];
  const days = daysUntil(next.tripDepartureDate);
  const firstName = profile.client.name.split(" ")[0];

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };
  const goTab = (key: string) => {
    setTab(key);
    setMobileMenu(false);
    document.getElementById("portal-tabs")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const copyReferral = () => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(profile.referral.code).then(
        () => notify("Seu código de indicação foi copiado."),
        () => notify(`Seu código é ${profile.referral.code}.`),
      );
    } else {
      notify(`Seu código é ${profile.referral.code}.`);
    }
  };

  return (
    <div className="client-portal-preview trip-redesign" style={{ "--tenant-color": profile.tenant.primaryColor } as CSSProperties}>
      <header className="trip-topbar">
        <div className="trip-topbar-inner">
          <div className="trip-brand">
            <div className="trip-brand-mark">{profile.tenant.logoUrl ? <img src={profile.tenant.logoUrl} alt={profile.tenant.name} /> : profile.tenant.name.charAt(0)}</div>
            <div className="trip-brand-copy"><strong>{profile.tenant.name}</strong><span>Área do viajante</span></div>
          </div>
          <nav className="trip-quick-nav" aria-label="Navegação principal">
            {["Início", "Pacotes", "Calendário", "Meu Pedido"].map((item) => (
              <button type="button" key={item} onClick={() => notify(`${item} está disponível no portal da agência.`)}>{item}</button>
            ))}
          </nav>
          <div className="trip-header-actions">
            <button type="button" className="trip-profile-chip" onClick={() => goTab("dados")} aria-label="Abrir meus dados">
              <UserCircle size={17} /><span>Meu Perfil</span>
            </button>
            <button type="button" className="trip-exit" onClick={() => notify("Sair está disponível no portal da agência.")}>
              <LogOut size={15} /><span>Sair</span>
            </button>
            <button type="button" className="trip-menu-toggle" onClick={() => setMobileMenu((open) => !open)} aria-label={mobileMenu ? "Fechar menu" : "Abrir menu"}>
              {mobileMenu ? <X size={19} /> : <Menu size={19} />}
            </button>
          </div>
        </div>
        {mobileMenu && (
          <nav className="trip-mobile-nav" aria-label="Menu">
            {["Início", "Pacotes", "Calendário", "Meu Pedido"].map((item) => (
              <button type="button" key={item} onClick={() => { setMobileMenu(false); notify(`${item} está disponível no portal da agência.`); }}>{item}</button>
            ))}
            <button type="button" onClick={() => { setMobileMenu(false); notify("Sair está disponível no portal da agência."); }}><LogOut size={14} /> Sair</button>
          </nav>
        )}
      </header>

      <main className="trip-content">
        <section className="trip-welcome">
          <div>
            <p className="trip-eyebrow">Seu caderno de viagem · {profile.tenant.name}</p>
            <h1>Oi, {firstName}.<br /><em>Tem mundo te esperando.</em></h1>
            <p>Seu lugar para acompanhar os detalhes, guardar os planos e aproveitar cada etapa da viagem.</p>
          </div>
          <div className="trip-journey-pill"><MapPin size={15} /> Um espaço feito para você</div>
        </section>

        <section className="trip-hero" aria-label="Sua próxima viagem">
          <div className="trip-hero-copy">
            <div className="trip-hero-kicker"><Plane size={14} /> Sua próxima viagem</div>
            <div>
              <h2>{next.tripName}</h2>
              <p>Uma paisagem para respirar fundo e guardar para sempre.</p>
            </div>
            <div className="trip-hero-bottom">
              <span className="trip-hero-location"><MapPin size={15} />{next.tripDestination}</span>
              <span className="trip-hero-countdown"><strong>{days}</strong> {days === 1 ? "dia para embarcar" : "dias para embarcar"}</span>
            </div>
          </div>
        </section>

        <section className="trip-main-grid">
          <article className="trip-panel trip-reservation">
            <div className="trip-section-heading">
              <div><span>Seu roteiro</span><h3>A viagem já está confirmada</h3></div>
              <span className="trip-confirmed"><CheckCircle2 size={13} /> Confirmada</span>
            </div>
            <div className="trip-reservation-title">
              <div><h4>{next.tripName}</h4><span className="trip-destination-line"><MapPin size={14} />{next.tripDestination}</span></div>
            </div>
            <div className="trip-trip-data">
              <div><span>Partida</span><strong>{date(next.tripDepartureDate)}</strong></div>
              <div><span>Retorno</span><strong>{date(next.tripReturnDate)}</strong></div>
              <div><span>Valor total</span><strong>{money(next.financialSummary.totalAmount)}</strong></div>
            </div>
            <p className="trip-secure-note"><ShieldCheck size={14} /> Sua reserva está segura com {profile.tenant.name}.</p>
          </article>
          <div className="trip-side-stack">
            <button type="button" className="trip-loyalty" onClick={() => goTab("fidelidade")}>
              <div className="trip-loyalty-top"><span>Programa de fidelidade</span><span><Star size={11} /> Prata</span></div>
              <div className="trip-points"><strong>{profile.loyalty.availablePoints.toLocaleString("pt-BR")}</strong><span>pontos disponíveis</span></div>
              <div className="trip-loyalty-foot">Cada viagem rende novas histórias — e pontos.</div>
            </button>
            <article className="trip-panel trip-referrals">
              <div className="trip-referrals-head"><h3>Viajar fica melhor junto</h3><Share2 size={17} /></div>
              <div className="trip-referral-code">
                <strong>{profile.referral.code}</strong>
                <button type="button" onClick={copyReferral}><Copy size={13} /> Copiar</button>
              </div>
              <div className="trip-referral-meta"><span><strong>{profile.referral.totalReferrals}</strong> indicações</span><span><strong>{profile.referral.completedReferrals}</strong> confirmadas</span></div>
            </article>
          </div>
        </section>

        <button type="button" className="trip-panel trip-preferences" onClick={() => goTab("preferencias")}>
          <div className="trip-preferences-main">
            <p className="trip-pref-title"><Sparkles size={16} /> Do seu jeito, no seu ritmo</p>
            <div className="trip-pref-row"><span className="trip-pref-label">Sonhos</span>{profile.client.dreamDestinations.map((destination) => <span className="trip-pref-tag" key={destination}>{destination}</span>)}</div>
            <div className="trip-pref-meta">
              <span><Plane size={13} />{profile.client.travelPreference}</span>
              <span><Map size={13} />{profile.client.preferredDestinationTypes.join(", ")}</span>
              <span><Heart size={13} />{profile.client.travelInterests.join(", ")}</span>
            </div>
          </div>
          <span className="trip-pref-edit">Ver preferências <ArrowRight size={14} /></span>
        </button>

        <section className="trip-secondary-grid" aria-label="Resumo do seu perfil">
          <article className="trip-panel trip-spend">
            <div className="trip-secondary-title"><DollarSign size={14} /> Sua história com a gente</div>
            <div className="trip-spend-content"><strong>{money(profile.stats.totalSpent)}</strong><span>investidos em {profile.reservations.length} reserva(s) com a agência</span></div>
          </article>
          <article className="trip-panel trip-profile-card">
            <div className="trip-secondary-title"><User size={14} /> Viajante</div>
            {cardFlipped ? (
              <div className="trip-card-benefits">
                <strong>Benefícios do programa</strong>
                <span>Ofertas e condições exclusivas</span><span>Pontos em cada viagem</span><span>Prioridade em novidades</span>
              </div>
            ) : (
              <div className="trip-profile-line">
                <div className="trip-avatar">{profile.client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
                <div><strong>{profile.client.name}</strong><span>{profile.user.email}</span></div>
                <span className="trip-customer-code">{profile.client.customerCode}</span>
              </div>
            )}
            <div className="trip-card-actions">
              <button type="button" onClick={() => setCardFlipped((flipped) => !flipped)}><QrCode size={13} />{cardFlipped ? "Ver frente" : "Virar cartão"}</button>
              <button type="button" onClick={() => notify("Seu cartão do viajante está pronto para baixar.")}><Download size={13} />Baixar cartão</button>
              <button type="button" onClick={() => notify("Compartilhamento disponível no portal da agência.")}><MessageCircle size={13} />Compartilhar</button>
            </div>
          </article>
        </section>

        <section className="trip-tabs-section" id="portal-tabs">
          <div className="trip-tabs-head"><h2>Seu espaço de viajante</h2><p>Encontre aqui cada parte da sua jornada.</p></div>
          <nav className="trip-tabs" aria-label="Seções do perfil">
            {tabs.map(({ key, label, icon: Icon, badge }) => (
              <button type="button" key={key} className={`trip-tab${tab === key ? " is-active" : ""}`} onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined}>
                <Icon size={15} />{label}{badge && <span className="trip-tab-badge">{badge}</span>}
              </button>
            ))}
          </nav>
          {tab !== "inicio" && (
            <div className="trip-tab-panel" key={tab}>
              <div className="trip-tab-panel-icon">{(() => { const Icon = tabs.find((item) => item.key === tab)?.icon ?? LayoutDashboard; return <Icon size={19} />; })()}</div>
              <div><strong>{tabs.find((item) => item.key === tab)?.label}</strong><p>Esta aba está disponível no portal do viajante.</p></div>
            </div>
          )}
        </section>

        <footer className="trip-footer">{profile.tenant.name} · Área segura do viajante · VisiteCRM</footer>
      </main>

      {toast && <div className="trip-toast" role="status"><Check size={16} />{toast}</div>}
      {cardFlipped && <div className="sr-only" aria-live="polite">Cartão do viajante: {profile.client.customerCode}, {profile.loyalty.availablePoints} pontos, nível Prata.</div>}
    </div>
  );
}

export default Redesign;
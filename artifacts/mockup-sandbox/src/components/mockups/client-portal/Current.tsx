import "./_group.css";
import { useState } from "react";
import {
  AlertCircle, ArrowRight, CalendarCheck, Camera, Coins, Copy, Crown,
  Download, Globe, Heart, LayoutDashboard, LogOut, Map, MapPin, Menu,
  MessageCircle, Plane, QrCode, Share2, Sparkles, Star, Trophy, User,
  UserCircle, X, DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Profile = {
  user: { name: string; email: string } | null;
  client: {
    name: string; customerCode: string; dreamDestinations: string[];
    travelPreference: string; preferredDestinationTypes: string[]; travelInterests: string[];
  } | null;
  tenant: { name: string; slug: string; logoUrl: string | null; primaryColor: string };
  reservations: Reservation[];
  referral: { code: string; totalReferrals: number; completedReferrals: number };
  stats: { totalSpent: number };
  loyalty: { availablePoints: number; tier: string } | null;
};
type Reservation = {
  id: string; status: string; tripName: string; tripDestination: string;
  tripDepartureDate: string; tripReturnDate: string; financialSummary: { totalAmount: number; amountRemaining: number };
};

const profile: Profile = {
  user: { name: "Marina Alves", email: "marina.alves@email.com" },
  client: {
    name: "Marina Alves", customerCode: "VC-20481", dreamDestinations: ["Lençóis Maranhenses", "Patagônia"],
    travelPreference: "Viagens em grupo", preferredDestinationTypes: ["Natureza", "Praia"], travelInterests: ["Cultura", "Gastronomia"],
  },
  tenant: { name: "Visite Cariri", slug: "visite-cariri", logoUrl: null, primaryColor: "#1E5B8C" },
  reservations: [{
    id: "res-1", status: "confirmed", tripName: "Chapada dos Veadeiros", tripDestination: "Goiás, Brasil",
    tripDepartureDate: "2026-12-17", tripReturnDate: "2026-12-20",
    financialSummary: { totalAmount: 3280, amountRemaining: 0 },
  }],
  referral: { code: "MARINA10", totalReferrals: 3, completedReferrals: 2 },
  stats: { totalSpent: 6840 },
  loyalty: { availablePoints: 1240, tier: "silver" },
};

const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (s: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${s}T12:00:00`));
const daysUntil = (s: string) => Math.max(0, Math.round((new Date(`${s}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000));

function PortalLayout({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState(false);
  const tenant = profile.tenant;
  return (
    <div className="client-portal-preview min-h-screen bg-[#F5F7FA] flex flex-col text-[#2F3A43]">
      <header className="sticky top-0 z-40 border-b border-[#17486F] shadow-[0_8px_28px_rgba(27,68,103,.16)]" style={{ background: `linear-gradient(110deg, ${tenant.primaryColor} 0%, #17486F 72%, #5D3E2A 140%)` }}>
        <div className="max-w-6xl mx-auto px-4 h-[4.5rem] flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#D8A646] flex items-center justify-center font-bold text-[#5D3E2A] text-base ring-1 ring-white/20">{tenant.name.charAt(0)}</div>
            <div className="hidden sm:block"><span className="text-white font-semibold text-base block">{tenant.name}</span><span className="text-white/60 text-[10px] uppercase tracking-[0.18em]">Área do viajante</span></div>
            <div className="sm:hidden text-white font-semibold text-base">{tenant.name}</div>
          </div>
          <nav className="hidden md:flex items-center gap-1 rounded-2xl bg-black/10 p-1">
            {["Início", "Pacotes", "Calendário", "Meu Pedido"].map((item) => <a key={item} href="#inert" onClick={(e) => e.preventDefault()} className="rounded-full px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white text-sm font-medium transition-colors">{item}</a>)}
          </nav>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-white/90"><UserCircle className="w-4 h-4" /><span className="text-sm font-medium hidden sm:block">Meu Perfil</span></div>
            <Button variant="ghost" size="sm" onClick={() => undefined} className="text-white/80 hover:text-white hover:bg-white/20 gap-1.5 hidden md:flex"><LogOut className="w-4 h-4" /><span className="hidden sm:block">Sair</span></Button>
            <button onClick={() => setMenu(!menu)} className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 text-white" aria-label="Abrir menu">{menu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}</button>
          </div>
        </div>
        {menu && <div className="md:hidden border-t border-white/10 px-4 py-3 space-y-1">{["Início", "Pacotes", "Calendário", "Meu Pedido"].map((x) => <a href="#inert" onClick={(e) => { e.preventDefault(); setMenu(false); }} key={x} className="block text-white/90 text-sm font-medium py-2">{x}</a>)}</div>}
      </header>
      <main className="relative flex-1 max-w-6xl mx-auto w-full px-4 py-6 md:py-9"><div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_12%_0%,rgba(216,166,70,.16),transparent_45%),radial-gradient(circle_at_90%_10%,rgba(76,139,95,.12),transparent_40%)]" /><div className="relative">{children}</div></main>
      <footer className="border-t border-[#DCE3E8] bg-[#FFF9F0] text-[#71808C] py-5 text-center text-xs">{tenant.name} · Área segura do viajante · VisiteCRM</footer>
    </div>
  );
}

function ClienteCard() {
  const [flipped, setFlipped] = useState(false);
  const c = profile.client!;
  return <div className="flex flex-col items-center gap-2"><div className="w-full max-w-[420px] [perspective:1200px]"><div className={`relative aspect-[1.586/1] w-full transition-transform duration-700 [transform-style:preserve-3d] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}>
    <div className="absolute inset-0 rounded-2xl overflow-hidden shadow-2xl text-white select-none [backface-visibility:hidden]" style={{ background: "linear-gradient(135deg,#1E5B8C,#17486F 55%,#4C8B5F)" }}>
      <div className="relative h-full p-5 flex flex-col justify-between"><div className="flex items-start justify-between"><div className="flex items-center gap-2"><div className="h-10 w-10 rounded-full bg-white/20 border border-white/30 flex items-center justify-center font-bold">V</div><div><p className="text-[8px] text-white/50 uppercase tracking-widest">Agência</p><p className="text-[11px] font-bold">{profile.tenant.name}</p></div></div><div className="text-right"><p className="text-[7px] text-white/50 uppercase tracking-widest">Cartão do</p><p className="text-[10px] font-extrabold uppercase tracking-wide">Viajante</p><div className="mt-2 h-5 w-7 rounded bg-[#D8A646] ml-auto" /></div></div><div><p className="text-[8px] text-white/45 uppercase tracking-[0.2em] mb-1">Código do Cliente</p><p className="text-[20px] font-mono font-bold tracking-[0.05em]">{c.customerCode}</p><p className="text-[9px] text-white/55 mt-1 font-mono">{profile.loyalty?.availablePoints.toLocaleString("pt-BR")} pts disponíveis</p></div><div className="flex items-end justify-between"><div><p className="text-[7px] text-white/45 uppercase tracking-wider">Viajante</p><p className="text-[12px] font-bold uppercase">{c.name}</p></div><div className="text-center"><p className="text-[7px] text-white/45 uppercase tracking-wider">Nível</p><p className="text-[11px] font-bold">🥈 Prata</p></div><div className="text-right"><p className="text-[7px] text-white/45 uppercase tracking-wider">Indicação</p><p className="text-[11px] font-mono font-bold">{profile.referral.code}</p></div></div></div>
    </div><div className="absolute inset-0 rounded-2xl overflow-hidden shadow-2xl text-white [backface-visibility:hidden] [transform:rotateY(180deg)]" style={{ background: "linear-gradient(135deg,#1E5B8C,#17486F)" }}><div className="h-9 bg-black/80 mt-4" /><div className="p-5"><p className="text-xs uppercase tracking-widest text-white/60 mb-3">Benefícios do programa</p>{["Ofertas e condições exclusivas", "Pontos em cada viagem", "Prioridade em novidades"].map((x) => <p className="text-xs mb-2" key={x}>✓ {x}</p>)}</div></div>
  </div></div><div className="flex flex-wrap justify-center gap-2 mt-1"><Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setFlipped(!flipped)}><QrCode className="w-3.5 h-3.5" />{flipped ? "Ver frente" : "Virar cartão"}</Button><Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => undefined}><Download className="w-3.5 h-3.5" />Baixar cartão</Button><Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => undefined}><MessageCircle className="w-3.5 h-3.5" />Compartilhar</Button></div></div>;
}

function ReservationCard({ reservation }: { reservation: Reservation }) {
  return <div className="overflow-hidden rounded-xl border bg-white text-card-foreground shadow-sm"><div className="flex items-start gap-4 p-4"><div className="mt-1"><div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center"><Plane className="w-4 h-4" /></div></div><div className="flex-1 min-w-0"><div className="flex items-start justify-between gap-2 flex-wrap"><div><h4 className="font-semibold text-base leading-tight">{reservation.tripName}</h4><div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5"><MapPin className="w-3.5 h-3.5" />{reservation.tripDestination}</div></div><span className="rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-xs text-green-600">Confirmada</span></div><div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm"><div><p className="text-muted-foreground text-xs">Partida</p><p className="font-medium">{date(reservation.tripDepartureDate)}</p></div><div><p className="text-muted-foreground text-xs">Retorno</p><p className="font-medium">{date(reservation.tripReturnDate)}</p></div><div><p className="text-muted-foreground text-xs">Total</p><p className="font-medium">{money(reservation.financialSummary.totalAmount)}</p></div></div></div></div></div>;
}

function PreferencesSummary() {
  const c = profile.client!;
  return <button type="button" onClick={() => undefined} className="w-full text-left rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 hover:bg-violet-100 transition-colors"><div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-500" /><p className="text-sm font-semibold text-violet-800">Suas preferências</p></div><span className="text-xs text-violet-500 flex items-center gap-0.5">Editar <ArrowRight className="w-3 h-3" /></span></div><div className="space-y-1.5"><div className="flex flex-wrap gap-1.5 items-center"><span className="text-xs text-violet-600"><Globe className="w-3 h-3 inline mr-0.5" />Sonhos:</span>{c.dreamDestinations.map((d) => <span key={d} className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-medium border border-violet-200">{d}</span>)}</div><div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-violet-600"><span>♧ {c.travelPreference}</span><span><Map className="w-3 h-3 inline" /> {c.preferredDestinationTypes.join(", ")}</span><span><Heart className="w-3 h-3 inline" /> {c.travelInterests.join(", ")}</span></div></div></button>;
}

function InicioTab({ onTabChange }: { onTabChange: (tab: string) => void }) {
  const next = profile.reservations[0];
  const days = daysUntil(next.tripDepartureDate);
  const cards = [
    { icon: <Plane className="w-5 h-5" />, label: "Próxima Viagem", value: date(next.tripDepartureDate), sub: next.tripName, color: "text-blue-600", bg: "bg-blue-50", tab: "reservas" },
    { icon: <DollarSign className="w-5 h-5" />, label: "Total Gasto", value: money(profile.stats.totalSpent), sub: "em 1 reserva(s)", color: "text-green-600", bg: "bg-green-50", tab: "reservas" },
    { icon: <Coins className="w-5 h-5" />, label: "Pontos de Fidelidade", value: profile.loyalty!.availablePoints.toLocaleString("pt-BR"), sub: "pontos disponíveis", color: "text-amber-600", bg: "bg-amber-50", tab: "fidelidade" },
    { icon: <Share2 className="w-5 h-5" />, label: "Indicações", value: String(profile.referral.totalReferrals), sub: "2 confirmada(s)", color: "text-purple-600", bg: "bg-purple-50", tab: "indicacoes" },
  ];
  return <div className="space-y-6"><div className="space-y-3"><ClienteCard /><div className="px-1"><p className="text-sm text-muted-foreground">Bem-vindo(a) de volta, <span className="font-semibold text-foreground">Marina</span>! Sua próxima viagem começa em {days} dias.</p></div></div><div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{cards.map((k) => <button key={k.label} type="button" onClick={() => onTabChange(k.tab)} className="text-left rounded-xl border bg-card text-card-foreground shadow-sm cursor-pointer hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="p-4"><div className={`w-9 h-9 rounded-lg ${k.bg} ${k.color} flex items-center justify-center mb-3`}>{k.icon}</div><p className="text-xs text-muted-foreground mb-0.5">{k.label}</p><p className="text-xl font-bold leading-tight">{k.value}</p><p className="text-xs text-muted-foreground mt-0.5 truncate">{k.sub}</p></div></button>)}</div><PreferencesSummary /><div><h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Próxima Viagem</h3><ReservationCard reservation={next} /></div></div>;
}

export function Current() {
  const [tab, setTab] = useState("inicio");
  const tabs = [
    ["inicio", <LayoutDashboard className="w-4 h-4" />, "Início"], ["reservas", <CalendarCheck className="w-4 h-4" />, "Reservas"], ["dados", <User className="w-4 h-4" />, "Meus Dados"], ["indicacoes", <Share2 className="w-4 h-4" />, "Indicações"], ["fidelidade", <Star className="w-4 h-4" />, "Fidelidade"], ["preferencias", <Heart className="w-4 h-4" />, "Preferências"], ["favoritos", <Heart className="w-4 h-4 fill-current text-red-400" />, "Favoritos"], ["conquistas", <Trophy className="w-4 h-4" />, "Conquistas"], ["mapa", <Map className="w-4 h-4" />, "Mapa"], ["sonhos", <Globe className="w-4 h-4" />, "Sonhos"], ["memorias", <Camera className="w-4 h-4" />, "Memórias"], ["clube", <Crown className="w-4 h-4" />, "Clube"],
  ] as const;
  return <PortalLayout><div className="visite-enter"><div className="relative mb-6 overflow-hidden rounded-3xl border border-[#D9CBBE] bg-[#FFF9F0] p-5 shadow-[0_10px_28px_rgba(93,62,42,.08)] sm:p-7"><div className="pointer-events-none absolute -right-8 -top-16 h-44 w-44 rounded-full border-[16px] border-[#D8A646]/20" /><div className="pointer-events-none absolute bottom-[-5rem] right-44 h-36 w-36 rounded-full border-[12px] border-[#4C8B5F]/15" /><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4C8B5F]">Caderno de bordo · {profile.tenant.name}</p><h1 className="text-2xl font-semibold tracking-tight text-[#5D3E2A] sm:text-3xl">Olá, Marina.</h1><p className="mt-1 max-w-xl text-sm text-[#71808C]">Acompanhe suas reservas, benefícios e próximas experiências pelo Cariri.</p></div><div className="flex items-center gap-2 rounded-xl border border-[#E8D29B] bg-[#FFF4CF] px-3 py-2 text-xs font-medium text-[#5D3E2A]"><MapPin className="h-4 w-4 text-[#D8A646]" />Seu espaço de viajante</div></div></div><div className="mb-6 h-auto w-full flex flex-wrap justify-start gap-1 rounded-2xl border border-[#DCE3E8] bg-white/90 p-1.5 shadow-sm sm:w-auto">{tabs.map(([key, icon, label]) => <button type="button" key={key} onClick={() => setTab(key)} className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${tab === key ? "bg-[#1E5B8C] text-white shadow-sm" : "text-[#2F3A43] hover:bg-[#F5F7FA]"}`}>{icon}{label}{key === "reservas" && <span className="ml-0.5 rounded-full bg-[#E8EEF3] px-1.5 py-0 text-xs text-[#1E5B8C]">1</span>}{key === "fidelidade" && <span className="ml-0.5 rounded-full bg-[#E8EEF3] px-1.5 py-0 text-xs text-[#1E5B8C]">1.240</span>}</button>)}</div>{tab === "inicio" ? <InicioTab onTabChange={setTab} /> : <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">Esta aba está disponível no portal do viajante.</div>}</div></PortalLayout>;
}

export default Current;
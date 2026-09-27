import "./_group.css";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Compass,
  CreditCard,
  Heart,
  Leaf,
  MapPin,
  Menu,
  MessageCircle,
  Mountain,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";

const heroImage = "/__mockup/images/cariri-chapada-araripe-hero.png";
const demoExperiences = [
  {
    id: "araripe",
    name: "Manhã na Chapada do Araripe",
    place: "Crato · Geopark Araripe",
    kind: "tour",
    kindLabel: "Natureza & caminhada",
    price: 168,
    duration: "4 horas",
    people: 8,
    note: "Trilha leve · mirantes · guia local",
    position: "25% 57%",
    icon: Mountain,
  },
  {
    id: "santana",
    name: "Pedra Cariri & histórias antigas",
    place: "Santana do Cariri",
    kind: "package",
    kindLabel: "Cultura & território",
    price: 245,
    duration: "Dia inteiro",
    people: 6,
    note: "Museu de Paleontologia · almoço regional",
    position: "72% 68%",
    icon: Compass,
  },
  {
    id: "barbalha",
    name: "Rota das águas e engenhos",
    place: "Barbalha · Caldas",
    kind: "tour",
    kindLabel: "Águas & bem-estar",
    price: 132,
    duration: "5 horas",
    people: 10,
    note: "Fontes naturais · pausa sem pressa",
    position: "90% 48%",
    icon: Leaf,
  },
];

const categories = [
  { name: "Natureza", caption: "Trilhas e mirantes", icon: Mountain, tone: "sage" },
  { name: "Cultura", caption: "Saberes da região", icon: Compass, tone: "clay" },
  { name: "Águas", caption: "Fontes e descanso", icon: Leaf, tone: "blue" },
  { name: "Em família", caption: "Um passeio para todos", icon: Users, tone: "gold" },
];

const quickQuestions = [
  "Quero um passeio leve",
  "O que fazer com crianças?",
  "Gosto de cultura e história",
];

type Message = { role: "traveler" | "host"; text: string };

function localAnswer(question: string) {
  const text = question.toLocaleLowerCase("pt-BR");
  if (text.includes("criança") || text.includes("família") || text.includes("familia")) {
    return "Com crianças, eu começaria pelo Geopark Araripe e pelo Museu de Paleontologia em Santana do Cariri: dá para misturar curiosidade, paradas tranquilas e um almoço sem correria. Confira sempre a duração e a idade recomendada de cada passeio.";
  }
  if (text.includes("cultur") || text.includes("hist") || text.includes("museu")) {
    return "Para sentir a história daqui, combine Santana do Cariri e seu Museu de Paleontologia com uma parada em Nova Olinda, terra da Fundação Casa Grande. É um dia cheio de histórias — vale sair cedo.";
  }
  if (text.includes("trilha") || text.includes("leve") || text.includes("natureza")) {
    return "Um começo gostoso é uma caminhada curta nos mirantes da Chapada do Araripe, pela manhã. O clima costuma ser mais ameno; leve água, calçado firme e confirme as condições com o guia local.";
  }
  if (text.includes("barato") || text.includes("orçamento") || text.includes("preço")) {
    return "Para cuidar do orçamento, procure passeios de meio período e compare o que está incluído — transporte, guia e alimentação mudam bastante o valor. Use o filtro de orçamento logo acima para explorar a seleção demonstrativa.";
  }
  return "Eu começaria escolhendo o ritmo da viagem: trilha e paisagem na Chapada do Araripe, cultura em Santana do Cariri e Nova Olinda, ou uma pausa nas águas de Barbalha. Quantas horas você quer dedicar ao passeio?";
}

function SectionTitle({
  overline,
  title,
  copy,
  number,
}: {
  overline: string;
  title: string;
  copy?: string;
  number?: string;
}) {
  return (
    <div className="dc-section-title">
      <div>
        <span className="dc-overline">{overline}</span>
        <h2>{title}</h2>
        {copy && <p>{copy}</p>}
      </div>
      {number && <span className="dc-index">{number}</span>}
    </div>
  );
}

export function Discovery() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState("");
  const [experienceType, setExperienceType] = useState("");
  const [budget, setBudget] = useState("");
  const [passengers, setPassengers] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "host",
      text: "Oi, que bom ter você por aqui. Me conte o que gosta de fazer — eu ajudo a encontrar um bom começo pelo Cariri.",
    },
  ]);

  const results = useMemo(
    () =>
      demoExperiences.filter((experience) => {
        const matchesDestination =
          !destination ||
          experience.place.toLocaleLowerCase("pt-BR").includes(destination.toLocaleLowerCase("pt-BR"));
        const matchesType = !experienceType || experience.kind === experienceType;
        const matchesBudget = !budget || experience.price <= Number(budget);
        const matchesPeople = !passengers || experience.people >= Number(passengers);
        return matchesDestination && matchesType && matchesBudget && matchesPeople;
      }),
    [budget, destination, experienceType, passengers],
  );
  const dateLabel = date
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${date}T12:00:00`))
    : "";

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    document.getElementById("experiencias")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function askHost(value = question) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setMessages((current) => [
      ...current,
      { role: "traveler", text: trimmed },
      { role: "host", text: localAnswer(trimmed) },
    ]);
    setQuestion("");
  }

  function handleQuestionKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      askHost();
    }
  }

  function toggleSaved(id: string) {
    setSaved((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <div className="dc-page">
      <style>{`
        .dc-page {
          --ink: #213c39;
          --ink-soft: #4c635e;
          --blue: #1e5b8c;
          --blue-deep: #153f5e;
          --clay: #b95e40;
          --gold: #d8a646;
          --sage: #637d68;
          --paper: #f5f2e9;
          --paper-deep: #ebe6d9;
          --card: #fffdf7;
          color: var(--ink);
          background: var(--paper);
          font-family: 'DM Sans', 'Avenir Next', sans-serif;
          min-height: 100dvh;
          overflow: hidden;
        }
        .dc-page * { box-sizing: border-box; }
        .dc-page button, .dc-page input, .dc-page select { font: inherit; }
        .dc-page a { color: inherit; text-decoration: none; }
        .dc-page button { cursor: pointer; }
        .dc-topbar {
          height: 70px; position: relative; z-index: 10; display: flex; align-items: center;
          justify-content: space-between; gap: 20px; padding: 0 clamp(20px, 6vw, 88px);
          background: var(--paper); border-bottom: 1px solid #263d3514;
        }
        .dc-brand { display: inline-flex; align-items: center; gap: 11px; min-width: 190px; }
        .dc-brand-mark {
          height: 37px; width: 37px; display: grid; place-items: center; color: #fff;
          background: var(--blue); border-radius: 50% 50% 45% 45%; transform: rotate(-5deg);
        }
        .dc-brand-mark svg { transform: rotate(5deg); }
        .dc-brand-word { font-size: 15px; letter-spacing: -.045em; line-height: 1.05; font-weight: 800; }
        .dc-brand-word small { display: block; color: var(--ink-soft); font-size: 9px; font-weight: 650; letter-spacing: .17em; text-transform: uppercase; margin-top: 4px; }
        .dc-nav { display: flex; align-items: center; justify-content: center; gap: clamp(18px, 3.1vw, 45px); }
        .dc-nav a { color: #3e5751; font-size: 12px; font-weight: 650; transition: color .2s ease; }
        .dc-nav a:hover { color: var(--clay); }
        .dc-top-action { display: flex; min-width: 190px; justify-content: flex-end; }
        .dc-top-action a { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 750; color: var(--blue); }
        .dc-menu-button { display: none; border: 0; padding: 8px; background: transparent; color: var(--ink); }
        .dc-hero {
          min-height: 548px; position: relative; isolation: isolate; display: flex; align-items: center;
          background: #31594d; color: white;
        }
        .dc-hero-image { position: absolute; z-index: -2; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 54%; }
        .dc-hero::after { content: ""; position: absolute; z-index: -1; inset: 0; background:
          linear-gradient(90deg, rgba(19,42,38,.78) 0%, rgba(20,44,39,.56) 37%, rgba(20,44,39,.12) 76%),
          linear-gradient(0deg, rgba(18,38,33,.42), transparent 48%); }
        .dc-hero-inner { width: min(1150px, 100%); margin: auto; padding: 76px 34px 92px; }
        .dc-hero-copy { max-width: 580px; }
        .dc-location-tag { display: inline-flex; align-items: center; gap: 8px; padding: 7px 11px; border-radius: 99px; border: 1px solid #ffffff55; background: #182f2a55; backdrop-filter: blur(8px); font-size: 10px; text-transform: uppercase; letter-spacing: .16em; font-weight: 700; }
        .dc-hero h1 { max-width: 570px; margin: 21px 0 13px; font-family: Georgia, 'Times New Roman', serif; font-weight: 400; letter-spacing: -.045em; font-size: clamp(42px, 5.8vw, 76px); line-height: .99; }
        .dc-hero h1 em { color: #f0ca80; font-style: italic; }
        .dc-hero-copy > p { max-width: 425px; margin: 0; color: #fffdf0e8; font-size: 14px; line-height: 1.7; }
        .dc-hero-note { margin-top: 23px; display: flex; gap: 10px; align-items: center; font-size: 11px; color: #fffdf0d8; }
        .dc-hero-note span { width: 27px; height: 1px; background: #e4bd6e; }
        .dc-hero-aside { position: absolute; right: max(5vw, 32px); bottom: 105px; display: flex; align-items: center; gap: 9px; color: #fff; font-size: 11px; writing-mode: vertical-rl; letter-spacing: .13em; text-transform: uppercase; }
        .dc-hero-aside i { width: 1px; height: 38px; background: #fff9; }
        .dc-search-wrap { position: relative; z-index: 2; width: min(1140px, calc(100% - 48px)); margin: -42px auto 0; }
        .dc-search-form { padding: 16px 17px 14px; border-radius: 17px; background: var(--card); box-shadow: 0 15px 42px #293d351c; border: 1px solid #46574b14; }
        .dc-search-grid { display: grid; grid-template-columns: 1.24fr 1fr 1.08fr .95fr .9fr auto; align-items: center; }
        .dc-field { min-width: 0; display: flex; align-items: center; gap: 10px; padding: 3px 16px; border-right: 1px solid #deded3; }
        .dc-field:first-child { padding-left: 6px; }
        .dc-field:nth-child(5) { border: 0; }
        .dc-field-icon { color: var(--blue); flex: 0 0 auto; }
        .dc-field-text { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
        .dc-field label { color: #66736d; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; }
        .dc-field select, .dc-field input { width: 100%; min-width: 0; padding: 0; border: 0; outline: 0; color: var(--ink); background: transparent; font-size: 12px; font-weight: 650; }
        .dc-field select { appearance: none; padding-right: 13px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2366736d' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right center; }
        .dc-field input[type="date"] { font-size: 11px; }
        .dc-search-submit { min-height: 47px; display: inline-flex; justify-content: center; align-items: center; gap: 9px; white-space: nowrap; border: 0; border-radius: 99px; padding: 0 19px; color: #fff; background: var(--blue); font-size: 11px; font-weight: 750; transition: transform .2s ease, background .2s ease; }
        .dc-search-submit:hover { transform: translateY(-2px); background: var(--blue-deep); }
        .dc-search-caption { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 7px 0; color: #738078; font-size: 10px; }
        .dc-search-caption b { color: var(--ink-soft); font-weight: 700; }
        .dc-proof { display: flex; justify-content: center; gap: clamp(22px, 5.3vw, 74px); align-items: center; padding: 27px 20px 30px; }
        .dc-proof-item { display: flex; align-items: center; gap: 10px; color: var(--ink-soft); font-size: 11px; font-weight: 650; }
        .dc-proof-item svg { color: var(--clay); }
        .dc-content { width: min(1120px, calc(100% - 48px)); margin: auto; }
        .dc-section { padding: 69px 0; border-top: 1px solid #31473f18; scroll-margin-top: 24px; }
        .dc-section-title { display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; margin-bottom: 27px; }
        .dc-overline { display: inline-block; color: var(--clay); font-size: 9px; font-weight: 800; letter-spacing: .19em; text-transform: uppercase; }
        .dc-section-title h2 { margin: 8px 0 6px; font-family: Georgia, 'Times New Roman', serif; font-size: clamp(29px, 3.3vw, 43px); font-weight: 400; line-height: 1.1; letter-spacing: -.035em; }
        .dc-section-title p { max-width: 540px; margin: 0; color: #6d7970; font-size: 12px; line-height: 1.65; }
        .dc-index { font-family: Georgia, serif; font-size: 38px; color: #c9c5b8; }
        .dc-category-grid { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid #3549413b; border-bottom: 1px solid #3549413b; }
        .dc-category { min-height: 157px; position: relative; display: flex; flex-direction: column; justify-content: space-between; padding: 22px 22px 18px; border: 0; border-right: 1px solid #3549413b; text-align: left; background: transparent; color: var(--ink); transition: background .25s ease, color .25s ease; }
        .dc-category:last-child { border-right: 0; }
        .dc-category:hover, .dc-category:focus-visible { color: var(--card); background: var(--blue); outline: 0; }
        .dc-category-icon { width: 37px; height: 37px; display: grid; place-items: center; color: var(--blue); border: 1px solid #284f482e; border-radius: 50%; }
        .dc-category:hover .dc-category-icon { color: #fff; border-color: #ffffff80; }
        .dc-category strong { display: block; font-family: Georgia, serif; font-size: 21px; font-weight: 400; }
        .dc-category small { display: block; margin-top: 5px; color: #758079; font-size: 10px; }
        .dc-category:hover small { color: #ffffffc9; }
        .dc-category-arrow { position: absolute; right: 19px; bottom: 22px; color: #9b9b8d; transition: transform .2s ease; }
        .dc-category:hover .dc-category-arrow { transform: translate(2px, -2px); color: white; }
        .dc-host-section { display: grid; grid-template-columns: .92fr 1.08fr; gap: clamp(28px, 6vw, 84px); align-items: center; padding: 60px 0 74px; }
        .dc-host-intro { position: relative; min-height: 255px; padding: 34px 30px 30px 0; }
        .dc-host-intro:before { content: "“"; position: absolute; top: 0; right: 16px; color: #d7cbb0; font: 120px/1 Georgia, serif; }
        .dc-host-intro h2 { position: relative; max-width: 425px; margin: 12px 0 14px; font-family: Georgia, serif; font-weight: 400; letter-spacing: -.04em; font-size: clamp(30px, 3.5vw, 44px); line-height: 1.07; }
        .dc-host-intro p { max-width: 410px; margin: 0; color: #65746c; font-size: 12px; line-height: 1.75; }
        .dc-host-stamp { display: flex; gap: 9px; align-items: center; margin-top: 22px; color: var(--blue); font-size: 10px; font-weight: 750; }
        .dc-chat { padding: 20px; border: 1px solid #31473f20; border-radius: 14px; background: #f9f7ef; box-shadow: 0 8px 25px #33483c0b; }
        .dc-chat-head { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 1px solid #33483c18; }
        .dc-chat-person { display: flex; align-items: center; gap: 10px; }
        .dc-chat-avatar { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; color: #fff; background: var(--sage); }
        .dc-chat-person strong { display: block; font-size: 11px; }
        .dc-chat-person small { display: block; margin-top: 4px; color: #77817a; font-size: 9px; }
        .dc-demo-label { padding: 5px 8px; border-radius: 99px; color: #7d6741; background: #eee5d0; font-size: 8px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
        .dc-chat-messages { height: 218px; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding: 15px 2px 12px; scrollbar-color: #d1cbbd transparent; scrollbar-width: thin; }
        .dc-message { max-width: 89%; padding: 10px 12px; border-radius: 3px 12px 12px 12px; color: #42574f; background: #ecece2; font-size: 10px; line-height: 1.6; animation: dc-appear .24s ease both; }
        .dc-message.traveler { align-self: flex-end; border-radius: 12px 3px 12px 12px; color: white; background: var(--blue); }
        .dc-question-chips { display: flex; gap: 7px; flex-wrap: wrap; margin: 1px 0 12px; }
        .dc-question-chip { padding: 7px 9px; border: 1px solid #cbd1c6; border-radius: 99px; color: #52665c; background: transparent; font-size: 9px; transition: all .18s ease; }
        .dc-question-chip:hover { border-color: var(--blue); color: var(--blue); background: #e7edf0; }
        .dc-chat-form { display: flex; align-items: center; gap: 8px; padding: 5px 5px 5px 12px; border: 1px solid #d5d8cd; border-radius: 99px; background: #fffdf7; }
        .dc-chat-form input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--ink); font-size: 10px; }
        .dc-chat-form input::placeholder { color: #88928a; }
        .dc-send { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 50%; color: #fff; background: var(--blue); transition: transform .18s ease; }
        .dc-send:hover { transform: scale(1.06); }
        .dc-chat-foot { margin: 9px 4px 0; color: #8a9189; font-size: 8px; line-height: 1.4; }
        .dc-experience-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 15px; }
        .dc-results-note { padding: 8px 11px; border-radius: 99px; color: #52685d; background: #e6e9dd; font-size: 9px; white-space: nowrap; }
        .dc-card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
        .dc-experience-card { overflow: hidden; border: 1px solid #33483c1c; border-radius: 11px; background: var(--card); transition: transform .24s ease, box-shadow .24s ease; }
        .dc-experience-card:hover { transform: translateY(-4px); box-shadow: 0 15px 30px #34493b18; }
        .dc-card-photo { position: relative; height: 180px; overflow: hidden; background: #697e66; }
        .dc-card-photo img { width: 100%; height: 100%; object-fit: cover; transition: transform .5s ease; }
        .dc-experience-card:hover .dc-card-photo img { transform: scale(1.04); }
        .dc-card-photo:after { content: ""; position: absolute; inset: 35% 0 0; background: linear-gradient(transparent, #102c29a8); pointer-events: none; }
        .dc-card-tag { position: absolute; z-index: 1; top: 12px; left: 12px; padding: 6px 9px; border-radius: 99px; color: #2e554b; background: #fbf8edeb; font-size: 8px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
        .dc-favorite { position: absolute; z-index: 2; top: 10px; right: 10px; width: 33px; height: 33px; display: grid; place-items: center; border: 1px solid #ffffff8a; border-radius: 50%; color: white; background: #20352e66; backdrop-filter: blur(4px); }
        .dc-favorite.is-saved { color: #f5c9b3; background: #743e35d9; }
        .dc-card-place { position: absolute; z-index: 1; left: 15px; bottom: 13px; color: white; font-size: 9px; font-weight: 700; }
        .dc-card-body { padding: 16px 16px 14px; }
        .dc-card-body h3 { margin: 0 0 8px; font-family: Georgia, serif; font-size: 20px; font-weight: 400; letter-spacing: -.02em; line-height: 1.16; }
        .dc-card-note { margin: 0; color: #738078; font-size: 10px; }
        .dc-card-meta { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 15px; padding-top: 12px; border-top: 1px solid #31473f16; }
        .dc-meta-items { display: flex; gap: 10px; color: #6f7c73; font-size: 9px; }
        .dc-meta-items span { display: flex; align-items: center; gap: 4px; }
        .dc-card-price { text-align: right; }
        .dc-card-price small { display: block; color: #808b81; font-size: 8px; }
        .dc-card-price strong { color: var(--blue); font-size: 15px; }
        .dc-detail { margin-top: 13px; padding: 11px; border-radius: 8px; color: #52665a; background: #eef0e7; font-size: 10px; line-height: 1.55; animation: dc-appear .2s ease both; }
        .dc-detail p { margin: 0 0 8px; }
        .dc-detail button { padding: 0; border: 0; color: var(--blue); background: transparent; font-size: 9px; font-weight: 800; }
        .dc-card-action { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 14px 0 0; border: 0; color: var(--blue); background: transparent; font-size: 10px; font-weight: 800; }
        .dc-empty { grid-column: 1/-1; padding: 33px; text-align: center; border: 1px dashed #aab4a4; border-radius: 12px; color: #5d6b62; }
        .dc-empty button { margin-top: 10px; border: 0; color: var(--blue); background: transparent; font-size: 11px; font-weight: 800; }
        .dc-season {
          position: relative; display: grid; grid-template-columns: .8fr 1.2fr; min-height: 320px;
          overflow: hidden; color: white; background: var(--blue-deep);
        }
        .dc-season-copy { position: relative; z-index: 1; padding: 38px 34px; }
        .dc-season-copy .dc-overline { color: #e9c77f; }
        .dc-season-copy h2 { max-width: 370px; margin: 12px 0 10px; font: 400 clamp(29px, 3.5vw, 42px)/1.07 Georgia, serif; letter-spacing: -.035em; }
        .dc-season-copy p { max-width: 330px; margin: 0; color: #e8eee7c9; font-size: 11px; line-height: 1.7; }
        .dc-season-link { display: inline-flex; align-items: center; gap: 8px; margin-top: 20px; color: #f1d48f; font-size: 10px; font-weight: 800; }
        .dc-season-image { min-height: 320px; position: relative; }
        .dc-season-image img { width: 100%; height: 100%; position: absolute; inset: 0; object-fit: cover; object-position: 30% 52%; }
        .dc-season-image:after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, var(--blue-deep), transparent 42%), linear-gradient(0deg, #112f3a38, transparent); }
        .dc-season-caption { position: absolute; z-index: 2; right: 18px; bottom: 16px; color: #ffffffe0; font-size: 8px; letter-spacing: .1em; text-transform: uppercase; }
        .dc-season + .dc-section { border-top: 0; }
        .dc-quote-grid { display: grid; grid-template-columns: 1.25fr .75fr; gap: 20px; }
        .dc-quote { min-height: 190px; padding: 25px; border: 1px solid #31473f1c; background: #f9f7ef; }
        .dc-quote:first-child { background: #e9e9dc; }
        .dc-quote-stars { display: flex; gap: 3px; color: var(--clay); }
        .dc-quote blockquote { margin: 16px 0 18px; font: 400 21px/1.32 Georgia, serif; letter-spacing: -.015em; }
        .dc-quote small { color: #758078; font-size: 9px; }
        .dc-quote-side { display: flex; flex-direction: column; justify-content: space-between; padding: 23px; color: white; background: var(--sage); }
        .dc-quote-side svg { color: #f1d48f; }
        .dc-quote-side p { margin: 14px 0; font: 400 18px/1.4 Georgia, serif; }
        .dc-quote-side small { color: #ffffffc9; font-size: 9px; }
        .dc-endnote { display: grid; grid-template-columns: 1.3fr .7fr; gap: 32px; align-items: center; padding: 30px 0 72px; }
        .dc-endnote h2 { max-width: 520px; margin: 8px 0 0; font: 400 clamp(28px, 3.4vw, 43px)/1.08 Georgia, serif; letter-spacing: -.035em; }
        .dc-endnote p { margin: 10px 0 0; max-width: 460px; color: #69776f; font-size: 11px; line-height: 1.7; }
        .dc-endnote-action { justify-self: end; display: inline-flex; align-items: center; gap: 11px; padding: 14px 18px; border-radius: 99px; color: white !important; background: var(--blue); font-size: 10px; font-weight: 800; transition: background .2s ease, transform .2s ease; }
        .dc-endnote-action:hover { background: var(--blue-deep); transform: translateY(-2px); }
        .dc-footer { color: #e1e8df; background: #203e3a; }
        .dc-footer-inner { width: min(1120px, calc(100% - 48px)); margin: auto; padding: 29px 0; display: flex; justify-content: space-between; align-items: center; gap: 20px; }
        .dc-footer-brand { display: flex; align-items: center; gap: 10px; font-size: 11px; font-weight: 800; }
        .dc-footer-brand .dc-brand-mark { width: 30px; height: 30px; color: var(--ink); background: #e1bf73; }
        .dc-footer-copy { color: #d2ddd4b8; font-size: 9px; }
        .dc-footer-nav { display: flex; gap: 18px; }
        .dc-footer-nav a { color: #e1e8df; font-size: 9px; transition: color .2s ease; }
        .dc-footer-nav a:hover { color: #f1d48f; }
        @keyframes dc-appear { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 900px) {
          .dc-topbar { padding-inline: 25px; }
          .dc-nav { gap: 17px; }
          .dc-brand, .dc-top-action { min-width: 150px; }
          .dc-search-grid { grid-template-columns: repeat(3, 1fr); row-gap: 12px; }
          .dc-field:nth-child(3) { border-right: 0; }
          .dc-field:nth-child(4) { padding-left: 6px; }
          .dc-field:nth-child(5) { border-right: 1px solid #deded3; }
          .dc-search-submit { justify-self: stretch; }
          .dc-search-wrap { margin-top: -34px; }
        }
        @media (max-width: 640px) {
          .dc-topbar { height: 61px; padding: 0 17px; }
          .dc-brand { min-width: 0; gap: 8px; }
          .dc-brand-mark { width: 33px; height: 33px; }
          .dc-brand-word { font-size: 13px; }
          .dc-brand-word small { font-size: 8px; }
          .dc-nav, .dc-top-action { display: none; }
          .dc-menu-button { display: grid; place-items: center; }
          .dc-mobile-nav { position: absolute; z-index: 20; left: 0; right: 0; top: 60px; display: flex; flex-direction: column; padding: 8px 18px 14px; background: var(--paper); border-bottom: 1px solid #263d351c; box-shadow: 0 15px 24px #1f393018; }
          .dc-mobile-nav a { padding: 12px 3px; border-bottom: 1px solid #263d3515; color: var(--ink); font-size: 12px; font-weight: 700; }
          .dc-mobile-nav a:last-child { border-bottom: 0; }
          .dc-hero { min-height: 440px; align-items: flex-end; }
          .dc-hero-image { object-position: 34% 50%; }
          .dc-hero::after { background: linear-gradient(0deg, rgba(16,39,34,.83) 0%, rgba(16,39,34,.36) 68%, rgba(16,39,34,.08) 100%); }
          .dc-hero-inner { padding: 74px 22px 65px; }
          .dc-hero-copy { max-width: 100%; }
          .dc-location-tag { padding: 6px 9px; font-size: 8px; }
          .dc-hero h1 { margin-top: 16px; font-size: clamp(43px, 13vw, 59px); max-width: 390px; }
          .dc-hero-copy > p { max-width: 310px; font-size: 12px; line-height: 1.55; }
          .dc-hero-note { margin-top: 15px; font-size: 9px; }
          .dc-hero-aside { display: none; }
          .dc-search-wrap { width: calc(100% - 28px); margin-top: -26px; }
          .dc-search-form { padding: 12px; border-radius: 14px; }
          .dc-search-grid { grid-template-columns: 1fr 1fr; gap: 0; }
          .dc-field { min-height: 58px; padding: 8px 7px; gap: 7px; border-right: 0; border-bottom: 1px solid #deded3; }
          .dc-field:first-child { grid-column: 1 / -1; padding-left: 7px; }
          .dc-field:nth-child(2), .dc-field:nth-child(4) { border-right: 1px solid #deded3; }
          .dc-field:nth-child(3) { border-bottom: 1px solid #deded3; }
          .dc-field:nth-child(4), .dc-field:nth-child(5) { padding-left: 7px; }
          .dc-field:nth-child(5) { border-bottom: 1px solid #deded3; }
          .dc-field-icon { width: 17px; height: 17px; }
          .dc-field label { font-size: 8px; }
          .dc-field select, .dc-field input { font-size: 10px; }
          .dc-field input[type="date"] { font-size: 10px; }
          .dc-search-submit { grid-column: 1 / -1; min-height: 43px; margin-top: 10px; }
          .dc-search-caption { align-items: flex-start; font-size: 8px; line-height: 1.4; }
          .dc-search-caption b { text-align: right; }
          .dc-proof { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 10px; padding: 24px 20px 27px; }
          .dc-proof-item { gap: 7px; font-size: 9px; line-height: 1.25; }
          .dc-proof-item svg { width: 16px; height: 16px; }
          .dc-content { width: calc(100% - 36px); }
          .dc-section { padding: 46px 0; }
          .dc-section-title { margin-bottom: 20px; }
          .dc-section-title h2 { font-size: 32px; }
          .dc-section-title p { font-size: 11px; }
          .dc-index { font-size: 27px; }
          .dc-category-grid { grid-template-columns: 1fr 1fr; }
          .dc-category { min-height: 125px; padding: 15px 13px 14px; border-bottom: 1px solid #3549413b; }
          .dc-category:nth-child(2) { border-right: 0; }
          .dc-category:nth-child(3), .dc-category:nth-child(4) { border-bottom: 0; }
          .dc-category-icon { width: 32px; height: 32px; }
          .dc-category strong { font-size: 19px; }
          .dc-category small { font-size: 9px; }
          .dc-category-arrow { right: 12px; bottom: 15px; width: 15px; }
          .dc-host-section { grid-template-columns: 1fr; gap: 13px; padding: 42px 0 51px; }
          .dc-host-intro { min-height: 0; padding: 0 0 10px; }
          .dc-host-intro:before { top: 0; right: 2px; font-size: 85px; }
          .dc-host-intro h2 { max-width: 320px; font-size: 34px; }
          .dc-host-intro p { font-size: 11px; }
          .dc-chat { padding: 14px; }
          .dc-chat-messages { height: 190px; }
          .dc-question-chip { font-size: 8px; }
          .dc-experience-head { align-items: flex-start; flex-direction: column; }
          .dc-results-note { align-self: flex-start; }
          .dc-card-grid { grid-template-columns: 1fr; gap: 13px; }
          .dc-experience-card { display: grid; grid-template-columns: 39% 61%; }
          .dc-card-photo { height: 100%; min-height: 220px; }
          .dc-card-tag { top: 8px; left: 7px; max-width: calc(100% - 14px); padding: 5px 6px; font-size: 7px; }
          .dc-favorite { top: auto; bottom: 9px; right: 8px; width: 29px; height: 29px; }
          .dc-card-place { left: 8px; bottom: 11px; max-width: 78%; font-size: 8px; line-height: 1.3; }
          .dc-card-body { padding: 13px 11px 11px; }
          .dc-card-body h3 { font-size: 17px; line-height: 1.12; }
          .dc-card-note { font-size: 9px; line-height: 1.5; }
          .dc-card-meta { flex-direction: column; align-items: flex-start; margin-top: 10px; padding-top: 9px; gap: 8px; }
          .dc-meta-items { gap: 7px; flex-wrap: wrap; font-size: 8px; }
          .dc-card-price { display: flex; align-items: baseline; gap: 5px; text-align: left; }
          .dc-card-price small { font-size: 8px; }
          .dc-card-price strong { font-size: 13px; }
          .dc-card-action { padding-top: 11px; font-size: 9px; }
          .dc-detail { font-size: 9px; }
          .dc-season { grid-template-columns: 1fr; }
          .dc-season-copy { padding: 28px 22px; }
          .dc-season-copy h2 { max-width: 290px; font-size: 34px; }
          .dc-season-copy p { font-size: 10px; }
          .dc-season-image { min-height: 220px; }
          .dc-season-image img { object-position: 25% 54%; }
          .dc-season-image:after { background: linear-gradient(0deg, #153f5e4d, transparent 55%); }
          .dc-quote-grid { grid-template-columns: 1fr; }
          .dc-quote { min-height: 0; padding: 20px; }
          .dc-quote blockquote { font-size: 19px; }
          .dc-quote-side { min-height: 150px; }
          .dc-endnote { grid-template-columns: 1fr; gap: 20px; padding: 18px 0 47px; }
          .dc-endnote h2 { font-size: 33px; }
          .dc-endnote p { font-size: 10px; }
          .dc-endnote-action { justify-self: start; }
          .dc-footer-inner { width: calc(100% - 36px); flex-wrap: wrap; gap: 15px; padding: 24px 0; }
          .dc-footer-brand { width: 100%; }
          .dc-footer-nav { gap: 14px; }
          .dc-footer-copy { width: 100%; order: 3; }
        }
        @media (prefers-reduced-motion: reduce) {
          .dc-page *, .dc-page *::before, .dc-page *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; transition-duration: .01ms !important; }
        }
      `}</style>

      <header className="dc-topbar">
        <a className="dc-brand" href="#inicio" aria-label="Visite Cariri, início">
          <span className="dc-brand-mark"><Mountain size={20} strokeWidth={1.8} /></span>
          <span className="dc-brand-word">visite cariri<small>Ceará · Brasil</small></span>
        </a>
        <nav className="dc-nav" aria-label="Navegação principal">
          <a href="#destinos">Destinos</a>
          <a href="#experiencias">Experiências</a>
          <a href="#assistente">Converse com a gente</a>
          <a href="#sobre">Sobre o Cariri</a>
        </nav>
        <div className="dc-top-action"><a href="#busca">Planeje sua visita <ArrowUpRight size={15} /></a></div>
        <button className="dc-menu-button" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen}>
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        {menuOpen && (
          <nav className="dc-mobile-nav" aria-label="Navegação mobile">
            <a href="#destinos" onClick={() => setMenuOpen(false)}>Destinos</a>
            <a href="#experiencias" onClick={() => setMenuOpen(false)}>Experiências</a>
            <a href="#assistente" onClick={() => setMenuOpen(false)}>Converse com a gente</a>
            <a href="#sobre" onClick={() => setMenuOpen(false)}>Sobre o Cariri</a>
          </nav>
        )}
      </header>

      <main>
        <section className="dc-hero" id="inicio">
          <img className="dc-hero-image" src={heroImage} alt="Vista ampla da Chapada do Araripe ao entardecer" />
          <div className="dc-hero-inner">
            <div className="dc-hero-copy">
              <span className="dc-location-tag"><MapPin size={13} /> Geopark Araripe · Ceará</span>
              <h1>O Cariri tem<br />seu próprio <em>tempo.</em></h1>
              <p>Serra, histórias que atravessam gerações e um jeito de receber que fica com você. Vamos descobrir por onde começar?</p>
              <div className="dc-hero-note"><span /> Dicas de quem conhece o caminho</div>
            </div>
          </div>
          <div className="dc-hero-aside"><i /> 7 cidades · infinitas boas histórias</div>
        </section>

        <div className="dc-search-wrap" id="busca">
          <form className="dc-search-form" onSubmit={submitSearch}>
            <div className="dc-search-grid">
              <div className="dc-field">
                <MapPin className="dc-field-icon" size={19} />
                <div className="dc-field-text">
                  <label htmlFor="dc-destination">Destino</label>
                  <select id="dc-destination" value={destination} onChange={(event) => setDestination(event.target.value)}>
                    <option value="">Todo o Cariri</option>
                    <option value="Crato">Crato</option>
                    <option value="Juazeiro">Juazeiro do Norte</option>
                    <option value="Barbalha">Barbalha</option>
                    <option value="Santana">Santana do Cariri</option>
                    <option value="Nova Olinda">Nova Olinda</option>
                  </select>
                </div>
              </div>
              <div className="dc-field">
                <CalendarDays className="dc-field-icon" size={18} />
                <div className="dc-field-text">
                  <label htmlFor="dc-date">Data de ida</label>
                  <input id="dc-date" type="date" min={new Date().toISOString().slice(0, 10)} value={date} onChange={(event) => setDate(event.target.value)} />
                </div>
              </div>
              <div className="dc-field">
                <Sparkles className="dc-field-icon" size={18} />
                <div className="dc-field-text">
                  <label htmlFor="dc-type">Experiência</label>
                  <select id="dc-type" value={experienceType} onChange={(event) => setExperienceType(event.target.value)}>
                    <option value="">Todos os tipos</option>
                    <option value="package">Pacotes</option>
                    <option value="tour">Passeios</option>
                    <option value="hotel">Hospedagem</option>
                    <option value="service">Serviços</option>
                    <option value="cruise">Cruzeiros</option>
                  </select>
                </div>
              </div>
              <div className="dc-field">
                <CreditCard className="dc-field-icon" size={18} />
                <div className="dc-field-text">
                  <label htmlFor="dc-budget">Orçamento</label>
                  <select id="dc-budget" value={budget} onChange={(event) => setBudget(event.target.value)}>
                    <option value="">Qualquer valor</option>
                    <option value="150">Até R$ 150</option>
                    <option value="200">Até R$ 200</option>
                    <option value="300">Até R$ 300</option>
                    <option value="500">Até R$ 500</option>
                  </select>
                </div>
              </div>
              <div className="dc-field">
                <Users className="dc-field-icon" size={18} />
                <div className="dc-field-text">
                  <label htmlFor="dc-passengers">Passageiros</label>
                  <select id="dc-passengers" value={passengers} onChange={(event) => setPassengers(event.target.value)}>
                    <option value="">Qualquer grupo</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count} {count === 1 ? "passageiro" : "passageiros"}</option>)}
                  </select>
                </div>
              </div>
              <button className="dc-search-submit" type="submit"><Search size={15} /> Encontrar experiências</button>
            </div>
            <div className="dc-search-caption">
              <span>Escolha o que importa. O resto a gente descobre junto.</span>
              <b>Exemplos ilustrativos — não representam disponibilidade real.</b>
            </div>
          </form>
        </div>

        <div className="dc-proof" aria-label="Compromissos Visite Cariri">
          <div className="dc-proof-item"><ShieldCheck size={19} /><span>Gente local, de verdade</span></div>
          <div className="dc-proof-item"><Compass size={19} /><span>Roteiros com contexto</span></div>
          <div className="dc-proof-item"><MessageCircle size={19} /><span>Ajuda antes de ir</span></div>
          <div className="dc-proof-item"><Leaf size={19} /><span>Viajar com cuidado</span></div>
        </div>

        <div className="dc-content">
          <section className="dc-section" id="destinos">
            <SectionTitle overline="Um lugar, muitos jeitos" title="Que Cariri combina com você?" copy="Escolha pelo que desperta sua curiosidade. Daqui, cada caminho puxa outro." number="01" />
            <div className="dc-category-grid">
              {categories.map(({ name, caption, icon: Icon, tone }) => (
                <button className={`dc-category ${tone}`} type="button" key={name} onClick={() => {
                  setExperienceType(name === "Cultura" ? "package" : "tour");
                  setSubmitted(true);
                  document.getElementById("experiencias")?.scrollIntoView({ behavior: "smooth" });
                }}>
                  <span className="dc-category-icon"><Icon size={19} /></span>
                  <span><strong>{name}</strong><small>{caption}</small></span>
                  <ArrowUpRight className="dc-category-arrow" size={17} />
                </button>
              ))}
            </div>
          </section>

          <section className="dc-host-section" id="assistente">
            <div className="dc-host-intro">
              <span className="dc-overline">Uma conversa boa abre caminhos</span>
              <h2>Tem dúvida? A gente começa por ela.</h2>
              <p>Pense nesta anfitriã como uma primeira prosa: ela conhece os lugares, entende seu ritmo e dá ideias para você continuar pesquisando.</p>
              <div className="dc-host-stamp"><Sparkles size={15} /> Respostas locais de demonstração</div>
            </div>
            <div className="dc-chat" aria-label="Assistente de viagem demonstrativo">
              <div className="dc-chat-head">
                <div className="dc-chat-person">
                  <span className="dc-chat-avatar"><MessageCircle size={17} /></span>
                  <span><strong>Prosa de viagem</strong><small>Uma anfitriã local, em modo demonstrativo</small></span>
                </div>
                <span className="dc-demo-label">sem IA conectada</span>
              </div>
              <div className="dc-chat-messages" aria-live="polite">
                {messages.map((message, index) => <div className={`dc-message ${message.role === "traveler" ? "traveler" : ""}`} key={`${message.role}-${index}`}>{message.text}</div>)}
              </div>
              <div className="dc-question-chips">
                {quickQuestions.map((prompt) => <button key={prompt} className="dc-question-chip" type="button" onClick={() => askHost(prompt)}>{prompt}</button>)}
              </div>
              <form className="dc-chat-form" onSubmit={(event) => { event.preventDefault(); askHost(); }}>
                <input aria-label="Escreva uma pergunta" placeholder="Por onde você quer começar?" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={handleQuestionKey} />
                <button className="dc-send" type="submit" aria-label="Enviar pergunta"><Send size={15} /></button>
              </form>
              <p className="dc-chat-foot">As sugestões são textos sintéticos para esta demonstração. Confirme detalhes e condições com o anfitrião de cada experiência.</p>
            </div>
          </section>

          <section className="dc-section" id="experiencias">
            <div className="dc-experience-head">
              <SectionTitle
                overline="Para sair do papel"
                title={submitted ? `${results.length} ideias para seu caminho` : "Experiências com sotaque local"}
                copy={submitted
                  ? dateLabel
                    ? `Referência para ${dateLabel}. As experiências são ilustrativas e não têm disponibilidade em tempo real.`
                    : "Ajuste os filtros acima e encontre outro jeito de conhecer a região."
                  : "Uma seleção de demonstração, inspirada no que faz esta região ser tão própria."}
                number="02"
              />
              <span className="dc-results-note">Conteúdo de demonstração</span>
            </div>
            <div className="dc-card-grid">
              {results.length ? results.map((experience) => {
                const Icon = experience.icon;
                const isSaved = saved.includes(experience.id);
                const isExpanded = expanded === experience.id;
                return (
                  <article className="dc-experience-card" key={experience.id}>
                    <div className="dc-card-photo">
                      <img src={heroImage} alt={`Paisagem de referência para ${experience.name}`} style={{ objectPosition: experience.position }} />
                      <span className="dc-card-tag">{experience.kindLabel}</span>
                      <button className={`dc-favorite ${isSaved ? "is-saved" : ""}`} type="button" onClick={() => toggleSaved(experience.id)} aria-label={isSaved ? "Remover dos favoritos" : "Salvar experiência"} aria-pressed={isSaved}>
                        <Heart size={16} fill={isSaved ? "currentColor" : "none"} />
                      </button>
                      <span className="dc-card-place"><MapPin size={12} /> {experience.place}</span>
                    </div>
                    <div className="dc-card-body">
                      <h3>{experience.name}</h3>
                      <p className="dc-card-note">{experience.note}</p>
                      <div className="dc-card-meta">
                        <div className="dc-meta-items">
                          <span><Icon size={13} /> {experience.duration}</span>
                          <span><Users size={13} /> Até {experience.people}</span>
                        </div>
                        <div className="dc-card-price"><small>valor de referência</small><strong>R$ {experience.price}</strong></div>
                      </div>
                      {isExpanded && <div className="dc-detail"><p>Uma ideia de roteiro para imaginar a viagem: saída pela manhã, tempo para ouvir quem conhece a região e pausas para aproveitar sem pressa. Preço e condições são apenas demonstrativos.</p><button type="button" onClick={() => setExpanded(null)}>Fechar detalhes</button></div>}
                      <button className="dc-card-action" type="button" onClick={() => setExpanded(isExpanded ? null : experience.id)}>
                        {isExpanded ? "Ocultar detalhes" : "Conhecer a experiência"} <ArrowRight size={15} />
                      </button>
                    </div>
                  </article>
                );
              }) : (
                <div className="dc-empty">
                  <Compass size={23} />
                  <p>Não achei uma combinação nesta seleção demonstrativa.</p>
                  <button type="button" onClick={() => { setDestination(""); setExperienceType(""); setBudget(""); setPassengers(""); setSubmitted(false); }}>Limpar filtros e recomeçar</button>
                </div>
              )}
            </div>
          </section>

          <section className="dc-season" id="sobre">
            <div className="dc-season-copy">
              <span className="dc-overline">Do nosso jeito, em cada estação</span>
              <h2>Uma serra que muda de cor. E de assunto.</h2>
              <p>Entre o verde depois da chuva e o céu aberto do sertão, a Chapada do Araripe guarda paisagens, fósseis e histórias que merecem tempo.</p>
              <a href="#experiencias" className="dc-season-link">Conheça o território <ArrowRight size={15} /></a>
            </div>
            <div className="dc-season-image">
              <img src={heroImage} alt="Vegetação da Chapada do Araripe e horizonte do sertão" />
              <span className="dc-season-caption">Chapada do Araripe · imagem de referência</span>
            </div>
          </section>

          <section className="dc-section" id="relatos">
            <SectionTitle overline="O que a gente leva de uma viagem" title="O melhor cabe numa boa história." copy="Relatos fictícios, criados para mostrar o espírito de quem viaja com tempo e curiosidade." number="03" />
            <div className="dc-quote-grid">
              <article className="dc-quote">
                <div className="dc-quote-stars" aria-label="Cinco estrelas">{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={13} fill="currentColor" />)}</div>
                <blockquote>“A trilha foi só o começo. O que ficou mesmo foi a conversa com quem faz daquele lugar casa.”</blockquote>
                <small>Relato demonstrativo · Marina, Fortaleza</small>
              </article>
              <article className="dc-quote-side">
                <Leaf size={21} />
                <p>Venha com curiosidade. Vá embora com vontade de voltar.</p>
                <small>Visite Cariri · Ceará</small>
              </article>
            </div>
          </section>

          <section className="dc-endnote">
            <div>
              <span className="dc-overline">Quando bater a vontade</span>
              <h2>O próximo caminho começa numa conversa.</h2>
              <p>Explore os filtros, guarde uma ideia ou pergunte por onde ir. Este protótipo não recebe reservas — é um convite para descobrir.</p>
            </div>
            <a className="dc-endnote-action" href="#busca">Começar a planejar <ArrowDown size={15} /></a>
          </section>
        </div>
      </main>

      <footer className="dc-footer">
        <div className="dc-footer-inner">
          <div className="dc-footer-brand"><span className="dc-brand-mark"><Mountain size={17} /></span><span>Visite Cariri · Ceará</span></div>
          <div className="dc-footer-copy">Proposta visual demonstrativa · Experiências e valores ilustrativos</div>
          <nav className="dc-footer-nav" aria-label="Links da página"><a href="#inicio">Início</a><a href="#destinos">Destinos</a><a href="#assistente">Converse</a><a href="#busca">Pesquisar</a></nav>
        </div>
      </footer>
    </div>
  );
}

export default Discovery;
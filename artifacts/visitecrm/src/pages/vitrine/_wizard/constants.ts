import {
  User,
  ClipboardList,
  Armchair,
  CreditCard,
  Ticket,
  QrCode,
  Tag,
  Building2,
  Banknote,
} from "lucide-react";
import type { ReactNode } from "react";
import { createElement } from "react";

export type Step = "dados" | "revisao" | "assento" | "pagamento" | "confirmado";

export const STEPS: { key: Step; label: string; icon: ReactNode }[] = [
  { key: "dados", label: "Dados", icon: createElement(User, { className: "w-4 h-4" }) },
  { key: "revisao", label: "Revisão", icon: createElement(ClipboardList, { className: "w-4 h-4" }) },
  { key: "assento", label: "Assento", icon: createElement(Armchair, { className: "w-4 h-4" }) },
  { key: "pagamento", label: "Pagamento", icon: createElement(CreditCard, { className: "w-4 h-4" }) },
  { key: "confirmado", label: "Confirmação", icon: createElement(Ticket, { className: "w-4 h-4" }) },
];

export const STEP_ORDER: Step[] = ["dados", "revisao", "assento", "pagamento", "confirmado"];

export const PAYMENT_METHODS_CONFIG = [
  {
    id: "pix",
    label: "PIX",
    description: "Pagamento instantâneo",
    Icon: QrCode,
    color: "text-teal-600",
    bg: "bg-teal-50",
    border: "border-teal-200",
  },
  {
    id: "boleto",
    label: "Boleto Bancário",
    description: "Vencimento em 3 dias úteis",
    Icon: Tag,
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
  },
  {
    id: "credit_card",
    label: "Cartão de Crédito",
    description: "Parcelamento em até 12x",
    Icon: CreditCard,
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
  },
  {
    id: "debit_card",
    label: "Cartão de Débito",
    description: "Pagamento à vista",
    Icon: CreditCard,
    color: "text-purple-600",
    bg: "bg-purple-50",
    border: "border-purple-200",
  },
  {
    id: "transfer",
    label: "Transferência Bancária",
    description: "TED ou DOC",
    Icon: Building2,
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
  },
  {
    id: "cash",
    label: "Dinheiro",
    description: "Pagamento na agência",
    Icon: Banknote,
    color: "text-green-600",
    bg: "bg-green-50",
    border: "border-green-200",
  },
];

export const PAYMENT_LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS_CONFIG.map((m) => [m.id, m.label]),
);

const _BRT = "America/Sao_Paulo";

export function fmtDate(d?: string | null) {
  if (!d) return null;
  const dt = d.length <= 10 ? new Date(d + "T12:00:00") : new Date(d);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: _BRT, day: "2-digit", month: "short", year: "numeric" }).format(dt);
}

export function fmtDateLong(d?: string | null) {
  if (!d) return null;
  const dt = d.length <= 10 ? new Date(d + "T12:00:00") : new Date(d);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: _BRT, day: "2-digit", month: "long", year: "numeric" }).format(dt);
}

export type PublicSeatEntry = {
  number: string;
  row: number;
  col: number;
  floor: number;
  type: string;
  status: string;
};

export type LayoutSeatMap = {
  tripId: string;
  layout: string;
  numberingType?: string;
  floors: number;
  totalSeats: number;
  cols: number;
  seats: PublicSeatEntry[];
};

export const CLICKABLE_SEAT_TYPES = ["seat", "vip", "accessible"];
export const NON_SEAT_TYPES_PUB = ["wc", "stairs", "fridge", "blocked", "empty"];

export function getCellIconPub(type: string, label?: string): string {
  switch (type) {
    case "wc": return "🚽";
    case "stairs": return "🪜";
    case "fridge": return "🧊";
    case "blocked": return "✕";
    case "vip": return "⭐";
    default: return label ?? "";
  }
}

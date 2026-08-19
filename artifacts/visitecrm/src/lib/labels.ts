import { PAYMENT_STATUS, COMMISSION_STATUS, RESERVATION_STATUS, DEAL_STATUS, TRIP_STATUS, EXPENSE_STATUS } from "@workspace/permissions";

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: "PIX",
  credit_card: "Cartão de Crédito",
  debit_card: "Cartão de Débito",
  bank_transfer: "Transferência",
  transfer: "Transferência",
  cash: "Dinheiro",
  boleto: "Boleto",
  installment: "Parcelado",
};

export const TRIP_TYPE_LABELS: Record<string, string> = {
  excursao: "Excursão",
  bate_volta: "Bate-Volta",
  trilha: "Trilha",
  rota: "Rota",
  transfer: "Transfer",
  pacote_fechado: "Pacote Fechado",
  personalizada: "Viagem Personalizada",
  excursion: "Excursão",
  package: "Pacote Fechado",
  custom: "Viagem Personalizada",
  tour: "Passeio",
  cruise: "Cruzeiro",
  hotel: "Hotel",
  service: "Serviço",
};

export const AGE_CATEGORY_LABELS: Record<string, string> = {
  adult: "Adulto",
  child: "Criança",
  senior: "Sênior",
  baby: "Bebê",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  [PAYMENT_STATUS.PENDING]: "Pendente",
  [PAYMENT_STATUS.PAID]: "Pago",
  [PAYMENT_STATUS.OVERDUE]: "Vencido",
  [PAYMENT_STATUS.CANCELLED]: "Cancelado",
  [PAYMENT_STATUS.APPROVED]: "Aprovado",
  [PAYMENT_STATUS.FAILED]: "Falhou",
  [PAYMENT_STATUS.REFUNDED]: "Reembolsado",
  [PAYMENT_STATUS.CHARGED_BACK]: "Estornado",
};

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  [PAYMENT_STATUS.PENDING]: "bg-yellow-100 text-yellow-800",
  [PAYMENT_STATUS.PAID]: "bg-green-100 text-green-800",
  [PAYMENT_STATUS.OVERDUE]: "bg-red-100 text-red-800",
  [PAYMENT_STATUS.CANCELLED]: "bg-gray-100 text-gray-800",
  [PAYMENT_STATUS.APPROVED]: "bg-blue-100 text-blue-800",
  [PAYMENT_STATUS.FAILED]: "bg-red-100 text-red-800",
  [PAYMENT_STATUS.REFUNDED]: "bg-orange-100 text-orange-800",
  [PAYMENT_STATUS.CHARGED_BACK]: "bg-red-100 text-red-800",
};

export const COMMISSION_STATUS_LABELS: Record<string, string> = {
  [COMMISSION_STATUS.PENDING]: "Pendente",
  [COMMISSION_STATUS.APPROVED]: "Aprovada",
  [COMMISSION_STATUS.PAID]: "Paga",
  [COMMISSION_STATUS.CANCELLED]: "Cancelada",
};

export const COMMISSION_STATUS_COLORS: Record<string, string> = {
  [COMMISSION_STATUS.PENDING]: "bg-yellow-100 text-yellow-800",
  [COMMISSION_STATUS.APPROVED]: "bg-blue-100 text-blue-800",
  [COMMISSION_STATUS.PAID]: "bg-green-100 text-green-800",
  [COMMISSION_STATUS.CANCELLED]: "bg-gray-100 text-gray-800",
};

export const RESERVATION_STATUS_LABELS: Record<string, string> = {
  [RESERVATION_STATUS.PENDING]: "Pendente",
  [RESERVATION_STATUS.CONFIRMED]: "Confirmada",
  [RESERVATION_STATUS.CANCELLED]: "Cancelada",
  [RESERVATION_STATUS.REFUNDED]: "Reembolsada",
  [RESERVATION_STATUS.COMPLETED]: "Concluída",
  [RESERVATION_STATUS.FAILED]: "Falhou",
};

export const RESERVATION_STATUS_COLORS: Record<string, string> = {
  [RESERVATION_STATUS.PENDING]: "bg-yellow-100 text-yellow-800",
  [RESERVATION_STATUS.CONFIRMED]: "bg-green-100 text-green-800",
  [RESERVATION_STATUS.CANCELLED]: "bg-gray-100 text-gray-800",
  [RESERVATION_STATUS.REFUNDED]: "bg-orange-100 text-orange-800",
  [RESERVATION_STATUS.COMPLETED]: "bg-blue-100 text-blue-800",
  [RESERVATION_STATUS.FAILED]: "bg-red-100 text-red-800",
};

export const DEAL_STATUS_LABELS: Record<string, string> = {
  [DEAL_STATUS.OPEN]: "Aberto",
  [DEAL_STATUS.WON]: "Ganho",
  [DEAL_STATUS.LOST]: "Perdido",
};

export const DEAL_STATUS_COLORS: Record<string, string> = {
  [DEAL_STATUS.OPEN]: "bg-blue-100 text-blue-800",
  [DEAL_STATUS.WON]: "bg-green-100 text-green-800",
  [DEAL_STATUS.LOST]: "bg-gray-100 text-gray-800",
};

export const TRIP_STATUS_LABELS: Record<string, string> = {
  [TRIP_STATUS.DRAFT]: "Rascunho",
  [TRIP_STATUS.PUBLISHED]: "Publicada",
  [TRIP_STATUS.ACTIVE]: "Ativa",
  [TRIP_STATUS.CONFIRMED]: "Confirmada",
  [TRIP_STATUS.CANCELLED]: "Cancelada",
  [TRIP_STATUS.COMPLETED]: "Concluída",
};

export const TRIP_STATUS_COLORS: Record<string, string> = {
  [TRIP_STATUS.DRAFT]: "bg-gray-100 text-gray-800",
  [TRIP_STATUS.PUBLISHED]: "bg-blue-100 text-blue-800",
  [TRIP_STATUS.ACTIVE]: "bg-green-100 text-green-800",
  [TRIP_STATUS.CONFIRMED]: "bg-emerald-100 text-emerald-800",
  [TRIP_STATUS.CANCELLED]: "bg-red-100 text-red-800",
  [TRIP_STATUS.COMPLETED]: "bg-purple-100 text-purple-800",
};

export const EXPENSE_STATUS_LABELS: Record<string, string> = {
  [EXPENSE_STATUS.PENDING]: "Pendente",
  [EXPENSE_STATUS.PAID]: "Pago",
  [EXPENSE_STATUS.OVERDUE]: "Vencido",
  [EXPENSE_STATUS.CANCELLED]: "Cancelado",
};

export const EXPENSE_STATUS_COLORS: Record<string, string> = {
  [EXPENSE_STATUS.PENDING]: "bg-yellow-100 text-yellow-800",
  [EXPENSE_STATUS.PAID]: "bg-green-100 text-green-800",
  [EXPENSE_STATUS.OVERDUE]: "bg-red-100 text-red-800",
  [EXPENSE_STATUS.CANCELLED]: "bg-gray-100 text-gray-800",
};

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  transport: "Transporte",
  accommodation: "Hospedagem",
  food: "Alimentação",
  marketing: "Marketing",
  administrative: "Administrativo",
  commission: "Comissão",
  other: "Outro",
};

export { TRIP_TYPE_LABELS, AGE_CATEGORY_LABELS } from "@/lib/labels";
import { TRIP_STATUS, EXPENSE_STATUS } from "@workspace/permissions";

export const STATUS_MAP: Record<string, { label: string; color: string }> = {
  [TRIP_STATUS.DRAFT]:     { label: "Rascunho",   color: "bg-gray-100 text-gray-600" },
  [TRIP_STATUS.ACTIVE]:    { label: "Ativa",      color: "bg-green-100 text-green-700" },
  [TRIP_STATUS.PUBLISHED]: { label: "Publicada",  color: "bg-blue-100 text-blue-700" },
  [TRIP_STATUS.CONFIRMED]: { label: "Confirmada", color: "bg-blue-100 text-blue-700" },
  [TRIP_STATUS.COMPLETED]: { label: "Concluída",  color: "bg-purple-100 text-purple-700" },
  [TRIP_STATUS.CANCELLED]: { label: "Cancelada",  color: "bg-red-100 text-red-700" },
};

export const VEHICLE_TYPES = ["Ônibus", "Micro-ônibus", "Van", "Carro", "Outro"];

export const TRIP_TYPES = ["excursao", "bate_volta", "trilha", "rota", "transfer", "pacote_fechado", "personalizada"];

export const DOCUMENT_TYPES = ["RG", "CNH", "PASSAPORTE", "Certidão de Nascimento"] as const;

export const CELL_COLORS: Record<string, string> = {
  seat: "bg-blue-200",
  vip: "bg-amber-300",
  accessible: "bg-green-300",
  wc: "bg-cyan-200",
  stairs: "bg-purple-200",
  fridge: "bg-sky-200",
  blocked: "bg-gray-200",
  empty: "bg-transparent",
};

export const COST_CATEGORIES = ["Transporte", "Hospedagem", "Alimentação", "Guia", "Marketing", "Seguro", "Taxas", "Outros"] as const;

export const COST_STATUS_MAP: Record<string, { label: string; color: string }> = {
  [EXPENSE_STATUS.PENDING]: { label: "Pendente", color: "bg-amber-100 text-amber-700 border-amber-200" },
  [EXPENSE_STATUS.PAID]:    { label: "Pago",     color: "bg-green-100 text-green-700 border-green-200" },
  [EXPENSE_STATUS.OVERDUE]: { label: "Vencido",  color: "bg-red-100 text-red-700 border-red-200" },
};

export const FIXED_COST_CATEGORIES: Record<string, string[]> = {
  "Transporte": ["Fretamento", "Combustível", "Manutenção", "Seguro do veículo", "Outro"],
  "Equipe": ["Motorista (diária)", "Guia turístico", "Coordenador de viagem", "Outro"],
  "Estrutura": ["Hospedagem da equipe", "Alimentação da equipe", "Outro"],
  "Obrigações": ["Seguro da viagem", "Licenças e autorizações", "Taxas administrativas", "Outro"],
  "Marketing": ["Tráfego pago", "Design", "Comissões de vendedores", "Divulgação", "Outro"],
  "Operacional": ["Sistema de som", "Kit primeiros socorros", "Uniformes", "Estacionamentos e pedágios", "Outro"],
};

export const VARIABLE_COST_CATEGORIES: Record<string, string[]> = {
  "Alimentação": ["Alimentação dos passageiros", "Água e lanches", "Kits de viagem", "Outro"],
  "Experiência": ["Ingressos (parques/atrações)", "Passeios opcionais", "Guias locais", "Outro"],
  "Hospedagem": ["Hospedagem por pessoa", "Outro"],
  "Logística": ["Transportes adicionais", "Transfers internos", "Outro"],
  "Extras": ["Brindes", "Taxas ambientais/locais", "Consumos extras", "Outro"],
};

export type ColKey = "name" | "cpf" | "rg" | "birthDate" | "ageCategory" | "boardingLocation" | "whatsapp" | "checkedInAt";

export const ALL_COLS_ON: Record<ColKey, boolean> = {
  name: true, cpf: true, rg: true, birthDate: true, ageCategory: true, boardingLocation: true, whatsapp: true, checkedInAt: true,
};

export const PASSENGER_COLS: { key: ColKey; label: string }[] = [
  { key: "name", label: "Nome" },
  { key: "cpf", label: "CPF" },
  { key: "rg", label: "RG" },
  { key: "birthDate", label: "Nascimento" },
  { key: "ageCategory", label: "Categoria" },
  { key: "boardingLocation", label: "Embarque" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "checkedInAt", label: "Check-in" },
];

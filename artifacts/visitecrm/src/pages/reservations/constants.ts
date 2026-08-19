import { RESERVATION_STATUS, type ReservationStatus } from "@workspace/permissions";

export { PAYMENT_METHOD_LABELS as METHOD_LABELS, TRIP_TYPE_LABELS, AGE_CATEGORY_LABELS } from "@/lib/labels";

export const fmt = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

export const STATUS_COLORS: Record<ReservationStatus | string, string> = {
  [RESERVATION_STATUS.PENDING]: "bg-yellow-100 text-yellow-800 border-yellow-200",
  [RESERVATION_STATUS.CONFIRMED]: "bg-green-100 text-green-800 border-green-200",
  [RESERVATION_STATUS.COMPLETED]: "bg-blue-100 text-blue-800 border-blue-200",
  [RESERVATION_STATUS.CANCELLED]: "bg-red-100 text-red-800 border-red-200",
  [RESERVATION_STATUS.REFUNDED]: "bg-orange-100 text-orange-800 border-orange-200",
  [RESERVATION_STATUS.FAILED]: "bg-red-100 text-red-800 border-red-200",
};

export const STATUS_LABELS: Record<ReservationStatus | string, string> = {
  [RESERVATION_STATUS.PENDING]: "Pendente",
  [RESERVATION_STATUS.CONFIRMED]: "Confirmada",
  [RESERVATION_STATUS.COMPLETED]: "Concluída",
  [RESERVATION_STATUS.CANCELLED]: "Cancelada",
  [RESERVATION_STATUS.REFUNDED]: "Reembolsada",
  [RESERVATION_STATUS.FAILED]: "Falhou",
};

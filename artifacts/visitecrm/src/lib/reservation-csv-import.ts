import { getClientCsvValue, parseBrazilianCsvDate, parseClientCsv } from "./client-csv-import";

export type ReservationImportStatus = "pending" | "confirmed" | "completed" | "cancelled";

export interface ReservationCsvData {
  clientName: string;
  tripName: string;
  departureDate?: string;
  seats: string[];
  totalValue: number;
  paidValue: number;
  paymentMethod?: string;
  installments: number;
  status: ReservationImportStatus;
}

export interface ReservationImportClient {
  id: string;
  name: string;
}

export interface ReservationImportTrip {
  id: string;
  name: string;
  departureDate: string;
}

export interface ResolvedReservationCsvData extends ReservationCsvData {
  clientId: string;
  tripId: string;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseBrazilianMoney(value: string): number | undefined {
  const normalized = value
    .trim()
    .replace(/^r\$\s*/i, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : undefined;
}

function parseSeats(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "0") return [];
  return trimmed
    .split(/[;,|]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function parseInstallments(value: string): number | undefined {
  if (!value.trim()) return 1;
  if (!/^\d+$/.test(value.trim())) return undefined;
  const count = Number(value);
  return count >= 1 && count <= 99 ? count : undefined;
}

function parseStatus(value: string): ReservationImportStatus | undefined {
  const status = normalizeText(value);
  const statusMap: Record<string, ReservationImportStatus> = {
    pending: "pending",
    pendente: "pending",
    confirmed: "confirmed",
    confirmada: "confirmed",
    confirmado: "confirmed",
    completed: "completed",
    concluida: "completed",
    concluido: "completed",
    cancelled: "cancelled",
    cancelada: "cancelled",
    cancelado: "cancelled",
  };
  return statusMap[status];
}

function normalizePaymentMethod(value: string): string | undefined {
  const normalized = normalizeText(value);
  if (!normalized) return undefined;
  const methods: Record<string, string> = {
    pix: "pix",
    dinheiro: "cash",
    cash: "cash",
    boleto: "boleto",
    transferencia: "bank_transfer",
    transferenciabancaria: "bank_transfer",
    banktransfer: "bank_transfer",
    cartaodecredito: "credit_card",
    creditcard: "credit_card",
    cartaodedebito: "debit_card",
    debitcard: "debit_card",
  };
  return methods[normalized] ?? value.trim();
}

export function parseReservationCsv(text: string): string[][] {
  return parseClientCsv(text);
}

export function buildReservationCsvData(
  headers: string[],
  row: string[],
  lineNumber: number,
): { data?: ReservationCsvData; error?: string } {
  const get = (...aliases: string[]) => getClientCsvValue(headers, row, aliases);
  const clientName = get("cliente", "client", "nomecliente");
  const tripName = get("viagem", "trip", "nomeviagem");
  const departureDateRaw = get("saida", "datadesaida", "datasaida", "departuredate");
  const totalRaw = get("valortotal", "valortotalr", "total");
  const paidRaw = get("valorpago", "pagor", "pago", "paidvalue");
  const statusRaw = get("status", "situacao");

  if (!clientName) return { error: `Linha ${lineNumber}: cliente é obrigatório` };
  if (!tripName) return { error: `Linha ${lineNumber}: viagem é obrigatória` };

  const departureDate = departureDateRaw ? parseBrazilianCsvDate(departureDateRaw) : undefined;
  if (departureDateRaw && !departureDate) return { error: `Linha ${lineNumber}: data de saída inválida` };

  const totalValue = parseBrazilianMoney(totalRaw);
  if (totalValue == null || totalValue < 0) return { error: `Linha ${lineNumber}: valor total inválido` };
  const paidValue = paidRaw ? parseBrazilianMoney(paidRaw) : 0;
  if (paidValue == null || paidValue < 0) return { error: `Linha ${lineNumber}: valor pago inválido` };

  const installments = parseInstallments(get("parcelas", "installments"));
  if (!installments) return { error: `Linha ${lineNumber}: parcelas deve ser um número entre 1 e 99` };

  const status = parseStatus(statusRaw || "pending");
  if (!status) return { error: `Linha ${lineNumber}: status inválido` };

  return {
    data: {
      clientName,
      tripName,
      departureDate,
      seats: parseSeats(get("assentos", "seats")),
      totalValue,
      paidValue,
      paymentMethod: normalizePaymentMethod(get("formadepagamento", "metododepagamento", "paymentmethod")),
      installments,
      status,
    },
  };
}

export function resolveReservationCsvData(
  data: ReservationCsvData,
  clients: ReservationImportClient[],
  trips: ReservationImportTrip[],
  lineNumber: number,
): { data?: ResolvedReservationCsvData; error?: string } {
  const clientMatches = clients.filter(client => normalizeText(client.name) === normalizeText(data.clientName));
  if (clientMatches.length === 0) return { error: `Linha ${lineNumber}: cliente "${data.clientName}" não foi encontrado` };
  if (clientMatches.length > 1) return { error: `Linha ${lineNumber}: há mais de um cliente com o nome "${data.clientName}"` };

  const tripMatches = trips.filter(trip => {
    if (normalizeText(trip.name) !== normalizeText(data.tripName)) return false;
    return !data.departureDate || trip.departureDate.slice(0, 10) === data.departureDate;
  });
  if (tripMatches.length === 0) {
    const suffix = data.departureDate ? ` em ${data.departureDate.split("-").reverse().join("/")}` : "";
    return { error: `Linha ${lineNumber}: viagem "${data.tripName}"${suffix} não foi encontrada` };
  }
  if (tripMatches.length > 1) return { error: `Linha ${lineNumber}: há mais de uma viagem com esse nome; informe a data de saída` };

  return { data: { ...data, clientId: clientMatches[0].id, tripId: tripMatches[0].id } };
}
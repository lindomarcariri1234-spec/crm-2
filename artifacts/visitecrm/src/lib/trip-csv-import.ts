import type { CreateTripBody } from "@workspace/api-client-react";
import {
  getClientCsvValue,
  parseBrazilianCsvDate,
  parseClientCsv,
  splitClientCsvList,
} from "./client-csv-import";
import { formatBRLPlain } from "@workspace/shared";
import type { Trip } from "@workspace/api-client-react";

export { parseClientCsv as parseTripCsv };

export const TRIP_CSV_HEADERS = [
  "Nome", "Destino", "Cidade de Destino", "Estado de Destino", "Data de Saída",
  "Data de Retorno", "Horário de Saída", "Horário de Retorno", "Preço Adulto",
  "Preço Criança", "Preço Sênior", "Capacidade", "Tipo", "Categoria",
  "Cidade de Origem", "Estado de Origem", "Pontos de Embarque", "Inclusões",
  "Exclusões", "Tipo de Veículo", "Placa", "Motorista", "Guia", "Organizador", "Status",
];

function formatCsvDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = value.split("T")[0];
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}

function formatCsvMoney(value: number | null | undefined): string {
  return value == null ? "" : formatBRLPlain(value);
}

function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildTripCsvHeader(): string {
  return TRIP_CSV_HEADERS.map(escapeCsvCell).join(",");
}

export function buildTripCsvRow(trip: Trip): string[] {
  return [
    trip.name,
    trip.destination,
    trip.destinationCity,
    trip.destinationState,
    formatCsvDate(trip.departureDate),
    formatCsvDate(trip.returnDate),
    trip.departureTime ?? "",
    trip.returnTime ?? "",
    formatCsvMoney(trip.priceAdult),
    formatCsvMoney(trip.priceChild),
    formatCsvMoney(trip.priceSenior),
    String(trip.totalCapacity),
    trip.type,
    trip.category,
    trip.originCity ?? "",
    trip.originState ?? "",
    (trip.boardingPoints ?? []).map((point) => point.name).join("; "),
    trip.inclusions.join("; "),
    trip.exclusions.join("; "),
    trip.vehicleType ?? "",
    trip.vehiclePlate ?? "",
    trip.driverName ?? "",
    trip.tourGuide ?? "",
    trip.tripOrganizer ?? "",
    trip.status,
  ];
}

export function buildTripCsvRows(trips: Trip[]): string {
  return trips
    .map(buildTripCsvRow)
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

export function buildTripsCsv(trips: Trip[]): string {
  const rows = buildTripCsvRows(trips);
  return rows ? `${buildTripCsvHeader()}\n${rows}` : buildTripCsvHeader();
}

function parseBrazilianNumber(value: string): number | undefined {
  const normalized = value.trim().replace(/[R$\s]/g, "");
  if (!normalized) return undefined;
  const hasComma = normalized.includes(",");
  const numeric = hasComma
    ? normalized.replace(/\./g, "").replace(",", ".")
    : normalized.replace(/,/g, "");
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value.replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTime(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^(\d{1,2})[:h](\d{2})$/i);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function normalizeStatus(value: string): CreateTripBody["status"] {
  const status = value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (status === "ativa" || status === "active") return "active";
  if (status === "publicada" || status === "published") return "published";
  if (status === "confirmada" || status === "confirmed") return "confirmed";
  if (status === "cancelada" || status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "concluida" || status === "completed") return "completed";
  return "draft";
}

function isValidDate(value: string | undefined): value is string {
  if (!value) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function buildTripCsvData(
  headers: string[],
  row: string[],
  rowNumber: number,
): { data?: CreateTripBody; error?: string } {
  const get = (...aliases: string[]) => getClientCsvValue(headers, row, aliases);
  const name = get("nome", "name", "viagem", "trip");
  const destination = get("destino", "destination");
  const destinationCity = get("cidade de destino", "cidadedestino", "destinationcity", "cidade");
  const destinationState = get("estado de destino", "estadodestino", "destinationstate", "uf", "estado");
  const departureDate = parseBrazilianCsvDate(get("data de saída", "datadesaida", "departuredate", "saida"));
  const priceAdult = parseBrazilianNumber(get("preço adulto", "precoadulto", "priceadult", "preço", "preco", "valor"));

  if (!name) return { error: `Linha ${rowNumber}: nome da viagem é obrigatório` };
  if (!destination) return { error: `Linha ${rowNumber}: destino é obrigatório` };
  if (!destinationCity) return { error: `Linha ${rowNumber}: cidade de destino é obrigatória` };
  if (!destinationState) return { error: `Linha ${rowNumber}: estado de destino é obrigatório` };
  if (!isValidDate(departureDate)) return { error: `Linha ${rowNumber}: data de saída inválida` };
  if (priceAdult == null || priceAdult < 0) return { error: `Linha ${rowNumber}: preço adulto inválido` };

  const returnDate = parseBrazilianCsvDate(get("data de retorno", "dataderetorno", "returndate", "retorno"));
  if (returnDate && !isValidDate(returnDate)) return { error: `Linha ${rowNumber}: data de retorno inválida` };

  const departureTimeRaw = get("horário de saída", "horariodesaida", "departuretime", "hora de saída", "horadesaida");
  const returnTimeRaw = get("horário de retorno", "horarioderetorno", "returntime", "hora de retorno", "horaderetorno");
  const departureTime = parseTime(departureTimeRaw);
  const returnTime = parseTime(returnTimeRaw);
  if (departureTimeRaw && !departureTime) return { error: `Linha ${rowNumber}: horário de saída inválido` };
  if (returnTimeRaw && !returnTime) return { error: `Linha ${rowNumber}: horário de retorno inválido` };

  const boardingPoints = splitClientCsvList(get("pontos de embarque", "pontosdeembarque", "boardingpoints", "embarques"))
    .map((point, index) => ({ id: `csv-${rowNumber}-${index + 1}`, name: point }));

  return {
    data: {
      name,
      description: get("descrição", "descricao", "description") || undefined,
      destination,
      destinationCity,
      destinationState: destinationState.toUpperCase(),
      originCity: get("cidade de origem", "cidadeorigem", "origincity") || undefined,
      originState: get("estado de origem", "estadoorigem", "originstate")?.toUpperCase() || undefined,
      type: get("tipo", "type") || "excursao",
      category: get("categoria", "category") || "standard",
      departureDate,
      returnDate,
      departureTime,
      returnTime,
      totalCapacity: parsePositiveInteger(get("capacidade", "capacidade total", "totalcapacity", "lugares"), 46),
      priceAdult,
      priceChild: parseBrazilianNumber(get("preço criança", "preco crianca", "precochild", "pricechild")),
      priceSenior: parseBrazilianNumber(get("preço sênior", "preco senior", "precosenior", "pricesenior")),
      inclusions: splitClientCsvList(get("inclusões", "inclusoes", "inclusions")),
      exclusions: splitClientCsvList(get("exclusões", "exclusoes", "exclusions")),
      boardingPoints: boardingPoints.length ? boardingPoints : undefined,
      vehicleType: get("tipo de veículo", "tipodeveiculo", "vehicletype") || undefined,
      vehiclePlate: get("placa", "placa do veículo", "placadoveiculo", "vehicleplate") || undefined,
      driverName: get("motorista", "drivername") || undefined,
      tourGuide: get("guia", "guia turístico", "guiaturistico", "tourguide") || undefined,
      tripOrganizer: get("organizador", "organizador da viagem", "triporganizer") || undefined,
      status: normalizeStatus(get("status", "situação", "situacao")),
      seatLayout: get("layout de assentos", "layoutdeassentos", "seatlayout") || "2x2",
    },
  };
}
import * as XLSX from "xlsx";
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

function cleanImportedValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/""/g, "\"").trim();
  }
  return trimmed;
}

function parseTripDate(value: string): string | undefined {
  const cleaned = cleanImportedValue(value);
  const isoDate = cleaned.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
  return isoDate ? isoDate[1] : parseBrazilianCsvDate(cleaned);
}

function parseJsonArray(value: string): unknown[] | undefined {
  const cleaned = cleanImportedValue(value);
  if (!cleaned) return undefined;
  try {
    const parsed: unknown = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseTripList(value: string): string[] {
  const parsed = parseJsonArray(value);
  if (parsed) {
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(Boolean);
  }
  return splitClientCsvList(cleanImportedValue(value));
}

function parseBoardingPoints(
  value: string,
  rowNumber: number,
): Array<{ id: string; name: string; time?: string; address?: string }> {
  const parsed = parseJsonArray(value);
  if (parsed) {
    return parsed.flatMap((item, index) => {
      if (typeof item === "string" && item.trim()) {
        return [{ id: `csv-${rowNumber}-${index + 1}`, name: item.trim() }];
      }
      if (!item || typeof item !== "object") return [];
      const point = item as { name?: unknown; time?: unknown; address?: unknown };
      if (typeof point.name !== "string" || !point.name.trim()) return [];
      return [{
        id: `csv-${rowNumber}-${index + 1}`,
        name: point.name.trim(),
        ...(typeof point.time === "string" && point.time.trim() ? { time: point.time.trim() } : {}),
        ...(typeof point.address === "string" && point.address.trim() ? { address: point.address.trim() } : {}),
      }];
    });
  }
  return splitClientCsvList(cleanImportedValue(value))
    .map((point, index) => ({ id: `csv-${rowNumber}-${index + 1}`, name: point }));
}

export interface ParsedTripFile {
  headers: string[];
  rows: string[][];
}

export async function parseTripFile(file: File): Promise<ParsedTripFile> {
  if (/\.xlsx?$/i.test(file.name)) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames.find(name =>
      name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().includes("viag"),
    ) ?? workbook.SheetNames[0];
    const sheetRows = sheetName
      ? XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], {
        header: 1,
        defval: "",
        raw: false,
        dateNF: "dd/mm/yyyy",
      })
      : [];
    if (sheetRows.length < 2) throw new Error("O arquivo precisa conter cabeçalho e ao menos uma viagem.");
    return {
      headers: sheetRows[0].map(cell => String(cell ?? "").trim()),
      rows: sheetRows
        .slice(1)
        .map(row => row.map(cell => String(cell ?? "").trim()))
        .filter(row => row.some(cell => cell)),
    };
  }

  const csvRows = parseClientCsv(await file.text());
  if (csvRows.length < 2) throw new Error("O arquivo precisa conter cabeçalho e ao menos uma viagem.");
  return {
    headers: csvRows[0],
    rows: csvRows.slice(1).filter(row => row.some(cell => cell.trim())),
  };
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
  const normalized = cleanImportedValue(value).replace(/[R$\s]/g, "");
  if (!normalized) return undefined;
  const hasComma = normalized.includes(",");
  const numeric = hasComma
    ? normalized.replace(/\./g, "").replace(",", ".")
    : normalized.replace(/,/g, "");
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(cleanImportedValue(value).replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTime(value: string): string | undefined {
  const trimmed = cleanImportedValue(value);
  if (!trimmed) return undefined;
  const match = trimmed.match(/^(\d{1,2})[:h](\d{2})$/i);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function normalizeStatus(value: string): CreateTripBody["status"] {
  const status = cleanImportedValue(value).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
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
  const departureDate = parseTripDate(get("data de saída", "datadesaida", "departuredate", "saida"));
  const priceAdult = parseBrazilianNumber(get("preço adulto", "precoadulto", "priceadult", "preço", "preco", "valor"));

  if (!name) return { error: `Linha ${rowNumber}: nome da viagem é obrigatório` };
  if (!destination) return { error: `Linha ${rowNumber}: destino é obrigatório` };
  if (!destinationCity) return { error: `Linha ${rowNumber}: cidade de destino é obrigatória` };
  if (!destinationState) return { error: `Linha ${rowNumber}: estado de destino é obrigatório` };
  if (!isValidDate(departureDate)) return { error: `Linha ${rowNumber}: data de saída inválida` };
  if (priceAdult == null || priceAdult < 0) return { error: `Linha ${rowNumber}: preço adulto inválido` };

  const returnDate = parseTripDate(get("data de retorno", "dataderetorno", "returndate", "retorno"));
  if (returnDate && !isValidDate(returnDate)) return { error: `Linha ${rowNumber}: data de retorno inválida` };

  const departureTimeRaw = get("horário de saída", "horariodesaida", "departuretime", "hora de saída", "horadesaida");
  const returnTimeRaw = get("horário de retorno", "horarioderetorno", "returntime", "hora de retorno", "horaderetorno");
  const departureTime = parseTime(departureTimeRaw);
  const returnTime = parseTime(returnTimeRaw);
  if (departureTimeRaw && !departureTime) return { error: `Linha ${rowNumber}: horário de saída inválido` };
  if (returnTimeRaw && !returnTime) return { error: `Linha ${rowNumber}: horário de retorno inválido` };

  const boardingPoints = parseBoardingPoints(get("pontos de embarque", "pontosdeembarque", "boardingpoints", "embarques"), rowNumber);
  const itinerary = parseJsonArray(get("itinerário", "itinerario", "itinerary"));
  const gallery = parseTripList(get("galeria", "gallery"));
  const videos = parseTripList(get("vídeos", "videos"));

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
      inclusions: parseTripList(get("inclusões", "inclusoes", "inclusions")),
      exclusions: parseTripList(get("exclusões", "exclusoes", "exclusions")),
      boardingPoints: boardingPoints.length ? boardingPoints : undefined,
      vehicleType: get("tipo de veículo", "tipodeveiculo", "vehicletype") || undefined,
      vehiclePlate: get("placa", "placa do veículo", "placadoveiculo", "vehicleplate") || undefined,
      driverName: get("motorista", "drivername") || undefined,
      tourGuide: get("guia", "guia turístico", "guiaturistico", "tourguide") || undefined,
      tripOrganizer: get("organizador", "organizador da viagem", "triporganizer") || undefined,
      driver1Cpf: get("cpf do motorista", "driver1cpf") || undefined,
      driver1Cnh: get("cnh do motorista", "driver1cnh") || undefined,
      driver1CnhCategory: get("categoria cnh do motorista", "driver1cnhcategory") || undefined,
      driver1CnhExpiry: get("validade cnh do motorista", "driver1cnhexpiry") || undefined,
      driver2Name: get("segundo motorista", "driver2name") || undefined,
      driver2Cpf: get("cpf do segundo motorista", "driver2cpf") || undefined,
      driver2Cnh: get("cnh do segundo motorista", "driver2cnh") || undefined,
      driver2CnhCategory: get("categoria cnh do segundo motorista", "driver2cnhcategory") || undefined,
      driver2CnhExpiry: get("validade cnh do segundo motorista", "driver2cnhexpiry") || undefined,
      tourGuideCpf: get("cpf do guia", "tourguidecpf") || undefined,
      tourGuideRegistration: get("registro do guia", "tourguideregistration") || undefined,
      gallery: gallery.length ? gallery : undefined,
      videos: videos.length ? videos : undefined,
      itinerary,
      status: normalizeStatus(get("status", "situação", "situacao")),
      seatLayout: get("layout de assentos", "layoutdeassentos", "seatlayout") || "2x2",
    },
  };
}
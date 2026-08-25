import type { CreateTripBody } from "@workspace/api-client-react";
import {
  getClientCsvValue,
  parseBrazilianCsvDate,
  parseClientCsv,
  splitClientCsvList,
} from "./client-csv-import";
import { formatBRLPlain } from "@workspace/shared";
import type { Trip } from "@workspace/api-client-react";
import { readXlsxRows } from "./spreadsheet-import";

export { parseClientCsv as parseTripCsv };

export const TRIP_CSV_HEADERS = [
  "Nome", "Destino", "Cidade de Destino", "Estado de Destino", "Data de Saída",
  "Data de Retorno", "Horário de Saída", "Horário de Retorno", "Preço Adulto",
  "Preço Criança", "Preço Sênior", "Capacidade", "Tipo", "Categoria",
  "Cidade de Origem", "Estado de Origem", "Pontos de Embarque", "Inclusões",
  "Exclusões", "Tipo de Veículo", "Placa", "Motorista", "Guia", "Organizador", "Status",
];

export interface ParsedTripFile {
  headers: string[];
  rows: string[][];
}

function formatCsvDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = value.split("T")[0];
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}

function formatCsvMoney(value: number | null | undefined): string {
  return value == null ? "" : formatBRLPlain(value);
}
function parseJsonArray(value: string, field: string, rowNumber: number): { value?: unknown[]; error?: string } {
  const parsed = parseJsonValue(value, field, rowNumber);
  if (parsed.error) return { error: parsed.error };
  if (parsed.value == null) return {};
  if (!Array.isArray(parsed.value)) return { error: `Linha ${rowNumber}: ${field} deve ser uma lista JSON` };
  return { value: parsed.value };
}

function normalizeImportedBoardingPoints(value: string, rowNumber: number): {
  value?: Array<{ id: string; name: string; time: string; address: string }>;
  error?: string;
} {
  if (!value.trim().startsWith("[")) {
    const points = splitClientCsvList(value).map((name, index) => ({
      id: `csv-${rowNumber}-${index + 1}`,
      name,
      time: "",
      address: "",
    }));
    return { value: points.length ? points : undefined };
  }
  const parsed = parseJsonArray(value, "pontos de embarque", rowNumber);
  if (parsed.error) return { error: parsed.error };
  if (!parsed.value) return {};
  const points: Array<{ id: string; name: string; time: string; address: string }> = [];
  for (const [index, item] of parsed.value.entries()) {
    if (!item || typeof item !== "object") {
      return { error: `Linha ${rowNumber}: pontos de embarque contém um item inválido` };
    }
    const point = item as Record<string, unknown>;
    if (typeof point.name !== "string" || !point.name.trim()) {
      return { error: `Linha ${rowNumber}: ponto de embarque sem nome` };
    }
    if (point.time != null && typeof point.time !== "string") {
      return { error: `Linha ${rowNumber}: horário de embarque inválido` };
    }
    if (point.address != null && typeof point.address !== "string") {
      return { error: `Linha ${rowNumber}: endereço de embarque inválido` };
    }
    points.push({
      id: `csv-${rowNumber}-${index + 1}`,
      name: point.name.trim(),
      time: typeof point.time === "string" ? point.time.trim() : "",
      address: typeof point.address === "string" ? point.address.trim() : "",
    });
  }
  return { value: points.length ? points : undefined };
}
export async function parseTripFile(file: File): Promise<ParsedTripFile> {
  if (/\.xlsx$/i.test(file.name)) {
    const sheetRows = await readXlsxRows(await file.arrayBuffer(), name =>
      name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().includes("viag"),
    );
    if (sheetRows.length < 2) throw new Error("O arquivo precisa conter cabeçalho e ao menos uma viagem.");
    return {
      headers: sheetRows[0],
      rows: sheetRows
        .slice(1)
        .filter(row => row.some(cell => cell)),
    };
  }

  if (!/\.csv$/i.test(file.name)) {
    throw new Error("Formato não suportado. Envie um arquivo CSV ou XLSX.");
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
  const normalized = value.trim().replace(/^"(.*)"$/s, "$1").replace(/[R$\s]/g, "");
  if (!normalized) return undefined;
  const hasComma = normalized.includes(",");
  const numeric = hasComma
    ? normalized.replace(/\./g, "").replace(",", ".")
    : normalized.replace(/,/g, "");
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePositiveInteger(value: string, fallback?: number): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
function parseTime(value: string): string | undefined {
  const trimmed = value.trim().replace(/^"(.*)"$/s, "$1");
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

function parseBoolean(value: string, fallback?: boolean): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "sim", "s", "yes"].includes(normalized)) return true;
  if (["false", "0", "nao", "não", "n", "no"].includes(normalized)) return false;
  return undefined;
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
  const departureDate = normalizeDate(get("data de saída", "datadesaida", "departuredate", "saida"));
  const priceAdultRaw = get("preço adulto", "precoadulto", "priceadult", "preço", "preco", "valor");
  const priceAdult = parseBrazilianNumber(priceAdultRaw);
  const isFullExport = headers.some((header) => {
    const normalized = header
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return normalized === "id" || normalized === "tenantid";
  });

  if (!name) return { error: `Linha ${rowNumber}: nome da viagem é obrigatório` };
  if (!destination) return { error: `Linha ${rowNumber}: destino é obrigatório` };
  if (!destinationCity) return { error: `Linha ${rowNumber}: cidade de destino é obrigatória` };
  if (!destinationState) return { error: `Linha ${rowNumber}: estado de destino é obrigatório` };
  if (!isValidDate(departureDate)) return { error: `Linha ${rowNumber}: data de saída inválida` };
  if (priceAdult == null || priceAdult < 0) return { error: `Linha ${rowNumber}: preço adulto inválido` };

  const returnDate = normalizeDate(get("data de retorno", "dataderetorno", "returndate", "retorno"));
  if (returnDate && !isValidDate(returnDate)) return { error: `Linha ${rowNumber}: data de retorno inválida` };
  const registrationDeadlineRaw = get("prazo de inscrição", "prazodeinscricao", "registrationdeadline");
  const registrationDeadline = normalizeDate(registrationDeadlineRaw);
  if (registrationDeadlineRaw && !isValidDate(registrationDeadline)) return { error: `Linha ${rowNumber}: prazo de inscrição inválido` };

  const departureTimeRaw = get("horário de saída", "horariodesaida", "departuretime", "hora de saída", "horadesaida");
  const returnTimeRaw = get("horário de retorno", "horarioderetorno", "returntime", "hora de retorno", "horaderetorno");
  const departureTime = parseTime(departureTimeRaw);
  const returnTime = parseTime(returnTimeRaw);
  if (departureTimeRaw && !departureTime) return { error: `Linha ${rowNumber}: horário de saída inválido` };
  if (returnTimeRaw && !returnTime) return { error: `Linha ${rowNumber}: horário de retorno inválido` };

  const priceChildRaw = get("preço criança", "preco crianca", "precochild", "pricechild");
  const priceInfantRaw = get("preço bebê", "preco bebe", "precoinfant", "priceinfant");
  const priceSeniorRaw = get("preço sênior", "preco senior", "precosenior", "pricesenior");
  const reservationFeeRaw = get("taxa de reserva", "taxadereserva", "reservationfee");
  const priceChild = parseBrazilianNumber(priceChildRaw);
  const priceInfant = parseBrazilianNumber(priceInfantRaw);
  const priceSenior = parseBrazilianNumber(priceSeniorRaw);
  const reservationFee = parseBrazilianNumber(reservationFeeRaw);
  if (priceChildRaw && (priceChild == null || priceChild < 0)) return { error: `Linha ${rowNumber}: preço criança inválido` };
  if (priceInfantRaw && (priceInfant == null || priceInfant < 0)) return { error: `Linha ${rowNumber}: preço bebê inválido` };
  if (priceSeniorRaw && (priceSenior == null || priceSenior < 0)) return { error: `Linha ${rowNumber}: preço sênior inválido` };
  if (reservationFeeRaw && (reservationFee == null || reservationFee < 0)) return { error: `Linha ${rowNumber}: taxa de reserva inválida` };

  const type = normalizeOptionalString(get("tipo", "type")) ?? "excursao";
  const category = normalizeOptionalString(get("categoria", "category")) ?? "standard";
  const capacityRaw = get("capacidade", "capacidade total", "totalcapacity", "lugares");
  const totalCapacity = parsePositiveInteger(capacityRaw, isFullExport ? undefined : 46);
  if (totalCapacity == null) return { error: `Linha ${rowNumber}: capacidade inválida` };
  if (isFullExport && !IMPORTABLE_TRIP_TYPES.has(type)) return { error: `Linha ${rowNumber}: tipo de viagem inválido` };
  if (!isFullExport && !type) return { error: `Linha ${rowNumber}: tipo de viagem inválido` };
  if (!category) return { error: `Linha ${rowNumber}: categoria inválida` };

  const departurePointsResult = normalizeImportedBoardingPoints(
    get("pontos de embarque", "pontosdeembarque", "boardingpoints", "embarques"),
    rowNumber,
  );
  if (departurePointsResult.error) return { error: departurePointsResult.error };

  const inclusionsResult = parseStringList(get("inclusões", "inclusoes", "inclusions"), "inclusões", rowNumber);
  if (inclusionsResult.error) return { error: inclusionsResult.error };
  const exclusionsResult = parseStringList(get("exclusões", "exclusoes", "exclusions"), "exclusões", rowNumber);
  if (exclusionsResult.error) return { error: exclusionsResult.error };
  const itineraryResult = normalizeImportedItems(get("itinerário", "itinerario", "itinerary"), "itinerary", rowNumber);
  if (itineraryResult.error) return { error: itineraryResult.error };
  const fixedCostsResult = normalizeImportedItems(get("custos fixos", "custosfixos", "fixedcosts"), "fixed costs", rowNumber);
  if (fixedCostsResult.error) return { error: fixedCostsResult.error };
  const variableCostsResult = normalizeImportedItems(get("custos variáveis", "custosvariaveis", "variablecosts"), "variable costs", rowNumber);
  if (variableCostsResult.error) return { error: variableCostsResult.error };

  const galleryResult = parseStringList(get("galeria", "gallery"), "galeria", rowNumber);
  if (galleryResult.error) return { error: galleryResult.error };
  const videosResult = parseStringList(get("vídeos", "videos"), "vídeos", rowNumber);
  if (videosResult.error) return { error: videosResult.error };

  const showSeatMapRaw = get("mostrar mapa de assentos", "mostrarmapadeassentos", "showseatmap");
  const showSeatMap = parseBoolean(showSeatMapRaw);
  if (showSeatMapRaw && showSeatMap == null) return { error: `Linha ${rowNumber}: mostrar mapa de assentos inválido` };
  const isPublicRaw = get("público", "publico", "ispublic");
  const isFeaturedRaw = get("destaque", "isfeatured");
  const isAvailableInShopRaw = get("disponível na loja", "disponivelnaloja", "isavailableinshop");
  const isPublic = parseBoolean(isPublicRaw);
  const isFeatured = parseBoolean(isFeaturedRaw);
  const isAvailableInShop = parseBoolean(isAvailableInShopRaw);
  if (isPublicRaw && isPublic == null) return { error: `Linha ${rowNumber}: público inválido` };
  if (isFeaturedRaw && isFeatured == null) return { error: `Linha ${rowNumber}: destaque inválido` };
  if (isAvailableInShopRaw && isAvailableInShop == null) return { error: `Linha ${rowNumber}: disponível na loja inválido` };

  const freeOrganizersRaw = get("organizadores gratuitos", "organizadoresgratuitos", "freeorganizers");
  const freeGuidesRaw = get("guias gratuitos", "guiasgratuitos", "freeguides");
  const freeOrganizers = parseNonNegativeInteger(freeOrganizersRaw);
  const freeGuides = parseNonNegativeInteger(freeGuidesRaw);
  if (freeOrganizersRaw && (freeOrganizers == null || freeOrganizers > 2)) return { error: `Linha ${rowNumber}: organizadores gratuitos inválidos` };
  if (freeGuidesRaw && (freeGuides == null || freeGuides > 2)) return { error: `Linha ${rowNumber}: guias gratuitos inválidos` };
  const rawStatus = get("status", "situação", "situacao");
  const status = normalizeStatus(rawStatus);
  const normalizedRawStatus = rawStatus.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const knownStatusAliases = new Set([
    ...IMPORTABLE_TRIP_STATUSES,
    "ativa", "publicada", "confirmada", "cancelada", "concluida", "canceled",
  ]);
  if (isFullExport && normalizedRawStatus && !knownStatusAliases.has(normalizedRawStatus)) {
    return { error: `Linha ${rowNumber}: status inválido` };
  }
  const driver1CnhExpiryRaw = get("validade cnh motorista 1", "validadecnhmotorista1", "driver1cnhexpiry");
  const driver2CnhExpiryRaw = get("validade cnh motorista 2", "validadecnhmotorista2", "driver2cnhexpiry");
  const driver1CnhExpiry = normalizeDate(driver1CnhExpiryRaw);
  const driver2CnhExpiry = normalizeDate(driver2CnhExpiryRaw);
  if (driver1CnhExpiryRaw && !isValidDate(driver1CnhExpiry)) return { error: `Linha ${rowNumber}: validade da CNH do motorista 1 inválida` };
  if (driver2CnhExpiryRaw && !isValidDate(driver2CnhExpiry)) return { error: `Linha ${rowNumber}: validade da CNH do motorista 2 inválida` };

  return {
    data: {
      name,
      description: get("descrição", "descricao", "description") || undefined,
      shortDescription: normalizeOptionalString(get("descrição curta", "descricaocurta", "shortdescription")),
      destination,
      destinationCity,
      destinationState: destinationState.toUpperCase(),
      destinationCountry: normalizeOptionalString(get("país de destino", "paisdedestino", "destinationcountry")),
      originCity: get("cidade de origem", "cidadeorigem", "origincity") || undefined,
      originState: get("estado de origem", "estadoorigem", "originstate")?.toUpperCase() || undefined,
      type,
      category,
      departureDate,
      returnDate,
      registrationDeadline,
      departureTime,
      returnTime,
      totalCapacity,
      priceAdult,
      priceChild,
      priceInfant,
      priceSenior,
      reservationFee,
      coverImage: normalizeOptionalString(get("imagem de capa", "imagemdecapa", "coverimage")),
      inclusions: inclusionsResult.value,
      exclusions: exclusionsResult.value,
      boardingPoints: departurePointsResult.value,
      itinerary: itineraryResult.value,
      fixedCosts: fixedCostsResult.value,
      variableCosts: variableCostsResult.value,
      gallery: galleryResult.value,
      videos: videosResult.value,
      isPublic,
      isFeatured,
      isAvailableInShop,
      vehicleType: get("tipo de veículo", "tipodeveiculo", "vehicletype") || undefined,
      vehiclePlate: get("placa", "placa do veículo", "placadoveiculo", "vehicleplate") || undefined,
      driverName: get("motorista", "drivername") || undefined,
      driverCnh: get("cnh do motorista", "cnhdomotorista", "drivercnh") || undefined,
      driverPhone: get("telefone do motorista", "telefonedomotorista", "driverphone") || undefined,
      tourGuide: get("guia", "guia turístico", "guiaturistico", "tourguide") || undefined,
      tripOrganizer: get("organizador", "organizador da viagem", "triporganizer") || undefined,
      driver1Cpf: normalizeOptionalString(get("motorista 1 cpf", "motorista1cpf", "driver1cpf")),
      driver1Cnh: normalizeOptionalString(get("motorista 1 cnh", "motorista1cnh", "driver1cnh")),
      driver1CnhCategory: normalizeOptionalString(get("categoria cnh motorista 1", "categoriacnhmotorista1", "driver1cnhcategory")),
      driver1CnhExpiry,
      driver2Name: normalizeOptionalString(get("motorista 2", "motorista2", "driver2name")),
      driver2Cpf: normalizeOptionalString(get("motorista 2 cpf", "motorista2cpf", "driver2cpf")),
      driver2Cnh: normalizeOptionalString(get("motorista 2 cnh", "motorista2cnh", "driver2cnh")),
      driver2CnhCategory: normalizeOptionalString(get("categoria cnh motorista 2", "categoriacnhmotorista2", "driver2cnhcategory")),
      driver2CnhExpiry,
      tourGuideCpf: normalizeOptionalString(get("cpf do guia", "cpfdoguia", "tourguidecpf")),
      tourGuideRegistration: normalizeOptionalString(get("registro do guia", "registrodoguia", "tourguideregistration")),
      manifestNumber: normalizeOptionalString(get("número do manifesto", "numerodomanifesto", "manifestnumber")),
      cancellationPolicy: normalizeOptionalString(get("política de cancelamento", "politicadecancelamento", "cancellationpolicy")),
      metaTitle: normalizeOptionalString(get("título meta", "titulometa", "metatitle")),
      metaDescription: normalizeOptionalString(get("descrição meta", "descricaometa", "metadescription")),
      freeOrganizers: freeOrganizersRaw ? freeOrganizers : undefined,
      freeGuides: freeGuidesRaw ? freeGuides : undefined,
      status,
      seatLayout: get("layout de assentos", "layoutdeassentos", "seatlayout") || "2x2",
      showSeatMap,
    },
  };
}

function normalizeImportedItems(
  value: string,
  field: "itinerary" | "fixed costs" | "variable costs",
  rowNumber: number,
): { value?: unknown[]; error?: string } {
  const parsed = parseJsonArray(value, field, rowNumber);
  if (parsed.error || !parsed.value) return parsed;
  return {
    value: parsed.value.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const copy = { ...(item as Record<string, unknown>) };
      delete copy.id;
      if (field !== "itinerary") copy.id = `csv-${rowNumber}-${index + 1}`;
      return copy;
    }),
  };
}

function parseStringList(value: string, field: string, rowNumber: number): { value: string[]; error?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { value: [] };
  if (trimmed.startsWith("[")) {
    const parsed = parseJsonValue(trimmed, field, rowNumber);
    if (parsed.error) return { value: [], error: parsed.error };
    if (!Array.isArray(parsed.value) || parsed.value.some((item) => typeof item !== "string")) {
      return { value: [], error: `Linha ${rowNumber}: ${field} deve ser uma lista de textos` };
    }
    return { value: parsed.value.map((item) => item.trim()).filter(Boolean) };
  }
  return { value: splitClientCsvList(trimmed) };
}

function normalizeDate(value: string): string | undefined {
  const trimmed = value.trim().replace(/^"(.*)"$/s, "$1");
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  return parseBrazilianCsvDate(trimmed);
}

const IMPORTABLE_TRIP_TYPES = new Set([
  "excursao", "bate_volta", "trilha", "rota", "transfer", "pacote_fechado", "personalizada",
]);

function normalizeOptionalString(value: string): string | undefined {
  const trimmed = value.trim().replace(/^"(.*)"$/s, "$1").trim();
  return trimmed || undefined;
}

function parseJsonValue(value: string, field: string, rowNumber: number): { value?: unknown; error?: string } {
  const trimmed = value.trim().replace(/^"(.*)"$/s, "$1");
  if (!trimmed) return {};
  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    return { error: `Linha ${rowNumber}: ${field} contém JSON inválido` };
  }
}

const IMPORTABLE_TRIP_STATUSES = new Set([
  "draft", "published", "active", "confirmed", "cancelled", "completed",
]);

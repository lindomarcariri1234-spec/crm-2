import * as XLSX from "xlsx";
import { getClientCsvValue, parseBrazilianCsvDate, parseClientCsv } from "./client-csv-import";

export interface ManifestPassengerRow {
  line: number;
  reservationNumber: string;
  tripName: string;
  departureDate: string;
  name: string;
  cpf?: string;
  birthDate?: string;
  ageCategory?: string;
  seatNumber?: string;
  boardingPoint?: string;
  phone?: string;
  status?: string;
}

export interface ParsedManifest {
  headers: string[];
  rawRows: string[][];
  rows: ManifestPassengerRow[];
  errors: string[];
}

function normalizeCpf(value: string): string | undefined {
  const digits = value.replace(/\D/g, "");
  return digits ? digits : undefined;
}

function normalizeCategory(value: string): string | undefined {
  const normalized = value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  if (!normalized) return undefined;
  if (["adulto", "adulta", "adult"].includes(normalized)) return "adult";
  if (["crianca", "child"].includes(normalized)) return "child";
  if (["bebe", "baby", "colo"].includes(normalized)) return "baby";
  if (["idoso", "idosa", "senior"].includes(normalized)) return "senior";
  return undefined;
}

function readManifestRows(data: ArrayBuffer | string, fileName: string): string[][] {
  if (/\.csv$/i.test(fileName)) return parseClientCsv(String(data));
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames.find(name =>
    name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().includes("manifesto antt"),
  ) ?? workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
    dateNF: "dd/mm/yyyy",
  }).map(row => row.map(cell => String(cell ?? "").trim()));
}

export function buildManifestImport(headers: string[], rawRows: string[][]): ParsedManifest {
  const rows: ManifestPassengerRow[] = [];
  const errors: string[] = [];

  rawRows.forEach((row, index) => {
    const line = index + 2;
    const get = (...aliases: string[]) => getClientCsvValue(headers, row, aliases);
    const reservationNumber = get("nreserva", "numerodareserva", "reserva");
    const tripName = get("viagem", "trip");
    const departureDateRaw = get("datadesaida", "datasaida", "saida", "departuredate");
    const name = get("passageiro", "nome", "passenger");
    const departureDate = parseBrazilianCsvDate(departureDateRaw);
    const categoryRaw = get("categoria", "category");
    const ageCategory = normalizeCategory(categoryRaw);

    if (!reservationNumber) errors.push(`Linha ${line}: Nº Reserva é obrigatório.`);
    else if (!tripName) errors.push(`Linha ${line}: Viagem é obrigatória.`);
    else if (!departureDate) errors.push(`Linha ${line}: Data de Saída inválida.`);
    else if (!name) errors.push(`Linha ${line}: Passageiro é obrigatório.`);
    else if (categoryRaw && !ageCategory) errors.push(`Linha ${line}: categoria "${categoryRaw}" não é reconhecida.`);
    else {
      const birthRaw = get("nascimento", "datanascimento", "birthdate");
      const birthDate = birthRaw ? parseBrazilianCsvDate(birthRaw) : undefined;
      if (birthRaw && !birthDate) {
        errors.push(`Linha ${line}: Nascimento inválido.`);
      } else {
        rows.push({
          line,
          reservationNumber: reservationNumber.trim(),
          tripName: tripName.trim(),
          departureDate,
          name: name.trim(),
          cpf: normalizeCpf(get("cpf")),
          birthDate,
          ageCategory,
          seatNumber: get("poltrona", "assento", "seatnumber") || undefined,
          boardingPoint: get("pontodeembarque", "embarque", "boardingpoint") || undefined,
          phone: get("telefone", "phone", "whatsapp") || undefined,
          status: get("status") || undefined,
        });
      }
    }
  });

  return { headers, rawRows, rows, errors };
}

export async function parseManifestFile(file: File): Promise<ParsedManifest> {
  const data = /\.csv$/i.test(file.name) ? await file.text() : await file.arrayBuffer();
  const matrix = readManifestRows(data, file.name);
  if (matrix.length < 2) throw new Error("O arquivo precisa conter cabeçalho e ao menos uma linha de passageiro.");
  const [headers, ...rawRows] = matrix;
  return buildManifestImport(headers, rawRows.filter(row => row.some(cell => cell.trim())));
}
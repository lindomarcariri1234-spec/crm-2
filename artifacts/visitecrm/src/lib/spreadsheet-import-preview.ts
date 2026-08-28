import { parseClientCsv } from "./client-csv-import";
import { readXlsxRows } from "./spreadsheet-import";

export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 2_000;

export interface LocalSpreadsheetPreview {
  headers: string[];
  rows: string[][];
  normalizedHeaders: string[];
}

export function normalizeSpreadsheetHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function readFile(file: File, mode: "text"): Promise<string>;
function readFile(file: File, mode: "arrayBuffer"): Promise<ArrayBuffer>;
function readFile(file: File, mode: "text" | "arrayBuffer"): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => {
      if (mode === "text") resolve(String(reader.result ?? ""));
      else if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("Não foi possível ler a planilha XLSX."));
    };
    if (mode === "text") reader.readAsText(file, "UTF-8");
    else reader.readAsArrayBuffer(file);
  });
}

export async function readSpreadsheetPreview(file: File): Promise<LocalSpreadsheetPreview> {
  if (file.size === 0) throw new Error("O arquivo está vazio.");
  if (file.size > IMPORT_MAX_FILE_BYTES) throw new Error("O arquivo excede o limite de 5 MB.");

  let matrix: string[][];
  if (/\.csv$/i.test(file.name)) {
    matrix = parseClientCsv(await readFile(file, "text"));
  } else if (/\.xlsx$/i.test(file.name)) {
    matrix = await readXlsxRows(await readFile(file, "arrayBuffer"), () => true);
  } else {
    throw new Error("Formato não aceito. Envie um arquivo CSV ou XLSX.");
  }

  if (matrix.length < 2) throw new Error("O arquivo deve conter cabeçalho e pelo menos uma linha de dados.");
  const headers = matrix[0]!.map(value => value.trim());
  if (headers.some(header => !header)) throw new Error("O cabeçalho contém uma coluna sem nome.");
  const normalizedHeaders = headers.map(normalizeSpreadsheetHeader);
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new Error("O cabeçalho contém colunas duplicadas.");
  }
  const rows = matrix.slice(1).filter(row => row.some(cell => cell.trim()));
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new Error(`O arquivo excede o limite de ${IMPORT_MAX_ROWS.toLocaleString("pt-BR")} linhas.`);
  }
  return { headers, rows, normalizedHeaders };
}
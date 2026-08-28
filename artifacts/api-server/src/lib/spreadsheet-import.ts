import ExcelJS from "exceljs";
import { validateCPF } from "./cpf.js";

export const SPREADSHEET_IMPORT_VERSION = 1 as const;
export const SPREADSHEET_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const SPREADSHEET_MAX_ROWS = 2_000;

export type SpreadsheetEntity = "clients" | "trips" | "reservations";
export type CellRow = Record<string, string>;

export interface ParsedSpreadsheetRow {
  line: number;
  cells: CellRow;
}

export interface ParsedSpreadsheet {
  headers: string[];
  rows: ParsedSpreadsheetRow[];
}

export interface ContractColumn {
  key: string;
  label: string;
  required: boolean;
  format: string;
  example: string;
}

const columns: Record<SpreadsheetEntity, ContractColumn[]> = {
  clients: [
    { key: "id_externo", label: "ID Externo", required: true, format: "texto único e estável", example: "CLI-001" },
    { key: "nome", label: "Nome", required: true, format: "texto", example: "Maria da Silva" },
    { key: "whatsapp", label: "WhatsApp", required: true, format: "telefone BR com DDD", example: "(88) 99999-9999" },
    { key: "cpf", label: "CPF", required: true, format: "11 dígitos, com ou sem máscara", example: "123.456.789-09" },
    { key: "email", label: "E-mail", required: false, format: "e-mail", example: "maria@example.com" },
    { key: "data_nascimento", label: "Data de Nascimento", required: false, format: "DD/MM/AAAA", example: "20/05/1985" },
    { key: "telefone", label: "Telefone", required: false, format: "telefone BR com DDD", example: "(88) 3333-4444" },
    { key: "cidade", label: "Cidade", required: false, format: "texto", example: "Juazeiro do Norte" },
    { key: "estado", label: "Estado", required: false, format: "UF com 2 letras", example: "CE" },
    { key: "status", label: "Status", required: false, format: "active | inactive | lead | prospect", example: "active" },
    { key: "observacoes", label: "Observações", required: false, format: "texto", example: "Prefere contato à tarde" },
  ],
  trips: [
    { key: "id_externo", label: "ID Externo", required: true, format: "texto único e estável", example: "VIA-001" },
    { key: "nome", label: "Nome", required: true, format: "texto", example: "Excursão para Natal" },
    { key: "destino", label: "Destino", required: true, format: "texto", example: "Praias do RN" },
    { key: "cidade_destino", label: "Cidade de Destino", required: true, format: "texto", example: "Natal" },
    { key: "estado_destino", label: "Estado de Destino", required: true, format: "UF com 2 letras", example: "RN" },
    { key: "data_saida", label: "Data de Saída", required: true, format: "DD/MM/AAAA", example: "15/12/2026" },
    { key: "data_retorno", label: "Data de Retorno", required: false, format: "DD/MM/AAAA", example: "20/12/2026" },
    { key: "capacidade", label: "Capacidade", required: true, format: "inteiro positivo", example: "46" },
    { key: "preco_adulto", label: "Preço Adulto", required: true, format: "R$ 1.890,00 ou 1890,00", example: "1.890,00" },
    { key: "preco_crianca", label: "Preço Criança", required: false, format: "valor brasileiro", example: "950,00" },
    { key: "tipo", label: "Tipo", required: false, format: "excursao | pacote | bate_volta", example: "excursao" },
    { key: "categoria", label: "Categoria", required: false, format: "standard | premium | luxury", example: "standard" },
    { key: "status", label: "Status", required: false, format: "draft | published | active | confirmed | cancelled | completed", example: "draft" },
  ],
  reservations: [
    { key: "id_externo", label: "ID Externo", required: true, format: "texto único e estável", example: "RES-001" },
    { key: "cliente_id_externo", label: "ID Externo do Cliente", required: true, format: "ID importado anteriormente", example: "CLI-001" },
    { key: "viagem_id_externo", label: "ID Externo da Viagem", required: true, format: "ID importado anteriormente", example: "VIA-001" },
    { key: "status", label: "Status", required: true, format: "pending | confirmed | completed | cancelled", example: "pending" },
    { key: "valor_total", label: "Valor Total", required: true, format: "valor brasileiro", example: "1.890,00" },
    { key: "valor_pago", label: "Valor Pago", required: false, format: "valor brasileiro", example: "500,00" },
    { key: "assentos", label: "Assentos", required: false, format: "lista separada por ponto e vírgula", example: "12;13" },
    { key: "forma_pagamento", label: "Forma de Pagamento", required: false, format: "pix | cash | boleto | bank_transfer | credit_card | debit_card", example: "pix" },
    { key: "parcelas", label: "Parcelas", required: false, format: "inteiro de 1 a 99", example: "3" },
    { key: "observacoes", label: "Observações", required: false, format: "texto", example: "Reserva migrada" },
  ],
};

export function getSpreadsheetContract(entity: SpreadsheetEntity) {
  return {
    entity,
    version: SPREADSHEET_IMPORT_VERSION,
    columns: columns[entity],
    requiredHeaders: columns[entity].filter(column => column.required).map(column => column.key),
    formats: ["csv", "xlsx"],
    maxFileBytes: SPREADSHEET_MAX_FILE_BYTES,
    maxRows: SPREADSHEET_MAX_ROWS,
  };
}

function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const firstLine = source.split("\n", 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(cell.trim()); cell = "";
    } else if (!quoted && char === "\n") {
      row.push(cell.trim());
      if (row.some(value => value !== "")) rows.push(row);
      row = []; cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV inválido: há uma célula com aspas não fechadas.");
  row.push(cell.trim());
  if (row.some(value => value !== "")) rows.push(row);
  return rows;
}

function xlsxCellValue(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) {
    return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if ("result" in value && value.result != null) return String(value.result).trim();
  if ("richText" in value) return value.richText.map(part => part.text).join("").trim();
  if ("text" in value) return value.text.trim();
  return "";
}

export async function parseSpreadsheet(filename: string, content: Buffer): Promise<ParsedSpreadsheet> {
  if (content.byteLength === 0) throw new Error("O arquivo está vazio.");
  if (content.byteLength > SPREADSHEET_MAX_FILE_BYTES) throw new Error("O arquivo excede o limite de 5 MB.");
  const extension = filename.toLowerCase().split(".").pop();
  let matrix: string[][];
  if (extension === "csv") {
    matrix = parseCsv(content.toString("utf8"));
  } else if (extension === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as never);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("A planilha XLSX não possui abas.");
    matrix = [];
    sheet.eachRow({ includeEmpty: false }, row => {
      const values: string[] = [];
      for (let index = 1; index <= Math.max(sheet.actualColumnCount, row.cellCount); index++) {
        values.push(xlsxCellValue(row.getCell(index).value));
      }
      if (values.some(value => value !== "")) matrix.push(values);
    });
  } else {
    throw new Error("Formato não aceito. Envie um arquivo CSV ou XLSX.");
  }
  if (matrix.length < 2) throw new Error("O arquivo deve conter cabeçalho e pelo menos uma linha de dados.");
  if (matrix.length - 1 > SPREADSHEET_MAX_ROWS) throw new Error(`O arquivo excede o limite de ${SPREADSHEET_MAX_ROWS.toLocaleString("pt-BR")} linhas.`);
  const rawHeaders = matrix[0]!;
  const headers = rawHeaders.map(normalizeHeader);
  if (headers.some(header => !header)) throw new Error("O cabeçalho contém uma coluna sem nome.");
  if (new Set(headers).size !== headers.length) throw new Error("O cabeçalho contém colunas duplicadas.");
  return {
    headers,
    rows: matrix.slice(1).map((values, index) => ({
      line: index + 2,
      cells: Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() ?? ""])),
    })),
  };
}

export function validateHeaders(entity: SpreadsheetEntity, headers: string[]): string[] {
  const contract = getSpreadsheetContract(entity);
  return contract.requiredHeaders
    .filter(header => !headers.includes(header))
    .map(header => `Coluna obrigatória ausente: ${columns[entity].find(column => column.key === header)?.label ?? header}.`);
}

export function parseBrazilDate(value: string, label: string): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`${label} deve usar o formato DD/MM/AAAA.`);
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T12:00:00.000-03:00`);
  if (date.getFullYear() !== Number(year) || date.getMonth() + 1 !== Number(month) || date.getDate() !== Number(day)) {
    throw new Error(`${label} é inválida.`);
  }
  return date;
}

export function parseBrazilMoney(value: string, label: string, optional = false): number | null {
  if (!value && optional) return null;
  if (!/^(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})$|^(?:R\$\s*)?\d+(?:,\d{2})$/.test(value.trim())) {
    throw new Error(`${label} deve usar o formato brasileiro, por exemplo 1.234,56.`);
  }
  const parsed = Number(value.replace(/R\$\s*/g, "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} deve ser um valor não negativo.`);
  return parsed;
}

export function parsePhone(value: string, label: string, optional = false): string | null {
  if (!value && optional) return null;
  const digits = value.replace(/\D/g, "");
  const localDigits = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (localDigits.length < 10 || localDigits.length > 11) throw new Error(`${label} deve conter DDD e 10 ou 11 dígitos.`);
  return digits.startsWith("55") ? `+${digits}` : `+55${localDigits}`;
}

export function parseCpf(value: string): string {
  try {
    return validateCPF(value);
  } catch {
    throw new Error("CPF inválido.");
  }
}

export function requireText(cells: CellRow, key: string, label: string, max = 500): string {
  const value = cells[key]?.trim() ?? "";
  if (!value) throw new Error(`${label} é obrigatório.`);
  if (value.length > max) throw new Error(`${label} excede ${max} caracteres.`);
  return value;
}

export function optionalText(cells: CellRow, key: string, max = 2_000): string | null {
  const value = cells[key]?.trim() ?? "";
  if (!value) return null;
  if (value.length > max) throw new Error(`O campo ${key} excede ${max} caracteres.`);
  return value;
}

export function createCsvTemplate(entity: SpreadsheetEntity): string {
  const contract = columns[entity];
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return `\uFEFF${contract.map(column => quote(column.key)).join(",")}\n${contract.map(column => quote(column.example)).join(",")}\n`;
}

export async function createXlsxTemplate(entity: SpreadsheetEntity): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(entity);
  const contract = columns[entity];
  sheet.addRow(contract.map(column => column.key));
  sheet.addRow(contract.map(column => column.example));
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column, index) => {
    column.width = Math.max(14, contract[index]!.label.length + 4, contract[index]!.example.length + 2);
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
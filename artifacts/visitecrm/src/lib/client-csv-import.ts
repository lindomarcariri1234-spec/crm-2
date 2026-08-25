function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function detectDelimiter(text: string): "," | ";" {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === "\n") {
      break;
    } else if (!quoted && char === ",") {
      commas += 1;
    } else if (!quoted && char === ";") {
      semicolons += 1;
    }
  }

  return semicolons > commas ? ";" : ",";
}

export function parseClientCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!quoted && char === "\n") {
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  const normalizedHeaders = headers.map(normalizeHeader);
  const normalizedAliases = aliases.map(normalizeHeader);

  for (const alias of normalizedAliases) {
    const exactIndex = normalizedHeaders.findIndex((header) => header === alias);
    if (exactIndex >= 0) return exactIndex;
  }

  for (const alias of normalizedAliases) {
    const partialIndex = normalizedHeaders.findIndex((header) => header.includes(alias));
    if (partialIndex >= 0) return partialIndex;
  }

  return -1;
}

export function getClientCsvValue(headers: string[], row: string[], aliases: string[]): string {
  const index = findColumnIndex(headers, aliases);
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

export function parseBrazilianCsvDate(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return undefined;

  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function splitClientCsvList(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function generatedImportedClientEmail(cpf: string): string {
  return `cliente-${cpf.replace(/\D/g, "")}@importado.invalid`;
}
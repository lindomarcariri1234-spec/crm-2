import ExcelJS from "exceljs";

function formatSpreadsheetDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

function formatSpreadsheetValue(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return formatSpreadsheetDate(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value !== "object") return "";

  const cellValue = value as {
    richText?: Array<{ text?: string }>;
    text?: string;
    result?: unknown;
    hyperlink?: string;
  };
  if (cellValue.richText) {
    return cellValue.richText.map(part => part.text ?? "").join("").trim();
  }
  if (cellValue.result !== undefined) return formatSpreadsheetValue(cellValue.result);
  if (cellValue.text) return cellValue.text.trim();
  if (cellValue.hyperlink) return cellValue.hyperlink.trim();
  return "";
}

export async function readXlsxRows(
  data: ArrayBuffer,
  preferredSheet: (name: string) => boolean,
): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);

  const worksheet = workbook.worksheets.find(sheet => preferredSheet(sheet.name))
    ?? workbook.worksheets[0];
  if (!worksheet) return [];

  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: true }, row => {
    const values: string[] = [];
    for (let column = 1; column <= worksheet.actualColumnCount; column += 1) {
      values.push(formatSpreadsheetValue(row.getCell(column).value));
    }
    rows.push(values);
  });
  return rows;
}
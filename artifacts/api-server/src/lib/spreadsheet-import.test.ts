import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  createCsvTemplate,
  createXlsxTemplate,
  getSpreadsheetContract,
  parseBrazilDate,
  parseBrazilMoney,
  parsePhone,
  parseSpreadsheet,
  validateHeaders,
} from "./spreadsheet-import.js";

describe("contratos de importação por planilha", () => {
  it("gera modelos CSV e XLSX versionados que o próprio leitor aceita", async () => {
    for (const entity of ["clients", "trips", "reservations"] as const) {
      const contract = getSpreadsheetContract(entity);
      expect(contract.version).toBe(1);
      expect(contract.requiredHeaders).toContain("id_externo");

      const csv = await parseSpreadsheet(`modelo_${entity}.csv`, Buffer.from(createCsvTemplate(entity)));
      expect(validateHeaders(entity, csv.headers)).toEqual([]);
      expect(csv.rows).toHaveLength(1);

      const xlsx = await parseSpreadsheet(`modelo_${entity}.xlsx`, await createXlsxTemplate(entity));
      expect(validateHeaders(entity, xlsx.headers)).toEqual([]);
      expect(xlsx.rows).toHaveLength(1);
    }
  });

  it("lê datas de células XLSX como datas civis brasileiras", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("clients");
    sheet.addRow(["id_externo", "nome", "whatsapp", "cpf", "data_nascimento"]);
    sheet.addRow(["CLI-1", "Maria", "(88) 99999-9999", "529.982.247-25", new Date(1985, 4, 20)]);
    const parsed = await parseSpreadsheet("clientes.xlsx", Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(parsed.rows[0]?.cells.data_nascimento).toBe("20/05/1985");
  });

  it("rejeita datas, valores e telefones fora dos formatos declarados", () => {
    expect(() => parseBrazilDate("2026-12-15", "Data")).toThrow("DD/MM/AAAA");
    expect(() => parseBrazilDate("31/02/2026", "Data")).toThrow("inválida");
    expect(() => parseBrazilMoney("1234.56", "Valor")).toThrow("formato brasileiro");
    expect(() => parsePhone("9999-9999", "WhatsApp")).toThrow("DDD");
  });

  it("impõe os limites de formato, tamanho e quantidade de linhas", async () => {
    await expect(parseSpreadsheet("arquivo.pdf", Buffer.from("x"))).rejects.toThrow("CSV ou XLSX");
    await expect(parseSpreadsheet("arquivo.csv", Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow("5 MB");
    const oversized = `id_externo,nome\n${Array.from({ length: 2001 }, (_, index) => `${index},Nome`).join("\n")}`;
    await expect(parseSpreadsheet("arquivo.csv", Buffer.from(oversized))).rejects.toThrow("2.000 linhas");
  });
});
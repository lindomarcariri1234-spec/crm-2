import { describe, expect, it } from "vitest";
import {
  generatedImportedClientEmail,
  getClientCsvValue,
  parseBrazilianCsvDate,
  parseClientCsv,
  splitClientCsvList,
} from "../lib/client-csv-import.js";

describe("client CSV import helpers", () => {
  it("supports Brazilian headers, blank e-mails, and semicolon-separated files", () => {
    const [headers, row] = parseClientCsv(
      "Nome;E-mail;WhatsApp;CPF;Nascimento;Observações\n" +
      '"Jaíne de Meneses";;"88993426671";"62326404386";"15/08/1990";"Cliente; VIP"',
    );

    expect(getClientCsvValue(headers, row, ["nome"])).toBe("Jaíne de Meneses");
    expect(getClientCsvValue(headers, row, ["email"])).toBe("");
    expect(getClientCsvValue(headers, row, ["observacoes"])).toBe("Cliente; VIP");
    expect(parseBrazilianCsvDate(getClientCsvValue(headers, row, ["nascimento"]))).toBe("1990-08-15");
  });

  it("preserves quoted commas and creates a safe internal address when e-mail is absent", () => {
    const [headers, row] = parseClientCsv(
      'Nome,E-mail,WhatsApp,CPF,Tags\n"José, da Silva",,88991234567,12345678909,"vip; família"',
    );

    expect(getClientCsvValue(headers, row, ["nome"])).toBe("José, da Silva");
    expect(splitClientCsvList(getClientCsvValue(headers, row, ["tags"]))).toEqual(["vip", "família"]);
    expect(generatedImportedClientEmail("123.456.789-09")).toBe("cliente-12345678909@importado.invalid");
  });
});
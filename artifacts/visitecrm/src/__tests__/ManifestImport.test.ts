import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseManifestFile } from "@/lib/manifest-import";

describe("Manifest XLSX import", () => {
  it("reads the ANTT worksheet and maps its passenger data", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Manifesto ANTT");
    worksheet.addRows([
      ["Nº Reserva", "Viagem", "Data de Saída", "Passageiro", "CPF", "Poltrona"],
      ["RES-001", "Excursão Natal", "15/12/2026", "Ana Costa", "123.456.789-00", "12"],
    ]);
    const workbookData = await workbook.xlsx.writeBuffer();
    const file = new File(
      [workbookData],
      "manifesto.xlsx",
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    );

    await expect(parseManifestFile(file)).resolves.toMatchObject({
      headers: ["Nº Reserva", "Viagem", "Data de Saída", "Passageiro", "CPF", "Poltrona"],
      rows: [{
        reservationNumber: "RES-001",
        tripName: "Excursão Natal",
        departureDate: "2026-12-15",
        name: "Ana Costa",
        cpf: "12345678900",
        seatNumber: "12",
      }],
      errors: [],
    });
  });
});
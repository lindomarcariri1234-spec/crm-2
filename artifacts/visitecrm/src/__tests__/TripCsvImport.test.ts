import { describe, expect, it } from "vitest";
import { buildTripCsvData, parseTripCsv } from "@/lib/trip-csv-import";

describe("trip CSV import", () => {
  it("parses Brazilian separators, quoted values, dates and currency", () => {
    const csv = [
      "Nome;Destino;Cidade de Destino;Estado de Destino;Data de Saída;Preço Adulto;Capacidade;Pontos de Embarque",
      '"Férias, Natal";Praias;Natal;RN;15/12/2026;"R$ 1.890,50";46;"Praça Central; Rodoviária"',
    ].join("\n");
    const rows = parseTripCsv(csv);
    const result = buildTripCsvData(rows[0], rows[1], 2);

    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      name: "Férias, Natal",
      departureDate: "2026-12-15",
      priceAdult: 1890.5,
      totalCapacity: 46,
      boardingPoints: [
        { id: "csv-2-1", name: "Praça Central" },
        { id: "csv-2-2", name: "Rodoviária" },
      ],
    });
  });

  it("reports missing required fields and invalid times by line", () => {
    const headers = ["Nome", "Destino", "Cidade de Destino", "Estado de Destino", "Data de Saída", "Preço Adulto"];
    expect(buildTripCsvData(headers, ["Viagem", "", "Natal", "RN", "15/12/2026", "100"], 4).error)
      .toContain("destino é obrigatório");
    expect(buildTripCsvData(headers, ["Viagem", "Praias", "Natal", "RN", "15/12/2026", "100"], 4).data)
      .toBeDefined();

    const timeHeaders = [...headers, "Horário de Saída"];
    expect(buildTripCsvData(timeHeaders, ["Viagem", "Praias", "Natal", "RN", "15/12/2026", "100", "25:00"], 5).error)
      .toContain("horário de saída inválido");
  });
});
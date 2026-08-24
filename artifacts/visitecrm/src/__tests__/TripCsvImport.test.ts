import { describe, expect, it } from "vitest";
import { buildTripCsvData, buildTripsCsv, parseTripCsv, TRIP_CSV_HEADERS } from "@/lib/trip-csv-import";

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

  it("exports the import template columns with Brazilian spreadsheet formats", () => {
    const csv = buildTripsCsv([{
      id: "trip-1",
      name: 'Férias "especiais"',
      slug: "ferias-especiais",
      description: null,
      destination: "Praias",
      destinationCity: "Natal",
      destinationState: "RN",
      originCity: "Juazeiro do Norte",
      originState: "CE",
      type: "excursao",
      category: "standard",
      departureDate: "2026-12-15",
      returnDate: "2026-12-20",
      departureTime: "06:00",
      returnTime: "18:00",
      totalCapacity: 46,
      availableSeats: 46,
      reservedSeats: 0,
      confirmedSeats: 0,
      priceAdult: 1890.5,
      priceChild: 950,
      priceSenior: null,
      inclusions: ["Transporte ida e volta", "Guia turístico"],
      exclusions: ["Despesas pessoais"],
      status: "draft",
      isPublic: false,
      isFeatured: false,
      vehiclePlate: "ABC-1234",
      vehicleType: "Ônibus",
      driverName: "João da Silva",
      tourGuide: "Maria Guia",
      tripOrganizer: "Agência",
      seatLayout: "2x2",
      boardingPoints: [{ id: "point-1", name: "Praça Central" }, { id: "point-2", name: "Rodoviária" }],
      gallery: [],
      createdAt: "2026-01-01T12:00:00.000Z",
      updatedAt: "2026-01-01T12:00:00.000Z",
    }]);

    const rows = parseTripCsv(csv);
    expect(rows[0]).toEqual(TRIP_CSV_HEADERS);
    expect(csv).toContain('"Férias ""especiais"""');
    expect(rows[1]).toContain('Férias "especiais"');
    expect(rows[1]).toContain("15/12/2026");
    expect(rows[1]).toContain("R$ 1.890,50");
    expect(buildTripCsvData(rows[0], rows[1], 2).data).toMatchObject({
      name: 'Férias "especiais"',
      departureDate: "2026-12-15",
      priceAdult: 1890.5,
      boardingPoints: [
        { name: "Praça Central" },
        { name: "Rodoviária" },
      ],
    });
  });
});
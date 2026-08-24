import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildTripCsvData,
  buildTripsCsv,
  parseTripCsv,
  parseTripFile,
  TRIP_CSV_HEADERS,
} from "@/lib/trip-csv-import";

vi.mock("@/lib/spreadsheet-import", () => ({
  readXlsxRows: vi.fn(),
}));

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
    expect(buildTripCsvData([...headers, "Horário de Saída"], ["Viagem", "Praias", "Natal", "RN", "15/12/2026", "100", "25:00"], 5).error)
      .toContain("horário de saída inválido");
  });

  it("recognizes all records from the complete export without source IDs or occupancy", () => {
    const csv = readFileSync(resolve(process.cwd(), "../../attached_assets/trips_1787592010061.csv"), "utf8");
    const rows = parseTripCsv(csv);
    const imported = rows.slice(1).map((row, index) => buildTripCsvData(rows[0], row, index + 2));
    expect(imported).toHaveLength(20);
    expect(imported.flatMap(result => result.error ? [result.error] : [])).toEqual([]);
    const first = imported[0].data!;
    expect(first).toMatchObject({
      destination: "Praia do Francês",
      destinationCity: "Maceió",
      destinationState: "AL",
      departureDate: "2026-12-17",
      returnDate: "2026-12-21",
      totalCapacity: 55,
      priceAdult: 850,
      status: "active",
      seatLayout: "2x2",
    });
    expect(first).not.toHaveProperty("id");
    expect(first).not.toHaveProperty("tenantId");
    expect(first).not.toHaveProperty("slug");
    expect(first).not.toHaveProperty("seatMap");
    expect(first).not.toHaveProperty("availableSeats");
    expect(first).not.toHaveProperty("reservedSeats");
    expect(first.boardingPoints?.[0]?.id).not.toBe("24a5f1d1-9f9f-450a-af61-159ed62d7618");
    expect(first.fixedCosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "csv-2-1", value: 13000 }),
    ]));
  });

  it("exports the import template columns with Brazilian spreadsheet formats", () => {
    const trip = {
      id: "trip-1", name: 'Férias "especiais"', slug: "ferias", description: null,
      destination: "Praias", destinationCity: "Natal", destinationState: "RN",
      originCity: "Crato", originState: "CE", type: "excursao", category: "standard",
      departureDate: "2026-12-15", returnDate: "2026-12-20", departureTime: "06:00",
      returnTime: "18:00", totalCapacity: 46, availableSeats: 46, reservedSeats: 0,
      confirmedSeats: 0, priceAdult: 1890.5, priceChild: 950, priceSenior: null,
      inclusions: ["Guia"], exclusions: ["Pessoais"], status: "draft", isPublic: false,
      isFeatured: false, vehiclePlate: null, vehicleType: "Ônibus", driverName: null,
      tourGuide: null, tripOrganizer: null, seatLayout: "2x2", boardingPoints: [],
      gallery: [], createdAt: "2026-01-01T12:00:00.000Z", updatedAt: "2026-01-01T12:00:00.000Z",
    };
    const csv = buildTripsCsv([trip]);
    expect(parseTripCsv(csv)[0]).toEqual(TRIP_CSV_HEADERS);
    expect(csv).toContain('"Férias ""especiais"""');
    expect(buildTripCsvData(parseTripCsv(csv)[0], parseTripCsv(csv)[1], 2).data)
      .toMatchObject({ name: 'Férias "especiais"', departureDate: "2026-12-15", priceAdult: 1890.5 });
  });

});
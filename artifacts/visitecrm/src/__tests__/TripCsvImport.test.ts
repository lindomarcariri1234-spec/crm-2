import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildTripCsvData,
  buildTripsCsv,
  parseTripCsv,
  parseTripFile,
  TRIP_CSV_HEADERS,
} from "@/lib/trip-csv-import";

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

  it("maps a full trip export without reusing source IDs or occupancy", () => {
    const headers = [
      "id", "tenant_id", "name", "description", "destination", "destination_city", "destination_state",
      "origin_city", "origin_state", "type", "category", "departure_date", "return_date",
      "departure_time", "return_time", "total_capacity", "available_seats", "reserved_seats",
      "seat_map", "price_adult", "price_child", "price_senior", "inclusions", "exclusions",
      "itinerary", "boarding_points", "gallery", "videos", "status", "is_public", "is_featured",
      "vehicle_plate", "vehicle_type", "driver_name", "tour_guide", "trip_organizer", "seat_layout",
    ];
    const row = [
      "source-trip", "source-tenant", "Excursão para Maceió", "<p>Praia e hotel</p>", "Praia do Francês",
      "Maceió", "AL", "Crato", "CE", "excursao", "standard", '"2026-12-17T15:00:00.000Z"',
      '"2026-12-21T15:00:00.000Z"', "20:00", "03:00", "55", "36", "19", '{"1":{"status":"reserved"}}',
      "850.00", "425.00", "700.00", '["Transporte","Café da manhã"]', '["Almoço"]',
      '[{"day":1,"title":"Chegada"}]',
      '[{"id":"source-point","name":"Rodoviária","time":"22:00","address":"Centro"}]',
      '["https://cdn.example/1.jpg"]', '["https://cdn.example/1.mp4"]', "active", "false", "true",
      "ABC-1234", "Ônibus", "João", "Maria", "Agência", "2x2",
    ];

    const result = buildTripCsvData(headers, row, 2);

    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      name: "Excursão para Maceió",
      departureDate: "2026-12-17",
      returnDate: "2026-12-21",
      totalCapacity: 55,
      priceAdult: 850,
      inclusions: ["Transporte", "Café da manhã"],
      exclusions: ["Almoço"],
      boardingPoints: [{ id: "csv-2-1", name: "Rodoviária", time: "22:00", address: "Centro" }],
      gallery: ["https://cdn.example/1.jpg"],
      videos: ["https://cdn.example/1.mp4"],
    });
    expect(result.data).not.toHaveProperty("id");
    expect(result.data).not.toHaveProperty("tenantId");
    expect(result.data).not.toHaveProperty("availableSeats");
    expect(result.data).not.toHaveProperty("reservedSeats");
    expect(result.data).not.toHaveProperty("seatMap");
    expect(result.data).not.toHaveProperty("isPublic");
    expect(result.data).not.toHaveProperty("isFeatured");
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

  it("reads an XLSX upload with the trip worksheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Viagens");
    worksheet.addRows([
      ["Nome", "Destino", "Cidade de Destino", "Estado de Destino", "Data de Saída", "Preço Adulto", "Capacidade"],
      ["Férias em Natal", "Praias", "Natal", "RN", "15/12/2026", 1890.5, 46],
    ]);
    const workbookData = await workbook.xlsx.writeBuffer();
    const file = {
      name: "viagens.xlsx",
      arrayBuffer: async () => workbookData,
    } as File;

    await expect(parseTripFile(file)).resolves.toEqual({
      headers: ["Nome", "Destino", "Cidade de Destino", "Estado de Destino", "Data de Saída", "Preço Adulto", "Capacidade"],
      rows: [["Férias em Natal", "Praias", "Natal", "RN", "15/12/2026", "1890.5", "46"]],
    });
  });
});
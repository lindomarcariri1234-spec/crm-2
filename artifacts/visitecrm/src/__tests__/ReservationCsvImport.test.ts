import { describe, expect, it } from "vitest";
import {
  buildReservationCsvData,
  parseReservationCsv,
  resolveReservationCsvData,
} from "@/lib/reservation-csv-import";

describe("reservation CSV import", () => {
  it("parses the exported reservation format with Brazilian currency", () => {
    const csv = [
      '"Cliente";"Viagem";"Saída";"Status";"Assentos";"Valor Total (R$)";"Valor Pago (R$)";"Forma de Pagamento";"Parcelas"',
      '"Maria da Silva";"Férias, Natal";"15/12/2026";"confirmed";"12, 13";"R$ 1.890,50";"500,00";"PIX";"3"',
    ].join("\n");
    const rows = parseReservationCsv(csv);
    const result = buildReservationCsvData(rows[0], rows[1], 2);

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({
      clientName: "Maria da Silva",
      tripName: "Férias, Natal",
      departureDate: "2026-12-15",
      seats: ["12", "13"],
      totalValue: 1890.5,
      paidValue: 500,
      paymentMethod: "pix",
      installments: 3,
      status: "confirmed",
    });
  });

  it("resolves normalized client and trip names using the departure date", () => {
    const parsed = buildReservationCsvData(
      ["Cliente", "Viagem", "Saída", "Status", "Assentos", "Valor Total (R$)", "Valor Pago (R$)"],
      ["  MÁRIA  da Silva ", "Excursão Natal", "15/12/2026", "Pendente", "0", "100,00", "0,00"],
      2,
    );
    const resolved = resolveReservationCsvData(parsed.data!, [{ id: "client-1", name: "Maria da Silva" }], [
      { id: "trip-other", name: "Excursão Natal", departureDate: "2026-12-22T12:00:00.000Z" },
      { id: "trip-1", name: "Excursão Natal", departureDate: "2026-12-15T12:00:00.000Z" },
    ], 2);

    expect(resolved.data).toMatchObject({ clientId: "client-1", tripId: "trip-1", seats: [], status: "pending" });
  });

  it("reports incomplete rows and unmatched references", () => {
    const missing = buildReservationCsvData(["Cliente", "Viagem", "Valor Total (R$)"], ["", "Natal", "100"], 4);
    expect(missing.error).toContain("cliente é obrigatório");

    const valid = buildReservationCsvData(
      ["Cliente", "Viagem", "Valor Total (R$)"],
      ["Maria", "Natal", "100"],
      5,
    );
    const unresolved = resolveReservationCsvData(valid.data!, [], [], 5);
    expect(unresolved.error).toContain('cliente "Maria" não foi encontrado');
  });
});
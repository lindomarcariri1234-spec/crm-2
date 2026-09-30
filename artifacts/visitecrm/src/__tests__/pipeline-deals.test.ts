import { describe, expect, it } from "vitest";
import {
  filterDealsByClientClassificationAndCity,
  getPipelineStageAutomationHint,
  getTripsMissingReturnDate,
  mergePipelineDeals,
} from "../pages/pipeline-deals.js";

describe("mergePipelineDeals", () => {
  it("keeps confirmed-reservation deals visible with open deals", () => {
    const openDeal = { id: "open-deal", status: "open" };
    const confirmedReservationDeal = { id: "deposit-deal", status: "won" };

    expect(mergePipelineDeals([openDeal], [confirmedReservationDeal])).toEqual([
      openDeal,
      confirmedReservationDeal,
    ]);
  });

  it("does not render the same deal card twice while query caches refresh", () => {
    const deal = { id: "deposit-deal", status: "won" };

    expect(mergePipelineDeals([deal], [deal])).toEqual([deal]);
  });
});

describe("getTripsMissingReturnDate", () => {
  it("warns only for trips linked to open deals in Em Viagem with no return date", () => {
    const stages = [
      { id: "travel-stage", name: " Em Viagem " },
      { id: "post-trip-stage", name: "Pós Viagem" },
    ];
    const openDeals = [
      { stageId: "travel-stage", tripId: "trip-missing-date" },
      { stageId: "travel-stage", tripId: "trip-has-date" },
      { stageId: "post-trip-stage", tripId: "trip-post-trip" },
      { stageId: "travel-stage", tripId: "trip-not-loaded" },
      { stageId: "travel-stage", tripId: null },
    ];
    const trips = [
      { id: "trip-missing-date", name: "Serra Azul", returnDate: null },
      { id: "trip-has-date", name: "Praia Sul", returnDate: "2026-10-12T15:00:00.000Z" },
      { id: "trip-post-trip", name: "Vale Verde", returnDate: null },
    ];

    expect(getTripsMissingReturnDate(openDeals, stages, trips)).toEqual([trips[0]]);
  });

  it("returns no warnings when the selected pipeline has no Em Viagem stage", () => {
    expect(
      getTripsMissingReturnDate(
        [{ stageId: "stage-1", tripId: "trip-1" }],
        [{ id: "stage-1", name: "Reserva Criada" }],
        [{ id: "trip-1", name: "Serra Azul", returnDate: null }],
      ),
    ).toEqual([]);
  });
});

describe("getPipelineStageAutomationHint", () => {
  it("explains the known automatic stage triggers", () => {
    expect(getPipelineStageAutomationHint("Reserva Criada"))
      .toBe("quando a reserva é criada ou vinculada");
    expect(getPipelineStageAutomationHint("Pagamento Confirmado"))
      .toBe("quando o recebível é pago");
    expect(getPipelineStageAutomationHint("Em Viagem"))
      .toBe("na saída da viagem ou no check-in");
    expect(getPipelineStageAutomationHint("Pós Viagem"))
      .toBe("após a data de retorno");
    expect(getPipelineStageAutomationHint("Cancelado"))
      .toBe("quando não há mais reserva ativa");
  });

  it("matches accents and surrounding whitespace without labeling custom stages", () => {
    expect(getPipelineStageAutomationHint("  POS VIAGEM  "))
      .toBe("após a data de retorno");
    expect(getPipelineStageAutomationHint("Contato realizado")).toBeNull();
  });
});

describe("filterDealsByClientClassificationAndCity", () => {
  const deals = [
    { id: "vip", clientId: "client-vip", clientClassification: "vip", clientCity: "Juazeiro do Norte" },
    { id: "client", clientId: "client-1", clientClassification: "client", clientCity: "Crato" },
    { id: "lead", clientId: null, clientClassification: null, clientCity: null },
  ];

  it("filters client-linked deals by classification and city without dropping anonymous leads by city alone", () => {
    expect(filterDealsByClientClassificationAndCity(deals, "vip", "JUAZEIRO")).toEqual([deals[0]]);
    expect(filterDealsByClientClassificationAndCity(deals, "all", "crato")).toEqual([
      deals[1],
      deals[2],
    ]);
  });
});
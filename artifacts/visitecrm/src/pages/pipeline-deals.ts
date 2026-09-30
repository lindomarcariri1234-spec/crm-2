/**
 * The pipeline board shows deals that are still open as well as deals won by a
 * confirmed reservation. Keep the lists separate in the API cache, then merge
 * them for display without duplicating a card if a cache is refreshed mid-view.
 */
export function mergePipelineDeals<T extends { id: string }>(
  openDeals: T[] | undefined,
  wonDeals: T[] | undefined,
): T[] {
  const seen = new Set<string>();
  return [...(openDeals ?? []), ...(wonDeals ?? [])].filter((deal) => {
    if (seen.has(deal.id)) return false;
    seen.add(deal.id);
    return true;
  });
}

const PIPELINE_STAGE_AUTOMATION_HINTS: Record<string, string> = {
  "reserva criada": "quando a reserva é criada ou vinculada",
  "pagamento confirmado": "quando o recebível é pago",
  "em viagem": "na saída da viagem ou no check-in",
  "pos viagem": "após a data de retorno",
  cancelado: "quando não há mais reserva ativa",
};

export function getPipelineStageAutomationHint(stageName: string): string | null {
  // Only the built-in, name-based triggers are documented; custom stages stay unlabelled.
  const normalizedName = stageName
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return PIPELINE_STAGE_AUTOMATION_HINTS[normalizedName] ?? null;
}

export function filterDealsByClientClassificationAndCity<
  TDeal extends {
    clientId?: string | null;
    clientClassification?: string | null;
    clientCity?: string | null;
  },
>(
  deals: readonly TDeal[],
  classification: string,
  city: string,
): TDeal[] {
  let filteredDeals = [...deals];

  if (classification !== "all") {
    filteredDeals = filteredDeals.filter(
      (deal) => !!deal.clientId && deal.clientClassification === classification,
    );
  }
  if (city) {
    filteredDeals = filteredDeals.filter((deal) => {
      if (!deal.clientId) return true;
      return (deal.clientCity ?? "").toLowerCase().includes(city.toLowerCase());
    });
  }

  return filteredDeals;
}

export function getTripsMissingReturnDate<
  TDeal extends { stageId: string; tripId?: string | null },
  TStage extends { id: string; name: string },
  TTrip extends { id: string; name: string; returnDate?: string | null },
>(
  openDeals: readonly TDeal[] | undefined,
  visibleStages: readonly TStage[] | undefined,
  trips: readonly TTrip[] | undefined,
): TTrip[] {
  const inTravelStageIds = new Set(
    (visibleStages ?? [])
      .filter((stage) => stage.name.trim().toLowerCase() === "em viagem")
      .map((stage) => stage.id),
  );
  if (!inTravelStageIds.size) return [];

  const linkedTripIds = new Set(
    (openDeals ?? [])
      .filter((deal) => deal.tripId && inTravelStageIds.has(deal.stageId))
      .map((deal) => deal.tripId as string),
  );
  if (!linkedTripIds.size) return [];

  return (trips ?? []).filter((trip) => linkedTripIds.has(trip.id) && !trip.returnDate);
}
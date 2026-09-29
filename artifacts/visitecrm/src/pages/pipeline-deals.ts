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
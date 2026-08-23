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
export const OCCUPANCY_SCENARIOS = [50, 60, 70, 80, 90, 100] as const;

export interface OccupancyProjection {
  occupancyPercent: (typeof OCCUPANCY_SCENARIOS)[number];
  capacity: number;
  passengers: number;
  grossRevenue: number;
  fixedCosts: number;
  variableCosts: number;
  operatingCosts: number;
  averageCostPerPassenger: number | null;
  estimatedProfit: number;
  marginPercent: number | null;
}

function amountToCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round((value + Number.EPSILON) * 100));
}

function sumAmountsInCents(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + amountToCents(value), 0);
}

export function calculateOccupancyProjections({
  capacity,
  ticketPrice,
  fixedCostAmounts,
  variableCostPerPassengerAmounts,
}: {
  capacity: number;
  ticketPrice: number;
  fixedCostAmounts: readonly number[];
  variableCostPerPassengerAmounts: readonly number[];
}): OccupancyProjection[] {
  const safeCapacity = Number.isFinite(capacity) ? Math.max(0, Math.floor(capacity)) : 0;
  const ticketPriceCents = amountToCents(ticketPrice);
  const fixedCostsCents = sumAmountsInCents(fixedCostAmounts);
  const variableCostPerPassengerCents = sumAmountsInCents(variableCostPerPassengerAmounts);

  return OCCUPANCY_SCENARIOS.map((occupancyPercent) => {
    const passengers = Math.floor((safeCapacity * occupancyPercent) / 100);
    const grossRevenueCents = ticketPriceCents * passengers;
    const variableCostsCents = variableCostPerPassengerCents * passengers;
    const operatingCostsCents = fixedCostsCents + variableCostsCents;
    const estimatedProfitCents = grossRevenueCents - operatingCostsCents;

    return {
      occupancyPercent,
      capacity: safeCapacity,
      passengers,
      grossRevenue: grossRevenueCents / 100,
      fixedCosts: fixedCostsCents / 100,
      variableCosts: variableCostsCents / 100,
      operatingCosts: operatingCostsCents / 100,
      averageCostPerPassenger: passengers > 0 ? operatingCostsCents / passengers / 100 : null,
      estimatedProfit: estimatedProfitCents / 100,
      marginPercent: grossRevenueCents > 0
        ? (estimatedProfitCents / grossRevenueCents) * 100
        : null,
    };
  });
}
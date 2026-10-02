export const OCCUPANCY_SCENARIOS = [50, 60, 70, 80, 90, 100] as const;

export type FareGroup = "adult" | "child" | "senior";

export interface OccupancyProjection {
  occupancyPercent: (typeof OCCUPANCY_SCENARIOS)[number];
  capacity: number;
  passengers: number;
  passengerMix: Record<FareGroup, number>;
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

function allocatePassengers(passengers: number, weights: Record<FareGroup, number>): Record<FareGroup, number> {
  const groups: FareGroup[] = ["adult", "child", "senior"];
  const cleanWeights = groups.map(group => Number.isFinite(weights[group]) ? Math.max(0, weights[group]) : 0);
  const totalWeight = cleanWeights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) return { adult: passengers, child: 0, senior: 0 };

  const exactShares = cleanWeights.map(weight => (passengers * weight) / totalWeight);
  const counts = exactShares.map(Math.floor);
  const remainder = passengers - counts.reduce((sum, count) => sum + count, 0);
  const ranked = groups.map((group, index) => ({
    index,
    fraction: exactShares[index] - counts[index],
  })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let index = 0; index < remainder; index += 1) counts[ranked[index].index] += 1;
  return { adult: counts[0], child: counts[1], senior: counts[2] };
}

export function calculateOccupancyProjections({
  capacity,
  ticketPrices,
  passengerMixWeights,
  fixedCostAmount,
  variableCostPerPassengerAmount,
}: {
  capacity: number;
  ticketPrices: Record<FareGroup, number>;
  passengerMixWeights: Record<FareGroup, number>;
  fixedCostAmount: number;
  variableCostPerPassengerAmount: number;
}): OccupancyProjection[] {
  const safeCapacity = Number.isFinite(capacity) ? Math.max(0, Math.floor(capacity)) : 0;
  const fareCents: Record<FareGroup, number> = {
    adult: amountToCents(ticketPrices.adult),
    child: amountToCents(ticketPrices.child),
    senior: amountToCents(ticketPrices.senior),
  };
  const fixedCostsCents = amountToCents(fixedCostAmount);
  const variableCostPerPassengerCents = amountToCents(variableCostPerPassengerAmount);

  return OCCUPANCY_SCENARIOS.map(occupancyPercent => {
    const passengers = Math.floor((safeCapacity * occupancyPercent) / 100);
    const passengerMix = allocatePassengers(passengers, passengerMixWeights);
    const grossRevenueCents = passengerMix.adult * fareCents.adult
      + passengerMix.child * fareCents.child
      + passengerMix.senior * fareCents.senior;
    const variableCostsCents = variableCostPerPassengerCents * passengers;
    const operatingCostsCents = fixedCostsCents + variableCostsCents;
    const estimatedProfitCents = grossRevenueCents - operatingCostsCents;

    return {
      occupancyPercent,
      capacity: safeCapacity,
      passengers,
      passengerMix,
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
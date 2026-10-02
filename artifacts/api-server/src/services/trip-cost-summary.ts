export interface ConfirmedTripReservation {
  capacityUnits?: number | null;
  seats?: readonly unknown[] | null;
  totalValue: number | string;
}

export interface RecordedTripCost {
  amount: number | string;
  status: string;
}

function toCents(value: number | string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100);
}

function sumCents(values: readonly (number | string)[]): number {
  return values.reduce<number>((total, value) => total + toCents(value), 0);
}

function reservationCapacityUnits(reservation: ConfirmedTripReservation): number {
  const persistedUnits = Number(reservation.capacityUnits);
  if (Number.isFinite(persistedUnits) && persistedUnits > 0) {
    return Math.floor(persistedUnits);
  }
  return Array.isArray(reservation.seats) ? reservation.seats.length : 0;
}

export function calculateTripCostSummary({
  confirmedReservations,
  costs,
  fixedCostAmounts,
  variableCostPerPassengerAmounts,
}: {
  confirmedReservations: readonly ConfirmedTripReservation[];
  costs: readonly RecordedTripCost[];
  fixedCostAmounts: readonly (number | string)[];
  variableCostPerPassengerAmounts: readonly (number | string)[];
}) {
  const confirmedSeats = confirmedReservations.reduce(
    (total, reservation) => total + reservationCapacityUnits(reservation),
    0,
  );
  const expectedRevenueCents = sumCents(confirmedReservations.map(reservation => reservation.totalValue));
  const totalRealCostsCents = sumCents(costs.map(cost => cost.amount));
  const totalPaidCostsCents = sumCents(
    costs.filter(cost => cost.status === "paid").map(cost => cost.amount),
  );
  const totalPendingCostsCents = sumCents(
    costs.filter(cost => cost.status !== "paid").map(cost => cost.amount),
  );
  const fixedCostsCents = sumCents(fixedCostAmounts);
  const variableCostPerPassengerCents = sumCents(variableCostPerPassengerAmounts);
  const plannedBudgetCents = fixedCostsCents + variableCostPerPassengerCents * confirmedSeats;
  const profitCents = expectedRevenueCents - totalRealCostsCents;
  const margin = expectedRevenueCents > 0
    ? Math.round((profitCents / expectedRevenueCents) * 1000) / 10
    : 0;

  return {
    expectedRevenue: expectedRevenueCents / 100,
    totalRealCosts: totalRealCostsCents / 100,
    totalPaidCosts: totalPaidCostsCents / 100,
    totalPendingCosts: totalPendingCostsCents / 100,
    profit: profitCents / 100,
    margin,
    plannedBudget: plannedBudgetCents / 100,
    budgetVariance: (totalRealCostsCents - plannedBudgetCents) / 100,
    confirmedSeats,
  };
}
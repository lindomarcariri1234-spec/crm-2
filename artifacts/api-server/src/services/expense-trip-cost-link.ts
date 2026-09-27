type LinkableFinancialRecord = {
  tripId: string | null;
  amount: unknown;
  status: string;
};

function amountInCents(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round((amount + Number.EPSILON) * 100);
}

export function areExpenseAndTripCostLinkable(
  expense: LinkableFinancialRecord,
  tripCost: LinkableFinancialRecord,
): boolean {
  const expenseCents = amountInCents(expense.amount);
  const tripCostCents = amountInCents(tripCost.amount);
  return Boolean(
    expense.tripId
    && expense.tripId === tripCost.tripId
    && expenseCents !== null
    && expenseCents === tripCostCents
    && expense.status === tripCost.status,
  );
}
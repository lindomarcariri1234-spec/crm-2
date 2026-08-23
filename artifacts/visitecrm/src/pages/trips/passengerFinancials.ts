import type { BoardingPassenger } from "@workspace/api-client-react";

export type PassengerFinancialTotals = {
  totalValue: number;
  paidValue: number;
  balance: number;
};

type FinancialPassenger = Pick<
  BoardingPassenger,
  "totalValue" | "paidValue" | "balance" | "isGratuidade"
>;

function toCents(value: string | null | undefined): number {
  const amount = Number.parseFloat(value ?? "");
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

/**
 * Sum the financial values for paying passengers only.
 *
 * Keeping the calculation in cents avoids floating point drift while
 * preserving the decimal values expected by the currency formatters.
 */
export function sumPassengerFinancials(
  passengers: FinancialPassenger[],
): PassengerFinancialTotals {
  const totals = passengers.reduce(
    (acc, passenger) => {
      if (passenger.isGratuidade) return acc;

      acc.totalValue += toCents(passenger.totalValue);
      acc.paidValue += toCents(passenger.paidValue);
      acc.balance += toCents(passenger.balance);
      return acc;
    },
    { totalValue: 0, paidValue: 0, balance: 0 },
  );

  return {
    totalValue: totals.totalValue / 100,
    paidValue: totals.paidValue / 100,
    balance: totals.balance / 100,
  };
}
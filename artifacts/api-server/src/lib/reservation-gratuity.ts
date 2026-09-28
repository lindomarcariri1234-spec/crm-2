import { computeBalance, roundMoney } from "./pricing.js";

type MonetaryValue = number | string | null | undefined;

export interface ReservationGratuitySnapshot {
  isGratuidade: boolean;
  totalValue: MonetaryValue;
  gratuityAmount: MonetaryValue;
  paidValue: MonetaryValue;
  balance: MonetaryValue;
}

export interface ReservationGratuityFinancialTransition {
  isGratuidade: boolean;
  totalValue: number;
  gratuityAmount: number;
  balance: number;
  action: "applied" | "removed";
}

function amount(value: MonetaryValue): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

export function calculateReservationGratuityTransition(
  current: ReservationGratuitySnapshot,
  targetIsGratuidade: boolean,
  requestedTotal?: number | null,
): ReservationGratuityFinancialTransition | null {
  if (targetIsGratuidade) {
    const totalValue = amount(current.totalValue);
    const balance = amount(current.balance);
    const existingGratuityAmount = amount(current.gratuityAmount);
    if (current.isGratuidade && totalValue === 0 && balance === 0) return null;

    return {
      isGratuidade: true,
      totalValue: 0,
      gratuityAmount: current.isGratuidade && existingGratuityAmount > 0
        ? existingGratuityAmount
        : totalValue,
      balance: 0,
      action: "applied",
    };
  }

  if (!current.isGratuidade) return null;

  const savedAmount = amount(current.gratuityAmount);
  const restoredTotal = requestedTotal ?? (savedAmount > 0 ? savedAmount : amount(current.totalValue));
  const totalValue = amount(restoredTotal);
  const paidValue = amount(current.paidValue);

  return {
    isGratuidade: false,
    totalValue,
    gratuityAmount: 0,
    balance: computeBalance(totalValue, paidValue),
    action: "removed",
  };
}
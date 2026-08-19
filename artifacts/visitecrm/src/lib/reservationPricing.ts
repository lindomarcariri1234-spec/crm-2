/**
 * Monetary rounding and sequential discount application live in the shared
 * workspace package so the frontend reuses the exact same logic the server
 * uses (server stays the source of truth). Re-exported for existing imports.
 */
import { roundMoney, applyDiscounts } from "@workspace/shared";

export { roundMoney, applyDiscounts };

export function computeReservationTotal(priceAdult: number, seats: string[]): number {
  return priceAdult * seats.length;
}

export interface PassengerPrices {
  priceAdult: number;
  adultSeats: string[];
  priceChild?: number | null;
  childSeats?: string[];
  priceSenior?: number | null;
  seniorSeats?: string[];
}

export function computeDetailedTotal(prices: PassengerPrices): number {
  const adultTotal = prices.priceAdult * prices.adultSeats.length;
  const childTotal = (prices.priceChild ?? prices.priceAdult) * (prices.childSeats?.length ?? 0);
  const seniorTotal = (prices.priceSenior ?? prices.priceAdult) * (prices.seniorSeats?.length ?? 0);
  return roundMoney(adultTotal + childTotal + seniorTotal);
}

export function applyDiscount(totalValue: number, totalDiscount: number): number {
  return Math.max(0, roundMoney(totalValue - totalDiscount));
}

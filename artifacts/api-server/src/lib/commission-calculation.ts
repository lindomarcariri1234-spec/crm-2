import { COMMISSION_STATUS } from "@workspace/permissions";
import { roundMoney } from "./pricing.js";

export type CommissionTravelScope = "national" | "international";

export interface CommissionRuleCandidate {
  appliesTo: string;
  tripId: string | null;
  type: string | null;
  value: string | number;
}

export interface SellerCommissionConfiguration {
  commissionType: string | null;
  commissionRate: string | number | null;
  commissionFixed: string | number | null;
}

export interface CommissionCalculation {
  commissionAmount: number;
  commissionRate: number | null;
  commissionType: string;
}

const UNKNOWN_COUNTRIES = new Set([
  "unknown",
  "unk",
  "notprovided",
  "notavailable",
  "desconhecido",
  "naoinformado",
  "naoidentificado",
  "indefinido",
  "undefined",
  "null",
  "none",
]);

function toNumber(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw new Error("Commission configuration contains an invalid number");
  }
  return result;
}

export function getCommissionTravelScope(
  destinationCountry: string | null | undefined,
): CommissionTravelScope | null {
  if (!destinationCountry?.trim()) return null;

  const trimmedCountry = destinationCountry.trim();
  const normalizedCountry = destinationCountry
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (!normalizedCountry) return null;
  if (
    /^(?:n\/a|n\.a\.|not applicable)$/i.test(trimmedCountry) ||
    UNKNOWN_COUNTRIES.has(normalizedCountry)
  ) {
    return null;
  }
  if (
    normalizedCountry === "br" ||
    normalizedCountry === "bra" ||
    normalizedCountry.includes("brasil") ||
    normalizedCountry.includes("brazil")
  ) {
    return "national";
  }
  return "international";
}

export function selectApplicableCommissionRule<T extends CommissionRuleCandidate>(
  rules: readonly T[],
  tripId: string | null | undefined,
  travelScope: CommissionTravelScope | null,
): T | undefined {
  const tripRule = tripId
    ? rules.find((rule) => rule.appliesTo === "trip" && rule.tripId === tripId)
    : undefined;
  if (tripRule) return tripRule;

  const travelRule = travelScope
    ? rules.find((rule) => rule.appliesTo === travelScope)
    : undefined;
  if (travelRule) return travelRule;

  return rules.find((rule) => rule.appliesTo === "all");
}

export function calculateRuleCommission(
  saleAmount: number,
  rule: Pick<CommissionRuleCandidate, "type" | "value">,
): CommissionCalculation {
  const value = toNumber(rule.value);
  if (value < 0) {
    throw new Error("Commission rule value cannot be negative");
  }

  if ((rule.type ?? "percentage") === "fixed") {
    return {
      commissionAmount: roundMoney(value),
      commissionRate: null,
      commissionType: "fixed",
    };
  }

  if (rule.type != null && rule.type !== "percentage") {
    throw new Error("Commission rule type is invalid");
  }

  return {
    commissionAmount: roundMoney((saleAmount * value) / 100),
    commissionRate: value,
    commissionType: "percentage",
  };
}

export function calculateSellerCommission(
  saleAmount: number,
  seller: SellerCommissionConfiguration,
): CommissionCalculation {
  const rate = toNumber(seller.commissionRate);
  const fixed = toNumber(seller.commissionFixed);

  if (seller.commissionType === "none") {
    return { commissionAmount: 0, commissionRate: null, commissionType: "none" };
  }

  if (seller.commissionType === "fixed") {
    return {
      commissionAmount: roundMoney(fixed),
      commissionRate: null,
      commissionType: "fixed",
    };
  }

  if (seller.commissionType === "hybrid") {
    return {
      commissionAmount: roundMoney((saleAmount * rate) / 100 + fixed),
      commissionRate: rate,
      commissionType: "hybrid",
    };
  }

  return {
    commissionAmount: roundMoney((saleAmount * rate) / 100),
    commissionRate: rate,
    commissionType: "percentage",
  };
}

export function canTransitionCommissionStatus(current: string, next: string): boolean {
  if (current === next) return true;
  return (
    (current === COMMISSION_STATUS.PENDING && next === COMMISSION_STATUS.APPROVED) ||
    (current === COMMISSION_STATUS.APPROVED && next === COMMISSION_STATUS.PAID)
  );
}
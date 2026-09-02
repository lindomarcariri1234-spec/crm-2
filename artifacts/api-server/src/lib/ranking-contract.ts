import {
  REFERRAL_STATUS,
  RESERVATION_STATUS,
  type ReferralStatus,
  type ReservationStatus,
} from "@workspace/permissions";

export const RANKING_TIMEZONE = "America/Sao_Paulo" as const;

export type RankingKind = "referral" | "referralCommercial" | "traveler" | "client";
export type RankingAudience = "public" | "admin";

type RankingContract = {
  source: string;
  eligibleStatuses: readonly string[];
  dateField: string | null;
  periodSemantics: string;
  optIn: "required_for_public" | "not_required";
  masking: "public_name_masked" | "none";
  tieBreakers: readonly string[];
  excludedStatuses?: readonly string[];
};

export const RANKING_ELIGIBLE_STATUSES = {
  referral: [REFERRAL_STATUS.COMPLETED, REFERRAL_STATUS.CONVERTED] as const satisfies readonly ReferralStatus[],
  traveler: [RESERVATION_STATUS.COMPLETED] as const satisfies readonly ReservationStatus[],
} as const;

/**
 * The ranking contract is deliberately descriptive as well as executable:
 * consumers receive the same rules which the ranking query uses. Rankings are
 * read-only; this module never attempts data repair or cross-tenant matching.
 */
export const RANKING_CONTRACTS: Record<RankingKind, RankingContract> = {
  referral: {
    source: "referrals",
    eligibleStatuses: RANKING_ELIGIBLE_STATUSES.referral,
    dateField: "referrals.createdAt",
    periodSemantics: "Brazil calendar month, inclusive start and exclusive next-month start",
    optIn: "required_for_public",
    masking: "public_name_masked",
    tieBreakers: ["count DESC", "clientName ASC", "clientId ASC"],
    excludedStatuses: [REFERRAL_STATUS.REVERSED],
  },
  referralCommercial: {
    source: "referrals joined to their attributed reservations",
    eligibleStatuses: RANKING_ELIGIBLE_STATUSES.referral,
    dateField: "referrals.convertedAt",
    periodSemantics: "selected reporting period; timestamps are interpreted in America/Sao_Paulo for calendar reporting",
    optIn: "not_required",
    masking: "none",
    tieBreakers: ["attributedRevenue DESC", "conversions DESC", "clientName ASC", "clientId ASC"],
    excludedStatuses: [REFERRAL_STATUS.REVERSED, RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.REFUNDED],
  },
  traveler: {
    source: "reservations joined to trips",
    eligibleStatuses: RANKING_ELIGIBLE_STATUSES.traveler,
    dateField: "trips.returnDate",
    periodSemantics: "Brazil calendar month, inclusive start and exclusive next-month start",
    optIn: "required_for_public",
    masking: "public_name_masked",
    tieBreakers: ["count DESC", "clientName ASC", "clientId ASC"],
    excludedStatuses: [RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.REFUNDED],
  },
  client: {
    source: "clients",
    eligibleStatuses: [],
    dateField: null,
    periodSemantics: "all-time tenant-scoped total",
    optIn: "not_required",
    masking: "none",
    tieBreakers: ["totalSpent DESC", "clientName ASC", "clientId ASC"],
  },
};

export type BrazilMonthPeriod = {
  key: string;
  start: Date;
  end: Date;
};
export type RankingPeriod = BrazilMonthPeriod | "all-time" | { key: string; semantics: string };

/** Computes month bounds in Sao Paulo, rather than truncating a UTC timestamp. */
export function brazilMonthPeriod(reference = new Date()): BrazilMonthPeriod {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RANKING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(reference);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error("Could not resolve Brazil ranking month");
  }
  // Sao Paulo is UTC-03:00. Keeping explicit UTC boundaries also makes the
  // SQL predicates index-friendly.
  const start = new Date(Date.UTC(year, month - 1, 1, 3));
  const end = new Date(Date.UTC(year, month, 1, 3));
  return { key: `${year}-${String(month).padStart(2, "0")}`, start, end };
}

export function rankingMetadata(
  kind: RankingKind,
  audience: RankingAudience,
  period: RankingPeriod = brazilMonthPeriod(),
) {
  const contract = RANKING_CONTRACTS[kind];
  const isAllTime = period === "all-time";
  return {
    kind,
    period: isAllTime ? "all-time" : period.key,
    timezone: RANKING_TIMEZONE,
    eligibilitySummary: {
      source: contract.source,
      eligibleStatuses: [...contract.eligibleStatuses],
      excludedStatuses: [...(contract.excludedStatuses ?? [])],
      dateField: contract.dateField,
      periodSemantics: isAllTime ? contract.periodSemantics : (period as { semantics?: string }).semantics ?? contract.periodSemantics,
      optInRequired: audience === "public" && contract.optIn === "required_for_public",
      namesMasked: audience === "public" && contract.masking === "public_name_masked",
    },
    tieBreakers: [...contract.tieBreakers],
  };
}

export function maskRankingName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? name;
  return `${parts[0]} ${(parts[parts.length - 1] ?? "").charAt(0).toUpperCase()}.`;
}
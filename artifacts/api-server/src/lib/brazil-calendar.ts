const BRAZIL_TIME_ZONE = "America/Sao_Paulo";
const BRAZIL_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type CivilDate = {
  key: string;
  year: number;
  month: number;
  startInclusive: Date;
};

export type BrazilDateRangeResult =
  | { ok: true; startInclusive?: Date; endExclusive?: Date }
  | { ok: false; reason: "invalid" | "reversed" };

export type BrazilMonthBucket = {
  key: string;
  label: string;
  year: number;
  month: number;
  start: Date;
  endExclusive: Date;
};

function utcDate(year: number, monthIndex: number, day: number, hour = 0): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

function parseCivilDate(value: unknown): CivilDate | undefined {
  if (typeof value !== "string") return undefined;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = utcDate(year, month - 1, day);
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day
  ) {
    return undefined;
  }

  // São Paulo has used UTC-03:00 year-round since 2019. Construct UTC
  // instants explicitly so host/browser timezone never affects civil dates.
  const startInclusive = new Date(normalized.getTime() + BRAZIL_UTC_OFFSET_MS);
  return { key: value, year, month, startInclusive };
}

export function parseBrazilDateRange(dateFrom: unknown, dateTo: unknown): BrazilDateRangeResult {
  const hasFrom = dateFrom !== undefined;
  const hasTo = dateTo !== undefined;
  const from = hasFrom ? parseCivilDate(dateFrom) : undefined;
  const to = hasTo ? parseCivilDate(dateTo) : undefined;

  if ((hasFrom && !from) || (hasTo && !to)) {
    return { ok: false, reason: "invalid" };
  }
  if (from && to && from.key > to.key) {
    return { ok: false, reason: "reversed" };
  }

  return {
    ok: true,
    startInclusive: from?.startInclusive,
    endExclusive: to ? new Date(to.startInclusive.getTime() + DAY_MS) : undefined,
  };
}

function getBrazilCalendarMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new RangeError("Could not resolve Brazil calendar month");
  }
  return { year, month };
}

function brazilMonthStart(year: number, monthIndex: number): Date {
  return new Date(utcDate(year, monthIndex, 1).getTime() + BRAZIL_UTC_OFFSET_MS);
}

export function getBrazilMonthBuckets(count = 12, referenceDate = new Date()): BrazilMonthBucket[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("Month bucket count must be a non-negative integer");
  }

  const current = getBrazilCalendarMonth(referenceDate);
  const buckets: BrazilMonthBucket[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const anchor = utcDate(current.year, current.month - 1 - offset, 15, 12);
    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth() + 1;
    const labelDate = utcDate(year, month - 1, 15, 12);
    const label = new Intl.DateTimeFormat("pt-BR", {
      timeZone: BRAZIL_TIME_ZONE,
      month: "short",
      year: "2-digit",
    }).format(labelDate);

    buckets.push({
      key: `${year}-${String(month).padStart(2, "0")}`,
      label,
      year,
      month,
      start: brazilMonthStart(year, month - 1),
      endExclusive: brazilMonthStart(year, month),
    });
  }
  return buckets;
}
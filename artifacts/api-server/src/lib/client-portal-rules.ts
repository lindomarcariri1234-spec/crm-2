import { localToday } from "@workspace/shared";
import { RESERVATION_STATUS } from "@workspace/permissions";

const BRAZIL_TZ = "America/Sao_Paulo";
const brazilDate = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: BRAZIL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);

/** Date-only input is interpreted as a calendar day, never a UTC timestamp. */
export function validBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return false;
  const today = localToday();
  const oldest = `${Number(today.slice(0, 4)) - 120}${today.slice(4)}`;
  return value <= today && value >= oldest;
}

export function canRedeemForStatus(status: string): boolean {
  return status === RESERVATION_STATUS.PENDING || status === RESERVATION_STATUS.CONFIRMED;
}

export function canSubmitNps(status: string, returnDate: Date | null, today = localToday()): boolean {
  if (!returnDate || (status !== RESERVATION_STATUS.CONFIRMED && status !== RESERVATION_STATUS.COMPLETED)) return false;
  const lower = new Date(`${today}T12:00:00Z`);
  lower.setUTCDate(lower.getUTCDate() - 30);
  const returned = brazilDate(returnDate);
  return returned >= lower.toISOString().slice(0, 10) && returned <= today;
}

export function maskReferralName(name: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  return parts.map((part, index) => index === 0 ? part.slice(0, 1) + "***" : part.slice(0, 1) + ".").join(" ");
}
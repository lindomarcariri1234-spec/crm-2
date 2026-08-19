import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatBRL, formatBRLPlain } from "@workspace/shared";

const BRAZIL_TZ = "America/Sao_Paulo";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { formatBRL as formatCurrency, formatBRLPlain };

export function formatCurrencyBRL(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "Grátis";
  const num = Number(value);
  if (num === 0) return "Grátis";
  return formatBRL(num);
}

export function formatDate(d: string): string {
  if (!d) return d;
  try {
    const dt = d.length <= 10 ? new Date(d + "T12:00:00") : new Date(d);
    if (isNaN(dt.getTime())) return d;
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: BRAZIL_TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(dt);
  } catch {
    return d;
  }
}

export function formatDateShort(d?: string | null): string | null {
  if (!d) return null;
  try {
    const dt = d.length <= 10 ? new Date(d + "T12:00:00") : new Date(d);
    if (isNaN(dt.getTime())) return d;
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: BRAZIL_TZ,
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(dt);
  } catch {
    return d;
  }
}

export function formatDateTime(d?: string | null): string {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: BRAZIL_TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(d));
  } catch {
    return "—";
  }
}

export { isValidCpf as validateCpf, formatCpf } from "@workspace/shared";

export function validatePhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    // Mobile: area code (2 digits) + 9 + 8 digits
    return /^[1-9]{2}9[0-9]{8}$/.test(digits);
  }
  if (digits.length === 10) {
    // Landline: area code (2 digits) + 8 digits (starting with 2-8)
    return /^[1-9]{2}[2-8][0-9]{7}$/.test(digits);
  }
  return false;
}

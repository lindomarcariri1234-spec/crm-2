/**
 * Normalises a Brazilian phone number to E.164 format without the "+" prefix.
 * Accepts numbers with or without the country code (55).
 */
export function normalizeBrazilPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  let normalized = digits;
  if (digits.startsWith("55") && digits.length >= 12) {
    normalized = digits;
  } else {
    normalized = `55${digits}`;
  }

  // Brazil: 55 + DDD (2) + subscriber (8–9) = 12–13 digits total.
  if (normalized.length < 12 || normalized.length > 13) return null;
  return normalized;
}

/** Returns whether a phone number can be sent through the Brazilian WhatsApp flow. */
export function isValidBrazilWhatsAppPhone(phone: string): boolean {
  return normalizeBrazilPhone(phone) !== null;
}
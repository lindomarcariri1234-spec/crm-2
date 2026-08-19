import { randomBytes } from "crypto";
import { localToday } from "@workspace/shared";

export function generateId(): string {
  return randomBytes(12).toString("base64url");
}

export function generateVoucherCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

// Crockford-style base32 alphabet (omits I, L, O, U to avoid visual ambiguity).
// 256 is divisible by 32, so masking a random byte with 31 is unbiased.
const REFERRAL_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REFERRAL_SUFFIX_LENGTH = 8;

/**
 * Returns a cryptographically random, unambiguous base32 suffix.
 * 8 chars × 5 bits ≈ 40 bits of entropy, so a referral code cannot be guessed
 * or brute-forced by an anonymous caller and can safely be treated as a secret
 * bearer token.
 * @param length - Number of suffix characters (default 8).
 */
export function generateReferralCodeSuffix(length: number = REFERRAL_SUFFIX_LENGTH): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += REFERRAL_CODE_ALPHABET[bytes[i]! & 31];
  }
  return out;
}

/**
 * Generates a referral code in `NOME{YEAR}{RANDOM}` format. The leading
 * name+year segment keeps codes human-recognisable while the random suffix
 * provides the entropy needed to treat the code as a secret (so enumerating
 * the public referral endpoints cannot reveal customer data).
 * Uniqueness per tenant must still be verified by the caller's assign loop.
 * @param clientName - The client's full name
 * @param _tenantId - Tenant ID (used for uniqueness enforcement in calling code)
 * @returns A code like "JOAO2026X7K2QN8M"
 */
export function generateReferralCode(clientName: string, _tenantId?: string): string {
  const year = Number(localToday().slice(0, 4)); // Brazil calendar year (UTC-3)
  const namePart = (clientName ?? "REF").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4) || "REF";
  return `${namePart}${year}${generateReferralCodeSuffix()}`;
}

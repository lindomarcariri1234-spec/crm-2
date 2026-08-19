/**
 * Shared Brazilian CPF helpers used by both the API server and the web
 * frontend. Keeping a single implementation prevents the validation/formatting
 * rules from drifting between server and client.
 */

/** Strips every non-digit character from a CPF string. */
export function cleanCpf(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

/** Validates a CPF using the standard mod-11 checksum (rejects all-same digits). */
export function isValidCpf(cpf: string): boolean {
  const c = cleanCpf(cpf);
  if (c.length !== 11) return false;

  const allSame = /^(\d)\1{10}$/.test(c);
  if (allSame) return false;

  let sum = 0;
  for (let i = 1; i <= 9; i++) sum += parseInt(c[i - 1]) * (11 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  if (rem !== parseInt(c[9])) return false;

  sum = 0;
  for (let i = 1; i <= 10; i++) sum += parseInt(c[i - 1]) * (12 - i);
  rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  if (rem !== parseInt(c[10])) return false;

  return true;
}

/**
 * Validates a CPF and returns the cleaned (digits-only) value, throwing a
 * localized error when absent or invalid. Used server-side where an invalid
 * CPF must abort the request.
 */
export function validateCpfOrThrow(cpf: string): string {
  if (!cpf || !cpf.trim()) throw new Error("CPF é obrigatório");
  const cleaned = cleanCpf(cpf);
  if (!isValidCpf(cleaned)) throw new Error("CPF inválido");
  return cleaned;
}

/**
 * Formats a CPF for display as `000.000.000-00`. Returns "—" for empty values
 * and returns the original input unchanged when it is not 11 digits long.
 */
export function formatCpf(cpf: string | null | undefined): string {
  if (!cpf) return "—";
  const digits = cpf.replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return cpf;
}

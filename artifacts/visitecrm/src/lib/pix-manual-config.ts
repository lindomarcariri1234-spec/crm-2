export const PIX_KEY_TYPES = ["cpf", "cnpj", "email", "phone", "random"] as const;

export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

export function normalizePixKey(value: string, type: PixKeyType): string {
  const trimmed = value.trim();

  switch (type) {
    case "cpf":
      return trimmed.replace(/\D/g, "");
    case "cnpj":
      return trimmed.replace(/[^a-z\d]/gi, "").toUpperCase();
    case "email":
      return trimmed.toLowerCase();
    case "phone": {
      const compact = trimmed.replace(/[()\s.-]/g, "");
      const digits = compact.replace(/\D/g, "");
      if (compact.startsWith("+")) return compact;
      if (/^\d{10,11}$/.test(digits)) return `+55${digits}`;
      if (/^55\d{10,11}$/.test(digits)) return `+${digits}`;
      return compact;
    }
    case "random":
      return trimmed.toLowerCase();
  }
}

function isValidCpf(digits: string): boolean {
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;

  for (let position = 9; position <= 10; position++) {
    let sum = 0;
    for (let index = 0; index < position; index++) {
      sum += Number(digits[index]) * (position + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    const checkDigit = remainder === 10 ? 0 : remainder;
    if (checkDigit !== Number(digits[position])) return false;
  }
  return true;
}

function isValidNumericCnpj(digits: string): boolean {
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;

  const weights = [
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  ];

  for (let checkIndex = 0; checkIndex < 2; checkIndex++) {
    const weightSet = weights[checkIndex]!;
    const sum = weightSet.reduce(
      (total, weight, index) => total + Number(digits[index]) * weight,
      0,
    );
    const remainder = sum % 11;
    const checkDigit = remainder < 2 ? 0 : 11 - remainder;
    if (checkDigit !== Number(digits[12 + checkIndex])) return false;
  }

  return true;
}

export function validatePixKeyValue(value: string, type: string): string | null {
  if (!PIX_KEY_TYPES.includes(type as PixKeyType)) {
    return "Selecione o tipo da chave Pix.";
  }

  const normalized = normalizePixKey(value, type as PixKeyType);
  if (!normalized) return "Informe a chave Pix.";

  switch (type) {
    case "cpf":
      return isValidCpf(normalized)
        ? null
        : "Informe um CPF válido com 11 dígitos.";
    case "cnpj": {
      const compact = normalized.replace(/[^a-z\d]/gi, "").toUpperCase();
      if (!/^[A-Z\d]{14}$/.test(compact)) {
        return "Informe um CNPJ com 14 caracteres.";
      }
      // Numeric CNPJs have check digits. Alphanumeric CNPJs use the newer
      // Receita Federal format, so validate their shape without applying the
      // legacy numeric checksum.
      if (/^\d{14}$/.test(compact) && !isValidNumericCnpj(compact)) {
        return "Confira os dígitos verificadores do CNPJ.";
      }
      return null;
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
        ? null
        : "Informe um e-mail válido.";
    case "phone": {
      const compact = value.trim().replace(/[()\s.-]/g, "");
      if (!/^\+?\d+$/.test(compact)) {
        return "Informe um telefone com DDD e apenas números.";
      }
      const digits = compact.replace(/\D/g, "");
      const isLocalBrazilianNumber = /^\d{10,11}$/.test(digits);
      const isBrazilianInternationalNumber = /^55\d{10,11}$/.test(digits);
      const isOtherInternationalNumber = compact.startsWith("+")
        && digits.length >= 8
        && digits.length <= 15;
      return isLocalBrazilianNumber || isBrazilianInternationalNumber || isOtherInternationalNumber
        ? null
        : "Use um telefone com DDD ou no formato internacional.";
    }
    case "random":
      return /^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(value.trim())
        ? null
        : "Informe a chave aleatória completa (UUID).";
    default:
      return "Selecione o tipo da chave Pix.";
  }
}

export interface PixManualConfigValidationInput {
  enabled: boolean;
  keyConfigured: boolean;
  key: string;
  keyType: string;
  storedKeyType?: string | null;
}

export function validatePixManualConfig({
  enabled,
  keyConfigured,
  key,
  keyType,
  storedKeyType,
}: PixManualConfigValidationInput): string | null {
  const hasNewKey = key.trim().length > 0;

  if (hasNewKey) return validatePixKeyValue(key, keyType);

  const currentType = keyType.trim();
  const previousType = storedKeyType?.trim() ?? "";

  if (keyConfigured && currentType !== previousType) {
    return "Para alterar o tipo, informe também a nova chave Pix.";
  }
  if (enabled && !keyConfigured) {
    return "Cadastre uma chave Pix antes de ativar o Pix Manual.";
  }
  return null;
}

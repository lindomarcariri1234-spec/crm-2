const FINANCIAL_CATEGORY_ALIASES: Record<string, string> = {
  transport: "Transporte",
  transporte: "Transporte",
  accommodation: "Hospedagem",
  hospedagem: "Hospedagem",
  food: "Alimentação",
  alimentacao: "Alimentação",
  marketing: "Marketing",
  administrative: "Administrativo",
  administrativo: "Administrativo",
  commission: "Comissão",
  comissao: "Comissão",
  "comissao de vendedores": "Comissão",
  "comissoes de vendedores": "Comissão",
  other: "Outro",
  outro: "Outro",
  outros: "Outro",
};

function categoryKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ");
}

export function normalizeKnownFinancialCategory(value: string): string {
  const key = categoryKey(value);
  return Object.hasOwn(FINANCIAL_CATEGORY_ALIASES, key)
    ? FINANCIAL_CATEGORY_ALIASES[key]!
    : value;
}

export function normalizeExpenseCategory(value: string): string {
  const key = categoryKey(value);
  if (!Object.hasOwn(FINANCIAL_CATEGORY_ALIASES, key)) {
    throw new Error(`Categoria de despesa desconhecida: ${value}.`);
  }
  return FINANCIAL_CATEGORY_ALIASES[key]!;
}
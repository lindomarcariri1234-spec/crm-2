import { formatCurrencyBRL } from "@/lib/utils";

export type ReferralShareVariable = "nome" | "codigo" | "link" | "bonus";

export interface ReferralShareMessageContext {
  name?: string | null;
  code?: string | null;
  link?: string | null;
  bonus?: string | number | null;
}

const tokenPattern = /\{\{?\s*(nome|codigo|link|bonus)\s*\}?\}/g;

function formatBonus(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? formatCurrencyBRL(numericValue) : String(value);
}

export function hasReferralShareVariable(
  template: string | null | undefined,
  variable: ReferralShareVariable,
): boolean {
  if (!template) return false;
  return new RegExp(`\\{\\{?\\s*${variable}\\s*\\}?\\}`).test(template);
}

export function interpolateReferralShareMessage(
  template: string | null | undefined,
  context: ReferralShareMessageContext,
): string {
  if (!template) return "";
  const values: Record<ReferralShareVariable, string> = {
    nome: context.name ?? "",
    codigo: context.code ?? "",
    link: context.link ?? "",
    bonus: formatBonus(context.bonus),
  };
  return template.replace(tokenPattern, (_token, variable: ReferralShareVariable) => values[variable]);
}

/** Produces the exact text shared by WhatsApp and the copy-message preview. */
export function buildReferralShareText(
  template: string | null | undefined,
  context: ReferralShareMessageContext,
): string {
  const message = interpolateReferralShareMessage(template, context).trim();
  const link = context.link?.trim();
  if (!link) return message;
  if (!message) return link;
  if (hasReferralShareVariable(template, "link") || message.includes(link)) return message;
  return `${message}\n${link}`;
}

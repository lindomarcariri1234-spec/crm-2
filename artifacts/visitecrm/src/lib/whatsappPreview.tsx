import type { ReactNode } from "react";

export const WA_PREVIEW_VALUES = {
  nome: "João Silva",
  codigo: "VC-202609-00042",
  bonus: "R$ 50,00",
  valor: "350,00",
  agencia: "Visite Cariri",
  link: "https://visitecariri.com.br",
  saldo: "350,00",
  viagem: "Fernando de Noronha",
  data: "20/09/2026",
  referencia: "VC-202609-00042",
  saldo_restante: "150,00",
  horario: "06:30",
  local_saida: "Praça da Sé",
};

/**
 * Mirrors the server's interpolateWhatsAppMessage behavior without importing
 * server code into the browser bundle. Unknown placeholders stay visible so a
 * typo such as {Nome} is easy to spot in the preview.
 */
export function interpolateWhatsAppPreview(template: string): string {
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return Object.entries(WA_PREVIEW_VALUES).reduce((message, [key, value]) => {
    return message
      .replace(new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, "g"), value)
      .replace(new RegExp(`\\{${escapeRegex(key)}\\}`, "g"), value);
  }, template);
}

export function renderWhatsAppPreview(message: string): ReactNode {
  return message.split(/\r?\n/).map((line, lineIndex, lines) => (
    <span key={`line-${lineIndex}`}>
      {line.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).map((part, partIndex) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={`part-${partIndex}`}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("*") && part.endsWith("*")) {
          return <strong key={`part-${partIndex}`}>{part.slice(1, -1)}</strong>;
        }
        return part;
      })}
      {lineIndex < lines.length - 1 && <br />}
    </span>
  ));
}
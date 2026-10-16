export interface WhatsAppDefaultCandidate {
  isDefault: boolean;
  enabled: boolean;
  status: string;
}

export function countWhatsAppDefaults(connections: readonly WhatsAppDefaultCandidate[]): number {
  return connections.filter((connection) => connection.isDefault).length;
}

export function getWhatsAppDefaultActionLabel(
  connection: WhatsAppDefaultCandidate,
  defaultCount: number,
): string | null {
  if (!connection.enabled || connection.status !== "connected") return null;
  if (connection.isDefault) return defaultCount > 1 ? "Corrigir número padrão" : null;
  return "Tornar padrão";
}

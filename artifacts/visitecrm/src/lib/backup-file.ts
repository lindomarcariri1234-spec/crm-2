export const BACKUP_FORMAT = "visitecrm-agency-backup";
export const BACKUP_VERSION = 4;

export type ParsedBackup = Record<string, unknown> & {
  tenant: { id: string; name?: string | null; slug?: string | null };
};

function validateIdentityFields(tenant: Record<string, unknown>): void {
  for (const key of ["name", "slug", "email", "cnpj"] as const) {
    const value = tenant[key];
    if (value !== undefined && value !== null && typeof value !== "string") {
      throw new Error(`O campo de identidade "${key}" da agência é inválido.`);
    }
  }
}

export function parseBackupText(rawText: string): ParsedBackup {
  const text = rawText.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("O arquivo de backup está vazio.");
  if (/^<(?:!doctype|html|head|body)\b/i.test(text)) {
    throw new Error("O arquivo contém uma página HTML, não um backup JSON. Gere o backup novamente.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unexpected end|unterminated|end of json/i.test(message) || !/[}\]]\s*$/.test(text)) {
      throw new Error("O arquivo de backup está incompleto ou foi interrompido durante o download.");
    }
    throw new Error("O arquivo contém texto que não é um JSON válido.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("A estrutura principal do arquivo de backup é inválida.");
  }
  const root = parsed as Record<string, unknown>;
  if (root.format === BACKUP_FORMAT) {
    if (root.version !== BACKUP_VERSION) {
      throw new Error(`A versão deste backup (${String(root.version)}) não é compatível com esta instalação.`);
    }
    if (!root.tenant || typeof root.tenant !== "object" || Array.isArray(root.tenant) || !root.data || typeof root.data !== "object") {
      throw new Error("A estrutura do backup está incompleta ou é incompatível.");
    }
    validateIdentityFields(root.tenant as Record<string, unknown>);
    return root as ParsedBackup;
  }
  const meta = root.meta as Record<string, unknown> | undefined;
  const tenant = root.tenant as Record<string, unknown> | undefined;
  if (meta && tenant && typeof meta.formatVersion === "number") {
    if (meta.formatVersion < 1 || meta.formatVersion > 6) {
      throw new Error(`A versão legada deste backup (${meta.formatVersion}) não é compatível com esta instalação.`);
    }
    if (typeof tenant.id !== "string") throw new Error("O backup não identifica a agência de origem.");
    validateIdentityFields(tenant);
    return root as ParsedBackup;
  }
  throw new Error("Este arquivo não é um backup reconhecido do VisiteCRM.");
}

export async function validateBackupDownload(blob: Blob, contentType: string | null): Promise<Blob> {
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    throw new Error("O servidor retornou um conteúdo inesperado em vez do backup JSON.");
  }
  parseBackupText(await blob.text());
  return blob;
}
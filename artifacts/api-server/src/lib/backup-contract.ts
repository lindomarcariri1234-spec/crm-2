export const BACKUP_FORMAT = "visitecrm-agency-backup";
export const BACKUP_VERSION = 4;
export const LEGACY_FLAT_BACKUP_MIN_VERSION = 1;
export const LEGACY_FLAT_BACKUP_MAX_VERSION = 6;

export interface BackupTenantIdentity {
  id: string;
  name?: string | null;
  slug?: string | null;
  email?: string | null;
  cnpj?: string | null;
}

export interface CanonicalBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt?: string;
  exportedByUserId?: string;
  tenant: BackupTenantIdentity;
  data: Record<string, unknown>;
  counts?: Record<string, number>;
}

export type BackupContractErrorCode =
  | "BACKUP_IMPORT_UNKNOWN_FORMAT"
  | "BACKUP_IMPORT_VERSION_MISMATCH"
  | "BACKUP_IMPORT_INVALID";

export class BackupContractError extends Error {
  constructor(
    message: string,
    readonly code: BackupContractErrorCode,
  ) {
    super(message);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalIdentityString(
  owner: Record<string, unknown>,
  key: "name" | "slug" | "email" | "cnpj",
): string | null | undefined {
  const value = owner[key];
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string") return value;
  throw new BackupContractError(
    `O campo de identidade "${key}" da agência é inválido.`,
    "BACKUP_IMPORT_INVALID",
  );
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function flattenChildren(rows: unknown[], key: string, parentKey: string): unknown[] {
  return rows.flatMap((raw) => {
    const row = record(raw);
    if (!row) return [];
    return array(row[key]).map((child) => {
      const childRow = record(child);
      return childRow ? { ...childRow, [parentKey]: row.id } : child;
    });
  });
}

function withoutEmbedded(rows: unknown[], keys: string[]): unknown[] {
  return rows.map((raw) => {
    const row = record(raw);
    if (!row) return raw;
    const copy = { ...row };
    for (const key of keys) delete copy[key];
    return copy;
  });
}

function normalizeLegacyFlatBackup(root: Record<string, unknown>): CanonicalBackup {
  const meta = record(root.meta);
  const tenant = record(root.tenant);
  if (!meta || !tenant || typeof meta.formatVersion !== "number") {
    throw new BackupContractError(
      "Este arquivo não é um backup de agência do VisiteCRM reconhecido.",
      "BACKUP_IMPORT_UNKNOWN_FORMAT",
    );
  }
  if (
    meta.formatVersion < LEGACY_FLAT_BACKUP_MIN_VERSION ||
    meta.formatVersion > LEGACY_FLAT_BACKUP_MAX_VERSION
  ) {
    throw new BackupContractError(
      `Versão legada do backup (${meta.formatVersion}) incompatível com esta instalação.`,
      "BACKUP_IMPORT_VERSION_MISMATCH",
    );
  }
  if (typeof tenant.id !== "string" || !tenant.id) {
    throw new BackupContractError("O backup não identifica a agência de origem.", "BACKUP_IMPORT_INVALID");
  }

  const clients = array(root.clients);
  const trips = array(root.trips);
  const reservations = array(root.reservations);
  const store = record(root.store) ?? {};
  const orders = array(store.orders);
  const automations = array(root.automations);
  const loyalty = record(root.loyalty) ?? {};
  const referrals = record(root.referrals) ?? {};
  const settlements = record(root.settlements) ?? {};
  const marketing = record(root.marketing) ?? {};
  const clientNps = record(root.clientNps) ?? {};

  const sourceTenant: BackupTenantIdentity = {
    id: tenant.id,
    name: optionalIdentityString(tenant, "name") ?? (typeof meta.tenantName === "string" ? meta.tenantName : null),
    slug: optionalIdentityString(tenant, "slug") ?? (typeof meta.tenantSlug === "string" ? meta.tenantSlug : null),
    email: optionalIdentityString(tenant, "email") ?? null,
    cnpj: optionalIdentityString(tenant, "cnpj") ?? null,
  };

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof meta.exportedAt === "string" ? meta.exportedAt : undefined,
    tenant: sourceTenant,
    data: {
      agencia: tenant,
      usuarios: { users: array(root.users), invites: array(root.invites) },
      configuracoes: [],
      clientes: {
        clients: withoutEmbedded(clients, ["notes", "achievements", "dreamDestinationRecords", "favorites", "scores"]),
        notes: flattenChildren(clients, "notes", "clientId"),
        achievements: flattenChildren(clients, "achievements", "clientId"),
        dreamDestinations: flattenChildren(clients, "dreamDestinationRecords", "clientId"),
        favorites: flattenChildren(clients, "favorites", "clientId"),
        notifications: [],
        scores: clients.flatMap((raw) => {
          const row = record(raw);
          const score = record(row?.scores);
          return score ? [{ ...score, clientId: row?.id }] : [];
        }),
        npsResponses: array(clientNps.responses),
        npsInvitations: array(clientNps.invitations),
      },
      viagens: {
        trips: withoutEmbedded(trips, ["costs", "media", "checkins"]),
        media: flattenChildren(trips, "media", "tripId"),
        importBatches: [],
      },
      reservas: {
        reservations: withoutEmbedded(reservations, ["passengers", "installmentSchedule"]),
        passengers: flattenChildren(reservations, "passengers", "reservationId"),
        installments: flattenChildren(reservations, "installmentSchedule", "reservationId"),
        sequences: [],
      },
      embarqueCheckin: {
        boardingLocations: array(root.boardingLocations),
        checkins: flattenChildren(trips, "checkins", "tripId"),
        guideLocations: [],
      },
      automacoes: {
        automations: withoutEmbedded(automations, ["actions"]),
        actions: flattenChildren(automations, "actions", "automationId"),
        logs: [],
      },
      indicacoes: {
        referrals: array(referrals.records),
        settings: referrals.settings ? [referrals.settings] : [],
        campaigns: array(referrals.campaigns),
        commissions: array(referrals.commissions),
        tracking: [],
        attemptLogs: [],
      },
      loja: {
        store: store.info ? [store.info] : [],
        categories: array(store.categories),
        products: array(store.products),
        coupons: array(store.coupons),
        pages: array(store.pages),
        reviews: array(store.reviews),
        orders: withoutEmbedded(orders, ["items"]),
        orderItems: flattenChildren(orders, "items", "orderId"),
        priceAlertSubscriptions: array(store.priceAlerts),
      },
      cuponsCrm: array(root.agencyCoupons),
      financeiro: {
        payments: array(root.payments),
        expenses: array(root.expenses),
        tripCosts: flattenChildren(trips, "costs", "tripId"),
        settlementItems: array(settlements.items),
        ledgerEntries: array(settlements.ledgerEntries),
      },
      metasVendas: array(root.salesGoals),
      comissoes: { rules: array(root.commissionRules), entries: array(root.commissions) },
      pipeline: record(root.pipeline) ?? { pipelines: [], stages: [], deals: [] },
      fidelidade: {
        programs: array(loyalty.programs),
        members: array(loyalty.members),
        transactions: array(loyalty.transactions),
      },
      clube: record(root.club) ?? { config: [], benefits: [] },
      marketing: {
        campaigns: array(root.campaigns),
        campaignSends: [],
        npsResponses: array(root.npsResponses),
        catalogoPontos: {
          products: array(marketing.products),
          orders: array(marketing.orders),
          orderItems: flattenChildren(array(marketing.orders), "items", "orderId"),
        },
      },
      comunicacao: { messages: [], messageTemplates: array(root.messageTemplates), chatbotConversations: [], chatbotMessages: [], birthdayMessages: [], emailLogs: [], whatsappOutbox: [] },
      integracoes: { tenantIntegrations: [], tenantIntegrationLogs: [], aiIntegrations: [], aiIntegrationLogs: [] },
      inteligenciaArtificial: { gemeoAlerts: [], gemeoOpportunities: [], insightsChatHistory: [] },
      catalogoLegado: { categories: array(marketing.productCategories), images: flattenChildren(array(marketing.products), "images", "productId"), cartItems: [] },
      parceiros: { partners: array(root.partners), products: [], availability: [], commissions: [] },
      distribuicao: { offers: [], operations: [], bookings: [] },
      auditoria: [],
      calendario: array(root.calendarEvents),
      documentos: array(root.documents),
      cadastrosAuxiliares: {
        suppliers: array(root.suppliers),
        vehicles: array(root.vehicles),
        vehicleLayouts: array(root.vehicleLayouts),
        accommodations: array(root.accommodations),
        destinations: array(root.destinations),
      },
    },
    counts: record(root.counts) as Record<string, number> | undefined,
  };
}

export function normalizeBackupPayload(value: unknown): CanonicalBackup {
  const root = record(value);
  if (!root) {
    throw new BackupContractError("A estrutura principal do backup é inválida.", "BACKUP_IMPORT_INVALID");
  }

  if ("meta" in root && !("format" in root)) return normalizeLegacyFlatBackup(root);

  if (root.format !== BACKUP_FORMAT) {
    throw new BackupContractError(
      "Este arquivo não é um backup de agência do VisiteCRM reconhecido.",
      "BACKUP_IMPORT_UNKNOWN_FORMAT",
    );
  }
  if (root.version !== BACKUP_VERSION) {
    throw new BackupContractError(
      `Versão do backup (${String(root.version)}) incompatível com a versão suportada (${BACKUP_VERSION}).`,
      "BACKUP_IMPORT_VERSION_MISMATCH",
    );
  }
  const tenant = record(root.tenant);
  const data = record(root.data);
  if (!tenant || typeof tenant.id !== "string" || !tenant.id || !data) {
    throw new BackupContractError("A estrutura do backup está incompleta ou é incompatível.", "BACKUP_IMPORT_INVALID");
  }
  return {
    ...root,
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    tenant: {
      id: tenant.id,
      name: optionalIdentityString(tenant, "name"),
      slug: optionalIdentityString(tenant, "slug"),
      email: optionalIdentityString(tenant, "email"),
      cnpj: optionalIdentityString(tenant, "cnpj"),
    },
    data,
  } as CanonicalBackup;
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase("pt-BR") ?? "";
}

function normalizeCnpj(value: string | null | undefined): string {
  return value?.replace(/\D/g, "") ?? "";
}

export function isSameLogicalAgency(source: BackupTenantIdentity, destination: BackupTenantIdentity): boolean {
  if (source.id === destination.id) return true;
  const sourceCnpj = normalizeCnpj(source.cnpj);
  const destinationCnpj = normalizeCnpj(destination.cnpj);
  if (sourceCnpj && destinationCnpj && sourceCnpj === destinationCnpj) return true;
  const sourceEmail = normalizeText(source.email);
  const destinationEmail = normalizeText(destination.email);
  if (sourceEmail && destinationEmail && sourceEmail === destinationEmail) return true;
  const sourceSlug = normalizeText(source.slug);
  const destinationSlug = normalizeText(destination.slug);
  return Boolean(sourceSlug && destinationSlug && sourceSlug === destinationSlug);
}
import { and, eq, sql, getTableColumns } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import {
  db,
  tenantsTable,
  usersTable,
  clientsTable,
  tripsTable,
  reservationsTable,
  passengersTable,
  boardingLocationsTable,
  tripCheckinsTable,
  automationsTable,
  automationActionsTable,
  automationLogsTable,
  referralsTable,
  storesTable,
  storeProductsTable,
  storeCouponsTable,
  storeOrdersTable,
  storeOrderItemsTable,
  paymentsTable,
  expensesTable,
  backupImportRecordsTable,
  invitesTable,
  clientAchievementsTable,
  clientDreamDestinationsTable,
  clientNotificationsTable,
  suppliersTable,
  vehiclesTable,
  vehicleLayoutsTable,
  accommodationsTable,
  destinationsTable,
  tripMediaTable,
  pipelinesTable,
  pipelineStagesTable,
  dealsTable,
  loyaltyProgramsTable,
  loyaltyMembersTable,
  loyaltyTransactionsTable,
  settlementItemsTable,
  financialLedgerEntriesTable,
  calendarEventsTable,
  documentsTable,
  campaignsTable,
  campaignSendsTable,
  npsResponsesTable,
  distributionOffersTable,
  distributionOperationsTable,
  distributionBookingsTable,
  type BackupImportGroupResult,
  type BackupImportReport,
  type BackupImportUserMatch,
} from "@workspace/db";
import { generateId, generateVoucherCode, generateReferralCode, generateReferralCodeSuffix } from "./id.js";
import { getTenantReservationPrefix, tripTypeToCode, getYearMonth, nextReservationSequence, buildReservationNumber } from "./reservation-number.js";

/** The db.transaction callback argument shape used throughout this module (drizzle's `tx`). */
export type ImportTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type RowRecord = Record<string, unknown>;

function emptyGroupResult(): BackupImportGroupResult {
  return { created: 0, duplicate: 0, skipped: 0, errors: [] };
}

export function emptyReport(): BackupImportReport {
  return {
    agencia: { updated: false },
    usuarios: { matched: 0, fallbackToImporter: 0, fallbackDetails: [] },
    clientes: emptyGroupResult(),
    viagens: emptyGroupResult(),
    reservas: emptyGroupResult(),
    passageiros: emptyGroupResult(),
    embarqueLocais: emptyGroupResult(),
    checkins: emptyGroupResult(),
    automacoes: emptyGroupResult(),
    automacaoAcoes: emptyGroupResult(),
    automacaoLogs: emptyGroupResult(),
    indicacoes: emptyGroupResult(),
    lojaProdutos: emptyGroupResult(),
    lojaCupons: emptyGroupResult(),
    lojaPedidos: emptyGroupResult(),
    lojaItensPedido: emptyGroupResult(),
    pagamentos: emptyGroupResult(),
    despesas: emptyGroupResult(),
    convites: emptyGroupResult(),
    clientesConquistas: emptyGroupResult(),
    clientesDestinosSonho: emptyGroupResult(),
    clientesNotificacoes: emptyGroupResult(),
    fornecedores: emptyGroupResult(),
    veiculos: emptyGroupResult(),
    layoutsVeiculo: emptyGroupResult(),
    hospedagens: emptyGroupResult(),
    destinos: emptyGroupResult(),
    viagensMidia: emptyGroupResult(),
    pipelines: emptyGroupResult(),
    etapasPipeline: emptyGroupResult(),
    negociacoes: emptyGroupResult(),
    fidelidadeProgramas: emptyGroupResult(),
    fidelidadeMembros: emptyGroupResult(),
    fidelidadeTransacoes: emptyGroupResult(),
    financeiroAcertos: emptyGroupResult(),
    financeiroLancamentos: emptyGroupResult(),
    calendario: emptyGroupResult(),
    documentos: emptyGroupResult(),
    marketingCampanhas: emptyGroupResult(),
    marketingEnvios: emptyGroupResult(),
    marketingNps: emptyGroupResult(),
    distribuicaoOfertas: emptyGroupResult(),
    distribuicaoOperacoes: emptyGroupResult(),
    distribuicaoReservas: emptyGroupResult(),
    naoRestaurado: NOT_RESTORED_SECTIONS,
  };
}

/**
 * Export section keys (matching the export's own dot-path JSON structure)
 * that this importer deliberately does not restore: operational logs,
 * legacy/duplicate data superseded by other tables, provider secrets/config
 * that must never be silently re-activated, or references too ambiguous to
 * remap safely (e.g. free-form polymorphic ids with no ledger entry). Kept
 * as a static list — the export's shape only changes alongside BACKUP_VERSION,
 * at which point this list should be revisited too.
 */
export const NOT_RESTORED_SECTIONS: string[] = [
  "configuracoes",
  "clientes.notes",
  "clientes.npsResponses",
  "clientes.npsInvitations",
  "clientes.favorites",
  "clientes.scores",
  "viagens.importBatches",
  "reservas.installments",
  "reservas.sequences",
  "embarqueCheckin.guideLocations",
  "indicacoes.tracking",
  "indicacoes.settings",
  "indicacoes.campaigns",
  "indicacoes.commissions",
  "indicacoes.attemptLogs",
  "loja.categories",
  "loja.reviews",
  "loja.pages",
  "loja.priceAlertSubscriptions",
  "cuponsCrm",
  "financeiro.tripCosts",
  "metasVendas",
  "comissoes.rules",
  "comissoes.entries",
  "clube.config",
  "clube.benefits",
  "marketing.catalogoPontos.products",
  "marketing.catalogoPontos.orders",
  "marketing.catalogoPontos.orderItems",
  "comunicacao.messages",
  "comunicacao.messageTemplates",
  "comunicacao.chatbotConversations",
  "comunicacao.chatbotMessages",
  "comunicacao.birthdayMessages",
  "comunicacao.emailLogs",
  "comunicacao.whatsappOutbox",
  "integracoes.tenantIntegrations",
  "integracoes.tenantIntegrationLogs",
  "integracoes.aiIntegrations",
  "integracoes.aiIntegrationLogs",
  "inteligenciaArtificial.gemeoAlerts",
  "inteligenciaArtificial.gemeoOpportunities",
  "inteligenciaArtificial.insightsChatHistory",
  "catalogoLegado.categories",
  "catalogoLegado.images",
  "catalogoLegado.cartItems",
  "parceiros.partners",
  "parceiros.products",
  "parceiros.availability",
  "parceiros.commissions",
  "auditoria",
];

// ── Row-level dedup ledger ──────────────────────────────────────────────
// Keyed by (entityType, sourceId-from-the-backup-file) → the id assigned to
// the row the first time it was imported. Persisted in backupImportRecordsTable
// so re-importing the same (or a partially-imported) file later, even under a
// different idempotency key, still recognizes already-restored rows.
export type Ledger = Map<string, Map<string, string>>;

export async function loadLedger(tx: ImportTx, tenantId: string): Promise<Ledger> {
  const rows = await tx.select().from(backupImportRecordsTable).where(eq(backupImportRecordsTable.tenantId, tenantId));
  const ledger: Ledger = new Map();
  for (const row of rows) {
    if (!ledger.has(row.entityType)) ledger.set(row.entityType, new Map());
    ledger.get(row.entityType)!.set(row.sourceId, row.targetId);
  }
  return ledger;
}

function ledgerGet(ledger: Ledger, entityType: string, sourceId: string | null | undefined): string | undefined {
  if (!sourceId) return undefined;
  return ledger.get(entityType)?.get(sourceId);
}

async function ledgerSet(tx: ImportTx, ledger: Ledger, tenantId: string, entityType: string, sourceId: string, targetId: string): Promise<void> {
  await tx.insert(backupImportRecordsTable).values({
    id: generateId(),
    tenantId,
    entityType,
    sourceId,
    targetId,
  }).onConflictDoNothing({
    target: [backupImportRecordsTable.tenantId, backupImportRecordsTable.entityType, backupImportRecordsTable.sourceId],
  });
  if (!ledger.has(entityType)) ledger.set(entityType, new Map());
  ledger.get(entityType)!.set(sourceId, targetId);
}

type InsertOutcome = { status: "created" } | { status: "skip"; reason: string };

/**
 * Drives one backup array through dedup + insertion, honoring the ledger.
 * `handler` receives a transaction scoped to just this row, the raw backup
 * row, and the freshly generated id it should use if it decides to create a
 * row, and returns whether it did.
 *
 * Each row runs inside its own SAVEPOINT (via a nested `tx.transaction`,
 * which drizzle implements as SAVEPOINT/RELEASE/ROLLBACK TO SAVEPOINT on
 * Postgres). This is required, not an optimization: once any statement in a
 * Postgres transaction errors, the whole transaction is poisoned and every
 * later statement fails with "current transaction is aborted" even if the
 * application catches the first error — so without a savepoint per row, one
 * bad row would silently zero out every group processed afterward instead
 * of surfacing as a single row-level error in the report.
 */
async function importRows(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  entityType: string,
  rows: unknown,
  result: BackupImportGroupResult,
  handler: (rowTx: ImportTx, row: RowRecord, newId: string) => Promise<InsertOutcome>,
): Promise<void> {
  if (!Array.isArray(rows)) return;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") {
      result.errors.push({ error: "Registro inválido (não é um objeto JSON)" });
      continue;
    }
    const row = raw as RowRecord;
    const sourceId = typeof row.id === "string" && row.id ? row.id : undefined;
    if (!sourceId) {
      result.errors.push({ error: "Registro sem id válido" });
      continue;
    }
    if (ledgerGet(ledger, entityType, sourceId)) {
      result.duplicate++;
      continue;
    }
    const newId = generateId();
    try {
      const outcome = await tx.transaction(async (rowTx: ImportTx) => {
        const res = await handler(rowTx, row, newId);
        if (res.status === "created") {
          await ledgerSet(rowTx, ledger, tenantId, entityType, sourceId, newId);
        }
        return res;
      });
      if (outcome.status === "skip") {
        result.skipped++;
        continue;
      }
      result.created++;
    } catch (err) {
      const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
      result.errors.push({ sourceId, error: (err instanceof Error ? err.message : String(err)) + cause });
    }
  }
}

function str(row: RowRecord, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function dateVal(row: RowRecord, key: string): Date | null {
  const v = row[key];
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A backup file is JSON: every timestamp column comes back as an ISO string,
 * never a `Date` instance. Drizzle's default timestamp columns assume a
 * `Date` (their driver mapper calls `value.toISOString()` unconditionally),
 * so any string surviving unchanged into an insert throws
 * "value.toISOString is not a function". This revives every column the
 * table itself declares as a date/timestamp type, generically, so no
 * per-entity date field list needs to be hand-maintained (and kept in sync
 * as columns are added).
 */
function reviveDates(table: AnyPgTable, values: RowRecord): void {
  const columns = getTableColumns(table);
  for (const [key, column] of Object.entries(columns)) {
    if ((column as { dataType?: string }).dataType !== "date") continue;
    const v = values[key];
    if (typeof v !== "string") continue;
    const d = new Date(v);
    values[key] = Number.isNaN(d.getTime()) ? null : d;
  }
}

async function insertRow(tx: ImportTx, table: AnyPgTable, values: RowRecord): Promise<void> {
  reviveDates(table, values);
  await tx.insert(table).values(values as never);
}

/**
 * Clones a raw backup row, stripping keys the import always regenerates or
 * remaps explicitly, so a plain `{ ...cleanRow(row), ...overrides }` cannot
 * accidentally reuse a stale value the caller forgot to override.
 */
function cleanRow(row: RowRecord, drop: string[]): RowRecord {
  const clone: RowRecord = { ...row };
  for (const key of drop) delete clone[key];
  return clone;
}

// ── Usuários (referência apenas — nunca cria contas) ────────────────────

export interface UserResolution {
  /** oldUserId → resolved current user id (matched by email, or the importer). */
  map: Map<string, string>;
  matched: number;
  fallbackToImporter: number;
  fallbackDetails: BackupImportUserMatch[];
}

export async function resolveUsers(tx: ImportTx, tenantId: string, importerId: string, backupUsers: unknown): Promise<UserResolution> {
  const rows = Array.isArray(backupUsers) ? backupUsers as RowRecord[] : [];
  const existing = await tx.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.tenantId, tenantId));
  const byEmail = new Map(existing.map((u) => [u.email.trim().toLowerCase(), u.id]));
  const map = new Map<string, string>();
  let matched = 0;
  let fallbackToImporter = 0;
  const fallbackDetails: BackupImportUserMatch[] = [];
  for (const row of rows) {
    const sourceId = str(row, "id");
    if (!sourceId) continue;
    const email = str(row, "email");
    const foundId = email ? byEmail.get(email.trim().toLowerCase()) : undefined;
    if (foundId) {
      map.set(sourceId, foundId);
      matched++;
    } else {
      map.set(sourceId, importerId);
      fallbackToImporter++;
      fallbackDetails.push({ sourceId, email, name: str(row, "name") });
    }
  }
  return { map, matched, fallbackToImporter, fallbackDetails };
}

/** Attribution-style user reference (createdById, etc): unknown/missing falls back to the importer. */
function resolveAttribution(users: UserResolution, importerId: string, oldUserId: unknown): string {
  if (typeof oldUserId === "string" && oldUserId) {
    return users.map.get(oldUserId) ?? importerId;
  }
  return importerId;
}

/** Identity-link user reference (clients.userId — a portal login): unknown/missing must be null, never the importer. */
function resolveIdentityLink(users: UserResolution, oldUserId: unknown): string | null {
  if (typeof oldUserId === "string" && oldUserId) {
    return users.map.get(oldUserId) ?? null;
  }
  return null;
}

/** Soft attribution (sellerId, checkedInByUserRef): unknown/missing is left unattributed (null) rather than misattributed to the importer. */
function resolveSoftAttribution(users: UserResolution, oldUserId: unknown): string | null {
  if (typeof oldUserId === "string" && oldUserId) {
    return users.map.get(oldUserId) ?? null;
  }
  return null;
}

function remapFinancialActor(
  ledger: Ledger,
  users: UserResolution,
  tenantId: string,
  actorType: string | null,
  oldActorId: string | null,
): string | null {
  if (!oldActorId) return null;
  if (actorType === "agency") return tenantId;
  if (actorType === "client") return ledgerGet(ledger, "client", oldActorId) ?? null;
  if (actorType === "user" || actorType === "seller") return resolveSoftAttribution(users, oldActorId);
  // Partner records are deliberately not restored, and unknown actor types
  // cannot be mapped safely. Never retain a source-installation identifier.
  return null;
}

// ── Agência (branding/config) — update in place, never touches billing/plan fields ──

const AGENCY_ALLOWED_FIELDS = [
  "name", "email", "cnpj", "address", "city", "state", "zipCode", "whatsapp", "phone",
  "logoUrl", "primaryColor", "secondaryColor", "settings", "website", "reservationPrefix",
] as const;

export async function importAgencia(tx: ImportTx, tenantId: string, agencia: unknown): Promise<{ updated: boolean }> {
  if (!agencia || typeof agencia !== "object") return { updated: false };
  const row = agencia as RowRecord;
  const values: RowRecord = {};
  for (const key of AGENCY_ALLOWED_FIELDS) {
    if (key in row) values[key] = row[key];
  }
  if (Object.keys(values).length === 0) return { updated: false };
  await tx.update(tenantsTable).set(values).where(eq(tenantsTable.id, tenantId));
  return { updated: true };
}

// ── Clientes ─────────────────────────────────────────────────────────────

async function nextCustomerCode(tx: ImportTx, tenantId: string): Promise<string> {
  const [tenantRow] = await tx
    .update(tenantsTable)
    .set({ lastClientSeq: sql`${tenantsTable.lastClientSeq} + 1` })
    .where(eq(tenantsTable.id, tenantId))
    .returning({ lastClientSeq: tenantsTable.lastClientSeq, reservationPrefix: tenantsTable.reservationPrefix, slug: tenantsTable.slug });
  const seq = tenantRow?.lastClientSeq ?? 1;
  const rawPrefix = tenantRow?.reservationPrefix?.trim() || tenantRow?.slug?.slice(0, 3) || "CLI";
  const prefix = rawPrefix.toUpperCase();
  const yyyymm = getYearMonth();
  return `${prefix}-${yyyymm}-${String(seq).padStart(5, "0")}`;
}

async function assignFreshReferralCode(tx: ImportTx, tenantId: string, clientName: string | null): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attempt === 0
      ? generateReferralCode(clientName ?? "REF", tenantId)
      : `${(clientName ?? "REF").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4) || "REF"}${generateReferralCodeSuffix()}`;
    const [existing] = await tx.select({ id: clientsTable.id }).from(clientsTable)
      .where(and(eq(clientsTable.tenantId, tenantId), eq(clientsTable.referralCode, candidate)))
      .limit(1);
    if (!existing) return candidate;
  }
  // Astronomically unlikely, but never loop forever.
  return `${generateReferralCode(clientName ?? "REF", tenantId)}${generateReferralCodeSuffix(4)}`;
}

export async function importClientes(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  importerId: string,
  users: UserResolution,
  clientes: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  // referredById is patched in a second pass below, once every client in this
  // backup has a resolved new id — a referrer client may appear later in the array.
  const pendingReferredBy: Array<{ newId: string; oldReferredById: string }> = [];

  await importRows(tx, ledger, tenantId, "client", clientes, result, async (rtx, row, newId) => {
    const name = str(row, "name");
    const hadCustomerCode = Boolean(str(row, "customerCode"));
    const hadReferralCode = Boolean(str(row, "referralCode"));
    const customerCode = hadCustomerCode ? await nextCustomerCode(rtx, tenantId) : null;
    const referralCode = hadReferralCode ? await assignFreshReferralCode(rtx, tenantId, name) : null;
    const oldReferredById = str(row, "referredById");
    if (oldReferredById) pendingReferredBy.push({ newId, oldReferredById });

    const values = {
      ...cleanRow(row, ["id", "tenantId", "createdById", "userId", "customerCode", "referralCode", "referralCodeGeneratedAt", "referredById", "expoPushToken"]),
      id: newId,
      tenantId,
      createdById: resolveAttribution(users, importerId, row.createdById),
      userId: resolveIdentityLink(users, row.userId),
      customerCode,
      referralCode,
      referralCodeGeneratedAt: referralCode ? new Date() : null,
      referredById: null as string | null,
    };
    await insertRow(rtx, clientsTable, values);
    return { status: "created" };
  });

  for (const { newId, oldReferredById } of pendingReferredBy) {
    const referrerNewId = ledgerGet(ledger, "client", oldReferredById);
    if (referrerNewId) {
      await tx.update(clientsTable).set({ referredById: referrerNewId }).where(and(
        eq(clientsTable.id, newId),
        eq(clientsTable.tenantId, tenantId),
      ));
    }
  }
}

// ── Viagens ──────────────────────────────────────────────────────────────

export async function importViagens(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  importerId: string,
  users: UserResolution,
  trips: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "trip", trips, result, async (rtx, row, newId) => {
    const oldLayoutId = str(row, "layoutId");
    const layoutId = oldLayoutId ? ledgerGet(ledger, "vehicleLayout", oldLayoutId) ?? null : null;
    const oldVehicleId = str(row, "vehicleId");
    const vehicleId = oldVehicleId ? ledgerGet(ledger, "vehicle", oldVehicleId) ?? null : null;
    const values = {
      ...cleanRow(row, ["id", "tenantId", "createdById", "importFingerprint", "layoutId", "vehicleId"]),
      id: newId,
      tenantId,
      createdById: resolveAttribution(users, importerId, row.createdById),
      // Never carried over: this tenant's other trips may already occupy the
      // same fingerprint, and dedup for restore is handled by the ledger, not
      // this unique index.
      importFingerprint: null,
      // Remapped through the ledger when the vehicle-layout catalog was
      // imported first (see importLayoutsVeiculo); otherwise cleared — the
      // trip's own seatMap/seatLayout/totalCapacity are cloned as-is
      // regardless, only the named-layout link depends on this.
      layoutId,
      vehicleId,
    };
    await insertRow(rtx, tripsTable, values);
    return { status: "created" };
  });
}

// ── Viagens: mídia ───────────────────────────────────────────────────────

export async function importViagensMidia(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  users: UserResolution,
  media: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "tripMedia", media, result, async (rtx, row, newId) => {
    const oldTripId = str(row, "tripId");
    const tripId = oldTripId ? ledgerGet(ledger, "trip", oldTripId) : undefined;
    if (!tripId) return { status: "skip", reason: "Viagem de origem não foi importada" };
    const values = {
      ...cleanRow(row, ["id", "tenantId", "tripId", "uploadedByUserId"]),
      id: newId,
      tenantId,
      tripId,
      uploadedByUserId: resolveSoftAttribution(users, row.uploadedByUserId),
    };
    await insertRow(rtx, tripMediaTable, values);
    return { status: "created" };
  });
}

// ── Cadastros auxiliares (fornecedores, veículos, layouts, hospedagens, destinos) ──
// Standalone tenant-scoped catalogs with no cross-entity FKs to remap besides
// tenantId itself.

export async function importFornecedores(
  tx: ImportTx, ledger: Ledger, tenantId: string, suppliers: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "supplier", suppliers, result, async (rtx, row, newId) => {
    const values = { ...cleanRow(row, ["id", "tenantId"]), id: newId, tenantId };
    await insertRow(rtx, suppliersTable, values);
    return { status: "created" };
  });
}

export async function importVeiculos(
  tx: ImportTx, ledger: Ledger, tenantId: string, vehicles: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "vehicle", vehicles, result, async (rtx, row, newId) => {
    const values = { ...cleanRow(row, ["id", "tenantId"]), id: newId, tenantId };
    await insertRow(rtx, vehiclesTable, values);
    return { status: "created" };
  });
}

export async function importLayoutsVeiculo(
  tx: ImportTx, ledger: Ledger, tenantId: string, vehicleLayouts: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "vehicleLayout", vehicleLayouts, result, async (rtx, row, newId) => {
    const values = { ...cleanRow(row, ["id", "tenantId"]), id: newId, tenantId };
    await insertRow(rtx, vehicleLayoutsTable, values);
    return { status: "created" };
  });
}

export async function importHospedagens(
  tx: ImportTx, ledger: Ledger, tenantId: string, accommodations: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "accommodation", accommodations, result, async (rtx, row, newId) => {
    const values = { ...cleanRow(row, ["id", "tenantId"]), id: newId, tenantId };
    await insertRow(rtx, accommodationsTable, values);
    return { status: "created" };
  });
}

export async function importDestinos(
  tx: ImportTx, ledger: Ledger, tenantId: string, destinations: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "destination", destinations, result, async (rtx, row, newId) => {
    const values = { ...cleanRow(row, ["id", "tenantId"]), id: newId, tenantId };
    await insertRow(rtx, destinationsTable, values);
    return { status: "created" };
  });
}

// ── Embarque: locais de embarque (cadastro autônomo, sem FK de reservas/passageiros) ──

export async function importBoardingLocations(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  boardingLocations: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "boardingLocation", boardingLocations, result, async (rtx, row, newId) => {
    const values = {
      ...cleanRow(row, ["id", "tenantId"]),
      id: newId,
      tenantId,
    };
    await insertRow(rtx, boardingLocationsTable, values);
    return { status: "created" };
  });
}

// ── Loja: lookup do store existente (nunca recria configurações da loja) ──

export async function findExistingStoreId(tx: ImportTx, tenantId: string): Promise<string | undefined> {
  const [store] = await tx.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.tenantId, tenantId)).limit(1);
  return store?.id;
}

export async function importLojaProdutos(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  storeId: string | undefined,
  produtos: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "storeProduct", produtos, result, async (rtx, row, newId) => {
    if (!storeId) return { status: "skip", reason: "Agência ainda não possui uma loja configurada" };
    const oldTripId = str(row, "tripId");
    const tripId = oldTripId ? ledgerGet(ledger, "trip", oldTripId) ?? null : null;
    const values = {
      ...cleanRow(row, ["id", "storeId", "categoryId", "tripId", "partnerProductId"]),
      id: newId,
      storeId,
      // Categories are out of import scope; the destination tenant's category
      // ids never match the backup's, and categoryId is a real FK constraint.
      categoryId: null,
      tripId,
      partnerProductId: null,
    };
    await insertRow(rtx, storeProductsTable, values);
    return { status: "created" };
  });
}

export async function importLojaCupons(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  storeId: string | undefined,
  cupons: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "storeCoupon", cupons, result, async (rtx, row, newId) => {
    if (!storeId) return { status: "skip", reason: "Agência ainda não possui uma loja configurada" };
    const values = {
      ...cleanRow(row, ["id", "storeId"]),
      id: newId,
      storeId,
    };
    await insertRow(rtx, storeCouponsTable, values);
    return { status: "created" };
  });
}

export async function importLojaPedidos(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  storeId: string | undefined,
  pedidos: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "storeOrder", pedidos, result, async (rtx, row, newId) => {
    if (!storeId) return { status: "skip", reason: "Agência ainda não possui uma loja configurada" };
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) ?? null : null;
    const oldCouponId = str(row, "couponId");
    const couponId = oldCouponId ? ledgerGet(ledger, "storeCoupon", oldCouponId) ?? null : null;

    let orderNumber = str(row, "orderNumber");
    if (orderNumber) {
      const [existing] = await rtx.select({ id: storeOrdersTable.id }).from(storeOrdersTable).where(eq(storeOrdersTable.orderNumber, orderNumber)).limit(1);
      if (existing) orderNumber = null;
    }
    if (!orderNumber) {
      orderNumber = `#${new Date().getFullYear()}-${generateId().slice(0, 6).toUpperCase()}`;
    }

    const values = {
      ...cleanRow(row, ["id", "storeId", "tenantId", "clientId", "couponId", "orderNumber", "idempotencyKey", "paymentToken"]),
      id: newId,
      storeId,
      tenantId,
      clientId,
      couponId,
      orderNumber,
      idempotencyKey: null,
      paymentToken: null,
    };
    await insertRow(rtx, storeOrdersTable, values);
    return { status: "created" };
  });
}

export async function importLojaItensPedido(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  itens: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "storeOrderItem", itens, result, async (rtx, row, newId) => {
    const oldOrderId = str(row, "orderId");
    const orderId = oldOrderId ? ledgerGet(ledger, "storeOrder", oldOrderId) : undefined;
    if (!orderId) return { status: "skip", reason: "Pedido de origem não foi importado" };
    const oldProductId = str(row, "productId");
    const productId = oldProductId ? ledgerGet(ledger, "storeProduct", oldProductId) : undefined;
    if (!productId) return { status: "skip", reason: "Produto de origem não foi importado" };
    const values = {
      ...cleanRow(row, ["id", "orderId", "productId", "partnerId", "partnerProductId"]),
      id: newId,
      orderId,
      productId,
      partnerId: null,
      partnerProductId: null,
    };
    await insertRow(rtx, storeOrderItemsTable, values);
    return { status: "created" };
  });
}

// ── Reservas / passageiros ───────────────────────────────────────────────

async function resolveVoucherCode(tx: ImportTx, original: string | null): Promise<string> {
  if (original) {
    const [existing] = await tx.select({ id: reservationsTable.id }).from(reservationsTable).where(eq(reservationsTable.voucherCode, original)).limit(1);
    if (!existing) return original;
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateVoucherCode();
    const [existing] = await tx.select({ id: reservationsTable.id }).from(reservationsTable).where(eq(reservationsTable.voucherCode, candidate)).limit(1);
    if (!existing) return candidate;
  }
  return `${generateVoucherCode()}${generateVoucherCode()}`;
}

export async function importReservas(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  importerId: string,
  users: UserResolution,
  reservas: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  const prefix = await getTenantReservationPrefix(tenantId);
  await importRows(tx, ledger, tenantId, "reservation", reservas, result, async (rtx, row, newId) => {
    const oldTripId = str(row, "tripId");
    const tripId = oldTripId ? ledgerGet(ledger, "trip", oldTripId) : undefined;
    if (!tripId) return { status: "skip", reason: "Viagem de origem não foi importada" };
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) ?? null : null;
    const oldStoreOrderId = str(row, "storeOrderId");
    const storeOrderId = oldStoreOrderId ? ledgerGet(ledger, "storeOrder", oldStoreOrderId) ?? null : null;

    const voucherCode = await resolveVoucherCode(rtx, str(row, "voucherCode"));
    const typeCode = tripTypeToCode(str(row, "tripType"));
    const createdAt = dateVal(row, "createdAt") ?? new Date();
    const yearMonth = getYearMonth(createdAt);
    const seq = await nextReservationSequence(tenantId, yearMonth, typeCode, rtx);
    const reservationNumber = buildReservationNumber(prefix, typeCode, yearMonth, seq);

    const values = {
      ...cleanRow(row, ["id", "tenantId", "tripId", "clientId", "sellerId", "createdById", "storeOrderId", "voucherCode", "qrCode", "reservationNumber"]),
      id: newId,
      tenantId,
      tripId,
      clientId,
      sellerId: resolveSoftAttribution(users, row.sellerId),
      createdById: resolveAttribution(users, importerId, row.createdById),
      storeOrderId,
      voucherCode,
      qrCode: `QR-${voucherCode}`,
      reservationNumber,
    };
    await insertRow(rtx, reservationsTable, values);
    return { status: "created" };
  });
}

export async function importPassageiros(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  passageiros: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "passenger", passageiros, result, async (rtx, row, newId) => {
    const oldReservationId = str(row, "reservationId");
    const reservationId = oldReservationId ? ledgerGet(ledger, "reservation", oldReservationId) : undefined;
    if (!reservationId) return { status: "skip", reason: "Reserva de origem não foi importada" };
    // boardingLocationId/disembarkLocationId reference trip.boardingPoints[].id
    // (a JSON array cloned verbatim with the trip), not the standalone
    // boarding_locations table — no remap needed, ids stay valid as-is.
    const values = {
      ...cleanRow(row, ["id", "reservationId"]),
      id: newId,
      reservationId,
    };
    await insertRow(rtx, passengersTable, values);
    return { status: "created" };
  });
}

export async function importCheckins(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  users: UserResolution,
  checkins: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "tripCheckin", checkins, result, async (rtx, row, newId) => {
    const oldTripId = str(row, "tripId");
    const tripId = oldTripId ? ledgerGet(ledger, "trip", oldTripId) : undefined;
    if (!tripId) return { status: "skip", reason: "Viagem de origem não foi importada" };
    const oldPassengerId = str(row, "passengerId");
    const passengerId = oldPassengerId ? ledgerGet(ledger, "passenger", oldPassengerId) : undefined;
    if (!passengerId) return { status: "skip", reason: "Passageiro de origem não foi importado" };
    const oldReservationId = str(row, "reservationId");
    const reservationId = oldReservationId ? ledgerGet(ledger, "reservation", oldReservationId) ?? null : null;
    const values = {
      ...cleanRow(row, ["id", "tenantId", "tripId", "passengerId", "reservationId", "checkedInByUserRef"]),
      id: newId,
      tenantId,
      tripId,
      passengerId,
      reservationId,
      checkedInByUserRef: resolveSoftAttribution(users, row.checkedInByUserRef),
    };
    await insertRow(rtx, tripCheckinsTable, values);
    return { status: "created" };
  });
}

// ── Automações ───────────────────────────────────────────────────────────

export async function importAutomacoes(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  automacoes: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "automation", automacoes, result, async (rtx, row, newId) => {
    const values = { ...cleanRow(row, ["id", "tenantId"]), id: newId, tenantId };
    await insertRow(rtx, automationsTable, values);
    return { status: "created" };
  });
}

export async function importAutomacaoAcoes(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  acoes: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "automationAction", acoes, result, async (rtx, row, newId) => {
    const oldAutomationId = str(row, "automationId");
    const automationId = oldAutomationId ? ledgerGet(ledger, "automation", oldAutomationId) : undefined;
    if (!automationId) return { status: "skip", reason: "Automação de origem não foi importada" };
    const values = { ...cleanRow(row, ["id", "tenantId", "automationId"]), id: newId, tenantId, automationId };
    await insertRow(rtx, automationActionsTable, values);
    return { status: "created" };
  });
}

export async function importAutomacaoLogs(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  logs: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "automationLog", logs, result, async (rtx, row, newId) => {
    const oldAutomationId = str(row, "automationId");
    const automationId = oldAutomationId ? ledgerGet(ledger, "automation", oldAutomationId) : undefined;
    if (!automationId) return { status: "skip", reason: "Automação de origem não foi importada" };
    const values = { ...cleanRow(row, ["id", "tenantId", "automationId"]), id: newId, tenantId, automationId };
    await insertRow(rtx, automationLogsTable, values);
    return { status: "created" };
  });
}

// ── Indicações ───────────────────────────────────────────────────────────

export async function importIndicacoes(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  referrals: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "referral", referrals, result, async (rtx, row, newId) => {
    const oldReferrerId = str(row, "referrerId");
    const referrerId = oldReferrerId ? ledgerGet(ledger, "client", oldReferrerId) : undefined;
    if (!referrerId) return { status: "skip", reason: "Cliente indicador de origem não foi importado" };
    const oldReferredId = str(row, "referredId");
    const referredId = oldReferredId ? ledgerGet(ledger, "client", oldReferredId) ?? null : null;
    const oldReservationId = str(row, "reservationId");
    const reservationId = oldReservationId ? ledgerGet(ledger, "reservation", oldReservationId) ?? null : null;

    const [referrerClient] = await rtx.select({ referralCode: clientsTable.referralCode }).from(clientsTable).where(eq(clientsTable.id, referrerId)).limit(1);
    const code = referrerClient?.referralCode ?? str(row, "code") ?? generateReferralCodeSuffix();

    const values = {
      ...cleanRow(row, ["id", "tenantId", "referrerId", "referredId", "reservationId", "code", "campaignId"]),
      id: newId,
      tenantId,
      referrerId,
      referredId,
      reservationId,
      code,
      campaignId: null,
    };
    await insertRow(rtx, referralsTable, values);
    return { status: "created" };
  });
}

// ── Financeiro ───────────────────────────────────────────────────────────

export async function importPagamentos(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  pagamentos: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "payment", pagamentos, result, async (rtx, row, newId) => {
    const oldReservationId = str(row, "reservationId");
    const reservationId = oldReservationId ? ledgerGet(ledger, "reservation", oldReservationId) ?? null : null;
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) ?? null : null;
    const oldOrderId = str(row, "orderId");
    const orderId = oldOrderId ? ledgerGet(ledger, "storeOrder", oldOrderId) ?? null : null;
    const values = {
      ...cleanRow(row, ["id", "tenantId", "reservationId", "clientId", "orderId"]),
      id: newId,
      tenantId,
      reservationId,
      clientId,
      orderId,
    };
    await insertRow(rtx, paymentsTable, values);
    return { status: "created" };
  });
}

export async function importDespesas(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  importerId: string,
  users: UserResolution,
  despesas: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "expense", despesas, result, async (rtx, row, newId) => {
    const oldTripId = str(row, "tripId");
    const tripId = oldTripId ? ledgerGet(ledger, "trip", oldTripId) ?? null : null;
    const oldSupplierId = str(row, "supplierId");
    const supplierId = oldSupplierId ? ledgerGet(ledger, "supplier", oldSupplierId) ?? null : null;
    const values = {
      ...cleanRow(row, ["id", "tenantId", "tripId", "supplierId", "createdById"]),
      id: newId,
      tenantId,
      tripId,
      supplierId,
      createdById: resolveAttribution(users, importerId, row.createdById),
    };
    await insertRow(rtx, expensesTable, values);
    return { status: "created" };
  });
}

export async function importFinanceiroAcertos(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  users: UserResolution,
  settlementItems: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "settlementItem", settlementItems, result, async (rtx, row, newId) => {
    const oldOrderId = str(row, "orderId");
    const orderId = oldOrderId ? ledgerGet(ledger, "storeOrder", oldOrderId) : undefined;
    if (!orderId) return { status: "skip", reason: "Pedido de origem não foi importado" };
    const oldOrderItemId = str(row, "orderItemId");
    const orderItemId = oldOrderItemId ? ledgerGet(ledger, "storeOrderItem", oldOrderItemId) : undefined;
    if (!orderItemId) return { status: "skip", reason: "Item de pedido de origem não foi importado" };
    const [existing] = await rtx.select({ id: settlementItemsTable.id }).from(settlementItemsTable)
      .where(eq(settlementItemsTable.orderItemId, orderItemId))
      .limit(1);
    if (existing) {
      await ledgerSet(rtx, ledger, tenantId, "settlementItem", row.id as string, existing.id);
      return { status: "skip", reason: "Acerto já existe para o item de pedido" };
    }
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) ?? null : null;
    const sellerType = str(row, "sellerType");
    const sellerId = remapFinancialActor(ledger, users, tenantId, sellerType, str(row, "sellerId"));
    const values = {
      ...cleanRow(row, ["id", "tenantId", "orderId", "orderItemId", "clientId", "sellerId"]),
      id: newId,
      tenantId,
      orderId,
      orderItemId,
      clientId,
      sellerId,
    };
    await insertRow(rtx, settlementItemsTable, values);
    return { status: "created" };
  });
}

export async function importFinanceiroLancamentos(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  users: UserResolution,
  ledgerEntries: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  // reversalOfEntryId is patched in a second pass below, once every entry in
  // this backup has a resolved new id — a reversal may reference an entry
  // appearing later in the array.
  const pendingReversals: Array<{ newId: string; oldReversalOfEntryId: string }> = [];

  await importRows(tx, ledger, tenantId, "financialLedgerEntry", ledgerEntries, result, async (rtx, row, newId) => {
    const oldSettlementItemId = str(row, "settlementItemId");
    const settlementItemId = oldSettlementItemId ? ledgerGet(ledger, "settlementItem", oldSettlementItemId) ?? null : null;
    const oldOrderId = str(row, "orderId");
    const orderId = oldOrderId ? ledgerGet(ledger, "storeOrder", oldOrderId) ?? null : null;
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) ?? null : null;
    const participantType = str(row, "participantType");
    const participantId = remapFinancialActor(ledger, users, tenantId, participantType, str(row, "participantId"));
    const oldReversalOfEntryId = str(row, "reversalOfEntryId");
    if (oldReversalOfEntryId) pendingReversals.push({ newId, oldReversalOfEntryId });

    // idempotencyKey is unique per (tenant, key); the original value is kept
    // when still free, otherwise a fresh one is minted so the row isn't dropped.
    let idempotencyKey = str(row, "idempotencyKey");
    if (idempotencyKey) {
      const [existing] = await rtx.select({ id: financialLedgerEntriesTable.id }).from(financialLedgerEntriesTable)
        .where(and(eq(financialLedgerEntriesTable.tenantId, tenantId), eq(financialLedgerEntriesTable.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (existing) idempotencyKey = null;
    }
    if (!idempotencyKey) idempotencyKey = `restored-${newId}`;

    const values = {
      ...cleanRow(row, ["id", "tenantId", "settlementItemId", "orderId", "clientId", "participantId", "idempotencyKey", "reversalOfEntryId"]),
      id: newId,
      tenantId,
      settlementItemId,
      orderId,
      clientId,
      participantId,
      idempotencyKey,
      reversalOfEntryId: null as string | null,
    };
    await insertRow(rtx, financialLedgerEntriesTable, values);
    return { status: "created" };
  });

  for (const { newId, oldReversalOfEntryId } of pendingReversals) {
    const targetId = ledgerGet(ledger, "financialLedgerEntry", oldReversalOfEntryId);
    if (targetId) {
      await tx.update(financialLedgerEntriesTable).set({ reversalOfEntryId: targetId }).where(and(
        eq(financialLedgerEntriesTable.id, newId),
        eq(financialLedgerEntriesTable.tenantId, tenantId),
      ));
    }
  }
}

// ── Convites (pendentes) ─────────────────────────────────────────────────

export async function importConvites(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  users: UserResolution,
  invites: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "invite", invites, result, async (rtx, row, newId) => {
    if (row.accepted === true) {
      return { status: "skip", reason: "Convite já aceito não é reativado" };
    }
    const expiresAt = dateVal(row, "expiresAt");
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      return { status: "skip", reason: "Convite expirado não é reativado" };
    }
    const values = {
      ...cleanRow(row, ["id", "tenantId", "invitedBy", "token", "accepted", "acceptedAt"]),
      id: newId,
      tenantId,
      invitedBy: resolveSoftAttribution(users, row.invitedBy),
      // A fresh bearer token is minted: the original was stripped from the
      // export (it authorizes anonymous account creation by possession alone).
      token: generateId(),
      // Only pending, unexpired invites reach this point. A fresh bearer token
      // prevents credentials from crossing installations.
      accepted: false,
      acceptedAt: null,
    };
    await insertRow(rtx, invitesTable, values);
    return { status: "created" };
  });
}

// ── Clientes: conquistas / destinos dos sonhos / notificações ───────────

export async function importClientAchievements(
  tx: ImportTx, ledger: Ledger, tenantId: string, achievements: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "clientAchievement", achievements, result, async (rtx, row, newId) => {
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) : undefined;
    if (!clientId) return { status: "skip", reason: "Cliente de origem não foi importado" };
    const badgeKey = str(row, "badgeKey");
    if (badgeKey) {
      const [existing] = await rtx.select({ id: clientAchievementsTable.id }).from(clientAchievementsTable)
        .where(and(
          eq(clientAchievementsTable.tenantId, tenantId),
          eq(clientAchievementsTable.clientId, clientId),
          eq(clientAchievementsTable.badgeKey, badgeKey),
        ))
        .limit(1);
      if (existing) {
        await ledgerSet(rtx, ledger, tenantId, "clientAchievement", row.id as string, existing.id);
        return { status: "skip", reason: "Conquista já existe para o cliente" };
      }
    }
    const values = { ...cleanRow(row, ["id", "tenantId", "clientId"]), id: newId, tenantId, clientId };
    await insertRow(rtx, clientAchievementsTable, values);
    return { status: "created" };
  });
}

export async function importClientDreamDestinations(
  tx: ImportTx, ledger: Ledger, tenantId: string, dreamDestinations: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "clientDreamDestination", dreamDestinations, result, async (rtx, row, newId) => {
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) : undefined;
    if (!clientId) return { status: "skip", reason: "Cliente de origem não foi importado" };
    const values = { ...cleanRow(row, ["id", "tenantId", "clientId"]), id: newId, tenantId, clientId };
    await insertRow(rtx, clientDreamDestinationsTable, values);
    return { status: "created" };
  });
}

export async function importClientNotifications(
  tx: ImportTx, ledger: Ledger, tenantId: string, notifications: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "clientNotification", notifications, result, async (rtx, row, newId) => {
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) : undefined;
    if (!clientId) return { status: "skip", reason: "Cliente de origem não foi importado" };
    const values = { ...cleanRow(row, ["id", "tenantId", "clientId"]), id: newId, tenantId, clientId };
    await insertRow(rtx, clientNotificationsTable, values);
    return { status: "created" };
  });
}

// ── Pipeline / negociações ───────────────────────────────────────────────

export async function importPipelines(
  tx: ImportTx, ledger: Ledger, tenantId: string, pipelines: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "pipeline", pipelines, result, async (rtx, row, newId) => {
    const values = { ...cleanRow(row, ["id", "tenantId"]), id: newId, tenantId };
    await insertRow(rtx, pipelinesTable, values);
    return { status: "created" };
  });
}

export async function importEtapasPipeline(
  tx: ImportTx, ledger: Ledger, tenantId: string, stages: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "pipelineStage", stages, result, async (rtx, row, newId) => {
    const oldPipelineId = str(row, "pipelineId");
    const pipelineId = oldPipelineId ? ledgerGet(ledger, "pipeline", oldPipelineId) : undefined;
    if (!pipelineId) return { status: "skip", reason: "Pipeline de origem não foi importado" };
    const name = str(row, "name");
    if (name) {
      const [existing] = await rtx.select({ id: pipelineStagesTable.id }).from(pipelineStagesTable)
        .where(and(eq(pipelineStagesTable.pipelineId, pipelineId), eq(pipelineStagesTable.name, name)))
        .limit(1);
      if (existing) {
        await ledgerSet(rtx, ledger, tenantId, "pipelineStage", row.id as string, existing.id);
        return { status: "skip", reason: "Etapa já existe no pipeline" };
      }
    }
    const values = { ...cleanRow(row, ["id", "tenantId", "pipelineId"]), id: newId, tenantId, pipelineId };
    await insertRow(rtx, pipelineStagesTable, values);
    return { status: "created" };
  });
}

export async function importNegociacoes(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  importerId: string,
  users: UserResolution,
  deals: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "deal", deals, result, async (rtx, row, newId) => {
    const oldStageId = str(row, "stageId");
    const stageId = oldStageId ? ledgerGet(ledger, "pipelineStage", oldStageId) : undefined;
    if (!stageId) return { status: "skip", reason: "Etapa de pipeline de origem não foi importada" };
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) ?? null : null;
    const oldTripId = str(row, "tripId");
    const tripId = oldTripId ? ledgerGet(ledger, "trip", oldTripId) ?? null : null;
    // reservationId has no DB-level FK; remap through the ledger when
    // possible, otherwise drop it rather than leave a dangling id pointing
    // at nothing in this tenant.
    const oldReservationId = str(row, "reservationId");
    const reservationId = oldReservationId ? ledgerGet(ledger, "reservation", oldReservationId) ?? null : null;
    const status = str(row, "status") ?? "open";
    if (status === "open" && clientId && tripId) {
      const [existing] = await rtx.select({ id: dealsTable.id }).from(dealsTable)
        .where(and(
          eq(dealsTable.tenantId, tenantId),
          eq(dealsTable.clientId, clientId),
          eq(dealsTable.tripId, tripId),
          eq(dealsTable.status, "open"),
        ))
        .limit(1);
      if (existing) {
        await ledgerSet(rtx, ledger, tenantId, "deal", row.id as string, existing.id);
        return { status: "skip", reason: "Negociação aberta já existe para cliente e viagem" };
      }
    }
    const values = {
      ...cleanRow(row, ["id", "tenantId", "stageId", "clientId", "tripId", "reservationId", "ownerId"]),
      id: newId,
      tenantId,
      stageId,
      clientId,
      tripId,
      reservationId,
      ownerId: resolveAttribution(users, importerId, row.ownerId),
    };
    await insertRow(rtx, dealsTable, values);
    return { status: "created" };
  });
}

// ── Fidelidade ────────────────────────────────────────────────────────────

export async function importFidelidadeProgramas(
  tx: ImportTx, ledger: Ledger, tenantId: string, programs: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "loyaltyProgram", programs, result, async (rtx, row, newId) => {
    const values = { ...cleanRow(row, ["id", "tenantId"]), id: newId, tenantId };
    await insertRow(rtx, loyaltyProgramsTable, values);
    return { status: "created" };
  });
}

export async function importFidelidadeMembros(
  tx: ImportTx, ledger: Ledger, tenantId: string, members: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "loyaltyMember", members, result, async (rtx, row, newId) => {
    const oldProgramId = str(row, "programId");
    const programId = oldProgramId ? ledgerGet(ledger, "loyaltyProgram", oldProgramId) : undefined;
    if (!programId) return { status: "skip", reason: "Programa de fidelidade de origem não foi importado" };
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) : undefined;
    if (!clientId) return { status: "skip", reason: "Cliente de origem não foi importado" };
    const values = { ...cleanRow(row, ["id", "tenantId", "programId", "clientId"]), id: newId, tenantId, programId, clientId };
    await insertRow(rtx, loyaltyMembersTable, values);
    return { status: "created" };
  });
}

export async function importFidelidadeTransacoes(
  tx: ImportTx, ledger: Ledger, tenantId: string, transactions: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "loyaltyTransaction", transactions, result, async (rtx, row, newId) => {
    const oldMemberId = str(row, "memberId");
    const memberId = oldMemberId ? ledgerGet(ledger, "loyaltyMember", oldMemberId) : undefined;
    if (!memberId) return { status: "skip", reason: "Membro de fidelidade de origem não foi importado" };
    const referenceType = str(row, "referenceType");
    const oldReferenceId = str(row, "referenceId");
    let referenceId: string | null = null;
    if (oldReferenceId) {
      if (referenceType === "reservation") referenceId = ledgerGet(ledger, "reservation", oldReferenceId) ?? null;
      else if (referenceType === "payment" || referenceType === "payment_reversal") {
        referenceId = ledgerGet(ledger, "payment", oldReferenceId) ?? null;
      } else if (referenceType === "referral") {
        referenceId = ledgerGet(ledger, "referral", oldReferenceId) ?? null;
      }
    }
    const values = {
      ...cleanRow(row, ["id", "tenantId", "memberId", "referenceId"]),
      id: newId,
      tenantId,
      memberId,
      referenceId,
    };
    await insertRow(rtx, loyaltyTransactionsTable, values);
    return { status: "created" };
  });
}

// ── Calendário ────────────────────────────────────────────────────────────

export async function importCalendario(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  users: UserResolution,
  events: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "calendarEvent", events, result, async (rtx, row, newId) => {
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) ?? null : null;
    const oldTripId = str(row, "tripId");
    const tripId = oldTripId ? ledgerGet(ledger, "trip", oldTripId) ?? null : null;
    const oldPaymentId = str(row, "paymentId");
    const paymentId = oldPaymentId ? ledgerGet(ledger, "payment", oldPaymentId) ?? null : null;
    const values = {
      ...cleanRow(row, ["id", "tenantId", "userId", "clientId", "tripId", "paymentId"]),
      id: newId,
      tenantId,
      userId: resolveSoftAttribution(users, row.userId),
      clientId,
      tripId,
      paymentId,
    };
    await insertRow(rtx, calendarEventsTable, values);
    return { status: "created" };
  });
}

// ── Documentos ────────────────────────────────────────────────────────────

export async function importDocumentos(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  importerId: string,
  users: UserResolution,
  documents: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "document", documents, result, async (rtx, row, newId) => {
    const entityType = str(row, "entityType");
    let entityId = str(row, "entityId");
    if (entityId) {
      if (entityType === "client") entityId = ledgerGet(ledger, "client", entityId) ?? null;
      else if (entityType === "trip") entityId = ledgerGet(ledger, "trip", entityId) ?? null;
      else if (entityType === "reservation") entityId = ledgerGet(ledger, "reservation", entityId) ?? null;
      // Other entityType values have no ledger mapping wired up yet — the id
      // is dropped rather than left dangling at a stale value from the
      // source tenant.
      else entityId = null;
    }
    const values = {
      ...cleanRow(row, ["id", "tenantId", "uploadedById", "entityId"]),
      id: newId,
      tenantId,
      uploadedById: resolveAttribution(users, importerId, row.uploadedById),
      entityId,
    };
    await insertRow(rtx, documentsTable, values);
    return { status: "created" };
  });
}

// ── Marketing: campanhas / envios / NPS ──────────────────────────────────

export async function importMarketingCampanhas(
  tx: ImportTx,
  ledger: Ledger,
  tenantId: string,
  importerId: string,
  users: UserResolution,
  campaigns: unknown,
  result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "campaign", campaigns, result, async (rtx, row, newId) => {
    const values = {
      ...cleanRow(row, ["id", "tenantId", "createdById"]),
      id: newId,
      tenantId,
      createdById: resolveAttribution(users, importerId, row.createdById),
    };
    await insertRow(rtx, campaignsTable, values);
    return { status: "created" };
  });
}

export async function importMarketingEnvios(
  tx: ImportTx, ledger: Ledger, tenantId: string, sends: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "campaignSend", sends, result, async (rtx, row, newId) => {
    const oldCampaignId = str(row, "campaignId");
    const campaignId = oldCampaignId ? ledgerGet(ledger, "campaign", oldCampaignId) : undefined;
    if (!campaignId) return { status: "skip", reason: "Campanha de origem não foi importada" };
    const oldClientId = str(row, "clientId");
    const clientId = oldClientId ? ledgerGet(ledger, "client", oldClientId) : undefined;
    if (!clientId) return { status: "skip", reason: "Cliente de origem não foi importado" };
    const [existing] = await rtx.select({ id: campaignSendsTable.id }).from(campaignSendsTable)
      .where(and(eq(campaignSendsTable.campaignId, campaignId), eq(campaignSendsTable.clientId, clientId)))
      .limit(1);
    if (existing) {
      await ledgerSet(rtx, ledger, tenantId, "campaignSend", row.id as string, existing.id);
      return { status: "skip", reason: "Envio já existe para campanha e cliente" };
    }
    const values = { ...cleanRow(row, ["id", "tenantId", "campaignId", "clientId"]), id: newId, tenantId, campaignId, clientId };
    await insertRow(rtx, campaignSendsTable, values);
    return { status: "created" };
  });
}

export async function importMarketingNps(
  tx: ImportTx, ledger: Ledger, tenantId: string, responses: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "npsResponse", responses, result, async (rtx, row, newId) => {
    // userId here historically stores a client id (this legacy e-commerce
    // NPS predates the clean client/user split) — remap through the client
    // ledger; a row whose client was never imported can't be safely attributed.
    const oldUserId = str(row, "userId");
    const userId = oldUserId ? ledgerGet(ledger, "client", oldUserId) : undefined;
    if (!userId) return { status: "skip", reason: "Cliente de origem não foi importado" };
    const oldOrderId = str(row, "orderId");
    const orderId = oldOrderId ? ledgerGet(ledger, "storeOrder", oldOrderId) ?? null : null;
    const values = { ...cleanRow(row, ["id", "tenantId", "userId", "orderId"]), id: newId, tenantId, userId, orderId };
    await insertRow(rtx, npsResponsesTable, values);
    return { status: "created" };
  });
}

// ── Distribuição / marketplace ───────────────────────────────────────────

export async function importDistribuicaoOfertas(
  tx: ImportTx, ledger: Ledger, tenantId: string, offers: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "distributionOffer", offers, result, async (rtx, row, newId) => {
    const integrationType = str(row, "integrationType");
    const externalId = str(row, "externalId");
    const sourceId = row.id as string;
    if (integrationType && externalId) {
      const [existing] = await rtx.select({ id: distributionOffersTable.id }).from(distributionOffersTable)
        .where(and(
          eq(distributionOffersTable.tenantId, tenantId),
          eq(distributionOffersTable.integrationType, integrationType),
          eq(distributionOffersTable.externalId, externalId),
        )).limit(1);
      if (existing) {
        // Already synced live from the provider under the same natural key —
        // reuse it instead of violating the unique index, and still record
        // the mapping so operations/bookings below remap to it correctly.
        await ledgerSet(rtx, ledger, tenantId, "distributionOffer", sourceId, existing.id);
        return { status: "skip", reason: "Oferta já existe (sincronizada com o provedor)" };
      }
    }
    const values = { ...cleanRow(row, ["id", "tenantId"]), id: newId, tenantId };
    await insertRow(rtx, distributionOffersTable, values);
    return { status: "created" };
  });
}

export async function importDistribuicaoOperacoes(
  tx: ImportTx, ledger: Ledger, tenantId: string, operations: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "distributionOperation", operations, result, async (rtx, row, newId) => {
    const oldOfferId = str(row, "offerId");
    const offerId = oldOfferId ? ledgerGet(ledger, "distributionOffer", oldOfferId) ?? null : null;
    const integrationType = str(row, "integrationType");
    let idempotencyKey = str(row, "idempotencyKey");
    if (integrationType && idempotencyKey) {
      const [existing] = await rtx.select({ id: distributionOperationsTable.id }).from(distributionOperationsTable)
        .where(and(
          eq(distributionOperationsTable.tenantId, tenantId),
          eq(distributionOperationsTable.integrationType, integrationType),
          eq(distributionOperationsTable.idempotencyKey, idempotencyKey),
        )).limit(1);
      if (existing) idempotencyKey = null;
    }
    if (!idempotencyKey) idempotencyKey = `restored-${newId}`;
    const values = {
      ...cleanRow(row, ["id", "tenantId", "offerId", "idempotencyKey"]),
      id: newId,
      tenantId,
      offerId,
      idempotencyKey,
    };
    await insertRow(rtx, distributionOperationsTable, values);
    return { status: "created" };
  });
}

export async function importDistribuicaoReservas(
  tx: ImportTx, ledger: Ledger, tenantId: string, bookings: unknown, result: BackupImportGroupResult,
): Promise<void> {
  await importRows(tx, ledger, tenantId, "distributionBooking", bookings, result, async (rtx, row, newId) => {
    const oldOfferId = str(row, "offerId");
    const offerId = oldOfferId ? ledgerGet(ledger, "distributionOffer", oldOfferId) : undefined;
    if (!offerId) return { status: "skip", reason: "Oferta de origem não foi importada" };
    const integrationType = str(row, "integrationType");
    const externalOrderId = str(row, "externalOrderId");
    const sourceId = row.id as string;
    if (integrationType && externalOrderId) {
      const [existing] = await rtx.select({ id: distributionBookingsTable.id }).from(distributionBookingsTable)
        .where(and(
          eq(distributionBookingsTable.tenantId, tenantId),
          eq(distributionBookingsTable.integrationType, integrationType),
          eq(distributionBookingsTable.externalOrderId, externalOrderId),
        )).limit(1);
      if (existing) {
        await ledgerSet(rtx, ledger, tenantId, "distributionBooking", sourceId, existing.id);
        return { status: "skip", reason: "Reserva de distribuição já existe (sincronizada com o provedor)" };
      }
    }
    const values = { ...cleanRow(row, ["id", "tenantId", "offerId"]), id: newId, tenantId, offerId };
    await insertRow(rtx, distributionBookingsTable, values);
    return { status: "created" };
  });
}

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
  };
}

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
      await tx.update(clientsTable).set({ referredById: referrerNewId }).where(eq(clientsTable.id, newId));
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
    const values = {
      ...cleanRow(row, ["id", "tenantId", "createdById", "importFingerprint", "layoutId"]),
      id: newId,
      tenantId,
      createdById: resolveAttribution(users, importerId, row.createdById),
      // Never carried over: this tenant's other trips may already occupy the
      // same fingerprint, and dedup for restore is handled by the ledger, not
      // this unique index.
      importFingerprint: null,
      // Vehicle layouts are out of import scope; the trip's own seatMap/
      // seatLayout/totalCapacity are cloned as-is, only the named-layout link is cleared.
      layoutId: null,
    };
    await insertRow(rtx, tripsTable, values);
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
    const values = {
      ...cleanRow(row, ["id", "tenantId", "tripId", "createdById"]),
      id: newId,
      tenantId,
      tripId,
      createdById: resolveAttribution(users, importerId, row.createdById),
    };
    await insertRow(rtx, expensesTable, values);
    return { status: "created" };
  });
}

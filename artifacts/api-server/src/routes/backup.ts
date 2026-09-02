import { Router, type NextFunction, type Request, type Response } from "express";
import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { createHash } from "crypto";
import {
  db,
  backupImportBatchesTable,
  type BackupImportReport,
  tenantsTable,
  usersTable,
  clientsTable,
  notesTable,
  tripsTable,
  reservationsTable,
  passengersTable,
  reservationInstallmentsTable,
  boardingLocationsTable,
  tripCheckinsTable,
  tripGuideLocationsTable,
  automationsTable,
  automationActionsTable,
  automationLogsTable,
  referralsTable,
  referralTrackingTable,
  referralSettingsTable,
  referralCampaignsTable,
  referralCommissionsTable,
  referralAttemptLogsTable,
  storesTable,
  storeCategoriesTable,
  storeProductsTable,
  storeOrdersTable,
  storeOrderItemsTable,
  storeCouponsTable,
  storeReviewsTable,
  storePagesTable,
  priceAlertSubscriptionsTable,
  couponsTable,
  paymentsTable,
  expensesTable,
  tripCostsTable,
  reservationSequencesTable,
  financialLedgerEntriesTable,
  settlementItemsTable,
  suppliersTable,
  vehiclesTable,
  vehicleLayoutsTable,
  accommodationsTable,
  destinationsTable,
  systemConfigsTable,
  calendarEventsTable,
  documentsTable,
  salesGoalsTable,
  commissionRulesTable,
  commissionsTable,
  pipelinesTable,
  pipelineStagesTable,
  dealsTable,
  loyaltyProgramsTable,
  loyaltyMembersTable,
  loyaltyTransactionsTable,
  clubConfigTable,
  clubBenefitsTable,
  campaignsTable,
  campaignSendsTable,
  npsResponsesTable,
  clientNpsResponsesTable,
  productsTable,
  ordersTable,
  orderItemsTable,
  messagesTable,
  messageTemplatesTable,
  chatbotConversationsTable,
  chatbotMessagesTable,
  birthdayMessagesTable,
  emailLogsTable,
  whatsappNotificationOutboxTable,
  tripMediaTable,
  tripImportBatchesTable,
  clientAchievementsTable,
  clientDreamDestinationsTable,
  clientFavoritesTable,
  clientNotificationsTable,
  clientScoresTable,
  npsInvitationsTable,
  invitesTable,
  tenantIntegrationsTable,
  tenantIntegrationLogsTable,
  aiIntegrationsTable,
  aiIntegrationLogsTable,
  productCategoriesTable,
  productImagesTable,
  cartItemsTable,
  partnersTable,
  partnerProductsTable,
  partnerAvailabilityTable,
  partnerCommissionsTable,
  distributionOffersTable,
  distributionOperationsTable,
  distributionBookingsTable,
  gemeoAlertsTable,
  gemeoOpportunitiesTable,
  insightsChatHistoryTable,
  auditLogsTable,
  outboundMessagesTable,
  outboundDeliveriesTable,
  outboundDeliveryAttemptsTable,
} from "@workspace/db";
import { requireAuth, ROLES } from "../lib/tenant.js";
import { ForbiddenError, NotFoundError, ValidationError, AppError } from "../lib/errors.js";
import { JsonStreamWriter } from "../lib/json-stream-writer.js";
import { generateId } from "../lib/id.js";
import {
  emptyReport,
  loadLedger,
  resolveUsers,
  importAgencia,
  importClientes,
  importViagens,
  importBoardingLocations,
  findExistingStoreId,
  importLojaProdutos,
  importLojaCupons,
  importLojaPedidos,
  importLojaItensPedido,
  importReservas,
  importPassageiros,
  importCheckins,
  importAutomacoes,
  importAutomacaoAcoes,
  importAutomacaoLogs,
  importIndicacoes,
  importPagamentos,
  importDespesas,
  importFinanceiroAcertos,
  importFinanceiroLancamentos,
  importConvites,
  importClientAchievements,
  importClientDreamDestinations,
  importClientNotifications,
  importFornecedores,
  importVeiculos,
  importLayoutsVeiculo,
  importHospedagens,
  importDestinos,
  importViagensMidia,
  importPipelines,
  importEtapasPipeline,
  importNegociacoes,
  importFidelidadeProgramas,
  importFidelidadeMembros,
  importFidelidadeTransacoes,
  importCalendario,
  importDocumentos,
  importMarketingCampanhas,
  importMarketingEnvios,
  importMarketingNps,
  importOutboundMessages,
  importOutboundDeliveries,
  importOutboundDeliveryAttempts,
  importDistribuicaoOfertas,
  importDistribuicaoOperacoes,
  importDistribuicaoReservas,
} from "../lib/backup-import.js";
import { logger } from "../lib/logger.js";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupContractError,
  isSameLogicalAgency,
  normalizeBackupPayload,
} from "../lib/backup-contract.js";

const router: Router = Router();

/**
 * Backup file format version. Bump whenever the shape of a section changes
 * in a way an importer needs to know about (renamed/removed fields, changed
 * grouping, etc.) so a future import/restore feature can validate
 * compatibility and reject files it does not understand.
 */
// Same batch size used by the trips streaming export — large enough to keep
// query round-trips low, small enough to bound memory for big tenants.
const BACKUP_BATCH_SIZE = 500;

/**
 * Never include OAuth tokens in a user backup — these are live credentials
 * that grant access to the agency owner's connected Google account.
 */
function sanitizeUserRow(row: Record<string, unknown>): Record<string, unknown> {
  const { googleAccessToken, googleRefreshToken, googleTokenExpiry, ...rest } = row;
  return rest;
}

/** Payment-gateway secret keys must never leave the server. */
function sanitizeStoreRow(row: Record<string, unknown>): Record<string, unknown> {
  const { stripeSecretKey, stripeWebhookSecret, mpAccessToken, ...rest } = row;
  return rest;
}

/**
 * paymentToken authorizes order status changes; idempotencyKey is a
 * client-supplied replay token that `handleIdempotentOrderReplay` accepts,
 * unauthenticated, to return the full existing order (customer + payment
 * data) on the public checkout endpoint — treat it the same as a credential.
 */
function sanitizeStoreOrderRow(row: Record<string, unknown>): Record<string, unknown> {
  const { paymentToken, idempotencyKey, ...rest } = row;
  return rest;
}

/**
 * expoPushToken is a live device credential — anyone holding it can send
 * arbitrary push notifications to that client's device. Never export it.
 */
function sanitizeClientRow(row: Record<string, unknown>): Record<string, unknown> {
  const { expoPushToken, ...rest } = row;
  return rest;
}

/**
 * confirmationTokenHash/unsubscribeTokenHash authorize anonymous, unauthenticated
 * actions (confirming or cancelling a price alert) purely by possession of the
 * link — treat them the same as a bearer credential.
 */
function sanitizePriceAlertSubscriptionRow(row: Record<string, unknown>): Record<string, unknown> {
  const { confirmationTokenHash, unsubscribeTokenHash, ...rest } = row;
  return rest;
}

/** token authorizes anonymous NPS survey submission by possession of the link — treat as a bearer credential. */
function sanitizeNpsInvitationRow(row: Record<string, unknown>): Record<string, unknown> {
  const { token, ...rest } = row;
  return rest;
}

/** token authorizes anonymous invite acceptance (account creation) by possession of the link. */
function sanitizeInviteRow(row: Record<string, unknown>): Record<string, unknown> {
  const { token, ...rest } = row;
  return rest;
}

/** secretsEncrypted holds encrypted third-party API keys/tokens — never export even in encrypted form. */
function sanitizeTenantIntegrationRow(row: Record<string, unknown>): Record<string, unknown> {
  const { secretsEncrypted, ...rest } = row;
  return rest;
}

/** apiKeyEncrypted/accessTokenEncrypted hold encrypted AI-provider credentials — never export even in encrypted form. */
function sanitizeAiIntegrationRow(row: Record<string, unknown>): Record<string, unknown> {
  const { apiKeyEncrypted, accessTokenEncrypted, ...rest } = row;
  return rest;
}

/** passwordHash is the marketplace partner's own login credential. */
function sanitizePartnerRow(row: Record<string, unknown>): Record<string, unknown> {
  const { passwordHash, ...rest } = row;
  return rest;
}

type AnyTable = { id: unknown; [column: string]: unknown };

class BackupExportStreamError extends Error {
  readonly group: string;

  constructor(group: string, cause: unknown) {
    super(`Backup export failed while streaming "${group}"`, { cause });
    this.name = "BackupExportStreamError";
    this.group = group;
  }
}

function withBackupGroupError(group: string, error: unknown): never {
  if (error instanceof BackupExportStreamError) throw error;
  throw new BackupExportStreamError(group, error);
}

/**
 * Streams every row of `table` matching `scopeWhere` (already tenant-scoped
 * by the caller) as a JSON array under `key`, batching via a cursor on `id`
 * so a large tenant never has its whole table held in memory at once.
 * Pass `scopeWhere = false` to write an empty array without querying (used
 * when a prerequisite lookup, e.g. the tenant's store, does not exist).
 */
async function streamDirectTable(
  writer: JsonStreamWriter,
  key: string,
  table: AnyTable,
  scopeWhere: SQL | false,
  counts: Record<string, number>,
  sanitize?: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  try {
    await writer.key(key);
    await writer.beginArray();
    let total = 0;
    if (scopeWhere !== false) {
      let cursor: string | undefined;
      for (;;) {
        const condition = cursor ? and(scopeWhere, gt(table.id as never, cursor)) : scopeWhere;
        const batch = (await db
          .select()
          .from(table as never)
          .where(condition)
          .orderBy(asc(table.id as never))
          .limit(BACKUP_BATCH_SIZE)) as Array<Record<string, unknown>>;
        if (batch.length === 0) break;
        for (const row of batch) {
          await writer.arrayItem(sanitize ? sanitize(row) : row);
          total++;
        }
        cursor = batch[batch.length - 1]!.id as string;
        if (batch.length < BACKUP_BATCH_SIZE) break;
      }
    }
    counts[key] = total;
    await writer.endArray();
  } catch (error) {
    withBackupGroupError(key, error);
  }
}

/**
 * Streams child rows that only reference their tenant indirectly through a
 * parent row (e.g. passengers → reservations, notes → clients). Walks the
 * parent table in batches by cursor, then fetches only the children of that
 * batch — bounding memory the same way streamDirectTable does, without
 * relying on a subquery-based IN clause.
 */
async function streamChildTable(
  writer: JsonStreamWriter,
  key: string,
  parentTable: AnyTable,
  parentScopeWhere: SQL,
  childTable: AnyTable,
  childParentIdColumn: unknown,
  counts: Record<string, number>,
  sanitize?: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  try {
    await writer.key(key);
    await writer.beginArray();
    let total = 0;
    let cursor: string | undefined;
    for (;;) {
      const condition = cursor ? and(parentScopeWhere, gt(parentTable.id as never, cursor)) : parentScopeWhere;
      const parentBatch = (await db
        .select({ id: parentTable.id as never })
        .from(parentTable as never)
        .where(condition)
        .orderBy(asc(parentTable.id as never))
        .limit(BACKUP_BATCH_SIZE)) as Array<{ id: string }>;
      if (parentBatch.length === 0) break;
      const parentIds = parentBatch.map((r) => r.id);
      const children = (await db
        .select()
        .from(childTable as never)
        .where(inArray(childParentIdColumn as never, parentIds))) as Array<Record<string, unknown>>;
      for (const child of children) {
        await writer.arrayItem(sanitize ? sanitize(child) : child);
        total++;
      }
      cursor = parentIds[parentIds.length - 1];
      if (parentBatch.length < BACKUP_BATCH_SIZE) break;
    }
    counts[key] = total;
    await writer.endArray();
  } catch (error) {
    withBackupGroupError(key, error);
  }
}

/**
 * Writes every row of `table` matching `scopeWhere` as a JSON array under
 * `key` in a single query, with no cursor batching. Only for tables with no
 * single-column `id` to cursor on (e.g. a composite-key counter table) whose
 * row count is inherently small and bounded (one row per tenant per period),
 * unlike the large per-record tables `streamDirectTable` is built for.
 */
async function writeSmallTable(
  writer: JsonStreamWriter,
  key: string,
  table: AnyTable,
  scopeWhere: SQL,
  counts: Record<string, number>,
): Promise<void> {
  try {
    await writer.key(key);
    await writer.beginArray();
    const rows = (await db.select().from(table as never).where(scopeWhere)) as Array<Record<string, unknown>>;
    for (const row of rows) {
      await writer.arrayItem(row);
    }
    counts[key] = rows.length;
    await writer.endArray();
  } catch (error) {
    withBackupGroupError(key, error);
  }
}

/**
 * GET /backup/export
 *
 * Streams a single versioned .json file containing every tenant-owned data
 * group of the authenticated user's own agency: branding/config, users for
 * reference + pending invites, clients (incl. achievements, dream
 * destinations, favorites, notifications, scores), trips (incl. media and
 * import-batch history), reservations/passengers/installments, boarding &
 * check-in (incl. guide location history), the reservation-numbering
 * sequence counter, automations, referrals, store,
 * legacy product catalog, price-alert subscriptions, CRM coupons,
 * financials (payments/expenses/trip costs/settlement ledger), auxiliary
 * registries (incl. vehicle seat layouts), calendar, documents, sales
 * goals, commissions, pipeline/deals, loyalty, club benefits, marketing
 * (campaigns/points catalog/NPS), communication history (messages,
 * templates, chatbot, birthday messages, email/WhatsApp logs), third-party
 * integration configuration (non-secret fields only) and logs, AI
 * insights/alerts history, marketplace partners and distribution ledger,
 * and the audit trail. Restricted to agency admins of their own tenant —
 * every query below is scoped by `me.tenantId`. Never includes login/OAuth
 * credentials, payment-gateway secrets, device push tokens, encrypted
 * integration secrets, or anonymous-action bearer tokens.
 *
 * Deliberately excluded (not tenant-owned operational data):
 * - `tripGuideTokensTable` — a live bearer credential (grants guide check-in
 *   access), not a data record.
 * - `plansTable`/`invoicesTable`/`subscriptionsTable`/`featureFlagsTable`/
 *   `platformSettingsTable`/`usageTrackingTable` — the tenant's platform/
 *   billing relationship with VisiteCRM itself, explicitly out of scope
 *   ("configurações da plataforma").
 * - the standalone `conversations`/`messages` tables (as opposed to
 *   `chatbotConversationsTable`/`chatbotMessagesTable`, which are included)
 *   — no `tenantId` column, so they cannot be safely tenant-scoped.
 * - `stripeWebhookEventsTable` — a global cross-tenant idempotency ledger
 *   with no `tenantId` column, not tenant-owned data.
 */
router.get("/backup/export", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  let exportTenantId: string | undefined;
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role !== ROLES.AGENCY_ADMIN) {
      next(new ForbiddenError("Apenas administradores da agência podem gerar backups.", "FORBIDDEN_ROLE"));
      return;
    }

    const tenantId = me.tenantId;
    exportTenantId = tenantId;

    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
    if (!tenant) {
      next(new NotFoundError("Agência não encontrada", "TENANT_NOT_FOUND"));
      return;
    }

    const [storeRow] = await db
      .select({ id: storesTable.id })
      .from(storesTable)
      .where(eq(storesTable.tenantId, tenantId))
      .limit(1);
    const storeId = storeRow?.id;

    const filenameSlug = (tenant.slug || tenantId).replace(/[^a-zA-Z0-9-]+/g, "-");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    res.status(200);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="backup-${filenameSlug}-${timestamp}.json"`);
    res.setHeader("Cache-Control", "no-store");

    const writer = new JsonStreamWriter(res);
    const counts: Record<string, number> = {};

    await writer.beginObject();
    await writer.key("format");
    await writer.value(BACKUP_FORMAT);
    await writer.key("version");
    await writer.value(BACKUP_VERSION);
    await writer.key("exportedAt");
    await writer.value(new Date().toISOString());
    await writer.key("exportedByUserId");
    await writer.value(me.id);
    await writer.key("tenant");
    await writer.value({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      email: tenant.email,
      cnpj: tenant.cnpj,
    });

    await writer.key("data");
    await writer.beginObject();

    // Agência / branding — a single settings object, not paginated.
    await writer.key("agencia");
    await writer.value(tenant);

    // Usuários (dados de referência, nunca credenciais) + convites pendentes.
    await writer.key("usuarios");
    await writer.beginObject();
    await streamDirectTable(writer, "users", usersTable as unknown as AnyTable, eq(usersTable.tenantId, tenantId), counts, sanitizeUserRow);
    await streamDirectTable(writer, "invites", invitesTable as unknown as AnyTable, eq(invitesTable.tenantId, tenantId), counts, sanitizeInviteRow);
    await writer.endObject();

    // Configurações gerais da agência (chave/valor).
    await streamDirectTable(
      writer,
      "configuracoes",
      systemConfigsTable as unknown as AnyTable,
      eq(systemConfigsTable.tenantId, tenantId),
      counts,
    );

    // Clientes.
    await writer.key("clientes");
    await writer.beginObject();
    await streamDirectTable(
      writer,
      "clients",
      clientsTable as unknown as AnyTable,
      eq(clientsTable.tenantId, tenantId),
      counts,
      sanitizeClientRow,
    );
    await streamChildTable(
      writer,
      "notes",
      clientsTable as unknown as AnyTable,
      eq(clientsTable.tenantId, tenantId),
      notesTable as unknown as AnyTable,
      notesTable.clientId,
      counts,
    );
    await streamDirectTable(
      writer,
      "npsResponses",
      clientNpsResponsesTable as unknown as AnyTable,
      eq(clientNpsResponsesTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "npsInvitations",
      npsInvitationsTable as unknown as AnyTable,
      eq(npsInvitationsTable.tenantId, tenantId),
      counts,
      sanitizeNpsInvitationRow,
    );
    await streamDirectTable(
      writer,
      "achievements",
      clientAchievementsTable as unknown as AnyTable,
      eq(clientAchievementsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "dreamDestinations",
      clientDreamDestinationsTable as unknown as AnyTable,
      eq(clientDreamDestinationsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "favorites",
      clientFavoritesTable as unknown as AnyTable,
      eq(clientFavoritesTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "notifications",
      clientNotificationsTable as unknown as AnyTable,
      eq(clientNotificationsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(writer, "scores", clientScoresTable as unknown as AnyTable, eq(clientScoresTable.tenantId, tenantId), counts);
    await writer.endObject();

    // Viagens (+ mídias e histórico de importações em lote).
    await writer.key("viagens");
    await writer.beginObject();
    await streamDirectTable(writer, "trips", tripsTable as unknown as AnyTable, eq(tripsTable.tenantId, tenantId), counts);
    await streamDirectTable(writer, "media", tripMediaTable as unknown as AnyTable, eq(tripMediaTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "importBatches",
      tripImportBatchesTable as unknown as AnyTable,
      eq(tripImportBatchesTable.tenantId, tenantId),
      counts,
    );
    await writer.endObject();

    // Reservas / passageiros / parcelas.
    await writer.key("reservas");
    await writer.beginObject();
    await streamDirectTable(writer, "reservations", reservationsTable as unknown as AnyTable, eq(reservationsTable.tenantId, tenantId), counts);
    await streamChildTable(
      writer,
      "passengers",
      reservationsTable as unknown as AnyTable,
      eq(reservationsTable.tenantId, tenantId),
      passengersTable as unknown as AnyTable,
      passengersTable.reservationId,
      counts,
    );
    await streamDirectTable(
      writer,
      "installments",
      reservationInstallmentsTable as unknown as AnyTable,
      eq(reservationInstallmentsTable.tenantId, tenantId),
      counts,
    );
    // Contador de numeração sequencial de reservas por mês/tipo — preservar para
    // que a agência restaurada não reinicie a numeração e gere duplicatas.
    await writeSmallTable(
      writer,
      "sequences",
      reservationSequencesTable as unknown as AnyTable,
      eq(reservationSequencesTable.tenantId, tenantId),
      counts,
    );
    await writer.endObject();

    // Embarque / check-in / rastreamento de guias.
    await writer.key("embarqueCheckin");
    await writer.beginObject();
    await streamDirectTable(
      writer,
      "boardingLocations",
      boardingLocationsTable as unknown as AnyTable,
      eq(boardingLocationsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(writer, "checkins", tripCheckinsTable as unknown as AnyTable, eq(tripCheckinsTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "guideLocations",
      tripGuideLocationsTable as unknown as AnyTable,
      eq(tripGuideLocationsTable.tenantId, tenantId),
      counts,
    );
    await writer.endObject();

    // Automações + ações/logs.
    await writer.key("automacoes");
    await writer.beginObject();
    await streamDirectTable(writer, "automations", automationsTable as unknown as AnyTable, eq(automationsTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "actions",
      automationActionsTable as unknown as AnyTable,
      eq(automationActionsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(writer, "logs", automationLogsTable as unknown as AnyTable, eq(automationLogsTable.tenantId, tenantId), counts);
    await writer.endObject();

    // Indicações.
    await writer.key("indicacoes");
    await writer.beginObject();
    await streamDirectTable(writer, "referrals", referralsTable as unknown as AnyTable, eq(referralsTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "tracking",
      referralTrackingTable as unknown as AnyTable,
      eq(referralTrackingTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "settings",
      referralSettingsTable as unknown as AnyTable,
      eq(referralSettingsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "campaigns",
      referralCampaignsTable as unknown as AnyTable,
      eq(referralCampaignsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "commissions",
      referralCommissionsTable as unknown as AnyTable,
      eq(referralCommissionsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "attemptLogs",
      referralAttemptLogsTable as unknown as AnyTable,
      eq(referralAttemptLogsTable.tenantId, tenantId),
      counts,
    );
    await writer.endObject();

    // Loja.
    await writer.key("loja");
    await writer.beginObject();
    await streamDirectTable(writer, "store", storesTable as unknown as AnyTable, eq(storesTable.tenantId, tenantId), counts, sanitizeStoreRow);
    await streamDirectTable(
      writer,
      "categories",
      storeCategoriesTable as unknown as AnyTable,
      storeId ? eq(storeCategoriesTable.storeId, storeId) : false,
      counts,
    );
    await streamDirectTable(
      writer,
      "products",
      storeProductsTable as unknown as AnyTable,
      storeId ? eq(storeProductsTable.storeId, storeId) : false,
      counts,
    );
    await streamDirectTable(
      writer,
      "orders",
      storeOrdersTable as unknown as AnyTable,
      eq(storeOrdersTable.tenantId, tenantId),
      counts,
      sanitizeStoreOrderRow,
    );
    await streamChildTable(
      writer,
      "orderItems",
      storeOrdersTable as unknown as AnyTable,
      eq(storeOrdersTable.tenantId, tenantId),
      storeOrderItemsTable as unknown as AnyTable,
      storeOrderItemsTable.orderId,
      counts,
    );
    await streamDirectTable(
      writer,
      "coupons",
      storeCouponsTable as unknown as AnyTable,
      storeId ? eq(storeCouponsTable.storeId, storeId) : false,
      counts,
    );
    await streamDirectTable(
      writer,
      "reviews",
      storeReviewsTable as unknown as AnyTable,
      storeId ? eq(storeReviewsTable.storeId, storeId) : false,
      counts,
    );
    await streamDirectTable(
      writer,
      "pages",
      storePagesTable as unknown as AnyTable,
      storeId ? eq(storePagesTable.storeId, storeId) : false,
      counts,
    );
    await streamDirectTable(
      writer,
      "priceAlertSubscriptions",
      priceAlertSubscriptionsTable as unknown as AnyTable,
      eq(priceAlertSubscriptionsTable.tenantId, tenantId),
      counts,
      sanitizePriceAlertSubscriptionRow,
    );
    await writer.endObject();

    // Cupons do CRM (distintos dos cupons da loja).
    await streamDirectTable(writer, "cuponsCrm", couponsTable as unknown as AnyTable, eq(couponsTable.tenantId, tenantId), counts);

    // Financeiro.
    await writer.key("financeiro");
    await writer.beginObject();
    await streamDirectTable(writer, "payments", paymentsTable as unknown as AnyTable, eq(paymentsTable.tenantId, tenantId), counts);
    await streamDirectTable(writer, "expenses", expensesTable as unknown as AnyTable, eq(expensesTable.tenantId, tenantId), counts);
    await streamDirectTable(writer, "tripCosts", tripCostsTable as unknown as AnyTable, eq(tripCostsTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "settlementItems",
      settlementItemsTable as unknown as AnyTable,
      eq(settlementItemsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "ledgerEntries",
      financialLedgerEntriesTable as unknown as AnyTable,
      eq(financialLedgerEntriesTable.tenantId, tenantId),
      counts,
    );
    await writer.endObject();

    // Metas de vendas.
    await streamDirectTable(writer, "metasVendas", salesGoalsTable as unknown as AnyTable, eq(salesGoalsTable.tenantId, tenantId), counts);

    // Comissões (regras + lançamentos).
    await writer.key("comissoes");
    await writer.beginObject();
    await streamDirectTable(
      writer,
      "rules",
      commissionRulesTable as unknown as AnyTable,
      eq(commissionRulesTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(writer, "entries", commissionsTable as unknown as AnyTable, eq(commissionsTable.tenantId, tenantId), counts);
    await writer.endObject();

    // Pipeline / negociações.
    await writer.key("pipeline");
    await writer.beginObject();
    await streamDirectTable(writer, "pipelines", pipelinesTable as unknown as AnyTable, eq(pipelinesTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "stages",
      pipelineStagesTable as unknown as AnyTable,
      eq(pipelineStagesTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(writer, "deals", dealsTable as unknown as AnyTable, eq(dealsTable.tenantId, tenantId), counts);
    await writer.endObject();

    // Fidelidade (programa de pontos).
    await writer.key("fidelidade");
    await writer.beginObject();
    await streamDirectTable(
      writer,
      "programs",
      loyaltyProgramsTable as unknown as AnyTable,
      eq(loyaltyProgramsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "members",
      loyaltyMembersTable as unknown as AnyTable,
      eq(loyaltyMembersTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "transactions",
      loyaltyTransactionsTable as unknown as AnyTable,
      eq(loyaltyTransactionsTable.tenantId, tenantId),
      counts,
    );
    await writer.endObject();

    // Clube de vantagens.
    await writer.key("clube");
    await writer.beginObject();
    await streamDirectTable(writer, "config", clubConfigTable as unknown as AnyTable, eq(clubConfigTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "benefits",
      clubBenefitsTable as unknown as AnyTable,
      eq(clubBenefitsTable.tenantId, tenantId),
      counts,
    );
    await writer.endObject();

    // Marketing: campanhas de e-mail/WhatsApp, envios, NPS de e-commerce e
    // catálogo de resgate por pontos (distinto da loja/Vitrine).
    await writer.key("marketing");
    await writer.beginObject();
    await streamDirectTable(writer, "campaigns", campaignsTable as unknown as AnyTable, eq(campaignsTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "campaignSends",
      campaignSendsTable as unknown as AnyTable,
      eq(campaignSendsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "npsResponses",
      npsResponsesTable as unknown as AnyTable,
      eq(npsResponsesTable.tenantId, tenantId),
      counts,
    );
    await writer.key("catalogoPontos");
    await writer.beginObject();
    await streamDirectTable(writer, "products", productsTable as unknown as AnyTable, eq(productsTable.tenantId, tenantId), counts);
    await streamDirectTable(writer, "orders", ordersTable as unknown as AnyTable, eq(ordersTable.tenantId, tenantId), counts);
    await streamChildTable(
      writer,
      "orderItems",
      ordersTable as unknown as AnyTable,
      eq(ordersTable.tenantId, tenantId),
      orderItemsTable as unknown as AnyTable,
      orderItemsTable.orderId,
      counts,
    );
    await writer.endObject();
    await writer.endObject();

    // Comunicação: mensagens, templates, chatbot e mensagens de aniversário.
    await writer.key("comunicacao");
    await writer.beginObject();
    await streamDirectTable(writer, "messages", messagesTable as unknown as AnyTable, eq(messagesTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "messageTemplates",
      messageTemplatesTable as unknown as AnyTable,
      eq(messageTemplatesTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "chatbotConversations",
      chatbotConversationsTable as unknown as AnyTable,
      eq(chatbotConversationsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "chatbotMessages",
      chatbotMessagesTable as unknown as AnyTable,
      eq(chatbotMessagesTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "birthdayMessages",
      birthdayMessagesTable as unknown as AnyTable,
      eq(birthdayMessagesTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(writer, "emailLogs", emailLogsTable as unknown as AnyTable, eq(emailLogsTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "whatsappOutbox",
      whatsappNotificationOutboxTable as unknown as AnyTable,
      eq(whatsappNotificationOutboxTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(writer, "outboundMessages", outboundMessagesTable as unknown as AnyTable, eq(outboundMessagesTable.tenantId, tenantId), counts);
    await streamDirectTable(writer, "outboundDeliveries", outboundDeliveriesTable as unknown as AnyTable, eq(outboundDeliveriesTable.tenantId, tenantId), counts);
    await streamDirectTable(writer, "outboundDeliveryAttempts", outboundDeliveryAttemptsTable as unknown as AnyTable, eq(outboundDeliveryAttemptsTable.tenantId, tenantId), counts);
    await writer.endObject();

    // Integrações de terceiros: configuração não sensível apenas — chaves/tokens
    // criptografados nunca são exportados, nem em forma cifrada — + logs.
    await writer.key("integracoes");
    await writer.beginObject();
    await streamDirectTable(
      writer,
      "tenantIntegrations",
      tenantIntegrationsTable as unknown as AnyTable,
      eq(tenantIntegrationsTable.tenantId, tenantId),
      counts,
      sanitizeTenantIntegrationRow,
    );
    await streamDirectTable(
      writer,
      "tenantIntegrationLogs",
      tenantIntegrationLogsTable as unknown as AnyTable,
      eq(tenantIntegrationLogsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "aiIntegrations",
      aiIntegrationsTable as unknown as AnyTable,
      eq(aiIntegrationsTable.tenantId, tenantId),
      counts,
      sanitizeAiIntegrationRow,
    );
    await streamDirectTable(
      writer,
      "aiIntegrationLogs",
      aiIntegrationLogsTable as unknown as AnyTable,
      eq(aiIntegrationLogsTable.tenantId, tenantId),
      counts,
    );
    await writer.endObject();

    // Inteligência artificial: alertas/oportunidades gerados e histórico do chat de insights.
    await writer.key("inteligenciaArtificial");
    await writer.beginObject();
    await streamDirectTable(writer, "gemeoAlerts", gemeoAlertsTable as unknown as AnyTable, eq(gemeoAlertsTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "gemeoOpportunities",
      gemeoOpportunitiesTable as unknown as AnyTable,
      eq(gemeoOpportunitiesTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "insightsChatHistory",
      insightsChatHistoryTable as unknown as AnyTable,
      eq(insightsChatHistoryTable.tenantId, tenantId),
      counts,
    );
    await writer.endObject();

    // Catálogo de produtos legado (categorias/imagens/carrinho), distinto do catálogo da loja/Vitrine.
    await writer.key("catalogoLegado");
    await writer.beginObject();
    await streamDirectTable(
      writer,
      "categories",
      productCategoriesTable as unknown as AnyTable,
      eq(productCategoriesTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(writer, "images", productImagesTable as unknown as AnyTable, eq(productImagesTable.tenantId, tenantId), counts);
    await streamDirectTable(writer, "cartItems", cartItemsTable as unknown as AnyTable, eq(cartItemsTable.tenantId, tenantId), counts);
    await writer.endObject();

    // Parceiros de marketplace (nunca inclui o hash de senha do próprio parceiro).
    await writer.key("parceiros");
    await writer.beginObject();
    await streamDirectTable(writer, "partners", partnersTable as unknown as AnyTable, eq(partnersTable.tenantId, tenantId), counts, sanitizePartnerRow);
    await streamDirectTable(
      writer,
      "products",
      partnerProductsTable as unknown as AnyTable,
      eq(partnerProductsTable.tenantId, tenantId),
      counts,
    );
    await streamChildTable(
      writer,
      "availability",
      partnerProductsTable as unknown as AnyTable,
      eq(partnerProductsTable.tenantId, tenantId),
      partnerAvailabilityTable as unknown as AnyTable,
      partnerAvailabilityTable.productId,
      counts,
    );
    await streamDirectTable(
      writer,
      "commissions",
      partnerCommissionsTable as unknown as AnyTable,
      eq(partnerCommissionsTable.tenantId, tenantId),
      counts,
    );
    await writer.endObject();

    // Distribuição (ofertas/operações/reservas de integrações externas de distribuição).
    await writer.key("distribuicao");
    await writer.beginObject();
    await streamDirectTable(
      writer,
      "offers",
      distributionOffersTable as unknown as AnyTable,
      eq(distributionOffersTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "operations",
      distributionOperationsTable as unknown as AnyTable,
      eq(distributionOperationsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "bookings",
      distributionBookingsTable as unknown as AnyTable,
      eq(distributionBookingsTable.tenantId, tenantId),
      counts,
    );
    await writer.endObject();

    // Auditoria (histórico de alterações).
    await streamDirectTable(writer, "auditoria", auditLogsTable as unknown as AnyTable, eq(auditLogsTable.tenantId, tenantId), counts);

    // Calendário (eventos sincronizados).
    await streamDirectTable(
      writer,
      "calendario",
      calendarEventsTable as unknown as AnyTable,
      eq(calendarEventsTable.tenantId, tenantId),
      counts,
    );

    // Documentos.
    await streamDirectTable(writer, "documentos", documentsTable as unknown as AnyTable, eq(documentsTable.tenantId, tenantId), counts);

    // Cadastros auxiliares.
    await writer.key("cadastrosAuxiliares");
    await writer.beginObject();
    await streamDirectTable(writer, "suppliers", suppliersTable as unknown as AnyTable, eq(suppliersTable.tenantId, tenantId), counts);
    await streamDirectTable(writer, "vehicles", vehiclesTable as unknown as AnyTable, eq(vehiclesTable.tenantId, tenantId), counts);
    await streamDirectTable(
      writer,
      "vehicleLayouts",
      vehicleLayoutsTable as unknown as AnyTable,
      eq(vehicleLayoutsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(
      writer,
      "accommodations",
      accommodationsTable as unknown as AnyTable,
      eq(accommodationsTable.tenantId, tenantId),
      counts,
    );
    await streamDirectTable(writer, "destinations", destinationsTable as unknown as AnyTable, eq(destinationsTable.tenantId, tenantId), counts);
    await writer.endObject();

    await writer.endObject(); // close "data"

    await writer.key("counts");
    await writer.value(counts);
    await writer.endObject(); // close root

    res.end();
  } catch (err) {
    if (res.headersSent) {
      logger.error(
        {
          err,
          tenantId: exportTenantId,
          group: err instanceof BackupExportStreamError ? err.group : "envelope",
        },
        "[backup] export stream failed after response started",
      );
      res.destroy(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    next(err);
  }
});

const BackupImportRequest = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  backup: z.unknown(),
}).strict();

/**
 * Restores an agency's own backup file. Always scoped to the importer's
 * tenant — the file's `tenant.id` must match, so a file from another agency
 * (or an incompatible/unknown format) is rejected before any write happens.
 *
 * Idempotent both at the whole-request level (`backupImportBatchesTable`,
 * replays an identical request under the same idempotency key) and at the
 * per-row level (`backupImportRecordsTable`, so re-uploading the same or a
 * partially-imported file later — even under a new idempotency key — never
 * duplicates already-restored rows).
 */
router.post("/backup/import", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role !== ROLES.AGENCY_ADMIN) {
      next(new ForbiddenError("Apenas administradores da agência podem restaurar backups.", "FORBIDDEN_ROLE"));
      return;
    }

    const parsedRequest = BackupImportRequest.safeParse(req.body);
    if (!parsedRequest.success) {
      next(new ValidationError(`Arquivo de backup inválido: ${parsedRequest.error.message}`, "BACKUP_IMPORT_INVALID"));
      return;
    }
    const { idempotencyKey } = parsedRequest.data;
    let backup;
    try {
      backup = normalizeBackupPayload(parsedRequest.data.backup);
    } catch (error) {
      if (error instanceof BackupContractError) {
        next(new ValidationError(error.message, error.code));
        return;
      }
      throw error;
    }

    const [destinationTenant] = await db.select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      slug: tenantsTable.slug,
      email: tenantsTable.email,
      cnpj: tenantsTable.cnpj,
    }).from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1);
    if (!destinationTenant) {
      next(new NotFoundError("Agência de destino não encontrada.", "TENANT_NOT_FOUND"));
      return;
    }
    if (!isSameLogicalAgency(backup.tenant, destinationTenant)) {
      next(new ValidationError(
        "A identidade da agência de origem não corresponde à agência de destino. Confira CNPJ, e-mail ou slug antes de restaurar.",
        "BACKUP_IMPORT_TENANT_MISMATCH",
      ));
      return;
    }
    const data = backup.data as Record<string, unknown>;
    const requiredBlocks = ["agencia", "usuarios", "clientes", "viagens", "reservas", "embarqueCheckin", "automacoes", "indicacoes", "loja", "financeiro"];
    const missingBlocks = requiredBlocks.filter((key) => !(key in data));
    if (missingBlocks.length > 0) {
      next(new ValidationError(
        `Arquivo de backup incompleto: faltam as seções ${missingBlocks.join(", ")}.`,
        "BACKUP_IMPORT_MISSING_SECTIONS",
      ));
      return;
    }

    const requestHash = createHash("sha256").update(JSON.stringify(backup)).digest("hex");

    type ImportTransactionResult =
      | { kind: "replay"; report: BackupImportReport }
      | { kind: "conflict" }
      | { kind: "response"; report: BackupImportReport; batchId: string };

    let transactionResult: ImportTransactionResult;
    try {
      transactionResult = await db.transaction(async (tx): Promise<ImportTransactionResult> => {
        await tx.execute(sqlForUpdate(me.tenantId));

        const [existingBatch] = await tx.select().from(backupImportBatchesTable)
          .where(and(
            eq(backupImportBatchesTable.tenantId, me.tenantId),
            eq(backupImportBatchesTable.idempotencyKey, idempotencyKey),
          ))
          .limit(1);
        if (existingBatch) {
          if (existingBatch.requestHash !== requestHash) return { kind: "conflict" };
          return { kind: "replay", report: existingBatch.report };
        }

        const report = emptyReport();
        const ledger = await loadLedger(tx, me.tenantId);

        report.agencia = await importAgencia(tx, me.tenantId, data.agencia);

        const usuarios = data.usuarios as Record<string, unknown> | undefined;
        const users = await resolveUsers(tx, me.tenantId, me.id, usuarios?.users);
        report.usuarios = { matched: users.matched, fallbackToImporter: users.fallbackToImporter, fallbackDetails: users.fallbackDetails };

        await importConvites(tx, ledger, me.tenantId, users, usuarios?.invites, report.convites);

        const clientes = data.clientes as Record<string, unknown> | undefined;
        await importClientes(tx, ledger, me.tenantId, me.id, users, clientes?.clients, report.clientes);
        await importClientAchievements(tx, ledger, me.tenantId, clientes?.achievements, report.clientesConquistas);
        await importClientDreamDestinations(tx, ledger, me.tenantId, clientes?.dreamDestinations, report.clientesDestinosSonho);
        await importClientNotifications(tx, ledger, me.tenantId, clientes?.notifications, report.clientesNotificacoes);

        // Imported before viagens so trip.layoutId can be remapped through the ledger.
        const cadastrosAuxiliares = data.cadastrosAuxiliares as Record<string, unknown> | undefined;
        await importFornecedores(tx, ledger, me.tenantId, cadastrosAuxiliares?.suppliers, report.fornecedores);
        await importVeiculos(tx, ledger, me.tenantId, cadastrosAuxiliares?.vehicles, report.veiculos);
        await importLayoutsVeiculo(tx, ledger, me.tenantId, cadastrosAuxiliares?.vehicleLayouts, report.layoutsVeiculo);
        await importHospedagens(tx, ledger, me.tenantId, cadastrosAuxiliares?.accommodations, report.hospedagens);
        await importDestinos(tx, ledger, me.tenantId, cadastrosAuxiliares?.destinations, report.destinos);

        const viagens = data.viagens as Record<string, unknown> | undefined;
        await importViagens(tx, ledger, me.tenantId, me.id, users, viagens?.trips, report.viagens);
        await importViagensMidia(tx, ledger, me.tenantId, users, viagens?.media, report.viagensMidia);

        const embarque = data.embarqueCheckin as Record<string, unknown> | undefined;
        await importBoardingLocations(tx, ledger, me.tenantId, embarque?.boardingLocations, report.embarqueLocais);

        const storeId = await findExistingStoreId(tx, me.tenantId);
        const loja = data.loja as Record<string, unknown> | undefined;
        await importLojaProdutos(tx, ledger, me.tenantId, storeId, loja?.products, report.lojaProdutos);
        await importLojaCupons(tx, ledger, me.tenantId, storeId, loja?.coupons, report.lojaCupons);
        await importLojaPedidos(tx, ledger, me.tenantId, storeId, loja?.orders, report.lojaPedidos);
        await importLojaItensPedido(tx, ledger, me.tenantId, loja?.orderItems, report.lojaItensPedido);

        const reservas = data.reservas as Record<string, unknown> | undefined;
        await importReservas(tx, ledger, me.tenantId, me.id, users, reservas?.reservations, report.reservas);
        await importPassageiros(tx, ledger, me.tenantId, reservas?.passengers, report.passageiros);

        await importCheckins(tx, ledger, me.tenantId, users, embarque?.checkins, report.checkins);

        const automacoes = data.automacoes as Record<string, unknown> | undefined;
        await importAutomacoes(tx, ledger, me.tenantId, automacoes?.automations, report.automacoes);
        await importAutomacaoAcoes(tx, ledger, me.tenantId, automacoes?.actions, report.automacaoAcoes);
        await importAutomacaoLogs(tx, ledger, me.tenantId, automacoes?.logs, report.automacaoLogs);

        const indicacoes = data.indicacoes as Record<string, unknown> | undefined;
        await importIndicacoes(tx, ledger, me.tenantId, indicacoes?.referrals, report.indicacoes);

        const pipeline = data.pipeline as Record<string, unknown> | undefined;
        await importPipelines(tx, ledger, me.tenantId, pipeline?.pipelines, report.pipelines);
        await importEtapasPipeline(tx, ledger, me.tenantId, pipeline?.stages, report.etapasPipeline);
        await importNegociacoes(tx, ledger, me.tenantId, me.id, users, pipeline?.deals, report.negociacoes);

        const fidelidade = data.fidelidade as Record<string, unknown> | undefined;
        await importFidelidadeProgramas(tx, ledger, me.tenantId, fidelidade?.programs, report.fidelidadeProgramas);
        await importFidelidadeMembros(tx, ledger, me.tenantId, fidelidade?.members, report.fidelidadeMembros);

        const financeiro = data.financeiro as Record<string, unknown> | undefined;
        await importPagamentos(tx, ledger, me.tenantId, financeiro?.payments, report.pagamentos);
        await importDespesas(tx, ledger, me.tenantId, me.id, users, financeiro?.expenses, report.despesas);
        await importFinanceiroAcertos(tx, ledger, me.tenantId, users, financeiro?.settlementItems, report.financeiroAcertos);
        await importFinanceiroLancamentos(tx, ledger, me.tenantId, users, financeiro?.ledgerEntries, report.financeiroLancamentos);

        // Loyalty references reservations, referrals and payments. Import only
        // after all three ledgers are available so referenceId never retains a
        // stale identifier from the source installation.
        await importFidelidadeTransacoes(tx, ledger, me.tenantId, fidelidade?.transactions, report.fidelidadeTransacoes);

        // Calendario references payments, so it's imported after financeiro.
        await importCalendario(tx, ledger, me.tenantId, users, data.calendario, report.calendario);

        await importDocumentos(tx, ledger, me.tenantId, me.id, users, data.documentos, report.documentos);

        const marketing = data.marketing as Record<string, unknown> | undefined;
        await importMarketingCampanhas(tx, ledger, me.tenantId, me.id, users, marketing?.campaigns, report.marketingCampanhas);
        await importMarketingEnvios(tx, ledger, me.tenantId, marketing?.campaignSends, report.marketingEnvios);
        await importMarketingNps(tx, ledger, me.tenantId, marketing?.npsResponses, report.marketingNps);

        const comunicacao = data.comunicacao as Record<string, unknown> | undefined;
        await importOutboundMessages(tx, ledger, me.tenantId, comunicacao?.outboundMessages, report.outboundMessages);
        await importOutboundDeliveries(tx, ledger, me.tenantId, comunicacao?.outboundDeliveries, report.outboundDeliveries);
        await importOutboundDeliveryAttempts(tx, ledger, me.tenantId, comunicacao?.outboundDeliveryAttempts, report.outboundDeliveryAttempts);

        const distribuicao = data.distribuicao as Record<string, unknown> | undefined;
        await importDistribuicaoOfertas(tx, ledger, me.tenantId, distribuicao?.offers, report.distribuicaoOfertas);
        await importDistribuicaoOperacoes(tx, ledger, me.tenantId, distribuicao?.operations, report.distribuicaoOperacoes);
        await importDistribuicaoReservas(tx, ledger, me.tenantId, distribuicao?.bookings, report.distribuicaoReservas);

        const batchId = generateId();
        await tx.insert(backupImportBatchesTable).values({
          id: batchId,
          tenantId: me.tenantId,
          idempotencyKey,
          requestHash,
          status: "completed",
          report,
          createdById: me.id,
        });

        return { kind: "response", report, batchId };
      });
    } catch (error) {
      logger.error({ err: error, tenantId: me.tenantId, idempotencyKey }, "[backup] import transaction rolled back");
      next(new AppError(
        "Restauração não concluída; nenhuma alteração foi feita. Tente novamente com a mesma chave.",
        500,
        "BACKUP_IMPORT_FAILED",
      ));
      return;
    }

    if (transactionResult.kind === "conflict") {
      res.status(409).json({
        error: "A chave de importação já foi usada com outro arquivo.",
        code: "BACKUP_IMPORT_IDEMPOTENCY_CONFLICT",
      });
      return;
    }
    if (transactionResult.kind === "replay") {
      res.status(200).json({ replayed: true, report: transactionResult.report });
      return;
    }
    res.status(200).json({ importId: transactionResult.batchId, report: transactionResult.report });
  } catch (err) {
    next(err);
  }
});

function sqlForUpdate(tenantId: string) {
  return sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
}

export default router;

import { ROLES } from "@workspace/permissions";
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// A generic mock of @workspace/db that stores fixture rows per table (keyed
// by the table's own proxy object identity, not call order) and re-applies
// the same eq/and/gt/inArray conditions the route passes to `.where()`. This
// lets a single fixture set exercise tenant scoping exactly the way the real
// query would, regardless of the order routes/backup.ts queries tables in.
const { rowsByTable, mockRequireAuth, tables, makeChain } = vi.hoisted(() => {
  const rowsByTable = new Map<unknown, Record<string, unknown>[]>();
  const mockRequireAuth = vi.fn();

  function makeTableProxy() {
    return new Proxy(
      {},
      { get: (_target, property: string | symbol) => (typeof property === "string" ? property : undefined) },
    );
  }

  const tableNames = [
    "tenantsTable", "usersTable", "clientsTable", "notesTable", "tripsTable",
    "reservationsTable", "passengersTable", "reservationInstallmentsTable", "reservationSequencesTable",
    "boardingLocationsTable", "tripCheckinsTable", "tripGuideLocationsTable", "automationsTable",
    "automationActionsTable", "automationLogsTable", "referralsTable",
    "referralTrackingTable", "referralSettingsTable", "referralCampaignsTable",
    "referralCommissionsTable", "referralAttemptLogsTable", "storesTable",
    "storeCategoriesTable", "storeProductsTable", "storeOrdersTable",
    "storeOrderItemsTable", "storeCouponsTable", "storeReviewsTable",
    "storePagesTable", "priceAlertSubscriptionsTable", "couponsTable", "paymentsTable", "expensesTable",
    "tripCostsTable", "financialLedgerEntriesTable", "settlementItemsTable",
    "suppliersTable", "vehiclesTable", "vehicleLayoutsTable", "accommodationsTable",
    "destinationsTable", "systemConfigsTable", "calendarEventsTable", "documentsTable",
    "salesGoalsTable", "commissionRulesTable", "commissionsTable", "pipelinesTable",
    "pipelineStagesTable", "dealsTable", "loyaltyProgramsTable", "loyaltyMembersTable",
    "loyaltyTransactionsTable", "clubConfigTable", "clubBenefitsTable", "campaignsTable",
    "campaignSendsTable", "npsResponsesTable", "clientNpsResponsesTable", "productsTable",
    "ordersTable", "orderItemsTable", "messagesTable", "messageTemplatesTable",
    "chatbotConversationsTable", "chatbotMessagesTable", "birthdayMessagesTable",
    "emailLogsTable", "whatsappNotificationOutboxTable", "tripMediaTable", "tripImportBatchesTable",
    "clientAchievementsTable", "clientDreamDestinationsTable", "clientFavoritesTable",
    "clientNotificationsTable", "clientScoresTable", "npsInvitationsTable", "invitesTable",
    "tenantIntegrationsTable", "tenantIntegrationLogsTable", "aiIntegrationsTable", "aiIntegrationLogsTable",
    "productCategoriesTable", "productImagesTable", "cartItemsTable",
    "partnersTable", "partnerProductsTable", "partnerAvailabilityTable", "partnerCommissionsTable",
    "distributionOffersTable", "distributionOperationsTable", "distributionBookingsTable",
    "gemeoAlertsTable", "gemeoOpportunitiesTable", "insightsChatHistoryTable", "auditLogsTable",
  ] as const;

  const tables: Record<string, unknown> = {};
  for (const name of tableNames) tables[name] = makeTableProxy();

  type Condition =
    | { type: "eq"; column: string; value: unknown }
    | { type: "gt"; column: string; value: unknown }
    | { type: "inArray"; column: string; values: unknown[] }
    | { type: "and"; args: Condition[] }
    | undefined;

  function matchesCondition(row: Record<string, unknown>, cond: Condition): boolean {
    if (!cond) return true;
    if (cond.type === "and") return cond.args.every((c) => matchesCondition(row, c));
    if (cond.type === "eq") return row[cond.column] === cond.value;
    if (cond.type === "gt") return String(row[cond.column]) > String(cond.value);
    if (cond.type === "inArray") return cond.values.includes(row[cond.column]);
    return true;
  }

  function makeChain() {
    let fromTable: unknown;
    let condition: Condition;
    const chain = {
      from: (t: unknown) => { fromTable = t; return chain; },
      where: (cond: Condition) => { condition = cond; return chain; },
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (rows: unknown[]) => unknown, reject: (err: unknown) => unknown) => {
        const rows = rowsByTable.get(fromTable) ?? [];
        return Promise.resolve(rows.filter((r) => matchesCondition(r, condition))).then(resolve, reject);
      },
    };
    return chain;
  }

  return { rowsByTable, mockRequireAuth, tables, makeChain };
});

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(() => makeChain()) },
  ...tables,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  eq: vi.fn((column: unknown, value: unknown) => ({ type: "eq", column, value })),
  gt: vi.fn((column: unknown, value: unknown) => ({ type: "gt", column, value })),
  asc: vi.fn((column: unknown) => ({ type: "asc", column })),
  inArray: vi.fn((column: unknown, values: unknown[]) => ({ type: "inArray", column, values })),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  ROLES,
}));

import backupRouter from "../routes/backup.js";
import { errorHandler } from "../middlewares/errorHandler.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", backupRouter);
  app.use(errorHandler);
  return app;
}

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

const ADMIN = {
  id: "admin-1",
  clerkId: "clerk-admin-1",
  tenantId: TENANT_A,
  role: ROLES.AGENCY_ADMIN,
  name: "Admin",
  email: "admin@example.com",
};

function seedFullTenantFixture() {
  rowsByTable.clear();
  rowsByTable.set(tables.tenantsTable, [
    {
      id: TENANT_A,
      name: "Agência A",
      slug: "agencia-a",
      email: "contato@agencia-a.example",
      cnpj: "12.345.678/0001-90",
      primaryColor: "#000",
    },
    { id: TENANT_B, name: "Agência B", slug: "agencia-b", primaryColor: "#fff" },
  ]);
  rowsByTable.set(tables.usersTable, [
    {
      id: "user-a1", tenantId: TENANT_A, name: "Vendedor A", email: "vendedor-a@example.com",
      role: ROLES.SALES, googleAccessToken: "secret-access-token", googleRefreshToken: "secret-refresh-token",
      googleTokenExpiry: new Date(),
    },
    { id: "user-b1", tenantId: TENANT_B, name: "Vendedor B (outro tenant)", email: "vendedor-b@example.com", role: ROLES.SALES },
  ]);
  rowsByTable.set(tables.clientsTable, [
    {
      id: "client-a1", tenantId: TENANT_A, name: "Cliente A", email: "cliente-a@example.com",
      expoPushToken: "ExponentPushToken[secret-device-token-a]",
    },
    { id: "client-b1", tenantId: TENANT_B, name: "Cliente B (outro tenant)", email: "cliente-b@example.com" },
  ]);
  rowsByTable.set(tables.notesTable, [
    { id: "note-a1", clientId: "client-a1", content: "Nota do cliente A" },
    { id: "note-b1", clientId: "client-b1", content: "Nota do cliente B (outro tenant)" },
  ]);
  rowsByTable.set(tables.tripsTable, [
    { id: "trip-a1", tenantId: TENANT_A, name: "Viagem A" },
    { id: "trip-b1", tenantId: TENANT_B, name: "Viagem B (outro tenant)" },
  ]);
  rowsByTable.set(tables.reservationsTable, [
    { id: "res-a1", tenantId: TENANT_A, tripId: "trip-a1", clientId: "client-a1" },
    { id: "res-b1", tenantId: TENANT_B, tripId: "trip-b1", clientId: "client-b1" },
  ]);
  rowsByTable.set(tables.passengersTable, [
    { id: "pax-a1", reservationId: "res-a1", name: "Passageiro A" },
    { id: "pax-b1", reservationId: "res-b1", name: "Passageiro B (outro tenant)" },
  ]);
  rowsByTable.set(tables.reservationInstallmentsTable, [
    { id: "inst-a1", tenantId: TENANT_A, reservationId: "res-a1" },
    { id: "inst-b1", tenantId: TENANT_B, reservationId: "res-b1" },
  ]);
  rowsByTable.set(tables.reservationSequencesTable, [
    { tenantId: TENANT_A, yearMonth: "2026-08", typeCode: "VIAGEM", lastNum: 12 },
    { tenantId: TENANT_B, yearMonth: "2026-08", typeCode: "VIAGEM", lastNum: 7 },
  ]);
  rowsByTable.set(tables.boardingLocationsTable, [
    { id: "board-a1", tenantId: TENANT_A, name: "Ponto A" },
    { id: "board-b1", tenantId: TENANT_B, name: "Ponto B (outro tenant)" },
  ]);
  rowsByTable.set(tables.tripCheckinsTable, [
    { id: "checkin-a1", tenantId: TENANT_A, tripId: "trip-a1" },
    { id: "checkin-b1", tenantId: TENANT_B, tripId: "trip-b1" },
  ]);
  rowsByTable.set(tables.automationsTable, [
    { id: "auto-a1", tenantId: TENANT_A, name: "Automação A" },
    { id: "auto-b1", tenantId: TENANT_B, name: "Automação B (outro tenant)" },
  ]);
  rowsByTable.set(tables.automationActionsTable, [
    { id: "action-a1", tenantId: TENANT_A, automationId: "auto-a1" },
    { id: "action-b1", tenantId: TENANT_B, automationId: "auto-b1" },
  ]);
  rowsByTable.set(tables.automationLogsTable, [
    { id: "log-a1", tenantId: TENANT_A, automationId: "auto-a1" },
    { id: "log-b1", tenantId: TENANT_B, automationId: "auto-b1" },
  ]);
  rowsByTable.set(tables.referralsTable, [
    { id: "ref-a1", tenantId: TENANT_A, referrerId: "client-a1" },
    { id: "ref-b1", tenantId: TENANT_B, referrerId: "client-b1" },
  ]);
  rowsByTable.set(tables.referralTrackingTable, [
    { id: "track-a1", tenantId: TENANT_A },
    { id: "track-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.referralSettingsTable, [
    { id: "refset-a1", tenantId: TENANT_A },
    { id: "refset-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.referralCampaignsTable, [
    { id: "campaign-a1", tenantId: TENANT_A },
    { id: "campaign-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.referralCommissionsTable, [
    { id: "refcomm-a1", tenantId: TENANT_A },
    { id: "refcomm-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.referralAttemptLogsTable, [
    { id: "attempt-a1", tenantId: TENANT_A },
    { id: "attempt-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.storesTable, [
    {
      id: "store-a1", tenantId: TENANT_A, name: "Loja A",
      stripeSecretKey: "sk_live_secret_a", stripeWebhookSecret: "whsec_secret_a", mpAccessToken: "mp_secret_a",
    },
    { id: "store-b1", tenantId: TENANT_B, name: "Loja B (outro tenant)" },
  ]);
  rowsByTable.set(tables.storeCategoriesTable, [
    { id: "cat-a1", storeId: "store-a1", name: "Categoria A" },
    { id: "cat-b1", storeId: "store-b1", name: "Categoria B (outro tenant)" },
  ]);
  rowsByTable.set(tables.storeProductsTable, [
    { id: "prod-a1", storeId: "store-a1", name: "Produto A" },
    { id: "prod-b1", storeId: "store-b1", name: "Produto B (outro tenant)" },
  ]);
  rowsByTable.set(tables.storeOrdersTable, [
    { id: "order-a1", tenantId: TENANT_A, storeId: "store-a1", paymentToken: "secret-payment-token-a", idempotencyKey: "secret-idempotency-key-a" },
    { id: "order-b1", tenantId: TENANT_B, storeId: "store-b1", paymentToken: "secret-payment-token-b", idempotencyKey: "secret-idempotency-key-b" },
  ]);
  rowsByTable.set(tables.storeOrderItemsTable, [
    { id: "item-a1", orderId: "order-a1", productName: "Produto A" },
    { id: "item-b1", orderId: "order-b1", productName: "Produto B (outro tenant)" },
  ]);
  rowsByTable.set(tables.storeCouponsTable, [
    { id: "scoupon-a1", storeId: "store-a1", code: "PROMOA" },
    { id: "scoupon-b1", storeId: "store-b1", code: "PROMOB" },
  ]);
  rowsByTable.set(tables.storeReviewsTable, [
    { id: "review-a1", storeId: "store-a1" },
    { id: "review-b1", storeId: "store-b1" },
  ]);
  rowsByTable.set(tables.storePagesTable, [
    { id: "page-a1", storeId: "store-a1" },
    { id: "page-b1", storeId: "store-b1" },
  ]);
  rowsByTable.set(tables.couponsTable, [
    { id: "coupon-a1", tenantId: TENANT_A, code: "CRMA" },
    { id: "coupon-b1", tenantId: TENANT_B, code: "CRMB" },
  ]);
  rowsByTable.set(tables.paymentsTable, [
    { id: "pay-a1", tenantId: TENANT_A },
    { id: "pay-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.expensesTable, [
    { id: "exp-a1", tenantId: TENANT_A },
    { id: "exp-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.tripCostsTable, [
    { id: "cost-a1", tenantId: TENANT_A },
    { id: "cost-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.suppliersTable, [
    { id: "sup-a1", tenantId: TENANT_A },
    { id: "sup-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.vehiclesTable, [
    { id: "veh-a1", tenantId: TENANT_A },
    { id: "veh-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.accommodationsTable, [
    { id: "acc-a1", tenantId: TENANT_A },
    { id: "acc-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.destinationsTable, [
    { id: "dest-a1", tenantId: TENANT_A },
    { id: "dest-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.tripGuideLocationsTable, [
    { id: "guideloc-a1", tenantId: TENANT_A, tripId: "trip-a1" },
    { id: "guideloc-b1", tenantId: TENANT_B, tripId: "trip-b1" },
  ]);
  rowsByTable.set(tables.priceAlertSubscriptionsTable, [
    {
      id: "alert-a1", tenantId: TENANT_A, storeId: "store-a1", email: "alerta-a@example.com",
      confirmationTokenHash: "secret-confirm-hash-a", unsubscribeTokenHash: "secret-unsub-hash-a",
    },
    { id: "alert-b1", tenantId: TENANT_B, storeId: "store-b1", email: "alerta-b@example.com" },
  ]);
  rowsByTable.set(tables.financialLedgerEntriesTable, [
    { id: "ledger-a1", tenantId: TENANT_A },
    { id: "ledger-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.settlementItemsTable, [
    { id: "settle-a1", tenantId: TENANT_A },
    { id: "settle-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.vehicleLayoutsTable, [
    { id: "layout-a1", tenantId: TENANT_A },
    { id: "layout-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.systemConfigsTable, [
    { id: "config-a1", tenantId: TENANT_A, key: "loyalty_settings" },
    { id: "config-b1", tenantId: TENANT_B, key: "loyalty_settings" },
  ]);
  rowsByTable.set(tables.calendarEventsTable, [
    { id: "cal-a1", tenantId: TENANT_A },
    { id: "cal-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.documentsTable, [
    { id: "doc-a1", tenantId: TENANT_A },
    { id: "doc-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.salesGoalsTable, [
    { id: "goal-a1", tenantId: TENANT_A },
    { id: "goal-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.commissionRulesTable, [
    { id: "crule-a1", tenantId: TENANT_A },
    { id: "crule-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.commissionsTable, [
    { id: "comm-a1", tenantId: TENANT_A },
    { id: "comm-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.pipelinesTable, [
    { id: "pipe-a1", tenantId: TENANT_A },
    { id: "pipe-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.pipelineStagesTable, [
    { id: "stage-a1", tenantId: TENANT_A },
    { id: "stage-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.dealsTable, [
    { id: "deal-a1", tenantId: TENANT_A },
    { id: "deal-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.loyaltyProgramsTable, [
    { id: "loyprog-a1", tenantId: TENANT_A },
    { id: "loyprog-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.loyaltyMembersTable, [
    { id: "loymem-a1", tenantId: TENANT_A },
    { id: "loymem-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.loyaltyTransactionsTable, [
    { id: "loytx-a1", tenantId: TENANT_A },
    { id: "loytx-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.clubConfigTable, [
    { id: "club-a1", tenantId: TENANT_A },
    { id: "club-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.clubBenefitsTable, [
    { id: "benefit-a1", tenantId: TENANT_A },
    { id: "benefit-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.campaignsTable, [
    { id: "mktcamp-a1", tenantId: TENANT_A },
    { id: "mktcamp-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.campaignSendsTable, [
    { id: "send-a1", tenantId: TENANT_A },
    { id: "send-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.npsResponsesTable, [
    { id: "ecnps-a1", tenantId: TENANT_A },
    { id: "ecnps-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.clientNpsResponsesTable, [
    { id: "clnps-a1", tenantId: TENANT_A, clientId: "client-a1" },
    { id: "clnps-b1", tenantId: TENANT_B, clientId: "client-b1" },
  ]);
  rowsByTable.set(tables.productsTable, [
    { id: "ptsprod-a1", tenantId: TENANT_A },
    { id: "ptsprod-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.ordersTable, [
    { id: "ptsorder-a1", tenantId: TENANT_A },
    { id: "ptsorder-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.orderItemsTable, [
    { id: "ptsitem-a1", orderId: "ptsorder-a1" },
    { id: "ptsitem-b1", orderId: "ptsorder-b1" },
  ]);
  rowsByTable.set(tables.messagesTable, [
    { id: "msg-a1", tenantId: TENANT_A },
    { id: "msg-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.messageTemplatesTable, [
    { id: "tmpl-a1", tenantId: TENANT_A },
    { id: "tmpl-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.chatbotConversationsTable, [
    { id: "conv-a1", tenantId: TENANT_A },
    { id: "conv-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.chatbotMessagesTable, [
    { id: "cmsg-a1", tenantId: TENANT_A },
    { id: "cmsg-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.birthdayMessagesTable, [
    { id: "bday-a1", tenantId: TENANT_A },
    { id: "bday-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.emailLogsTable, [
    { id: "email-a1", tenantId: TENANT_A },
    { id: "email-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.whatsappNotificationOutboxTable, [
    { id: "wa-a1", tenantId: TENANT_A },
    { id: "wa-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.tripMediaTable, [
    { id: "media-a1", tenantId: TENANT_A, tripId: "trip-a1" },
    { id: "media-b1", tenantId: TENANT_B, tripId: "trip-b1" },
  ]);
  rowsByTable.set(tables.tripImportBatchesTable, [
    { id: "import-a1", tenantId: TENANT_A },
    { id: "import-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.clientAchievementsTable, [
    { id: "achv-a1", tenantId: TENANT_A, clientId: "client-a1" },
    { id: "achv-b1", tenantId: TENANT_B, clientId: "client-b1" },
  ]);
  rowsByTable.set(tables.clientDreamDestinationsTable, [
    { id: "dream-a1", tenantId: TENANT_A, clientId: "client-a1" },
    { id: "dream-b1", tenantId: TENANT_B, clientId: "client-b1" },
  ]);
  rowsByTable.set(tables.clientFavoritesTable, [
    { id: "fav-a1", tenantId: TENANT_A, clientId: "client-a1" },
    { id: "fav-b1", tenantId: TENANT_B, clientId: "client-b1" },
  ]);
  rowsByTable.set(tables.clientNotificationsTable, [
    { id: "notif-a1", tenantId: TENANT_A, clientId: "client-a1" },
    { id: "notif-b1", tenantId: TENANT_B, clientId: "client-b1" },
  ]);
  rowsByTable.set(tables.clientScoresTable, [
    { id: "score-a1", tenantId: TENANT_A, clientId: "client-a1" },
    { id: "score-b1", tenantId: TENANT_B, clientId: "client-b1" },
  ]);
  rowsByTable.set(tables.npsInvitationsTable, [
    { id: "npsinv-a1", tenantId: TENANT_A, clientId: "client-a1", reservationId: "res-a1", token: "secret-nps-token-a" },
    { id: "npsinv-b1", tenantId: TENANT_B, clientId: "client-b1", reservationId: "res-b1", token: "secret-nps-token-b" },
  ]);
  rowsByTable.set(tables.invitesTable, [
    { id: "invite-a1", tenantId: TENANT_A, email: "convite-a@example.com", token: "secret-invite-token-a" },
    { id: "invite-b1", tenantId: TENANT_B, email: "convite-b@example.com", token: "secret-invite-token-b" },
  ]);
  rowsByTable.set(tables.tenantIntegrationsTable, [
    { id: "integ-a1", tenantId: TENANT_A, type: "whatsapp_evolution", config: { baseUrl: "https://a.example.com" }, secretsEncrypted: "secret-integration-blob-a" },
    { id: "integ-b1", tenantId: TENANT_B, type: "whatsapp_evolution", config: {}, secretsEncrypted: "secret-integration-blob-b" },
  ]);
  rowsByTable.set(tables.tenantIntegrationLogsTable, [
    { id: "integlog-a1", tenantId: TENANT_A },
    { id: "integlog-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.aiIntegrationsTable, [
    { id: "ai-a1", tenantId: TENANT_A, provider: "openai", apiKeyEncrypted: "secret-ai-key-a", accessTokenEncrypted: "secret-ai-token-a" },
    { id: "ai-b1", tenantId: TENANT_B, provider: "openai", apiKeyEncrypted: "secret-ai-key-b", accessTokenEncrypted: "secret-ai-token-b" },
  ]);
  rowsByTable.set(tables.aiIntegrationLogsTable, [
    { id: "ailog-a1", tenantId: TENANT_A },
    { id: "ailog-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.productCategoriesTable, [
    { id: "pcat-a1", tenantId: TENANT_A },
    { id: "pcat-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.productImagesTable, [
    { id: "pimg-a1", tenantId: TENANT_A },
    { id: "pimg-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.cartItemsTable, [
    { id: "cart-a1", tenantId: TENANT_A, clientId: "client-a1" },
    { id: "cart-b1", tenantId: TENANT_B, clientId: "client-b1" },
  ]);
  rowsByTable.set(tables.partnersTable, [
    { id: "partner-a1", tenantId: TENANT_A, name: "Parceiro A", email: "parceiro-a@example.com", slug: "parceiro-a", passwordHash: "secret-partner-hash-a" },
    { id: "partner-b1", tenantId: TENANT_B, name: "Parceiro B (outro tenant)", email: "parceiro-b@example.com", slug: "parceiro-b", passwordHash: "secret-partner-hash-b" },
  ]);
  rowsByTable.set(tables.partnerProductsTable, [
    { id: "pprod-a1", tenantId: TENANT_A, partnerId: "partner-a1" },
    { id: "pprod-b1", tenantId: TENANT_B, partnerId: "partner-b1" },
  ]);
  rowsByTable.set(tables.partnerAvailabilityTable, [
    { id: "pavail-a1", productId: "pprod-a1" },
    { id: "pavail-b1", productId: "pprod-b1" },
  ]);
  rowsByTable.set(tables.partnerCommissionsTable, [
    { id: "pcomm-a1", tenantId: TENANT_A, partnerId: "partner-a1" },
    { id: "pcomm-b1", tenantId: TENANT_B, partnerId: "partner-b1" },
  ]);
  rowsByTable.set(tables.distributionOffersTable, [
    { id: "distoffer-a1", tenantId: TENANT_A },
    { id: "distoffer-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.distributionOperationsTable, [
    { id: "distop-a1", tenantId: TENANT_A },
    { id: "distop-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.distributionBookingsTable, [
    { id: "distbook-a1", tenantId: TENANT_A },
    { id: "distbook-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.gemeoAlertsTable, [
    { id: "gemeoalert-a1", tenantId: TENANT_A },
    { id: "gemeoalert-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.gemeoOpportunitiesTable, [
    { id: "gemeoopp-a1", tenantId: TENANT_A },
    { id: "gemeoopp-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.insightsChatHistoryTable, [
    { id: "insights-a1", tenantId: TENANT_A },
    { id: "insights-b1", tenantId: TENANT_B },
  ]);
  rowsByTable.set(tables.auditLogsTable, [
    { id: "audit-a1", tenantId: TENANT_A },
    { id: "audit-b1", tenantId: TENANT_B },
  ]);
}

beforeEach(() => {
  mockRequireAuth.mockReset();
  rowsByTable.clear();
});

describe("GET /api/backup/export", () => {
  it("streams a versioned backup with every entity group, scoped to the caller's tenant, with no credentials", async () => {
    seedFullTenantFixture();
    mockRequireAuth.mockResolvedValue(ADMIN);

    const response = await request(buildApp()).get("/api/backup/export").expect(200);

    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain("agencia-a");

    const body = response.body as {
      format: string;
      version: number;
      tenant: { id: string; name: string; slug: string; email?: string; cnpj?: string };
      data: Record<string, unknown>;
      counts: Record<string, number>;
    };

    // Envelope identifies format/version/source tenant for a future importer.
    expect(body.format).toBe("visitecrm-agency-backup");
    expect(body.version).toBe(4);
    expect(body.tenant).toMatchObject({
      id: TENANT_A,
      name: "Agência A",
      slug: "agencia-a",
      email: "contato@agencia-a.example",
      cnpj: "12.345.678/0001-90",
    });

    // Every required entity group from the task's acceptance criteria is present.
    const data = body.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(
      [
        "agencia", "usuarios", "configuracoes", "clientes", "viagens", "reservas", "embarqueCheckin",
        "automacoes", "indicacoes", "loja", "cuponsCrm", "financeiro", "metasVendas", "comissoes",
        "pipeline", "fidelidade", "clube", "marketing", "comunicacao", "integracoes",
        "inteligenciaArtificial", "catalogoLegado", "parceiros", "distribuicao", "auditoria",
        "calendario", "documentos", "cadastrosAuxiliares",
      ].sort(),
    );
    expect((data.usuarios as { users: unknown[]; invites: unknown[] }).users).toHaveLength(1);
    expect((data.usuarios as { users: unknown[]; invites: unknown[] }).invites).toHaveLength(1);
    expect((data.clientes as { clients: unknown[]; notes: unknown[] }).clients).toHaveLength(1);
    expect((data.clientes as { clients: unknown[]; notes: unknown[] }).notes).toHaveLength(1);
    expect((data.clientes as { achievements: unknown[]; dreamDestinations: unknown[]; favorites: unknown[]; notifications: unknown[]; scores: unknown[]; npsInvitations: unknown[] }).achievements).toHaveLength(1);
    expect((data.clientes as { dreamDestinations: unknown[] }).dreamDestinations).toHaveLength(1);
    expect((data.clientes as { favorites: unknown[] }).favorites).toHaveLength(1);
    expect((data.clientes as { notifications: unknown[] }).notifications).toHaveLength(1);
    expect((data.clientes as { scores: unknown[] }).scores).toHaveLength(1);
    expect((data.clientes as { npsInvitations: unknown[] }).npsInvitations).toHaveLength(1);
    expect((data.viagens as { trips: unknown[]; media: unknown[]; importBatches: unknown[] }).media).toHaveLength(1);
    expect((data.viagens as { importBatches: unknown[] }).importBatches).toHaveLength(1);
    expect((data.reservas as { reservations: unknown[]; passengers: unknown[]; installments: unknown[] }).passengers).toHaveLength(1);
    expect((data.reservas as { sequences: Array<Record<string, unknown>> }).sequences).toEqual([
      { tenantId: TENANT_A, yearMonth: "2026-08", typeCode: "VIAGEM", lastNum: 12 },
    ]);
    expect((data.loja as { store: unknown[]; categories: unknown[]; products: unknown[]; orders: unknown[] }).categories).toHaveLength(1);
    expect((data.loja as { priceAlertSubscriptions: unknown[] }).priceAlertSubscriptions).toHaveLength(1);
    expect((data.embarqueCheckin as { guideLocations: unknown[] }).guideLocations).toHaveLength(1);
    expect((data.cadastrosAuxiliares as { vehicleLayouts: unknown[] }).vehicleLayouts).toHaveLength(1);
    expect((data.financeiro as { ledgerEntries: unknown[]; settlementItems: unknown[] }).ledgerEntries).toHaveLength(1);
    expect((data.pipeline as { pipelines: unknown[]; stages: unknown[]; deals: unknown[] }).deals).toHaveLength(1);
    expect((data.fidelidade as { programs: unknown[] }).programs).toHaveLength(1);
    expect((data.clube as { benefits: unknown[] }).benefits).toHaveLength(1);
    expect(
      (data.marketing as { campaigns: unknown[]; catalogoPontos: { products: unknown[]; orders: unknown[] } }).catalogoPontos.products,
    ).toHaveLength(1);
    expect((data.comunicacao as { messages: unknown[]; chatbotMessages: unknown[]; emailLogs: unknown[]; whatsappOutbox: unknown[] }).chatbotMessages).toHaveLength(1);
    expect((data.comunicacao as { emailLogs: unknown[] }).emailLogs).toHaveLength(1);
    expect((data.comunicacao as { whatsappOutbox: unknown[] }).whatsappOutbox).toHaveLength(1);
    expect(
      (data.integracoes as { tenantIntegrations: unknown[]; tenantIntegrationLogs: unknown[]; aiIntegrations: unknown[]; aiIntegrationLogs: unknown[] })
        .tenantIntegrations,
    ).toHaveLength(1);
    expect((data.integracoes as { aiIntegrations: unknown[] }).aiIntegrations).toHaveLength(1);
    expect(
      (data.inteligenciaArtificial as { gemeoAlerts: unknown[]; gemeoOpportunities: unknown[]; insightsChatHistory: unknown[] })
        .insightsChatHistory,
    ).toHaveLength(1);
    expect((data.catalogoLegado as { categories: unknown[]; images: unknown[]; cartItems: unknown[] }).cartItems).toHaveLength(1);
    expect((data.parceiros as { partners: unknown[]; products: unknown[]; availability: unknown[]; commissions: unknown[] }).partners).toHaveLength(1);
    expect((data.parceiros as { availability: unknown[] }).availability).toHaveLength(1);
    expect((data.distribuicao as { offers: unknown[]; operations: unknown[]; bookings: unknown[] }).bookings).toHaveLength(1);
    expect(data.auditoria).toHaveLength(1);
    expect(body.counts.cuponsCrm).toBe(1);
    expect(body.counts.calendario).toBe(1);
    expect(body.counts.documentos).toBe(1);
    expect(body.counts.metasVendas).toBe(1);
    expect(body.counts.auditoria).toBe(1);

    // Original IDs and cross-references are preserved for a future importer.
    const client = (data.clientes as { clients: Array<Record<string, unknown>> }).clients[0]!;
    expect(client.id).toBe("client-a1");
    const reservation = (data.reservas as { reservations: Array<Record<string, unknown>> }).reservations[0]!;
    expect(reservation).toMatchObject({ id: "res-a1", tripId: "trip-a1", clientId: "client-a1" });

    const rawText = JSON.stringify(body);

    // Never leaks credentials.
    expect(rawText).not.toContain("secret-access-token");
    expect(rawText).not.toContain("secret-refresh-token");
    expect(rawText).not.toContain("sk_live_secret_a");
    expect(rawText).not.toContain("whsec_secret_a");
    expect(rawText).not.toContain("mp_secret_a");
    expect(rawText).not.toContain("secret-payment-token-a");
    expect(rawText).not.toContain("secret-idempotency-key-a");
    expect(rawText).not.toContain("secret-device-token-a");
    expect(rawText).not.toContain("secret-confirm-hash-a");
    expect(rawText).not.toContain("secret-unsub-hash-a");
    expect(rawText).not.toContain("secret-nps-token-a");
    expect(rawText).not.toContain("secret-invite-token-a");
    expect(rawText).not.toContain("secret-integration-blob-a");
    expect(rawText).not.toContain("secret-ai-key-a");
    expect(rawText).not.toContain("secret-ai-token-a");
    expect(rawText).not.toContain("secret-partner-hash-a");

    // Never leaks another tenant's data.
    expect(rawText).not.toContain(TENANT_B);
    expect(rawText).not.toContain("outro tenant");
  });

  it.each([
    ["gerente", ROLES.AGENCY_MANAGER],
    ["vendedor", ROLES.SALES],
    ["suporte", ROLES.SUPPORT],
    ["cliente", ROLES.CLIENT],
    ["superadmin", ROLES.SUPER_ADMIN],
  ])("blocks %s from generating the tenant backup", async (_label, role) => {
    mockRequireAuth.mockResolvedValue({ ...ADMIN, id: "user-x", role });

    const response = await request(buildApp()).get("/api/backup/export").expect(403);
    expect(response.body.code).toBe("FORBIDDEN_ROLE");
  });
});

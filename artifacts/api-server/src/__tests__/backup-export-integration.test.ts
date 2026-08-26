/**
 * Integration test for GET /api/tenants/backup/export (Task 44 — full agency
 * data backup).
 *
 * Uses the REAL database (not drizzle-chain mocks) because the endpoint reads
 * from ~10 different tables — a hand-maintained mock queue for every select
 * would be extremely brittle to keep in sync with the route. Only Clerk auth
 * is mocked (a thin `getAuth` stub resolved through real `usersTable` rows by
 * clerkId), exactly like the request would flow through `requireAuth` in
 * production.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";
import {
  db,
  tenantsTable,
  usersTable,
  clientsTable,
  tripsTable,
  reservationsTable,
  passengersTable,
  reservationInstallmentsTable,
  storesTable,
  storeCategoriesTable,
  storeProductsTable,
  storeCouponsTable,
  storeOrdersTable,
  storeOrderItemsTable,
  storePagesTable,
  storeReviewsTable,
  paymentsTable,
  expensesTable,
  vehiclesTable,
  vehicleLayoutsTable,
  boardingLocationsTable,
  commissionRulesTable,
  commissionsTable,
  pipelinesTable,
  pipelineStagesTable,
  dealsTable,
  loyaltyProgramsTable,
  loyaltyMembersTable,
  loyaltyTransactionsTable,
  referralSettingsTable,
  referralCampaignsTable,
  referralsTable,
  referralCommissionsTable,
  salesGoalsTable,
  couponsTable,
  documentsTable,
  notesTable,
  messageTemplatesTable,
  automationsTable,
  automationActionsTable,
  tripCostsTable,
  tripMediaTable,
  clientAchievementsTable,
  clientDreamDestinationsTable,
  clientFavoritesTable,
  suppliersTable,
  accommodationsTable,
  destinationsTable,
  clubConfigTable,
  clubBenefitsTable,
  settlementItemsTable,
  financialLedgerEntriesTable,
  partnersTable,
  partnerProductsTable,
  partnerAvailabilityTable,
  partnerCommissionsTable,
  campaignsTable,
  calendarEventsTable,
  productCategoriesTable,
  productImagesTable,
  productsTable,
  ordersTable,
  orderItemsTable,
  npsResponsesTable,
  clientNpsResponsesTable,
  npsInvitationsTable,
  clientScoresTable,
  priceAlertSubscriptionsTable,
  invitesTable,
  tripCheckinsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { generateId } from "../lib/id.js";

// ---------------------------------------------------------------------------
// Clerk auth mock — resolves to whichever clerkId the current test selected.
// requireAuth() itself is NOT mocked; it runs for real against the DB below.
// ---------------------------------------------------------------------------

let currentClerkId = "";

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: currentClerkId })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import tenantsRouter from "../routes/tenants.js";
import { errorHandler } from "../middlewares/errorHandler.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { log: unknown }).log = pino({ level: "silent" });
    (req as express.Request & { id?: string }).id = "test-req";
    next();
  });
  app.use("/api", tenantsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures — two fully isolated tenants (A = under test, B = isolation control)
// ---------------------------------------------------------------------------

const RUN = generateId();

const TENANT_A = { id: `bk-tenant-a-${RUN}`, slug: `bk-agency-a-${RUN}` };
const TENANT_B = { id: `bk-tenant-b-${RUN}`, slug: `bk-agency-b-${RUN}` };

const ADMIN_A = { id: `bk-admin-a-${RUN}`, clerkId: `clerk-bk-admin-a-${RUN}` };
const SELLER_A = { id: `bk-seller-a-${RUN}`, clerkId: `clerk-bk-seller-a-${RUN}` };
const ADMIN_B = { id: `bk-admin-b-${RUN}`, clerkId: `clerk-bk-admin-b-${RUN}` };

const CLIENT_A = { id: `bk-client-a-${RUN}` };
const CLIENT_B = { id: `bk-client-b-${RUN}` };
const TRIP_A = { id: `bk-trip-a-${RUN}` };
const TRIP_B = { id: `bk-trip-b-${RUN}` };
const RESERVATION_A = { id: `bk-res-a-${RUN}` };
const RESERVATION_B = { id: `bk-res-b-${RUN}` };
const PASSENGER_A = { id: `bk-pax-a-${RUN}` };
const STORE_A = { id: `bk-store-a-${RUN}`, slug: `bk-store-a-${RUN}` };
const STORE_B = { id: `bk-store-b-${RUN}`, slug: `bk-store-b-${RUN}` };
const PRODUCT_A = { id: `bk-product-a-${RUN}` };
const COUPON_A = { id: `bk-coupon-a-${RUN}` };
const ORDER_A = { id: `bk-order-a-${RUN}` };
const ORDER_ITEM_A = { id: `bk-order-item-a-${RUN}` };
const PAYMENT_A = { id: `bk-payment-a-${RUN}` };
const EXPENSE_A = { id: `bk-expense-a-${RUN}` };
const LAYOUT_A = { id: `bk-layout-a-${RUN}` };
const BOARDING_A = { id: `bk-boarding-a-${RUN}` };
const VEHICLE_A = { id: `bk-vehicle-a-${RUN}` };
const STORE_CATEGORY_A = { id: `bk-store-cat-a-${RUN}` };
const STORE_PAGE_A = { id: `bk-store-page-a-${RUN}` };
const STORE_REVIEW_A = { id: `bk-store-review-a-${RUN}` };
const INSTALLMENT_A = { id: `bk-installment-a-${RUN}` };
const COMMISSION_RULE_A = { id: `bk-comm-rule-a-${RUN}` };
const COMMISSION_A = { id: `bk-comm-a-${RUN}` };
const PIPELINE_A = { id: `bk-pipeline-a-${RUN}` };
const PIPELINE_STAGE_A = { id: `bk-stage-a-${RUN}` };
const DEAL_A = { id: `bk-deal-a-${RUN}` };
const LOYALTY_PROGRAM_A = { id: `bk-loyalty-prog-a-${RUN}` };
const LOYALTY_MEMBER_A = { id: `bk-loyalty-member-a-${RUN}` };
const LOYALTY_TX_A = { id: `bk-loyalty-tx-a-${RUN}` };
const REFERRAL_SETTINGS_A = { id: `bk-ref-settings-a-${RUN}` };
const REFERRAL_CAMPAIGN_A = { id: `bk-ref-campaign-a-${RUN}` };
const REFERRAL_A = { id: `bk-referral-a-${RUN}` };
const REFERRAL_COMMISSION_A = { id: `bk-ref-comm-a-${RUN}` };
const SALES_GOAL_A = { id: `bk-goal-a-${RUN}` };
const AGENCY_COUPON_A = { id: `bk-agency-coupon-a-${RUN}` };
const DOCUMENT_A = { id: `bk-document-a-${RUN}` };
const NOTE_A = { id: `bk-note-a-${RUN}` };
const MESSAGE_TEMPLATE_A = { id: `bk-msg-tpl-a-${RUN}` };
const AUTOMATION_A = { id: `bk-automation-a-${RUN}` };
const AUTOMATION_ACTION_A = { id: `bk-automation-action-a-${RUN}` };
const TRIP_COST_A = { id: `bk-trip-cost-a-${RUN}` };
const TRIP_MEDIA_A = { id: `bk-trip-media-a-${RUN}` };
const CLIENT_ACHIEVEMENT_A = { id: `bk-achievement-a-${RUN}` };
const CLIENT_DREAM_DEST_A = { id: `bk-dream-dest-a-${RUN}` };
const CLIENT_FAVORITE_A = { id: `bk-favorite-a-${RUN}` };
const SUPPLIER_A = { id: `bk-supplier-a-${RUN}` };
const ACCOMMODATION_A = { id: `bk-accommodation-a-${RUN}` };
const DESTINATION_A = { id: `bk-destination-a-${RUN}` };
const CLUB_CONFIG_A = { id: `bk-club-config-a-${RUN}` };
const CLUB_BENEFIT_A = { id: `bk-club-benefit-a-${RUN}` };
const SETTLEMENT_ITEM_A = { id: `bk-settlement-item-a-${RUN}` };
const LEDGER_ENTRY_A = { id: `bk-ledger-entry-a-${RUN}` };
const PARTNER_A = { id: `bk-partner-a-${RUN}` };
const PARTNER_PRODUCT_A = { id: `bk-partner-product-a-${RUN}` };
const PARTNER_AVAILABILITY_A = { id: `bk-partner-availability-a-${RUN}` };
const PARTNER_COMMISSION_A = { id: `bk-partner-commission-a-${RUN}` };
const CAMPAIGN_A = { id: `bk-campaign-a-${RUN}` };
const CALENDAR_EVENT_A = { id: `bk-calendar-event-a-${RUN}` };
const PRODUCT_CATEGORY_A = { id: `bk-mkt-cat-a-${RUN}` };
const MARKETING_PRODUCT_A = { id: `bk-mkt-product-a-${RUN}` };
const PRODUCT_IMAGE_A = { id: `bk-mkt-image-a-${RUN}` };
const MARKETING_ORDER_A = { id: `bk-mkt-order-a-${RUN}` };
const MARKETING_ORDER_ITEM_A = { id: `bk-mkt-order-item-a-${RUN}` };
const NPS_RESPONSE_A = { id: `bk-nps-resp-a-${RUN}` };
const CLIENT_NPS_RESPONSE_A = { id: `bk-client-nps-a-${RUN}` };
const NPS_INVITATION_A = { id: `bk-nps-invite-a-${RUN}` };
const CLIENT_SCORE_A = { id: `bk-client-score-a-${RUN}` };
const PRICE_ALERT_A = { id: `bk-price-alert-a-${RUN}` };
const INVITE_A = { id: `bk-invite-a-${RUN}` };
const TRIP_CHECKIN_A = { id: `bk-trip-checkin-a-${RUN}` };

// Secret sentinel values — must never appear anywhere in the exported JSON.
const CLERK_ID_SENTINEL = ADMIN_A.clerkId;
const GOOGLE_TOKEN_SENTINEL = `gtok-secret-${RUN}`;
const STRIPE_SECRET_SENTINEL = `sk_test_secret_${RUN}`;
const STRIPE_WEBHOOK_SENTINEL = `whsec_secret_${RUN}`;
const MP_TOKEN_SENTINEL = `mp-access-secret-${RUN}`;
const INVITE_TOKEN_SENTINEL = `invite-tok-secret-${RUN}`;
const NPS_INVITE_TOKEN_SENTINEL = `nps-invite-tok-secret-${RUN}`;

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run the backup-export integration test");
  }

  await db.insert(tenantsTable).values([
    { id: TENANT_A.id, name: "Backup Test Agency A", slug: TENANT_A.slug, email: `bk-a-${RUN}@example.com`, status: "active" },
    { id: TENANT_B.id, name: "Backup Test Agency B", slug: TENANT_B.slug, email: `bk-b-${RUN}@example.com`, status: "active" },
  ]);

  await db.insert(usersTable).values([
    {
      id: ADMIN_A.id, clerkId: ADMIN_A.clerkId, tenantId: TENANT_A.id,
      name: "Admin A", email: `admin-a-${RUN}@example.com`, referralCode: `RC-BKA-${RUN}`,
      role: "agencia", isActive: true,
      googleAccessToken: GOOGLE_TOKEN_SENTINEL, googleRefreshToken: `${GOOGLE_TOKEN_SENTINEL}-refresh`,
    },
    {
      id: SELLER_A.id, clerkId: SELLER_A.clerkId, tenantId: TENANT_A.id,
      name: "Seller A", email: `seller-a-${RUN}@example.com`, referralCode: `RC-BKS-${RUN}`,
      role: "vendedor", isActive: true,
    },
    {
      id: ADMIN_B.id, clerkId: ADMIN_B.clerkId, tenantId: TENANT_B.id,
      name: "Admin B", email: `admin-b-${RUN}@example.com`, referralCode: `RC-BKB-${RUN}`,
      role: "agencia", isActive: true,
    },
  ]);

  await db.insert(clientsTable).values([
    { id: CLIENT_A.id, tenantId: TENANT_A.id, name: "Cliente A", email: `cliente-a-${RUN}@example.com`, whatsapp: "11999990001", createdById: ADMIN_A.id },
    { id: CLIENT_B.id, tenantId: TENANT_B.id, name: "Cliente B", email: `cliente-b-${RUN}@example.com`, whatsapp: "11999990002", createdById: ADMIN_B.id },
  ]);

  await db.insert(vehicleLayoutsTable).values([
    { id: LAYOUT_A.id, tenantId: TENANT_A.id, name: "Layout A", rows: 10, cols: 4, floors: 1 },
  ]);

  await db.insert(boardingLocationsTable).values([
    { id: BOARDING_A.id, tenantId: TENANT_A.id, name: "Terminal A", address: "Rua A, 1", city: "Fortaleza", state: "CE" },
  ]);

  await db.insert(vehiclesTable).values([
    { id: VEHICLE_A.id, tenantId: TENANT_A.id, name: "Ônibus A", type: "onibus", plate: `BKA-${RUN.slice(0, 4)}`, capacity: 44 },
  ]);

  await db.insert(tripsTable).values([
    {
      id: TRIP_A.id, tenantId: TENANT_A.id, name: "Viagem A", slug: `bk-trip-a-${RUN}`,
      destination: "Fortaleza, CE", destinationCity: "Fortaleza", destinationState: "CE",
      type: "excursao", category: "nacional", departureDate: new Date("2027-03-10"),
      totalCapacity: 40, availableSeats: 40, priceAdult: "500.00", createdById: ADMIN_A.id,
      layoutId: LAYOUT_A.id, vehicleId: VEHICLE_A.id,
    },
    {
      id: TRIP_B.id, tenantId: TENANT_B.id, name: "Viagem B", slug: `bk-trip-b-${RUN}`,
      destination: "Recife, PE", destinationCity: "Recife", destinationState: "PE",
      type: "excursao", category: "nacional", departureDate: new Date("2027-03-11"),
      totalCapacity: 40, availableSeats: 40, priceAdult: "500.00", createdById: ADMIN_B.id,
    },
  ]);

  await db.insert(reservationsTable).values([
    {
      id: RESERVATION_A.id, tenantId: TENANT_A.id, tripId: TRIP_A.id, clientId: CLIENT_A.id,
      totalValue: "500.00", paidValue: "500.00", balance: "0.00",
      voucherCode: `VCH-BKA-${RUN}`, qrCode: `QR-BKA-${RUN}`, createdById: ADMIN_A.id,
      boardingLocationId: BOARDING_A.id,
    },
    {
      id: RESERVATION_B.id, tenantId: TENANT_B.id, tripId: TRIP_B.id, clientId: CLIENT_B.id,
      totalValue: "500.00", paidValue: "500.00", balance: "0.00",
      voucherCode: `VCH-BKB-${RUN}`, qrCode: `QR-BKB-${RUN}`, createdById: ADMIN_B.id,
    },
  ]);

  await db.insert(commissionRulesTable).values([
    { id: COMMISSION_RULE_A.id, tenantId: TENANT_A.id, name: "Regra A", value: "10.0000" },
  ]);

  await db.insert(commissionsTable).values([
    {
      id: COMMISSION_A.id, tenantId: TENANT_A.id, ruleId: COMMISSION_RULE_A.id, userId: SELLER_A.id,
      reservationId: RESERVATION_A.id, baseAmount: "500.00", commissionAmount: "50.00",
    },
  ]);

  await db.insert(pipelinesTable).values([
    { id: PIPELINE_A.id, tenantId: TENANT_A.id, name: "Pipeline A" },
  ]);

  await db.insert(pipelineStagesTable).values([
    { id: PIPELINE_STAGE_A.id, tenantId: TENANT_A.id, pipelineId: PIPELINE_A.id, name: "Novo Lead", color: "#000000", order: 0 },
  ]);

  await db.insert(dealsTable).values([
    {
      id: DEAL_A.id, tenantId: TENANT_A.id, stageId: PIPELINE_STAGE_A.id, title: "Negócio A",
      value: "500.00", clientId: CLIENT_A.id, tripId: TRIP_A.id, ownerId: ADMIN_A.id,
    },
  ]);

  await db.insert(loyaltyProgramsTable).values([
    { id: LOYALTY_PROGRAM_A.id, tenantId: TENANT_A.id, name: "Fidelidade A" },
  ]);

  await db.insert(loyaltyMembersTable).values([
    { id: LOYALTY_MEMBER_A.id, tenantId: TENANT_A.id, programId: LOYALTY_PROGRAM_A.id, clientId: CLIENT_A.id },
  ]);

  await db.insert(loyaltyTransactionsTable).values([
    { id: LOYALTY_TX_A.id, tenantId: TENANT_A.id, memberId: LOYALTY_MEMBER_A.id, type: "earn", points: 50, description: "Compra A" },
  ]);

  await db.insert(referralSettingsTable).values([
    { id: REFERRAL_SETTINGS_A.id, tenantId: TENANT_A.id },
  ]);

  await db.insert(referralCampaignsTable).values([
    {
      id: REFERRAL_CAMPAIGN_A.id, tenantId: TENANT_A.id, name: "Campanha A",
      startsAt: new Date("2027-01-01"), endsAt: new Date("2027-12-31"),
    },
  ]);

  await db.insert(referralsTable).values([
    {
      id: REFERRAL_A.id, tenantId: TENANT_A.id, referrerId: ADMIN_A.id, referredEmail: `indicado-a-${RUN}@example.com`,
      code: `REF-BKA-${RUN}`, reservationId: RESERVATION_A.id,
    },
  ]);

  await db.insert(referralCommissionsTable).values([
    {
      id: REFERRAL_COMMISSION_A.id, tenantId: TENANT_A.id, referralId: REFERRAL_A.id, referrerId: ADMIN_A.id,
      recipientId: ADMIN_A.id, amount: "25.00", basis: "conversion",
    },
  ]);

  await db.insert(salesGoalsTable).values([
    { id: SALES_GOAL_A.id, tenantId: TENANT_A.id, userId: SELLER_A.id, year: 2027, goalAmount: "10000.00" },
  ]);

  await db.insert(couponsTable).values([
    { id: AGENCY_COUPON_A.id, tenantId: TENANT_A.id, code: `AGCUPOM${RUN}`, value: "5.00" },
  ]);

  await db.insert(passengersTable).values([
    { id: PASSENGER_A.id, reservationId: RESERVATION_A.id, name: "Passageiro A" },
  ]);

  await db.insert(reservationInstallmentsTable).values([
    {
      id: INSTALLMENT_A.id, reservationId: RESERVATION_A.id, tenantId: TENANT_A.id,
      installmentNumber: 1, dueDate: new Date("2027-02-01"), amount: "250.00",
    },
  ]);

  await db.insert(storesTable).values([
    {
      id: STORE_A.id, tenantId: TENANT_A.id, name: "Loja A", slug: STORE_A.slug, email: `loja-a-${RUN}@example.com`,
      stripeSecretKey: STRIPE_SECRET_SENTINEL, stripeWebhookSecret: STRIPE_WEBHOOK_SENTINEL, mpAccessToken: MP_TOKEN_SENTINEL,
    },
    { id: STORE_B.id, tenantId: TENANT_B.id, name: "Loja B", slug: STORE_B.slug, email: `loja-b-${RUN}@example.com` },
  ]);

  await db.insert(storeCategoriesTable).values([
    { id: STORE_CATEGORY_A.id, storeId: STORE_A.id, name: "Categoria A", slug: `bk-cat-a-${RUN}` },
  ]);

  await db.insert(storeProductsTable).values([
    {
      id: PRODUCT_A.id, storeId: STORE_A.id, type: "trip", name: "Produto A", slug: `bk-product-a-${RUN}`,
      price: "500.00", tripId: TRIP_A.id, status: "published", categoryId: STORE_CATEGORY_A.id,
    },
  ]);

  await db.insert(storeCouponsTable).values([
    {
      id: COUPON_A.id, storeId: STORE_A.id, code: `BKCUPOM${RUN}`, type: "percentage", value: "10.00",
      startsAt: new Date("2027-01-01"), expiresAt: new Date("2027-12-31"),
    },
  ]);

  await db.insert(storePagesTable).values([
    { id: STORE_PAGE_A.id, storeId: STORE_A.id, title: "Sobre Nós A", slug: `bk-page-a-${RUN}` },
  ]);

  await db.insert(storeReviewsTable).values([
    {
      id: STORE_REVIEW_A.id, storeId: STORE_A.id, productId: PRODUCT_A.id, clientId: CLIENT_A.id,
      reviewerName: "Cliente A", reviewerEmail: `cliente-a-${RUN}@example.com`, rating: 5,
    },
  ]);

  await db.insert(storeOrdersTable).values([
    {
      id: ORDER_A.id, storeId: STORE_A.id, tenantId: TENANT_A.id, orderNumber: `ORD-BKA-${RUN}`,
      clientId: CLIENT_A.id, customerName: "Cliente A", customerEmail: `cliente-a-${RUN}@example.com`, customerPhone: "11999990001",
      subtotal: "500.00", totalAmount: "500.00", paymentMethod: "pix", paymentProvider: "mercadopago", paymentStatus: "paid",
    },
  ]);

  await db.insert(storeOrderItemsTable).values([
    {
      id: ORDER_ITEM_A.id, orderId: ORDER_A.id, productId: PRODUCT_A.id, productName: "Produto A", productType: "trip",
      price: "500.00", quantity: 1, subtotal: "500.00", total: "500.00",
      partnerId: PARTNER_A.id, partnerProductId: PARTNER_PRODUCT_A.id, metadata: { checkoutNote: "bk-metadata-marker" },
    },
  ]);

  await db.insert(paymentsTable).values([
    {
      id: PAYMENT_A.id, tenantId: TENANT_A.id, reservationId: RESERVATION_A.id, clientId: CLIENT_A.id,
      type: "receivable", category: "reserva", amount: "500.00", paymentMethod: "pix", dueDate: new Date("2027-03-01"), status: "paid",
    },
  ]);

  await db.insert(suppliersTable).values([
    { id: SUPPLIER_A.id, tenantId: TENANT_A.id, name: "Fornecedor A", type: "combustivel" },
  ]);

  await db.insert(expensesTable).values([
    {
      id: EXPENSE_A.id, tenantId: TENANT_A.id, tripId: TRIP_A.id, category: "combustivel",
      description: "Combustível viagem A", amount: "200.00", supplierId: SUPPLIER_A.id,
      dueDate: new Date("2027-03-01"), createdById: ADMIN_A.id,
    },
  ]);

  await db.insert(accommodationsTable).values([
    { id: ACCOMMODATION_A.id, tenantId: TENANT_A.id, name: "Hotel A", type: "hotel" },
  ]);

  await db.insert(destinationsTable).values([
    { id: DESTINATION_A.id, tenantId: TENANT_A.id, name: "Destino A", city: "Fortaleza", state: "CE" },
  ]);

  await db.insert(clubConfigTable).values([
    { id: CLUB_CONFIG_A.id, tenantId: TENANT_A.id, clubName: "Clube A" },
  ]);

  await db.insert(clubBenefitsTable).values([
    { id: CLUB_BENEFIT_A.id, tenantId: TENANT_A.id, tier: "gold", benefitKey: "priority_support", label: "Suporte prioritário" },
  ]);

  await db.insert(settlementItemsTable).values([
    {
      id: SETTLEMENT_ITEM_A.id, tenantId: TENANT_A.id, orderId: ORDER_A.id, orderItemId: ORDER_ITEM_A.id,
      clientId: CLIENT_A.id, sellerType: "agency", sellerName: "Agência A", source: "store",
      grossAmount: "500.00", sellerNetAmount: "500.00",
    },
  ]);

  await db.insert(financialLedgerEntriesTable).values([
    {
      id: LEDGER_ENTRY_A.id, tenantId: TENANT_A.id, settlementItemId: SETTLEMENT_ITEM_A.id, orderId: ORDER_A.id,
      clientId: CLIENT_A.id, participantType: "agency", category: "sale", direction: "credit",
      amount: "500.00", eventType: "order_paid", idempotencyKey: `bk-ledger-idem-a-${RUN}`,
      occurredAt: new Date("2027-03-01"),
    },
  ]);

  await db.insert(partnersTable).values([
    { id: PARTNER_A.id, tenantId: TENANT_A.id, name: "Parceiro A", email: `parceiro-a-${RUN}@example.com`, slug: `parceiro-a-${RUN}` },
  ]);

  await db.insert(partnerProductsTable).values([
    {
      id: PARTNER_PRODUCT_A.id, partnerId: PARTNER_A.id, tenantId: TENANT_A.id, type: "passeio",
      title: "Passeio Parceiro A", slug: `passeio-parceiro-a-${RUN}`,
    },
  ]);

  await db.insert(partnerAvailabilityTable).values([
    { id: PARTNER_AVAILABILITY_A.id, productId: PARTNER_PRODUCT_A.id, date: "2027-03-01" },
  ]);

  await db.insert(partnerCommissionsTable).values([
    {
      id: PARTNER_COMMISSION_A.id, orderId: ORDER_A.id, partnerId: PARTNER_A.id, tenantId: TENANT_A.id,
      grossAmount: "500.00", partnerAmount: "350.00", agencyAmount: "150.00", period: "2027-03",
    },
  ]);

  await db.insert(documentsTable).values([
    {
      id: DOCUMENT_A.id, tenantId: TENANT_A.id, name: "Contrato A", type: "contract",
      url: "https://files.example.com/bk-doc-a.pdf", entityType: "client", entityId: CLIENT_A.id,
      uploadedById: ADMIN_A.id,
    },
  ]);

  await db.insert(notesTable).values([
    { id: NOTE_A.id, clientId: CLIENT_A.id, content: "Nota sobre o cliente A", createdById: ADMIN_A.id },
  ]);

  await db.insert(messageTemplatesTable).values([
    { id: MESSAGE_TEMPLATE_A.id, tenantId: TENANT_A.id, name: "Template A", channel: "whatsapp", content: "Olá {{nome}}" },
  ]);

  await db.insert(automationsTable).values([
    { id: AUTOMATION_A.id, tenantId: TENANT_A.id, name: "Automação A", triggerType: "reservation_created" },
  ]);

  await db.insert(automationActionsTable).values([
    {
      id: AUTOMATION_ACTION_A.id, automationId: AUTOMATION_A.id, tenantId: TENANT_A.id,
      type: "send_message", order: 1,
    },
  ]);

  await db.insert(tripCostsTable).values([
    {
      id: TRIP_COST_A.id, tenantId: TENANT_A.id, tripId: TRIP_A.id, category: "combustivel",
      description: "Combustível A", amount: "150.00",
    },
  ]);

  await db.insert(tripMediaTable).values([
    { id: TRIP_MEDIA_A.id, tripId: TRIP_A.id, tenantId: TENANT_A.id, url: "https://files.example.com/bk-media-a.jpg" },
  ]);

  await db.insert(clientAchievementsTable).values([
    { id: CLIENT_ACHIEVEMENT_A.id, clientId: CLIENT_A.id, tenantId: TENANT_A.id, badgeKey: "first_trip" },
  ]);

  await db.insert(clientDreamDestinationsTable).values([
    { id: CLIENT_DREAM_DEST_A.id, clientId: CLIENT_A.id, tenantId: TENANT_A.id, destinationName: "Paris" },
  ]);

  await db.insert(clientFavoritesTable).values([
    { id: CLIENT_FAVORITE_A.id, clientId: CLIENT_A.id, tenantId: TENANT_A.id, itemType: "trip", itemId: TRIP_A.id },
  ]);

  await db.insert(campaignsTable).values([
    { id: CAMPAIGN_A.id, tenantId: TENANT_A.id, name: "Campanha WhatsApp A", content: "Oferta especial!", createdById: ADMIN_A.id },
  ]);

  await db.insert(calendarEventsTable).values([
    {
      id: CALENDAR_EVENT_A.id, tenantId: TENANT_A.id, userId: ADMIN_A.id, clientId: CLIENT_A.id,
      tripId: TRIP_A.id, paymentId: PAYMENT_A.id, googleEventId: `gcal-evt-a-${RUN}`,
      eventType: "trip_departure", title: "Partida Viagem A", startDate: new Date("2027-03-10T08:00:00Z"),
    },
  ]);

  await db.insert(productCategoriesTable).values([
    { id: PRODUCT_CATEGORY_A.id, tenantId: TENANT_A.id, name: "Categoria Loja A", slug: `bk-mkt-cat-a-${RUN}` },
  ]);

  await db.insert(productsTable).values([
    {
      id: MARKETING_PRODUCT_A.id, tenantId: TENANT_A.id, name: "Produto Marketing A", slug: `bk-mkt-product-a-${RUN}`,
      type: "physical", price: "99.90",
    },
  ]);

  await db.insert(productImagesTable).values([
    { id: PRODUCT_IMAGE_A.id, productId: MARKETING_PRODUCT_A.id, tenantId: TENANT_A.id, url: "https://files.example.com/bk-mkt-image-a.jpg" },
  ]);

  await db.insert(ordersTable).values([
    {
      id: MARKETING_ORDER_A.id, tenantId: TENANT_A.id, userId: ADMIN_A.id,
      totalAmount: "99.90", finalAmount: "99.90",
    },
  ]);

  await db.insert(orderItemsTable).values([
    { id: MARKETING_ORDER_ITEM_A.id, orderId: MARKETING_ORDER_A.id, productId: MARKETING_PRODUCT_A.id, quantity: 1, price: "99.90" },
  ]);

  await db.insert(npsResponsesTable).values([
    { id: NPS_RESPONSE_A.id, tenantId: TENANT_A.id, userId: ADMIN_A.id, orderId: MARKETING_ORDER_A.id, score: 9, classification: "promoter" },
  ]);

  await db.insert(clientNpsResponsesTable).values([
    { id: CLIENT_NPS_RESPONSE_A.id, tenantId: TENANT_A.id, clientId: CLIENT_A.id, reservationId: RESERVATION_A.id, tripId: TRIP_A.id, score: 10 },
  ]);

  await db.insert(npsInvitationsTable).values([
    {
      id: NPS_INVITATION_A.id, tenantId: TENANT_A.id, clientId: CLIENT_A.id, reservationId: RESERVATION_A.id,
      tripId: TRIP_A.id, token: NPS_INVITE_TOKEN_SENTINEL,
    },
  ]);

  await db.insert(clientScoresTable).values([
    { id: CLIENT_SCORE_A.id, clientId: CLIENT_A.id, tenantId: TENANT_A.id, purchaseScore: 80, recompraScore: 60, churnScore: 5, nboTripId: TRIP_A.id },
  ]);

  await db.insert(priceAlertSubscriptionsTable).values([
    {
      id: PRICE_ALERT_A.id, tenantId: TENANT_A.id, storeId: STORE_A.id, productId: PRODUCT_A.id,
      email: `alerta-a-${RUN}@example.com`, priceAtSubscribe: "500.00",
    },
  ]);

  await db.insert(invitesTable).values([
    { id: INVITE_A.id, tenantId: TENANT_A.id, email: `convite-a-${RUN}@example.com`, invitedBy: ADMIN_A.id, token: INVITE_TOKEN_SENTINEL },
  ]);

  await db.insert(tripCheckinsTable).values([
    { id: TRIP_CHECKIN_A.id, tripId: TRIP_A.id, tenantId: TENANT_A.id, passengerId: PASSENGER_A.id, reservationId: RESERVATION_A.id },
  ]);
});

afterAll(async () => {
  await db.delete(tripCheckinsTable).where(eq(tripCheckinsTable.id, TRIP_CHECKIN_A.id));
  await db.delete(invitesTable).where(eq(invitesTable.id, INVITE_A.id));
  await db.delete(priceAlertSubscriptionsTable).where(eq(priceAlertSubscriptionsTable.id, PRICE_ALERT_A.id));
  await db.delete(clientScoresTable).where(eq(clientScoresTable.id, CLIENT_SCORE_A.id));
  await db.delete(npsInvitationsTable).where(eq(npsInvitationsTable.id, NPS_INVITATION_A.id));
  await db.delete(clientNpsResponsesTable).where(eq(clientNpsResponsesTable.id, CLIENT_NPS_RESPONSE_A.id));
  await db.delete(npsResponsesTable).where(eq(npsResponsesTable.id, NPS_RESPONSE_A.id));
  await db.delete(orderItemsTable).where(eq(orderItemsTable.id, MARKETING_ORDER_ITEM_A.id));
  await db.delete(ordersTable).where(eq(ordersTable.id, MARKETING_ORDER_A.id));
  await db.delete(productImagesTable).where(eq(productImagesTable.id, PRODUCT_IMAGE_A.id));
  await db.delete(productsTable).where(eq(productsTable.id, MARKETING_PRODUCT_A.id));
  await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, PRODUCT_CATEGORY_A.id));
  await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, CALENDAR_EVENT_A.id));
  await db.delete(campaignsTable).where(eq(campaignsTable.id, CAMPAIGN_A.id));
  await db.delete(partnerCommissionsTable).where(eq(partnerCommissionsTable.id, PARTNER_COMMISSION_A.id));
  await db.delete(partnerAvailabilityTable).where(eq(partnerAvailabilityTable.id, PARTNER_AVAILABILITY_A.id));
  await db.delete(partnerProductsTable).where(eq(partnerProductsTable.id, PARTNER_PRODUCT_A.id));
  await db.delete(partnersTable).where(eq(partnersTable.id, PARTNER_A.id));
  await db.delete(financialLedgerEntriesTable).where(eq(financialLedgerEntriesTable.id, LEDGER_ENTRY_A.id));
  await db.delete(settlementItemsTable).where(eq(settlementItemsTable.id, SETTLEMENT_ITEM_A.id));
  await db.delete(clubBenefitsTable).where(eq(clubBenefitsTable.id, CLUB_BENEFIT_A.id));
  await db.delete(clubConfigTable).where(eq(clubConfigTable.id, CLUB_CONFIG_A.id));
  await db.delete(destinationsTable).where(eq(destinationsTable.id, DESTINATION_A.id));
  await db.delete(accommodationsTable).where(eq(accommodationsTable.id, ACCOMMODATION_A.id));
  await db.delete(clientFavoritesTable).where(eq(clientFavoritesTable.id, CLIENT_FAVORITE_A.id));
  await db.delete(clientDreamDestinationsTable).where(eq(clientDreamDestinationsTable.id, CLIENT_DREAM_DEST_A.id));
  await db.delete(clientAchievementsTable).where(eq(clientAchievementsTable.id, CLIENT_ACHIEVEMENT_A.id));
  await db.delete(tripMediaTable).where(eq(tripMediaTable.id, TRIP_MEDIA_A.id));
  await db.delete(tripCostsTable).where(eq(tripCostsTable.id, TRIP_COST_A.id));
  await db.delete(automationActionsTable).where(eq(automationActionsTable.id, AUTOMATION_ACTION_A.id));
  await db.delete(automationsTable).where(eq(automationsTable.id, AUTOMATION_A.id));
  await db.delete(messageTemplatesTable).where(eq(messageTemplatesTable.id, MESSAGE_TEMPLATE_A.id));
  await db.delete(notesTable).where(eq(notesTable.id, NOTE_A.id));
  await db.delete(documentsTable).where(eq(documentsTable.id, DOCUMENT_A.id));
  await db.delete(couponsTable).where(eq(couponsTable.id, AGENCY_COUPON_A.id));
  await db.delete(salesGoalsTable).where(eq(salesGoalsTable.id, SALES_GOAL_A.id));
  await db.delete(referralCommissionsTable).where(eq(referralCommissionsTable.id, REFERRAL_COMMISSION_A.id));
  await db.delete(referralsTable).where(eq(referralsTable.id, REFERRAL_A.id));
  await db.delete(referralCampaignsTable).where(eq(referralCampaignsTable.id, REFERRAL_CAMPAIGN_A.id));
  await db.delete(referralSettingsTable).where(eq(referralSettingsTable.id, REFERRAL_SETTINGS_A.id));
  await db.delete(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.id, LOYALTY_TX_A.id));
  await db.delete(loyaltyMembersTable).where(eq(loyaltyMembersTable.id, LOYALTY_MEMBER_A.id));
  await db.delete(loyaltyProgramsTable).where(eq(loyaltyProgramsTable.id, LOYALTY_PROGRAM_A.id));
  await db.delete(dealsTable).where(eq(dealsTable.id, DEAL_A.id));
  await db.delete(pipelineStagesTable).where(eq(pipelineStagesTable.id, PIPELINE_STAGE_A.id));
  await db.delete(pipelinesTable).where(eq(pipelinesTable.id, PIPELINE_A.id));
  await db.delete(commissionsTable).where(eq(commissionsTable.id, COMMISSION_A.id));
  await db.delete(commissionRulesTable).where(eq(commissionRulesTable.id, COMMISSION_RULE_A.id));
  await db.delete(expensesTable).where(eq(expensesTable.id, EXPENSE_A.id));
  await db.delete(suppliersTable).where(eq(suppliersTable.id, SUPPLIER_A.id));
  await db.delete(paymentsTable).where(eq(paymentsTable.id, PAYMENT_A.id));
  await db.delete(storeOrderItemsTable).where(eq(storeOrderItemsTable.id, ORDER_ITEM_A.id));
  await db.delete(storeOrdersTable).where(eq(storeOrdersTable.id, ORDER_A.id));
  await db.delete(storeReviewsTable).where(eq(storeReviewsTable.id, STORE_REVIEW_A.id));
  await db.delete(storePagesTable).where(eq(storePagesTable.id, STORE_PAGE_A.id));
  await db.delete(storeCouponsTable).where(eq(storeCouponsTable.id, COUPON_A.id));
  await db.delete(storeProductsTable).where(eq(storeProductsTable.id, PRODUCT_A.id));
  await db.delete(storeCategoriesTable).where(eq(storeCategoriesTable.id, STORE_CATEGORY_A.id));
  await db.delete(reservationInstallmentsTable).where(eq(reservationInstallmentsTable.id, INSTALLMENT_A.id));
  await db.delete(passengersTable).where(inArray(passengersTable.reservationId, [RESERVATION_A.id]));
  await db.delete(reservationsTable).where(inArray(reservationsTable.id, [RESERVATION_A.id, RESERVATION_B.id]));
  await db.delete(storesTable).where(inArray(storesTable.id, [STORE_A.id, STORE_B.id]));
  await db.delete(tripsTable).where(inArray(tripsTable.id, [TRIP_A.id, TRIP_B.id]));
  await db.delete(boardingLocationsTable).where(eq(boardingLocationsTable.id, BOARDING_A.id));
  await db.delete(vehicleLayoutsTable).where(eq(vehicleLayoutsTable.id, LAYOUT_A.id));
  await db.delete(vehiclesTable).where(eq(vehiclesTable.id, VEHICLE_A.id));
  await db.delete(clientsTable).where(inArray(clientsTable.id, [CLIENT_A.id, CLIENT_B.id]));
  await db.delete(usersTable).where(inArray(usersTable.id, [ADMIN_A.id, SELLER_A.id, ADMIN_B.id]));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [TENANT_A.id, TENANT_B.id]));
});

describe("GET /api/tenants/backup/export", () => {
  it("returns 403 for a non-admin user (seller)", async () => {
    currentClerkId = SELLER_A.clerkId;
    const res = await request(buildApp()).get("/api/tenants/backup/export");
    expect(res.status).toBe(403);
  });

  it("returns a full backup scoped strictly to the caller's tenant, with every entity group covered and no secrets leaked", async () => {
    currentClerkId = ADMIN_A.clerkId;
    const res = await request(buildApp()).get("/api/tenants/backup/export");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="backup-/);

    const rawText = res.text;

    // ── No secrets anywhere in the raw payload ──────────────────────────
    expect(rawText).not.toContain(CLERK_ID_SENTINEL);
    expect(rawText).not.toContain(GOOGLE_TOKEN_SENTINEL);
    expect(rawText).not.toContain(STRIPE_SECRET_SENTINEL);
    expect(rawText).not.toContain(STRIPE_WEBHOOK_SENTINEL);
    expect(rawText).not.toContain(MP_TOKEN_SENTINEL);
    expect(rawText).not.toContain(INVITE_TOKEN_SENTINEL);
    expect(rawText).not.toContain(NPS_INVITE_TOKEN_SENTINEL);
    expect(rawText).not.toMatch(/"clerkId"/);
    expect(rawText).not.toMatch(/"googleAccessToken"/);
    expect(rawText).not.toMatch(/"googleRefreshToken"/);
    expect(rawText).not.toMatch(/"stripeSecretKey"/);
    expect(rawText).not.toMatch(/"stripeWebhookSecret"/);
    expect(rawText).not.toMatch(/"mpAccessToken"/);
    expect(rawText).not.toMatch(/"token"/);

    const body = JSON.parse(rawText) as {
      meta: { formatVersion: number; tenantId: string; tenantName: string };
      tenant: { id: string };
      users: Array<{ id: string }>;
      clients: Array<{
        id: string;
        notes: Array<{ id: string }>;
        achievements: Array<{ id: string }>;
        dreamDestinationRecords: Array<{ id: string }>;
        favorites: Array<{ id: string }>;
        scores: { id: string; nboTripId: string | null } | null;
      }>;
      trips: Array<{
        id: string;
        layoutId: string | null;
        vehicleId: string | null;
        costs: Array<{ id: string }>;
        media: Array<{ id: string }>;
        checkins: Array<{ id: string; passengerId: string; reservationId: string | null }>;
      }>;
      reservations: Array<{
        id: string;
        boardingLocationId: string | null;
        passengers: Array<{ id: string }>;
        installmentSchedule: Array<{ id: string }>;
      }>;
      vehicles: Array<{ id: string }>;
      vehicleLayouts: Array<{ id: string }>;
      boardingLocations: Array<{ id: string }>;
      store: {
        info: { id: string } | null;
        categories: Array<{ id: string }>;
        products: Array<{ id: string; categoryId: string | null }>;
        coupons: Array<{ id: string }>;
        pages: Array<{ id: string }>;
        reviews: Array<{ id: string; productId: string; clientId: string | null }>;
        orders: Array<{
          id: string;
          items: Array<{ id: string; partnerId: string | null; partnerProductId: string | null; metadata: Record<string, unknown> | null }>;
        }>;
        priceAlerts: Array<{ id: string; productId: string }>;
      };
      commissionRules: Array<{ id: string }>;
      commissions: Array<{ id: string; ruleId: string | null; reservationId: string | null }>;
      pipeline: {
        pipelines: Array<{ id: string }>;
        stages: Array<{ id: string; pipelineId: string }>;
        deals: Array<{ id: string; stageId: string; tripId: string | null }>;
      };
      loyalty: {
        programs: Array<{ id: string }>;
        members: Array<{ id: string; programId: string; clientId: string }>;
        transactions: Array<{ id: string; memberId: string }>;
      };
      referrals: {
        settings: { id: string } | null;
        campaigns: Array<{ id: string }>;
        records: Array<{ id: string; reservationId: string | null }>;
        commissions: Array<{ id: string; referralId: string }>;
      };
      payments: Array<{ id: string }>;
      expenses: Array<{ id: string }>;
      salesGoals: Array<{ id: string }>;
      agencyCoupons: Array<{ id: string }>;
      documents: Array<{ id: string; entityId: string | null }>;
      messageTemplates: Array<{ id: string }>;
      automations: Array<{ id: string; actions: Array<{ id: string }> }>;
      suppliers: Array<{ id: string }>;
      accommodations: Array<{ id: string }>;
      destinations: Array<{ id: string }>;
      club: { config: { id: string } | null; benefits: Array<{ id: string }> };
      settlements: {
        items: Array<{ id: string; orderId: string; orderItemId: string }>;
        ledgerEntries: Array<{ id: string; settlementItemId: string | null }>;
      };
      partners: Array<{
        id: string;
        products: Array<{ id: string; availability: Array<{ id: string }> }>;
        commissions: Array<{ id: string }>;
      }>;
      campaigns: Array<{ id: string; createdById: string }>;
      calendarEvents: Array<{ id: string; userId: string | null; clientId: string | null; tripId: string | null; paymentId: string | null }>;
      marketing: {
        productCategories: Array<{ id: string }>;
        products: Array<{ id: string; images: Array<{ id: string }> }>;
        orders: Array<{ id: string; userId: string; items: Array<{ id: string; productId: string }> }>;
      };
      npsResponses: Array<{ id: string; userId: string; orderId: string | null }>;
      clientNps: {
        responses: Array<{ id: string; clientId: string; reservationId: string; tripId: string | null }>;
        invitations: Array<{ id: string; clientId: string; reservationId: string; tripId: string | null }>;
      };
      invites: Array<{ id: string; email: string; invitedBy: string | null }>;
      counts: Record<string, number>;
    };

    // ── Metadata header ──────────────────────────────────────────────────
    expect(body.meta.formatVersion).toBeGreaterThanOrEqual(1);
    expect(body.meta.tenantId).toBe(TENANT_A.id);
    expect(body.meta.tenantName).toBe("Backup Test Agency A");
    expect(body.tenant.id).toBe(TENANT_A.id);

    // ── Every entity group has at least one sample record ───────────────
    expect(body.users.length).toBeGreaterThan(0);
    expect(body.clients.length).toBeGreaterThan(0);
    expect(body.trips.length).toBeGreaterThan(0);
    expect(body.reservations.length).toBeGreaterThan(0);
    expect(body.vehicles.length).toBeGreaterThan(0);
    expect(body.vehicleLayouts.length).toBeGreaterThan(0);
    expect(body.boardingLocations.length).toBeGreaterThan(0);
    expect(body.store.info).not.toBeNull();
    expect(body.store.categories.length).toBeGreaterThan(0);
    expect(body.store.products.length).toBeGreaterThan(0);
    expect(body.store.coupons.length).toBeGreaterThan(0);
    expect(body.store.pages.length).toBeGreaterThan(0);
    expect(body.store.reviews.length).toBeGreaterThan(0);
    expect(body.store.orders.length).toBeGreaterThan(0);
    expect(body.commissionRules.length).toBeGreaterThan(0);
    expect(body.commissions.length).toBeGreaterThan(0);
    expect(body.pipeline.pipelines.length).toBeGreaterThan(0);
    expect(body.pipeline.stages.length).toBeGreaterThan(0);
    expect(body.pipeline.deals.length).toBeGreaterThan(0);
    expect(body.loyalty.programs.length).toBeGreaterThan(0);
    expect(body.loyalty.members.length).toBeGreaterThan(0);
    expect(body.loyalty.transactions.length).toBeGreaterThan(0);
    expect(body.referrals.settings).not.toBeNull();
    expect(body.referrals.campaigns.length).toBeGreaterThan(0);
    expect(body.referrals.records.length).toBeGreaterThan(0);
    expect(body.referrals.commissions.length).toBeGreaterThan(0);
    expect(body.payments.length).toBeGreaterThan(0);
    expect(body.expenses.length).toBeGreaterThan(0);
    expect(body.salesGoals.length).toBeGreaterThan(0);
    expect(body.agencyCoupons.length).toBeGreaterThan(0);
    expect(body.documents.length).toBeGreaterThan(0);
    expect(body.messageTemplates.length).toBeGreaterThan(0);
    expect(body.automations.length).toBeGreaterThan(0);
    expect(body.suppliers.length).toBeGreaterThan(0);
    expect(body.accommodations.length).toBeGreaterThan(0);
    expect(body.destinations.length).toBeGreaterThan(0);
    expect(body.club.config).not.toBeNull();
    expect(body.club.benefits.length).toBeGreaterThan(0);
    expect(body.settlements.items.length).toBeGreaterThan(0);
    expect(body.settlements.ledgerEntries.length).toBeGreaterThan(0);
    expect(body.partners.length).toBeGreaterThan(0);
    expect(body.store.priceAlerts.length).toBeGreaterThan(0);
    expect(body.campaigns.length).toBeGreaterThan(0);
    expect(body.calendarEvents.length).toBeGreaterThan(0);
    expect(body.marketing.productCategories.length).toBeGreaterThan(0);
    expect(body.marketing.products.length).toBeGreaterThan(0);
    expect(body.marketing.orders.length).toBeGreaterThan(0);
    expect(body.npsResponses.length).toBeGreaterThan(0);
    expect(body.clientNps.responses.length).toBeGreaterThan(0);
    expect(body.clientNps.invitations.length).toBeGreaterThan(0);
    expect(body.invites.length).toBeGreaterThan(0);

    // ── Nested embedding: reservation → passengers, order → items ───────
    const reservationA = body.reservations.find((r) => r.id === RESERVATION_A.id);
    expect(reservationA).toBeDefined();
    expect(reservationA?.passengers.some((p) => p.id === PASSENGER_A.id)).toBe(true);

    const orderA = body.store.orders.find((o) => o.id === ORDER_A.id);
    expect(orderA).toBeDefined();
    expect(orderA?.items.some((i) => i.id === ORDER_ITEM_A.id)).toBe(true);

    expect(reservationA?.installmentSchedule.some((i) => i.id === INSTALLMENT_A.id)).toBe(true);

    // ── Reference integrity: FK-style ids on already-exported records must
    // resolve WITHIN the same backup (no dangling references for a future
    // restore) ───────────────────────────────────────────────────────────
    const tripA = body.trips.find((t) => t.id === TRIP_A.id);
    expect(tripA?.layoutId).toBe(LAYOUT_A.id);
    expect(body.vehicleLayouts.some((l) => l.id === tripA?.layoutId)).toBe(true);
    expect(tripA?.vehicleId).toBe(VEHICLE_A.id);
    expect(body.vehicles.some((v) => v.id === tripA?.vehicleId)).toBe(true);

    // ── Nested embedding: trip → costs/media, client → notes/achievements/
    // dream destinations/favorites, automation → actions ─────────────────
    expect(tripA?.costs.some((c) => c.id === TRIP_COST_A.id)).toBe(true);
    expect(tripA?.media.some((m) => m.id === TRIP_MEDIA_A.id)).toBe(true);

    const clientA = body.clients.find((c) => c.id === CLIENT_A.id);
    expect(clientA).toBeDefined();
    expect(clientA?.notes.some((n) => n.id === NOTE_A.id)).toBe(true);
    expect(clientA?.achievements.some((a) => a.id === CLIENT_ACHIEVEMENT_A.id)).toBe(true);
    expect(clientA?.dreamDestinationRecords.some((d) => d.id === CLIENT_DREAM_DEST_A.id)).toBe(true);
    expect(clientA?.favorites.some((f) => f.id === CLIENT_FAVORITE_A.id)).toBe(true);

    const automationA = body.automations.find((a) => a.id === AUTOMATION_A.id);
    expect(automationA).toBeDefined();
    expect(automationA?.actions.some((a) => a.id === AUTOMATION_ACTION_A.id)).toBe(true);

    const documentA = body.documents.find((d) => d.id === DOCUMENT_A.id);
    expect(documentA).toBeDefined();
    expect(documentA?.entityId).toBe(CLIENT_A.id);

    // ── Nested embedding + reference integrity: settlements, partners, and
    // the expense→supplier reference introduced by this section ──────────
    expect(body.suppliers.some((s) => s.id === SUPPLIER_A.id)).toBe(true);
    const expenseA = body.expenses.find((e) => e.id === EXPENSE_A.id) as { supplierId?: string | null } | undefined;
    expect(expenseA?.supplierId).toBe(SUPPLIER_A.id);
    expect(body.accommodations.some((a) => a.id === ACCOMMODATION_A.id)).toBe(true);
    expect(body.destinations.some((d) => d.id === DESTINATION_A.id)).toBe(true);
    expect(body.club.config?.id).toBe(CLUB_CONFIG_A.id);
    expect(body.club.benefits.some((b) => b.id === CLUB_BENEFIT_A.id)).toBe(true);

    const settlementItemA = body.settlements.items.find((s) => s.id === SETTLEMENT_ITEM_A.id);
    expect(settlementItemA).toBeDefined();
    expect(settlementItemA?.orderId).toBe(ORDER_A.id);
    expect(settlementItemA?.orderItemId).toBe(ORDER_ITEM_A.id);
    const ledgerEntryA = body.settlements.ledgerEntries.find((l) => l.id === LEDGER_ENTRY_A.id);
    expect(ledgerEntryA).toBeDefined();
    expect(ledgerEntryA?.settlementItemId).toBe(SETTLEMENT_ITEM_A.id);

    const partnerA = body.partners.find((p) => p.id === PARTNER_A.id);
    expect(partnerA).toBeDefined();
    const partnerProductA = partnerA?.products.find((p) => p.id === PARTNER_PRODUCT_A.id);
    expect(partnerProductA).toBeDefined();
    expect(partnerProductA?.availability.some((a) => a.id === PARTNER_AVAILABILITY_A.id)).toBe(true);
    expect(partnerA?.commissions.some((c) => c.id === PARTNER_COMMISSION_A.id)).toBe(true);

    // Order item seller attribution (partnerId/partnerProductId/metadata) must
    // survive the export and resolve against the exported partners section.
    const orderItemA = orderA?.items.find((i) => i.id === ORDER_ITEM_A.id);
    expect(orderItemA?.partnerId).toBe(PARTNER_A.id);
    expect(orderItemA?.partnerProductId).toBe(PARTNER_PRODUCT_A.id);
    expect(orderItemA?.metadata).toEqual({ checkoutNote: "bk-metadata-marker" });
    expect(body.partners.some((p) => p.id === orderItemA?.partnerId)).toBe(true);
    expect(partnerA?.products.some((p) => p.id === orderItemA?.partnerProductId)).toBe(true);

    // ── Round-6 additions: nested embedding + reference integrity ────────
    expect(clientA?.scores?.id).toBe(CLIENT_SCORE_A.id);
    expect(clientA?.scores?.nboTripId).toBe(TRIP_A.id);
    expect(body.trips.some((t) => t.id === clientA?.scores?.nboTripId)).toBe(true);

    expect(tripA?.checkins.some((c) => c.id === TRIP_CHECKIN_A.id)).toBe(true);
    const checkinA = tripA?.checkins.find((c) => c.id === TRIP_CHECKIN_A.id);
    expect(checkinA?.passengerId).toBe(PASSENGER_A.id);
    expect(body.reservations.some((r) => r.passengers.some((p) => p.id === checkinA?.passengerId))).toBe(true);

    const priceAlertA = body.store.priceAlerts.find((p) => p.id === PRICE_ALERT_A.id);
    expect(priceAlertA).toBeDefined();
    expect(body.store.products.some((p) => p.id === priceAlertA?.productId)).toBe(true);

    const campaignA = body.campaigns.find((c) => c.id === CAMPAIGN_A.id);
    expect(campaignA).toBeDefined();
    expect(body.users.some((u) => u.id === campaignA?.createdById)).toBe(true);

    const calendarEventA = body.calendarEvents.find((e) => e.id === CALENDAR_EVENT_A.id);
    expect(calendarEventA).toBeDefined();
    expect(body.users.some((u) => u.id === calendarEventA?.userId)).toBe(true);
    expect(body.clients.some((c) => c.id === calendarEventA?.clientId)).toBe(true);
    expect(body.trips.some((t) => t.id === calendarEventA?.tripId)).toBe(true);
    expect(body.payments.some((p) => p.id === calendarEventA?.paymentId)).toBe(true);

    const productCategoryA = body.marketing.productCategories.find((c) => c.id === PRODUCT_CATEGORY_A.id);
    expect(productCategoryA).toBeDefined();
    const marketingProductA = body.marketing.products.find((p) => p.id === MARKETING_PRODUCT_A.id);
    expect(marketingProductA).toBeDefined();
    expect(marketingProductA?.images.some((i) => i.id === PRODUCT_IMAGE_A.id)).toBe(true);
    const marketingOrderA = body.marketing.orders.find((o) => o.id === MARKETING_ORDER_A.id);
    expect(marketingOrderA).toBeDefined();
    expect(body.users.some((u) => u.id === marketingOrderA?.userId)).toBe(true);
    const marketingOrderItemA = marketingOrderA?.items.find((i) => i.id === MARKETING_ORDER_ITEM_A.id);
    expect(marketingOrderItemA).toBeDefined();
    expect(body.marketing.products.some((p) => p.id === marketingOrderItemA?.productId)).toBe(true);

    const npsResponseA = body.npsResponses.find((n) => n.id === NPS_RESPONSE_A.id);
    expect(npsResponseA).toBeDefined();
    expect(body.users.some((u) => u.id === npsResponseA?.userId)).toBe(true);
    expect(body.marketing.orders.some((o) => o.id === npsResponseA?.orderId)).toBe(true);

    const clientNpsResponseA = body.clientNps.responses.find((n) => n.id === CLIENT_NPS_RESPONSE_A.id);
    expect(clientNpsResponseA).toBeDefined();
    expect(body.clients.some((c) => c.id === clientNpsResponseA?.clientId)).toBe(true);
    expect(body.reservations.some((r) => r.id === clientNpsResponseA?.reservationId)).toBe(true);
    const npsInvitationA = body.clientNps.invitations.find((n) => n.id === NPS_INVITATION_A.id);
    expect(npsInvitationA).toBeDefined();
    expect(body.reservations.some((r) => r.id === npsInvitationA?.reservationId)).toBe(true);

    const inviteA = body.invites.find((i) => i.id === INVITE_A.id);
    expect(inviteA).toBeDefined();
    expect(body.users.some((u) => u.id === inviteA?.invitedBy)).toBe(true);

    const productA = body.store.products.find((p) => p.id === PRODUCT_A.id);
    expect(productA?.categoryId).toBe(STORE_CATEGORY_A.id);
    expect(body.store.categories.some((c) => c.id === productA?.categoryId)).toBe(true);

    const reviewA = body.store.reviews.find((r) => r.id === STORE_REVIEW_A.id);
    expect(reviewA).toBeDefined();
    expect(body.store.products.some((p) => p.id === reviewA?.productId)).toBe(true);
    expect(body.clients.some((c) => c.id === reviewA?.clientId)).toBe(true);

    expect(reservationA?.boardingLocationId).toBe(BOARDING_A.id);
    expect(body.boardingLocations.some((b) => b.id === reservationA?.boardingLocationId)).toBe(true);

    const commissionA = body.commissions.find((c) => c.id === COMMISSION_A.id);
    expect(commissionA).toBeDefined();
    expect(body.commissionRules.some((r) => r.id === commissionA?.ruleId)).toBe(true);
    expect(body.reservations.some((r) => r.id === commissionA?.reservationId)).toBe(true);

    const dealA = body.pipeline.deals.find((d) => d.id === DEAL_A.id);
    expect(dealA).toBeDefined();
    expect(body.pipeline.stages.some((s) => s.id === dealA?.stageId)).toBe(true);
    expect(body.trips.some((t) => t.id === dealA?.tripId)).toBe(true);

    const memberA = body.loyalty.members.find((m) => m.id === LOYALTY_MEMBER_A.id);
    expect(memberA).toBeDefined();
    expect(body.loyalty.programs.some((p) => p.id === memberA?.programId)).toBe(true);
    expect(body.clients.some((c) => c.id === memberA?.clientId)).toBe(true);
    expect(body.loyalty.transactions.some((t) => t.memberId === memberA?.id)).toBe(true);

    const referralA = body.referrals.records.find((r) => r.id === REFERRAL_A.id);
    expect(referralA).toBeDefined();
    expect(body.reservations.some((r) => r.id === referralA?.reservationId)).toBe(true);
    expect(body.referrals.commissions.some((c) => c.referralId === referralA?.id)).toBe(true);

    // ── Tenant isolation: tenant B's records must never appear ──────────
    expect(body.users.some((u) => u.id === ADMIN_B.id)).toBe(false);
    expect(body.clients.some((c) => c.id === CLIENT_B.id)).toBe(false);
    expect(body.trips.some((t) => t.id === TRIP_B.id)).toBe(false);
    expect(body.reservations.some((r) => r.id === RESERVATION_B.id)).toBe(false);
    expect(body.store.info?.id).toBe(STORE_A.id);
  });

  it("scopes the backup to tenant B when called by tenant B's admin (no tenant A data leaks the other way)", async () => {
    currentClerkId = ADMIN_B.clerkId;
    const res = await request(buildApp()).get("/api/tenants/backup/export");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as {
      meta: { tenantId: string };
      clients: Array<{ id: string }>;
      trips: Array<{ id: string }>;
    };
    expect(body.meta.tenantId).toBe(TENANT_B.id);
    expect(body.clients.some((c) => c.id === CLIENT_A.id)).toBe(false);
    expect(body.trips.some((t) => t.id === TRIP_A.id)).toBe(false);
  });
});

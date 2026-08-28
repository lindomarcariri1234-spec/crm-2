/**
 * backup-import.test.ts
 *
 * Integration coverage for POST /api/backup/import (Task #9 — restore an
 * agency backup from the JSON produced by GET /api/backup/export).
 *
 * Strategy: real DB rows via @workspace/db (same pattern as
 * reservation-patch-deal-sync.test.ts / checkout-race-condition-db-integration.test.ts)
 * so FK remapping, unique-field regeneration and the dedup ledger are all
 * exercised against real Postgres constraints instead of a hand-rolled
 * drizzle mock. Only `requireAuth` is mocked, to control the authenticated
 * user/role per test.
 */

import { randomUUID } from "crypto";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  usersTable,
  storesTable,
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
  storeProductsTable,
  storeCouponsTable,
  storeOrdersTable,
  storeOrderItemsTable,
  paymentsTable,
  expensesTable,
  backupImportBatchesTable,
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
} from "@workspace/db";
import { ROLES } from "@workspace/permissions";

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  ROLES,
}));

import { requireAuth } from "../lib/tenant.js";
import backupRouter from "../routes/backup.js";
import { errorHandler } from "../middlewares/errorHandler.js";

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api", backupRouter);
  app.use(errorHandler);
  return app;
}

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const TENANT_ID = `bitest-${RUN}`;
const OTHER_TENANT_ID = `bitest-other-${RUN}`;
const IMPORTER_ID = `biu-importer-${RUN}`;
const MATCHED_USER_ID = `biu-matched-${RUN}`;
const MATCHED_EMAIL = `seller-${RUN}@dest.example.com`;
const STORE_ID = `bist-${RUN}`;

function futureDate(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
function pastDate(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function buildValidBackup(tenantId: string) {
  return {
    format: "visitecrm-agency-backup",
    version: 4,
    exportedAt: new Date().toISOString(),
    exportedByUserId: IMPORTER_ID,
    tenant: { id: tenantId, name: "Old Name", slug: "old-slug" },
    data: {
      agencia: {
        id: tenantId,
        name: "Agência Restaurada",
        email: `restaurada-${RUN}@example.com`,
        whatsapp: "11988887777",
        primaryColor: "#112233",
        slug: "should-be-ignored",
        planId: "should-be-ignored",
      },
      usuarios: {
        users: [
          { id: "src-user-matched", email: MATCHED_EMAIL.toUpperCase(), name: "Seller Matched" },
          { id: "src-user-unmatched", email: `ghost-${RUN}@nowhere.example.com`, name: "Ghost User" },
        ],
        invites: [
          {
            id: "src-invite-accepted",
            email: `accepted-${RUN}@example.com`,
            role: "vendedor",
            invitedBy: "src-user-matched",
            token: "old-accepted-token",
            accepted: true,
            acceptedAt: pastDate(1),
          },
          {
            id: "src-invite-expired",
            email: `expired-${RUN}@example.com`,
            role: "vendedor",
            invitedBy: "src-user-matched",
            token: "old-expired-token",
            accepted: false,
            expiresAt: pastDate(1),
          },
          {
            id: "src-invite-pending",
            email: `pending-${RUN}@example.com`,
            role: "vendedor",
            invitedBy: "src-user-matched",
            token: "old-pending-token",
            accepted: false,
            expiresAt: futureDate(7),
          },
        ],
      },
      configuracoes: [],
      clientes: {
        clients: [
          {
            id: "src-client-1",
            tenantId: "some-other-tenant-id",
            name: "Cliente Um",
            email: `cliente1-${RUN}@example.com`,
            whatsapp: "11999990001",
            createdById: "src-user-matched",
            customerCode: "OLD-CODE-1",
            referralCode: "OLDREF1",
            referredById: null,
          },
          {
            id: "src-client-2",
            name: "Cliente Dois",
            email: `cliente2-${RUN}@example.com`,
            whatsapp: "11999990002",
            createdById: "src-user-unmatched",
            customerCode: null,
            referralCode: null,
            referredById: "src-client-1",
          },
        ],
        notes: [],
        achievements: [{ id: "src-ach-1", clientId: "src-client-1", badgeKey: "primeira-viagem" }],
        dreamDestinations: [{ id: "src-dream-1", clientId: "src-client-1", destinationName: "Paris" }],
        notifications: [{ id: "src-notif-1", clientId: "src-client-1", type: "reservation_cancelled", payload: { title: "Reserva cancelada" } }],
      },
      cadastrosAuxiliares: {
        suppliers: [{ id: "src-supplier-1", name: "Fornecedor Um", type: "transporte" }],
        vehicles: [{ id: "src-vehicle-1", name: "Ônibus 1", type: "onibus", plate: "ABC1234", capacity: 46 }],
        vehicleLayouts: [{ id: "src-layout-1", name: "Layout 46 lugares" }],
        accommodations: [{ id: "src-accom-1", name: "Hotel Praia", type: "hotel" }],
        destinations: [{ id: "src-dest-1", name: "Fortaleza", city: "Fortaleza", state: "CE" }],
      },
      viagens: {
        trips: [
          {
            id: "src-trip-1",
            name: "Viagem Um",
            slug: `viagem-um-${RUN}`,
            destination: "Fortaleza",
            destinationCity: "Fortaleza",
            destinationState: "CE",
            type: "excursao",
            category: "nacional",
            departureDate: futureDate(30),
            totalCapacity: 40,
            availableSeats: 38,
            priceAdult: "250.00",
            createdById: "src-user-matched",
            importFingerprint: "old-fingerprint",
            layoutId: "src-layout-1",
            vehicleId: "src-vehicle-1",
          },
        ],
        media: [
          { id: "src-media-1", tripId: "src-trip-1", url: "https://example.com/img.jpg", type: "image", uploadedByUserId: "src-user-matched" },
        ],
      },
      embarqueCheckin: {
        boardingLocations: [
          { id: "src-board-1", name: "Ponto Central", address: "Rua X, 100", city: "Fortaleza", state: "CE" },
        ],
        checkins: [
          {
            id: "src-checkin-1",
            tripId: "src-trip-1",
            passengerId: "src-passenger-1",
            reservationId: "src-res-1",
            checkedInByUserRef: "src-user-matched",
            status: "present",
          },
        ],
      },
      automacoes: {
        automations: [{ id: "src-auto-1", name: "Boas-vindas", triggerType: "client_created" }],
        actions: [{ id: "src-action-1", automationId: "src-auto-1", type: "send_email" }],
        logs: [{ id: "src-log-1", automationId: "src-auto-1", status: "success" }],
      },
      indicacoes: {
        referrals: [
          {
            id: "src-referral-1",
            referrerId: "src-client-1",
            referredId: "src-client-2",
            reservationId: "src-res-1",
            code: "OLDCODE",
          },
        ],
      },
      loja: {
        products: [
          {
            id: "src-prod-1",
            type: "trip",
            name: "Pacote Fortaleza",
            slug: `pacote-fortaleza-${RUN}`,
            price: "250.00",
            tripId: "src-trip-1",
            categoryId: "old-cat-id",
            partnerProductId: "old-partner-prod",
          },
        ],
        coupons: [
          {
            id: "src-coupon-1",
            code: `DESCONTO10-${RUN}`,
            type: "percentage",
            value: "10.00",
            startsAt: pastDate(10),
            expiresAt: futureDate(60),
          },
        ],
        orders: [
          {
            id: "src-order-1",
            orderNumber: `OLD-0001-${RUN}`,
            clientId: "src-client-1",
            couponId: "src-coupon-1",
            customerName: "Cliente Um",
            customerEmail: `cliente1-${RUN}@example.com`,
            customerPhone: "11999990001",
            subtotal: "250.00",
            totalAmount: "250.00",
            paymentMethod: "pix",
            paymentProvider: "mercadopago",
            idempotencyKey: "old-key",
            paymentToken: "old-token",
          },
        ],
        orderItems: [
          {
            id: "src-item-1",
            orderId: "src-order-1",
            productId: "src-prod-1",
            productName: "Pacote Fortaleza",
            productType: "trip",
            price: "250.00",
            subtotal: "250.00",
            total: "250.00",
            partnerId: "old-partner",
            partnerProductId: "old-partner-prod",
          },
        ],
      },
      reservas: {
        reservations: [
          {
            id: "src-res-1",
            tripId: "src-trip-1",
            clientId: "src-client-1",
            sellerId: "src-user-matched",
            createdById: "src-user-matched",
            storeOrderId: "src-order-1",
            totalValue: "250.00",
            balance: "0.00",
            voucherCode: `OLDVOUCHER1-${RUN}`,
            tripType: "excursao",
            createdAt: pastDate(5),
          },
        ],
        passengers: [
          { id: "src-passenger-1", reservationId: "src-res-1", name: "Passageiro Um", isPrimary: true },
        ],
      },
      pipeline: {
        pipelines: [{ id: "src-pipeline-1", name: "Pipeline Padrão", isDefault: true }],
        stages: [{ id: "src-stage-1", pipelineId: "src-pipeline-1", name: "Novo", color: "#0000ff", order: 1 }],
        deals: [
          {
            id: "src-deal-1",
            stageId: "src-stage-1",
            title: "Negociação Um",
            value: "250.00",
            clientId: "src-client-1",
            tripId: "src-trip-1",
            reservationId: "src-res-1",
            ownerId: "src-user-matched",
          },
        ],
      },
      fidelidade: {
        programs: [{ id: "src-loyalty-prog-1", name: "Programa Fidelidade" }],
        members: [{ id: "src-loyalty-member-1", programId: "src-loyalty-prog-1", clientId: "src-client-1", totalPoints: 100, availablePoints: 100 }],
        transactions: [
          {
            id: "src-loyalty-tx-1",
            memberId: "src-loyalty-member-1",
            type: "earn",
            points: 100,
            description: "Compra",
            referenceId: "src-res-1",
            referenceType: "reservation",
          },
        ],
      },
      financeiro: {
        payments: [
          {
            id: "src-payment-1",
            reservationId: "src-res-1",
            clientId: "src-client-1",
            orderId: "src-order-1",
            type: "income",
            category: "reserva",
            amount: "250.00",
            paymentMethod: "pix",
            dueDate: pastDate(5),
          },
        ],
        expenses: [
          {
            id: "src-expense-1",
            tripId: "src-trip-1",
            category: "transporte",
            description: "Combustível",
            amount: "100.00",
            dueDate: pastDate(5),
            createdById: "src-user-unmatched",
            supplierId: "src-supplier-1",
          },
          {
            id: "src-expense-2",
            tripId: "src-trip-1",
            category: "outros",
            description: "Fornecedor ausente",
            amount: "50.00",
            dueDate: pastDate(4),
            createdById: "src-user-matched",
            supplierId: "src-supplier-missing",
          },
        ],
        settlementItems: [
          {
            id: "src-settlement-1",
            orderId: "src-order-1",
            orderItemId: "src-item-1",
            clientId: "src-client-1",
            sellerType: "user",
            sellerId: "src-user-matched",
            sellerName: "Seller Matched",
            source: "crm",
            grossAmount: "250.00",
            sellerNetAmount: "225.00",
          },
        ],
        ledgerEntries: [
          {
            id: "src-ledger-1",
            settlementItemId: "src-settlement-1",
            orderId: "src-order-1",
            clientId: "src-client-1",
            participantType: "user",
            participantId: "src-user-matched",
            category: "commission",
            direction: "credit",
            amount: "25.00",
            eventType: "order_paid",
            idempotencyKey: "old-ledger-key-1",
            occurredAt: pastDate(5),
          },
          {
            id: "src-ledger-2",
            reversalOfEntryId: "src-ledger-1",
            participantType: "user",
            participantId: "src-user-matched",
            category: "commission",
            direction: "debit",
            amount: "-25.00",
            eventType: "order_refunded",
            idempotencyKey: "old-ledger-key-2",
            occurredAt: pastDate(4),
          },
        ],
      },
      calendario: [
        {
          id: "src-cal-1",
          userId: "src-user-matched",
          clientId: "src-client-1",
          tripId: "src-trip-1",
          paymentId: "src-payment-1",
          googleEventId: "old-google-event-1",
          eventType: "reserva",
          title: "Evento de Viagem",
          startDate: futureDate(2),
        },
      ],
      documentos: [
        {
          id: "src-doc-1",
          name: "Contrato.pdf",
          type: "contract",
          url: "https://example.com/contrato.pdf",
          entityType: "client",
          entityId: "src-client-1",
          uploadedById: "src-user-matched",
        },
        {
          id: "src-doc-2",
          name: "Voucher.pdf",
          type: "voucher",
          url: "https://example.com/voucher.pdf",
          entityType: "reservation",
          entityId: "src-res-1",
          uploadedById: "src-user-matched",
        },
      ],
      marketing: {
        campaigns: [{ id: "src-campaign-1", name: "Campanha Um", content: "Olá!", createdById: "src-user-matched" }],
        campaignSends: [{ id: "src-send-1", campaignId: "src-campaign-1", clientId: "src-client-1", status: "sent" }],
        npsResponses: [{ id: "src-nps-1", userId: "src-client-1", orderId: "src-order-1", score: 9, classification: "promoter" }],
      },
      distribuicao: {
        offers: [
          {
            id: "src-offer-1",
            integrationType: "acme-provider",
            externalId: `ext-offer-${RUN}`,
            kind: "flight",
            title: "Oferta Um",
            price: "500.00",
          },
        ],
        operations: [
          {
            id: "src-op-1",
            offerId: "src-offer-1",
            integrationType: "acme-provider",
            operation: "book",
            idempotencyKey: "old-op-key-1",
            requestHash: "old-hash-1",
            status: "completed",
          },
        ],
        bookings: [
          {
            id: "src-booking-1",
            offerId: "src-offer-1",
            integrationType: "acme-provider",
            externalOrderId: `ext-order-${RUN}`,
            quantity: 1,
          },
        ],
      },
    },
  };
}

beforeAll(async () => {
  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "BI Test Agency",
    slug: `bi-agency-${RUN}`,
    email: `bi-${RUN}@agency.com`,
    planId: "starter",
    status: "trial",
    reservationPrefix: "AG",
  });
  await db.insert(tenantsTable).values({
    id: OTHER_TENANT_ID,
    name: "BI Other Agency",
    slug: `bi-other-agency-${RUN}`,
    email: `bi-other-${RUN}@agency.com`,
    planId: "starter",
    status: "trial",
  });
  await db.insert(usersTable).values([
    {
      id: IMPORTER_ID,
      clerkId: `bi-clerk-importer-${RUN}`,
      tenantId: TENANT_ID,
      name: "Importer Admin",
      email: `importer-${RUN}@dest.example.com`,
      referralCode: `BI-IMP-${RUN}`,
      role: ROLES.AGENCY_ADMIN,
    },
    {
      id: MATCHED_USER_ID,
      clerkId: `bi-clerk-matched-${RUN}`,
      tenantId: TENANT_ID,
      name: "Seller Matched",
      email: MATCHED_EMAIL,
      referralCode: `BI-SELLER-${RUN}`,
      role: ROLES.SALES,
    },
  ]);
  await db.insert(storesTable).values({
    id: STORE_ID,
    tenantId: TENANT_ID,
    name: "BI Test Store",
    slug: `bi-store-${RUN}`,
    email: `bi-store-${RUN}@example.com`,
  });
});

afterAll(async () => {
  // New groups first: deals has RESTRICT FKs into clients/trips/users/stages
  // that would otherwise block the deletes below.
  await db.delete(distributionBookingsTable).where(eq(distributionBookingsTable.tenantId, TENANT_ID));
  await db.delete(distributionOperationsTable).where(eq(distributionOperationsTable.tenantId, TENANT_ID));
  await db.delete(distributionOffersTable).where(eq(distributionOffersTable.tenantId, TENANT_ID));
  await db.delete(npsResponsesTable).where(eq(npsResponsesTable.tenantId, TENANT_ID));
  await db.delete(campaignSendsTable).where(eq(campaignSendsTable.tenantId, TENANT_ID));
  await db.delete(campaignsTable).where(eq(campaignsTable.tenantId, TENANT_ID));
  await db.delete(documentsTable).where(eq(documentsTable.tenantId, TENANT_ID));
  await db.delete(calendarEventsTable).where(eq(calendarEventsTable.tenantId, TENANT_ID));
  await db.delete(financialLedgerEntriesTable).where(eq(financialLedgerEntriesTable.tenantId, TENANT_ID));
  await db.delete(settlementItemsTable).where(eq(settlementItemsTable.tenantId, TENANT_ID));
  await db.delete(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.tenantId, TENANT_ID));
  await db.delete(loyaltyMembersTable).where(eq(loyaltyMembersTable.tenantId, TENANT_ID));
  await db.delete(loyaltyProgramsTable).where(eq(loyaltyProgramsTable.tenantId, TENANT_ID));
  await db.delete(dealsTable).where(eq(dealsTable.tenantId, TENANT_ID));
  await db.delete(pipelineStagesTable).where(eq(pipelineStagesTable.tenantId, TENANT_ID));
  await db.delete(pipelinesTable).where(eq(pipelinesTable.tenantId, TENANT_ID));
  await db.delete(clientNotificationsTable).where(eq(clientNotificationsTable.tenantId, TENANT_ID));
  await db.delete(clientDreamDestinationsTable).where(eq(clientDreamDestinationsTable.tenantId, TENANT_ID));
  await db.delete(clientAchievementsTable).where(eq(clientAchievementsTable.tenantId, TENANT_ID));
  await db.delete(suppliersTable).where(eq(suppliersTable.tenantId, TENANT_ID));
  await db.delete(vehiclesTable).where(eq(vehiclesTable.tenantId, TENANT_ID));
  await db.delete(vehicleLayoutsTable).where(eq(vehicleLayoutsTable.tenantId, TENANT_ID));
  await db.delete(accommodationsTable).where(eq(accommodationsTable.tenantId, TENANT_ID));
  await db.delete(destinationsTable).where(eq(destinationsTable.tenantId, TENANT_ID));
  await db.delete(invitesTable).where(eq(invitesTable.tenantId, TENANT_ID));
  // tripMediaTable cascades on trip deletion below; no explicit delete needed.

  // Delete in FK-dependency order first (store_orders.client_id etc. have no
  // ON DELETE CASCADE), then let the tenant delete cascade the rest.
  await db.delete(paymentsTable).where(eq(paymentsTable.tenantId, TENANT_ID));
  await db.delete(expensesTable).where(eq(expensesTable.tenantId, TENANT_ID));
  await db.delete(referralsTable).where(eq(referralsTable.tenantId, TENANT_ID));
  await db.delete(tripCheckinsTable).where(eq(tripCheckinsTable.tenantId, TENANT_ID));
  const tripRows = await db.select({ id: tripsTable.id }).from(tripsTable).where(eq(tripsTable.tenantId, TENANT_ID));
  for (const t of tripRows) {
    const reservationRows = await db.select({ id: reservationsTable.id }).from(reservationsTable).where(eq(reservationsTable.tripId, t.id));
    for (const r of reservationRows) {
      await db.delete(passengersTable).where(eq(passengersTable.reservationId, r.id));
    }
    await db.delete(reservationsTable).where(eq(reservationsTable.tripId, t.id));
  }
  const orderRows = await db.select({ id: storeOrdersTable.id }).from(storeOrdersTable).where(eq(storeOrdersTable.tenantId, TENANT_ID));
  for (const o of orderRows) {
    await db.delete(storeOrderItemsTable).where(eq(storeOrderItemsTable.orderId, o.id));
  }
  await db.delete(storeOrdersTable).where(eq(storeOrdersTable.tenantId, TENANT_ID));
  await db.delete(storeProductsTable).where(eq(storeProductsTable.storeId, STORE_ID));
  await db.delete(storeCouponsTable).where(eq(storeCouponsTable.storeId, STORE_ID));
  await db.delete(automationLogsTable).where(eq(automationLogsTable.tenantId, TENANT_ID));
  await db.delete(automationActionsTable).where(eq(automationActionsTable.tenantId, TENANT_ID));
  await db.delete(automationsTable).where(eq(automationsTable.tenantId, TENANT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(tripsTable).where(eq(tripsTable.tenantId, TENANT_ID));
  await db.delete(boardingLocationsTable).where(eq(boardingLocationsTable.tenantId, TENANT_ID));
  await db.delete(backupImportRecordsTable).where(eq(backupImportRecordsTable.tenantId, TENANT_ID));
  await db.delete(backupImportBatchesTable).where(eq(backupImportBatchesTable.tenantId, TENANT_ID));

  // Tenant cascade removes users/store.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, OTHER_TENANT_ID));
});

function mockAuthedAs(role: string, userId = IMPORTER_ID, tenantId = TENANT_ID) {
  vi.mocked(requireAuth).mockResolvedValue({
    id: userId,
    tenantId,
    role,
    clerkId: `bi-clerk-${userId}`,
    name: "Test User",
    email: `${userId}@dest.example.com`,
  } as never);
}

describe("POST /api/backup/import", () => {
  it("rejects non-admin users", async () => {
    mockAuthedAs(ROLES.SALES);
    const res = await request(buildApp())
      .post("/api/backup/import")
      .send({ idempotencyKey: `k-${randomUUID()}`, backup: buildValidBackup(TENANT_ID) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects a backup from another tenant", async () => {
    mockAuthedAs(ROLES.AGENCY_ADMIN);
    const res = await request(buildApp())
      .post("/api/backup/import")
      .send({ idempotencyKey: `k-${randomUUID()}`, backup: buildValidBackup(OTHER_TENANT_ID) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BACKUP_IMPORT_TENANT_MISMATCH");
  });

  it("accepts the same logical agency when its internal tenant id changed", async () => {
    mockAuthedAs(ROLES.AGENCY_ADMIN, IMPORTER_ID, OTHER_TENANT_ID);
    const backup = {
      format: "visitecrm-agency-backup",
      version: 4,
      tenant: {
        id: "source-installation-tenant-id",
        name: "BI Other Agency",
        slug: "source-installation-slug",
        email: `bi-other-${RUN}@agency.com`,
      },
      data: {
        agencia: {},
        usuarios: { users: [], invites: [] },
        clientes: { clients: [] },
        viagens: { trips: [] },
        reservas: { reservations: [], passengers: [] },
        embarqueCheckin: { boardingLocations: [], checkins: [] },
        automacoes: { automations: [], actions: [], logs: [] },
        indicacoes: { referrals: [] },
        loja: { products: [], coupons: [], orders: [], orderItems: [] },
        financeiro: { payments: [], expenses: [] },
      },
    };

    const res = await request(buildApp())
      .post("/api/backup/import")
      .send({ idempotencyKey: `k-cross-install-${randomUUID()}`, backup });

    expect(res.status).toBe(200);
    expect(res.body.report.agencia.updated).toBe(false);
  });

  it("normalizes and restores a supported legacy flat backup through the endpoint", async () => {
    mockAuthedAs(ROLES.AGENCY_ADMIN, IMPORTER_ID, OTHER_TENANT_ID);
    const legacyBackup = {
      meta: {
        formatVersion: 6,
        exportedAt: new Date().toISOString(),
        tenantId: "legacy-source-id",
        tenantName: "BI Other Agency",
        tenantSlug: "legacy-source-slug",
      },
      tenant: {
        id: "legacy-source-id",
        name: "BI Other Agency",
        slug: "legacy-source-slug",
        email: `bi-other-${RUN}@agency.com`,
      },
      users: [],
      clients: [],
      trips: [],
      reservations: [],
      boardingLocations: [],
      automations: [],
      store: { info: null, products: [], coupons: [], orders: [] },
      payments: [],
      expenses: [],
    };

    const res = await request(buildApp())
      .post("/api/backup/import")
      .send({ idempotencyKey: `k-legacy-${randomUUID()}`, backup: legacyBackup });

    expect(res.status).toBe(200);
    expect(res.body.report).toMatchObject({
      agencia: { updated: true },
      clientes: { created: 0, errors: [] },
      viagens: { created: 0, errors: [] },
    });
  });

  it("rejects an unknown backup format", async () => {
    mockAuthedAs(ROLES.AGENCY_ADMIN);
    const backup = { ...buildValidBackup(TENANT_ID), format: "some-other-app-backup" };
    const res = await request(buildApp())
      .post("/api/backup/import")
      .send({ idempotencyKey: `k-${randomUUID()}`, backup });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BACKUP_IMPORT_UNKNOWN_FORMAT");
  });

  it("rejects a mismatched format version", async () => {
    mockAuthedAs(ROLES.AGENCY_ADMIN);
    const backup = { ...buildValidBackup(TENANT_ID), version: 999 };
    const res = await request(buildApp())
      .post("/api/backup/import")
      .send({ idempotencyKey: `k-${randomUUID()}`, backup });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BACKUP_IMPORT_VERSION_MISMATCH");
  });

  it("rejects a file missing a required section", async () => {
    mockAuthedAs(ROLES.AGENCY_ADMIN);
    const backup = buildValidBackup(TENANT_ID);
    const data = backup.data as Record<string, unknown>;
    delete data.financeiro;
    const res = await request(buildApp())
      .post("/api/backup/import")
      .send({ idempotencyKey: `k-${randomUUID()}`, backup });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BACKUP_IMPORT_MISSING_SECTIONS");
    expect(res.body.error).toContain("financeiro");
  });

  it("imports every in-scope group, remaps references, regenerates unique fields, and is idempotent on re-import", async () => {
    mockAuthedAs(ROLES.AGENCY_ADMIN);
    const backup = buildValidBackup(TENANT_ID);
    const idempotencyKey = `k-${randomUUID()}`;

    const first = await request(buildApp())
      .post("/api/backup/import")
      .send({ idempotencyKey, backup });

    expect(first.status).toBe(200);
    const report = first.body.report;

    expect(report.agencia.updated).toBe(true);
    expect(report.usuarios.matched).toBe(1);
    expect(report.usuarios.fallbackToImporter).toBe(1);
    expect(report.usuarios.fallbackDetails).toEqual([
      expect.objectContaining({ sourceId: "src-user-unmatched" }),
    ]);

    for (const group of [
      "clientes", "viagens", "reservas", "passageiros", "embarqueLocais", "checkins",
      "automacoes", "automacaoAcoes", "automacaoLogs", "indicacoes",
      "lojaProdutos", "lojaCupons", "lojaPedidos", "lojaItensPedido",
      "pagamentos", "despesas",
      "convites", "clientesConquistas", "clientesDestinosSonho", "clientesNotificacoes",
      "fornecedores", "veiculos", "layoutsVeiculo", "hospedagens", "destinos", "viagensMidia",
      "pipelines", "etapasPipeline", "negociacoes",
      "fidelidadeProgramas", "fidelidadeMembros", "fidelidadeTransacoes",
      "financeiroAcertos", "financeiroLancamentos", "calendario", "documentos",
      "marketingCampanhas", "marketingEnvios", "marketingNps",
      "distribuicaoOfertas", "distribuicaoOperacoes", "distribuicaoReservas",
    ]) {
      expect(report[group].errors, `${group} errors`).toEqual([]);
    }
    expect(report.clientes.created).toBe(2);
    expect(report.viagens.created).toBe(1);
    expect(report.reservas.created).toBe(1);
    expect(report.passageiros.created).toBe(1);
    expect(report.embarqueLocais.created).toBe(1);
    expect(report.checkins.created).toBe(1);
    expect(report.automacoes.created).toBe(1);
    expect(report.automacaoAcoes.created).toBe(1);
    expect(report.automacaoLogs.created).toBe(1);
    expect(report.indicacoes.created).toBe(1);
    expect(report.lojaProdutos.created).toBe(1);
    expect(report.lojaCupons.created).toBe(1);
    expect(report.lojaPedidos.created).toBe(1);
    expect(report.lojaItensPedido.created).toBe(1);
    expect(report.pagamentos.created).toBe(1);
    expect(report.despesas.created).toBe(2);
    expect(report.convites.created).toBe(1);
    expect(report.convites.skipped).toBe(2);
    expect(report.clientesConquistas.created).toBe(1);
    expect(report.clientesDestinosSonho.created).toBe(1);
    expect(report.clientesNotificacoes.created).toBe(1);
    expect(report.fornecedores.created).toBe(1);
    expect(report.veiculos.created).toBe(1);
    expect(report.layoutsVeiculo.created).toBe(1);
    expect(report.hospedagens.created).toBe(1);
    expect(report.destinos.created).toBe(1);
    expect(report.viagensMidia.created).toBe(1);
    expect(report.pipelines.created).toBe(1);
    expect(report.etapasPipeline.created).toBe(1);
    expect(report.negociacoes.created).toBe(1);
    expect(report.fidelidadeProgramas.created).toBe(1);
    expect(report.fidelidadeMembros.created).toBe(1);
    expect(report.fidelidadeTransacoes.created).toBe(1);
    expect(report.financeiroAcertos.created).toBe(1);
    expect(report.financeiroLancamentos.created).toBe(2);
    expect(report.calendario.created).toBe(1);
    expect(report.documentos.created).toBe(2);
    expect(report.marketingCampanhas.created).toBe(1);
    expect(report.marketingEnvios.created).toBe(1);
    expect(report.marketingNps.created).toBe(1);
    expect(report.distribuicaoOfertas.created).toBe(1);
    expect(report.distribuicaoOperacoes.created).toBe(1);
    expect(report.distribuicaoReservas.created).toBe(1);
    expect(report.naoRestaurado).toEqual(expect.arrayContaining(["configuracoes", "auditoria"]));

    // -- Agência updated in place, billing/identity fields untouched --
    const [tenantRow] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, TENANT_ID)).limit(1);
    expect(tenantRow!.name).toBe("Agência Restaurada");
    expect(tenantRow!.primaryColor).toBe("#112233");
    expect(tenantRow!.slug).toBe(`bi-agency-${RUN}`); // never overwritten
    expect(tenantRow!.planId).toBe("starter"); // never overwritten

    // -- Clientes: FK remap + regenerated unique codes --
    const [client1] = await db.select().from(clientsTable).where(eq(clientsTable.email, `cliente1-${RUN}@example.com`)).limit(1);
    const [client2] = await db.select().from(clientsTable).where(eq(clientsTable.email, `cliente2-${RUN}@example.com`)).limit(1);
    expect(client1!.tenantId).toBe(TENANT_ID);
    expect(client1!.createdById).toBe(MATCHED_USER_ID);
    expect(client1!.customerCode).not.toBe("OLD-CODE-1");
    expect(client1!.customerCode).toBeTruthy();
    expect(client1!.referralCode).not.toBe("OLDREF1");
    expect(client1!.referralCode).toBeTruthy();
    expect(client2!.createdById).toBe(IMPORTER_ID); // unmatched user -> importer (attribution)
    expect(client2!.referredById).toBe(client1!.id); // two-pass self-referential remap

    // -- Viagens: FK-scrubbed fields + attribution remap --
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.slug, `viagem-um-${RUN}`)).limit(1);
    expect(trip!.tenantId).toBe(TENANT_ID);
    expect(trip!.createdById).toBe(MATCHED_USER_ID);
    expect(trip!.importFingerprint).toBeNull();

    // -- Loja --
    const [product] = await db.select().from(storeProductsTable).where(eq(storeProductsTable.slug, `pacote-fortaleza-${RUN}`)).limit(1);
    expect(product!.storeId).toBe(STORE_ID);
    expect(product!.tripId).toBe(trip!.id);
    expect(product!.categoryId).toBeNull();
    expect(product!.partnerProductId).toBeNull();

    const [coupon] = await db.select().from(storeCouponsTable).where(eq(storeCouponsTable.code, `DESCONTO10-${RUN}`)).limit(1);
    expect(coupon!.storeId).toBe(STORE_ID);

    const [order] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.orderNumber, `OLD-0001-${RUN}`)).limit(1);
    expect(order!.clientId).toBe(client1!.id);
    expect(order!.couponId).toBe(coupon!.id);
    expect(order!.idempotencyKey).toBeNull();
    expect(order!.paymentToken).toBeNull();

    const [orderItem] = await db.select().from(storeOrderItemsTable).where(eq(storeOrderItemsTable.orderId, order!.id)).limit(1);
    expect(orderItem!.productId).toBe(product!.id);
    expect((orderItem as unknown as Record<string, unknown>).partnerId ?? null).toBeNull();

    // -- Reservas / passageiros: FK remap + regenerated voucher/qrCode --
    const [reservation] = await db.select().from(reservationsTable).where(eq(reservationsTable.voucherCode, `OLDVOUCHER1-${RUN}`)).limit(1);
    expect(reservation!.tripId).toBe(trip!.id);
    expect(reservation!.clientId).toBe(client1!.id);
    expect(reservation!.sellerId).toBe(MATCHED_USER_ID);
    expect(reservation!.createdById).toBe(MATCHED_USER_ID);
    expect(reservation!.storeOrderId).toBe(order!.id);
    expect(reservation!.qrCode).toBe(`QR-OLDVOUCHER1-${RUN}`);
    expect(reservation!.reservationNumber).toBeTruthy();

    const [passenger] = await db.select().from(passengersTable).where(eq(passengersTable.reservationId, reservation!.id)).limit(1);
    expect(passenger!.name).toBe("Passageiro Um");

    // -- Embarque / check-in --
    const [boarding] = await db.select().from(boardingLocationsTable).where(eq(boardingLocationsTable.name, "Ponto Central")).limit(1);
    expect(boarding!.tenantId).toBe(TENANT_ID);

    const [checkin] = await db.select().from(tripCheckinsTable).where(eq(tripCheckinsTable.tripId, trip!.id)).limit(1);
    expect(checkin!.passengerId).toBe(passenger!.id);
    expect(checkin!.reservationId).toBe(reservation!.id);
    expect(checkin!.checkedInByUserRef).toBe(MATCHED_USER_ID);

    // -- Automações --
    const [automation] = await db.select().from(automationsTable).where(eq(automationsTable.tenantId, TENANT_ID)).limit(1);
    const [action] = await db.select().from(automationActionsTable).where(eq(automationActionsTable.automationId, automation!.id)).limit(1);
    const [log] = await db.select().from(automationLogsTable).where(eq(automationLogsTable.automationId, automation!.id)).limit(1);
    expect(action).toBeTruthy();
    expect(log).toBeTruthy();

    // -- Indicações: referrerId/referredId/reservationId remap + code taken from referrer --
    const [referral] = await db.select().from(referralsTable).where(eq(referralsTable.tenantId, TENANT_ID)).limit(1);
    expect(referral!.referrerId).toBe(client1!.id);
    expect(referral!.referredId).toBe(client2!.id);
    expect(referral!.reservationId).toBe(reservation!.id);
    expect(referral!.code).toBe(client1!.referralCode);
    expect(referral!.code).not.toBe("OLDCODE");

    // -- Financeiro --
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.tenantId, TENANT_ID)).limit(1);
    expect(payment!.reservationId).toBe(reservation!.id);
    expect(payment!.clientId).toBe(client1!.id);
    expect(payment!.orderId).toBe(order!.id);

    const restoredExpenses = await db.select().from(expensesTable).where(eq(expensesTable.tenantId, TENANT_ID));
    const expense = restoredExpenses.find((row) => row.description === "Combustível")!;
    const expenseWithMissingSupplier = restoredExpenses.find((row) => row.description === "Fornecedor ausente")!;
    const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.tenantId, TENANT_ID)).limit(1);
    expect(expense.tripId).toBe(trip!.id);
    expect(expense.supplierId).toBe(supplier!.id);
    expect(expense.createdById).toBe(IMPORTER_ID); // unmatched user -> importer (attribution)
    expect(expenseWithMissingSupplier.supplierId).toBeNull();

    // -- Convites: fresh token minted, always starts pending --
    const [invite] = await db.select().from(invitesTable).where(eq(invitesTable.tenantId, TENANT_ID)).limit(1);
    expect(invite!.invitedBy).toBe(MATCHED_USER_ID);
    expect(invite!.email).toBe(`pending-${RUN}@example.com`);
    expect(invite!.token).not.toBe("old-pending-token");
    expect(invite!.accepted).toBe(false);
    expect(invite!.acceptedAt).toBeNull();

    // -- Clientes: conquistas / destinos dos sonhos / notificações --
    const [achievement] = await db.select().from(clientAchievementsTable).where(eq(clientAchievementsTable.tenantId, TENANT_ID)).limit(1);
    expect(achievement!.clientId).toBe(client1!.id);
    const [dream] = await db.select().from(clientDreamDestinationsTable).where(eq(clientDreamDestinationsTable.tenantId, TENANT_ID)).limit(1);
    expect(dream!.clientId).toBe(client1!.id);
    const [notification] = await db.select().from(clientNotificationsTable).where(eq(clientNotificationsTable.tenantId, TENANT_ID)).limit(1);
    expect(notification!.clientId).toBe(client1!.id);

    // -- Cadastros auxiliares + vehicle layout remap onto the trip --
    const [layout] = await db.select().from(vehicleLayoutsTable).where(eq(vehicleLayoutsTable.tenantId, TENANT_ID)).limit(1);
    expect(trip!.layoutId).toBe(layout!.id);
    const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.tenantId, TENANT_ID)).limit(1);
    expect(trip!.vehicleId).toBe(vehicle!.id);
    const [media] = await db.select().from(tripMediaTable).where(eq(tripMediaTable.tripId, trip!.id)).limit(1);
    expect(media!.uploadedByUserId).toBe(MATCHED_USER_ID);

    // -- Pipeline / negociações --
    const [pipeline] = await db.select().from(pipelinesTable).where(eq(pipelinesTable.tenantId, TENANT_ID)).limit(1);
    const [stage] = await db.select().from(pipelineStagesTable).where(eq(pipelineStagesTable.pipelineId, pipeline!.id)).limit(1);
    const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.tenantId, TENANT_ID)).limit(1);
    expect(deal!.stageId).toBe(stage!.id);
    expect(deal!.clientId).toBe(client1!.id);
    expect(deal!.tripId).toBe(trip!.id);
    expect(deal!.reservationId).toBe(reservation!.id);
    expect(deal!.ownerId).toBe(MATCHED_USER_ID);

    // -- Fidelidade --
    const [loyaltyProgram] = await db.select().from(loyaltyProgramsTable).where(eq(loyaltyProgramsTable.tenantId, TENANT_ID)).limit(1);
    const [loyaltyMember] = await db.select().from(loyaltyMembersTable).where(eq(loyaltyMembersTable.programId, loyaltyProgram!.id)).limit(1);
    expect(loyaltyMember!.clientId).toBe(client1!.id);
    const [loyaltyTx] = await db.select().from(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.memberId, loyaltyMember!.id)).limit(1);
    expect(loyaltyTx!.referenceId).toBe(reservation!.id);
    expect(loyaltyTx!.referenceType).toBe("reservation");

    // -- Financeiro: acertos + lançamentos (reversal two-pass patch) --
    const [settlementItem] = await db.select().from(settlementItemsTable).where(eq(settlementItemsTable.tenantId, TENANT_ID)).limit(1);
    expect(settlementItem!.orderId).toBe(order!.id);
    expect(settlementItem!.orderItemId).toBe(orderItem!.id);
    expect(settlementItem!.clientId).toBe(client1!.id);
    expect(settlementItem!.sellerId).toBe(MATCHED_USER_ID);
    const ledgerEntries = await db.select().from(financialLedgerEntriesTable).where(eq(financialLedgerEntriesTable.tenantId, TENANT_ID));
    expect(ledgerEntries.length).toBe(2);
    const originalEntry = ledgerEntries.find((e) => e.eventType === "order_paid")!;
    const reversalEntry = ledgerEntries.find((e) => e.eventType === "order_refunded")!;
    expect(originalEntry.settlementItemId).toBe(settlementItem!.id);
    expect(originalEntry.participantId).toBe(MATCHED_USER_ID);
    expect(reversalEntry.participantId).toBe(MATCHED_USER_ID);
    expect(reversalEntry.reversalOfEntryId).toBe(originalEntry.id); // two-pass self-referential patch

    // -- Calendário: user/client/trip/payment remap --
    const [calendarEvent] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.tenantId, TENANT_ID)).limit(1);
    expect(calendarEvent!.userId).toBe(MATCHED_USER_ID);
    expect(calendarEvent!.clientId).toBe(client1!.id);
    expect(calendarEvent!.tripId).toBe(trip!.id);
    expect(calendarEvent!.paymentId).toBe(payment!.id);

    // -- Documentos: entityId remapped for entityType "client" --
    const restoredDocuments = await db.select().from(documentsTable).where(eq(documentsTable.tenantId, TENANT_ID));
    const clientDocument = restoredDocuments.find((row) => row.entityType === "client")!;
    const reservationDocument = restoredDocuments.find((row) => row.entityType === "reservation")!;
    expect(clientDocument.entityId).toBe(client1!.id);
    expect(clientDocument.uploadedById).toBe(MATCHED_USER_ID);
    expect(reservationDocument.entityId).toBe(reservation!.id);
    expect(reservationDocument.uploadedById).toBe(MATCHED_USER_ID);

    // -- Marketing: campanhas / envios / NPS (userId is really a client id) --
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.tenantId, TENANT_ID)).limit(1);
    expect(campaign!.createdById).toBe(MATCHED_USER_ID);
    const [campaignSend] = await db.select().from(campaignSendsTable).where(eq(campaignSendsTable.campaignId, campaign!.id)).limit(1);
    expect(campaignSend!.clientId).toBe(client1!.id);
    const [npsResponse] = await db.select().from(npsResponsesTable).where(eq(npsResponsesTable.tenantId, TENANT_ID)).limit(1);
    expect(npsResponse!.userId).toBe(client1!.id);
    expect(npsResponse!.orderId).toBe(order!.id);

    // -- Distribuição: offer/operation/booking chain --
    const [offer] = await db.select().from(distributionOffersTable).where(eq(distributionOffersTable.tenantId, TENANT_ID)).limit(1);
    const [operation] = await db.select().from(distributionOperationsTable).where(eq(distributionOperationsTable.tenantId, TENANT_ID)).limit(1);
    expect(operation!.offerId).toBe(offer!.id);
    const [booking] = await db.select().from(distributionBookingsTable).where(eq(distributionBookingsTable.tenantId, TENANT_ID)).limit(1);
    expect(booking!.offerId).toBe(offer!.id);

    // -- Re-import under the SAME idempotency key replays the saved report verbatim --
    const replay = await request(buildApp())
      .post("/api/backup/import")
      .send({ idempotencyKey, backup });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.report).toEqual(report);

    const [clientCountAfterReplay] = await db.select().from(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
    expect(clientCountAfterReplay).toBeTruthy(); // sanity: table still queryable

    // -- Re-import the SAME file under a DIFFERENT idempotency key: the
    // per-row ledger (not just the whole-batch replay) must prevent duplicates --
    const second = await request(buildApp())
      .post("/api/backup/import")
      .send({ idempotencyKey: `k-${randomUUID()}`, backup });
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBeUndefined();
    const report2 = second.body.report;
    expect(report2.clientes.created).toBe(0);
    expect(report2.clientes.duplicate).toBe(2);
    expect(report2.viagens.created).toBe(0);
    expect(report2.viagens.duplicate).toBe(1);
    expect(report2.reservas.created).toBe(0);
    expect(report2.reservas.duplicate).toBe(1);
    expect(report2.lojaPedidos.created).toBe(0);
    expect(report2.lojaPedidos.duplicate).toBe(1);
    expect(report2.financeiroLancamentos.created).toBe(0);
    expect(report2.financeiroLancamentos.duplicate).toBe(2);
    expect(report2.negociacoes.created).toBe(0);
    expect(report2.negociacoes.duplicate).toBe(1);
    expect(report2.marketingNps.created).toBe(0);
    expect(report2.marketingNps.duplicate).toBe(1);
    expect(report2.distribuicaoOfertas.created).toBe(0);
    expect(report2.distribuicaoOfertas.duplicate).toBe(1);
    expect(report2.distribuicaoReservas.created).toBe(0);
    expect(report2.distribuicaoReservas.duplicate).toBe(1);

    const clientsAfter = await db.select().from(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
    expect(clientsAfter.length).toBe(2); // no duplicates created

    // -- A backup whose distribution rows have new source IDs but the same
    // provider natural keys must reuse the live offer/booking. The operation
    // is retained with a regenerated idempotency key.
    const naturalKeyBackup = buildValidBackup(TENANT_ID);
    const naturalKeyData = naturalKeyBackup.data as Record<string, unknown>;
    const naturalKeyClients = naturalKeyData.clientes as {
      achievements: Array<Record<string, unknown>>;
    };
    const naturalKeyPipeline = naturalKeyData.pipeline as {
      stages: Array<Record<string, unknown>>;
      deals: Array<Record<string, unknown>>;
    };
    const naturalKeyFinance = naturalKeyData.financeiro as {
      settlementItems: Array<Record<string, unknown>>;
    };
    const naturalKeyMarketing = naturalKeyData.marketing as {
      campaignSends: Array<Record<string, unknown>>;
    };
    const naturalKeyDistribution = naturalKeyData.distribuicao as {
      offers: Array<Record<string, unknown>>;
      operations: Array<Record<string, unknown>>;
      bookings: Array<Record<string, unknown>>;
    };
    naturalKeyClients.achievements[0]!.id = "src-ach-natural-key-2";
    naturalKeyPipeline.stages[0]!.id = "src-stage-natural-key-2";
    naturalKeyPipeline.deals[0]!.id = "src-deal-natural-key-2";
    naturalKeyPipeline.deals[0]!.stageId = "src-stage-natural-key-2";
    naturalKeyFinance.settlementItems[0]!.id = "src-settlement-natural-key-2";
    naturalKeyMarketing.campaignSends[0]!.id = "src-send-natural-key-2";
    naturalKeyDistribution.offers[0]!.id = "src-offer-natural-key-2";
    naturalKeyDistribution.operations[0]!.id = "src-op-natural-key-2";
    naturalKeyDistribution.operations[0]!.offerId = "src-offer-natural-key-2";
    naturalKeyDistribution.bookings[0]!.id = "src-booking-natural-key-2";
    naturalKeyDistribution.bookings[0]!.offerId = "src-offer-natural-key-2";

    const naturalKeyImport = await request(buildApp())
      .post("/api/backup/import")
      .send({ idempotencyKey: `k-${randomUUID()}`, backup: naturalKeyBackup });
    expect(naturalKeyImport.status).toBe(200);
    const naturalKeyReport = naturalKeyImport.body.report;
    expect(naturalKeyReport.clientesConquistas.created).toBe(0);
    expect(naturalKeyReport.clientesConquistas.skipped).toBe(1);
    expect(naturalKeyReport.clientesConquistas.errors).toEqual([]);
    expect(naturalKeyReport.etapasPipeline.created).toBe(0);
    expect(naturalKeyReport.etapasPipeline.skipped).toBe(1);
    expect(naturalKeyReport.etapasPipeline.errors).toEqual([]);
    expect(naturalKeyReport.negociacoes.created).toBe(0);
    expect(naturalKeyReport.negociacoes.skipped).toBe(1);
    expect(naturalKeyReport.negociacoes.errors).toEqual([]);
    expect(naturalKeyReport.financeiroAcertos.created).toBe(0);
    expect(naturalKeyReport.financeiroAcertos.skipped).toBe(1);
    expect(naturalKeyReport.financeiroAcertos.errors).toEqual([]);
    expect(naturalKeyReport.marketingEnvios.created).toBe(0);
    expect(naturalKeyReport.marketingEnvios.skipped).toBe(1);
    expect(naturalKeyReport.marketingEnvios.errors).toEqual([]);
    expect(naturalKeyReport.distribuicaoOfertas.created).toBe(0);
    expect(naturalKeyReport.distribuicaoOfertas.skipped).toBe(1);
    expect(naturalKeyReport.distribuicaoOfertas.errors).toEqual([]);
    expect(naturalKeyReport.distribuicaoOperacoes.created).toBe(1);
    expect(naturalKeyReport.distribuicaoOperacoes.errors).toEqual([]);
    expect(naturalKeyReport.distribuicaoReservas.created).toBe(0);
    expect(naturalKeyReport.distribuicaoReservas.skipped).toBe(1);
    expect(naturalKeyReport.distribuicaoReservas.errors).toEqual([]);

    const offersAfterNaturalKeyImport = await db.select().from(distributionOffersTable)
      .where(eq(distributionOffersTable.tenantId, TENANT_ID));
    const bookingsAfterNaturalKeyImport = await db.select().from(distributionBookingsTable)
      .where(eq(distributionBookingsTable.tenantId, TENANT_ID));
    const operationsAfterNaturalKeyImport = await db.select().from(distributionOperationsTable)
      .where(eq(distributionOperationsTable.tenantId, TENANT_ID));
    expect(offersAfterNaturalKeyImport.length).toBe(1);
    expect(bookingsAfterNaturalKeyImport.length).toBe(1);
    expect(operationsAfterNaturalKeyImport.length).toBe(2);
    expect(operationsAfterNaturalKeyImport.map((row) => row.idempotencyKey)).toEqual(
      expect.arrayContaining(["old-op-key-1", expect.stringMatching(/^restored-/)]),
    );

    // -- Batches + ledger rows recorded --
    const batches = await db.select().from(backupImportBatchesTable).where(eq(backupImportBatchesTable.tenantId, TENANT_ID));
    expect(batches.length).toBe(3); // one per distinct idempotency key used above
    const ledgerRows = await db.select().from(backupImportRecordsTable).where(eq(backupImportRecordsTable.tenantId, TENANT_ID));
    expect(ledgerRows.length).toBeGreaterThan(0);
  });

  it("rejects a replay attempt that reuses an idempotency key with different content", async () => {
    mockAuthedAs(ROLES.AGENCY_ADMIN);
    const idempotencyKey = `k-conflict-${randomUUID()}`;
    const backupA = buildValidBackup(TENANT_ID);
    const first = await request(buildApp()).post("/api/backup/import").send({ idempotencyKey, backup: backupA });
    expect(first.status).toBe(200);

    const backupB = buildValidBackup(TENANT_ID);
    (backupB.data as Record<string, unknown>).agencia = { ...(backupB.data as Record<string, unknown>).agencia as object, name: "Nome Diferente" };
    const second = await request(buildApp()).post("/api/backup/import").send({ idempotencyKey, backup: backupB });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("BACKUP_IMPORT_IDEMPOTENCY_CONFLICT");
  });
});

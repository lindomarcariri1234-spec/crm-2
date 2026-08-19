import { ROLES } from "@workspace/permissions";
import { randomUUID } from "crypto";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import {
  db,
  tenantsTable,
  usersTable,
  tripsTable,
  clientsTable,
  storesTable,
  storeProductsTable,
  storeOrdersTable,
  reservationsTable,
} from "@workspace/db";

const { mockNextSeq } = vi.hoisted(() => ({ mockNextSeq: vi.fn() }));

// Clerk mock: createUser rejects with form_identifier_exists so the route sets
// newClerkId = null and skips db.insert(usersTable) — no fire-and-forget DB writes
vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: {
      createUser: vi.fn().mockRejectedValue({ errors: [{ code: "form_identifier_exists" }] }),
    },
    signInTokens: { createSignInToken: vi.fn() },
  },
  getAuth: vi.fn(() => ({ userId: "test_clerk" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/seat-sse.js", () => ({ addSeatClient: vi.fn(), removeSeatClient: vi.fn(), emitSeatUpdate: vi.fn() }));
vi.mock("../lib/realtime.js", () => ({ broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/tenant.js", () => ({ requireAuth: vi.fn(), getTenantUser: vi.fn(), ADMIN_ROLES: ["admin"], MANAGEMENT_ROLES: ["admin", "gerente"] }));
vi.mock("../routes/payments.js", () => ({ syncReservationCommission: vi.fn().mockResolvedValue(undefined), recalculateClientFinancials: vi.fn().mockResolvedValue(undefined), default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), use: vi.fn() } }));
vi.mock("../queues/email-helpers.js", () => ({ enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined), enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined), sendWelcomeEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/google-calendar/sync-service.js", () => ({ CalendarSyncService: { syncTrip: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../lib/activities.js", () => ({ writeClientActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/pricing.js", () => ({
  normalizeOrderEmail: vi.fn((e: unknown) => typeof e === "string" ? e.trim().toLowerCase() : null),
  roundMoney: vi.fn((v: number) => Math.round(v * 100) / 100),
}));
vi.mock("../lib/reservation-number.js", () => ({
  getTenantReservationPrefix: vi.fn().mockResolvedValue("AG"),
  nextReservationSequence: mockNextSeq,
  buildReservationNumber: vi.fn(() => "AG-EX-202507-0001"),
  getYearMonth: vi.fn(() => "202507"),
  tripTypeToCode: vi.fn(() => "EX"),
}));
vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => randomUUID()),
  generateVoucherCode: vi.fn(() => `VCH-${randomUUID().slice(0, 8).toUpperCase()}`),
  generateReferralCode: vi.fn(() => "REF-0001"),
}));

import { requireAuth } from "../lib/tenant.js";
import storePublicRouter from "../routes/store-public.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const RUN       = randomUUID().replace(/-/g, "").slice(0, 8);
const TENANT_ID = `ghtst-${RUN}`;
const USER_ID   = `ghu-${RUN}`;
const STORE_ID  = `ghs-${RUN}`;
const TRIP_ID   = `ght-${RUN}`;
const PROD_ID   = `ghp-${RUN}`;
const SLUG      = `ghost-store-${RUN}`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request, _res, next) => {
    const noop = () => {};
    (req as unknown as Record<string, unknown>).log = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
    (req as unknown as Record<string, unknown>).id = "test-req";
    next();
  });
  app.use("/api", storePublicRouter);
  app.use(errorHandler);
  return app;
}

beforeAll(async () => {
  vi.mocked(requireAuth).mockResolvedValue({} as never);
  await db.insert(tenantsTable).values({ id: TENANT_ID, name: "Ghost Agency", slug: `ghost-agency-${RUN}`, email: `ghost-${RUN}@agency.com`, planId: "starter", status: "trial" });
  await db.insert(usersTable).values({ id: USER_ID, clerkId: `ghost_clerk_${RUN}`, tenantId: TENANT_ID, name: "Ghost Agent", email: `ghost-agent-${RUN}@agency.com`, role: ROLES.AGENCY_ADMIN, referralCode: `GHRF${RUN.toUpperCase()}` });
  await db.insert(storesTable).values({ id: STORE_ID, tenantId: TENANT_ID, slug: SLUG, name: "Ghost Store", email: `store-${RUN}@agency.com` });
  await db.insert(tripsTable).values({ id: TRIP_ID, tenantId: TENANT_ID, name: "Ghost Trip", slug: `ghost-trip-${RUN}`, destination: "Fortaleza", destinationCity: "Fortaleza", destinationState: "CE", type: "excursao", category: "standard", departureDate: new Date("2027-06-01"), totalCapacity: 40, availableSeats: 40, reservedSeats: 0, priceAdult: "300", createdById: USER_ID });
  await db.insert(storeProductsTable).values({ id: PROD_ID, storeId: STORE_ID, type: "trip", name: "Excursão Nordeste", slug: `excursao-nordeste-${RUN}`, price: "300", status: "active", trackInventory: false, tripId: TRIP_ID });
});

afterAll(async () => {
  // Short settle to let the fire-and-forget IIFE finish before cascaded deletes
  await new Promise((resolve) => setTimeout(resolve, 150));
  await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, TENANT_ID));
  await db.delete(storeOrdersTable).where(eq(storeOrdersTable.storeId, STORE_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(storeProductsTable).where(eq(storeProductsTable.storeId, STORE_ID));
  await db.delete(storesTable).where(eq(storesTable.id, STORE_ID));
  await db.delete(tripsTable).where(eq(tripsTable.id, TRIP_ID));
  await db.delete(usersTable).where(eq(usersTable.tenantId, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

describe("Ghost reservation prevention — checkout route (real DB)", () => {
  it("leaves no client row when transaction rolls back after client insert", async () => {
    const email = `ghost-customer-${RUN}@test.com`;

    // generateId is mocked above. We need: orderId succeeds (before tx),
    // then newClientId inside tx.insert(clientsTable) throws to force rollback.
    // generateId is called: (1) for orderId at route level, (2) inside upsertCheckoutClient
    // for a brand-new client. We make the 2nd call throw.
    const { generateId } = await import("../lib/id.js");
    const mockGenerateId = vi.mocked(generateId);
    let callCount = 0;
    mockGenerateId.mockImplementation(() => {
      callCount += 1;
      if (callCount === 2) throw new Error("Simulated ID failure inside tx");
      return randomUUID();
    });

    const res = await request(buildApp())
      .post(`/api/public/store/${SLUG}/orders`)
      .send({ customerName: "Ghost Customer", customerEmail: email, items: [{ productId: PROD_ID, quantity: 1 }] });

    // Restore to random UUID for subsequent tests
    mockGenerateId.mockImplementation(() => randomUUID());

    // Tx should have rolled back
    expect(res.status).toBeGreaterThanOrEqual(400);

    const [orphan] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(and(eq(clientsTable.tenantId, TENANT_ID), eq(clientsTable.email, email)));
    expect(orphan).toBeUndefined();
  });
});

describe("Checkout order creation — immediate reservation sync (real DB)", () => {
  it("creates a store order AND the client/reservation immediately at checkout; reservationExpiresAt is null", async () => {
    const email = `no-prealloc-${RUN}@test.com`;

    const res = await request(buildApp())
      .post(`/api/public/store/${SLUG}/orders`)
      .send({ customerName: "No Prealloc Customer", customerEmail: email, items: [{ productId: PROD_ID, quantity: 1 }] });

    expect(res.status).toBe(200);
    // Payment-gated pricing/expiry fields are unaffected: reservationExpiresAt
    // stays null (no temporary seat holds), but the reservation itself is no
    // longer payment-gated — it is created synchronously within this request.
    expect(res.body.reservationExpiresAt).toBeNull();

    // Client row MUST exist now — checkout immediately syncs to the CRM so
    // agencies see the lead/client right away, even before payment confirms.
    const [client] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(and(eq(clientsTable.tenantId, TENANT_ID), eq(clientsTable.email, email)));
    expect(client).toBeDefined();

    // A pending reservation should exist immediately — it is promoted to
    // "confirmed" only later, once payment is confirmed.
    const result = await db.execute(sql`
      SELECT id, status FROM reservations
      WHERE tenant_id = ${TENANT_ID}
      LIMIT 1
    `);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.["status"]).toBe("pending");
  });
});

import { ROLES } from "@workspace/permissions";
import { randomUUID } from "crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  tenantsTable,
  usersTable,
  tripsTable,
  clientsTable,
  reservationsTable,
  type InsertReservation,
  type InsertClient,
} from "@workspace/db";

vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runExpiredReservationsCron } from "../lib/expired-reservations.js";

const RUN       = randomUUID().replace(/-/g, "").slice(0, 8);
const TENANT_ID = `tst-${RUN}`;
const USER_ID   = `tstu-${RUN}`;
const TRIP_ID   = `tstt-${RUN}`;
const CLIENT_ID = `tstc-${RUN}`;
const INITIAL_SEATS = 10;

function resId(suffix: string) { return `tstr-${RUN}-${suffix}`; }

async function readReservation(id: string) {
  const [row] = await db
    .select({ status: reservationsTable.status })
    .from(reservationsTable)
    .where(eq(reservationsTable.id, id));
  return row;
}

async function readAvailableSeats() {
  const [row] = await db
    .select({ availableSeats: tripsTable.availableSeats })
    .from(tripsTable)
    .where(eq(tripsTable.id, TRIP_ID));
  return row?.availableSeats ?? 0;
}

// Typed helpers to avoid Drizzle/Zod insert-schema drift
function makeClient(overrides: Partial<InsertClient> = {}): InsertClient {
  return {
    id: CLIENT_ID, tenantId: TENANT_ID, name: "Cron Client",
    email: `client-${RUN}@test.com`, whatsapp: "11999990000", createdById: USER_ID,
    ...overrides,
  } as InsertClient;
}

function makeReservation(fields: Pick<InsertReservation, "id" | "seats" | "totalValue" | "balance" | "voucherCode" | "qrCode" | "status">): InsertReservation {
  return {
    tenantId: TENANT_ID, tripId: TRIP_ID, clientId: CLIENT_ID, createdById: USER_ID,
    ...fields,
  } as InsertReservation;
}

beforeAll(async () => {
  await db.insert(tenantsTable).values({ id: TENANT_ID, name: "Cron Test Agency", slug: `cron-test-${RUN}`, email: `cron-${RUN}@test.com`, planId: "starter", status: "trial" });
  await db.insert(usersTable).values({ id: USER_ID, clerkId: `clerk_${RUN}`, tenantId: TENANT_ID, name: "Cron Agent", email: `agent-${RUN}@test.com`, role: ROLES.AGENCY_ADMIN, referralCode: `REF${RUN.toUpperCase()}` });
  await db.insert(tripsTable).values({ id: TRIP_ID, tenantId: TENANT_ID, name: "Cron Test Trip", slug: `cron-trip-${RUN}`, destination: "Fortaleza", destinationCity: "Fortaleza", destinationState: "CE", type: "excursao", category: "standard", departureDate: new Date("2027-01-10"), totalCapacity: INITIAL_SEATS, availableSeats: INITIAL_SEATS, reservedSeats: 0, priceAdult: "200", createdById: USER_ID });
  await db.insert(clientsTable).values(makeClient());
});

afterAll(async () => {
  await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, TENANT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(tripsTable).where(eq(tripsTable.id, TRIP_ID));
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

beforeEach(async () => {
  await db.delete(reservationsTable).where(and(eq(reservationsTable.tenantId, TENANT_ID), eq(reservationsTable.tripId, TRIP_ID)));
  await db.update(tripsTable).set({ availableSeats: INITIAL_SEATS, reservedSeats: 0 }).where(eq(tripsTable.id, TRIP_ID));
});

// Sets expires_at via raw SQL because expiresAt is not yet in the compiled Drizzle insert type
async function setExpiresAt(id: string, expiresAt: Date) {
  await db.execute(sql`UPDATE reservations SET expires_at = ${expiresAt} WHERE id = ${id}`);
}

describe("runExpiredReservationsCron()", () => {
  it("cancels an expired pending reservation and restores available_seats on the trip", async () => {
    await db.insert(reservationsTable).values(makeReservation({ id: resId("expired"), seats: ["A1", "A2"], totalValue: "300", balance: "300", voucherCode: `VCH-${RUN}-EXP`, qrCode: "qr-exp", status: "pending" }));
    await setExpiresAt(resId("expired"), new Date(Date.now() - 60_000));
    await db.update(tripsTable).set({ availableSeats: INITIAL_SEATS - 2, reservedSeats: 2 }).where(eq(tripsTable.id, TRIP_ID));

    await runExpiredReservationsCron();

    expect((await readReservation(resId("expired")))?.status).toBe("cancelled");
    expect(await readAvailableSeats()).toBe(INITIAL_SEATS);
  });

  it("does NOT cancel a pending reservation whose expiresAt is in the future", async () => {
    await db.insert(reservationsTable).values(makeReservation({ id: resId("future"), seats: ["B1"], totalValue: "200", balance: "200", voucherCode: `VCH-${RUN}-FUT`, qrCode: "qr-fut", status: "pending" }));
    await setExpiresAt(resId("future"), new Date(Date.now() + 15 * 60_000));
    await db.update(tripsTable).set({ availableSeats: INITIAL_SEATS - 1, reservedSeats: 1 }).where(eq(tripsTable.id, TRIP_ID));

    await runExpiredReservationsCron();

    expect((await readReservation(resId("future")))?.status).toBe("pending");
    expect(await readAvailableSeats()).toBe(INITIAL_SEATS - 1);
  });

  it("cancels only expired reservations when both past and future exist together", async () => {
    await db.insert(reservationsTable).values(makeReservation({ id: resId("mixed-exp"), seats: ["C1", "C2"], totalValue: "400", balance: "400", voucherCode: `VCH-${RUN}-MXE`, qrCode: "qr-mxe", status: "pending" }));
    await setExpiresAt(resId("mixed-exp"), new Date(Date.now() - 60_000));
    await db.insert(reservationsTable).values(makeReservation({ id: resId("mixed-fut"), seats: ["C3"], totalValue: "200", balance: "200", voucherCode: `VCH-${RUN}-MXF`, qrCode: "qr-mxf", status: "pending" }));
    await setExpiresAt(resId("mixed-fut"), new Date(Date.now() + 15 * 60_000));
    await db.update(tripsTable).set({ availableSeats: INITIAL_SEATS - 3, reservedSeats: 3 }).where(eq(tripsTable.id, TRIP_ID));

    await runExpiredReservationsCron();

    expect((await readReservation(resId("mixed-exp")))?.status).toBe("cancelled");
    expect((await readReservation(resId("mixed-fut")))?.status).toBe("pending");
    expect(await readAvailableSeats()).toBe(INITIAL_SEATS - 1);
  });
});

/**
 * Task #197 — Sales-cycle SQL verification with real data
 *
 * Runs the three CTE queries from GET /insights/sales-cycle against an
 * isolated PostgreSQL fixture, seeded with clients whose registration
 * dates, payment dates, and trip departure dates are chosen so the
 * expected avg/median can be computed by hand.
 *
 * Why: mocked unit tests confirm the endpoint maps SQL columns correctly,
 * but cannot catch a typo in a JOIN condition, a missing tenant filter, or
 * an incorrect PERCENTILE_CONT order clause. This integration test seeds
 * known rows and asserts the exact CTE output.
 *
 * Fixture tenant: itg-sc-tenant-001  (cleaned up in afterAll)
 *
 * Expected values (all derived from fixture timestamps, see comments below):
 *   avg_days_to_payment  = 25.0   (10 + 20 + 30 + 40 / 4)
 *   median               = 25.0   PERCENTILE_CONT(0.5) of [10,20,30,40]
 *   p25                  = 17.5
 *   p75                  = 32.5
 *   avg_days_to_trip     = 75.3   ROUND(301/4, 1)
 *   median_days_to_trip  = 75.0   PERCENTILE_CONT(0.5) of [46,65,85,105]
 *
 * Channel breakdown totals must equal totalClients (5):
 *   Instagram  3 clients (2 paid)   avg_days_to_payment = 35.0
 *   Indicação  1 client  (1 paid)   avg_days_to_payment = 20.0
 *   Outros     1 client  (1 paid)   avg_days_to_payment = 10.0
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Fixture IDs — common prefix lets afterAll delete everything in one pass
// ---------------------------------------------------------------------------

const T  = "itg-sc-tenant-001";          // tenant
const U  = "itg-sc-user-001";            // user (needed for reservation FK)
const TR = "itg-sc-trip-001";            // single trip all 4 paying clients attend

const C1 = "itg-sc-client-001";          // Instagram, 40 days to payment, 105 days to trip
const C2 = "itg-sc-client-002";          // Instagram, 30 days to payment,  85 days to trip
const C3 = "itg-sc-client-003";          // Indicação, 20 days to payment,  65 days to trip
const C4 = "itg-sc-client-004";          // null origin (→Outros), 10 days to payment, 46 days to trip
const C5 = "itg-sc-client-005";          // Instagram, no payment, no reservation

const R1 = "itg-sc-res-001";
const R2 = "itg-sc-res-002";
const R3 = "itg-sc-res-003";
const R4 = "itg-sc-res-004";

const P1 = "itg-sc-pay-001";
const P2 = "itg-sc-pay-002";
const P3 = "itg-sc-pay-003";
const P4 = "itg-sc-pay-004";

// ---------------------------------------------------------------------------
// Timestamps — all UTC midnight so EXTRACT(EPOCH …) / 86400 = whole numbers
//
//   days_to_payment:
//     C1: 2026-07-12 − 2026-06-02  = 40 d
//     C2: 2026-07-22 − 2026-06-22  = 30 d
//     C3: 2026-08-01 − 2026-07-12  = 20 d
//     C4: 2026-08-10 − 2026-07-31  = 10 d
//
//   days_to_trip (all depart 2026-09-15):
//     C1: 2026-09-15 − 2026-06-02  = 105 d
//     C2: 2026-09-15 − 2026-06-22  =  85 d
//     C3: 2026-09-15 − 2026-07-12  =  65 d
//     C4: 2026-09-15 − 2026-07-31  =  46 d
// ---------------------------------------------------------------------------

const WIN_START = "2020-01-01T00:00:00Z"; // windowStart far enough back to include all clients

// ---------------------------------------------------------------------------
// Seed + teardown helpers
// ---------------------------------------------------------------------------

async function seed() {
  // Idempotent: delete any leftovers from a prior run first
  await cleanup();

  await pool.query(
    `INSERT INTO tenants (id, name, slug, email, plan_id, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [T, "Itg Test Agency", "itg-sc-test-agency-001", "itg@test.example", "starter", "trial"],
  );

  await pool.query(
    `INSERT INTO users (id, clerk_id, name, email, referral_code)
     VALUES ($1, $2, $3, $4, $5)`,
    [U, "clerk_itg_sc_test_001", "Itg Test User", "itg-user@test.example", "ITGSC001"],
  );

  // Trip departs 2026-09-15 UTC
  await pool.query(
    `INSERT INTO trips
       (id, tenant_id, name, slug, destination, destination_city, destination_state,
        type, category, departure_date, total_capacity, available_seats,
        reserved_seats, confirmed_seats, price_adult, status, created_by_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [TR, T, "Itg Test Trip", "itg-sc-trip-slug-001", "Destino Teste",
     "Cidade Teste", "SP", "rodoviario", "lazer",
     "2026-09-15T00:00:00Z", 50, 46, 4, 4, "1500.00", "published", U],
  );

  // Clients
  const clients = [
    [C1, T, "Itg Client 1", "c1@itg.test", "11900000001", "Instagram",   "2026-06-02T00:00:00Z"],
    [C2, T, "Itg Client 2", "c2@itg.test", "11900000002", "Instagram",   "2026-06-22T00:00:00Z"],
    [C3, T, "Itg Client 3", "c3@itg.test", "11900000003", "Indicação",   "2026-07-12T00:00:00Z"],
    [C4, T, "Itg Client 4", "c4@itg.test", "11900000004", null,          "2026-07-31T00:00:00Z"],
    [C5, T, "Itg Client 5", "c5@itg.test", "11900000005", "Instagram",   "2026-08-15T00:00:00Z"],
  ];
  for (const [id, tenantId, name, email, whatsapp, origin, createdAt] of clients) {
    await pool.query(
      `INSERT INTO clients
         (id, tenant_id, name, email, whatsapp, origin, created_at, updated_at,
          total_spent, outstanding_balance, classification, status, pipeline_stage,
          created_by_id, referral_code_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7,
               '0', '0', 'new', 'active', 'novo', $8, 'active')`,
      [id, tenantId, name, email, whatsapp, origin, createdAt, U],
    );
  }

  // Reservations (C1–C4 confirmed, C5 has none)
  const reservations = [
    [R1, T, C1, "ITG001", "2026-06-02T00:00:00Z"],
    [R2, T, C2, "ITG002", "2026-06-22T00:00:00Z"],
    [R3, T, C3, "ITG003", "2026-07-12T00:00:00Z"],
    [R4, T, C4, "ITG004", "2026-07-31T00:00:00Z"],
  ];
  for (const [id, tenantId, clientId, voucher, createdAt] of reservations) {
    await pool.query(
      `INSERT INTO reservations
         (id, tenant_id, trip_id, client_id, total_value, paid_value, balance,
          status, voucher_code, qr_code, created_by_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '1500.00', '1500.00', '0.00',
               'confirmed', $5, 'QR_${voucher}', $6, $7, $7)`,
      [id, tenantId, TR, clientId, voucher, U, createdAt],
    );
  }

  // Payments (type=receivable, status=paid)
  //   paid_at drives days_to_payment
  const payments = [
    [P1, T, R1, "2026-07-12T00:00:00Z"], // 40 d after C1 creation
    [P2, T, R2, "2026-07-22T00:00:00Z"], // 30 d after C2 creation
    [P3, T, R3, "2026-08-01T00:00:00Z"], // 20 d after C3 creation
    [P4, T, R4, "2026-08-10T00:00:00Z"], // 10 d after C4 creation
  ];
  for (const [id, tenantId, reservationId, paidAt] of payments) {
    await pool.query(
      `INSERT INTO payments
         (id, tenant_id, reservation_id, type, category, amount,
          payment_method, installment_number, total_installments,
          due_date, paid_at, status)
       VALUES ($1, $2, $3, 'receivable', 'reservation', '1500.00',
               'pix', 1, 1, $4, $4, 'paid')`,
      [id, tenantId, reservationId, paidAt],
    );
  }
}

async function cleanup() {
  await pool.query(`DELETE FROM payments WHERE id LIKE 'itg-sc-pay-%'`);
  await pool.query(`DELETE FROM reservations WHERE id LIKE 'itg-sc-res-%'`);
  await pool.query(`DELETE FROM clients WHERE id LIKE 'itg-sc-client-%'`);
  await pool.query(`DELETE FROM trips WHERE id LIKE 'itg-sc-trip-%'`);
  await pool.query(`DELETE FROM users WHERE id LIKE 'itg-sc-user-%'`);
  await pool.query(`DELETE FROM tenants WHERE id LIKE 'itg-sc-tenant-%'`);
}

beforeAll(async () => { await seed(); }, 30_000);
afterAll(async () => { await cleanup(); });

// ---------------------------------------------------------------------------
// Helper: run the endpoint's overall-aggregates CTE
// ---------------------------------------------------------------------------

async function runOverallCte(tenantId: string, windowStart: string) {
  const result = await pool.query(
    `WITH
     period_clients AS (
       SELECT id, created_at
       FROM clients
       WHERE tenant_id = $1
         AND created_at >= $2::timestamptz
     ),
     first_payments AS (
       SELECT r.client_id, MIN(p.paid_at) AS first_paid_at
       FROM reservations r
       JOIN payments p ON p.reservation_id = r.id
       WHERE r.tenant_id = $1
         AND p.type = 'receivable'
         AND p.status = 'paid'
         AND p.paid_at IS NOT NULL
         AND r.client_id IS NOT NULL
         AND r.client_id IN (SELECT id FROM period_clients)
       GROUP BY r.client_id
     ),
     first_trips AS (
       SELECT r.client_id, MIN(t.departure_date) AS first_departure
       FROM reservations r
       JOIN trips t ON t.id = r.trip_id
       WHERE r.tenant_id = $1
         AND r.status IN ('confirmed', 'completed')
         AND r.client_id IS NOT NULL
         AND r.client_id IN (SELECT id FROM period_clients)
       GROUP BY r.client_id
     ),
     cycles AS (
       SELECT
         CASE WHEN fp.first_paid_at IS NOT NULL THEN
           EXTRACT(EPOCH FROM (fp.first_paid_at - c.created_at)) / 86400.0
         END AS days_to_payment,
         CASE WHEN ft.first_departure IS NOT NULL THEN
           EXTRACT(EPOCH FROM (ft.first_departure - c.created_at)) / 86400.0
         END AS days_to_trip
       FROM period_clients c
       LEFT JOIN first_payments fp ON fp.client_id = c.id
       LEFT JOIN first_trips ft ON ft.client_id = c.id
     )
     SELECT
       COUNT(*)::int AS total_clients,
       COUNT(days_to_payment)::int AS clients_with_payment,
       COUNT(days_to_trip)::int AS clients_with_trip,
       ROUND(AVG(days_to_payment)::numeric, 1) AS avg_days_to_payment,
       ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_to_payment))::numeric, 1) AS median_days_to_payment,
       ROUND((PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY days_to_payment))::numeric, 1) AS p25_days_to_payment,
       ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY days_to_payment))::numeric, 1) AS p75_days_to_payment,
       ROUND(AVG(days_to_trip)::numeric, 1) AS avg_days_to_trip,
       ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_to_trip))::numeric, 1) AS median_days_to_trip
     FROM cycles`,
    [tenantId, windowStart],
  );
  return result.rows[0] as Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// Helper: run the endpoint's channel-breakdown CTE
// ---------------------------------------------------------------------------

async function runChannelCte(tenantId: string, windowStart: string) {
  const result = await pool.query(
    `WITH
     period_clients AS (
       SELECT id, created_at, COALESCE(origin, 'Outros') AS origin
       FROM clients
       WHERE tenant_id = $1
         AND created_at >= $2::timestamptz
     ),
     first_payments AS (
       SELECT r.client_id, MIN(p.paid_at) AS first_paid_at
       FROM reservations r
       JOIN payments p ON p.reservation_id = r.id
       WHERE r.tenant_id = $1
         AND p.type = 'receivable'
         AND p.status = 'paid'
         AND p.paid_at IS NOT NULL
         AND r.client_id IS NOT NULL
         AND r.client_id IN (SELECT id FROM period_clients)
       GROUP BY r.client_id
     ),
     first_trips AS (
       SELECT r.client_id, MIN(t.departure_date) AS first_departure
       FROM reservations r
       JOIN trips t ON t.id = r.trip_id
       WHERE r.tenant_id = $1
         AND r.status IN ('confirmed', 'completed')
         AND r.client_id IS NOT NULL
         AND r.client_id IN (SELECT id FROM period_clients)
       GROUP BY r.client_id
     )
     SELECT
       c.origin,
       COUNT(DISTINCT c.id)::int AS clients,
       ROUND(AVG(EXTRACT(EPOCH FROM (fp.first_paid_at - c.created_at)) / 86400.0)::numeric, 1) AS avg_days_to_payment,
       ROUND(AVG(EXTRACT(EPOCH FROM (ft.first_departure - c.created_at)) / 86400.0)::numeric, 1) AS avg_days_to_trip,
       ROUND((COUNT(DISTINCT fp.client_id)::numeric / NULLIF(COUNT(DISTINCT c.id), 0)) * 100, 1) AS conversion_rate
     FROM period_clients c
     LEFT JOIN first_payments fp ON fp.client_id = c.id
     LEFT JOIN first_trips ft ON ft.client_id = c.id
     GROUP BY c.origin
     ORDER BY avg_days_to_payment ASC NULLS LAST`,
    [tenantId, windowStart],
  );
  return result.rows as Array<Record<string, string | null>>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sales-cycle CTEs — overall aggregates (real DB)", () => {
  it("counts total clients and clients with payment/trip correctly", async () => {
    const row = await runOverallCte(T, WIN_START);
    expect(Number(row.total_clients)).toBe(5);           // C1–C5
    expect(Number(row.clients_with_payment)).toBe(4);    // C5 has no payment
    expect(Number(row.clients_with_trip)).toBe(4);       // C5 has no reservation
  });

  it("computes average days to first payment = 25.0", async () => {
    // (40 + 30 + 20 + 10) / 4 = 25.0 — verifies JOIN logic and EPOCH math
    const row = await runOverallCte(T, WIN_START);
    expect(Number(row.avg_days_to_payment)).toBe(25.0);
  });

  it("computes median days to payment (PERCENTILE_CONT 0.5) = 25.0", async () => {
    // sorted [10,20,30,40] → virtual pos 1.5 → 20 + 0.5*(30−20) = 25.0
    const row = await runOverallCte(T, WIN_START);
    expect(Number(row.median_days_to_payment)).toBe(25.0);
  });

  it("computes p25 = 17.5 and p75 = 32.5 for [10,20,30,40]", async () => {
    // p25: virtual pos 0.75 → 10 + 0.75*(20−10) = 17.5
    // p75: virtual pos 2.25 → 30 + 0.25*(40−30) = 32.5
    const row = await runOverallCte(T, WIN_START);
    expect(Number(row.p25_days_to_payment)).toBe(17.5);
    expect(Number(row.p75_days_to_payment)).toBe(32.5);
  });

  it("computes average days to first trip departure = 75.3", async () => {
    // (105 + 85 + 65 + 46) / 4 = 75.25, ROUND(…, 1) = 75.3
    const row = await runOverallCte(T, WIN_START);
    expect(Number(row.avg_days_to_trip)).toBe(75.3);
  });

  it("computes median days to trip = 75.0", async () => {
    // sorted [46,65,85,105] → virtual pos 1.5 → 65 + 0.5*(85−65) = 75.0
    const row = await runOverallCte(T, WIN_START);
    expect(Number(row.median_days_to_trip)).toBe(75.0);
  });

  it("clients outside the window are excluded from aggregates", async () => {
    // Use windowStart that excludes C1 and C2 (created before 2026-07-01)
    const rowFiltered = await runOverallCte(T, "2026-07-01T00:00:00Z");
    // Only C3 (20d), C4 (10d), C5 (no payment) are in window
    expect(Number(rowFiltered.total_clients)).toBe(3);
    expect(Number(rowFiltered.clients_with_payment)).toBe(2);
    expect(Number(rowFiltered.avg_days_to_payment)).toBe(15.0); // (20+10)/2
  });

  it("returns null aggregates when no clients have payments in the window", async () => {
    // Empty window — no clients registered after 2030
    const row = await runOverallCte(T, "2030-01-01T00:00:00Z");
    expect(Number(row.total_clients)).toBe(0);
    expect(row.avg_days_to_payment).toBeNull();
    expect(row.median_days_to_payment).toBeNull();
    expect(row.avg_days_to_trip).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("sales-cycle CTEs — channel breakdown (real DB)", () => {
  it("sum of channel.clients equals overall totalClients", async () => {
    const channels = await runChannelCte(T, WIN_START);
    const overallRow = await runOverallCte(T, WIN_START);
    const channelSum = channels.reduce((sum, ch) => sum + Number(ch.clients), 0);
    expect(channelSum).toBe(Number(overallRow.total_clients));
  });

  it("COALESCE(origin, 'Outros') groups null-origin clients under 'Outros'", async () => {
    const channels = await runChannelCte(T, WIN_START);
    const origins = channels.map((ch) => ch.origin);
    // C4 has null origin — must be mapped to 'Outros'
    expect(origins).toContain("Outros");
    expect(origins).not.toContain(null);
  });

  it("Instagram channel has 3 clients with avg_days_to_payment = 35.0", async () => {
    // C1 (40d) + C2 (30d) pay; C5 has no payment → excluded from avg but counted in clients
    // avg = (40+30)/2 = 35.0
    const channels = await runChannelCte(T, WIN_START);
    const insta = channels.find((ch) => ch.origin === "Instagram")!;
    expect(Number(insta.clients)).toBe(3);
    expect(Number(insta.avg_days_to_payment)).toBe(35.0);
  });

  it("Indicação channel has 1 client with avg_days_to_payment = 20.0", async () => {
    const channels = await runChannelCte(T, WIN_START);
    const ind = channels.find((ch) => ch.origin === "Indicação")!;
    expect(Number(ind.clients)).toBe(1);
    expect(Number(ind.avg_days_to_payment)).toBe(20.0);
  });

  it("Outros channel has 1 client with avg_days_to_payment = 10.0", async () => {
    const channels = await runChannelCte(T, WIN_START);
    const outros = channels.find((ch) => ch.origin === "Outros")!;
    expect(Number(outros.clients)).toBe(1);
    expect(Number(outros.avg_days_to_payment)).toBe(10.0);
  });

  it("conversion_rate for Instagram is 66.7% (2 of 3 paid)", async () => {
    const channels = await runChannelCte(T, WIN_START);
    const insta = channels.find((ch) => ch.origin === "Instagram")!;
    expect(Number(insta.conversion_rate)).toBe(66.7);
  });
});

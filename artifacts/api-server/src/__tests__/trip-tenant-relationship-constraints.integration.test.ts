import { describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { generateId } from "../lib/id.js";

describe("trip tenant relationship constraints — PostgreSQL", () => {
  it("preserves valid check-ins and rejects cross-tenant or cross-trip links", async () => {
    if (!process.env["DATABASE_URL"]) {
      throw new Error("DATABASE_URL must point to an isolated integration-test database");
    }

    const client = await pool.connect();
    const suffix = generateId();
    const ids = {
      tenantA: `trip-rel-a-${suffix}`,
      tenantB: `trip-rel-b-${suffix}`,
      userA: `trip-rel-user-a-${suffix}`,
      userB: `trip-rel-user-b-${suffix}`,
      tripA: `trip-rel-trip-a-${suffix}`,
      tripB: `trip-rel-trip-b-${suffix}`,
      reservationA: `trip-rel-res-a-${suffix}`,
      reservationB: `trip-rel-res-b-${suffix}`,
      passengerA: `trip-rel-pass-a-${suffix}`,
      passengerB: `trip-rel-pass-b-${suffix}`,
      checkinA: `trip-rel-checkin-a-${suffix}`,
    };

    try {
      await client.query("BEGIN");
      for (const [tenantId, suffixName] of [[ids.tenantA, "a"], [ids.tenantB, "b"]]) {
        await client.query(
          "INSERT INTO tenants (id, name, slug, email) VALUES ($1, $2, $3, $4)",
          [tenantId, `Trip relationship ${suffixName}`, `${tenantId}-slug`, `${tenantId}@example.test`],
        );
      }
      for (const [userId, tenantId, suffixName] of [
        [ids.userA, ids.tenantA, "a"],
        [ids.userB, ids.tenantB, "b"],
      ]) {
        await client.query(
          "INSERT INTO users (id, clerk_id, tenant_id, name, email, referral_code) VALUES ($1, $2, $3, $4, $5, $6)",
          [userId, `${userId}-clerk`, tenantId, `Trip User ${suffixName}`, `${userId}@example.test`, `${userId}-ref`],
        );
      }
      for (const [tripId, tenantId] of [[ids.tripA, ids.tenantA], [ids.tripB, ids.tenantB]]) {
        await client.query(
          `INSERT INTO trips
            (id, tenant_id, name, slug, destination, destination_city, destination_state,
             type, category, departure_date, total_capacity, available_seats, price_adult, created_by_id)
           VALUES ($1, $2, 'Constraint test', $3, 'Natal', 'Natal', 'RN',
                   'excursao', 'standard', now(), 10, 10, 100, $4)`,
          [tripId, tenantId, `${tripId}-slug`, tenantId === ids.tenantA ? ids.userA : ids.userB],
        );
      }
      for (const [reservationId, tenantId, tripId, userId] of [
        [ids.reservationA, ids.tenantA, ids.tripA, ids.userA],
        [ids.reservationB, ids.tenantB, ids.tripB, ids.userB],
      ]) {
        await client.query(
          `INSERT INTO reservations
            (id, tenant_id, trip_id, total_value, balance, voucher_code, qr_code, created_by_id)
           VALUES ($1, $2, $3, 100, 100, $4, $5, $6)`,
          [reservationId, tenantId, tripId, `${reservationId}-voucher`, `${reservationId}-qr`, userId],
        );
      }
      for (const [passengerId, reservationId, name] of [
        [ids.passengerA, ids.reservationA, "Passenger A"],
        [ids.passengerB, ids.reservationB, "Passenger B"],
      ]) {
        await client.query(
          "INSERT INTO passengers (id, reservation_id, name) VALUES ($1, $2, $3)",
          [passengerId, reservationId, name],
        );
      }

      await client.query(
        `INSERT INTO trip_checkins (id, trip_id, tenant_id, passenger_id, reservation_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [ids.checkinA, ids.tripA, ids.tenantA, ids.passengerA, ids.reservationA],
      );
      const valid = await client.query(
        "SELECT reservation_id FROM trip_checkins WHERE id = $1",
        [ids.checkinA],
      );
      expect(valid.rows).toEqual([{ reservation_id: ids.reservationA }]);

      const rejects = async (statement: string, values: string[]) => {
        await client.query("SAVEPOINT invalid_link");
        await expect(client.query(statement, values)).rejects.toMatchObject({ code: "23503" });
        await client.query("ROLLBACK TO SAVEPOINT invalid_link");
        await client.query("RELEASE SAVEPOINT invalid_link");
      };

      await rejects(
        `INSERT INTO reservations
          (id, tenant_id, trip_id, total_value, balance, voucher_code, qr_code, created_by_id)
         VALUES ($1, $2, $3, 100, 100, $4, $5, $6)`,
        [`${ids.reservationB}-wrong-trip-tenant`, ids.tenantB, ids.tripA,
          `${ids.reservationB}-wrong-voucher`, `${ids.reservationB}-wrong-qr`, ids.userB],
      );
      await rejects(
        `INSERT INTO trip_checkins (id, trip_id, tenant_id, passenger_id, reservation_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [`${ids.checkinA}-wrong-reservation`, ids.tripA, ids.tenantA, ids.passengerA, ids.reservationB],
      );
      await rejects(
        `INSERT INTO trip_checkins (id, trip_id, tenant_id, passenger_id, reservation_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [`${ids.checkinA}-wrong-passenger`, ids.tripB, ids.tenantB, ids.passengerA, ids.reservationB],
      );
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});

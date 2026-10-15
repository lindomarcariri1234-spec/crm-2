import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { generateId } from "../lib/id.js";

const tripTenantMigration = readFileSync(
  fileURLToPath(new URL("../../../../lib/db/drizzle/0120_trip_tenant_relationship_constraints.sql", import.meta.url)),
  "utf8",
);

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

  it("backfills only canonical legacy links and rolls back mismatched or orphaned rows", async () => {
    if (!process.env["DATABASE_URL"]) {
      throw new Error("DATABASE_URL must point to an isolated integration-test database");
    }

    const client = await pool.connect();
    const seedScratchTables = async (
      checkin: { passengerId: string; reservationId: string | null },
    ) => {
      await client.query(`
        DROP TABLE IF EXISTS
          pg_temp.trip_checkins,
          pg_temp.passengers,
          pg_temp.reservations,
          pg_temp.trips,
          pg_temp.tenants
        CASCADE
      `);
      await client.query(`
        CREATE TEMP TABLE tenants (id text PRIMARY KEY);
        CREATE TEMP TABLE trips (id text PRIMARY KEY, tenant_id text NOT NULL);
        CREATE TEMP TABLE reservations (
          id text PRIMARY KEY,
          trip_id text NOT NULL,
          tenant_id text NOT NULL
        );
        CREATE TEMP TABLE passengers (
          id text PRIMARY KEY,
          reservation_id text NOT NULL
        );
        CREATE TEMP TABLE trip_checkins (
          id text PRIMARY KEY,
          trip_id text NOT NULL,
          tenant_id text NOT NULL,
          passenger_id text NOT NULL,
          reservation_id text
        );
        ALTER TABLE reservations
          ADD CONSTRAINT reservations_trip_id_trips_id_fk
          FOREIGN KEY (trip_id) REFERENCES trips (id);
        ALTER TABLE trip_checkins
          ADD CONSTRAINT trip_checkins_trip_id_trips_id_fk
          FOREIGN KEY (trip_id) REFERENCES trips (id);
        INSERT INTO tenants (id) VALUES ('tenant-a'), ('tenant-b');
        INSERT INTO trips (id, tenant_id)
          VALUES ('trip-a', 'tenant-a'), ('trip-b', 'tenant-b');
        INSERT INTO reservations (id, trip_id, tenant_id)
          VALUES ('reservation-a', 'trip-a', 'tenant-a'),
                 ('reservation-b', 'trip-b', 'tenant-b');
        INSERT INTO passengers (id, reservation_id)
          VALUES ('passenger-a', 'reservation-a'),
                 ('passenger-b', 'reservation-b');
      `);
      await client.query(
        `INSERT INTO trip_checkins
          (id, trip_id, tenant_id, passenger_id, reservation_id)
         VALUES ('legacy-checkin', 'trip-a', 'tenant-a', $1, $2)`,
        [checkin.passengerId, checkin.reservationId],
      );
    };

    const runMigration = async (): Promise<unknown | null> => {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO pg_temp, public");
      try {
        await client.query(tripTenantMigration);
        await client.query("COMMIT");
        return null;
      } catch (error) {
        await client.query("ROLLBACK");
        return error;
      }
    };

    try {
      await client.query("SET search_path TO pg_temp, public");

      await seedScratchTables({ passengerId: "passenger-a", reservationId: null });
      expect(await runMigration()).toBeNull();
      const backfilled = await client.query(
        "SELECT reservation_id FROM pg_temp.trip_checkins WHERE id = 'legacy-checkin'",
      );
      expect(backfilled.rows).toEqual([{ reservation_id: "reservation-a" }]);

      await seedScratchTables({
        passengerId: "passenger-a",
        reservationId: "reservation-b",
      });
      const mismatchError = await runMigration();
      expect(mismatchError).toMatchObject({
        code: "P0001",
        message: expect.stringContaining("invalid passenger, reservation, trip, or tenant relationship"),
      });
      const mismatched = await client.query(
        "SELECT passenger_id, reservation_id FROM pg_temp.trip_checkins WHERE id = 'legacy-checkin'",
      );
      expect(mismatched.rows).toEqual([{
        passenger_id: "passenger-a",
        reservation_id: "reservation-b",
      }]);

      await seedScratchTables({ passengerId: "passenger-b", reservationId: null });
      const crossTenantBackfillError = await runMigration();
      expect(crossTenantBackfillError).toMatchObject({
        code: "P0001",
        message: expect.stringContaining("invalid passenger, reservation, trip, or tenant relationship"),
      });
      const notBackfilledAcrossTenants = await client.query(
        "SELECT passenger_id, reservation_id FROM pg_temp.trip_checkins WHERE id = 'legacy-checkin'",
      );
      expect(notBackfilledAcrossTenants.rows).toEqual([{
        passenger_id: "passenger-b",
        reservation_id: null,
      }]);

      await seedScratchTables({ passengerId: "missing-passenger", reservationId: null });
      const orphanError = await runMigration();
      expect(orphanError).toMatchObject({
        code: "P0001",
        message: expect.stringContaining("invalid passenger, reservation, trip, or tenant relationship"),
      });
      const orphaned = await client.query(
        "SELECT passenger_id, reservation_id FROM pg_temp.trip_checkins WHERE id = 'legacy-checkin'",
      );
      expect(orphaned.rows).toEqual([{
        passenger_id: "missing-passenger",
        reservation_id: null,
      }]);
    } finally {
      await client.query("RESET search_path").catch(() => undefined);
      await client.query(`
        DROP TABLE IF EXISTS
          pg_temp.trip_checkins,
          pg_temp.passengers,
          pg_temp.reservations,
          pg_temp.trips,
          pg_temp.tenants
        CASCADE
      `).catch(() => undefined);
      client.release();
    }
  });
});

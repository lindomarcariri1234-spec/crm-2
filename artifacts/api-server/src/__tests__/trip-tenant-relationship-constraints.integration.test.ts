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

  it("backfills canonical check-ins and rejects mismatched legacy reservation ownership", async () => {
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
    const expectRejectedMigrationLeftSchemaUnchanged = async () => {
      const result = await client.query<{
        reservation_required: boolean;
        partial_constraint_count: number;
        partial_index_count: number;
      }>(
        `SELECT
           (SELECT attnotnull
              FROM pg_attribute
             WHERE attrelid = 'pg_temp.trip_checkins'::regclass
               AND attname = 'reservation_id'
               AND NOT attisdropped) AS reservation_required,
           (SELECT COUNT(*)::int
              FROM pg_constraint
             WHERE connamespace = pg_my_temp_schema()
               AND conname = ANY($1::text[])) AS partial_constraint_count,
           (SELECT COUNT(*)::int
              FROM pg_class
             WHERE relnamespace = pg_my_temp_schema()
               AND relkind = 'i'
               AND relname = ANY($2::text[])) AS partial_index_count`,
        [
          [
            "reservations_trip_tenant_fk",
            "trip_checkins_trip_tenant_fk",
            "trip_checkins_reservation_trip_tenant_fk",
            "trip_checkins_passenger_reservation_fk",
          ],
          [
            "trips_id_tenant_id_unique",
            "reservations_id_trip_tenant_unique",
            "passengers_id_reservation_unique",
          ],
        ],
      );
      expect(result.rows).toEqual([{
        reservation_required: false,
        partial_constraint_count: 0,
        partial_index_count: 0,
      }]);
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
      await expectRejectedMigrationLeftSchemaUnchanged();

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
      await expectRejectedMigrationLeftSchemaUnchanged();

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
      await expectRejectedMigrationLeftSchemaUnchanged();

      await seedScratchTables({ passengerId: "passenger-a", reservationId: "reservation-a" });
      await client.query(
        "UPDATE pg_temp.reservations SET tenant_id = 'tenant-b' WHERE id = 'reservation-a'",
      );
      const crossTenantReservationError = await runMigration();
      expect(crossTenantReservationError).toMatchObject({
        code: "P0001",
        message: expect.stringContaining("reservations reference a trip from another tenant or a missing trip"),
      });
      const mismatchedReservation = await client.query(
        "SELECT trip_id, tenant_id FROM pg_temp.reservations WHERE id = 'reservation-a'",
      );
      expect(mismatchedReservation.rows).toEqual([{
        trip_id: "trip-a",
        tenant_id: "tenant-b",
      }]);
      await expectRejectedMigrationLeftSchemaUnchanged();

      await seedScratchTables({ passengerId: "passenger-a", reservationId: "reservation-a" });
      await client.query(`
        ALTER TABLE pg_temp.reservations
          DROP CONSTRAINT reservations_trip_id_trips_id_fk
      `);
      await client.query(
        "UPDATE pg_temp.reservations SET trip_id = 'missing-trip' WHERE id = 'reservation-a'",
      );
      const missingTripError = await runMigration();
      expect(missingTripError).toMatchObject({
        code: "P0001",
        message: expect.stringContaining("reservations reference a trip from another tenant or a missing trip"),
      });
      const missingTripReservation = await client.query(
        "SELECT trip_id, tenant_id FROM pg_temp.reservations WHERE id = 'reservation-a'",
      );
      expect(missingTripReservation.rows).toEqual([{
        trip_id: "missing-trip",
        tenant_id: "tenant-a",
      }]);
      await expectRejectedMigrationLeftSchemaUnchanged();

      await seedScratchTables({ passengerId: "passenger-a", reservationId: "reservation-a" });
      await client.query(`
        ALTER TABLE pg_temp.reservations
          DROP CONSTRAINT reservations_trip_id_trips_id_fk;
        UPDATE pg_temp.reservations
           SET tenant_id = 'tenant-b'
         WHERE id = 'reservation-a';
        UPDATE pg_temp.reservations
           SET tenant_id = 'tenant-a'
         WHERE id = 'reservation-b';
        INSERT INTO pg_temp.reservations (id, trip_id, tenant_id)
          VALUES ('reservation-c', 'missing-trip', 'tenant-a'),
                 ('reservation-d', 'trip-a', 'tenant-a');
      `);
      const multipleInvalidReservationsError = await runMigration();
      expect(multipleInvalidReservationsError).toMatchObject({
        code: "P0001",
        message: expect.stringContaining(
          "3 reservations reference a trip from another tenant or a missing trip",
        ),
      });
      const reservationRowsAfterRollback = await client.query(
        `SELECT id, trip_id, tenant_id
           FROM pg_temp.reservations
          WHERE id IN ('reservation-a', 'reservation-b', 'reservation-c', 'reservation-d')
          ORDER BY id`,
      );
      expect(reservationRowsAfterRollback.rows).toEqual([
        { id: "reservation-a", trip_id: "trip-a", tenant_id: "tenant-b" },
        { id: "reservation-b", trip_id: "trip-b", tenant_id: "tenant-a" },
        { id: "reservation-c", trip_id: "missing-trip", tenant_id: "tenant-a" },
        { id: "reservation-d", trip_id: "trip-a", tenant_id: "tenant-a" },
      ]);
      await expectRejectedMigrationLeftSchemaUnchanged();

      await client.query(
        "UPDATE pg_temp.reservations SET tenant_id = 'tenant-a' WHERE id = 'reservation-a'",
      );
      const twoInvalidReservationsError = await runMigration();
      expect(twoInvalidReservationsError).toMatchObject({
        code: "P0001",
        message: expect.stringContaining(
          "2 reservations reference a trip from another tenant or a missing trip",
        ),
      });
      await expectRejectedMigrationLeftSchemaUnchanged();

      await client.query(
        "UPDATE pg_temp.reservations SET tenant_id = 'tenant-b' WHERE id = 'reservation-b'",
      );
      const oneInvalidReservationError = await runMigration();
      expect(oneInvalidReservationError).toMatchObject({
        code: "P0001",
        message: expect.stringContaining(
          "1 reservations reference a trip from another tenant or a missing trip",
        ),
      });
      await expectRejectedMigrationLeftSchemaUnchanged();

      await client.query(
        "INSERT INTO pg_temp.trips (id, tenant_id) VALUES ('missing-trip', 'tenant-a')",
      );
      expect(await runMigration()).toBeNull();
      const validatedConstraints = await client.query<{
        conname: string;
        convalidated: boolean;
      }>(
        `SELECT conname, convalidated
           FROM pg_constraint
          WHERE connamespace = pg_my_temp_schema()
            AND conname = ANY($1::text[])
          ORDER BY conname`,
        [[
          "reservations_trip_tenant_fk",
          "trip_checkins_trip_tenant_fk",
          "trip_checkins_reservation_trip_tenant_fk",
          "trip_checkins_passenger_reservation_fk",
        ]],
      );
      expect(validatedConstraints.rows).toEqual([
        { conname: "reservations_trip_tenant_fk", convalidated: true },
        { conname: "trip_checkins_passenger_reservation_fk", convalidated: true },
        { conname: "trip_checkins_reservation_trip_tenant_fk", convalidated: true },
        { conname: "trip_checkins_trip_tenant_fk", convalidated: true },
      ]);
      const migrationIndexes = await client.query<{ relname: string }>(
        `SELECT relname
           FROM pg_class
          WHERE relnamespace = pg_my_temp_schema()
            AND relkind = 'i'
            AND relname = ANY($1::text[])
          ORDER BY relname`,
        [[
          "trips_id_tenant_id_unique",
          "reservations_id_trip_tenant_unique",
          "passengers_id_reservation_unique",
        ]],
      );
      expect(migrationIndexes.rows).toEqual([
        { relname: "passengers_id_reservation_unique" },
        { relname: "reservations_id_trip_tenant_unique" },
        { relname: "trips_id_tenant_id_unique" },
      ]);
      const resolvedReservations = await client.query(
        `SELECT id, trip_id, tenant_id
           FROM pg_temp.reservations
          WHERE id IN ('reservation-a', 'reservation-b', 'reservation-c', 'reservation-d')
          ORDER BY id`,
      );
      expect(resolvedReservations.rows).toEqual([
        { id: "reservation-a", trip_id: "trip-a", tenant_id: "tenant-a" },
        { id: "reservation-b", trip_id: "trip-b", tenant_id: "tenant-b" },
        { id: "reservation-c", trip_id: "missing-trip", tenant_id: "tenant-a" },
        { id: "reservation-d", trip_id: "trip-a", tenant_id: "tenant-a" },
      ]);
      const migratedCheckin = await client.query(
        "SELECT reservation_id FROM pg_temp.trip_checkins WHERE id = 'legacy-checkin'",
      );
      expect(migratedCheckin.rows).toEqual([{ reservation_id: "reservation-a" }]);

      await seedScratchTables({ passengerId: "passenger-a", reservationId: null });
      await client.query(
        "UPDATE pg_temp.reservations SET tenant_id = 'tenant-b' WHERE id = 'reservation-a'",
      );
      const initialAttemptError = await runMigration();
      expect(initialAttemptError).toMatchObject({
        code: "P0001",
        message: expect.stringContaining(
          "1 reservations reference a trip from another tenant or a missing trip",
        ),
      });
      const unchangedBeforeCorrection = await client.query(
        `SELECT r.trip_id, r.tenant_id, c.reservation_id
           FROM pg_temp.reservations r
           CROSS JOIN pg_temp.trip_checkins c
          WHERE r.id = 'reservation-a' AND c.id = 'legacy-checkin'`,
      );
      expect(unchangedBeforeCorrection.rows).toEqual([{
        trip_id: "trip-a",
        tenant_id: "tenant-b",
        reservation_id: null,
      }]);
      await expectRejectedMigrationLeftSchemaUnchanged();

      await client.query(
        "UPDATE pg_temp.reservations SET tenant_id = 'tenant-a' WHERE id = 'reservation-a'",
      );
      expect(await runMigration()).toBeNull();
      const repairedAndMigrated = await client.query(
        `SELECT r.trip_id, r.tenant_id, c.reservation_id
           FROM pg_temp.reservations r
           CROSS JOIN pg_temp.trip_checkins c
          WHERE r.id = 'reservation-a' AND c.id = 'legacy-checkin'`,
      );
      expect(repairedAndMigrated.rows).toEqual([{
        trip_id: "trip-a",
        tenant_id: "tenant-a",
        reservation_id: "reservation-a",
      }]);
      await expect(client.query(
        `UPDATE pg_temp.passengers
            SET reservation_id = 'reservation-b'
          WHERE id = 'passenger-a'`,
      )).rejects.toMatchObject({
        code: "23503",
        constraint: "trip_checkins_passenger_reservation_fk",
      });
      const passengerAndCheckinAfterRejectedMove = await client.query(
        `SELECT p.id AS passenger_id,
                p.reservation_id AS passenger_reservation_id,
                c.id AS checkin_id,
                c.passenger_id AS checkin_passenger_id,
                c.reservation_id AS checkin_reservation_id
           FROM pg_temp.passengers p
           JOIN pg_temp.trip_checkins c ON c.passenger_id = p.id
          WHERE p.id = 'passenger-a' AND c.id = 'legacy-checkin'`,
      );
      expect(passengerAndCheckinAfterRejectedMove.rows).toEqual([{
        passenger_id: "passenger-a",
        passenger_reservation_id: "reservation-a",
        checkin_id: "legacy-checkin",
        checkin_passenger_id: "passenger-a",
        checkin_reservation_id: "reservation-a",
      }]);
      const reservationIsRequired = await client.query<{ attnotnull: boolean }>(
        `SELECT attnotnull
           FROM pg_attribute
          WHERE attrelid = 'pg_temp.trip_checkins'::regclass
            AND attname = 'reservation_id'
            AND NOT attisdropped`,
      );
      expect(reservationIsRequired.rows).toEqual([{ attnotnull: true }]);

      await seedScratchTables({ passengerId: "passenger-a", reservationId: null });
      await client.query(`
        ALTER TABLE pg_temp.reservations
          DROP CONSTRAINT reservations_trip_id_trips_id_fk;
        ALTER TABLE pg_temp.trip_checkins
          DROP CONSTRAINT trip_checkins_trip_id_trips_id_fk;
        UPDATE pg_temp.reservations
           SET trip_id = 'missing-trip'
         WHERE id = 'reservation-a';
        UPDATE pg_temp.trip_checkins
           SET trip_id = 'missing-trip'
         WHERE id = 'legacy-checkin';
      `);
      const missingTripAttemptError = await runMigration();
      expect(missingTripAttemptError).toMatchObject({
        code: "P0001",
        message: expect.stringContaining(
          "1 reservations reference a trip from another tenant or a missing trip",
        ),
      });
      const legacyCheckinAfterFailure = await client.query(
        `SELECT r.trip_id AS reservation_trip_id,
                c.trip_id AS checkin_trip_id,
                c.reservation_id
           FROM pg_temp.reservations r
           CROSS JOIN pg_temp.trip_checkins c
          WHERE r.id = 'reservation-a' AND c.id = 'legacy-checkin'`,
      );
      expect(legacyCheckinAfterFailure.rows).toEqual([{
        reservation_trip_id: "missing-trip",
        checkin_trip_id: "missing-trip",
        reservation_id: null,
      }]);
      await expectRejectedMigrationLeftSchemaUnchanged();

      await client.query(
        "INSERT INTO pg_temp.trips (id, tenant_id) VALUES ('missing-trip', 'tenant-a')",
      );
      expect(await runMigration()).toBeNull();
      const backfilledAfterTripRestore = await client.query(
        `SELECT r.trip_id AS reservation_trip_id,
                r.tenant_id AS reservation_tenant_id,
                c.trip_id AS checkin_trip_id,
                c.reservation_id
           FROM pg_temp.reservations r
           CROSS JOIN pg_temp.trip_checkins c
          WHERE r.id = 'reservation-a' AND c.id = 'legacy-checkin'`,
      );
      expect(backfilledAfterTripRestore.rows).toEqual([{
        reservation_trip_id: "missing-trip",
        reservation_tenant_id: "tenant-a",
        checkin_trip_id: "missing-trip",
        reservation_id: "reservation-a",
      }]);
      const validatedConstraintCount = await client.query<{
        constraint_count: number;
        all_validated: boolean;
      }>(
        `SELECT COUNT(*)::int AS constraint_count,
                BOOL_AND(convalidated) AS all_validated
           FROM pg_constraint
          WHERE connamespace = pg_my_temp_schema()
            AND conname = ANY($1::text[])`,
        [[
          "reservations_trip_tenant_fk",
          "trip_checkins_trip_tenant_fk",
          "trip_checkins_reservation_trip_tenant_fk",
          "trip_checkins_passenger_reservation_fk",
        ]],
      );
      expect(validatedConstraintCount.rows).toEqual([{
        constraint_count: 4,
        all_validated: true,
      }]);

      await expect(client.query(
        `INSERT INTO pg_temp.reservations (id, trip_id, tenant_id)
         VALUES ('cross-agency-reservation', 'trip-a', 'tenant-b')`,
      )).rejects.toMatchObject({ code: "23503" });
      await expect(client.query(
        `INSERT INTO pg_temp.trip_checkins
          (id, trip_id, tenant_id, passenger_id, reservation_id)
         VALUES ('cross-trip-checkin', 'trip-b', 'tenant-b', 'passenger-a', 'reservation-a')`,
      )).rejects.toMatchObject({ code: "23503" });
      // Match reservation B's trip and tenant so only the passenger↔reservation
      // relationship is invalid.
      await expect(client.query(
        `INSERT INTO pg_temp.trip_checkins
          (id, trip_id, tenant_id, passenger_id, reservation_id)
         VALUES ('cross-reservation-passenger-checkin',
                 'trip-b', 'tenant-b', 'passenger-a', 'reservation-b')`,
      )).rejects.toMatchObject({ code: "23503" });

      await expect(client.query(
        `UPDATE pg_temp.reservations
            SET trip_id = 'trip-b',
                tenant_id = 'tenant-b'
          WHERE id = 'reservation-a'`,
      )).rejects.toMatchObject({ code: "23503" });
      await expect(client.query(
        `UPDATE pg_temp.trip_checkins
            SET reservation_id = 'reservation-b'
          WHERE id = 'legacy-checkin'`,
      )).rejects.toMatchObject({ code: "23503" });

      const validRowsAfterRejectedWrites = await client.query(
        `SELECT r.id AS reservation_id,
                r.trip_id AS reservation_trip_id,
                r.tenant_id AS reservation_tenant_id,
                c.id AS checkin_id,
                c.trip_id AS checkin_trip_id,
                c.tenant_id AS checkin_tenant_id,
                c.passenger_id,
                c.reservation_id AS checkin_reservation_id,
                (SELECT trip_id FROM pg_temp.reservations WHERE id = 'reservation-b')
                  AS reservation_b_trip_id,
                (SELECT tenant_id FROM pg_temp.reservations WHERE id = 'reservation-b')
                  AS reservation_b_tenant_id,
                (SELECT reservation_id FROM pg_temp.passengers WHERE id = 'passenger-a')
                  AS passenger_a_reservation_id,
                (SELECT reservation_id FROM pg_temp.passengers WHERE id = 'passenger-b')
                  AS passenger_b_reservation_id
           FROM pg_temp.reservations r
           CROSS JOIN pg_temp.trip_checkins c
          WHERE r.id = 'reservation-a' AND c.id = 'legacy-checkin'`,
      );
      expect(validRowsAfterRejectedWrites.rows).toEqual([{
        reservation_id: "reservation-a",
        reservation_trip_id: "missing-trip",
        reservation_tenant_id: "tenant-a",
        checkin_id: "legacy-checkin",
        checkin_trip_id: "missing-trip",
        checkin_tenant_id: "tenant-a",
        passenger_id: "passenger-a",
        checkin_reservation_id: "reservation-a",
        reservation_b_trip_id: "trip-b",
        reservation_b_tenant_id: "tenant-b",
        passenger_a_reservation_id: "reservation-a",
        passenger_b_reservation_id: "reservation-b",
      }]);
      const rejectedRows = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM pg_temp.reservations
             WHERE id = 'cross-agency-reservation') AS invalid_reservations,
           (SELECT COUNT(*)::int FROM pg_temp.trip_checkins
              WHERE id IN (
                'cross-trip-checkin',
                'cross-reservation-passenger-checkin'
              )) AS invalid_checkins`,
      );
      expect(rejectedRows.rows).toEqual([{
        invalid_reservations: 0,
        invalid_checkins: 0,
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

  it("cascades reservation deletion to its check-ins without deleting trips or passengers", async () => {
    if (!process.env["DATABASE_URL"]) {
      throw new Error("DATABASE_URL must point to an isolated integration-test database");
    }

    const client = await pool.connect();
    const suffix = generateId();
    const ids = {
      tenant: `cascade-tenant-${suffix}`,
      tripA: `cascade-trip-a-${suffix}`,
      tripB: `cascade-trip-b-${suffix}`,
      reservationA: `cascade-reservation-a-${suffix}`,
      reservationB: `cascade-reservation-b-${suffix}`,
      passengerA1: `cascade-passenger-a1-${suffix}`,
      passengerA2: `cascade-passenger-a2-${suffix}`,
      passengerB: `cascade-passenger-b-${suffix}`,
      checkinA1: `cascade-checkin-a1-${suffix}`,
      checkinA2: `cascade-checkin-a2-${suffix}`,
      checkinB: `cascade-checkin-b-${suffix}`,
    };

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO pg_temp, public");
      await client.query(`
        CREATE TEMP TABLE tenants (id text PRIMARY KEY);
        CREATE TEMP TABLE trips (
          id text PRIMARY KEY,
          tenant_id text NOT NULL
        );
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
          reservation_id text NOT NULL
        );
      `);

      await client.query(tripTenantMigration);

      await client.query("INSERT INTO tenants (id) VALUES ($1)", [ids.tenant]);
      await client.query(
        "INSERT INTO trips (id, tenant_id) VALUES ($1, $3), ($2, $3)",
        [ids.tripA, ids.tripB, ids.tenant],
      );
      await client.query(
        `INSERT INTO reservations (id, trip_id, tenant_id)
         VALUES ($1, $2, $4), ($3, $5, $4)`,
        [ids.reservationA, ids.tripA, ids.reservationB, ids.tenant, ids.tripB],
      );
      await client.query(
        `INSERT INTO passengers (id, reservation_id)
         VALUES ($1, $4), ($2, $4), ($3, $5)`,
        [ids.passengerA1, ids.passengerA2, ids.passengerB, ids.reservationA, ids.reservationB],
      );
      await client.query(
        `INSERT INTO trip_checkins
          (id, trip_id, tenant_id, passenger_id, reservation_id)
         VALUES
          ($1, $2, $6, $3, $5),
          ($4, $2, $6, $7, $5),
          ($8, $9, $6, $10, $11)`,
        [
          ids.checkinA1, ids.tripA, ids.passengerA1, ids.checkinA2,
          ids.reservationA, ids.tenant, ids.passengerA2, ids.checkinB,
          ids.tripB, ids.passengerB, ids.reservationB,
        ],
      );

      await client.query("DELETE FROM reservations WHERE id = $1", [ids.reservationA]);

      const remainingCheckins = await client.query(
        "SELECT id, reservation_id FROM trip_checkins ORDER BY id",
      );
      expect(remainingCheckins.rows).toEqual([
        { id: ids.checkinB, reservation_id: ids.reservationB },
      ]);

      const remainingParents = await client.query(
        `SELECT
           (SELECT array_agg(id ORDER BY id) FROM trips) AS trip_ids,
           (SELECT array_agg(id ORDER BY id) FROM passengers) AS passenger_ids,
           (SELECT array_agg(id ORDER BY id) FROM reservations) AS reservation_ids`,
      );
      expect(remainingParents.rows).toEqual([{
        trip_ids: [ids.tripA, ids.tripB].sort(),
        passenger_ids: [ids.passengerA1, ids.passengerA2, ids.passengerB].sort(),
        reservation_ids: [ids.reservationB],
      }]);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});

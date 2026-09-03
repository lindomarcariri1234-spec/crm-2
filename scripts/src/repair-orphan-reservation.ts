/**
 * Repairs one active reservation left without a client by the old deletion flow.
 *
 * Safe preview (default):
 *   pnpm --filter @workspace/scripts run repair:orphan-reservation -- \
 *     --tenant-id=<tenant> --reservation-number=VSITE-BTV-202609-00009 --dry-run
 *
 * Apply the same explicitly selected reservation:
 *   ... --tenant-id=<tenant> --reservation-number=... --apply
 *
 * The tenant and exactly one reservation identifier are mandatory. The script
 * never searches or changes data across tenants and is idempotent. A successful
 * application also writes an audit_logs row; the reservation itself is never
 * deleted.
 */

import { randomUUID } from "node:crypto";
import { auditLogsTable, db, pool, reservationsTable, tripsTable } from "@workspace/db";
import { ACTIVE_RESERVATION_STATUSES, RESERVATION_STATUS } from "@workspace/permissions";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

function argument(name: string): string | undefined {
  return process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

const tenantId = argument("--tenant-id")?.trim();
const reservationId = argument("--reservation-id")?.trim();
const reservationNumber = argument("--reservation-number")?.trim();
const apply = process.argv.includes("--apply");

type RepairResult = {
  status: "dry-run" | "repaired" | "already-repaired" | "not-found";
  tenantId: string;
  reservationId: string | null;
  reservationNumber: string | null;
  previousReservationStatus: string | null;
  reservationStatus: string | null;
  releasedSeats: number;
  reservationPreserved: boolean;
  auditLogWritten: boolean;
};

function printResult(result: RepairResult): void {
  // Keep one machine-readable line in the deployment log without ever
  // including DATABASE_URL or any other environment variable.
  console.log(`REPAIR_RESULT ${JSON.stringify(result)}`);
}

async function main(): Promise<void> {
  if (!tenantId) throw new Error("Informe --tenant-id=<tenant>. O reparo nunca pesquisa entre tenants.");
  if ((reservationId && reservationNumber) || (!reservationId && !reservationNumber)) {
    throw new Error("Informe exatamente um identificador: --reservation-id=<id> ou --reservation-number=<numero>.");
  }

  const identifier = reservationId
    ? eq(reservationsTable.id, reservationId)
    : eq(reservationsTable.reservationNumber, reservationNumber!);

  const [candidate] = await db.select({
    id: reservationsTable.id,
    reservationNumber: reservationsTable.reservationNumber,
    tripId: reservationsTable.tripId,
    status: reservationsTable.status,
    seats: reservationsTable.seats,
  })
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.tenantId, tenantId),
      isNull(reservationsTable.clientId),
      inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
      identifier,
    ))
    .limit(1);

  if (!candidate) {
    console.log(`Nenhuma reserva órfã ativa encontrada no tenant ${tenantId}. Nenhuma alteração foi feita.`);
    printResult({
      status: "not-found",
      tenantId,
      reservationId: reservationId ?? null,
      reservationNumber: reservationNumber ?? null,
      previousReservationStatus: null,
      reservationStatus: null,
      releasedSeats: 0,
      reservationPreserved: false,
      auditLogWritten: false,
    });
    return;
  }

  const row = candidate;
  const seats = row.seats?.length ?? 0;
  console.log(`=== Reparo de reserva órfã (${apply ? "APLICAR" : "DRY-RUN"}) ===`);
  console.log(`Tenant: ${tenantId}`);
  console.log(`Reserva: ${row.reservationNumber ?? row.id} | status=${row.status} | viagem=${row.tripId} | assentos=${seats}`);

  if (!apply) {
    console.log("Nenhuma alteração foi feita. Reexecute com --apply para cancelar operacionalmente e liberar a capacidade.");
    printResult({
      status: "dry-run",
      tenantId,
      reservationId: row.id,
      reservationNumber: row.reservationNumber,
      previousReservationStatus: row.status,
      reservationStatus: row.status,
      releasedSeats: seats,
      reservationPreserved: true,
      auditLogWritten: false,
    });
    return;
  }

  const result = await db.transaction<RepairResult>(async (tx) => {
    const [locked] = await tx.select({
      id: reservationsTable.id,
      reservationNumber: reservationsTable.reservationNumber,
      tripId: reservationsTable.tripId,
      status: reservationsTable.status,
      seats: reservationsTable.seats,
    })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.id, row.id),
        eq(reservationsTable.tenantId, tenantId),
        isNull(reservationsTable.clientId),
        inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
      ))
      .for("update");

    if (!locked) {
      console.log("Reserva já foi corrigida ou deixou de ser órfã; nenhuma alteração foi feita.");
      return {
        status: "already-repaired",
        tenantId,
        reservationId: row.id,
        reservationNumber: row.reservationNumber,
        previousReservationStatus: row.status,
        reservationStatus: null,
        releasedSeats: 0,
        reservationPreserved: true,
        auditLogWritten: false,
      };
    }

    const lockedSeats = locked.seats?.length ?? 0;
    const [updatedReservation] = await tx.update(reservationsTable)
      .set({ status: RESERVATION_STATUS.CANCELLED, cancelledAt: new Date() })
      .where(and(
        eq(reservationsTable.id, locked.id),
        eq(reservationsTable.tenantId, tenantId),
        isNull(reservationsTable.clientId),
        inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
      ))
      .returning({ id: reservationsTable.id, status: reservationsTable.status });

    if (!updatedReservation) {
      return {
        status: "already-repaired",
        tenantId,
        reservationId: row.id,
        reservationNumber: row.reservationNumber,
        previousReservationStatus: row.status,
        reservationStatus: null,
        releasedSeats: 0,
        reservationPreserved: true,
        auditLogWritten: false,
      };
    }

    if (lockedSeats > 0) {
      await tx.update(tripsTable)
        .set({
          availableSeats: sql`LEAST(total_capacity, GREATEST(0, available_seats + ${lockedSeats}))`,
          ...(locked.status === RESERVATION_STATUS.CONFIRMED
            ? { confirmedSeats: sql`GREATEST(0, confirmed_seats - ${lockedSeats})` }
            : { reservedSeats: sql`GREATEST(0, reserved_seats - ${lockedSeats})` }),
        })
        .where(and(eq(tripsTable.id, locked.tripId), eq(tripsTable.tenantId, tenantId)));
    }

    await tx.insert(auditLogsTable).values({
      id: randomUUID(),
      tenantId,
      userId: null,
      action: "repair_orphan_reservation",
      entityType: "reservation",
      entityId: locked.id,
      before: {
        status: locked.status,
        clientId: null,
        seats: locked.seats,
      },
      after: {
        status: RESERVATION_STATUS.CANCELLED,
        clientId: null,
        seats: locked.seats,
        releasedSeats: lockedSeats,
        reservationPreserved: true,
        source: "production_one_shot_repair",
      },
    });

    return {
      status: "repaired",
      tenantId,
      reservationId: updatedReservation.id,
      reservationNumber: locked.reservationNumber,
      previousReservationStatus: locked.status,
      reservationStatus: updatedReservation.status,
      releasedSeats: lockedSeats,
      reservationPreserved: true,
      auditLogWritten: true,
    };
  });

  console.log(`Reserva ${row.reservationNumber ?? row.id} cancelada operacionalmente; histórico preservado.`);
  printResult(result);
}

main()
  .catch((error) => {
    console.error("repair-orphan-reservation falhou:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
/**
 * list-duplicate-reservations.ts
 *
 * Read-only diagnostic script that lists every group of 2+ active reservations
 * sharing the same (tenant_id, client_id, trip_id).  Does NOT delete or modify
 * any data — remediation must be done manually via the CRM UI.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run list:duplicate-reservations
 */

import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

interface DuplicateGroup {
  tenantId: string;
  clientId: string;
  tripId: string;
  reservationCount: number;
  reservationNumbers: string[];
  reservationIds: string[];
  statuses: string[];
}

async function main() {
  const crmBaseUrl = (process.env.APP_URL ?? "https://visitecrm.replit.app").replace(/\/$/, "");
  console.log("=== Diagnóstico: Reservas Duplicadas ===\n");

  const rows = await db.execute<{
    tenant_id: string;
    client_id: string;
    trip_id: string;
    reservation_count: number;
    reservation_numbers: string[];
    reservation_ids: string[];
    statuses: string[];
  }>(sql`
    SELECT
      r.tenant_id,
      r.client_id,
      r.trip_id,
      COUNT(*)::int AS reservation_count,
      ARRAY_AGG(COALESCE(r.reservation_number, r.id) ORDER BY r.created_at ASC) AS reservation_numbers,
      ARRAY_AGG(r.id ORDER BY r.created_at ASC) AS reservation_ids,
      ARRAY_AGG(r.status ORDER BY r.created_at ASC) AS statuses
    FROM reservations r
    WHERE r.status NOT IN ('cancelled', 'refunded')
      AND r.client_id IS NOT NULL
    GROUP BY r.tenant_id, r.client_id, r.trip_id
    HAVING COUNT(*) > 1
    ORDER BY r.tenant_id, COUNT(*) DESC
  `);

  const groups: DuplicateGroup[] = rows.rows.map(r => ({
    tenantId: r.tenant_id,
    clientId: r.client_id,
    tripId: r.trip_id,
    reservationCount: r.reservation_count,
    reservationNumbers: r.reservation_numbers,
    reservationIds: r.reservation_ids,
    statuses: r.statuses,
  }));

  if (groups.length === 0) {
    console.log("✅ Nenhuma duplicata encontrada. Todas as reservas ativas são únicas.");
    return;
  }

  console.log(`⚠️  ${groups.length} grupo(s) de reservas duplicadas encontrado(s):\n`);

  let totalDuplicates = 0;

  for (const group of groups) {
    console.log(`  Tenant:  ${group.tenantId}`);
    console.log(`  Cliente: ${group.clientId}`);
    console.log(`  Viagem:  ${group.tripId}`);
    console.log(`  Reservas (${group.reservationCount}):`);
    for (let i = 0; i < group.reservationIds.length; i++) {
      const tag = i === 0 ? "(mais antiga)" : i === group.reservationIds.length - 1 ? "(mais recente)" : "";
      const editLink = `${crmBaseUrl}/reservations/${group.reservationIds[i]}`;
      console.log(`    [${i + 1}] ${group.reservationNumbers[i]}  status=${group.statuses[i]}  id=${group.reservationIds[i]} ${tag}`);
      console.log(`         🔗 ${editLink}`);
    }
    console.log();
    totalDuplicates += group.reservationCount - 1;
  }

  console.log("=== Resumo ===");
  console.log(`  Grupos com duplicatas: ${groups.length}`);
  console.log(`  Reservas excedentes:   ${totalDuplicates}`);
  console.log("\nAção necessária: cancele as reservas duplicadas manualmente via CRM (aba Reservas → cancelar a reserva mais antiga ou a indesejada).");
}

main()
  .catch(err => {
    console.error("list-duplicate-reservations falhou:", err);
    process.exit(1);
  })
  .finally(() => pool.end());

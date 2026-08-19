/**
 * cleanup-pipeline-duplicate-leads.ts
 *
 * One-time idempotent script to remove duplicate Pipeline deal cards created by
 * a bug (now fixed). The bug caused the "Novo Cliente" form to create two deals
 * for every client+trip reservation:
 *   1. Backend syncClientDeal  → deal in "Reserva Criada"
 *   2. Frontend createDeal     → deal in "Lead"
 *
 * Strategy: for each group of 2+ open deals sharing the same
 * (clientId, tripId, tenantId), keep the deal in the MOST ADVANCED stage
 * (highest pipelineStages.order; ties broken by earliest createdAt so the
 * original/backend-created deal wins when two deals share the same stage) and
 * hard-delete the rest.
 *
 * Safe to re-run — already-cleaned groups produce zero deletions.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run cleanup:pipeline-duplicate-leads
 *   pnpm --filter @workspace/scripts run cleanup:pipeline-duplicate-leads -- --dry-run
 */

import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

interface DuplicateGroup {
  clientId: string;
  tripId: string;
  tenantId: string;
  dealCount: number;
  dealIds: string[];       // ordered by (stage.order ASC, deal.createdAt DESC) → worst first, keeper last (earliest createdAt among top stage)
  stageNames: string[];
  stageOrders: number[];
}

async function main() {
  if (DRY_RUN) {
    console.log("=== MODO DRY-RUN — nenhuma alteração será feita ===\n");
  }
  console.log("=== Limpeza de deals duplicados no Pipeline ===\n");

  // Find all groups of 2+ open deals with the same (clientId, tripId, tenantId).
  // Tie-break equal stage.order by deal.created_at ASC so the keeper (last in array)
  // is always the earliest-created deal among those in the most-advanced stage —
  // deterministic across runs.
  const rows = await db.execute<{
    client_id: string;
    trip_id: string;
    tenant_id: string;
    deal_count: number;
    deal_ids: string[];
    stage_names: string[];
    stage_orders: number[];
  }>(sql`
    SELECT
      d.client_id,
      d.trip_id,
      d.tenant_id,
      COUNT(*)::int                                                                     AS deal_count,
      ARRAY_AGG(d.id       ORDER BY ps."order" ASC, d.created_at DESC, d.id ASC)       AS deal_ids,
      ARRAY_AGG(ps.name    ORDER BY ps."order" ASC, d.created_at DESC, d.id ASC)       AS stage_names,
      ARRAY_AGG(ps."order" ORDER BY ps."order" ASC, d.created_at DESC, d.id ASC)       AS stage_orders
    FROM deals d
    JOIN pipeline_stages ps ON ps.id = d.stage_id
    WHERE
      d.status    = 'open'
      AND d.client_id IS NOT NULL
      AND d.trip_id   IS NOT NULL
    GROUP BY d.client_id, d.trip_id, d.tenant_id
    HAVING COUNT(*) > 1
  `);

  const groups: DuplicateGroup[] = rows.rows.map(r => ({
    clientId:    r.client_id,
    tripId:      r.trip_id,
    tenantId:    r.tenant_id,
    dealCount:   r.deal_count,
    dealIds:     r.deal_ids,
    stageNames:  r.stage_names,
    stageOrders: r.stage_orders,
  }));

  if (groups.length === 0) {
    console.log("Nenhum grupo de deals duplicados encontrado. Pipeline já está limpo.");
    return;
  }

  console.log(`Grupos duplicados encontrados: ${groups.length}\n`);

  let totalDeleted = 0;

  for (const group of groups) {
    // The last element in each array is the most-advanced deal (keeper).
    const keepId    = group.dealIds[group.dealIds.length - 1];
    const keepStage = group.stageNames[group.stageNames.length - 1];
    const toDelete  = group.dealIds.slice(0, -1);

    console.log(
      `  clientId=${group.clientId}  tripId=${group.tripId}  tenant=${group.tenantId}`
    );
    console.log(
      `    Mantendo  deal ${keepId} (estágio: "${keepStage}")`
    );

    for (let i = 0; i < toDelete.length; i++) {
      const delId    = toDelete[i];
      const delStage = group.stageNames[i];
      const action   = DRY_RUN ? "[DRY-RUN] Removeria" : "Removendo";
      console.log(`    ${action} deal ${delId} (estágio: "${delStage}")`);
    }

    if (!DRY_RUN) {
      const idsLiteral = sql.join(
        toDelete.map(id => sql`${id}`),
        sql`, `
      );
      await db.execute(sql`
        DELETE FROM deals
        WHERE id IN (${idsLiteral})
          AND tenant_id = ${group.tenantId}
      `);
      console.log(`    ✅ ${toDelete.length} deal(s) removido(s)\n`);
    } else {
      console.log(`    [DRY-RUN] ${toDelete.length} deal(s) seriam removidos\n`);
    }

    totalDeleted += toDelete.length;
  }

  console.log("=== Resumo ===");
  console.log(`  Grupos de duplicatas processados: ${groups.length}`);
  if (DRY_RUN) {
    console.log(`  Deals que seriam removidos:      ${totalDeleted}`);
    console.log(`  Deals que seriam mantidos:       ${groups.length}`);
    console.log("\nRe-execute sem --dry-run para aplicar as remoções.");
  } else {
    console.log(`  Deals removidos:                 ${totalDeleted}`);
    console.log(`  Deals mantidos (mais avançados): ${groups.length}`);
  }
}

main()
  .catch(err => {
    console.error("cleanup-pipeline-duplicate-leads falhou:", err);
    process.exit(1);
  })
  .finally(() => pool.end());

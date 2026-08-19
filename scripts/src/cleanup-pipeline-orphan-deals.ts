/**
 * cleanup-pipeline-orphan-deals.ts
 *
 * One-time idempotent cleanup of orphaned Pipeline deal cards.
 *
 * Problem: the duplicate-deal bug created "Lead" cards without a tripId (via
 * the frontend "Novo Cliente" form). After cleanup:pipeline-duplicate-leads
 * removes duplicates where both cards have a tripId, some "Lead" cards still
 * remain as orphans — they have no tripId and therefore no reservation link.
 *
 * Strategy: for every orphaned deal (status='open', tripId IS NULL) that has
 * been updated more recently than its created_at (meaning it's stale / was never
 * linked to a trip), hard-delete it.
 *
 * Safe to re-run — if no orphans remain the script exits with "0" changes.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run cleanup:pipeline-orphan-deals
 *   pnpm --filter @workspace/scripts run cleanup:pipeline-orphan-deals -- --dry-run
 */

import { db, pool } from "@workspace/db";
import { dealsTable } from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (DRY_RUN) {
    console.log("=== MODO DRY-RUN \u2014 nenhuma altera\u00e7\u00e3o ser\u00e1 feita ===\n");
  }
  console.log("=== Limpeza de deals \u00f3rf\u00e3os no Pipeline ===\n");

  // Find orphaned deals: open, no tripId, autoCreated=true (from syncClientDeal
  // or createDeal mutation), and updated_at is older than a threshold (meaning
  // they never got linked to a reservation).
  const orphans = await db
    .select({
      id: dealsTable.id,
      tenantId: dealsTable.tenantId,
      clientId: dealsTable.clientId,
      title: dealsTable.title,
      stageId: dealsTable.stageId,
      createdAt: dealsTable.createdAt,
      updatedAt: dealsTable.updatedAt,
      source: dealsTable.source,
      autoCreated: dealsTable.autoCreated,
    })
    .from(dealsTable)
    .where(
      and(
        eq(dealsTable.status, "open"),
        isNull(dealsTable.tripId),
        eq(dealsTable.autoCreated, true),
        // Only delete deals that have been stale for > 7 days to avoid
        // removing freshly-created leads that might still get a trip linked.
        sql`${dealsTable.updatedAt} < NOW() - INTERVAL '7 days'`,
      ),
    );

  if (orphans.length === 0) {
    console.log("Nenhum deal \u00f3rf\u00e3o encontrado. Pipeline est\u00e1 limpo.");
    return;
  }

  console.log(`Deals \u00f3rf\u00e3os encontrados: ${orphans.length}\n`);

  let totalDeleted = 0;

  for (const deal of orphans) {
    const action = DRY_RUN ? "[DRY-RUN] Removeria" : "Removendo";
    console.log(
      `  ${action} deal ${deal.id} | tenant=${deal.tenantId} | client=${deal.clientId} | "${deal.title}" | criado=${deal.createdAt}`,
    );

    if (!DRY_RUN) {
      await db
        .delete(dealsTable)
        .where(
          and(
            eq(dealsTable.id, deal.id),
            eq(dealsTable.tenantId, deal.tenantId),
          ),
        );
      console.log(`    \u2705 Deal removido\n`);
      totalDeleted++;
    }
  }

  console.log("=== Resumo ===");
  if (DRY_RUN) {
    console.log(`  Deals que seriam removidos: ${orphans.length}`);
    console.log("\nRe-execute sem --dry-run para aplicar as remo\u00e7\u00f5es.");
  } else {
    console.log(`  Deals removidos: ${totalDeleted}`);
  }
}

main()
  .catch((err) => {
    console.error("cleanup-pipeline-orphan-deals falhou:", err);
    process.exit(1);
  })
  .finally(() => pool.end());

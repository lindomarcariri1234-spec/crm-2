import { db, pool, referralsTable } from "@workspace/db";
import { isNull, and, eq, isNotNull, sql } from "drizzle-orm";

const REFERRAL_STATUS_COMPLETED = "completed";

async function main() {
  console.log("=== Backfill: referrals.source ===\n");

  // Only touch completed rows whose source is still NULL (idempotent).
  const pending = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(referralsTable)
    .where(
      and(
        eq(referralsTable.status, REFERRAL_STATUS_COMPLETED),
        isNull(referralsTable.source),
      ),
    );

  const total = pending[0]?.count ?? 0;

  if (total === 0) {
    console.log("Nenhum registro para corrigir. Tudo já está preenchido.");
    return;
  }

  console.log(`Total de indicações 'completed' sem source: ${total}\n`);

  // Completed rows WITH a reservation_id originated in the CRM.
  const crmResult = await db
    .update(referralsTable)
    .set({ source: "crm" })
    .where(
      and(
        eq(referralsTable.status, REFERRAL_STATUS_COMPLETED),
        isNull(referralsTable.source),
        isNotNull(referralsTable.reservationId),
      ),
    )
    .returning({ id: referralsTable.id });

  // Completed rows WITHOUT a reservation_id originated in the store.
  const storeResult = await db
    .update(referralsTable)
    .set({ source: "store" })
    .where(
      and(
        eq(referralsTable.status, REFERRAL_STATUS_COMPLETED),
        isNull(referralsTable.source),
        isNull(referralsTable.reservationId),
      ),
    )
    .returning({ id: referralsTable.id });

  console.log("\n=== Resumo ===");
  console.log(`  Marcados como 'crm' (com reservation_id):   ${crmResult.length}`);
  console.log(`  Marcados como 'store' (sem reservation_id): ${storeResult.length}`);
  console.log(`  Total atualizados:                          ${crmResult.length + storeResult.length}`);
}

main()
  .catch((err) => {
    console.error("backfill-referral-source falhou:", err);
    process.exit(1);
  })
  .finally(() => pool.end());

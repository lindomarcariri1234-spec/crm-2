import { db, pool, referralsTable, reservationsTable } from "@workspace/db";
import { isNull, eq, and, inArray } from "drizzle-orm";

const BATCH_SIZE = 100;
const REFERRAL_STATUS_COMPLETED = "completed";

async function main() {
  console.log("=== Backfill: referrals.reservation_id ===\n");

  // Fetch all completed referrals without a reservation_id
  const unlinked = await db
    .select({
      id: referralsTable.id,
      tenantId: referralsTable.tenantId,
      code: referralsTable.code,
      referredId: referralsTable.referredId,
    })
    .from(referralsTable)
    .where(
      and(
        isNull(referralsTable.reservationId),
        eq(referralsTable.status, REFERRAL_STATUS_COMPLETED),
      ),
    );

  if (unlinked.length === 0) {
    console.log("Nenhum registro para corrigir. Tudo já está preenchido.");
    return;
  }

  console.log(`Total de indicações 'completed' sem reservation_id: ${unlinked.length}`);

  // Split into matchable (have referredId) vs guests (no referredId)
  const matchable = unlinked.filter((r) => r.referredId !== null);
  const guests    = unlinked.filter((r) => r.referredId === null);

  console.log(`  → Com referred_id (recuperáveis): ${matchable.length}`);
  console.log(`  → Sem referred_id (convidados, irrecuperáveis): ${guests.length}\n`);

  if (guests.length > 0) {
    console.log("⚠️  Limitação conhecida — indicações de convidados sem clientId (sem alteração):");
    for (const g of guests) {
      console.log(`     id=${g.id}  code=${g.code}  tenantId=${g.tenantId}`);
    }
    console.log();
  }

  let fixed = 0;
  let notFound = 0;

  // Process matchable records in batches
  for (let offset = 0; offset < matchable.length; offset += BATCH_SIZE) {
    const batch = matchable.slice(offset, offset + BATCH_SIZE);

    for (const referral of batch) {
      // Look up the reservation by discount_referral_code + client_id (same logic as the API fallback)
      const [reservation] = await db
        .select({ id: reservationsTable.id })
        .from(reservationsTable)
        .where(
          and(
            eq(reservationsTable.tenantId, referral.tenantId),
            eq(reservationsTable.discountReferralCode, referral.code),
            eq(reservationsTable.clientId, referral.referredId!),
          ),
        )
        .limit(1);

      if (reservation) {
        await db
          .update(referralsTable)
          .set({ reservationId: reservation.id })
          .where(eq(referralsTable.id, referral.id));
        fixed++;
        console.log(`✓ ${referral.id}  →  reservation_id=${reservation.id}`);
      } else {
        notFound++;
        console.log(`✗ ${referral.id}  (code=${referral.code}, referredId=${referral.referredId}) — nenhuma reserva encontrada`);
      }
    }
  }

  console.log("\n=== Resumo ===");
  console.log(`  Corrigidos:                   ${fixed}`);
  console.log(`  Sem reserva correspondente:   ${notFound}`);
  console.log(`  Convidados (irrecuperáveis):  ${guests.length}`);
  console.log(`  Total analisados:             ${unlinked.length}`);
}

main()
  .catch((err) => {
    console.error("backfill-referral-reservation-id falhou:", err);
    process.exit(1);
  })
  .finally(() => pool.end());

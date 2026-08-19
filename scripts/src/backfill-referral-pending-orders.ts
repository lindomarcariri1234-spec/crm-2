/**
 * One-time idempotent backfill: insert PENDING referral rows for store_orders
 * that were placed with a referral code BEFORE the checkout fix was deployed.
 *
 * Before the fix, no row was written to the `referrals` table at checkout time —
 * only the `pending_referral` JSON was stored on the order. The actual referral
 * row was only inserted (as COMPLETED) when payment was confirmed. This meant the
 * referral was invisible to both the agency panel and the referrer's client portal
 * until payment arrived.
 *
 * This script:
 *   1. Finds orders where pending_referral IS NOT NULL, referral_effects_applied_at
 *      IS NULL, payment_status != 'paid', AND pending_referral->>'referralId' IS NULL
 *      (the last condition is the idempotency guard — orders already processed have
 *      a referralId stored in the JSON).
 *   2. For each such order, inserts a PENDING referral row and back-patches the
 *      pendingReferral JSON with the new referralId so that applyDeferredOrderCredits
 *      (triggered at payment confirmation) will UPDATE the row instead of inserting
 *      a duplicate.
 *
 * Safe to re-run: already-backfilled orders are skipped by the referralId IS NULL guard.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill:referral-pending-orders
 */

import { db, pool, referralsTable, storeOrdersTable } from "@workspace/db";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { REFERRAL_STATUS, STORE_PAYMENT_STATUS } from "@workspace/permissions";
import { randomUUID } from "node:crypto";

function generateBackfillId(): string {
  return randomUUID().replace(/-/g, "");
}

async function main() {
  console.log("=== Backfill: indicações pendentes (store_orders → referrals) ===\n");
  console.log("Procurando pedidos com código de indicação aplicado, sem linha na tabela referrals...\n");

  const orders = await db
    .select({
      id: storeOrdersTable.id,
      tenantId: storeOrdersTable.tenantId,
      customerEmail: storeOrdersTable.customerEmail,
      customerName: storeOrdersTable.customerName,
      ipAddress: storeOrdersTable.ipAddress,
      pendingReferral: storeOrdersTable.pendingReferral,
    })
    .from(storeOrdersTable)
    .where(
      and(
        isNotNull(storeOrdersTable.pendingReferral),
        isNull(storeOrdersTable.referralEffectsAppliedAt),
        ne(storeOrdersTable.paymentStatus, STORE_PAYMENT_STATUS.PAID),
        // Idempotency guard: skip orders that already have a referralId in the JSON
        // (i.e. they were created after the checkout fix, or were already backfilled).
        sql`(${storeOrdersTable.pendingReferral}->>'referralId') IS NULL`,
      ),
    );

  if (orders.length === 0) {
    console.log("Nenhum pedido para corrigir. Ou não há pedidos com código de indicação aguardando pagamento,");
    console.log("ou todos já foram processados pela nova lógica de checkout.");
    return;
  }

  console.log(`Encontrado(s) ${orders.length} pedido(s) para processar:\n`);

  let inserted = 0;
  let skipped = 0;

  for (const order of orders) {
    const ref = order.pendingReferral;

    if (!ref || !ref.code || !ref.referrerId) {
      console.log(`  [IGNORADO] Pedido ${order.id}: pendingReferral malformado ou incompleto`);
      skipped++;
      continue;
    }

    const referralId = generateBackfillId();

    try {
      await db.transaction(async (tx) => {
        await tx.insert(referralsTable).values({
          id: referralId,
          tenantId: order.tenantId,
          referrerId: ref.referrerId,
          code: ref.code,
          status: REFERRAL_STATUS.PENDING,
          source: "store",
          referredEmail: order.customerEmail,
          referredName: order.customerName,
          discountApplied: true,
          discountValue: String(ref.discountValue ?? 0),
          discountType: ref.discountType ?? "percentage",
          // discountAmount is the actual monetary value deducted — we don't store
          // this separately on the order JSON, so we leave it as 0 here. The full
          // conversion (with bonusAmount, tier, loyaltyPoints) will be filled in
          // by applyDeferredOrderCredits at payment confirmation time.
          discountAmount: "0",
          bonusAmount: "0",
          ...(ref.cookieId ? { cookieId: ref.cookieId } : {}),
          ...(order.ipAddress ? { ipAddress: order.ipAddress } : {}),
        });

        // Back-patch the order JSON so applyDeferredOrderCredits knows to UPDATE
        // this row (instead of inserting a duplicate) when payment arrives.
        await tx
          .update(storeOrdersTable)
          .set({
            pendingReferral: { ...ref, referralId },
          })
          .where(eq(storeOrdersTable.id, order.id));
      });

      console.log(`  [OK] Pedido ${order.id} → referral ${referralId} (código: ${ref.code}, indicador: ${ref.referrerId})`);
      inserted++;
    } catch (err) {
      console.error(`  [ERRO] Pedido ${order.id}: falha ao inserir referral —`, err);
      skipped++;
    }
  }

  console.log("\n=== Resumo ===");
  console.log(`  Indicações inseridas como 'pending': ${inserted}`);
  console.log(`  Pedidos ignorados / com erro:        ${skipped}`);
  console.log(`  Total processados:                   ${orders.length}`);

  if (inserted > 0) {
    console.log("\nAs indicações agora aparecem como 'Pendente' no painel da agência e no portal do indicador.");
    console.log("Quando o pagamento for confirmado, cada linha será atualizada para 'completed' automaticamente.");
  }
}

main()
  .catch((err) => {
    console.error("backfill-referral-pending-orders falhou:", err);
    process.exit(1);
  })
  .finally(() => pool.end());

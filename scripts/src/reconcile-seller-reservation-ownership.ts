/**
 * Tenant-scoped, evidence-only repair for seller visibility.
 *
 * Usage (safe preview by default):
 *   pnpm --filter @workspace/scripts exec tsx src/reconcile-seller-reservation-ownership.ts \
 *     --tenant-id=<tenant-id> --email=<seller-email>
 *
 * Apply the individually proven fixes:
 *   ... --tenant-id=<tenant-id> --email=<seller-email> --apply
 */

import { randomUUID } from "node:crypto";
import { auditLogsTable, clientsTable, db, pool, reservationsTable, usersTable } from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ROLES } from "@workspace/permissions";

function argument(name: string): string | undefined {
  return process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

const tenantId = argument("--tenant-id");
const email = argument("--email")?.trim().toLowerCase();
const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  if (!tenantId || !email) {
    throw new Error("Use --tenant-id=<tenant> e --email=<email>. A reconciliação nunca pesquisa entre tenants.");
  }

  console.log(`=== Reconciliação de vendedor (${apply ? "APLICAR" : "DRY-RUN"}) ===`);
  console.log(`Tenant: ${tenantId}`);
  console.log(`E-mail: ${email}\n`);

  const accounts = await db.select({
    id: usersTable.id,
    role: usersTable.role,
    isActive: usersTable.isActive,
  })
    .from(usersTable)
    .where(and(
      eq(usersTable.tenantId, tenantId),
      sql`lower(${usersTable.email}) = ${email}`,
    ));

  const eligibleAccounts = accounts.filter(account => account.isActive && account.role === ROLES.SALES);
  if (eligibleAccounts.length !== 1 || accounts.length !== 1) {
    console.log(`Nenhuma alteração: encontradas ${accounts.length} contas, ${eligibleAccounts.length} contas ativas com papel de vendedor.`);
    console.log("Isso é ambíguo ou não comprova uma conta de vendedor; encaminhe para decisão administrativa.");
    return;
  }

  const seller = eligibleAccounts[0];
  const matchingClients = await db.select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable)
    .where(and(
      eq(clientsTable.tenantId, tenantId),
      sql`lower(${clientsTable.email}) = ${email}`,
    ));

  const provenReservations = await db.select({
    id: reservationsTable.id,
    reservationNumber: reservationsTable.reservationNumber,
    clientId: reservationsTable.clientId,
  })
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.tenantId, tenantId),
      eq(reservationsTable.createdById, seller.id),
      isNull(reservationsTable.sellerId),
    ));

  const clientIds = matchingClients.map(client => client.id);
  const ambiguousReservations = clientIds.length === 0
    ? []
    : await db.select({ id: reservationsTable.id, reservationNumber: reservationsTable.reservationNumber })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.tenantId, tenantId),
        inArray(reservationsTable.clientId, clientIds),
        isNull(reservationsTable.sellerId),
        sql`${reservationsTable.createdById} <> ${seller.id}`,
      ));

  console.log(`Conta de vendedor comprovada: ${seller.id}`);
  console.log(`Clientes com o mesmo e-mail no tenant: ${matchingClients.length}`);
  console.log(`Reservas comprovadas para corrigir (criadas por essa conta, sem responsável): ${provenReservations.length}`);
  console.log(`Reservas ambíguas (e-mail de cliente, mas outra autoria): ${ambiguousReservations.length}`);

  for (const reservation of provenReservations) {
    console.log(`  ${apply ? "Corrigindo" : "Corrigiria"} ${reservation.reservationNumber ?? reservation.id}`);
    if (!apply) continue;

    await db.transaction(async (tx) => {
      const changed = await tx.update(reservationsTable)
        .set({ sellerId: seller.id })
        .where(and(
          eq(reservationsTable.id, reservation.id),
          eq(reservationsTable.tenantId, tenantId),
          eq(reservationsTable.createdById, seller.id),
          isNull(reservationsTable.sellerId),
        ))
        .returning({ id: reservationsTable.id });

      if (changed.length === 0) return;
      await tx.insert(auditLogsTable).values({
        id: randomUUID(),
        tenantId,
        userId: seller.id,
        action: "reconcile_seller_reservation_ownership",
        entityType: "reservation",
        entityId: reservation.id,
        before: { sellerId: null, createdById: seller.id },
        after: { sellerId: seller.id, evidence: "created_by_same_active_sales_account" },
      });
    });
  }

  if (ambiguousReservations.length > 0) {
    console.log("\nSem alteração nas reservas ambíguas. Revise manualmente:");
    for (const reservation of ambiguousReservations) console.log(`  ${reservation.reservationNumber ?? reservation.id}`);
  }
}

main()
  .catch((error) => {
    console.error("reconcile-seller-reservation-ownership falhou:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
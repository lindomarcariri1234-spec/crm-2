import {
  partnerAvailabilityTable,
  partnerCommissionsTable,
  storeOrderItemsTable,
} from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "../../lib/reservation-payments";
import { ConflictError } from "../../lib/errors";

/**
 * Cancels partner-owned order lines exactly once. It is deliberately shared by
 * partner, agency, and gateway cancellation paths so a paid cancellation cannot
 * leave partner capacity or pending payouts behind.
 */
export async function cancelPartnerOrderItems(
  tx: DbExecutor,
  args: {
    orderId: string;
    tenantId: string;
    reason: string;
    itemId?: string;
    rejectSettledCommission?: boolean;
    skipAvailabilityRelease?: boolean;
  },
): Promise<void> {
  const items = await tx.select({
    id: storeOrderItemsTable.id,
    partnerId: storeOrderItemsTable.partnerId,
    partnerProductId: storeOrderItemsTable.partnerProductId,
    quantity: storeOrderItemsTable.quantity,
    total: storeOrderItemsTable.total,
    metadata: storeOrderItemsTable.metadata,
    partnerCapacityClaimedQuantity: storeOrderItemsTable.partnerCapacityClaimedQuantity,
  }).from(storeOrderItemsTable).where(and(
    eq(storeOrderItemsTable.orderId, args.orderId),
    ...(args.itemId ? [eq(storeOrderItemsTable.id, args.itemId)] : []),
    ne(storeOrderItemsTable.itemStatus, "cancelled"),
  ));

  for (const item of items) {
    if (!item.partnerId) continue;
    const transitioned = await tx.update(storeOrderItemsTable).set({
      itemStatus: "cancelled",
      cancellationReason: args.reason,
      cancelledAt: new Date(),
      partnerCapacityClaimedQuantity: 0,
    }).where(and(
      eq(storeOrderItemsTable.id, item.id),
      ne(storeOrderItemsTable.itemStatus, "cancelled"),
    )).returning({ id: storeOrderItemsTable.id });
    if (transitioned.length === 0) continue;

    const partnerDate = item.metadata?.["partnerDate"];
    if (
      !args.skipAvailabilityRelease
      && item.partnerProductId
      && item.partnerCapacityClaimedQuantity > 0
      && typeof partnerDate === "string"
    ) {
      await tx.update(partnerAvailabilityTable).set({
        spotsUsed: sql`GREATEST(${partnerAvailabilityTable.spotsUsed} - ${item.partnerCapacityClaimedQuantity}, 0)`,
        updatedAt: new Date(),
      }).where(and(
        eq(partnerAvailabilityTable.productId, item.partnerProductId),
        eq(partnerAvailabilityTable.date, partnerDate),
      ));
    }

    const [commission] = await tx.select({
      id: partnerCommissionsTable.id,
      status: partnerCommissionsTable.status,
      grossAmount: partnerCommissionsTable.grossAmount,
      agencyAmount: partnerCommissionsTable.agencyAmount,
    }).from(partnerCommissionsTable).where(and(
      eq(partnerCommissionsTable.orderId, args.orderId),
      eq(partnerCommissionsTable.partnerId, item.partnerId),
      eq(partnerCommissionsTable.tenantId, args.tenantId),
    )).for("update").limit(1);
    // Settled payouts are immutable here; the later settlement workflow owns
    // their reversal. Pending payouts are reduced immediately.
    if (!commission) continue;
    if (commission.status === "paid") {
      if (args.rejectSettledCommission) {
        throw new ConflictError("Este item já foi liquidado e não pode ser cancelado pelo portal", "COMMISSION_ALREADY_PAID");
      }
      continue;
    }

    const currentGross = Number(commission.grossAmount);
    const newGross = Math.max(0, currentGross - Number(item.total));
    const agencyRatio = currentGross > 0 ? Number(commission.agencyAmount) / currentGross : 0;
    const newAgencyAmount = Math.max(0, newGross * agencyRatio);
    await tx.update(partnerCommissionsTable).set({
      grossAmount: newGross.toFixed(2),
      agencyAmount: newAgencyAmount.toFixed(2),
      partnerAmount: Math.max(0, newGross - newAgencyAmount).toFixed(2),
      updatedAt: new Date(),
    }).where(eq(partnerCommissionsTable.id, commission.id));
  }
}
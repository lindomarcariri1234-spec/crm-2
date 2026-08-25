import { clientsTable, dealsTable, reservationsTable } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";

export type SellerScopeActor = {
  id: string;
  tenantId: string;
};

/**
 * A seller can work with a reservation they created, that is assigned to them,
 * or that belongs to a client/deal already in their portfolio. Every branch is
 * constrained to the current tenant so a matching ID in another agency never
 * expands visibility.
 */
export function reservationSellerScopeCondition(actor: SellerScopeActor): SQL {
  return sql`(
    ${reservationsTable.createdById} = ${actor.id}
    OR ${reservationsTable.sellerId} = ${actor.id}
    OR EXISTS (
      SELECT 1
      FROM ${clientsTable} AS scoped_client
      WHERE scoped_client.id = ${reservationsTable.clientId}
        AND scoped_client.tenant_id = ${actor.tenantId}
        AND scoped_client.created_by_id = ${actor.id}
    )
    OR EXISTS (
      SELECT 1
      FROM ${dealsTable} AS scoped_deal
      WHERE scoped_deal.tenant_id = ${actor.tenantId}
        AND scoped_deal.owner_id = ${actor.id}
        AND (
          scoped_deal.reservation_id = ${reservationsTable.id}
          OR scoped_deal.client_id = ${reservationsTable.clientId}
        )
    )
  )`;
}

/**
 * A client remains visible to the seller when it was created by them or is
 * connected to a reservation/deal in their scoped portfolio. This deliberately
 * does not overwrite the original client author when an existing CPF is reused.
 */
export function clientSellerScopeCondition(actor: SellerScopeActor): SQL {
  return sql`(
    ${clientsTable.createdById} = ${actor.id}
    OR EXISTS (
      SELECT 1
      FROM ${reservationsTable} AS scoped_reservation
      WHERE scoped_reservation.tenant_id = ${actor.tenantId}
        AND scoped_reservation.client_id = ${clientsTable.id}
        AND (
          scoped_reservation.created_by_id = ${actor.id}
          OR scoped_reservation.seller_id = ${actor.id}
        )
    )
    OR EXISTS (
      SELECT 1
      FROM ${dealsTable} AS scoped_deal
      WHERE scoped_deal.tenant_id = ${actor.tenantId}
        AND scoped_deal.client_id = ${clientsTable.id}
        AND scoped_deal.owner_id = ${actor.id}
    )
  )`;
}
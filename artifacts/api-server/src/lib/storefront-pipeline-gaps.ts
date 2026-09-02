import { db } from "@workspace/db";
import {
  DEAL_STATUS,
  RESERVATION_STATUS,
} from "@workspace/permissions";
import { sql } from "drizzle-orm";

export interface StorefrontPipelineGap {
  reservationId: string;
  reservationNumber: string | null;
  orderNumber: string;
  tripId: string;
}

interface StorefrontPipelineGapRow {
  [key: string]: unknown;
  reservation_id: string;
  reservation_number: string | null;
  order_number: string;
  trip_id: string;
  total_count: number;
}

export interface StorefrontPipelineGapResult {
  gaps: StorefrontPipelineGap[];
  total: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Finds active storefront reservations that have no corresponding open or won
 * Pipeline card. This is intentionally read-only: callers surface the drift for
 * manual investigation instead of creating or moving cards automatically.
 *
 * A card corresponds when it belongs to the same tenant and is either linked to
 * the reservation directly or represents the same client and trip. The latter
 * preserves compatibility with older cards created before reservationId was
 * consistently populated.
 */
export async function findStorefrontPipelineGaps(
  tenantId: string,
  requestedLimit = DEFAULT_LIMIT,
): Promise<StorefrontPipelineGapResult> {
  if (!tenantId) return { gaps: [], total: 0 };

  const finiteLimit = Number.isFinite(requestedLimit)
    ? Math.trunc(requestedLimit)
    : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(finiteLimit, 1), MAX_LIMIT);

  const result = await db.execute<StorefrontPipelineGapRow>(sql`
    SELECT
      r.id AS reservation_id,
      r.reservation_number,
      so.order_number,
      r.trip_id,
      COUNT(*) OVER()::int AS total_count
    FROM reservations r
    INNER JOIN store_orders so
      ON so.tenant_id = r.tenant_id
      AND so.order_number = r.store_order_id
    LEFT JOIN deals d
      ON d.tenant_id = r.tenant_id
      AND d.status IN (${DEAL_STATUS.OPEN}, ${DEAL_STATUS.WON})
      AND (
        d.reservation_id = r.id
        OR (
          d.client_id = r.client_id
          AND d.trip_id = r.trip_id
        )
      )
    WHERE r.tenant_id = ${tenantId}
      AND r.store_order_id IS NOT NULL
      AND r.client_id IS NOT NULL
      AND r.trip_id IS NOT NULL
      AND r.status IN (
        ${RESERVATION_STATUS.PENDING},
        ${RESERVATION_STATUS.CONFIRMED}
      )
      AND d.id IS NULL
    ORDER BY r.created_at DESC, r.id
    LIMIT ${limit}
  `);

  const rows = result.rows;
  return {
    total: Number(rows[0]?.total_count ?? 0),
    gaps: rows.map((row) => ({
      reservationId: row.reservation_id,
      reservationNumber: row.reservation_number,
      orderNumber: row.order_number,
      tripId: row.trip_id,
    })),
  };
}
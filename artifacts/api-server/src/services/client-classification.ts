import { db, clientsTable, clientClassificationEventsTable, systemConfigsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { generateId } from "../lib/id";

export const CLASSIFICATION_LEVELS = ["new", "lead", "prospect", "client", "vip"] as const;
export type ClientClassification = typeof CLASSIFICATION_LEVELS[number];
export type ClassificationPeriod = "rolling" | "calendar_year" | "all_time";

export interface ClientClassificationSettings {
  currency: string;
  vipSpendThreshold: number;
  vipCompletedTripsThreshold: number;
  periodType: ClassificationPeriod;
  periodMonths: number;
}

const DEFAULT_SETTINGS: ClientClassificationSettings = {
  currency: "BRL",
  vipSpendThreshold: 3000,
  vipCompletedTripsThreshold: 5,
  periodType: "rolling",
  periodMonths: 12,
};

type Executor = Pick<typeof db, "execute" | "select" | "insert" | "update">;
type ClassificationEventInput = {
  tenantId: string;
  clientId?: string | null;
  eventType: string;
  idempotencyKey: string;
  sourceType: string;
  sourceId?: string | null;
  actorId?: string | null;
  previousClassification?: string | null;
  newClassification?: string | null;
  reason: string;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
};

function validSettings(value: unknown): ClientClassificationSettings {
  if (value == null) return { ...DEFAULT_SETTINGS };
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Configuração loyalty_settings.clientClassification inválida: esperado um objeto.");
  const input = value as Record<string, unknown>;
  const currency = input.currency ?? DEFAULT_SETTINGS.currency;
  const spend = input.vipSpendThreshold ?? DEFAULT_SETTINGS.vipSpendThreshold;
  const trips = input.vipCompletedTripsThreshold ?? DEFAULT_SETTINGS.vipCompletedTripsThreshold;
  const periodType = input.periodType ?? DEFAULT_SETTINGS.periodType;
  const months = input.periodMonths ?? DEFAULT_SETTINGS.periodMonths;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) throw new Error("clientClassification.currency deve ser um código ISO de 3 letras maiúsculas.");
  if (typeof spend !== "number" || !Number.isFinite(spend) || spend < 0) throw new Error("clientClassification.vipSpendThreshold deve ser um número não negativo.");
  if (typeof trips !== "number" || !Number.isInteger(trips) || trips < 1) throw new Error("clientClassification.vipCompletedTripsThreshold deve ser um inteiro maior que zero.");
  if (!["rolling", "calendar_year", "all_time"].includes(String(periodType))) throw new Error("clientClassification.periodType deve ser rolling, calendar_year ou all_time.");
  if (typeof months !== "number" || !Number.isInteger(months) || months < 1 || months > 120) throw new Error("clientClassification.periodMonths deve ser um inteiro entre 1 e 120.");
  return { currency, vipSpendThreshold: spend, vipCompletedTripsThreshold: trips, periodType: periodType as ClassificationPeriod, periodMonths: months };
}

export function validateClientClassificationSettings(value: unknown): ClientClassificationSettings {
  return validSettings(value);
}

export async function getClientClassificationSettings(tenantId: string, executor: Executor = db) {
  const [row] = await executor.select().from(systemConfigsTable).where(and(eq(systemConfigsTable.tenantId, tenantId), eq(systemConfigsTable.key, "loyalty_settings"))).limit(1);
  const value = row?.value;
  const nested = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).clientClassification : undefined;
  return validSettings(nested);
}

export async function recordClientClassificationEvent(input: ClassificationEventInput, executor: Executor = db) {
  const [event] = await executor.insert(clientClassificationEventsTable).values({
    id: generateId(),
    tenantId: input.tenantId,
    clientId: input.clientId ?? null,
    eventType: input.eventType,
    idempotencyKey: input.idempotencyKey,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    actorId: input.actorId ?? null,
    previousClassification: input.previousClassification ?? null,
    newClassification: input.newClassification ?? null,
    reason: input.reason,
    occurredAt: input.occurredAt ?? new Date(),
    metadata: input.metadata,
  }).onConflictDoNothing({ target: [clientClassificationEventsTable.tenantId, clientClassificationEventsTable.idempotencyKey] }).returning();
  return event ?? null;
}

function periodStart(now: Date, settings: ClientClassificationSettings): Date | null {
  if (settings.periodType === "all_time") return null;
  if (settings.periodType === "calendar_year") {
    const brazilNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    return new Date(Date.UTC(brazilNow.getUTCFullYear(), 0, 1, 3));
  }
  const start = new Date(now);
  const dayOfMonth = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - settings.periodMonths);
  const lastDayOfMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(dayOfMonth, lastDayOfMonth));
  return start;
}

export function resolveClassification(hasSignal: boolean, hasQualifiedSignal: boolean, hasPaid: boolean, vip: boolean): ClientClassification {
  if (vip) return "vip";
  if (hasPaid) return "client";
  if (hasQualifiedSignal) return "prospect";
  return hasSignal ? "lead" : "new";
}

export type ClientClassificationRecomputeResult = {
  classification: ClientClassification;
  currentClassification: string;
  classificationChanged: boolean;
  amount: number;
  completedTrips: number;
  firstPaidAt: Date | null;
  firstPaidAtChanged: boolean;
} | null;

export async function recomputeClientClassification(
  input: {
    tenantId: string;
    clientId: string;
    trigger?: string;
    sourceId?: string;
    actorId?: string | null;
    reason?: string;
    occurredAt?: Date;
    dryRun?: boolean;
    previewSignals?: { lead: boolean; qualified: boolean };
  },
  executor: Executor = db,
): Promise<ClientClassificationRecomputeResult> {
  if (executor === db && !input.dryRun) {
    return db.transaction((tx) => recomputeClientClassification(input, tx));
  }
  const now = input.occurredAt ?? new Date();
  const settings = await getClientClassificationSettings(input.tenantId, executor);
  const start = periodStart(now, settings);
  // The lock makes concurrent payment/refund callbacks deterministic.
  if (!input.dryRun) {
    await executor.execute(sql`SELECT id FROM clients WHERE id = ${input.clientId} AND tenant_id = ${input.tenantId} FOR UPDATE`);
  }
  const [client] = await executor.select({
    classification: clientsTable.classification,
    firstPaidAt: clientsTable.firstPaidAt,
  }).from(clientsTable).where(and(eq(clientsTable.id, input.clientId), eq(clientsTable.tenantId, input.tenantId))).limit(1);
  if (!client) return null;
  const periodPredicate = start ? sql`AND p.paid_at >= ${start}` : sql``;
  const paid = await executor.execute(sql`
    WITH valid_payments AS (
      SELECT p.id, p.amount::numeric AS amount, p.order_id, p.paid_at
      FROM payments p
      JOIN reservations r ON r.id = p.reservation_id AND r.tenant_id = p.tenant_id
      WHERE p.tenant_id = ${input.tenantId}
        AND COALESCE(r.client_id, p.client_id) = ${input.clientId}
        AND p.type = 'receivable' AND p.amount::numeric > 0
        AND p.paid_at IS NOT NULL AND p.status = 'paid'
        AND p.is_test_mode = false
        AND r.status NOT IN ('cancelled', 'refunded', 'expired')
        ${periodPredicate}
    ),
    order_refunds AS (
      SELECT fle.order_id,
        LEAST(GREATEST(MAX(
          CASE
            WHEN fle.metadata->>'refundRatio' ~ '^[0-9]+([.][0-9]+)?$'
              THEN (fle.metadata->>'refundRatio')::numeric
            ELSE 0
          END
        ), 0), 1) AS refund_ratio
      FROM financial_ledger_entries fle
      WHERE fle.tenant_id = ${input.tenantId}
        AND fle.event_type = 'order_refund_adjustment'
      GROUP BY fle.order_id
    )
    SELECT COALESCE(SUM(
      vp.amount * (1 - COALESCE(orx.refund_ratio, 0))
    ), 0) AS amount
    FROM valid_payments vp
    LEFT JOIN order_refunds orx ON orx.order_id = vp.order_id
  `);
  const paymentRow = (paid as unknown as { rows: Array<{ amount: string }> }).rows[0];
  const firstPaidQuery = await executor.execute(sql`
    SELECT MIN(p.paid_at) AS first_paid_at
    FROM payments p
    JOIN reservations r ON r.id = p.reservation_id AND r.tenant_id = p.tenant_id
    WHERE p.tenant_id = ${input.tenantId}
      AND COALESCE(r.client_id, p.client_id) = ${input.clientId}
      AND p.reservation_id IS NOT NULL
      AND p.type = 'receivable' AND p.amount::numeric > 0 AND p.paid_at IS NOT NULL
      AND p.is_test_mode = false
  `);
  const firstPaidAtValue = (firstPaidQuery as unknown as {
    rows: Array<{ first_paid_at: Date | string | null }>;
  }).rows[0]?.first_paid_at ?? null;
  const firstPaidAt = firstPaidAtValue == null
    ? null
    : firstPaidAtValue instanceof Date
      ? firstPaidAtValue
      : new Date(firstPaidAtValue);
  const firstPaidAtChanged = !!firstPaidAt && (!client.firstPaidAt || firstPaidAt < client.firstPaidAt);
  if (firstPaidAtChanged && !input.dryRun) {
    await executor.update(clientsTable).set({ firstPaidAt })
      .where(and(eq(clientsTable.id, input.clientId), eq(clientsTable.tenantId, input.tenantId)));
  }
  const signals = await executor.execute(sql`
    SELECT COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE e.event_type IN ('opportunity_qualified','historical_qualified_stage'))::int AS qualified_count
    FROM client_classification_events e
    WHERE e.tenant_id = ${input.tenantId} AND e.client_id = ${input.clientId}
      AND e.event_type IN ('interest_recorded','whatsapp_inbound','manual_whatsapp_association','historical_deal','opportunity_qualified','historical_qualified_stage')
      AND (
        e.event_type NOT IN ('whatsapp_inbound', 'manual_whatsapp_association')
        OR EXISTS (
          SELECT 1 FROM chatbot_conversations c
          WHERE c.id = e.source_id
            AND c.tenant_id = e.tenant_id
            AND c.client_id = e.client_id
        )
      )
  `);
  const signalCount = Number((signals as unknown as { rows: Array<{ count: number }> }).rows[0]?.count ?? 0);
  const qualifiedSignalCount = Number((signals as unknown as { rows: Array<{ qualified_count: number }> }).rows[0]?.qualified_count ?? 0);
  const completed = await executor.execute(sql`
    WITH order_refunds AS (
      SELECT fle.order_id,
        LEAST(GREATEST(MAX(
          CASE
            WHEN fle.metadata->>'refundRatio' ~ '^[0-9]+([.][0-9]+)?$'
              THEN (fle.metadata->>'refundRatio')::numeric
            ELSE 0
          END
        ), 0), 1) AS refund_ratio
      FROM financial_ledger_entries fle
      WHERE fle.tenant_id = ${input.tenantId}
        AND fle.event_type = 'order_refund_adjustment'
      GROUP BY fle.order_id
    ),
    reservation_net AS (
      SELECT r.id, r.trip_id, r.total_value::numeric AS total_value,
        COALESCE(SUM(p.amount::numeric * (1 - COALESCE(orx.refund_ratio, 0))), 0) AS paid_net
      FROM reservations r
      JOIN payments p ON p.reservation_id = r.id AND p.tenant_id = r.tenant_id
      LEFT JOIN order_refunds orx ON orx.order_id = p.order_id
      WHERE r.tenant_id = ${input.tenantId} AND r.client_id = ${input.clientId}
        AND r.status NOT IN ('cancelled', 'refunded', 'expired')
        AND p.type = 'receivable' AND p.status = 'paid'
        AND p.paid_at IS NOT NULL AND p.amount::numeric > 0
        AND p.is_test_mode = false
      GROUP BY r.id, r.trip_id, r.total_value
    )
    SELECT COUNT(DISTINCT rn.trip_id)::int AS count
    FROM reservation_net rn
    JOIN trips t ON t.id = rn.trip_id AND t.tenant_id = ${input.tenantId}
    WHERE t.status = 'completed' AND rn.paid_net >= rn.total_value
      ${start ? sql`AND t.return_date >= ${start} AND t.return_date <= ${now}` : sql`AND (t.return_date IS NULL OR t.return_date <= ${now})`}
  `);
  const completedCount = Number((completed as unknown as { rows: Array<{ count: number }> }).rows[0]?.count ?? 0);
  const amount = Number(paymentRow?.amount ?? 0);
  const lifetimePaidResult = await executor.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM payments p
    JOIN reservations r ON r.id = p.reservation_id AND r.tenant_id = p.tenant_id
    WHERE p.tenant_id = ${input.tenantId}
      AND COALESCE(r.client_id, p.client_id) = ${input.clientId}
      AND p.type = 'receivable' AND p.status = 'paid'
      AND p.amount::numeric > 0 AND p.paid_at IS NOT NULL
      AND p.is_test_mode = false
      AND r.status NOT IN ('cancelled', 'refunded', 'expired')
  `);
  const hasPaid = Number((lifetimePaidResult as unknown as { rows: Array<{ count: number }> }).rows[0]?.count ?? 0) > 0;
  const vip = amount >= settings.vipSpendThreshold || completedCount >= settings.vipCompletedTripsThreshold;
  const hasSignal = signalCount > 0 || (input.dryRun === true && input.previewSignals?.lead === true);
  const hasQualifiedSignal = qualifiedSignalCount > 0 || (input.dryRun === true && input.previewSignals?.qualified === true);
  const next = resolveClassification(hasSignal, hasQualifiedSignal, hasPaid, vip);
  const classificationChanged = next !== client.classification;
  if (classificationChanged && !input.dryRun) {
    await executor.update(clientsTable).set({ classification: next }).where(and(eq(clientsTable.id, input.clientId), eq(clientsTable.tenantId, input.tenantId)));
    await recordClientClassificationEvent({
      tenantId: input.tenantId, clientId: input.clientId, eventType: "classification_changed",
      idempotencyKey: `classification:${input.clientId}:${client.classification}:${next}:${input.trigger ?? "recompute"}:${now.toISOString()}`,
      sourceType: input.trigger ?? "classification_engine",
      sourceId: input.sourceId ?? null,
      actorId: input.actorId ?? null,
      previousClassification: client.classification,
      newClassification: next,
      reason: input.reason ?? `Classificação alterada de ${client.classification} para ${next} após ${input.trigger ?? "recalcular indicadores"}.`,
      occurredAt: now,
      metadata: { amount, currency: settings.currency, completedTrips: completedCount },
    }, executor);
  }
  return {
    classification: next,
    currentClassification: client.classification,
    classificationChanged,
    amount,
    completedTrips: completedCount,
    firstPaidAt: firstPaidAt ?? client.firstPaidAt ?? null,
    firstPaidAtChanged,
  };
}

export async function recomputeTripClientClassifications(
  input: { tenantId: string; tripId: string; trigger: string; reason?: string },
  executor: Executor = db,
): Promise<number> {
  if (executor === db) {
    return db.transaction((tx) => recomputeTripClientClassifications(input, tx));
  }
  const result = await executor.execute(sql`
    SELECT DISTINCT client_id
    FROM reservations
    WHERE tenant_id = ${input.tenantId}
      AND trip_id = ${input.tripId}
      AND client_id IS NOT NULL
    ORDER BY client_id
  `);
  const clients = (result as unknown as { rows: Array<{ client_id: string }> }).rows;
  for (const row of clients) {
    await recomputeClientClassification({
      tenantId: input.tenantId,
      clientId: row.client_id,
      trigger: input.trigger,
      sourceId: input.tripId,
      reason: input.reason,
    }, executor);
  }
  return clients.length;
}

export async function recomputeCurrentClientAndVipClassifications(): Promise<number> {
  const result = await db.execute(sql`
    SELECT id, tenant_id
    FROM clients
    WHERE classification IN ('client', 'vip')
    ORDER BY tenant_id, id
  `);
  const clients = (result as unknown as { rows: Array<{ id: string; tenant_id: string }> }).rows;
  for (const row of clients) {
    await recomputeClientClassification({
      tenantId: row.tenant_id,
      clientId: row.id,
      trigger: "vip_period_refresh",
      reason: "Reavaliação periódica da janela de classificação VIP.",
    });
  }
  return clients.length;
}

export async function recomputeTenantClientAndVipClassifications(tenantId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT id
    FROM clients
    WHERE tenant_id = ${tenantId}
      AND classification IN ('client', 'vip')
    ORDER BY id
  `);
  const clients = (result as unknown as { rows: Array<{ id: string }> }).rows;
  for (const row of clients) {
    await recomputeClientClassification({
      tenantId,
      clientId: row.id,
      trigger: "classification_settings_changed",
      reason: "Configuração VIP da agência alterada; classificação recalculada.",
    });
  }
  return clients.length;
}
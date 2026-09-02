import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { paymentsTable, tripsTable, dealsTable, clientsTable, emailLogsTable, reservationsTable, referralsTable } from "@workspace/db";
import { eq, and, lt, lte, gte, gt, sql, isNotNull, isNull, notLike, inArray, notInArray } from "drizzle-orm";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { AGENCY_STAFF_ROLES } from '../lib/tenant';
import { PAYMENT_STATUS, PAYMENT_TYPE, DEAL_STATUS, TRIP_STATUS, REFERRAL_STATUS, ROLES } from "@workspace/permissions";
import { findReferralReversalGaps, countReferralReversalGaps } from "../lib/referral-reversal-gaps";
import { findStorefrontPipelineGaps } from "../lib/storefront-pipeline-gaps";
import { formatBRL, localToday } from "@workspace/shared";

const router = Router();

interface Alert {
  id: string;
  type: "critical" | "warning" | "info";
  category: string;
  title: string;
  description: string;
  actionHref: string;
  count: number;
  reservationIds?: string[];
  referralSkips?: Array<{
    reservationId: string;
    reservationNumber: string | null;
    referralCode: string;
    referrerName: string | null;
  }>;
}

router.get("/alerts", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const isAllowedRole =
      (AGENCY_STAFF_ROLES as readonly string[]).includes(me.role) ||
      me.role === ROLES.SUPER_ADMIN;
    if (!isAllowedRole) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const tenantId = me.tenantId;
    const now = new Date();
    const todayBR = localToday(); // "YYYY-MM-DD" in America/Sao_Paulo (UTC-3)
    const [brYear, brMonth1, brDay] = todayBR.split("-").map(Number);
    // Brazil midnight = UTC 03:00 (permanently UTC-3, no DST since 2019)
    const brMidnight = (y: number, m1: number, d: number) => new Date(Date.UTC(y, m1 - 1, d, 3, 0, 0, 0));
    const startOfToday = brMidnight(brYear, brMonth1, brDay);
    const endOfToday = brMidnight(brYear, brMonth1, brDay + 1);
    const endOfDay3 = brMidnight(brYear, brMonth1, brDay + 4); // exclusive upper bound to include all of day+3
    const in7Days = brMidnight(brYear, brMonth1, brDay + 7);
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const todayMonth = brMonth1;
    const todayDay = brDay;

    const [
      receivableDueTodayRows,
      overdueReceivableRows,
      payableDueNext3DaysRows,
      tripsNoReservationsRows,
      lowOccupancyTripsRows,
      staleLeadsRows,
      birthdaysRows,
      exhaustedEmailLogs,
      referralReversalGaps,
      referralReversalGapsCount,
      overlapQueryResult,
      storefrontPipelineGaps,
    ] = await Promise.all([
      // 1. Contas a receber vencendo hoje
      db.select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(cast(${paymentsTable.amount} as numeric)), 0)`,
      }).from(paymentsTable).where(and(
        eq(paymentsTable.tenantId, tenantId),
        eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE),
        eq(paymentsTable.status, PAYMENT_STATUS.PENDING),
        gte(paymentsTable.dueDate, startOfToday),
        lt(paymentsTable.dueDate, endOfToday),
      )),

      // 2. Contas a receber vencidas
      db.select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(cast(${paymentsTable.amount} as numeric)), 0)`,
      }).from(paymentsTable).where(and(
        eq(paymentsTable.tenantId, tenantId),
        eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE),
        eq(paymentsTable.status, PAYMENT_STATUS.PENDING),
        lt(paymentsTable.dueDate, startOfToday),
      )),

      // 3. Contas a pagar nos próximos 3 dias (inclusive all of day 3)
      db.select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(cast(${paymentsTable.amount} as numeric)), 0)`,
      }).from(paymentsTable).where(and(
        eq(paymentsTable.tenantId, tenantId),
        eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        eq(paymentsTable.status, PAYMENT_STATUS.PENDING),
        gte(paymentsTable.dueDate, startOfToday),
        lt(paymentsTable.dueDate, endOfDay3),
      )),

      // 4. Viagens sem reservas saindo em até 24h
      db.select({
        id: tripsTable.id,
        name: tripsTable.name,
        reservedSeats: tripsTable.reservedSeats,
      }).from(tripsTable).where(and(
        eq(tripsTable.tenantId, tenantId),
        eq(tripsTable.status, TRIP_STATUS.ACTIVE),
        gte(tripsTable.departureDate, now),
        lte(tripsTable.departureDate, in24Hours),
        sql`${tripsTable.reservedSeats} = 0`,
      )),

      // 5. Viagens com baixa ocupação (<50%) nos próximos 7 dias
      db.select({
        id: tripsTable.id,
        name: tripsTable.name,
        totalCapacity: tripsTable.totalCapacity,
        reservedSeats: tripsTable.reservedSeats,
      }).from(tripsTable).where(and(
        eq(tripsTable.tenantId, tenantId),
        eq(tripsTable.status, TRIP_STATUS.ACTIVE),
        gte(tripsTable.departureDate, now),
        lte(tripsTable.departureDate, in7Days),
        gt(tripsTable.totalCapacity, 0),
        sql`${tripsTable.reservedSeats}::numeric / nullif(${tripsTable.totalCapacity}, 0) < 0.5`,
      )),

      // 6. Leads sem movimentação há 7+ dias (inclusive exactly 7 days)
      db.select({
        count: sql<number>`count(*)::int`,
      }).from(dealsTable).where(and(
        eq(dealsTable.tenantId, tenantId),
        eq(dealsTable.status, DEAL_STATUS.OPEN),
        lte(dealsTable.updatedAt, sevenDaysAgo),
      )),

      // 7. Aniversariantes do dia
      db.select({
        count: sql<number>`count(*)::int`,
      }).from(clientsTable).where(and(
        eq(clientsTable.tenantId, tenantId),
        eq(clientsTable.status, "active"),
        sql`extract(month from ${clientsTable.birthDate}) = ${todayMonth}`,
        sql`extract(day from ${clientsTable.birthDate}) = ${todayDay}`,
      )),

      // 8. E-mails com tentativas esgotadas — query via retriesExhaustedAt flag (persists beyond 24h)
      // Excludes rows that have been manually resolved via retriesResolvedAt.
      // Fetches all rows that have been stamped as exhausted so we can check resolution state.
      db.select({
        reservationId: emailLogsTable.reservationId,
        retriesExhaustedAt: emailLogsTable.retriesExhaustedAt,
        status: emailLogsTable.status,
        isAutoRetry: emailLogsTable.isAutoRetry,
        createdAt: emailLogsTable.createdAt,
      }).from(emailLogsTable).where(and(
        eq(emailLogsTable.tenantId, tenantId),
        isNotNull(emailLogsTable.reservationId),
        isNotNull(emailLogsTable.retriesExhaustedAt),
        isNull(emailLogsTable.retriesResolvedAt),
        notLike(emailLogsTable.subject, "Reserva Cancelada%"),
        notLike(emailLogsTable.subject, "Nova reserva%"),
        notLike(emailLogsTable.subject, "Alerta: Falha no e-mail de confirmação%"),
      )),

      // 9. Reversão de indicação ignorada por lacuna de dados.
      // Detection logic extracted into findReferralReversalGaps (see
      // lib/referral-reversal-gaps.ts) so it can be unit-tested directly.
      // The list is a bounded preview for the bell dropdown; the count is the
      // true total so the badge stays accurate even with a large backlog.
      findReferralReversalGaps(tenantId),
      countReferralReversalGaps(tenantId),

      // 10. Clientes com reservas em viagens com datas sobrepostas.
      // Self-join over reservations×trips to find clients with 2+ active
      // reservations whose trip date-ranges intersect.  Uses raw SQL because
      // Drizzle does not support same-table self-joins via the fluent API.
      db.execute(sql`
        SELECT COUNT(DISTINCT r1.client_id)::int AS conflicting_clients
        FROM reservations r1
        JOIN trips t1 ON t1.id = r1.trip_id AND t1.tenant_id = r1.tenant_id
        JOIN reservations r2
          ON  r2.client_id  = r1.client_id
          AND r2.id        != r1.id
          AND r2.tenant_id  = r1.tenant_id
        JOIN trips t2 ON t2.id = r2.trip_id AND t2.tenant_id = r2.tenant_id
        WHERE r1.tenant_id = ${tenantId}
          AND r1.status IN ('pending', 'confirmed')
          AND r2.status IN ('pending', 'confirmed')
          AND t1.departure_date <= COALESCE(t2.return_date, t2.departure_date)
          AND COALESCE(t1.return_date, t1.departure_date) >= t2.departure_date
      `),

      // 11. Reservas ativas da vitrine sem card correspondente no Pipeline.
      // Read-only reconciliation; the alert directs staff to investigate.
      findStorefrontPipelineGaps(tenantId),
    ]);

    const alerts: Alert[] = [];
    const fmt = (v: number) => formatBRL(v);

    const receivableTodayCount = Number(receivableDueTodayRows[0]?.count ?? 0);
    const receivableTodayTotal = Number(receivableDueTodayRows[0]?.total ?? 0);
    if (receivableTodayCount > 0) {
      alerts.push({
        id: "receivable-due-today",
        type: "warning",
        category: "Financeiro",
        title: `${receivableTodayCount} conta(s) a receber vence(m) hoje`,
        description: `Total: ${fmt(receivableTodayTotal)}`,
        actionHref: "/financeiro?tab=receivable",
        count: receivableTodayCount,
      });
    }

    const overdueCount = Number(overdueReceivableRows[0]?.count ?? 0);
    const overdueTotal = Number(overdueReceivableRows[0]?.total ?? 0);
    if (overdueCount > 0) {
      alerts.push({
        id: "receivable-overdue",
        type: "critical",
        category: "Financeiro",
        title: `${overdueCount} conta(s) a receber vencida(s)`,
        description: `Total em aberto: ${fmt(overdueTotal)}`,
        actionHref: "/financeiro?tab=receivable",
        count: overdueCount,
      });
    }

    const payableCount = Number(payableDueNext3DaysRows[0]?.count ?? 0);
    const payableTotal = Number(payableDueNext3DaysRows[0]?.total ?? 0);
    if (payableCount > 0) {
      alerts.push({
        id: "payable-due-3days",
        type: "warning",
        category: "Financeiro",
        title: `${payableCount} conta(s) a pagar nos próximos 3 dias`,
        description: `Total: ${fmt(payableTotal)}`,
        actionHref: "/financeiro?tab=payable",
        count: payableCount,
      });
    }

    const tripsNoRes = tripsNoReservationsRows.length;
    if (tripsNoRes > 0) {
      const names = lowOccupancyTripsRows.slice(0, 2).map(t => t.name).join(", ");
      alerts.push({
        id: "trips-no-reservations-24h",
        type: "critical",
        category: "Viagens",
        title: `${tripsNoRes} viagem(ns) sem reservas saindo em 24h`,
        description: tripsNoRes <= 2 ? names : `${names} e mais ${tripsNoRes - 2}`,
        actionHref: "/trips",
        count: tripsNoRes,
      });
    }

    if (lowOccupancyTripsRows.length > 0) {
      const names = lowOccupancyTripsRows.slice(0, 2).map(t => t.name).join(", ");
      alerts.push({
        id: "trips-low-occupancy-7d",
        type: "warning",
        category: "Viagens",
        title: `${lowOccupancyTripsRows.length} viagem(ns) com baixa ocupação (<50%)`,
        description: lowOccupancyTripsRows.length <= 2 ? names : `${names} e mais ${lowOccupancyTripsRows.length - 2}`,
        actionHref: "/trips",
        count: lowOccupancyTripsRows.length,
      });
    }

    const staleLeadCount = Number(staleLeadsRows[0]?.count ?? 0);
    if (staleLeadCount > 0) {
      alerts.push({
        id: "leads-stale-7d",
        type: "info",
        category: "Pipeline",
        title: `${staleLeadCount} lead(s) sem movimentação há 7+ dias`,
        description: "Considere entrar em contato para reativar",
        actionHref: "/pipeline",
        count: staleLeadCount,
      });
    }

    if (storefrontPipelineGaps.total > 0) {
      const MAX_SHOWN = 3;
      const shown = storefrontPipelineGaps.gaps
        .slice(0, MAX_SHOWN)
        .map((gap) => {
          const reservationRef = gap.reservationNumber ?? gap.reservationId;
          return `#${reservationRef} (pedido ${gap.orderNumber})`;
        });
      const remainder = storefrontPipelineGaps.total - shown.length;
      const references = shown.join("; ") + (remainder > 0 ? ` e mais ${remainder}` : "");

      alerts.push({
        id: "storefront-reservations-without-pipeline-card",
        type: "warning",
        category: "Pipeline",
        title: `${storefrontPipelineGaps.total} reserva(s) da vitrine sem card no Pipeline`,
        description: `${references}. Abra o Pipeline para criar ou associar o card manualmente.`,
        actionHref: "/pipeline",
        count: storefrontPipelineGaps.total,
        reservationIds: storefrontPipelineGaps.gaps.map((gap) => gap.reservationId),
      });
    }

    const birthdayCount = Number(birthdaysRows[0]?.count ?? 0);
    if (birthdayCount > 0) {
      alerts.push({
        id: "birthdays-today",
        type: "info",
        category: "Clientes",
        title: `${birthdayCount} aniversariante(s) hoje`,
        description: "Aproveite para enviar uma mensagem de parabéns",
        actionHref: "/clients?filter=birthday",
        count: birthdayCount,
      });
    }

    // 8. E-mails com tentativas esgotadas — usar flag retriesExhaustedAt (sem janela de 24h)
    {
      // Step 1: Collect the latest retriesExhaustedAt per reservationId.
      // Using the latest (max) timestamp handles cases where a reservation
      // somehow accumulates more than one exhaustion cycle correctly.
      const exhaustionByReservation = new Map<string, Date>();
      for (const log of exhaustedEmailLogs) {
        const rid = log.reservationId!;
        const exhaustedAt = log.retriesExhaustedAt!;
        const existing = exhaustionByReservation.get(rid);
        if (!existing || exhaustedAt > existing) {
          exhaustionByReservation.set(rid, exhaustedAt);
        }
      }

      // Step 2: For the exhausted reservationIds, check ALL email_logs (not just
      // exhausted ones) for a successful non-auto-retry send after the exhaustion
      // timestamp. Manual resend rows have retriesExhaustedAt = null, so they
      // would have been excluded from the initial query — this second query
      // captures them correctly.
      const resolvedIds = new Set<string>();
      if (exhaustionByReservation.size > 0) {
        const allExhaustedIds = [...exhaustionByReservation.keys()];
        // Only count rows that look like customer-facing booking confirmations.
        // Staff-alert rows (subject "Alerta: Falha no e-mail de confirmação…")
        // share the same reservationId and isAutoRetry=false, but must NOT be
        // treated as a successful customer resend — exclude them along with
        // cancellation and agency-notification emails.
        const manualResends = await db
          .select({
            reservationId: emailLogsTable.reservationId,
            createdAt: emailLogsTable.createdAt,
          })
          .from(emailLogsTable)
          .where(
            and(
              eq(emailLogsTable.tenantId, tenantId),
              inArray(emailLogsTable.reservationId, allExhaustedIds),
              eq(emailLogsTable.status, "sent"),
              eq(emailLogsTable.isAutoRetry, false),
              notLike(emailLogsTable.subject, "Alerta: Falha no e-mail de confirmação%"),
              notLike(emailLogsTable.subject, "Reserva Cancelada%"),
              notLike(emailLogsTable.subject, "Nova reserva%"),
            ),
          );

        for (const resend of manualResends) {
          const rid = resend.reservationId!;
          const sentAt = resend.createdAt;
          const exhaustedAt = exhaustionByReservation.get(rid)!;
          if (sentAt >= exhaustedAt) {
            resolvedIds.add(rid);
          }
        }
      }

      const exhaustedReservationIds = [...exhaustionByReservation.keys()].filter(
        (rid) => !resolvedIds.has(rid),
      );
      const exhaustedCount = exhaustedReservationIds.length;

      if (exhaustedCount > 0) {
        // Fetch reservation details to include in the alert description
        let description = "Intervenção manual necessária — acesse o Log de E-mails";
        try {
          const details = await db
            .select({
              reservationId: reservationsTable.id,
              reservationNumber: reservationsTable.reservationNumber,
              voucherCode: reservationsTable.voucherCode,
              clientEmail: clientsTable.email,
            })
            .from(reservationsTable)
            .innerJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
            .where(inArray(reservationsTable.id, exhaustedReservationIds));

          if (details.length > 0) {
            const MAX_SHOWN = 3;
            const shown = details.slice(0, MAX_SHOWN).map((detail) => {
              const reference = detail.reservationNumber ?? detail.voucherCode ?? detail.reservationId;
              return `#${reference} (${detail.clientEmail ?? "sem e-mail"})`;
            });
            const remainder = exhaustedCount - shown.length;
            description = shown.join("; ") + (remainder > 0 ? ` e mais ${remainder}` : "");
          }
        } catch {
          // Non-fatal — fall back to generic description
        }

        alerts.push({
          id: "email-retry-exhausted",
          type: "critical",
          category: "E-mails",
          title: `${exhaustedCount} e-mail(s) de confirmação com tentativas esgotadas`,
          description,
          actionHref: "/communication?tab=failed-emails",
          count: exhaustedCount,
          reservationIds: exhaustedReservationIds,
        });
      }
    }

    // 10. Clientes com viagens sobrepostas
    {
      const overlapRows = (overlapQueryResult as unknown as { rows: Array<{ conflicting_clients: number }> }).rows;
      const conflictingClients = Number(overlapRows[0]?.conflicting_clients ?? 0);
      if (conflictingClients > 0) {
        alerts.push({
          id: "clients-overlapping-trips",
          type: "warning",
          category: "Reservas",
          title: `${conflictingClients} cliente(s) com viagens no mesmo período`,
          description: "Verifique as reservas para evitar conflitos de datas",
          actionHref: "/reservations",
          count: conflictingClients,
        });
      }
    }

    // 9. Reversões de indicação ignoradas por lacuna de dados
    {
      const gaps = referralReversalGaps;
      const totalGaps = referralReversalGapsCount;
      if (totalGaps > 0) {
        const MAX_SHOWN = 3;
        const shown = gaps.slice(0, MAX_SHOWN).map((g) => {
          const resRef = g.reservation_number ?? g.reservation_id;
          const referrer = g.referrer_name ?? "indicador desconhecido";
          return `#${resRef} (cód. ${g.referral_code}, ${referrer})`;
        });
        const remainder = totalGaps - shown.length;
        const description = shown.join("; ") + (remainder > 0 ? ` e mais ${remainder}` : "");

        alerts.push({
          id: "referral-reversal-skipped",
          type: "warning",
          category: "Indicações",
          title: `${totalGaps} reversão(ões) de bônus de indicação não executada(s)`,
          description,
          actionHref: "/indicacoes",
          count: totalGaps,
          referralSkips: gaps.map((g) => ({
            reservationId: g.reservation_id,
            reservationNumber: g.reservation_number,
            referralCode: g.referral_code,
            referrerName: g.referrer_name,
          })),
        });
      }
    }

    res.json({ alerts, count: alerts.length });
  } catch (err) {
    next(err);
  }
});

// Paginated full list of referral-reversal gaps. The /alerts payload only carries
// a bounded preview (for the bell dropdown); this endpoint backs the dedicated
// "Reversões de bônus pendentes" view on /indicacoes so agencies can page through
// the entire backlog, not just the first 20.
router.get("/alerts/referral-reversal-skipped/gaps", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const isAllowedRole =
      (AGENCY_STAFF_ROLES as readonly string[]).includes(me.role) ||
      me.role === ROLES.SUPER_ADMIN;
    if (!isAllowedRole) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const parsedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const parsedOffset = Number.parseInt(String(req.query.offset ?? ""), 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

    const [gaps, total] = await Promise.all([
      findReferralReversalGaps(me.tenantId, { limit, offset }),
      countReferralReversalGaps(me.tenantId),
    ]);

    res.json({
      gaps: gaps.map((g) => ({
        reservationId: g.reservation_id,
        reservationNumber: g.reservation_number,
        referralCode: g.referral_code,
        referrerName: g.referrer_name,
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/alerts/email-retry-exhausted/:reservationId/resolve", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (!(AGENCY_STAFF_ROLES as readonly string[]).includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const { reservationId } = req.params;

    // Verify the reservation belongs to this tenant before resolving its email alert.
    const [reservation] = await db
      .select({
        id: reservationsTable.id,
      })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.id, reservationId),
        eq(reservationsTable.tenantId, me.tenantId),
      ))
      .limit(1);

    if (!reservation) {
      next(new NotFoundError("Reserva não encontrada", "NOT_FOUND"));
      return;
    }

    // Acknowledge the surfaced exhausted email rows for this tenant reservation.
    const now = new Date();
    await db
      .update(emailLogsTable)
      .set({ retriesResolvedAt: now })
      .where(
        and(
          eq(emailLogsTable.tenantId, me.tenantId),
          eq(emailLogsTable.reservationId, reservationId),
          isNotNull(emailLogsTable.retriesExhaustedAt),
          isNull(emailLogsTable.retriesResolvedAt),
        ),
      );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/alerts/referral-reversal-skipped/:reservationId/resolve", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (!(AGENCY_STAFF_ROLES as readonly string[]).includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const { reservationId } = req.params;

    // Verify the reservation belongs to this tenant and grab its referral code
    const [reservation] = await db
      .select({
        id: reservationsTable.id,
        discountReferralCode: reservationsTable.discountReferralCode,
      })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.id, reservationId),
        eq(reservationsTable.tenantId, me.tenantId),
      ))
      .limit(1);

    if (!reservation) {
      next(new NotFoundError("Reserva não encontrada", "NOT_FOUND"));
      return;
    }

    if (!reservation.discountReferralCode) {
      next(new ValidationError("Reserva não possui código de indicação", "VALIDATION_ERROR"));
      return;
    }

    // Acknowledge the surfaced gap by stamping the COMPLETED referral rows that
    // match this reservation's code. This mirrors the gap-detection JOIN
    // (status=COMPLETED AND code=discount_referral_code) so the alert clears.
    const now = new Date();
    await db
      .update(referralsTable)
      .set({ reversalWarningAcknowledgedAt: now })
      .where(and(
        eq(referralsTable.tenantId, me.tenantId),
        eq(referralsTable.code, reservation.discountReferralCode),
        eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
        isNull(referralsTable.reversalWarningAcknowledgedAt),
      ));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;

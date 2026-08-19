import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { tripsTable, paymentsTable, clientsTable, systemConfigsTable, reservationsTable } from "@workspace/db";
import { eq, and, lt, gte, lte, gt } from "drizzle-orm";
import { requireAuth } from "../lib/tenant";
import { ROLES, RESERVATION_STATUS, PAYMENT_STATUS, PAYMENT_TYPE, TRIP_STATUS } from "@workspace/permissions";
import { formatBRLPlain, localToday } from "@workspace/shared";

const router = Router();

type AlertItem = {
  type: string;
  severity: string;
  title: string;
  message: string;
  link: string;
  entityId: string | null;
};

type TripRow = { id: string; name: string; departureDate: Date; totalCapacity: number; availableSeats: number };

router.get("/notifications", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const isClientRole = me.role === ROLES.CLIENT;

    const configs = await db.select().from(systemConfigsTable)
      .where(and(eq(systemConfigsTable.tenantId, me.tenantId), eq(systemConfigsTable.key, "notifications")));

    const notifConfig = (configs[0]?.value ?? {}) as Record<string, boolean>;
    const isEnabled = (key: string) => notifConfig[key] !== false;

    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const alerts: AlertItem[] = [];

    let linkedClientId: string | null = null;
    if (isClientRole) {
      const [linkedClient] = await db.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.userId, me.id)))
        .limit(1);
      linkedClientId = linkedClient?.id ?? null;
    }

    if (isEnabled("tripReminder")) {
      let upcomingTrips: TripRow[] = [];

      if (isClientRole) {
        if (linkedClientId) {
          const clientReservations = await db.select({ tripId: reservationsTable.tripId })
            .from(reservationsTable)
            .where(and(
              eq(reservationsTable.tenantId, me.tenantId),
              eq(reservationsTable.clientId, linkedClientId),
              eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
            ));
          const tripIds = new Set(clientReservations.map(r => r.tripId));

          const allTrips = await db.select({
            id: tripsTable.id,
            name: tripsTable.name,
            departureDate: tripsTable.departureDate,
            totalCapacity: tripsTable.totalCapacity,
            availableSeats: tripsTable.availableSeats,
          }).from(tripsTable).where(
            and(
              eq(tripsTable.tenantId, me.tenantId),
              gte(tripsTable.departureDate, now),
              lte(tripsTable.departureDate, in7Days),
            )
          );
          upcomingTrips = allTrips.filter(t => tripIds.has(t.id)) as TripRow[];
        }
      } else {
        const rows = await db.select({
          id: tripsTable.id,
          name: tripsTable.name,
          departureDate: tripsTable.departureDate,
          totalCapacity: tripsTable.totalCapacity,
          availableSeats: tripsTable.availableSeats,
        }).from(tripsTable).where(
          and(
            eq(tripsTable.tenantId, me.tenantId),
            gte(tripsTable.departureDate, now),
            lte(tripsTable.departureDate, in7Days),
            eq(tripsTable.status, TRIP_STATUS.ACTIVE),
          )
        );
        upcomingTrips = rows as TripRow[];
      }

      for (const trip of upcomingTrips) {
        const diffMs = new Date(trip.departureDate).getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const label = diffDays <= 1 ? "amanhã" : `em ${diffDays} dias`;
        alerts.push({
          type: "trip_reminder",
          severity: diffDays <= 1 ? "warning" : "info",
          title: "Viagem iminente",
          message: `${trip.name} parte ${label}`,
          link: isClientRole ? "/dashboard" : `/trips/${trip.id}`,
          entityId: trip.id,
        });
      }
    }

    if (!isClientRole && isEnabled("overduePayment")) {
      const overduePayments = await db.select({
        id: paymentsTable.id,
        amount: paymentsTable.amount,
      }).from(paymentsTable).where(
        and(
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.status, PAYMENT_STATUS.PENDING),
          eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE),
          lt(paymentsTable.dueDate, now),
        )
      );

      if (overduePayments.length > 0) {
        const totalOverdue = overduePayments.reduce((s, p) => s + Number(p.amount), 0);
        alerts.push({
          type: "overdue_payment",
          severity: "error",
          title: "Pagamentos vencidos",
          message: `${overduePayments.length} pagamento(s) vencido(s) — ${formatBRLPlain(totalOverdue)}`,
          link: "/financial",
          entityId: null,
        });
      }
    }

    if (!isClientRole && isEnabled("unpaidReservation")) {
      const confirmedUnpaid = await db.select({
        id: reservationsTable.id,
        balance: reservationsTable.balance,
      }).from(reservationsTable).where(
        and(
          eq(reservationsTable.tenantId, me.tenantId),
          eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
          gt(reservationsTable.balance, "0"),
        )
      );

      if (confirmedUnpaid.length > 0) {
        const totalBalance = confirmedUnpaid.reduce((s, r) => s + Number(r.balance), 0);
        alerts.push({
          type: "unpaid_reservation",
          severity: "warning",
          title: "Reservas confirmadas sem pagamento",
          message: `${confirmedUnpaid.length} reserva(s) com saldo pendente — ${formatBRLPlain(totalBalance)}`,
          link: "/reservations",
          entityId: null,
        });
      }
    }

    if (!isClientRole && isEnabled("lowOccupancy")) {
      const allUpcomingTrips = await db.select({
        id: tripsTable.id,
        name: tripsTable.name,
        totalCapacity: tripsTable.totalCapacity,
        availableSeats: tripsTable.availableSeats,
      }).from(tripsTable).where(
        and(
          eq(tripsTable.tenantId, me.tenantId),
          gte(tripsTable.departureDate, now),
          eq(tripsTable.status, TRIP_STATUS.ACTIVE),
        )
      );

      for (const trip of allUpcomingTrips) {
        if (trip.totalCapacity > 0) {
          const occupancy = ((trip.totalCapacity - trip.availableSeats) / trip.totalCapacity) * 100;
          if (occupancy < 50) {
            alerts.push({
              type: "low_occupancy",
              severity: "warning",
              title: "Baixa ocupação",
              message: `${trip.name} — ${Math.round(occupancy)}% ocupado`,
              link: `/trips/${trip.id}`,
              entityId: trip.id,
            });
          }
        }
      }
    }

    if (!isClientRole && isEnabled("birthdayAlert")) {
      // Server runs UTC; use Brazil calendar date to avoid 3-hour offset at midnight
      const todayBR = localToday(); // "YYYY-MM-DD" in America/Sao_Paulo
      const [brYear, brMonth1, brDay] = todayBR.split("-").map(Number);
      // Brazil UTC-3 midnight = UTC 03:00 (no DST since 2019)
      const brMidnight = (y: number, m1: number, d: number) =>
        new Date(Date.UTC(y, m1 - 1, d, 3, 0, 0, 0));
      const startOfDayBR = brMidnight(brYear, brMonth1, brDay);
      const in7DaysEndBR = new Date(brMidnight(brYear, brMonth1, brDay + 7).getTime() - 1);

      const allClients = await db.select({
        id: clientsTable.id,
        name: clientsTable.name,
        birthDate: clientsTable.birthDate,
      }).from(clientsTable).where(eq(clientsTable.tenantId, me.tenantId));

      const birthdaysThisWeek = allClients.filter(c => {
        if (!c.birthDate) return false;
        // date-only strings are parsed as UTC midnight; use UTC accessors
        const bd = c.birthDate; // already a Date (timestamp column)
        const thisYearBirthday = brMidnight(brYear, bd.getUTCMonth() + 1, bd.getUTCDate());
        return thisYearBirthday >= startOfDayBR && thisYearBirthday <= in7DaysEndBR;
      });

      if (birthdaysThisWeek.length > 0) {
        const names = birthdaysThisWeek.slice(0, 2).map(c => c.name.split(" ")[0]).join(", ");
        const extra = birthdaysThisWeek.length > 2 ? ` e +${birthdaysThisWeek.length - 2}` : "";
        alerts.push({
          type: "birthday_alert",
          severity: "info",
          title: "Aniversários esta semana",
          message: `${names}${extra}`,
          link: "/clients",
          entityId: null,
        });
      }
    }

    res.json({ alerts, total: alerts.length });
  } catch (err) {
    next(err);
  }
});

export default router;

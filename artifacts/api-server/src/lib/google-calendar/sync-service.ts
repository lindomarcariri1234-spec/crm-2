import { ROLES } from "@workspace/permissions";
import { db } from "@workspace/db";
import {
  usersTable,
  clientsTable,
  tripsTable,
  reservationsTable,
  paymentsTable,
  calendarEventsTable,
  calendarReconciliationsTable,
} from "@workspace/db";
import { eq, and, sql, type SQL } from "drizzle-orm";
import { createHash } from "crypto";
import { format, addHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import { GoogleCalendarService, refreshTokenIfNeeded, withCalendarRetry } from "./calendar-service";
import { generateId } from "../id";
import { logger } from "../logger";
import { RESERVATION_STATUS, PAYMENT_STATUS, TRIP_STATUS } from "@workspace/permissions";
import { formatBRLPlain } from "@workspace/shared";

async function getCalendarService(userId: string): Promise<GoogleCalendarService | null> {
  const token = await refreshTokenIfNeeded(userId);
  if (!token) return null;
  return new GoogleCalendarService(token, userId);
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "Não informado";
  return format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

function fmtCurrency(v: number | string | null | undefined): string {
  return formatBRLPlain(Number(v ?? 0));
}

type CalendarDbExecutor = Pick<typeof db, "select" | "update" | "insert" | "delete">;

/**
 * Google accepts caller-provided event IDs and treats a repeated insert with
 * the same ID as a conflict. Deriving the ID from the logical calendar record
 * makes the create operation recoverable when Google succeeds but the local
 * calendar_events insert does not.
 */
function stableGoogleEventId(record: {
  tenantId: string;
  userId?: string;
  clientId?: string;
  tripId?: string;
  paymentId?: string;
  eventType: string;
}): string {
  const resourceId = record.tripId ?? record.paymentId ?? record.clientId ?? "unknown";
  return createHash("sha256")
    .update(`visitecrm-calendar:${record.tenantId}:${record.userId ?? "unknown"}:${record.eventType}:${resourceId}`)
    .digest("hex");
}

type LegacyMatch = {
  id: string;
  type: "trip" | "payment" | "birthday";
  label: string;
};

export type LegacyCalendarCandidate = {
  reconciliationId: string;
  status: "pending" | "associated" | "removed" | "dismissed";
  googleEventId: string;
  calendarId: string;
  eventType: "trip" | "payment" | "birthday";
  eventSummary: string;
  eventDescription: string | null;
  eventLocation: string | null;
  eventStartDate: Date;
  eventEndDate: Date | null;
  candidateMatches: LegacyMatch[];
};

function sameInstant(left: Date | null | undefined, right: Date | null | undefined): boolean {
  return Boolean(left && right && Math.abs(left.getTime() - right.getTime()) <= 60_000);
}

function sameBirthdayDate(left: Date | null | undefined, right: Date | null | undefined): boolean {
  return Boolean(left && right && format(left, "MM-dd") === format(right, "MM-dd"));
}

export function legacyMatchesForEvent(
  event: Awaited<ReturnType<GoogleCalendarService["listEvents"]>>[number],
  trips: Array<{
    id: string;
    name: string;
    description: string | null;
    destination: string;
    originCity: string | null;
    departureDate: Date;
    returnDate: Date | null;
  }>,
  payments: Array<{
    id: string;
    clientId: string | null;
    dueDate: Date;
  }>,
  clients: Array<{
    id: string;
    name: string;
    birthDate: Date | null;
  }>,
): LegacyMatch[] {
  const matches: LegacyMatch[] = [];

  // These prefixes were part of the event payload before deterministic IDs
  // existed. Requiring one prevents ordinary user-created events with a
  // coincidentally similar title from entering the review queue.
  if (event.description?.startsWith("🚌 VIAGEM:")) {
    for (const trip of trips) {
      const location = trip.originCity ? `${trip.originCity} → ${trip.destination}` : trip.destination;
      const expectedEnd = trip.returnDate ?? addHours(trip.departureDate, 12);
      if (
        event.summary === `🚌 ${trip.name}` &&
        sameInstant(event.startDateTime, trip.departureDate) &&
        sameInstant(event.endDateTime, expectedEnd) &&
        event.location === location
      ) {
        matches.push({ id: trip.id, type: "trip", label: trip.name });
      }
    }
  }

  if (event.description?.startsWith("💰 PAGAMENTO PENDENTE")) {
    for (const payment of payments) {
      const client = clients.find((item) => item.id === payment.clientId);
      const clientName = client?.name ?? "Cliente";
      if (
        event.summary === `💰 Pagamento: ${clientName}` &&
        sameInstant(event.startDateTime, payment.dueDate) &&
        sameInstant(event.endDateTime, payment.dueDate)
      ) {
        matches.push({ id: payment.id, type: "payment", label: `Pagamento de ${clientName}` });
      }
    }
  }

  if (event.summary.startsWith("🎂 Aniversário:")) {
    for (const client of clients) {
      if (
        client.birthDate &&
        event.summary === `🎂 Aniversário: ${client.name}` &&
        event.description?.startsWith(`Aniversário de ${client.name}`) &&
        sameBirthdayDate(event.startDateTime, client.birthDate)
      ) {
        matches.push({ id: client.id, type: "birthday", label: `Aniversário de ${client.name}` });
      }
    }
  }

  return matches;
}

function recordResourceId(record: {
  tripId?: string;
  paymentId?: string;
  clientId?: string;
  eventType: string;
}): string | undefined {
  if (record.eventType === "trip") return record.tripId;
  if (record.eventType === "payment") return record.paymentId;
  if (record.eventType === "birthday") return record.clientId;
  return undefined;
}

async function upsertCalendarEventWithExecutor(
  executor: CalendarDbExecutor,
  service: GoogleCalendarService,
  filter: SQL[],
  eventData: { summary: string; description?: string; location?: string; startDateTime: Date; endDateTime?: Date; attendees?: string[] },
  record: {
    tenantId: string;
    userId?: string;
    clientId?: string;
    tripId?: string;
    paymentId?: string;
    eventType: string;
  }
): Promise<void> {
  const [existing] = await executor.select().from(calendarEventsTable)
    .where(and(...filter)).limit(1);

  const logCtx = {
    userId: record.userId,
    tripId: record.tripId,
    paymentId: record.paymentId,
    clientId: record.clientId,
    eventType: record.eventType,
    tenantId: record.tenantId,
  };
  const createEventData = {
    ...eventData,
    googleEventId: stableGoogleEventId(record),
  };

  // A legacy event that is awaiting human review must not be silently
  // associated or duplicated by a later normal sync. Once dismissed or
  // removed, the agency has explicitly chosen how the regular sync may
  // proceed.
  const resourceId = recordResourceId(record);
  if (record.userId && resourceId) {
    const pendingLegacy = await executor.select({
      candidateMatches: calendarReconciliationsTable.candidateMatches,
    }).from(calendarReconciliationsTable).where(and(
      eq(calendarReconciliationsTable.tenantId, record.tenantId),
      eq(calendarReconciliationsTable.userId, record.userId),
      eq(calendarReconciliationsTable.eventType, record.eventType),
      eq(calendarReconciliationsTable.status, "pending"),
    ));
    if (pendingLegacy.some((row) =>
      row.candidateMatches.some((match) => match.id === resourceId && match.type === record.eventType)
    )) {
      logger.info({ ...logCtx, resourceId }, "calendar-sync: legacy event pending review; skipping automatic create");
      return;
    }
  }

  if (existing) {
    const updated = await withCalendarRetry(() => service.updateEvent(existing.googleEventId, eventData, logCtx));
    if (updated === true) {
      await executor.update(calendarEventsTable).set({
        title: eventData.summary,
        description: eventData.description,
        startDate: eventData.startDateTime,
        endDate: eventData.endDateTime,
        location: eventData.location,
        syncedAt: new Date(),
      }).where(eq(calendarEventsTable.id, existing.id));
    } else if (updated === "not-found") {
      // Event was deleted externally in Google — remove stale DB record and recreate.
      logger.info({ ...logCtx, googleEventId: existing.googleEventId }, "calendar-sync: stale DB record found; deleting and recreating event");
      await executor.delete(calendarEventsTable).where(eq(calendarEventsTable.id, existing.id));
      const googleEvent = await withCalendarRetry(() => service.createEvent(createEventData, logCtx));
      if (!googleEvent) {
        logger.warn(logCtx, "calendar-sync: createEvent after external deletion failed; no DB record persisted");
        return;
      }
      await executor.insert(calendarEventsTable).values({
        id: generateId(),
        tenantId: record.tenantId,
        userId: record.userId,
        clientId: record.clientId,
        tripId: record.tripId,
        paymentId: record.paymentId,
        googleEventId: googleEvent.id,
        calendarId: "primary",
        eventType: record.eventType,
        title: eventData.summary,
        description: eventData.description,
        startDate: eventData.startDateTime,
        endDate: eventData.endDateTime,
        location: eventData.location,
        syncedAt: new Date(),
      });
    } else {
      logger.warn({ ...logCtx, googleEventId: existing.googleEventId }, "calendar-sync: updateEvent permanently failed (auth or data issue); DB record not updated");
    }
  } else {
    const googleEvent = await withCalendarRetry(() => service.createEvent(createEventData, logCtx));
    if (!googleEvent) {
      logger.warn(logCtx, "calendar-sync: createEvent failed; no DB record persisted");
      return;
    }
    await executor.insert(calendarEventsTable).values({
      id: generateId(),
      tenantId: record.tenantId,
      userId: record.userId,
      clientId: record.clientId,
      tripId: record.tripId,
      paymentId: record.paymentId,
      googleEventId: googleEvent.id,
      calendarId: "primary",
      eventType: record.eventType,
      title: eventData.summary,
      description: eventData.description,
      startDate: eventData.startDateTime,
      endDate: eventData.endDateTime,
      location: eventData.location,
      syncedAt: new Date(),
    });
  }
}

/**
 * Serializes trip-event syncs for the same agency, trip, and calendar user.
 *
 * The lock deliberately covers the Google API call as well as the local
 * read/write. A database unique constraint could prevent duplicate rows, but
 * it would still allow both concurrent callers to create separate Google
 * events before either insert reaches the database.
 */
async function upsertCalendarEvent(
  service: GoogleCalendarService,
  filter: SQL[],
  eventData: { summary: string; description?: string; location?: string; startDateTime: Date; endDateTime?: Date; attendees?: string[] },
  record: {
    tenantId: string;
    userId?: string;
    clientId?: string;
    tripId?: string;
    paymentId?: string;
    eventType: string;
  }
): Promise<void> {
  if (record.eventType === "trip" && record.tripId && record.userId) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${record.tenantId} || ':' || ${record.tripId} || ':' || ${record.userId}, 0)
        )
      `);
      await upsertCalendarEventWithExecutor(tx, service, filter, eventData, record);
    });
    return;
  }

  await upsertCalendarEventWithExecutor(db, service, filter, eventData, record);
}

/** Trip statuses that should have active calendar events. */
const ACTIVE_TRIP_STATUSES = ["published"];

export class CalendarSyncService {
  /**
   * Finds only orphaned events carrying a known VisiteCRM marker and an exact
   * current-record match. Candidates are persisted as pending so a manager
   * can inspect the Google payload and explicitly associate, remove, or
   * dismiss it. No unmarked/manual event is ever imported.
   */
  static async scanLegacyEvents(
    actorUserId: string,
    from = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000),
    to = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
  ): Promise<LegacyCalendarCandidate[]> {
    const [actor] = await db.select({
      tenantId: usersTable.tenantId,
      googleCalendarEnabled: usersTable.googleCalendarEnabled,
    }).from(usersTable).where(eq(usersTable.id, actorUserId)).limit(1);
    if (!actor?.tenantId || !actor.googleCalendarEnabled) return [];

    const service = await getCalendarService(actorUserId);
    if (!service) return [];

    const [googleEvents, trackedEvents, existingReconciliations, trips, payments, clients] = await Promise.all([
      service.listEvents(from, to),
      db.select({ googleEventId: calendarEventsTable.googleEventId })
        .from(calendarEventsTable)
        .where(and(
          eq(calendarEventsTable.tenantId, actor.tenantId),
          eq(calendarEventsTable.userId, actorUserId),
        )),
      db.select()
        .from(calendarReconciliationsTable)
        .where(and(
          eq(calendarReconciliationsTable.tenantId, actor.tenantId),
          eq(calendarReconciliationsTable.userId, actorUserId),
        )),
      db.select({
        id: tripsTable.id,
        name: tripsTable.name,
        description: tripsTable.description,
        destination: tripsTable.destination,
        originCity: tripsTable.originCity,
        departureDate: tripsTable.departureDate,
        returnDate: tripsTable.returnDate,
      }).from(tripsTable).where(eq(tripsTable.tenantId, actor.tenantId)),
      db.select({
        id: paymentsTable.id,
        clientId: paymentsTable.clientId,
        dueDate: paymentsTable.dueDate,
      }).from(paymentsTable).where(eq(paymentsTable.tenantId, actor.tenantId)),
      db.select({
        id: clientsTable.id,
        name: clientsTable.name,
        birthDate: clientsTable.birthDate,
      }).from(clientsTable).where(eq(clientsTable.tenantId, actor.tenantId)),
    ]);

    const trackedIds = new Set(trackedEvents.map((event) => event.googleEventId));
    const reconciledByGoogleId = new Map(existingReconciliations.map((row) => [row.googleEventId, row]));
    const candidates: LegacyCalendarCandidate[] = [];

    for (const event of googleEvents) {
      if (trackedIds.has(event.id)) continue;
      const matches = legacyMatchesForEvent(event, trips, payments, clients);
      if (matches.length === 0) continue;
      // A stable ID that was created but lost locally is recoverable through
      // the normal idempotent sync path, not a pre-deterministic legacy event.
      if (matches.some((match) => stableGoogleEventId({
        tenantId: actor.tenantId!,
        userId: actorUserId,
        eventType: match.type,
        ...(match.type === "trip" ? { tripId: match.id } : {}),
        ...(match.type === "payment" ? { paymentId: match.id } : {}),
        ...(match.type === "birthday" ? { clientId: match.id } : {}),
      }) === event.id)) {
        continue;
      }

      const existingReconciliation = reconciledByGoogleId.get(event.id);
      const type = matches[0].type;
      const candidate: LegacyCalendarCandidate = {
        reconciliationId: existingReconciliation?.id ?? generateId(),
        status: existingReconciliation?.status ?? "pending",
        googleEventId: event.id,
        calendarId: "primary",
        eventType: type,
        eventSummary: event.summary,
        eventDescription: event.description ?? null,
        eventLocation: event.location ?? null,
        eventStartDate: event.startDateTime,
        eventEndDate: event.endDateTime ?? null,
        candidateMatches: matches,
      };
      candidates.push(candidate);

      const existing = existingReconciliation;
      if (existing?.status !== "pending" && existing) continue;
      const values = {
        tenantId: actor.tenantId,
        userId: actorUserId,
        googleEventId: candidate.googleEventId,
        calendarId: candidate.calendarId,
        eventType: candidate.eventType,
        status: "pending" as const,
        eventSummary: candidate.eventSummary,
        eventDescription: candidate.eventDescription,
        eventLocation: candidate.eventLocation,
        eventStartDate: candidate.eventStartDate,
        eventEndDate: candidate.eventEndDate,
        candidateMatches: candidate.candidateMatches,
      };
      if (existing) {
        await db.update(calendarReconciliationsTable).set(values).where(eq(calendarReconciliationsTable.id, existing.id));
      } else {
        await db.insert(calendarReconciliationsTable).values({ id: candidate.reconciliationId, ...values }).onConflictDoNothing({
          target: [calendarReconciliationsTable.userId, calendarReconciliationsTable.googleEventId],
        });
      }
    }

    return candidates;
  }

  static async associateLegacyEvent(
    reconciliationId: string,
    actorUserId: string,
    candidateId: string,
  ): Promise<"associated" | "already-resolved" | "not-found" | "invalid-candidate" | "source-not-found" | "already-associated"> {
    const [reconciliation] = await db.select().from(calendarReconciliationsTable).where(and(
      eq(calendarReconciliationsTable.id, reconciliationId),
      eq(calendarReconciliationsTable.userId, actorUserId),
    )).limit(1);
    if (!reconciliation) return "not-found";
    if (reconciliation.status !== "pending") return "already-resolved";
    const match = reconciliation.candidateMatches.find((candidate) => candidate.id === candidateId);
    if (!match) return "invalid-candidate";

    const resourceCondition = match.type === "trip"
      ? eq(calendarEventsTable.tripId, match.id)
      : match.type === "payment"
        ? eq(calendarEventsTable.paymentId, match.id)
        : eq(calendarEventsTable.clientId, match.id);
    const [existingEvent] = await db.select({ id: calendarEventsTable.id })
      .from(calendarEventsTable).where(and(
        eq(calendarEventsTable.tenantId, reconciliation.tenantId),
        eq(calendarEventsTable.userId, actorUserId),
        eq(calendarEventsTable.eventType, match.type),
        resourceCondition,
      )).limit(1);
    if (existingEvent) return "already-associated";

    let sourceExists = false;
    if (match.type === "trip") {
      const [source] = await db.select({ id: tripsTable.id }).from(tripsTable).where(and(
        eq(tripsTable.id, match.id),
        eq(tripsTable.tenantId, reconciliation.tenantId),
      )).limit(1);
      sourceExists = Boolean(source);
    } else if (match.type === "payment") {
      const [source] = await db.select({ id: paymentsTable.id }).from(paymentsTable).where(and(
        eq(paymentsTable.id, match.id),
        eq(paymentsTable.tenantId, reconciliation.tenantId),
      )).limit(1);
      sourceExists = Boolean(source);
    } else {
      const [source] = await db.select({ id: clientsTable.id }).from(clientsTable).where(and(
        eq(clientsTable.id, match.id),
        eq(clientsTable.tenantId, reconciliation.tenantId),
      )).limit(1);
      sourceExists = Boolean(source);
    }
    if (!sourceExists) return "source-not-found";

    await db.insert(calendarEventsTable).values({
      id: generateId(),
      tenantId: reconciliation.tenantId,
      userId: actorUserId,
      ...(match.type === "trip" ? { tripId: match.id } : {}),
      ...(match.type === "payment" ? { paymentId: match.id } : {}),
      ...(match.type === "birthday" ? { clientId: match.id } : {}),
      googleEventId: reconciliation.googleEventId,
      calendarId: reconciliation.calendarId,
      eventType: match.type,
      title: reconciliation.eventSummary,
      description: reconciliation.eventDescription,
      startDate: reconciliation.eventStartDate,
      endDate: reconciliation.eventEndDate,
      location: reconciliation.eventLocation,
      syncedAt: new Date(),
    });
    await db.update(calendarReconciliationsTable).set({
      status: "associated",
      selectedResourceId: match.id,
      resolvedAt: new Date(),
      resolvedById: actorUserId,
    }).where(and(
      eq(calendarReconciliationsTable.id, reconciliationId),
      eq(calendarReconciliationsTable.status, "pending"),
    ));
    return "associated";
  }

  static async removeLegacyEvent(
    reconciliationId: string,
    actorUserId: string,
  ): Promise<"removed" | "already-resolved" | "not-found" | "service-unavailable" | "delete-failed"> {
    const [reconciliation] = await db.select().from(calendarReconciliationsTable).where(and(
      eq(calendarReconciliationsTable.id, reconciliationId),
      eq(calendarReconciliationsTable.userId, actorUserId),
    )).limit(1);
    if (!reconciliation) return "not-found";
    if (reconciliation.status !== "pending") return "already-resolved";
    const service = await getCalendarService(actorUserId);
    if (!service) return "service-unavailable";
    const deleted = await withCalendarRetry(() => service.deleteEvent(reconciliation.googleEventId));
    if (deleted !== true && deleted !== "not-found") return "delete-failed";
    await db.update(calendarReconciliationsTable).set({
      status: "removed",
      resolvedAt: new Date(),
      resolvedById: actorUserId,
    }).where(and(
      eq(calendarReconciliationsTable.id, reconciliationId),
      eq(calendarReconciliationsTable.status, "pending"),
    ));
    return "removed";
  }

  static async dismissLegacyEvent(
    reconciliationId: string,
    actorUserId: string,
  ): Promise<"dismissed" | "already-resolved" | "not-found"> {
    const [reconciliation] = await db.select().from(calendarReconciliationsTable).where(and(
      eq(calendarReconciliationsTable.id, reconciliationId),
      eq(calendarReconciliationsTable.userId, actorUserId),
    )).limit(1);
    if (!reconciliation) return "not-found";
    if (reconciliation.status !== "pending") return "already-resolved";
    await db.update(calendarReconciliationsTable).set({
      status: "dismissed",
      resolvedAt: new Date(),
      resolvedById: actorUserId,
    }).where(and(
      eq(calendarReconciliationsTable.id, reconciliationId),
      eq(calendarReconciliationsTable.status, "pending"),
    ));
    return "dismissed";
  }

  /**
   * syncTrip — syncs a single trip to all eligible connected users.
   * Called from background hooks (trips/reservations mutations) so fan-out is appropriate.
   * If the trip is not in an active status, removes all existing calendar events for it.
   * Cleans up stale seller events when a seller no longer has confirmed reservations.
   */
  static async syncTrip(tripId: string): Promise<void> {
    try {
      const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
      if (!trip) return;

      // Non-active trip → remove all calendar events
      if (!ACTIVE_TRIP_STATUSES.includes(trip.status)) {
        await CalendarSyncService.deleteEventsForTrip(tripId);
        return;
      }

      const reservations = await db.select({
        clientId: reservationsTable.clientId,
        sellerId: reservationsTable.sellerId,
        totalValue: reservationsTable.totalValue,
        seats: reservationsTable.seats,
      }).from(reservationsTable)
        .where(and(eq(reservationsTable.tripId, tripId), eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED)));

      const clientIds = reservations.map((r) => r.clientId);
      let clients: { id: string; name: string; email: string }[] = [];
      if (clientIds.length > 0) {
        clients = await db.select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email })
          .from(clientsTable)
          .where(eq(clientsTable.tenantId, trip.tenantId));
        clients = clients.filter((c) => clientIds.includes(c.id));
      }

      const totalValue = reservations.reduce((s, r) => s + Number(r.totalValue), 0);
      // Count individual seats across all confirmed reservations (one reservation may cover multiple seats)
      const confirmedPassengerCount = reservations.reduce(
        (sum, r) => sum + (Array.isArray(r.seats) ? r.seats.length : 1),
        0,
      );

      const baseEvent = {
        summary: `🚌 ${trip.name}`,
        location: trip.originCity ? `${trip.originCity} → ${trip.destination}` : trip.destination,
        startDateTime: trip.departureDate,
        endDateTime: trip.returnDate ?? addHours(trip.departureDate, 12),
      };

      const adminUsers = await db.select({
        id: usersTable.id,
        googleCalendarEnabled: usersTable.googleCalendarEnabled,
      }).from(usersTable)
        .where(and(
          eq(usersTable.tenantId, trip.tenantId),
          eq(usersTable.googleCalendarEnabled, true),
          eq(usersTable.role, ROLES.AGENCY_ADMIN),
        ));

      for (const admin of adminUsers) {
        const svc = await getCalendarService(admin.id);
        if (!svc) continue;
        const description = [
          `🚌 VIAGEM: ${trip.name}`,
          ``,
          `📍 ${trip.originCity ?? ""} → ${trip.destination}`,
          `📅 Saída: ${fmtDate(trip.departureDate)}`,
          trip.returnDate ? `🔙 Retorno: ${fmtDate(trip.returnDate)}` : null,
          ``,
          `👥 Passageiros confirmados: ${confirmedPassengerCount}`,
          `💰 Receita Total: ${fmtCurrency(totalValue)}`,
          trip.description ?? null,
        ].filter(Boolean).join("\n");

        await upsertCalendarEvent(
          svc,
          [
            eq(calendarEventsTable.tripId, tripId),
            eq(calendarEventsTable.userId, admin.id),
            eq(calendarEventsTable.eventType, "trip"),
          ],
          { ...baseEvent, description, attendees: clients.map((c) => c.email).filter(Boolean) },
          { tenantId: trip.tenantId, userId: admin.id, tripId, eventType: "trip" }
        );
      }

      const eligibleSellerIds = [...new Set(reservations.map((r) => r.sellerId).filter(Boolean))] as string[];

      // Delete stale seller events for sellers who no longer have confirmed reservations
      const existingSellerEvents = await db.select({
        id: calendarEventsTable.id,
        userId: calendarEventsTable.userId,
        googleEventId: calendarEventsTable.googleEventId,
      }).from(calendarEventsTable)
        .where(and(
          eq(calendarEventsTable.tripId, tripId),
          eq(calendarEventsTable.eventType, "trip"),
        ));

      for (const ev of existingSellerEvents) {
        if (!ev.userId) continue;
        if (!eligibleSellerIds.includes(ev.userId)) {
          // Check if this is a seller (admins should keep their events)
          const [userRec] = await db.select({ role: usersTable.role })
            .from(usersTable).where(eq(usersTable.id, ev.userId)).limit(1);
          if (userRec?.role === ROLES.SALES) {
            const svc = await getCalendarService(ev.userId);
            if (svc) await withCalendarRetry(() => svc.deleteEvent(ev.googleEventId)).catch(() => {});
            await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, ev.id));
          }
        }
      }

      // Upsert events for eligible sellers
      if (eligibleSellerIds.length > 0) {
        const sellers = await db.select({
          id: usersTable.id,
          name: usersTable.name,
          googleCalendarEnabled: usersTable.googleCalendarEnabled,
        }).from(usersTable)
          .where(and(
            eq(usersTable.tenantId, trip.tenantId),
            eq(usersTable.googleCalendarEnabled, true),
            eq(usersTable.role, ROLES.SALES),
          ));

        for (const seller of sellers) {
          if (!eligibleSellerIds.includes(seller.id)) continue;
          const svc = await getCalendarService(seller.id);
          if (!svc) continue;

          const sellerReservations = reservations.filter((r) => r.sellerId === seller.id);
          const sellerClientIds = sellerReservations.map((r) => r.clientId);
          const sellerClients = clients.filter((c) => sellerClientIds.includes(c.id));
          const sellerTotal = sellerReservations.reduce((s, r) => s + Number(r.totalValue), 0);

          const description = [
            `🚌 VIAGEM: ${trip.name}`,
            ``,
            `📍 ${trip.originCity ?? ""} → ${trip.destination}`,
            `📅 ${fmtDate(trip.departureDate)}`,
            ``,
            `👥 SEUS CLIENTES (${sellerClients.length}):`,
            ...sellerClients.map((c) => `• ${c.name}`),
            ``,
            `💰 Total: ${fmtCurrency(sellerTotal)}`,
          ].join("\n");

          await upsertCalendarEvent(
            svc,
            [
              eq(calendarEventsTable.tripId, tripId),
              eq(calendarEventsTable.userId, seller.id),
              eq(calendarEventsTable.eventType, "trip"),
            ],
            { ...baseEvent, description, attendees: sellerClients.map((c) => c.email).filter(Boolean) },
            { tenantId: trip.tenantId, userId: seller.id, tripId, eventType: "trip" }
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "calendar-sync: syncTrip failed");
    }
  }

  /**
   * syncTrips — syncs each affected trip once after a reservation move.
   * Keeping the IDs unique prevents duplicate calendar work when callers
   * provide the same trip as both the origin and destination.
   */
  static async syncTrips(tripIds: Iterable<string>): Promise<void> {
    for (const tripId of new Set(tripIds)) {
      await CalendarSyncService.syncTrip(tripId);
    }
  }

  /**
   * syncTripOnReservationCancellation — explicit sync triggered when an active
   * reservation is cancelled or refunded. Ensures the trip's calendar events are
   * updated to reflect the reduced confirmed-passenger count and removes stale
   * seller events for sellers who no longer have any confirmed reservations on
   * this trip after the cancellation.
   *
   * Delegates to syncTrip which queries only "confirmed" reservations, so the
   * cancelled reservation is automatically excluded from all event descriptions.
   */
  static async syncTripOnReservationCancellation(tripId: string): Promise<void> {
    return CalendarSyncService.syncTrip(tripId);
  }

  /**
   * syncTripForUser — syncs a single trip to one specific user's calendar.
   * Used by user-initiated operations (manual sync, post-connect).
   */
  static async syncTripForUser(tripId: string, actorUserId: string): Promise<void> {
    try {
      const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
      if (!trip) return;

      const [actor] = await db.select({ role: usersTable.role })
        .from(usersTable)
        .where(and(eq(usersTable.id, actorUserId), eq(usersTable.tenantId, trip.tenantId)))
        .limit(1);
      if (!actor) return;

      const svc = await getCalendarService(actorUserId);
      if (!svc) return;

      // Non-active trip → remove user's existing event (if any) and stop
      if (!ACTIVE_TRIP_STATUSES.includes(trip.status)) {
        const [existing] = await db.select()
          .from(calendarEventsTable)
          .where(and(
            eq(calendarEventsTable.tripId, tripId),
            eq(calendarEventsTable.userId, actorUserId),
            eq(calendarEventsTable.eventType, "trip"),
          )).limit(1);
        if (existing) {
          await withCalendarRetry(() => svc.deleteEvent(existing.googleEventId)).catch(() => {});
          await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, existing.id));
        }
        return;
      }

      const reservations = await db.select({
        clientId: reservationsTable.clientId,
        sellerId: reservationsTable.sellerId,
        totalValue: reservationsTable.totalValue,
      }).from(reservationsTable)
        .where(and(eq(reservationsTable.tripId, tripId), eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED)));

      let visibleReservations = reservations;
      if (actor.role === ROLES.SALES) {
        visibleReservations = reservations.filter((r) => r.sellerId === actorUserId);
        // Seller has no confirmed reservations for this trip → remove any existing event and skip
        if (visibleReservations.length === 0) {
          const [existing] = await db.select()
            .from(calendarEventsTable)
            .where(and(
              eq(calendarEventsTable.tripId, tripId),
              eq(calendarEventsTable.userId, actorUserId),
              eq(calendarEventsTable.eventType, "trip"),
            )).limit(1);
          if (existing) {
            await withCalendarRetry(() => svc.deleteEvent(existing.googleEventId)).catch(() => {});
            await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, existing.id));
          }
          return;
        }
      }

      const clientIds = visibleReservations.map((r) => r.clientId);
      let clients: { id: string; name: string; email: string }[] = [];
      if (clientIds.length > 0) {
        clients = await db.select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email })
          .from(clientsTable)
          .where(eq(clientsTable.tenantId, trip.tenantId));
        clients = clients.filter((c) => clientIds.includes(c.id));
      }

      const totalValue = visibleReservations.reduce((s, r) => s + Number(r.totalValue), 0);

      const description = [
        `🚌 VIAGEM: ${trip.name}`,
        ``,
        `📍 ${trip.originCity ?? ""} → ${trip.destination}`,
        `📅 Saída: ${fmtDate(trip.departureDate)}`,
        trip.returnDate ? `🔙 Retorno: ${fmtDate(trip.returnDate)}` : null,
        ``,
        `👥 Passageiros: ${visibleReservations.length}`,
        `💰 Total: ${fmtCurrency(totalValue)}`,
      ].filter(Boolean).join("\n");

      await upsertCalendarEvent(
        svc,
        [
          eq(calendarEventsTable.tripId, tripId),
          eq(calendarEventsTable.userId, actorUserId),
          eq(calendarEventsTable.eventType, "trip"),
        ],
        {
          summary: `🚌 ${trip.name}`,
          location: trip.originCity ? `${trip.originCity} → ${trip.destination}` : trip.destination,
          startDateTime: trip.departureDate,
          endDateTime: trip.returnDate ?? addHours(trip.departureDate, 12),
          description,
          attendees: clients.map((c) => c.email).filter(Boolean),
        },
        { tenantId: trip.tenantId, userId: actorUserId, tripId, eventType: "trip" }
      );
    } catch (err) {
      logger.error({ err }, "calendar-sync: syncTripForUser failed");
    }
  }

  static async deleteEventsForTrip(tripId: string): Promise<void> {
    try {
      const events = await db.select({
        id: calendarEventsTable.id,
        userId: calendarEventsTable.userId,
        googleEventId: calendarEventsTable.googleEventId,
      }).from(calendarEventsTable).where(eq(calendarEventsTable.tripId, tripId));

      for (const ev of events) {
        if (ev.userId) {
          const svc = await getCalendarService(ev.userId);
          if (svc) await withCalendarRetry(() => svc.deleteEvent(ev.googleEventId));
        }
        await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, ev.id));
      }
    } catch (err) {
      logger.error({ err }, "calendar-sync: deleteEventsForTrip failed");
    }
  }

  static async deleteEventsForPayment(paymentId: string): Promise<void> {
    try {
      const events = await db.select({
        id: calendarEventsTable.id,
        userId: calendarEventsTable.userId,
        googleEventId: calendarEventsTable.googleEventId,
      }).from(calendarEventsTable).where(eq(calendarEventsTable.paymentId, paymentId));

      for (const ev of events) {
        if (ev.userId) {
          const svc = await getCalendarService(ev.userId);
          if (svc) await withCalendarRetry(() => svc.deleteEvent(ev.googleEventId));
        }
        await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, ev.id));
      }
    } catch (err) {
      logger.error({ err }, "calendar-sync: deleteEventsForPayment failed");
    }
  }

  /**
   * syncPayment — syncs a payment to all eligible connected users (fan-out).
   * Called from background hooks (payment mutations).
   */
  static async syncPayment(paymentId: string): Promise<void> {
    try {
      const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).limit(1);
      if (!payment || !payment.dueDate) return;

      if (payment.status === PAYMENT_STATUS.PAID || payment.status === PAYMENT_STATUS.CANCELLED) {
        await CalendarSyncService.deleteEventsForPayment(paymentId);
        return;
      }

      let clientName = "Cliente";
      let clientEmail: string | null = null;
      let sellerId: string | null = null;

      if (payment.clientId) {
        const [client] = await db.select({
          name: clientsTable.name,
          email: clientsTable.email,
          createdById: clientsTable.createdById,
        }).from(clientsTable).where(eq(clientsTable.id, payment.clientId)).limit(1);
        if (client) {
          clientName = client.name;
          clientEmail = client.email;
          sellerId = client.createdById;
        }
      }

      const baseEvent = {
        summary: `💰 Pagamento: ${clientName}`,
        description: [
          `💰 PAGAMENTO PENDENTE`,
          ``,
          `Cliente: ${clientName}`,
          `Valor: ${fmtCurrency(payment.amount)}`,
          `Vencimento: ${format(payment.dueDate, "dd/MM/yyyy", { locale: ptBR })}`,
          `Parcela: ${payment.installmentNumber}/${payment.totalInstallments}`,
          payment.description ? `Descrição: ${payment.description}` : null,
          ``,
          `⚠️ Confirmar recebimento após pagamento`,
        ].filter(Boolean).join("\n"),
        startDateTime: payment.dueDate,
        endDateTime: payment.dueDate,
      };

      const adminUsers = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(and(
          eq(usersTable.tenantId, payment.tenantId),
          eq(usersTable.googleCalendarEnabled, true),
          eq(usersTable.role, ROLES.AGENCY_ADMIN),
        ));

      for (const admin of adminUsers) {
        const svc = await getCalendarService(admin.id);
        if (!svc) continue;
        await upsertCalendarEvent(
          svc,
          [
            eq(calendarEventsTable.paymentId, paymentId),
            eq(calendarEventsTable.userId, admin.id),
            eq(calendarEventsTable.eventType, "payment"),
          ],
          { ...baseEvent, attendees: clientEmail ? [clientEmail] : [] },
          { tenantId: payment.tenantId, userId: admin.id, paymentId, eventType: "payment" }
        );
      }

      if (sellerId) {
        const [seller] = await db.select({ id: usersTable.id, googleCalendarEnabled: usersTable.googleCalendarEnabled, role: usersTable.role })
          .from(usersTable)
          .where(and(eq(usersTable.id, sellerId), eq(usersTable.tenantId, payment.tenantId))).limit(1);
        if (seller?.googleCalendarEnabled && seller.role === ROLES.SALES) {
          const svc = await getCalendarService(seller.id);
          if (svc) {
            await upsertCalendarEvent(
              svc,
              [
                eq(calendarEventsTable.paymentId, paymentId),
                eq(calendarEventsTable.userId, seller.id),
                eq(calendarEventsTable.eventType, "payment"),
              ],
              { ...baseEvent, attendees: clientEmail ? [clientEmail] : [] },
              { tenantId: payment.tenantId, userId: seller.id, paymentId, eventType: "payment" }
            );
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "calendar-sync: syncPayment failed");
    }
  }

  /**
   * syncPaymentForUser — syncs a payment to one specific user's calendar.
   * Used by user-initiated operations (manual sync, post-connect).
   */
  static async syncPaymentForUser(paymentId: string, actorUserId: string): Promise<void> {
    try {
      const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).limit(1);
      if (!payment || !payment.dueDate) return;

      if (payment.status === PAYMENT_STATUS.PAID || payment.status === PAYMENT_STATUS.CANCELLED) return;

      const [actor] = await db.select({ role: usersTable.role, tenantId: usersTable.tenantId })
        .from(usersTable)
        .where(and(eq(usersTable.id, actorUserId), eq(usersTable.tenantId, payment.tenantId)))
        .limit(1);
      if (!actor) return;

      let clientName = "Cliente";
      let clientEmail: string | null = null;
      let sellerId: string | null = null;

      if (payment.clientId) {
        const [client] = await db.select({ name: clientsTable.name, email: clientsTable.email, createdById: clientsTable.createdById })
          .from(clientsTable).where(eq(clientsTable.id, payment.clientId)).limit(1);
        if (client) {
          clientName = client.name;
          clientEmail = client.email;
          sellerId = client.createdById;
        }
      }

      if (actor.role === ROLES.SALES && sellerId !== actorUserId) return;

      const svc = await getCalendarService(actorUserId);
      if (!svc) return;

      await upsertCalendarEvent(
        svc,
        [
          eq(calendarEventsTable.paymentId, paymentId),
          eq(calendarEventsTable.userId, actorUserId),
          eq(calendarEventsTable.eventType, "payment"),
        ],
        {
          summary: `💰 Pagamento: ${clientName}`,
          description: [
            `💰 PAGAMENTO PENDENTE`,
            ``,
            `Cliente: ${clientName}`,
            `Valor: ${fmtCurrency(payment.amount)}`,
            `Vencimento: ${format(payment.dueDate, "dd/MM/yyyy", { locale: ptBR })}`,
            payment.description ? `Descrição: ${payment.description}` : null,
          ].filter(Boolean).join("\n"),
          startDateTime: payment.dueDate,
          endDateTime: payment.dueDate,
          attendees: clientEmail ? [clientEmail] : [],
        },
        { tenantId: payment.tenantId, userId: actorUserId, paymentId, eventType: "payment" }
      );
    } catch (err) {
      logger.error({ err }, "calendar-sync: syncPaymentForUser failed");
    }
  }

  /**
   * syncBirthday — syncs a client birthday to all eligible connected users (fan-out).
   * Called from background hooks (client create/update).
   */
  static async syncBirthday(clientId: string): Promise<void> {
    try {
      const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId)).limit(1);
      if (!client) return;

      // birthDate removed → delete all tracked birthday events for this client
      if (!client.birthDate) {
        const existingEvents = await db.select({
          id: calendarEventsTable.id,
          userId: calendarEventsTable.userId,
          googleEventId: calendarEventsTable.googleEventId,
        }).from(calendarEventsTable)
          .where(and(
            eq(calendarEventsTable.clientId, clientId),
            eq(calendarEventsTable.eventType, "birthday"),
          ));
        for (const ev of existingEvents) {
          if (!ev.userId) continue;
          const svc = await getCalendarService(ev.userId);
          if (svc) await withCalendarRetry(() => svc.deleteEvent(ev.googleEventId)).catch(() => {});
          await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, ev.id));
        }
        return;
      }

      const birthDate = new Date(client.birthDate);
      const now = new Date();
      const currentYear = now.getFullYear();
      let nextBirthday = new Date(currentYear, birthDate.getMonth(), birthDate.getDate());
      if (nextBirthday < now) nextBirthday = new Date(currentYear + 1, birthDate.getMonth(), birthDate.getDate());

      const eventData = {
        summary: `🎂 Aniversário: ${client.name}`,
        description: `Aniversário de ${client.name}\n\nEnviar mensagem de felicitações!`,
        startDateTime: nextBirthday,
        endDateTime: nextBirthday,
      };

      const tenantId = client.tenantId;

      const adminUsers = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.googleCalendarEnabled, true), eq(usersTable.role, ROLES.AGENCY_ADMIN)));

      for (const admin of adminUsers) {
        const svc = await getCalendarService(admin.id);
        if (!svc) continue;
        await upsertCalendarEvent(
          svc,
          [
            eq(calendarEventsTable.clientId, clientId),
            eq(calendarEventsTable.userId, admin.id),
            eq(calendarEventsTable.eventType, "birthday"),
          ],
          eventData,
          { tenantId, userId: admin.id, clientId, eventType: "birthday" }
        );
      }

      const sellerId = client.createdById;
      if (sellerId) {
        const [seller] = await db.select({ id: usersTable.id, googleCalendarEnabled: usersTable.googleCalendarEnabled, role: usersTable.role })
          .from(usersTable)
          .where(and(eq(usersTable.id, sellerId), eq(usersTable.tenantId, tenantId))).limit(1);
        if (seller?.googleCalendarEnabled && seller.role === ROLES.SALES) {
          const svc = await getCalendarService(seller.id);
          if (svc) {
            await upsertCalendarEvent(
              svc,
              [
                eq(calendarEventsTable.clientId, clientId),
                eq(calendarEventsTable.userId, seller.id),
                eq(calendarEventsTable.eventType, "birthday"),
              ],
              { ...eventData, description: `Aniversário de ${client.name}\n\nLembre-se de enviar felicitações!` },
              { tenantId, userId: seller.id, clientId, eventType: "birthday" }
            );
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "calendar-sync: syncBirthday failed");
    }
  }

  /**
   * syncBirthdayForUser — syncs a client birthday to one specific user's calendar.
   */
  static async syncBirthdayForUser(clientId: string, actorUserId: string): Promise<void> {
    try {
      const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId)).limit(1);
      if (!client) return;

      const [actor] = await db.select({ role: usersTable.role })
        .from(usersTable)
        .where(and(eq(usersTable.id, actorUserId), eq(usersTable.tenantId, client.tenantId)))
        .limit(1);
      if (!actor) return;

      const svc = await getCalendarService(actorUserId);
      if (!svc) return;

      // birthDate removed → delete user's existing birthday event for this client
      if (!client.birthDate) {
        const [existing] = await db.select()
          .from(calendarEventsTable)
          .where(and(
            eq(calendarEventsTable.clientId, clientId),
            eq(calendarEventsTable.userId, actorUserId),
            eq(calendarEventsTable.eventType, "birthday"),
          )).limit(1);
        if (existing) {
          await withCalendarRetry(() => svc.deleteEvent(existing.googleEventId)).catch(() => {});
          await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, existing.id));
        }
        return;
      }

      if (actor.role === ROLES.SALES && client.createdById !== actorUserId) return;

      const birthDate = new Date(client.birthDate);
      const now = new Date();
      const currentYear = now.getFullYear();
      let nextBirthday = new Date(currentYear, birthDate.getMonth(), birthDate.getDate());
      if (nextBirthday < now) nextBirthday = new Date(currentYear + 1, birthDate.getMonth(), birthDate.getDate());

      await upsertCalendarEvent(
        svc,
        [
          eq(calendarEventsTable.clientId, clientId),
          eq(calendarEventsTable.userId, actorUserId),
          eq(calendarEventsTable.eventType, "birthday"),
        ],
        {
          summary: `🎂 Aniversário: ${client.name}`,
          description: `Aniversário de ${client.name}\n\nEnviar mensagem de felicitações!`,
          startDateTime: nextBirthday,
          endDateTime: nextBirthday,
        },
        { tenantId: client.tenantId, userId: actorUserId, clientId, eventType: "birthday" }
      );
    } catch (err) {
      logger.error({ err }, "calendar-sync: syncBirthdayForUser failed");
    }
  }

  /**
   * syncAllForUser — syncs all relevant data for a single user's calendar.
   * Used by manual sync and post-OAuth-connect (user-scoped, no fan-out).
   */
  static async syncAllForUser(actorUserId: string): Promise<number> {
    let synced = 0;

    const [actor] = await db.select({ role: usersTable.role, tenantId: usersTable.tenantId })
      .from(usersTable)
      .where(eq(usersTable.id, actorUserId))
      .limit(1);
    if (!actor) return 0;

    const tenantId = actor.tenantId;
    if (!tenantId) return synced;

    const trips = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.tenantId, tenantId), eq(tripsTable.status, TRIP_STATUS.PUBLISHED)));

    for (const t of trips) {
      await CalendarSyncService.syncTripForUser(t.id, actorUserId);
      synced++;
    }

    const payments = await db.select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.tenantId, tenantId), eq(paymentsTable.status, PAYMENT_STATUS.PENDING)));

    for (const p of payments) {
      await CalendarSyncService.syncPaymentForUser(p.id, actorUserId);
      synced++;
    }

    const clients = await db.select({ id: clientsTable.id })
      .from(clientsTable)
      .where(eq(clientsTable.tenantId, tenantId));

    for (const c of clients) {
      await CalendarSyncService.syncBirthdayForUser(c.id, actorUserId);
      synced++;
    }

    return synced;
  }

  /**
   * syncAll — tenant-wide fan-out sync for all connected users.
   * @deprecated For user-initiated requests, use syncAllForUser instead.
   */
  static async syncAll(tenantId: string): Promise<number> {
    let synced = 0;

    const trips = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.tenantId, tenantId), eq(tripsTable.status, TRIP_STATUS.PUBLISHED)));
    for (const t of trips) {
      await CalendarSyncService.syncTrip(t.id);
      synced++;
    }

    const payments = await db.select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.tenantId, tenantId), eq(paymentsTable.status, PAYMENT_STATUS.PENDING)));
    for (const p of payments) {
      await CalendarSyncService.syncPayment(p.id);
      synced++;
    }

    const clients = await db.select({ id: clientsTable.id })
      .from(clientsTable)
      .where(and(eq(clientsTable.tenantId, tenantId)));
    for (const c of clients) {
      await CalendarSyncService.syncBirthday(c.id);
      synced++;
    }

    return synced;
  }
}

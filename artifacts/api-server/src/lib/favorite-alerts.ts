import { db, clientFavoritesTable, tripsTable, clientsTable, tenantsTable } from "@workspace/db";
import { eq, and, lte, isNull, gt } from "drizzle-orm";
import { renderFavoriteLowAvailabilityEmail } from "@workspace/email";
import { logger } from "./logger";
import { dispatchOutboundMessage } from "../services/outbound-delivery";

const LOW_AVAILABILITY_THRESHOLD = 5;

const BRAZIL_TZ = "America/Sao_Paulo";

function formatDateBRServer(dt: unknown): string {
  if (!dt) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dt instanceof Date ? dt : new Date(dt as string));
}

export async function runFavoriteLowAvailabilityAlertCron(): Promise<void> {
  logger.info("[favorite-alerts] Starting low-availability alert cron");

  const now = new Date();

  const rows = await db
    .select({
      favoriteId: clientFavoritesTable.id,
      tenantId: clientFavoritesTable.tenantId,
      clientId: clientFavoritesTable.clientId,
      itemId: clientFavoritesTable.itemId,
      tripId: tripsTable.id,
      tripName: tripsTable.name,
      tripDestination: tripsTable.destination,
      tripSlug: tripsTable.slug,
      departureDate: tripsTable.departureDate,
      availableSeats: tripsTable.availableSeats,
      tripStatus: tripsTable.status,
      clientName: clientsTable.name,
      clientEmail: clientsTable.email,
      agencyName: tenantsTable.name,
      agencyEmail: tenantsTable.email,
      agencyPhone: tenantsTable.phone,
    })
    .from(clientFavoritesTable)
    .innerJoin(tripsTable, eq(tripsTable.id, clientFavoritesTable.itemId))
    .innerJoin(clientsTable, eq(clientsTable.id, clientFavoritesTable.clientId))
    .innerJoin(tenantsTable, eq(tenantsTable.id, clientFavoritesTable.tenantId))
    .where(
      and(
        eq(clientFavoritesTable.itemType, "trip"),
        lte(tripsTable.availableSeats, LOW_AVAILABILITY_THRESHOLD),
        gt(tripsTable.availableSeats, 0),
        eq(tripsTable.status, "published"),
        gt(tripsTable.departureDate, now),
        isNull(clientFavoritesTable.lowAvailabilityNotifiedAt),
      ),
    );

  if (rows.length === 0) {
    logger.info("[favorite-alerts] No favorites to notify");
    return;
  }

  logger.info({ count: rows.length }, "[favorite-alerts] Notifying clients about low availability");

  const storePublicBase = process.env["STORE_PUBLIC_BASE"] ?? "";

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const tripUrl = storePublicBase
      ? `${storePublicBase}/viagem/${row.tripSlug}`
      : "";

    const emailProps = {
      clientName: row.clientName,
      clientEmail: row.clientEmail ?? "",
      agencyName: row.agencyName,
      agencyEmail: row.agencyEmail ?? "",
      agencyPhone: row.agencyPhone ?? "",
      tripName: row.tripName,
      tripDestination: row.tripDestination,
      departureDate: formatDateBRServer(row.departureDate),
      availableSeats: row.availableSeats,
      tripUrl,
    };
    try {
      const result = await dispatchOutboundMessage({
        tenantId: row.tenantId,
        eventType: "favorite-low-availability",
        idempotencyKey: `favorite-low-availability:${row.tenantId}:${row.clientId}:${row.itemId}`,
        recipient: { type: "client", id: row.clientId },
        email: {
          subject: `⚠️ Últimas vagas! "${row.tripName}" está quase esgotada`,
          html: renderFavoriteLowAvailabilityEmail(emailProps),
          senderName: row.agencyName,
        },
        whatsapp: {
          text: `⚠️ Últimas vagas!\n\nOlá, ${row.clientName.split(" ")[0]}! A viagem "${row.tripName}" para ${row.tripDestination} está quase esgotada.\nRestam apenas ${row.availableSeats} ${row.availableSeats === 1 ? "vaga" : "vagas"}.\n\n📅 Saída: ${emailProps.departureDate}${tripUrl ? `\n\nGaranta sua vaga: ${tripUrl}` : ""}`,
        },
        origin: "favorite-alerts",
        metadata: { favoriteId: row.favoriteId, clientId: row.clientId, itemId: row.itemId },
      });
      const hasDeliverable = result.deliveries.some((delivery) =>
        delivery.status === "pending" || delivery.status === "processing" || delivery.status === "accepted",
      );
      if (hasDeliverable) {
        await db
          .update(clientFavoritesTable)
          .set({ lowAvailabilityNotifiedAt: new Date() })
          .where(eq(clientFavoritesTable.id, row.favoriteId));
        sent++;
        logger.info(
          { favoriteId: row.favoriteId, tripName: row.tripName, clientEmail: row.clientEmail },
          "[favorite-alerts] Alert sent",
        );
      } else {
        failed++;
        logger.warn(
          { favoriteId: row.favoriteId, error: "No channel available" },
          "[favorite-alerts] Failed to send alert",
        );
      }
    } catch (error) {
      failed++;
      logger.warn({ favoriteId: row.favoriteId, error }, "[favorite-alerts] Failed to queue alert");
    }
  }

  logger.info({ sent, failed }, "[favorite-alerts] Cron complete");
}

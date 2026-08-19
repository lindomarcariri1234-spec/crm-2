import { Worker } from "bullmq";
import { db, reservationsTable, tripsTable, clientsTable, tenantsTable, paymentsTable, emailLogsTable, storesTable, usersTable, referralsTable, referralSettingsTable, systemConfigsTable, npsInvitationsTable, reservationInstallmentsTable } from "@workspace/db";
import { eq, and, gt, sql, gte, lt, lte, isNull, isNotNull, notLike, like, inArray, not, exists } from "drizzle-orm";
import { sendReminderHtmlEmail, sendReservationConfirmationEmail, sendReferralExpiringSoonEmail, sendNpsSurveyEmail } from "@workspace/email";
import { dispatchReferralExpiredEmail, dispatchReferralExpiringSoonEmail, dispatchReferralBonusReleasedEmail } from "../queues/email-helpers";
import { dispatchWhatsAppBoardingReminder, dispatchWhatsAppPagamentoPendente, getWhatsAppNotificationSettings } from "../queues/whatsapp-helpers";
import { getRedisConnection } from "../lib/redis";
import { attachCircuitBreaker } from "../lib/worker-circuit-breaker";
import { logger } from "../lib/logger";
import { runExpiredReservationsCron } from "../lib/expired-reservations";
import { runSeatReconciliationCron } from "../lib/seat-reconciliation";
import { sendPushNotification } from "../lib/push-notifications";
import type { ReminderJobData } from "../queues/index";
import { formatBRL, localToday } from "@workspace/shared";
import { RESERVATION_STATUS, PAYMENT_STATUS, ROLES } from "@workspace/permissions";
import { buildEmailPropsFromReservation } from "../queues/email-helpers";
import { generateId } from "../lib/id";
import { MAX_AUTO_RETRY_ATTEMPTS } from "../lib/email-retry-constants";

const BRAZIL_TZ = "America/Sao_Paulo";

/**
 * Returns {start, end} UTC Date boundaries for a Brazil calendar day that is
 * `daysFromNow` calendar days ahead of today (BRT).
 * Brazil never observes DST (UTC-3 year-round), so midnight BRT = 03:00 UTC.
 */
function brazilDayWindow(daysFromNow: number): { start: Date; end: Date } {
  const todayBR = localToday(); // "YYYY-MM-DD" in America/Sao_Paulo
  const baseMs = new Date(todayBR + "T12:00:00Z").getTime(); // noon UTC, safe mid-day
  const targetDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(baseMs + daysFromNow * 86_400_000));
  // Brazil midnight = 00:00 BRT = 03:00 UTC
  const start = new Date(targetDate + "T03:00:00Z");
  const end   = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

/** Format a DB timestamp as "dd/MM/yyyy" in Brazil timezone (server is UTC). */
function formatDateBRServer(dt: unknown): string {
  if (!dt) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TZ, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(dt instanceof Date ? dt : new Date(dt as string));
}

function escapeHtml(str: string | null | undefined): string {
  return (str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ────────────────────────────────────────────────────────────
// D-1 Boarding reminder
// ────────────────────────────────────────────────────────────

async function processBoardingReminders(): Promise<void> {
  // Query a wide window (D-1 through D-14) so configurable reminder days are covered.
  // Per-tenant settings determine which days actually trigger.
  const MAX_BOARDING_REMINDER_DAYS = 14;
  const { start: windowStart } = brazilDayWindow(1);
  const { end: windowEnd } = brazilDayWindow(MAX_BOARDING_REMINDER_DAYS);

  const rows = await db
    .select({
      reservationId: reservationsTable.id,
      reservationNumber: reservationsTable.reservationNumber,
      voucherCode: reservationsTable.voucherCode,
      seats: reservationsTable.seats,
      tenantId: reservationsTable.tenantId,
      clientId: reservationsTable.clientId,
      tripId: reservationsTable.tripId,
      tripName: tripsTable.name,
      tripDestination: tripsTable.destination,
      departureDate: tripsTable.departureDate,
      boardingPoints: tripsTable.boardingPoints,
      clientName: clientsTable.name,
      clientEmail: clientsTable.email,
      clientExpoPushToken: clientsTable.expoPushToken,
      agencyName: tenantsTable.name,
      agencySlug: tenantsTable.slug,
      agencyWebsite: tenantsTable.website,
    })
    .from(reservationsTable)
    .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .innerJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
    .innerJoin(tenantsTable, eq(reservationsTable.tenantId, tenantsTable.id))
    .where(
      and(
        eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
        gte(tripsTable.departureDate, windowStart),
        lt(tripsTable.departureDate, windowEnd),
      ),
    );

  logger.info({ count: rows.length }, "[reminder:boarding] Found reservations in D-1..D-14 window");

  // Cache tenant settings to avoid repeated DB lookups
  const tenantSettingsCache = new Map<string, Awaited<ReturnType<typeof getWhatsAppNotificationSettings>>>();
  async function getTenantSettings(tenantId: string) {
    if (!tenantSettingsCache.has(tenantId)) {
      tenantSettingsCache.set(tenantId, await getWhatsAppNotificationSettings(tenantId));
    }
    return tenantSettingsCache.get(tenantId)!;
  }

  // Compute today's Brazil date for day-offset calculation
  const nowBrazil = new Date(new Date().toLocaleString("en-US", { timeZone: BRAZIL_TZ }));
  const todayBrazil = new Date(nowBrazil.getFullYear(), nowBrazil.getMonth(), nowBrazil.getDate());

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const depDate = row.departureDate
      ? formatDateBRServer(row.departureDate)
      : "Amanhã";

    // Determine how many days until departure (from Brazil's "today")
    let daysUntilDeparture = 1;
    if (row.departureDate) {
      const dep = new Date(row.departureDate);
      const depBrazil = new Date(dep.getFullYear(), dep.getMonth(), dep.getDate());
      daysUntilDeparture = Math.round((depBrazil.getTime() - todayBrazil.getTime()) / (1000 * 60 * 60 * 24));
    }

    // WhatsApp boarding reminder — check if today is a configured reminder day for this tenant
    const settings = await getTenantSettings(row.tenantId);
    const reminderDays = settings.boardingReminderDaysBeforeTrip?.length
      ? settings.boardingReminderDaysBeforeTrip
      : [1];
    if (reminderDays.includes(daysUntilDeparture)) {
      const waPoints = (row.boardingPoints ?? []) as { id: string; name: string; time?: string }[];
      dispatchWhatsAppBoardingReminder({
        reservationId: row.reservationId,
        tenantId: row.tenantId,
        tripName: row.tripDestination ?? row.tripName,
        departureDate: depDate,
        boardingPoints: waPoints,
        tenantName: row.agencyName,
      }).catch((err) =>
        logger.warn({ err, reservationId: row.reservationId }, "[reminder:boarding] WhatsApp dispatch failed — non-fatal"),
      );
    }

    // Email + push only for D-1 (traditional behavior) and only for clients with an email
    if (daysUntilDeparture !== 1) continue;

    // Email + push only for clients who have an email address
    if (!row.clientEmail) continue;

    const points = (row.boardingPoints ?? []) as { name: string; time?: string; address?: string }[];
    const boardingHtml =
      points.length > 0
        ? points
            .map(
              (p) =>
                `<li><strong>${escapeHtml(p.name)}</strong>${p.time ? ` — ${escapeHtml(p.time)}` : ""}${p.address ? `<br><small>${escapeHtml(p.address)}</small>` : ""}</li>`,
            )
            .join("")
        : "<li>Consulte a agência para informações de embarque</li>";

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <h2 style="color:#2563EB">🚌 Lembrete de Embarque — Amanhã!</h2>
  <p>Olá, <strong>${escapeHtml(row.clientName)}</strong>!</p>
  <p>Sua viagem para <strong>${escapeHtml(row.tripDestination ?? row.tripName)}</strong> está marcada para <strong>amanhã, ${depDate}</strong>.</p>
  <h3 style="color:#374151">Pontos de Embarque:</h3>
  <ul style="line-height:1.8">${boardingHtml}</ul>
  <p>Não esqueça de levar seu documento de identidade e o voucher de reserva.</p>
  ${(() => {
    const STORE_PUBLIC_BASE = (process.env["STORE_PUBLIC_URL"] ?? "https://visitecrm.com").replace(/\/$/, "");
    const rawBase = (row.agencyWebsite ?? `${STORE_PUBLIC_BASE}/loja/${row.agencySlug}`).replace(/\/$/, "");
    if (!/^https?:\/\//i.test(rawBase)) return "";
    const safeBase = rawBase.replace(/"/g, "%22");
    const profileUrl = `${safeBase}/perfil?tab=reservas`;
    return `<p style="text-align:center;margin:24px 0;">
    <a href="${profileUrl}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;display:inline-block;font-size:14px;">🎒 Minhas Reservas</a>
  </p>`;
  })()}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
  <p style="font-size:13px;color:#6b7280">
    <strong>${escapeHtml(row.agencyName)}</strong><br>
    Reserva Nº ${escapeHtml(row.reservationNumber ?? row.voucherCode)}
  </p>
</body>
</html>`;

    const boardingResult = await sendReminderHtmlEmail({
      to: row.clientEmail,
      subject: `🚌 Lembrete: Sua viagem para ${row.tripDestination ?? row.tripName} é amanhã!`,
      html,
      fromName: row.agencyName,
    });
    if (boardingResult.success) {
      sent++;
      logger.info(
        { reservationId: row.reservationId, email: row.clientEmail },
        "[reminder:boarding] Sent D-1 boarding reminder",
      );
    } else {
      failed++;
      logger.error(
        { error: boardingResult.error, reservationId: row.reservationId, email: row.clientEmail },
        "[reminder:boarding] Failed to send D-1 reminder",
      );
    }

    // #18: Push notification alongside the email when the client has a registered token.
    // A push failure is logged per-recipient but must NOT abort the batch.
    if (row.clientExpoPushToken) {
      try {
        await sendPushNotification({
          to: row.clientExpoPushToken,
          title: "🚌 Embarque amanhã!",
          body: `Sua viagem para ${row.tripDestination ?? row.tripName} é amanhã, ${depDate}.`,
          data: { type: "boarding_reminder", reservationId: row.reservationId },
        });
      } catch (err) {
        logger.error(
          { err, reservationId: row.reservationId },
          "[reminder:boarding] Failed to send D-1 push notification",
        );
      }
    }

  }

  logger.info({ total: rows.length, sent, failed }, "[reminder:boarding] D-1 run complete");
  if (failed > 0) {
    // Do NOT throw here to avoid BullMQ retrying the whole batch and re-sending to recipients
    // that already received their reminder. Individual failures are logged above for investigation.
    logger.warn({ failed }, "[reminder:boarding] Some D-1 reminders failed — check logs above for details");
  }
}

// ────────────────────────────────────────────────────────────
// WhatsApp pending-payment reminder (configurable N days before trip)
// ────────────────────────────────────────────────────────────

async function processWhatsAppPagamentoPendente(): Promise<void> {
  // Query confirmed reservations with outstanding balance departing in D-1..D-30
  const MAX_DAYS = 30;
  const { start: windowStart } = brazilDayWindow(1);
  const { end: windowEnd } = brazilDayWindow(MAX_DAYS);

  const rows = await db
    .select({
      reservationId: reservationsTable.id,
      tenantId: reservationsTable.tenantId,
      balance: reservationsTable.balance,
      departureDate: tripsTable.departureDate,
      tripName: tripsTable.name,
      tripDestination: tripsTable.destination,
      agencyName: tenantsTable.name,
    })
    .from(reservationsTable)
    .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .innerJoin(tenantsTable, eq(reservationsTable.tenantId, tenantsTable.id))
    .where(
      and(
        eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
        sql`${reservationsTable.balance}::numeric > 0`,
        gte(tripsTable.departureDate, windowStart),
        lt(tripsTable.departureDate, windowEnd),
      ),
    );

  logger.info({ count: rows.length }, "[reminder:pagamento-pendente] Checking confirmed reservations with balance");

  // Cache tenant settings
  const tenantSettingsCache = new Map<string, Awaited<ReturnType<typeof getWhatsAppNotificationSettings>>>();
  async function getTenantSettings(tenantId: string) {
    if (!tenantSettingsCache.has(tenantId)) {
      tenantSettingsCache.set(tenantId, await getWhatsAppNotificationSettings(tenantId));
    }
    return tenantSettingsCache.get(tenantId)!;
  }

  const nowBrazil = new Date(new Date().toLocaleString("en-US", { timeZone: BRAZIL_TZ }));
  const todayBrazil = new Date(nowBrazil.getFullYear(), nowBrazil.getMonth(), nowBrazil.getDate());

  let dispatched = 0;
  let skipped = 0;

  for (const row of rows) {
    const settings = await getTenantSettings(row.tenantId);
    if (!settings.pagamentoPendente) { skipped++; continue; }

    const configuredDay = settings.pagamentoPendenteDaysBeforeTrip ?? 7;

    if (!row.departureDate) { skipped++; continue; }
    const dep = new Date(row.departureDate);
    const depBrazil = new Date(dep.getFullYear(), dep.getMonth(), dep.getDate());
    const daysUntilDeparture = Math.round((depBrazil.getTime() - todayBrazil.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilDeparture !== configuredDay) { skipped++; continue; }

    const depDateStr = formatDateBRServer(row.departureDate);

    dispatchWhatsAppPagamentoPendente({
      reservationId: row.reservationId,
      tenantId: row.tenantId,
      tripName: row.tripDestination ?? row.tripName,
      departureDate: depDateStr,
      remainingBalance: Number(row.balance ?? 0),
      tenantName: row.agencyName,
    }).catch((err) =>
      logger.warn({ err, reservationId: row.reservationId }, "[reminder:pagamento-pendente] WhatsApp dispatch failed — non-fatal"),
    );
    dispatched++;
  }

  logger.info({ dispatched, skipped, total: rows.length }, "[reminder:pagamento-pendente] Run complete");
}

// ────────────────────────────────────────────────────────────
// D-3 Departure push reminder (push-only, no email)
// ────────────────────────────────────────────────────────────

async function processDeparturePushReminders(): Promise<void> {
  const { start: d3Start, end: d3End } = brazilDayWindow(3);

  const rows = await db
    .select({
      reservationId: reservationsTable.id,
      clientExpoPushToken: clientsTable.expoPushToken,
      tripName: tripsTable.name,
      tripDestination: tripsTable.destination,
      departureDate: tripsTable.departureDate,
    })
    .from(reservationsTable)
    .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .innerJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
    .where(
      and(
        eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
        isNotNull(clientsTable.expoPushToken),
        gte(tripsTable.departureDate, d3Start),
        lt(tripsTable.departureDate, d3End),
      ),
    );

  logger.info({ count: rows.length }, "[reminder:departure-push] Found reservations for D-3 departure push");

  for (const row of rows) {
    if (!row.clientExpoPushToken) continue;
    const depDate = row.departureDate ? formatDateBRServer(row.departureDate) : "em 3 dias";
    try {
      await sendPushNotification({
        to: row.clientExpoPushToken,
        title: "✈️ Sua viagem parte em 3 dias!",
        body: `Prepare-se! Sua viagem para ${row.tripDestination ?? row.tripName} parte em ${depDate}.`,
        data: { type: "departure_reminder", reservationId: row.reservationId },
      });
      logger.info({ reservationId: row.reservationId }, "[reminder:departure-push] Sent D-3 departure push");
    } catch (err) {
      logger.error({ err, reservationId: row.reservationId }, "[reminder:departure-push] Failed to send D-3 departure push");
    }
  }
}

// ────────────────────────────────────────────────────────────
// D-3 Payment reminder
// ────────────────────────────────────────────────────────────

// D-3 Payment reminder — based on pending payment installment due dates in paymentsTable

async function processPaymentReminders(): Promise<void> {
  const { start: d3Start, end: d3End } = brazilDayWindow(3);

  // Find pending/overdue payment installments due in exactly 3 days
  const rows = await db
    .select({
      paymentId: paymentsTable.id,
      paymentAmount: paymentsTable.amount,
      dueDate: paymentsTable.dueDate,
      reservationId: reservationsTable.id,
      reservationNumber: reservationsTable.reservationNumber,
      voucherCode: reservationsTable.voucherCode,
      balance: reservationsTable.balance,
      totalValue: reservationsTable.totalValue,
      paidValue: reservationsTable.paidValue,
      tenantId: reservationsTable.tenantId,
      tripName: tripsTable.name,
      tripDestination: tripsTable.destination,
      departureDate: tripsTable.departureDate,
      clientName: clientsTable.name,
      clientEmail: clientsTable.email,
      clientExpoPushToken: clientsTable.expoPushToken,
      agencyName: tenantsTable.name,
      agencyPhone: tenantsTable.whatsapp,
      agencySlug: tenantsTable.slug,
      agencyWebsite: tenantsTable.website,
    })
    .from(paymentsTable)
    .innerJoin(reservationsTable, eq(paymentsTable.reservationId, reservationsTable.id))
    .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .innerJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
    .innerJoin(tenantsTable, eq(reservationsTable.tenantId, tenantsTable.id))
    .where(
      and(
        eq(paymentsTable.status, PAYMENT_STATUS.PENDING),
        isNull(paymentsTable.paidAt),
        eq(paymentsTable.type, "receivable"),
        gte(paymentsTable.dueDate, d3Start),
        lt(paymentsTable.dueDate, d3End),
      ),
    );

  logger.info({ count: rows.length }, "[reminder:payment] Found payments for D-3 due-date reminder");

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.clientEmail) continue;

    const balance = formatBRL(Number(row.balance ?? 0));
    const total = formatBRL(Number(row.totalValue ?? 0));
    const paid = formatBRL(Number(row.paidValue ?? 0));
    const paymentAmount = formatBRL(Number(row.paymentAmount ?? 0));
    const dueStr = row.dueDate ? formatDateBRServer(row.dueDate) : "Em 3 dias";
    const depDate = row.departureDate ? formatDateBRServer(row.departureDate) : "";

    const whatsappNum = (row.agencyPhone ?? "").replace(/\D/g, "");
    const contactLink = whatsappNum
      ? `<a href="https://wa.me/${whatsappNum}">WhatsApp</a>`
      : "a agência";

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <h2 style="color:#DC2626">💰 Pagamento Vencendo em 3 Dias</h2>
  <p>Olá, <strong>${escapeHtml(row.clientName)}</strong>!</p>
  <p>Você tem uma parcela da reserva da viagem para <strong>${escapeHtml(row.tripDestination ?? row.tripName)}</strong>${depDate ? ` (partindo em ${depDate})` : ""} com vencimento em <strong>${dueStr}</strong>.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr style="background:#fef2f2">
      <td style="padding:10px;border:1px solid #e5e7eb">Valor desta Parcela</td>
      <td style="padding:10px;border:1px solid #e5e7eb;text-align:right;color:#dc2626"><strong>${paymentAmount}</strong></td>
    </tr>
    <tr style="background:#f9fafb">
      <td style="padding:10px;border:1px solid #e5e7eb">Total da Reserva</td>
      <td style="padding:10px;border:1px solid #e5e7eb;text-align:right"><strong>${total}</strong></td>
    </tr>
    <tr>
      <td style="padding:10px;border:1px solid #e5e7eb">Valor Pago</td>
      <td style="padding:10px;border:1px solid #e5e7eb;text-align:right;color:#16a34a"><strong>${paid}</strong></td>
    </tr>
    <tr style="background:#fff7ed">
      <td style="padding:10px;border:1px solid #e5e7eb">Saldo Restante</td>
      <td style="padding:10px;border:1px solid #e5e7eb;text-align:right;color:#ea580c"><strong>${balance}</strong></td>
    </tr>
  </table>
  <p>Entre em contato com ${contactLink} para efetuar o pagamento antes do vencimento e garantir sua vaga.</p>
  ${(() => {
    const STORE_PUBLIC_BASE = (process.env["STORE_PUBLIC_URL"] ?? "https://visitecrm.com").replace(/\/$/, "");
    const rawBase = (row.agencyWebsite ?? `${STORE_PUBLIC_BASE}/loja/${row.agencySlug}`).replace(/\/$/, "");
    // Only embed http/https URLs — prevent javascript: URI injection
    if (!/^https?:\/\//i.test(rawBase)) return "";
    // Encode double-quotes to prevent HTML attribute injection
    const safeBase = rawBase.replace(/"/g, "%22");
    const profileUrl = `${safeBase}/perfil?tab=reservas`;
    return `<p style="text-align:center;margin:24px 0;">
    <a href="${profileUrl}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;display:inline-block;font-size:14px;">🎒 Ver Minhas Reservas</a>
  </p>`;
  })()}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
  <p style="font-size:13px;color:#6b7280">
    <strong>${escapeHtml(row.agencyName)}</strong><br>
    Reserva Nº ${escapeHtml(row.reservationNumber ?? row.voucherCode)}
  </p>
</body>
</html>`;

    const paymentResult = await sendReminderHtmlEmail({
      to: row.clientEmail,
      subject: `💰 Pagamento vencendo em ${dueStr} — ${row.tripDestination ?? row.tripName}`,
      html,
      fromName: row.agencyName,
    });
    if (paymentResult.success) {
      sent++;
      logger.info(
        { reservationId: row.reservationId, email: row.clientEmail },
        "[reminder:payment] Sent D-3 payment reminder",
      );
    } else {
      failed++;
      logger.error(
        { error: paymentResult.error, reservationId: row.reservationId, email: row.clientEmail },
        "[reminder:payment] Failed to send D-3 reminder",
      );
    }

    // #18: Push notification alongside the email when the client has a registered token.
    // A push failure is logged per-recipient but must NOT abort the batch.
    if (row.clientExpoPushToken) {
      try {
        await sendPushNotification({
          to: row.clientExpoPushToken,
          title: "💰 Pagamento vencendo",
          body: `Você tem uma parcela de ${paymentAmount} vencendo em ${dueStr}.`,
          data: { type: "payment_reminder", reservationId: row.reservationId },
        });
      } catch (err) {
        logger.error(
          { err, reservationId: row.reservationId },
          "[reminder:payment] Failed to send D-3 push notification",
        );
      }
    }
  }

  logger.info({ total: rows.length, sent, failed }, "[reminder:payment] D-3 run complete");
  if (failed > 0) {
    // Do NOT throw here to avoid BullMQ retrying the whole batch and re-sending to recipients
    // that already received their reminder. Individual failures are logged above for investigation.
    logger.warn({ failed }, "[reminder:payment] Some D-3 reminders failed — check logs above for details");
  }
}

// ────────────────────────────────────────────────────────────
// Staff alert when booking email retries are exhausted
// ────────────────────────────────────────────────────────────

const EXHAUSTED_ALERT_SUBJECT_PREFIX = "Alerta: Falha no e-mail de confirmação";

/**
 * Sends a one-time staff alert email when all auto-retries for a booking
 * confirmation email have been exhausted. Deduplicates by checking whether
 * an alert with the same subject prefix already exists in email_logs for
 * this reservation.
 */
async function notifyStaffOfExhaustedRetries(
  reservationId: string,
  tenantId: string,
): Promise<void> {
  // Dedup: skip only if a successful alert was already sent for this reservation.
  // If a prior attempt failed, we allow another attempt so the alert is not silently lost.
  const existingSuccessful = await db
    .select({ id: emailLogsTable.id })
    .from(emailLogsTable)
    .where(
      and(
        eq(emailLogsTable.tenantId, tenantId),
        eq(emailLogsTable.reservationId, reservationId),
        like(emailLogsTable.subject, `${EXHAUSTED_ALERT_SUBJECT_PREFIX}%`),
        eq(emailLogsTable.status, "sent"),
      ),
    )
    .limit(1);

  if (existingSuccessful.length > 0) {
    logger.debug(
      { reservationId },
      "[email-retry] Staff alert already successfully sent for this reservation — skipping",
    );
    return;
  }

  // Fetch reservation details for the alert body
  const [row] = await db
    .select({
      reservationNumber: reservationsTable.reservationNumber,
      voucherCode: reservationsTable.voucherCode,
      clientName: clientsTable.name,
      clientEmail: clientsTable.email,
      tripName: tripsTable.name,
      tripDestination: tripsTable.destination,
      agencyName: tenantsTable.name,
    })
    .from(reservationsTable)
    .innerJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
    .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .innerJoin(tenantsTable, eq(reservationsTable.tenantId, tenantsTable.id))
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    logger.warn({ reservationId }, "[email-retry] Cannot fetch reservation for staff alert — skipping");
    return;
  }

  // Resolve alert recipients: store email + agency admins/managers
  const [store] = await db
    .select({ email: storesTable.email })
    .from(storesTable)
    .where(eq(storesTable.tenantId, tenantId))
    .limit(1);

  const staffUsers = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.tenantId, tenantId),
        eq(usersTable.isActive, true),
        inArray(usersTable.role, [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER]),
      ),
    );

  const recipientSet = new Set<string>();
  if (store?.email) recipientSet.add(store.email);
  for (const u of staffUsers) {
    if (u.email) recipientSet.add(u.email);
  }

  if (recipientSet.size === 0) {
    logger.warn(
      { reservationId, tenantId },
      "[email-retry] No staff recipients found — cannot send exhausted-retry alert",
    );
    return;
  }

  const reservationRef = row.reservationNumber ?? row.voucherCode ?? reservationId;
  const destination = row.tripDestination ?? row.tripName ?? "N/A";
  const subject = `${EXHAUSTED_ALERT_SUBJECT_PREFIX} — Reserva #${reservationRef}`;

  const frontendBase = (process.env["FRONTEND_URL"] ?? "https://app.visitecrm.com.br").replace(/\/$/, "");
  const reservationUrl = `${frontendBase}/reservations/${reservationId}`;

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <h2 style="color:#DC2626">⚠️ Falha no Envio de E-mail de Confirmação</h2>
  <p>O e-mail de confirmação de reserva abaixo falhou em todas as ${MAX_AUTO_RETRY_ATTEMPTS} tentativas automáticas e necessita de <strong>intervenção manual</strong>.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr style="background:#fef2f2">
      <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600">Reserva Nº</td>
      <td style="padding:10px;border:1px solid #e5e7eb">${escapeHtml(reservationRef)}</td>
    </tr>
    <tr style="background:#f9fafb">
      <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600">Cliente</td>
      <td style="padding:10px;border:1px solid #e5e7eb">${escapeHtml(row.clientName)}</td>
    </tr>
    <tr>
      <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600">E-mail do Cliente</td>
      <td style="padding:10px;border:1px solid #e5e7eb">${escapeHtml(row.clientEmail)}</td>
    </tr>
    <tr style="background:#f9fafb">
      <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600">Viagem</td>
      <td style="padding:10px;border:1px solid #e5e7eb">${escapeHtml(destination)}</td>
    </tr>
  </table>
  <p>
    <a href="${reservationUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
      Ver Reserva no CRM
    </a>
  </p>
  <p style="font-size:13px;color:#6b7280">Acesse o <strong>Log de E-mails</strong> para reenviar manualmente o e-mail de confirmação ao cliente.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
  <p style="font-size:12px;color:#9ca3af">${escapeHtml(row.agencyName)} — Alerta automático do sistema VisiteCRM</p>
</body>
</html>`;

  const emailLogId = generateId();

  // Log the alert email before sending so we can update the status after
  await db.insert(emailLogsTable).values({
    id: emailLogId,
    tenantId,
    reservationId,
    recipient: [...recipientSet][0],
    subject,
    status: "queued",
    isAutoRetry: false,
  });

  const recipients = [...recipientSet];

  // Send to all recipients and track aggregate outcome:
  // - overallSuccess=true as soon as at least one recipient receives the alert.
  // - firstMessageId: captured from the first successful send for logging.
  // - lastError: error from the last failed send, used only if all sends fail.
  let overallSuccess = false;
  let firstMessageId: string | undefined;
  let lastError: string | undefined;

  for (const recipient of recipients) {
    const result = await sendReminderHtmlEmail({
      to: recipient,
      subject,
      html,
      fromName: row.agencyName,
    });
    if (result.success) {
      overallSuccess = true;
      if (!firstMessageId) firstMessageId = result.messageId;
      logger.info(
        { reservationId, recipient },
        "[email-retry] Exhausted-retry staff alert delivered to recipient",
      );
    } else {
      lastError = result.error;
      logger.error(
        { reservationId, recipient, error: result.error },
        "[email-retry] Failed to deliver exhausted-retry staff alert to recipient",
      );
    }
  }

  // Mark the log row as "sent" if at least one recipient received it.
  await db
    .update(emailLogsTable)
    .set({
      status: overallSuccess ? "sent" : "failed",
      messageId: firstMessageId ?? null,
      errorMessage: overallSuccess ? null : (lastError ?? null),
    })
    .where(eq(emailLogsTable.id, emailLogId));

  if (overallSuccess) {
    logger.info(
      { reservationId, recipients, reservationRef },
      "[email-retry] Exhausted-retry staff alert sent",
    );
  } else {
    logger.error(
      { reservationId, recipients, reservationRef },
      "[email-retry] Exhausted-retry staff alert failed for all recipients",
    );
  }
}

// ────────────────────────────────────────────────────────────
// Auto-retry failed booking confirmation emails
// ────────────────────────────────────────────────────────────

export async function retryFailedBookingEmails(): Promise<void> {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  // Only pick up reservation confirmation emails — cancellation and agency
  // notification emails also carry a reservationId but must not be retried
  // as confirmation emails. We exclude them by their known subject prefixes.
  const failedLogs = await db
    .select({
      id: emailLogsTable.id,
      tenantId: emailLogsTable.tenantId,
      reservationId: emailLogsTable.reservationId,
      subject: emailLogsTable.subject,
    })
    .from(emailLogsTable)
    .where(
      and(
        eq(emailLogsTable.status, "failed"),
        isNotNull(emailLogsTable.reservationId),
        gte(emailLogsTable.createdAt, twoHoursAgo),
        notLike(emailLogsTable.subject, "Reserva Cancelada%"),
        notLike(emailLogsTable.subject, "Nova reserva%"),
      ),
    );

  if (failedLogs.length === 0) {
    logger.debug("[email-retry] No failed booking confirmation emails in the last 2 hours");
    return;
  }

  const seenReservations = new Set<string>();
  const toRetry = failedLogs.filter((log) => {
    if (!log.reservationId || seenReservations.has(log.reservationId)) return false;
    seenReservations.add(log.reservationId);
    return true;
  });

  logger.info({ count: toRetry.length }, "[email-retry] Failed booking confirmation emails found — evaluating retries");

  let retried = 0;
  let skipped = 0;
  let errors = 0;

  for (const log of toRetry) {
    const reservationId = log.reservationId!;

    // Fetch email_log entries for this reservation in the 2-hour window.
    // We select both `status` and `isAutoRetry` to check two things:
    //   1. Whether a successful send already exists (abort if so — delivery done).
    //   2. How many automatic retries have already been attempted.
    //
    // Counting strategy: we count only rows where isAutoRetry=true (i.e. rows
    // written by this worker). This intentionally excludes:
    //   - The original failure (isAutoRetry=false, written by the email queue).
    //   - Any manual resends triggered by staff (isAutoRetry=false).
    // Using the flag rather than "total window rows minus 1" prevents manual
    // resends from eating into the auto-retry budget and avoids inflating the
    // counter when old successful sends exist outside the window.
    const windowLogs = await db
      .select({ status: emailLogsTable.status, isAutoRetry: emailLogsTable.isAutoRetry })
      .from(emailLogsTable)
      .where(
        and(
          eq(emailLogsTable.reservationId, reservationId),
          gte(emailLogsTable.createdAt, twoHoursAgo),
          notLike(emailLogsTable.subject, "Reserva Cancelada%"),
          notLike(emailLogsTable.subject, "Nova reserva%"),
        ),
      );

    // If any log in the window already has status="sent", the email was
    // successfully delivered (by a previous auto-retry or by the queue
    // recovering). Stop retrying to avoid duplicates.
    const alreadyDelivered = windowLogs.some((l) => l.status === "sent");
    if (alreadyDelivered) {
      logger.info(
        { reservationId },
        "[email-retry] Skipping — a successful send already exists for this reservation in the window",
      );
      skipped++;
      continue;
    }

    // Count only auto-retry entries (isAutoRetry=true) to get an accurate
    // picture of how many automatic delivery attempts have been made for
    // this failure event, unaffected by manual resends or prior history.
    const autoRetriesDone = windowLogs.filter((l) => l.isAutoRetry).length;
    const attemptsInWindow = windowLogs.length;

    if (autoRetriesDone >= MAX_AUTO_RETRY_ATTEMPTS) {
      logger.warn(
        { reservationId, attemptsInWindow, autoRetriesDone, limit: MAX_AUTO_RETRY_ATTEMPTS },
        "[email-retry] Skipping — max auto-retry limit reached for this reservation",
      );
      // Stamp retriesExhaustedAt on all rows for this reservation that don't
      // already have it, so the staff alert persists beyond the 24-hour window.
      await db
        .update(emailLogsTable)
        .set({ retriesExhaustedAt: new Date() })
        .where(
          and(
            eq(emailLogsTable.tenantId, log.tenantId),
            eq(emailLogsTable.reservationId, reservationId),
            isNull(emailLogsTable.retriesExhaustedAt),
          ),
        );
      // Notify agency staff that manual intervention is needed. The helper
      // deduplicates internally so it only sends one alert per reservation.
      await notifyStaffOfExhaustedRetries(reservationId, log.tenantId);
      skipped++;
      continue;
    }

    const props = await buildEmailPropsFromReservation(reservationId, log.tenantId);
    if (!props) {
      logger.warn(
        { emailLogId: log.id, reservationId },
        "[email-retry] Cannot rebuild email props — skipping",
      );
      skipped++;
      continue;
    }

    const newLogId = generateId();
    await db.insert(emailLogsTable).values({
      id: newLogId,
      tenantId: log.tenantId,
      reservationId,
      recipient: props.clientEmail,
      subject: log.subject,
      status: "queued",
      isAutoRetry: true,
    });

    const result = await sendReservationConfirmationEmail(props);

    await db
      .update(emailLogsTable)
      .set({
        status: result.success ? "sent" : "failed",
        messageId: result.messageId ?? null,
        errorMessage: result.error ?? null,
      })
      .where(eq(emailLogsTable.id, newLogId));

    if (result.success) {
      retried++;
      logger.info(
        { newLogId, reservationId, attempt: attemptsInWindow + 1 },
        "[email-retry] Auto-retry sent successfully",
      );
    } else {
      errors++;
      logger.error(
        { newLogId, reservationId, attempt: attemptsInWindow + 1, error: result.error },
        "[email-retry] Auto-retry send failed",
      );
    }
  }

  logger.info({ retried, skipped, errors, total: toRetry.length }, "[email-retry] Auto-retry run complete");
}

// ────────────────────────────────────────────────────────────
// Auto-retry failed referral expiry-warning emails
// ────────────────────────────────────────────────────────────

export async function retryFailedExpiryWarningEmails(): Promise<void> {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  // Find failed expiry-warning logs that have a referralId and were created
  // in the last 2 hours. We use referralId (not reservationId) to group retries.
  const failedLogs = await db
    .select({
      id: emailLogsTable.id,
      tenantId: emailLogsTable.tenantId,
      referralId: emailLogsTable.referralId,
      subject: emailLogsTable.subject,
      recipient: emailLogsTable.recipient,
    })
    .from(emailLogsTable)
    .where(
      and(
        eq(emailLogsTable.status, "failed"),
        isNotNull(emailLogsTable.referralId),
        gte(emailLogsTable.createdAt, twoHoursAgo),
        like(emailLogsTable.subject, "⏰%"),
      ),
    );

  if (failedLogs.length === 0) {
    logger.debug("[expiry-warning-retry] No failed expiry-warning emails in the last 2 hours");
    return;
  }

  // Deduplicate by referralId — only one retry attempt per referral per run.
  const seenReferrals = new Set<string>();
  const toRetry = failedLogs.filter((log) => {
    if (!log.referralId || seenReferrals.has(log.referralId)) return false;
    seenReferrals.add(log.referralId);
    return true;
  });

  logger.info({ count: toRetry.length }, "[expiry-warning-retry] Failed expiry-warning emails found — evaluating retries");

  let retried = 0;
  let skipped = 0;
  let errors = 0;

  for (const log of toRetry) {
    const referralId = log.referralId!;

    // Fetch all email_log entries for this referral in the 2-hour window.
    const windowLogs = await db
      .select({ status: emailLogsTable.status, isAutoRetry: emailLogsTable.isAutoRetry })
      .from(emailLogsTable)
      .where(
        and(
          eq(emailLogsTable.referralId, referralId),
          gte(emailLogsTable.createdAt, twoHoursAgo),
          like(emailLogsTable.subject, "⏰%"),
        ),
      );

    // Skip if any log for this referral was already delivered successfully.
    const alreadyDelivered = windowLogs.some((l) => l.status === "sent");
    if (alreadyDelivered) {
      logger.info(
        { referralId },
        "[expiry-warning-retry] Skipping — a successful send already exists for this referral in the window",
      );
      skipped++;
      continue;
    }

    // Count only auto-retry entries to avoid counting the original failure or
    // any manual resends against the budget.
    const autoRetriesDone = windowLogs.filter((l) => l.isAutoRetry).length;

    if (autoRetriesDone >= MAX_AUTO_RETRY_ATTEMPTS) {
      logger.warn(
        { referralId, autoRetriesDone, limit: MAX_AUTO_RETRY_ATTEMPTS },
        "[expiry-warning-retry] Skipping — max auto-retry limit reached for this referral",
      );
      // Stamp retriesExhaustedAt so staff can see the exhausted state in email logs.
      await db
        .update(emailLogsTable)
        .set({ retriesExhaustedAt: new Date() })
        .where(
          and(
            eq(emailLogsTable.tenantId, log.tenantId),
            eq(emailLogsTable.referralId, referralId),
            isNull(emailLogsTable.retriesExhaustedAt),
          ),
        );
      skipped++;
      continue;
    }

    // Rebuild the email props from the referral record.
    const [referral] = await db
      .select({
        referrerId: referralsTable.referrerId,
        code: referralsTable.code,
        expiresAt: referralsTable.expiresAt,
        tenantId: referralsTable.tenantId,
      })
      .from(referralsTable)
      .where(and(eq(referralsTable.id, referralId), eq(referralsTable.tenantId, log.tenantId)))
      .limit(1);

    if (!referral || !referral.expiresAt) {
      logger.warn(
        { referralId },
        "[expiry-warning-retry] Cannot fetch referral record — skipping",
      );
      skipped++;
      continue;
    }

    // Recalculate daysLeft from the referral's expiresAt so the body stays accurate.
    const diffMs = referral.expiresAt.getTime() - now.getTime();
    const daysLeft = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));

    // Rebuild the full email props needed by sendReferralExpiringSoonEmail.
    const [referrer] = await db
      .select({ name: clientsTable.name, email: clientsTable.email })
      .from(clientsTable)
      .where(and(eq(clientsTable.id, referral.referrerId), eq(clientsTable.tenantId, log.tenantId)))
      .limit(1);

    if (!referrer?.email) {
      logger.warn({ referralId }, "[expiry-warning-retry] Referrer has no email — skipping");
      skipped++;
      continue;
    }

    const [tenant] = await db
      .select({ name: tenantsTable.name, logoUrl: tenantsTable.logoUrl })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, log.tenantId))
      .limit(1);

    const [settings] = await db
      .select({ shareMessage: referralSettingsTable.shareMessage })
      .from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, log.tenantId))
      .limit(1);

    const agencyName = tenant?.name ?? "Agência";
    const formattedDate = formatDateBRServer(referral.expiresAt);
    const defaultShareMessage = settings?.shareMessage
      ?? `Olá! Use meu código ${referral.code} na ${agencyName} e ganhe desconto especial na sua próxima viagem! 🌴✈️`;
    const shareUrl = `https://wa.me/?text=${encodeURIComponent(defaultShareMessage)}`;

    const newLogId = generateId();
    await db.insert(emailLogsTable).values({
      id: newLogId,
      tenantId: log.tenantId,
      referralId,
      recipient: referrer.email,
      subject: log.subject,
      status: "queued",
      isAutoRetry: true,
    });

    const result = await sendReferralExpiringSoonEmail({
      referrerName: referrer.name ?? referrer.email,
      referrerEmail: referrer.email,
      referralCode: referral.code,
      expiresAt: formattedDate,
      daysLeft,
      agencyName,
      agencyLogo: tenant?.logoUrl ?? null,
      shareUrl,
    });

    await db
      .update(emailLogsTable)
      .set({
        status: result.success ? "sent" : "failed",
        messageId: result.messageId ?? null,
        errorMessage: result.error ?? null,
      })
      .where(eq(emailLogsTable.id, newLogId));

    if (result.success) {
      retried++;
      logger.info(
        { newLogId, referralId, attempt: windowLogs.length + 1 },
        "[expiry-warning-retry] Auto-retry sent successfully",
      );
    } else {
      errors++;
      logger.error(
        { newLogId, referralId, attempt: windowLogs.length + 1, error: result.error },
        "[expiry-warning-retry] Auto-retry send failed",
      );
    }
  }

  logger.info({ retried, skipped, errors, total: toRetry.length }, "[expiry-warning-retry] Auto-retry run complete");
}

// ────────────────────────────────────────────────────────────
// Expired referral notifications
// ────────────────────────────────────────────────────────────

async function processExpiredReferralNotifications(): Promise<void> {
  const now = new Date();

  // Only pending referrals whose expiry time has passed — status="pending" is
  // the one-time gate: once transitioned to "expired" they won't match again.
  // NOTE: do NOT filter by referrerEmail here — the status transition applies
  // to all overdue pending referrals. dispatchReferralExpiredEmail() already
  // skips gracefully when the referrer client has no email address.
  const pendingExpired = await db
    .select({
      id: referralsTable.id,
      referrerId: referralsTable.referrerId,
      tenantId: referralsTable.tenantId,
    })
    .from(referralsTable)
    .where(
      and(
        eq(referralsTable.isActive, true),
        eq(referralsTable.status, "pending"),
        lte(referralsTable.expiresAt, now),
      ),
    );

  let transitioned = 0, notified = 0, errors = 0;

  for (const referral of pendingExpired) {
    try {
      // Persist the status transition first and check it actually affected a row.
      // The WHERE status='pending' guard means a concurrent convert/expire wins:
      // if the row was already converted (or expired) since our SELECT, the
      // UPDATE returns no rows and we skip the email — preventing false "expired"
      // notifications on converted referrals.
      const updated = await db
        .update(referralsTable)
        .set({ status: "expired", updatedAt: now })
        .where(
          and(
            eq(referralsTable.id, referral.id),
            eq(referralsTable.status, "pending"),
          ),
        )
        .returning({ id: referralsTable.id });

      if (updated.length === 0) {
        // Row was concurrently converted or already expired — skip notification.
        logger.info({ referralId: referral.id }, "[expiry-referral] Skipping — concurrent status change detected");
        continue;
      }
      transitioned++;

      await dispatchReferralExpiredEmail(referral.referrerId, referral.tenantId);
      notified++;
    } catch (err) {
      errors++;
      logger.error(
        { err, referralId: referral.id, referrerId: referral.referrerId, tenantId: referral.tenantId },
        "[expiry-referral] Failed to transition/notify expired referral",
      );
    }
  }

  logger.info({ transitioned, notified, errors, total: pendingExpired.length }, "[expiry-referral] Expired referral notification run complete");
}

// ────────────────────────────────────────────────────────────
// Pre-expiry referral notifications (7 days and 1 day before)
// ────────────────────────────────────────────────────────────

async function processExpiringSoonReferralNotifications(): Promise<void> {
  // Use the same timezone as the reminder cron (America/Sao_Paulo by default).
  // PostgreSQL's AT TIME ZONE handles DST automatically.
  const tz = process.env["REMINDER_TZ"] ?? "America/Sao_Paulo";

  // Fetch all tenants that have referrals enabled, along with their per-window toggle flags.
  const enabledTenants = await db
    .select({
      tenantId: referralSettingsTable.tenantId,
      warning7: referralSettingsTable.expiryWarning7DaysEnabled,
      warning1: referralSettingsTable.expiryWarning1DayEnabled,
    })
    .from(referralSettingsTable)
    .where(eq(referralSettingsTable.isEnabled, true));

  if (enabledTenants.length === 0) {
    logger.info("[expiry-warning] No tenants with referrals enabled — skipping");
    return;
  }

  const enabledTenantIds = enabledTenants.map((r) => r.tenantId);

  // Map for O(1) per-window toggle lookup in the processing loop.
  const tenantWarnings = new Map(
    enabledTenants.map((r) => [r.tenantId, { w7: r.warning7, w1: r.warning1 }]),
  );

  // Query pending referrals expiring EXACTLY today+7 days OR today+1 day in the
  // configured timezone. PostgreSQL's AT TIME ZONE + ::date casting handles
  // DST-safe calendar-day comparison — no rolling ±hour windows.
  // Also select the per-referral sent-at columns for structured dedup (task #151).
  const expiringSoon = await db
    .select({
      id: referralsTable.id,
      referrerId: referralsTable.referrerId,
      tenantId: referralsTable.tenantId,
      code: referralsTable.code,
      expiresAt: referralsTable.expiresAt,
      expiryWarning7SentAt: referralsTable.expiryWarning7SentAt,
      expiryWarning1SentAt: referralsTable.expiryWarning1SentAt,
      windowLabel: sql<number>`CASE
        WHEN (${referralsTable.expiresAt} AT TIME ZONE ${tz})::date = (NOW() AT TIME ZONE ${tz})::date + INTERVAL '7 days' THEN 7
        ELSE 1
      END`,
    })
    .from(referralsTable)
    .where(
      and(
        eq(referralsTable.isActive, true),
        eq(referralsTable.status, "pending"),
        inArray(referralsTable.tenantId, enabledTenantIds),
        isNotNull(referralsTable.expiresAt),
        sql`(
          (${referralsTable.expiresAt} AT TIME ZONE ${tz})::date = (NOW() AT TIME ZONE ${tz})::date + INTERVAL '7 days'
          OR
          (${referralsTable.expiresAt} AT TIME ZONE ${tz})::date = (NOW() AT TIME ZONE ${tz})::date + INTERVAL '1 day'
        )`,
      ),
    );

  let notified = 0, skippedNoEmail = 0, skippedAlreadySent = 0, skippedDisabled = 0, errors = 0;

  for (const referral of expiringSoon) {
    try {
      if (!referral.expiresAt) continue;

      const windowLabel = referral.windowLabel as 1 | 7;

      // Task #149: respect per-tenant per-window toggle flags.
      const tenantConf = tenantWarnings.get(referral.tenantId);
      if (!tenantConf) continue;
      if (windowLabel === 7 && !tenantConf.w7) {
        skippedDisabled++;
        logger.info({ referralId: referral.id }, "[expiry-warning] Skipping — 7-day warning disabled for tenant");
        continue;
      }
      if (windowLabel === 1 && !tenantConf.w1) {
        skippedDisabled++;
        logger.info({ referralId: referral.id }, "[expiry-warning] Skipping — 1-day warning disabled for tenant");
        continue;
      }

      // Task #151: structured dedup via DB column instead of email_logs LIKE.
      const alreadySent = windowLabel === 7
        ? referral.expiryWarning7SentAt != null
        : referral.expiryWarning1SentAt != null;

      if (alreadySent) {
        skippedAlreadySent++;
        logger.info({ referralId: referral.id, code: referral.code, windowLabel }, "[expiry-warning] Skipping — already sent (column)");
        continue;
      }

      // Fetch referrer email (needed by dispatchReferralExpiringSoonEmail).
      const [referrer] = await db
        .select({ email: clientsTable.email })
        .from(clientsTable)
        .where(and(eq(clientsTable.id, referral.referrerId), eq(clientsTable.tenantId, referral.tenantId)))
        .limit(1);

      if (!referrer?.email) {
        skippedNoEmail++;
        logger.info({ referralId: referral.id }, "[expiry-warning] Skipping — referrer has no email");
        continue;
      }

      await dispatchReferralExpiringSoonEmail(
        referral.referrerId,
        referral.tenantId,
        referral.code,
        referral.expiresAt,
        windowLabel,
        referral.id,
      );

      // Task #151: mark the warning as sent on the referral row.
      await db
        .update(referralsTable)
        .set(
          windowLabel === 7
            ? { expiryWarning7SentAt: new Date() }
            : { expiryWarning1SentAt: new Date() },
        )
        .where(eq(referralsTable.id, referral.id));

      notified++;
    } catch (err) {
      errors++;
      logger.error(
        { err, referralId: referral.id, referrerId: referral.referrerId, tenantId: referral.tenantId },
        "[expiry-warning] Failed to dispatch pre-expiry notification",
      );
    }
  }

  logger.info(
    { notified, skippedNoEmail, skippedAlreadySent, skippedDisabled, errors, total: expiringSoon.length },
    "[expiry-warning] Pre-expiry referral notification run complete",
  );
}

// ────────────────────────────────────────────────────────────
// Bonus release: auto-pay + optional email notification
// ────────────────────────────────────────────────────────────
//
// Two independent concerns handled in a single run:
//
//  1. AUTO-RELEASE (always): mark bonusPaid=true for every eligible row
//     (status=completed, bonusPaid=false, convertedAt + gracePeriodDays <= today).
//     This is independent of the email toggle — bonuses are released regardless
//     of whether the notification email is enabled.
//
//  2. EMAIL NOTIFICATION (conditional): for tenants with bonusReleaseEmailEnabled,
//     send the "bonus released" email once per row (bonusReleaseNotifiedAt IS NULL
//     as the idempotency guard). The notification stamp is separate from the
//     bonusPaid stamp so one doesn't block the other.

export async function processReferralBonusReleaseNotifications(): Promise<void> {
  const tz = process.env["REMINDER_TZ"] ?? "America/Sao_Paulo";

  // Fetch per-tenant settings — all tenants with referrals enabled.
  const tenantSettings = await db
    .select({
      tenantId: referralSettingsTable.tenantId,
      bonusReleaseEmailEnabled: referralSettingsTable.bonusReleaseEmailEnabled,
    })
    .from(referralSettingsTable)
    .where(eq(referralSettingsTable.isEnabled, true));

  if (tenantSettings.length === 0) {
    logger.info("[bonus-release] No tenants with referrals enabled — skipping");
    return;
  }

  const enabledTenantIds = tenantSettings.map((r) => r.tenantId);
  const bonusReleaseEmailEnabledMap = new Map(
    tenantSettings.map((r) => [r.tenantId, r.bonusReleaseEmailEnabled]),
  );

  // Find all completed referrals where the per-tenant grace period has elapsed
  // and the bonus has not yet been paid.
  // NOTE: bonusReleaseNotifiedAt is NOT a filter here — auto-release must
  // happen regardless of prior notification attempts.
  const eligibleReferrals = await db
    .select({
      id: referralsTable.id,
      referrerId: referralsTable.referrerId,
      tenantId: referralsTable.tenantId,
      bonusAmount: referralsTable.bonusAmount,
      convertedAt: referralsTable.convertedAt,
      bonusReleaseNotifiedAt: referralsTable.bonusReleaseNotifiedAt,
    })
    .from(referralsTable)
    .innerJoin(
      referralSettingsTable,
      eq(referralsTable.tenantId, referralSettingsTable.tenantId),
    )
    .where(
      and(
        eq(referralsTable.status, "completed"),
        eq(referralsTable.bonusPaid, false),
        isNotNull(referralsTable.convertedAt),
        inArray(referralsTable.tenantId, enabledTenantIds),
        sql`(${referralsTable.convertedAt} AT TIME ZONE ${tz})::date + (${referralSettingsTable.gracePeriodDays} || ' days')::interval <= (NOW() AT TIME ZONE ${tz})::date`,
      ),
    );

  if (eligibleReferrals.length === 0) {
    logger.info("[bonus-release] No referrals with elapsed grace periods — skipping");
    return;
  }

  logger.info({ count: eligibleReferrals.length }, "[bonus-release] Found referrals eligible for auto-release");

  let released = 0, notified = 0, skippedEmailDisabled = 0, skippedAlreadyNotified = 0, errors = 0;

  const releaseDate = formatDateBRServer(new Date());

  for (const referral of eligibleReferrals) {
    try {
      // ── Step 1: Auto-release ─────────────────────────────────────────────
      // Atomically mark paid. The bonusPaid=false guard prevents double-release
      // when concurrent cron instances overlap.
      const releaseNow = new Date();
      const paidRows = await db
        .update(referralsTable)
        .set({ bonusPaid: true, bonusPaidAt: releaseNow, updatedAt: releaseNow })
        .where(and(eq(referralsTable.id, referral.id), eq(referralsTable.bonusPaid, false)))
        .returning({ id: referralsTable.id });

      if (paidRows.length > 0) released++;
      // Even if this was a no-op (concurrent run beat us), continue to
      // the email step — email idempotency is guarded separately below.

      // ── Step 2: Email notification (tenant opt-in) ───────────────────────
      const emailEnabled = bonusReleaseEmailEnabledMap.get(referral.tenantId);
      if (!emailEnabled) {
        skippedEmailDisabled++;
        continue;
      }

      // Already notified on a prior run — skip to avoid double-sending.
      if (referral.bonusReleaseNotifiedAt !== null) {
        skippedAlreadyNotified++;
        continue;
      }

      // Atomically claim the notification slot. The IS NULL guard in the WHERE
      // clause ensures only one concurrent run dispatches the email.
      const notifyNow = new Date();
      const stamped = await db
        .update(referralsTable)
        .set({ bonusReleaseNotifiedAt: notifyNow, updatedAt: notifyNow })
        .where(and(eq(referralsTable.id, referral.id), isNull(referralsTable.bonusReleaseNotifiedAt)))
        .returning({ id: referralsTable.id });

      if (stamped.length === 0) {
        // A concurrent run already claimed the notification slot.
        skippedAlreadyNotified++;
        continue;
      }

      const bonusAmount = parseFloat(String(referral.bonusAmount ?? "0"));
      await dispatchReferralBonusReleasedEmail(
        referral.referrerId,
        referral.tenantId,
        bonusAmount,
        releaseDate,
        referral.id,
      );

      notified++;
    } catch (err) {
      errors++;
      logger.error(
        { err, referralId: referral.id, referrerId: referral.referrerId, tenantId: referral.tenantId },
        "[bonus-release] Failed to process referral auto-release",
      );
    }
  }

  logger.info(
    { released, notified, skippedEmailDisabled, skippedAlreadyNotified, errors, total: eligibleReferrals.length },
    "[bonus-release] Bonus auto-release run complete",
  );
}

// ────────────────────────────────────────────────────────────
// D-3 Installment due-date reminder
// ────────────────────────────────────────────────────────────

export async function processInstallmentDueReminders(): Promise<void> {
  const { start: d3Start, end: d3End } = brazilDayWindow(3);

  const rows = await db
    .select({
      installmentId: reservationInstallmentsTable.id,
      installmentNumber: reservationInstallmentsTable.installmentNumber,
      dueDate: reservationInstallmentsTable.dueDate,
      amount: reservationInstallmentsTable.amount,
      reservationId: reservationsTable.id,
      reservationNumber: reservationsTable.reservationNumber,
      voucherCode: reservationsTable.voucherCode,
      installments: reservationsTable.installments,
      tenantId: reservationsTable.tenantId,
      tripName: tripsTable.name,
      tripDestination: tripsTable.destination,
      departureDate: tripsTable.departureDate,
      clientName: clientsTable.name,
      clientEmail: clientsTable.email,
      agencyName: tenantsTable.name,
      agencyPhone: tenantsTable.whatsapp,
    })
    .from(reservationInstallmentsTable)
    .innerJoin(reservationsTable, eq(reservationInstallmentsTable.reservationId, reservationsTable.id))
    .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .innerJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
    .innerJoin(tenantsTable, eq(reservationsTable.tenantId, tenantsTable.id))
    .where(
      and(
        isNull(reservationInstallmentsTable.paidAt),
        gte(reservationInstallmentsTable.dueDate, d3Start),
        lt(reservationInstallmentsTable.dueDate, d3End),
      ),
    );

  logger.info({ count: rows.length }, "[reminder:installment] Found installments for D-3 reminder");

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.clientEmail) continue;

    const amount = formatBRL(Number(row.amount ?? 0));
    const dueStr = row.dueDate ? formatDateBRServer(row.dueDate) : "Em 3 dias";
    const depDate = row.departureDate ? formatDateBRServer(row.departureDate) : "";
    const whatsappNum = (row.agencyPhone ?? "").replace(/\D/g, "");
    const contactLink = whatsappNum ? `<a href="https://wa.me/${whatsappNum}">WhatsApp</a>` : "a agência";
    const instLabel = row.installments > 1 ? `Parcela ${row.installmentNumber} de ${row.installments}` : "Pagamento";

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <h2 style="color:#DC2626">📅 ${escapeHtml(instLabel)} vencendo em 3 dias</h2>
  <p>Olá, <strong>${escapeHtml(row.clientName)}</strong>!</p>
  <p>Sua <strong>${escapeHtml(instLabel)}</strong> da reserva para <strong>${escapeHtml(row.tripName ?? row.tripDestination ?? "")}</strong> vence em breve.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr style="background:#FEF2F2"><td style="padding:10px;border:1px solid #FCA5A5;font-weight:bold">Vencimento</td><td style="padding:10px;border:1px solid #FCA5A5">${dueStr}</td></tr>
    <tr><td style="padding:10px;border:1px solid #e5e7eb;font-weight:bold">Valor da Parcela</td><td style="padding:10px;border:1px solid #e5e7eb">${amount}</td></tr>
    ${row.reservationNumber ? `<tr style="background:#f9fafb"><td style="padding:10px;border:1px solid #e5e7eb;font-weight:bold">Reserva</td><td style="padding:10px;border:1px solid #e5e7eb">${escapeHtml(row.reservationNumber)}</td></tr>` : ""}
    ${depDate ? `<tr><td style="padding:10px;border:1px solid #e5e7eb;font-weight:bold">Data de Saída</td><td style="padding:10px;border:1px solid #e5e7eb">${depDate}</td></tr>` : ""}
  </table>
  <p>Por favor, entre em contato via ${contactLink} para efetuar o pagamento antes do vencimento.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
  <p style="font-size:12px;color:#9ca3af">Esta é uma mensagem automática de <strong>${escapeHtml(row.agencyName)}</strong>. Não responda a este e-mail.</p>
</body>
</html>`;

    const result = await sendReminderHtmlEmail({
      to: row.clientEmail,
      subject: `📅 ${instLabel} vence em ${dueStr} — ${row.tripDestination ?? row.tripName}`,
      html,
      fromName: row.agencyName,
    });
    if (result.success) {
      sent++;
      logger.info({ installmentId: row.installmentId, email: row.clientEmail }, "[reminder:installment] Sent D-3 reminder");
    } else {
      failed++;
      logger.error({ error: result.error, installmentId: row.installmentId }, "[reminder:installment] Failed to send D-3 reminder");
    }
  }

  logger.info({ total: rows.length, sent, failed }, "[reminder:installment] D-3 run complete");
}

// ────────────────────────────────────────────────────────────
// NPS auto-dispatch post-trip
// ────────────────────────────────────────────────────────────

export async function processNpsDispatch(): Promise<void> {
  const enabledConfigs = await db
    .select({ tenantId: systemConfigsTable.tenantId })
    .from(systemConfigsTable)
    .where(
      and(
        eq(systemConfigsTable.key, "npsAutoSend"),
        sql`${systemConfigsTable.value}::text = 'true'`,
      ),
    );

  if (enabledConfigs.length === 0) return;

  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const { tenantId } of enabledConfigs) {
    try {
      const [hoursConfig] = await db
        .select({ value: systemConfigsTable.value })
        .from(systemConfigsTable)
        .where(
          and(
            eq(systemConfigsTable.tenantId, tenantId),
            eq(systemConfigsTable.key, "npsHoursAfterReturn"),
          ),
        )
        .limit(1);

      const hoursAfter = Number(hoursConfig?.value ?? 24);
      const thresholdMs = hoursAfter * 60 * 60 * 1000;
      const lookbackMs = 48 * 60 * 60 * 1000;

      const cutoff = new Date(now.getTime() - thresholdMs);
      const lookback = new Date(now.getTime() - thresholdMs - lookbackMs);

      const [tenant] = await db
        .select({ name: tenantsTable.name, logoUrl: tenantsTable.logoUrl })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId))
        .limit(1);

      if (!tenant) continue;

      const eligible = await db
        .select({
          reservationId: reservationsTable.id,
          clientId: reservationsTable.clientId,
          tripId: reservationsTable.tripId,
          tripName: tripsTable.name,
          returnDate: tripsTable.returnDate,
          clientName: clientsTable.name,
          clientEmail: clientsTable.email,
        })
        .from(reservationsTable)
        .innerJoin(tripsTable, eq(tripsTable.id, reservationsTable.tripId))
        .innerJoin(clientsTable, eq(clientsTable.id, reservationsTable.clientId))
        .where(
          and(
            eq(reservationsTable.tenantId, tenantId),
            eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
            isNotNull(tripsTable.returnDate),
            lt(tripsTable.returnDate, cutoff),
            gte(tripsTable.returnDate, lookback),
            isNotNull(clientsTable.email),
            not(
              exists(
                db
                  .select({ id: npsInvitationsTable.id })
                  .from(npsInvitationsTable)
                  .where(eq(npsInvitationsTable.reservationId, reservationsTable.id)),
              ),
            ),
          ),
        );

      const baseUrl = process.env["API_BASE_URL"] ?? process.env["FRONTEND_URL"] ?? "";
      // CLIENT_PORTAL_URL is the base URL of the client portal app.
      // When set, the NPS survey email includes a CTA button linking to the
      // client's /perfil page so they can also rate through the portal.
      const clientPortalBase = (process.env["CLIENT_PORTAL_URL"] ?? "").replace(/\/$/, "");
      // Deeplink to the NPS card on the profile page. The `openNps=1` param is
      // read by perfil.tsx to auto-scroll and highlight the NPS survey card.
      const portalUrl = clientPortalBase ? `${clientPortalBase}/perfil?openNps=1` : null;

      for (const row of eligible) {
        if (!row.clientEmail) { skipped++; continue; }
        try {
          const token = generateId() + generateId();
          const [newInvitation] = await db
            .insert(npsInvitationsTable)
            .values({
              id: generateId(),
              tenantId,
              clientId: row.clientId!,
              reservationId: row.reservationId,
              tripId: row.tripId ?? null,
              token,
            })
            .onConflictDoNothing()
            .returning({ id: npsInvitationsTable.id, token: npsInvitationsTable.token });

          if (!newInvitation) {
            skipped++;
            continue;
          }

          const result = await sendNpsSurveyEmail({
            clientName: row.clientName ?? "Cliente",
            clientEmail: row.clientEmail,
            agencyName: tenant.name,
            agencyLogo: tenant.logoUrl ?? null,
            tripName: row.tripName,
            returnDate: row.returnDate?.toISOString() ?? "",
            surveyBaseUrl: baseUrl,
            token: newInvitation.token,
            portalUrl,
          });

          if (result.success) {
            sent++;
          } else {
            logger.warn({ tenantId, reservationId: row.reservationId, err: result.error }, "[nps-dispatch] Email failed — rolling back invitation for retry");
            await db.delete(npsInvitationsTable).where(eq(npsInvitationsTable.id, newInvitation.id)).catch(() => {});
            errors++;
          }
        } catch (rowErr) {
          logger.error({ err: rowErr, tenantId, reservationId: row.reservationId }, "[nps-dispatch] Error processing row");
          errors++;
        }
      }
    } catch (tenantErr) {
      logger.error({ err: tenantErr, tenantId }, "[nps-dispatch] Error processing tenant");
      errors++;
    }
  }

  logger.info({ sent, skipped, errors }, "[nps-dispatch] Run complete");
}

// ────────────────────────────────────────────────────────────
// Worker bootstrap
// ────────────────────────────────────────────────────────────

let _worker: Worker<ReminderJobData> | null = null;

export function startReminderWorker(): Worker<ReminderJobData> | null {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn("[reminder-worker] No Redis connection — worker not started");
    return null;
  }

  _worker = new Worker<ReminderJobData>(
    "reminders",
    async (job) => {
      logger.info({ jobId: job.id, type: job.data.type }, "[reminder-worker] Processing job");

      if (job.data.type === "boarding_reminder") {
        await processBoardingReminders();
        await processDeparturePushReminders();
        await processWhatsAppPagamentoPendente();
      } else if (job.data.type === "payment_reminder") {
        await processPaymentReminders();
      } else if (job.data.type === "expired_reservations_cleanup") {
        await runExpiredReservationsCron();
      } else if (job.data.type === "failed_email_retry") {
        await retryFailedBookingEmails();
      } else if (job.data.type === "referral_expiry_notification") {
        await processExpiredReferralNotifications();
      } else if (job.data.type === "referral_expiry_warning") {
        await processExpiringSoonReferralNotifications();
      } else if (job.data.type === "expiry_warning_email_retry") {
        await retryFailedExpiryWarningEmails();
      } else if (job.data.type === "referral_bonus_release_notification") {
        await processReferralBonusReleaseNotifications();
      } else if (job.data.type === "nps_dispatch") {
        await processNpsDispatch();
      } else if (job.data.type === "installment_due_reminder") {
        await processInstallmentDueReminders();
      } else if (job.data.type === "seat_reconciliation") {
        await runSeatReconciliationCron();
      } else {
        logger.warn({ type: job.data.type }, "[reminder-worker] Unknown reminder type");
      }
    },
    process.env.NODE_ENV !== "production"
      ? { connection: conn, concurrency: 1, stalledInterval: 60_000, drainDelay: 30 }
      : { connection: conn, concurrency: 1, stalledInterval: 15_000 },
  );

  _worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "[reminder-worker] Job failed");
  });

  attachCircuitBreaker(_worker, "reminder-worker");

  logger.info("[reminder-worker] Started");
  return _worker;
}

export async function stopReminderWorker(): Promise<void> {
  if (_worker) {
    await _worker.close().catch(() => {});
    _worker = null;
  }
}

export function isReminderWorkerRunning(): boolean {
  return _worker !== null;
}

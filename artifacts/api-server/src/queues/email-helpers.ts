import { db, emailLogsTable, reservationsTable, tripsTable, clientsTable, referralSettingsTable, tenantsTable, storesTable, usersTable } from "@workspace/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { getReferralEmailQueue } from "./index";
import type { ReferralBonusPaidEmailJobData, ReferralConvertedEmailJobData, ReferralExpiredEmailJobData, ReferralExpiringSoonEmailJobData, ReferralBonusReleasedEmailJobData, ReferralLoyaltyPointsEmailJobData } from "./index";
import { sendWelcomeCredentialsEmail, sendReferralBonusPaidEmail, sendReferralConvertedEmail, sendReferralExpiredEmail, sendReferralExpiringSoonEmail, sendReferralBonusReleasedEmail, sendReferralWelcomeEmail, sendReferralTierUpgradeEmail, sendReferralReversedEmail, sendReferralCodeSuspendedEmail, sendAgencySuspendedEmail, sendAgencyReactivatedEmail, sendReferralLoyaltyPointsEmail } from "@workspace/email";
import { ROLES } from "@workspace/permissions";
import { formatBRL } from "@workspace/shared";
import { logger } from "../lib/logger";
import type { ReservationConfirmationEmailProps, ReservationCancellationEmailProps, WelcomeCredentialsEmailProps, NewBookingNotificationEmailProps, ReferralBonusPaidEmailProps, ReferralConvertedEmailProps, ReferralExpiredEmailProps, ReferralExpiringSoonEmailProps, ReferralBonusReleasedEmailProps, ReferralWelcomeEmailProps, ReferralTierUpgradeEmailProps, ReferralLoyaltyPointsEmailProps } from "@workspace/email";
import { insertClientNotification } from "../lib/client-notifications";
import { areWorkersEnabled } from "../lib/redis";
import { dispatchWhatsAppReferralReversed } from "./whatsapp-helpers.js";
import { dispatchOutboundMessage, retryOutboundDelivery } from "../services/outbound-delivery";

/** Single referral delivery path. Keeping the rendering here intentionally
 * plain makes the same content available to both channels without invoking
 * the legacy provider sender a second time. */
async function dispatchReferralOutbound(
  tenantId: string,
  eventType: string,
  key: string,
  recipient: { id?: string; name: string; email: string; whatsapp?: string | null },
  subject: string,
  html: string,
  whatsappText: string,
  metadata?: Record<string, unknown>,
  referralId?: string,
  reservationId?: string | null,
): Promise<void> {
  const outbound = await dispatchOutboundMessage({
    tenantId,
    eventType,
    idempotencyKey: `referral:${key}:${eventType}`,
    recipient: recipient.id ? { type: "client", id: recipient.id } : {
      type: "direct", name: recipient.name, email: recipient.email, whatsapp: recipient.whatsapp,
    },
    email: { subject, html, senderName: undefined },
    whatsapp: { text: whatsappText },
    origin: `referral-${eventType}`,
    metadata: { ...metadata, referralId, reservationId },
  });
  await projectOutboundEmailLog(tenantId, reservationId ?? null, recipient.email, subject, outbound, referralId ?? null);

  // The idempotency key intentionally returns the existing message on a
  // repeated callback. If its provider attempt was exhausted, reopen that
  // same delivery instead of creating a second message (or applying the
  // financial reversal again). A newly-created message is left to the normal
  // queue/recovery flow; this branch is specifically for a later callback
  // recovering a previous transient failure.
  if (eventType === "reversed" && !outbound.created) {
    const emailDelivery = outbound.deliveries.find((delivery) => delivery.channel === "email");
    if (emailDelivery?.status === "failed") {
      await retryOutboundDelivery(tenantId, emailDelivery.id);
      await db.update(emailLogsTable)
        .set({ status: "queued", errorMessage: null })
        .where(and(
          eq(emailLogsTable.tenantId, tenantId),
          referralId ? eq(emailLogsTable.referralId, referralId) : isNull(emailLogsTable.referralId),
          reservationId ? eq(emailLogsTable.reservationId, reservationId) : isNull(emailLogsTable.reservationId),
          eq(emailLogsTable.subject, subject),
        ));
    }
  }
}

async function projectOutboundEmailLog(
  tenantId: string,
  reservationId: string | null,
  recipient: string,
  subject: string,
  outbound: Awaited<ReturnType<typeof dispatchOutboundMessage>>,
  referralId: string | null = null,
): Promise<void> {
  if (!outbound.created) return;
  const delivery = outbound.deliveries.find((item) => item.channel === "email");
  const status = delivery?.status === "accepted" ? "sent" :
    delivery?.status === "failed" || delivery?.status === "skipped" ? "failed" : "queued";
  await db.insert(emailLogsTable).values({
    id: generateId(),
    tenantId,
    reservationId,
    referralId,
    outboundMessageId: outbound.message.id,
    recipient,
    subject,
    status,
    messageId: delivery?.externalId ?? null,
    errorMessage: delivery?.lastError ?? delivery?.skippedReason ?? null,
  });
}

interface EnqueueEmailOpts {
  tenantId: string;
  reservationId?: string;
  subject: string;
  props: ReservationConfirmationEmailProps;
}

/**
 * Enqueues a reservation confirmation email when Redis is available,
 * otherwise falls back to sending it directly (existing behaviour).
 *
 * Always inserts an email_log record before returning.
 */
export async function enqueueReservationConfirmationEmail(opts: EnqueueEmailOpts): Promise<void> {
  const { tenantId, reservationId, subject, props } = opts;
  const html = `<h2>Reserva Confirmada! 🎉</h2><p>Olá, ${escapeHtmlEmail(props.clientName)}!</p><p><strong>Reserva:</strong> ${escapeHtmlEmail(props.reservationNumber)}</p><p><strong>Viagem:</strong> ${escapeHtmlEmail(props.tripTitle)}<br><strong>Destino:</strong> ${escapeHtmlEmail(props.destination)}<br><strong>Saída:</strong> ${escapeHtmlEmail(props.departureDate)}<br><strong>Valor total:</strong> ${formatBRL(props.totalAmount)}</p><p><a href="${props.voucherUrl}">Baixar voucher</a></p>`;
  const outbound = await dispatchOutboundMessage({
    tenantId, eventType: "reservation_confirmation",
    idempotencyKey: `reservation:${reservationId ?? props.reservationNumber}:confirmation`,
    recipient: { type: "direct", name: props.clientName, email: props.clientEmail, whatsapp: props.clientPhone },
    email: { subject, html, senderName: props.agencyName },
    whatsapp: { text: `Olá, ${props.clientName}! Sua reserva ${props.reservationNumber} foi confirmada. Viagem: ${props.tripTitle}, destino: ${props.destination}, saída: ${props.departureDate}. Voucher: ${props.voucherUrl}` },
    origin: "reservation-confirmation",
    metadata: { reservationId },
  });
  await projectOutboundEmailLog(tenantId, reservationId ?? null, props.clientEmail, subject, outbound);
  logger.info({ reservationId, success: outbound.message.status === "accepted" }, "[outbound] Confirmation dispatched");
}

// ── Enqueue / send a cancellation email ───────────────────────────────────────

export async function enqueueReservationCancellationEmail(
  reservationId: string,
  tenantId: string,
): Promise<void> {
  const props = await buildCancellationEmailPropsFromReservation(reservationId, tenantId);
  if (!props) {
    logger.warn({ reservationId }, "[email-queue] Could not build cancellation email props — skipping");
    return;
  }

  const emailLogId = generateId();
  const subject = `Reserva Cancelada — ${props.reservationNumber}`;
  const html = `<h2>Reserva Cancelada</h2><p>Olá, ${escapeHtmlEmail(props.clientName)}!</p><p>Sua reserva <strong>${escapeHtmlEmail(props.reservationNumber)}</strong> para ${escapeHtmlEmail(props.destination)} foi cancelada.</p><p>Valor total: ${formatBRL(props.totalAmount)}</p><p>Em caso de dúvidas ou reembolso, fale com a agência pelo WhatsApp.</p>`;
  const outbound = await dispatchOutboundMessage({
    tenantId, eventType: "reservation_cancellation",
    idempotencyKey: `reservation:${reservationId}:cancellation`,
    recipient: { type: "direct", name: props.clientName, email: props.clientEmail },
    email: { subject, html, senderName: props.agencyName },
    whatsapp: { text: `Olá, ${props.clientName}! Sua reserva ${props.reservationNumber} para ${props.destination} foi cancelada. Para dúvidas ou reembolso, fale com a agência: ${props.agencyPhone || props.agencyName}.` },
    origin: "reservation-cancellation",
    metadata: { reservationId },
  });
  await projectOutboundEmailLog(tenantId, reservationId, props.clientEmail, subject, outbound);
  logger.info({ reservationId, success: outbound.message.status === "accepted" }, "[outbound] Cancellation dispatched");
}

/**
 * Notifies a client that a previously cancelled trip is available again.
 *
 * Trip cancellation deliberately leaves its reservations cancelled, so this
 * notification must never imply that the old booking was reinstated. The
 * in-app notification is useful even when the client has no email address;
 * email delivery is best-effort and is recorded in email_logs.
 */
export async function dispatchTripRestorationNotification(
  reservationId: string,
  tenantId: string,
): Promise<void> {
  const [row] = await db
    .select({
      reservationNumber: reservationsTable.reservationNumber,
      voucherCode: reservationsTable.voucherCode,
      clientId: reservationsTable.clientId,
      clientName: clientsTable.name,
      clientEmail: clientsTable.email,
      tripName: tripsTable.name,
      destination: tripsTable.destination,
      departureDate: tripsTable.departureDate,
      agencyName: tenantsTable.name,
    })
    .from(reservationsTable)
    .innerJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
    .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .innerJoin(tenantsTable, eq(reservationsTable.tenantId, tenantsTable.id))
    .where(and(
      eq(reservationsTable.id, reservationId),
      eq(reservationsTable.tenantId, tenantId),
      eq(reservationsTable.status, "cancelled"),
    ))
    .limit(1);

  if (!row?.clientId) {
    logger.warn({ reservationId, tenantId }, "[trip-restoration] Reservation/client not found — skipping");
    return;
  }

  const departureDate = row.departureDate
    ? new Date(row.departureDate).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/Sao_Paulo",
    })
    : "A confirmar";
  const reservationNumber = row.reservationNumber ?? row.voucherCode ?? "";
  const agencyName = row.agencyName ?? "Agência";
  const tripName = row.tripName ?? "sua viagem";
  const safe = (value: string) => escapeHtmlEmail(value);

  try {
    await insertClientNotification(row.clientId, tenantId, "trip_restored", {
      title: "Viagem retomada — faça uma nova reserva",
      tripName,
      destination: row.destination ?? "",
      departureDate,
      reservationNumber,
      agencyName,
    });
  } catch (err) {
    logger.warn({ err, reservationId, tenantId }, "[trip-restoration] In-app notification failed");
  }

  if (!row.clientEmail) {
    logger.info({ reservationId, tenantId }, "[trip-restoration] Client has no email — in-app notification only");
    return;
  }

  const subject = `Viagem retomada — ${tripName}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;padding:24px;">
      <h2 style="color:#166534;">A viagem está disponível novamente</h2>
      <p>Olá, <strong>${safe(row.clientName ?? row.clientEmail)}</strong>!</p>
      <p>A agência <strong>${safe(agencyName)}</strong> retomou a viagem abaixo.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 8px;"><strong>${safe(tripName)}</strong></p>
        <p style="margin:4px 0;">Destino: ${safe(row.destination ?? "A confirmar")}</p>
        <p style="margin:4px 0;">Saída: ${safe(departureDate)}</p>
      </div>
      <p><strong>Atenção:</strong> sua reserva anterior (${safe(reservationNumber)}) continua cancelada e não foi reativada automaticamente.</p>
      <p>Entre em contato com a agência ou acesse o portal para fazer uma nova reserva, caso ainda queira viajar.</p>
      <p style="font-size:12px;color:#6b7280;margin-top:28px;">Esta mensagem foi enviada porque você tinha uma reserva nesta viagem.</p>
    </div>`;

  try {
    const outbound = await dispatchOutboundMessage({
      tenantId,
      eventType: "trip_restoration",
      idempotencyKey: `reservation:${reservationId}:trip-restoration`,
      recipient: { type: "direct", name: row.clientName, email: row.clientEmail },
      email: { subject, html, senderName: agencyName },
      whatsapp: {
        text: `Olá, ${row.clientName ?? ""}! A viagem ${tripName} está disponível novamente. Saída: ${departureDate}. Sua reserva anterior (${reservationNumber}) continua cancelada; acesse o portal ou fale com a agência para fazer uma nova reserva.`,
      },
      origin: "trip-restoration",
      metadata: { reservationId },
    });
    await projectOutboundEmailLog(tenantId, reservationId, row.clientEmail, subject, outbound);
    logger.info({ reservationId, tenantId, success: outbound.message.status === "accepted" }, "[trip-restoration] Email dispatched");
  } catch (err) {
    logger.warn({ err, reservationId, tenantId }, "[trip-restoration] Email dispatch failed");
    try {
      await db.insert(emailLogsTable).values({
        id: generateId(),
        tenantId,
        reservationId,
        recipient: row.clientEmail,
        subject,
        status: "failed",
        messageId: null,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } catch (logErr) {
      logger.warn({ err: logErr, reservationId, tenantId }, "[trip-restoration] Failed to record email failure");
    }
  }
}

async function buildCancellationEmailPropsFromReservation(
  reservationId: string,
  tenantId: string,
): Promise<ReservationCancellationEmailProps | null> {
  const [row] = await db
    .select({
      reservationNumber: reservationsTable.reservationNumber,
      voucherCode: reservationsTable.voucherCode,
      totalValue: reservationsTable.totalValue,
      clientName: clientsTable.name,
      clientEmail: clientsTable.email,
      tripName: tripsTable.name,
      tripDestination: tripsTable.destination,
      departureDate: tripsTable.departureDate,
      agencyName: tenantsTable.name,
      agencyLogo: tenantsTable.logoUrl,
      agencyPhone: tenantsTable.whatsapp,
      agencyPhoneVoice: tenantsTable.phone,
      agencyEmail: tenantsTable.email,
      agencyWebsite: tenantsTable.website,
      tenantSlug: tenantsTable.slug,
    })
    .from(reservationsTable)
    .innerJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
    .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .innerJoin(tenantsTable, eq(reservationsTable.tenantId, tenantsTable.id))
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)))
    .limit(1);

  if (!row || !row.clientEmail) return null;

  const totalVal = Number(row.totalValue ?? 0);
  const dDate = row.departureDate ? new Date(row.departureDate) : null;
  const departureDate = dDate
    ? dDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" })
    : "";

  const agencyPhone = row.agencyPhone ?? row.agencyPhoneVoice ?? "";
  const STORE_PUBLIC_BASE = (process.env["STORE_PUBLIC_URL"] ?? "https://visitecrm.com").replace(/\/$/, "");
  const agencyWebsite = row.agencyWebsite ?? `${STORE_PUBLIC_BASE}/loja/${row.tenantSlug}`;
  const whatsappNum = agencyPhone.replace(/\D/g, "");
  const whatsappUrl = whatsappNum ? `https://wa.me/${whatsappNum}` : "";

  return {
    reservationNumber: row.reservationNumber ?? row.voucherCode ?? "",
    voucherCode: row.voucherCode ?? "",
    clientName: row.clientName ?? "",
    clientEmail: row.clientEmail,
    tripTitle: row.tripName,
    destination: row.tripDestination ?? "",
    departureDate,
    totalAmount: totalVal,
    agencyName: row.agencyName,
    agencyLogo: row.agencyLogo ?? "",
    agencyPhone,
    agencyEmail: row.agencyEmail ?? "",
    agencyWebsite,
    whatsappUrl,
  };
}

// ── Enqueue / send a new-booking notification to the agency ───────────────────

export async function enqueueNewBookingNotificationEmail(
  reservationId: string,
  tenantId: string,
): Promise<void> {
  const built = await buildNewBookingNotificationFromReservation(reservationId, tenantId);
  if (!built) {
    logger.warn(
      { reservationId, tenantId },
      "[email-queue] Could not build new-booking notification — skipping",
    );
    return;
  }

  const { props, recipients, cc } = built;
  if (recipients.length === 0) {
    logger.warn(
      { reservationId, tenantId },
      "[email-queue] No agency recipient configured — skipping new-booking notification",
    );
    return;
  }

  const subject = `Nova reserva — ${props.reservationNumber} (${props.destination})`;
  const primaryRecipient = recipients[0];
  const html = `<h2>Nova reserva recebida</h2><p>Uma nova reserva foi criada pela vitrine pública e precisa ser atendida.</p><p><strong>Reserva:</strong> ${escapeHtmlEmail(props.reservationNumber)}<br><strong>Cliente:</strong> ${escapeHtmlEmail(props.clientName)}<br><strong>Destino:</strong> ${escapeHtmlEmail(props.destination)}<br><strong>Embarque:</strong> ${escapeHtmlEmail(props.departureDate)}<br><strong>Valor total:</strong> ${formatBRL(props.totalValue)}</p><p><a href="${props.crmReservationUrl}">Abrir reserva no CRM</a></p>`;
  const outbound = await dispatchOutboundMessage({
    tenantId, eventType: "new_booking_notification",
    idempotencyKey: `reservation:${reservationId}:new-booking-notification`,
    recipient: { type: "direct", email: primaryRecipient },
    email: { subject, html, senderName: props.agencyName },
    whatsapp: {
      text: `Nova reserva recebida! Reserva ${props.reservationNumber}, cliente ${props.clientName}, destino ${props.destination}, embarque ${props.departureDate}, valor ${formatBRL(props.totalValue)}. Acesse: ${props.crmReservationUrl}`,
    },
    origin: "new-booking-notification",
    metadata: { reservationId, recipients, cc },
  });
  await projectOutboundEmailLog(tenantId, reservationId, primaryRecipient, subject, outbound);
  logger.info({ reservationId, recipients, cc, success: outbound.message.status === "accepted" }, "[outbound] New-booking notification dispatched");
}

interface BuiltNewBookingNotification {
  props: NewBookingNotificationEmailProps;
  recipients: string[];
  cc: string[];
}

async function buildNewBookingNotificationFromReservation(
  reservationId: string,
  tenantId: string,
): Promise<BuiltNewBookingNotification | null> {
  const [row] = await db
    .select({
      reservationNumber: reservationsTable.reservationNumber,
      voucherCode: reservationsTable.voucherCode,
      totalValue: reservationsTable.totalValue,
      clientName: clientsTable.name,
      clientEmail: clientsTable.email,
      clientPhone: clientsTable.whatsapp,
      tripDestination: tripsTable.destination,
      tripName: tripsTable.name,
      departureDate: tripsTable.departureDate,
      agencyName: tenantsTable.name,
      agencyLogo: tenantsTable.logoUrl,
    })
    .from(reservationsTable)
    .innerJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
    .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .innerJoin(tenantsTable, eq(reservationsTable.tenantId, tenantsTable.id))
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)))
    .limit(1);

  if (!row) return null;

  const [store] = await db
    .select({
      email: storesTable.email,
      notificationEmail: storesTable.notificationEmail,
      orderNotificationEnabled: storesTable.orderNotificationEnabled,
    })
    .from(storesTable)
    .where(eq(storesTable.tenantId, tenantId))
    .limit(1);

  if (store && store.orderNotificationEnabled === false) {
    logger.info({ reservationId, tenantId }, "[email-queue] New-booking notification disabled for this store — skipping");
    return null;
  }

  const dDate = row.departureDate ? new Date(row.departureDate) : null;
  const departureDate = dDate
    ? dDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" })
    : "A confirmar";

  const ccUsers = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.tenantId, tenantId),
        eq(usersTable.isActive, true),
        inArray(usersTable.role, [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER]),
      ),
    );

  const recipients: string[] = [];
  const primaryEmail = store?.notificationEmail ?? store?.email ?? null;
  if (primaryEmail) recipients.push(primaryEmail);

  // If the store has no e-mail configured, promote agency admins/managers
  // to the primary "to" list so the notification still goes out.
  if (recipients.length === 0) {
    for (const u of ccUsers) {
      if (u.email && !recipients.includes(u.email)) recipients.push(u.email);
    }
  }

  const ccSet = new Set<string>();
  for (const u of ccUsers) {
    if (u.email && !recipients.includes(u.email)) ccSet.add(u.email);
  }
  const cc = Array.from(ccSet);

  const frontendBase = (process.env["FRONTEND_URL"] ?? "https://app.visitecrm.com.br").replace(/\/$/, "");
  const crmReservationUrl = `${frontendBase}/reservations/${reservationId}`;

  return {
    props: {
      agencyName: row.agencyName,
      agencyLogo: row.agencyLogo ?? null,
      clientName: row.clientName ?? "",
      clientEmail: row.clientEmail ?? undefined,
      clientPhone: row.clientPhone ?? undefined,
      destination: row.tripDestination ?? row.tripName ?? "A confirmar",
      departureDate,
      reservationNumber: row.reservationNumber ?? row.voucherCode ?? "",
      totalValue: Number(row.totalValue ?? 0),
      crmReservationUrl,
    },
    recipients,
    cc,
  };
}

// ── Build email props from reservation ID ─────────────────────────────────────

export async function buildEmailPropsFromReservation(
  reservationId: string,
  tenantId: string,
): Promise<ReservationConfirmationEmailProps | null> {
  const [row] = await db
    .select({
      reservationNumber: reservationsTable.reservationNumber,
      voucherCode: reservationsTable.voucherCode,
      totalValue: reservationsTable.totalValue,
      paidValue: reservationsTable.paidValue,
      balance: reservationsTable.balance,
      paymentMethod: reservationsTable.paymentMethod,
      seats: reservationsTable.seats,
      discountReferralAmount: reservationsTable.discountReferralAmount,
      discountCouponAmount: reservationsTable.discountCouponAmount,
      clientName: clientsTable.name,
      clientEmail: clientsTable.email,
      clientCpf: clientsTable.cpf,
      clientPhone: clientsTable.whatsapp,
      tripName: tripsTable.name,
      tripDestination: tripsTable.destination,
      departureDate: tripsTable.departureDate,
      returnDate: tripsTable.returnDate,
      agencyName: tenantsTable.name,
      agencyLogo: tenantsTable.logoUrl,
      agencyPhone: tenantsTable.whatsapp,
      agencyPhoneVoice: tenantsTable.phone,
      agencyEmail: tenantsTable.email,
      agencyWebsite: tenantsTable.website,
      tenantSlug: tenantsTable.slug,
      referralDiscountType: referralSettingsTable.discountType,
      referralDiscountValue: referralSettingsTable.discountValue,
    })
    .from(reservationsTable)
    .innerJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
    .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .innerJoin(tenantsTable, eq(reservationsTable.tenantId, tenantsTable.id))
    .leftJoin(referralSettingsTable, eq(referralSettingsTable.tenantId, tenantsTable.id))
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)))
    .limit(1);

  if (!row || !row.clientEmail) return null;

  const totalVal = Number(row.totalValue ?? 0);
  const paidVal = Number(row.paidValue ?? 0);
  const balanceVal = Number(row.balance ?? 0);
  const paymentStatus: "paid" | "partial" | "pending" =
    paidVal >= totalVal ? "paid" : paidVal > 0 ? "partial" : "pending";

  const dDate = row.departureDate ? new Date(row.departureDate) : null;
  const departureDate = dDate
    ? dDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" })
    : "";

  let duration = "";
  if (dDate && row.returnDate) {
    const retDate = new Date(row.returnDate);
    const diffDays = Math.round((retDate.getTime() - dDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) duration = `${diffDays} dia${diffDays !== 1 ? "s" : ""}`;
  }

  const agencyPhone = row.agencyPhone ?? row.agencyPhoneVoice ?? "";
  const STORE_PUBLIC_BASE = (process.env["STORE_PUBLIC_URL"] ?? "https://visitecrm.com").replace(/\/$/, "");
  const agencyWebsite = row.agencyWebsite ?? `${STORE_PUBLIC_BASE}/loja/${row.tenantSlug}`;
  const whatsappNum = agencyPhone.replace(/\D/g, "");
  const whatsappUrl = whatsappNum ? `https://wa.me/${whatsappNum}` : "";
  const publicBase = agencyWebsite.replace(/\/$/, "");
  const voucherUrl = `${publicBase}/reserva/${row.voucherCode}`;
  const consultUrl = `${publicBase}/reservas`;
  const profileUrl = `${publicBase}/perfil?tab=reservas`;

  const discountReferralAmt = Number(row.discountReferralAmount ?? 0);
  const discountCouponAmt = Number(row.discountCouponAmount ?? 0);
  const discountReferralPercent =
    discountReferralAmt > 0 && row.referralDiscountType === "percentage" && row.referralDiscountValue
      ? Number(row.referralDiscountValue)
      : undefined;

  return {
    reservationNumber: row.reservationNumber ?? row.voucherCode ?? "",
    voucherCode: row.voucherCode ?? "",
    clientName: row.clientName ?? "",
    clientCpf: row.clientCpf ?? "",
    clientEmail: row.clientEmail,
    clientPhone: row.clientPhone ?? "",
    tripTitle: row.tripName,
    destination: row.tripDestination ?? "",
    departureDate,
    duration,
    seats: (row.seats ?? []) as string[],
    totalAmount: totalVal,
    amountPaid: paidVal,
    amountPending: balanceVal,
    paymentMethod: row.paymentMethod ?? "pix",
    paymentStatus,
    discountReferralAmount: discountReferralAmt > 0 ? discountReferralAmt : undefined,
    discountReferralPercent,
    discountCouponAmount: discountCouponAmt > 0 ? discountCouponAmt : undefined,
    agencyName: row.agencyName,
    agencyLogo: row.agencyLogo ?? "",
    agencyPhone,
    agencyPhoneVoice: row.agencyPhoneVoice ?? "",
    agencyEmail: row.agencyEmail,
    agencyWebsite,
    voucherUrl,
    consultUrl,
    profileUrl,
    whatsappUrl,
  };
}

// ── Send a welcome email for a newly created portal account ───────────────────
// Sends directly (no queue) and logs the outcome to email_logs.

export async function sendWelcomeEmail(
  props: WelcomeCredentialsEmailProps,
  tenantId: string,
): Promise<void> {
  const emailLogId = generateId();
  const subject = `Bem-vindo(a)! Acesse sua Área do Cliente — ${props.agencyName}`;

  await dispatchReferralOutbound(tenantId, "welcome_credentials", props.clientEmail, {
    name: props.clientName, email: props.clientEmail,
  }, subject,
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;padding:24px;">
      <h2 style="color:#2563eb;">Bem-vindo(a), ${escapeHtmlEmail(props.clientName)}!</h2>
      <p>Sua Área do Cliente da <strong>${escapeHtmlEmail(props.agencyName)}</strong> foi criada.</p>
      <p>Use o botão abaixo para acessar suas viagens, vouchers e pagamentos em um navegador novo:</p>
      <p><a href="${escapeHtmlEmail(props.setupUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">Acessar Minha Área</a></p>
      <div style="background:#f3f4f6;border-radius:8px;padding:14px;margin:20px 0;">
        <p style="margin:4px 0;"><strong>E-mail:</strong> ${escapeHtmlEmail(props.clientEmail)}</p>
        ${props.plainTextPassword
          ? `<p style="margin:4px 0;"><strong>Senha temporária:</strong> ${escapeHtmlEmail(props.plainTextPassword)}</p>
             <p style="font-size:12px;color:#4b5563;margin:8px 0 0;">Troque a senha assim que entrar no portal.</p>`
          : ""}
      </div>
      <p>Se o botão não funcionar, acesse a página de login diretamente:
        <a href="${escapeHtmlEmail(props.loginUrl)}">${escapeHtmlEmail(props.loginUrl)}</a>
      </p>
    </div>`,
    `Olá, ${props.clientName}! Sua Área do Cliente da ${props.agencyName} foi criada. Acesse: ${props.setupUrl}. E-mail: ${props.clientEmail}${props.plainTextPassword ? `; senha temporária: ${props.plainTextPassword}` : ""}.`);

  logger.info(
    { emailLogId, recipient: props.clientEmail, success: true },
    "[email-queue] Welcome email sent",
  );
}

export async function enqueuePixOrderQr(opts: {
  tenantId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  storeName: string;
  amount: number;
  pixQrCodeUrl: string;
  pixCopyPaste: string;
  deliveryMode: "email" | "whatsapp" | "all";
}): Promise<void> {
  const { tenantId, orderId, orderNumber, customerName, customerEmail, customerPhone, storeName,
    amount, pixQrCodeUrl, pixCopyPaste, deliveryMode } = opts;
  const includeEmail = deliveryMode === "email" || deliveryMode === "all";
  const includeWhatsapp = deliveryMode === "whatsapp" || deliveryMode === "all";
  const subject = `PIX do pedido ${orderNumber} — ${storeName}`;
  const safeName = escapeHtmlEmail(customerName);
  const safeStore = escapeHtmlEmail(storeName);
  const safeOrder = escapeHtmlEmail(orderNumber);
  const safeQrUrl = escapeHtmlEmail(pixQrCodeUrl);
  const safeCopyPaste = escapeHtmlEmail(pixCopyPaste);
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;padding:24px;">
      <h2 style="color:#0f766e;">Pagamento PIX do seu pedido</h2>
      <p>Olá, <strong>${safeName}</strong>!</p>
      <p>O pedido <strong>${safeOrder}</strong> da <strong>${safeStore}</strong> está aguardando pagamento.</p>
      <p>Valor da cobrança: <strong>${formatBRL(amount)}</strong></p>
      <p><img src="${safeQrUrl}" alt="QR Code PIX" width="220" height="220" style="border:1px solid #99f6e4;border-radius:8px;padding:4px;background:#fff;" /></p>
      <p>Se preferir, use o código Pix Copia e Cola:</p>
      <p style="word-break:break-all;background:#f0fdfa;border:1px solid #99f6e4;padding:12px;border-radius:8px;font-family:monospace;font-size:12px;">${safeCopyPaste}</p>
      <p>Após a identificação do pagamento, a agência atualizará o status da sua reserva.</p>
    </div>`;
  const outbound = await dispatchOutboundMessage({
    tenantId,
    eventType: "pix_order_qr",
    // The QR is one logical order event. The selected channel is payload
    // state, not part of the event identity; including it here would let a
    // settings change or an idempotent replay create a second email/message
    // for the same order.
    idempotencyKey: `order:${orderId}:pix-qr`,
    recipient: { type: "direct", name: customerName, email: customerEmail, whatsapp: customerPhone },
    ...(includeEmail ? { email: { subject, html, senderName: storeName } } : {}),
    ...(includeWhatsapp ? {
      whatsapp: {
        text: `Olá, ${customerName}! O pedido ${orderNumber} da ${storeName} está aguardando pagamento PIX de ${formatBRL(amount)}. Pix Copia e Cola: ${pixCopyPaste}`,
      },
    } : {}),
    origin: "pix-order-qr",
    metadata: { orderId, orderNumber, deliveryMode },
  });
  if (includeEmail) {
    await projectOutboundEmailLog(tenantId, null, customerEmail, subject, outbound);
  }

  // A replay returns the original idempotent message. If its first provider
  // attempt was exhausted, reopen only the selected channels that actually
  // failed; accepted channels must never be sent again.
  if (!outbound.created) {
    const persistedDeliveryMode = outbound.message.metadata?.deliveryMode;
    const retryDeliveryMode =
      persistedDeliveryMode === "email" ||
      persistedDeliveryMode === "whatsapp" ||
      persistedDeliveryMode === "all"
        ? persistedDeliveryMode
        : deliveryMode;
    const selectedChannels = new Set(
      [
        retryDeliveryMode === "email" || retryDeliveryMode === "all" ? "email" : null,
        retryDeliveryMode === "whatsapp" || retryDeliveryMode === "all" ? "whatsapp" : null,
      ].filter((channel): channel is "email" | "whatsapp" => channel !== null),
    );
    await Promise.all(outbound.deliveries
      .filter((delivery) =>
        selectedChannels.has(delivery.channel) &&
        (delivery.status === "failed" ||
          (delivery.status === "skipped" && delivery.skippedReason === "provider_unavailable")))
      .map(async (delivery) => {
        try {
          await retryOutboundDelivery(tenantId, delivery.id);
        } catch (err) {
          // A concurrent recovery worker may have already reopened the row.
          // Keep the replay best-effort and let the durable recovery sweep
          // handle the remaining pending delivery.
          logger.warn({ err, orderId, deliveryId: delivery.id }, "[outbound] Failed to retry PIX QR delivery");
        }
      }));
  }

  logger.info({ tenantId, orderId, deliveryMode, status: outbound.message.status }, "[outbound] PIX QR dispatched");
}

// ── Referral: bônus pago ──────────────────────────────────────────────────────

export async function enqueueReferralBonusPaidEmail(
  props: ReferralBonusPaidEmailProps,
  tenantId: string,
  clientId?: string,
  referralId?: string,
): Promise<void> {
  const emailLogId = generateId();
  const subject = `Seu bônus de indicação foi pago! — ${props.agencyName}`;
  await dispatchReferralOutbound(tenantId, "bonus_paid", clientId ?? props.referrerEmail, {
    id: clientId, name: props.referrerName, email: props.referrerEmail,
  }, subject,
    `<h2>Bônus de indicação pago!</h2><p>Olá, ${escapeHtmlEmail(props.referrerName)}!</p><p>A ${escapeHtmlEmail(props.agencyName)} confirmou o pagamento do seu bônus de <strong>${formatBRL(props.bonusAmount)}</strong>, em ${escapeHtmlEmail(props.paidDate)}.</p>`,
    `Olá, ${props.referrerName}! A ${props.agencyName} confirmou o pagamento do seu bônus de indicação: ${formatBRL(props.bonusAmount)} em ${props.paidDate}.`,
    { bonusAmount: props.bonusAmount }, referralId);
  return;
  const queue = getReferralEmailQueue()!;

  if (queue) {
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: props.referrerEmail,
      subject,
      status: "queued",
    });

    try {
      const jobData: ReferralBonusPaidEmailJobData = { ...props, emailLogId, tenantId };
      await queue.add("referral-bonus-paid", jobData);
      logger.info({ emailLogId, referrerEmail: props.referrerEmail }, "[email-queue] Referral bonus-paid email enqueued");
    } catch (enqueueErr) {
      logger.warn({ emailLogId, err: enqueueErr }, "[email-queue] Failed to enqueue referral bonus-paid — falling back to direct send");
      const result = await sendReferralBonusPaidEmail(props);
      await db
        .update(emailLogsTable)
        .set({
          status: result.success ? "sent" : "failed",
          messageId: result.messageId ?? null,
          errorMessage: result.error ?? null,
        })
        .where(eq(emailLogsTable.id, emailLogId));
    }
  } else {
    if (!areWorkersEnabled()) {
      logger.warn(
        { tenantId, jobType: "referral-bonus-paid" },
        "[workers-disabled] ENABLE_WORKERS=false — sending referral bonus-paid email directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    const result = await sendReferralBonusPaidEmail(props);
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: props.referrerEmail,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });
    logger.info({ emailLogId, referrerEmail: props.referrerEmail, success: result.success }, "[email-queue] Referral bonus-paid email sent directly");
  }
}

// ── Referral: indicação confirmada ────────────────────────────────────────────

export async function enqueueReferralConvertedEmail(
  props: ReferralConvertedEmailProps,
  tenantId: string,
  clientId?: string,
  referralId?: string,
): Promise<void> {
  const emailLogId = generateId();
  const subject = `Sua indicação foi confirmada! — ${props.agencyName}`;
  await dispatchReferralOutbound(tenantId, "converted", clientId ?? props.referrerEmail, {
    id: clientId, name: props.referrerName, email: props.referrerEmail,
  }, subject,
    `<h2>Indicação confirmada!</h2><p>Olá, ${escapeHtmlEmail(props.referrerName)}!</p><p>${escapeHtmlEmail(props.referredName)} realizou uma compra usando seu código. Seu bônus de <strong>${formatBRL(props.bonusAmount)}</strong> será liberado em breve.</p>`,
    `Olá, ${props.referrerName}! ${props.referredName} realizou uma compra usando seu código. Seu bônus de ${formatBRL(props.bonusAmount)} será liberado em breve.`,
    { referredName: props.referredName, bonusAmount: props.bonusAmount }, referralId);
  return;
  const queue = getReferralEmailQueue()!;

  if (queue) {
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: props.referrerEmail,
      subject,
      status: "queued",
    });

    try {
      const jobData: ReferralConvertedEmailJobData = { ...props, emailLogId, tenantId };
      await queue.add("referral-converted", jobData);
      logger.info({ emailLogId, referrerEmail: props.referrerEmail }, "[email-queue] Referral converted email enqueued");
    } catch (enqueueErr) {
      logger.warn({ emailLogId, err: enqueueErr }, "[email-queue] Failed to enqueue referral converted — falling back to direct send");
      const result = await sendReferralConvertedEmail(props);
      await db
        .update(emailLogsTable)
        .set({
          status: result.success ? "sent" : "failed",
          messageId: result.messageId ?? null,
          errorMessage: result.error ?? null,
        })
        .where(eq(emailLogsTable.id, emailLogId));
    }
  } else {
    if (!areWorkersEnabled()) {
      logger.warn(
        { tenantId, jobType: "referral-converted" },
        "[workers-disabled] ENABLE_WORKERS=false — sending referral converted email directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    const result = await sendReferralConvertedEmail(props);
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: props.referrerEmail,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });
    logger.info({ emailLogId, referrerEmail: props.referrerEmail, success: result.success }, "[email-queue] Referral converted email sent directly");
  }
}

// ── Referral: indicação expirada ──────────────────────────────────────────────

export async function enqueueReferralExpiredEmail(
  props: ReferralExpiredEmailProps,
  tenantId: string,
  clientId?: string,
  referralId?: string,
): Promise<void> {
  const emailLogId = generateId();
  const subject = `Sua indicação expirou — compartilhe novamente! — ${props.agencyName}`;
  await dispatchReferralOutbound(tenantId, "expired", clientId ?? props.referrerEmail, {
    id: clientId, name: props.referrerName, email: props.referrerEmail,
  }, subject,
    `<h2>Sua indicação expirou</h2><p>Olá, ${escapeHtmlEmail(props.referrerName)}!</p><p>Seu código de indicação expirou sem utilização. Acesse sua Área do Cliente para gerar um novo código e continuar ganhando bônus.</p>`,
    `Olá, ${props.referrerName}! Seu código de indicação expirou sem utilização. Acesse sua Área do Cliente para gerar um novo código e continuar ganhando bônus.`,
    undefined, referralId);
  return;
  const queue = getReferralEmailQueue()!;

  if (queue) {
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: props.referrerEmail,
      subject,
      status: "queued",
    });

    try {
      const jobData: ReferralExpiredEmailJobData = { ...props, emailLogId, tenantId };
      await queue.add("referral-expired", jobData);
      logger.info({ emailLogId, referrerEmail: props.referrerEmail }, "[email-queue] Referral expired email enqueued");
    } catch (enqueueErr) {
      logger.warn({ emailLogId, err: enqueueErr }, "[email-queue] Failed to enqueue referral expired — falling back to direct send");
      const result = await sendReferralExpiredEmail(props);
      await db
        .update(emailLogsTable)
        .set({
          status: result.success ? "sent" : "failed",
          messageId: result.messageId ?? null,
          errorMessage: result.error ?? null,
        })
        .where(eq(emailLogsTable.id, emailLogId));
    }
  } else {
    if (!areWorkersEnabled()) {
      logger.warn(
        { tenantId, jobType: "referral-expired" },
        "[workers-disabled] ENABLE_WORKERS=false — sending referral expired email directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    const result = await sendReferralExpiredEmail(props);
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: props.referrerEmail,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });
    logger.info({ emailLogId, referrerEmail: props.referrerEmail, success: result.success }, "[email-queue] Referral expired email sent directly");
  }
}

// ── High-level: look up referrer data and dispatch converted email ─────────────

export async function dispatchReferralConvertedEmail(
  referrerId: string,
  referredName: string,
  tenantId: string,
): Promise<void> {
  const [referrer] = await db
    .select({ name: clientsTable.name, email: clientsTable.email })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, referrerId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  if (!referrer?.email) {
    logger.warn({ referrerId, tenantId }, "[email-queue] Referral converted: referrer has no email — skipping");
    return;
  }

  const [tenant] = await db
    .select({ name: tenantsTable.name, logoUrl: tenantsTable.logoUrl })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const [settings] = await db
    .select({ bonusValue: referralSettingsTable.bonusValue })
    .from(referralSettingsTable)
    .where(eq(referralSettingsTable.tenantId, tenantId))
    .limit(1);

  const bonusAmount = settings ? Number(settings.bonusValue) : 0;

  await enqueueReferralConvertedEmail(
    {
      referrerName: referrer.name ?? referrer.email,
      referrerEmail: referrer.email,
      referredName,
      bonusAmount,
      agencyName: tenant?.name ?? "Agência",
      agencyLogo: tenant?.logoUrl ?? null,
    },
    tenantId,
    referrerId,
  );

  insertClientNotification(referrerId, tenantId, "referral_converted", {
    referredName,
    bonusAmount,
    agencyName: tenant?.name ?? "Agência",
  }).catch((err: unknown) => {
    logger.warn({ referrerId, tenantId, err }, "[client-notifications] Failed to insert referral_converted notification");
  });
}

// ── High-level: look up referrer data and dispatch expired email ───────────────

export async function dispatchReferralExpiredEmail(
  referrerId: string,
  tenantId: string,
): Promise<void> {
  const [referrer] = await db
    .select({ name: clientsTable.name, email: clientsTable.email })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, referrerId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  if (!referrer?.email) {
    logger.warn({ referrerId, tenantId }, "[email-queue] Referral expired: referrer has no email — skipping");
    return;
  }

  const [tenant] = await db
    .select({ name: tenantsTable.name, logoUrl: tenantsTable.logoUrl })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  await enqueueReferralExpiredEmail(
    {
      referrerName: referrer.name ?? referrer.email,
      referrerEmail: referrer.email,
      agencyName: tenant?.name ?? "Agência",
      agencyLogo: tenant?.logoUrl ?? null,
    },
    tenantId,
    referrerId,
  );
}

// ── Referral: código expirando em breve ───────────────────────────────────────

export async function enqueueReferralExpiringSoonEmail(
  props: ReferralExpiringSoonEmailProps,
  tenantId: string,
  referralId?: string,
  clientId?: string,
): Promise<void> {
  const emailLogId = generateId();
  const daysLabel = props.daysLeft <= 1 ? "1 dia" : `${props.daysLeft} dias`;
  const subject = `⏰ Seu código ${props.referralCode} vence em ${daysLabel} — ${props.agencyName}`;
  await dispatchReferralOutbound(tenantId, "expiring_soon", clientId ?? props.referrerEmail, {
    id: clientId, name: props.referrerName, email: props.referrerEmail,
  }, subject,
    `<h2>Seu código vence em ${escapeHtmlEmail(daysLabel)}</h2><p>Olá, ${escapeHtmlEmail(props.referrerName)}!</p><p>Seu código <strong>${escapeHtmlEmail(props.referralCode)}</strong> vence em ${escapeHtmlEmail(props.expiresAt)}. Compartilhe agora para ganhar seu bônus.</p>${props.shareUrl ? `<p><a href="${props.shareUrl}">Compartilhar código</a></p>` : ""}`,
    `Olá, ${props.referrerName}! Seu código ${props.referralCode} vence em ${daysLabel} (${props.expiresAt}). Compartilhe agora para ganhar seu bônus.${props.shareUrl ? ` ${props.shareUrl}` : ""}`,
    { referralCode: props.referralCode, expiresAt: props.expiresAt }, referralId);
  return;
  const queue = getReferralEmailQueue()!;

  if (queue) {
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      referralId: referralId ?? null,
      recipient: props.referrerEmail,
      subject,
      status: "queued",
    });

    try {
      const jobData: ReferralExpiringSoonEmailJobData = { ...props, emailLogId, tenantId };
      await queue.add("referral-expiring-soon", jobData);
      logger.info({ emailLogId, referrerEmail: props.referrerEmail, daysLeft: props.daysLeft }, "[email-queue] Referral expiring-soon email enqueued");
    } catch (enqueueErr) {
      logger.warn({ emailLogId, err: enqueueErr }, "[email-queue] Failed to enqueue referral expiring-soon — falling back to direct send");
      const result = await sendReferralExpiringSoonEmail(props);
      await db
        .update(emailLogsTable)
        .set({
          status: result.success ? "sent" : "failed",
          messageId: result.messageId ?? null,
          errorMessage: result.error ?? null,
        })
        .where(eq(emailLogsTable.id, emailLogId));
    }
  } else {
    if (!areWorkersEnabled()) {
      logger.warn(
        { tenantId, jobType: "referral-expiring-soon" },
        "[workers-disabled] ENABLE_WORKERS=false — sending referral expiring-soon email directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    const result = await sendReferralExpiringSoonEmail(props);
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      referralId: referralId ?? null,
      recipient: props.referrerEmail,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });
    logger.info({ emailLogId, referrerEmail: props.referrerEmail, daysLeft: props.daysLeft, success: result.success }, "[email-queue] Referral expiring-soon email sent directly");
  }
}

// ── High-level: look up referrer data and dispatch expiring-soon email ─────────

export async function dispatchReferralExpiringSoonEmail(
  referrerId: string,
  tenantId: string,
  referralCode: string,
  expiresAt: Date,
  daysLeft: number,
  referralId?: string,
): Promise<void> {
  const [referrer] = await db
    .select({ name: clientsTable.name, email: clientsTable.email })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, referrerId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  if (!referrer?.email) {
    logger.warn({ referrerId, tenantId }, "[email-queue] Referral expiring-soon: referrer has no email — skipping");
    return;
  }

  const [tenant] = await db
    .select({ name: tenantsTable.name, logoUrl: tenantsTable.logoUrl })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const [settings] = await db
    .select({ shareMessage: referralSettingsTable.shareMessage })
    .from(referralSettingsTable)
    .where(eq(referralSettingsTable.tenantId, tenantId))
    .limit(1);

  const formattedDate = expiresAt.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });

  const agencyName = tenant?.name ?? "Agência";
  const defaultShareMessage = settings?.shareMessage
    ?? `Olá! Use meu código ${referralCode} na ${agencyName} e ganhe desconto especial na sua próxima viagem! 🌴✈️`;
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(defaultShareMessage)}`;

  await enqueueReferralExpiringSoonEmail(
    {
      referrerName: referrer.name ?? referrer.email,
      referrerEmail: referrer.email,
      referralCode,
      expiresAt: formattedDate,
      daysLeft,
      agencyName,
      agencyLogo: tenant?.logoUrl ?? null,
      shareUrl,
    },
    tenantId,
    referralId,
    referrerId,
  );
}

// ── Referral: bônus liberado para pagamento ───────────────────────────────────

export async function enqueueReferralBonusReleasedEmail(
  props: ReferralBonusReleasedEmailProps,
  tenantId: string,
  referralId?: string,
  clientId?: string,
): Promise<void> {
  const emailLogId = generateId();
  const subject = `🎉 Seu bônus de indicação está disponível para resgate! — ${props.agencyName}`;
  await dispatchReferralOutbound(tenantId, "bonus_released", referralId ?? clientId ?? props.referrerEmail, {
    id: clientId, name: props.referrerName, email: props.referrerEmail,
  }, subject,
    `<h2>Seu bônus está disponível!</h2><p>Olá, ${escapeHtmlEmail(props.referrerName)}!</p><p>Seu bônus de indicação de <strong>${formatBRL(props.bonusAmount)}</strong> está disponível para resgate desde ${escapeHtmlEmail(props.releaseDate)}.</p>`,
    `Olá, ${props.referrerName}! Seu bônus de indicação de ${formatBRL(props.bonusAmount)} está disponível para resgate desde ${props.releaseDate}.`,
    { bonusAmount: props.bonusAmount, releaseDate: props.releaseDate }, referralId);
  return;
  const queue = getReferralEmailQueue()!;

  if (queue) {
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      referralId: referralId ?? null,
      recipient: props.referrerEmail,
      subject,
      status: "queued",
    });

    try {
      const jobData: ReferralBonusReleasedEmailJobData = { ...props, emailLogId, tenantId };
      await queue.add("referral-bonus-released", jobData);
      logger.info({ emailLogId, referrerEmail: props.referrerEmail, referralId }, "[email-queue] Referral bonus-released email enqueued");
    } catch (enqueueErr) {
      logger.warn({ emailLogId, err: enqueueErr }, "[email-queue] Failed to enqueue referral bonus-released — falling back to direct send");
      const result = await sendReferralBonusReleasedEmail(props);
      await db
        .update(emailLogsTable)
        .set({
          status: result.success ? "sent" : "failed",
          messageId: result.messageId ?? null,
          errorMessage: result.error ?? null,
        })
        .where(eq(emailLogsTable.id, emailLogId));
    }
  } else {
    if (!areWorkersEnabled()) {
      logger.warn(
        { tenantId, jobType: "referral-bonus-released" },
        "[workers-disabled] ENABLE_WORKERS=false — sending referral bonus-released email directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    const result = await sendReferralBonusReleasedEmail(props);
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      referralId: referralId ?? null,
      recipient: props.referrerEmail,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });
    logger.info({ emailLogId, referrerEmail: props.referrerEmail, referralId, success: result.success }, "[email-queue] Referral bonus-released email sent directly");
  }
}

// ── High-level: look up referrer data and dispatch bonus-released email ────────

export async function dispatchReferralBonusReleasedEmail(
  referrerId: string,
  tenantId: string,
  bonusAmount: number,
  releaseDate: string,
  referralId?: string,
): Promise<boolean> {
  const [referrer] = await db
    .select({ name: clientsTable.name, email: clientsTable.email })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, referrerId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  if (!referrer?.email) {
    logger.warn({ referrerId, tenantId, referralId }, "[email-queue] Referral bonus-released: referrer has no email — skipping (not stamping)");
    return false;
  }

  const [tenant] = await db
    .select({ name: tenantsTable.name, logoUrl: tenantsTable.logoUrl })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  await enqueueReferralBonusReleasedEmail(
    {
      referrerName: referrer.name ?? referrer.email,
      referrerEmail: referrer.email,
      bonusAmount,
      releaseDate,
      agencyName: tenant?.name ?? "Agência",
      agencyLogo: tenant?.logoUrl ?? null,
    },
    tenantId,
    referralId,
    referrerId,
  );

  insertClientNotification(referrerId, tenantId, "referral_bonus_released", {
    bonusAmount,
    agencyName: tenant?.name ?? "Agência",
  }).catch((err: unknown) => {
    logger.warn({ referrerId, tenantId, referralId, err }, "[client-notifications] Failed to insert referral_bonus_released notification");
  });

  return true;
}

// ── Referral: pontos de fidelidade creditados ─────────────────────────────────

async function enqueueReferralLoyaltyPointsEmail(
  props: ReferralLoyaltyPointsEmailProps,
  tenantId: string,
  clientId?: string,
): Promise<void> {
  const emailLogId = generateId();
  const subject = `⭐ Você ganhou ${props.pointsEarned} pontos de fidelidade! — ${props.agencyName}`;
  await dispatchReferralOutbound(tenantId, "loyalty_points", clientId ?? props.referrerEmail, {
    id: clientId, name: props.referrerName, email: props.referrerEmail,
  }, subject,
    `<h2>Você ganhou pontos de fidelidade!</h2><p>Olá, ${escapeHtmlEmail(props.referrerName)}!</p><p>Você ganhou <strong>${props.pointsEarned} pontos</strong>. Seu saldo atual é de ${props.currentBalance} pontos.</p>${props.profileUrl ? `<p><a href="${props.profileUrl}">Ver meu perfil</a></p>` : ""}`,
    `Olá, ${props.referrerName}! Você ganhou ${props.pointsEarned} pontos de fidelidade. Seu saldo atual é de ${props.currentBalance} pontos.${props.profileUrl ? ` ${props.profileUrl}` : ""}`,
    { pointsEarned: props.pointsEarned, currentBalance: props.currentBalance });
  return;
  const queue = getReferralEmailQueue()!;

  if (queue) {
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: props.referrerEmail,
      subject,
      status: "queued",
    });

    try {
      const jobData: ReferralLoyaltyPointsEmailJobData = { ...props, emailLogId, tenantId };
      await queue.add("referral-loyalty-points", jobData);
      logger.info({ emailLogId, referrerEmail: props.referrerEmail }, "[email-queue] Referral loyalty-points email enqueued");
    } catch (enqueueErr) {
      logger.warn({ emailLogId, err: enqueueErr }, "[email-queue] Failed to enqueue referral loyalty-points — falling back to direct send");
      const result = await sendReferralLoyaltyPointsEmail(props);
      await db
        .update(emailLogsTable)
        .set({
          status: result.success ? "sent" : "failed",
          messageId: result.messageId ?? null,
          errorMessage: result.error ?? null,
        })
        .where(eq(emailLogsTable.id, emailLogId));
    }
  } else {
    if (!areWorkersEnabled()) {
      logger.warn(
        { tenantId, jobType: "referral-loyalty-points" },
        "[workers-disabled] ENABLE_WORKERS=false — sending referral loyalty-points email directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    const result = await sendReferralLoyaltyPointsEmail(props);
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: props.referrerEmail,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });
    logger.info({ emailLogId, referrerEmail: props.referrerEmail, success: result.success }, "[email-queue] Referral loyalty-points email sent directly");
  }
}

export async function dispatchReferralLoyaltyPointsEmail(
  referrerId: string,
  tenantId: string,
  pointsEarned: number,
  currentBalance: number,
): Promise<void> {
  const [referrer] = await db
    .select({ name: clientsTable.name, email: clientsTable.email })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, referrerId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  if (!referrer?.email) {
    logger.warn({ referrerId, tenantId }, "[email-queue] Referral loyalty-points: referrer has no email — skipping");
    return;
  }

  const [tenant] = await db
    .select({ name: tenantsTable.name, logoUrl: tenantsTable.logoUrl, slug: tenantsTable.slug })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const STORE_PUBLIC_BASE = (process.env["STORE_PUBLIC_URL"] ?? "https://visitecrm.com").replace(/\/$/, "");
  const profileUrl = tenant?.slug ? `${STORE_PUBLIC_BASE}/loja/${tenant.slug}/perfil?tab=indicacoes` : undefined;

  await enqueueReferralLoyaltyPointsEmail(
    {
      referrerName: referrer.name ?? referrer.email,
      referrerEmail: referrer.email,
      pointsEarned,
      currentBalance,
      agencyName: tenant?.name ?? "Agência",
      agencyLogo: tenant?.logoUrl ?? null,
      profileUrl,
    },
    tenantId,
    referrerId,
  );
}

// ── Referral: boas-vindas ao código de indicação ─────────────────────────────

export async function enqueueReferralWelcomeEmail(
  props: ReferralWelcomeEmailProps,
  tenantId: string,
  clientId?: string,
): Promise<void> {
  const emailLogId = generateId();
  const subject = `🎁 Seu código de indicação ${props.referralCode} está pronto! — ${props.agencyName}`;
  await dispatchReferralOutbound(tenantId, "welcome", clientId ?? props.referrerEmail, {
    id: clientId, name: props.referrerName, email: props.referrerEmail,
  }, subject,
    `<h2>Seu código de indicação está pronto!</h2><p>Olá, ${escapeHtmlEmail(props.referrerName)}!</p><p>Seu código é <strong>${escapeHtmlEmail(props.referralCode)}</strong>. Compartilhe e ganhe ${formatBRL(props.bonusValue)} de bônus.</p><p><a href="${props.referralLink}">Compartilhar código</a></p>`,
    `Olá, ${props.referrerName}! Seu código de indicação é ${props.referralCode}. Compartilhe e ganhe ${formatBRL(props.bonusValue)} de bônus: ${props.referralLink}`,
    { referralCode: props.referralCode, referralLink: props.referralLink });
  return;
  const queue = getReferralEmailQueue()!;

  if (queue) {
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: props.referrerEmail,
      subject,
      status: "queued",
    });

    try {
      await queue.add("referral-welcome", { ...props, emailLogId, tenantId });
      logger.info({ emailLogId, referrerEmail: props.referrerEmail }, "[email-queue] Referral welcome email enqueued");
    } catch (enqueueErr) {
      logger.warn({ emailLogId, err: enqueueErr }, "[email-queue] Failed to enqueue referral welcome — falling back to direct send");
      const result = await sendReferralWelcomeEmail(props);
      await db
        .update(emailLogsTable)
        .set({
          status: result.success ? "sent" : "failed",
          messageId: result.messageId ?? null,
          errorMessage: result.error ?? null,
        })
        .where(eq(emailLogsTable.id, emailLogId));
    }
  } else {
    if (!areWorkersEnabled()) {
      logger.warn(
        { tenantId, jobType: "referral-welcome" },
        "[workers-disabled] ENABLE_WORKERS=false — sending referral welcome email directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    const result = await sendReferralWelcomeEmail(props);
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: props.referrerEmail,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });
    logger.info({ emailLogId, referrerEmail: props.referrerEmail, success: result.success }, "[email-queue] Referral welcome email sent directly");
  }
}

export async function dispatchReferralWelcomeEmail(opts: {
  clientId: string;
  referralCode: string;
  tenantId: string;
  tenantSlug?: string;
}): Promise<void> {
  const { clientId, referralCode, tenantId, tenantSlug } = opts;

  // Pre-flight check: only attempt if the client has a valid email address.
  // We do this BEFORE claiming the idempotency stamp so a missing email doesn't
  // permanently block future delivery (e.g. after the address is corrected).
  const [preCheck] = await db
    .select({ email: clientsTable.email, sentAt: clientsTable.referralWelcomeEmailSentAt })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  if (!preCheck) {
    logger.warn({ clientId, tenantId }, "[email-queue] Referral welcome: client not found — skipping");
    return;
  }

  if (!preCheck.email) {
    logger.warn({ clientId, tenantId }, "[email-queue] Referral welcome: client has no email — skipping (not stamping)");
    return;
  }

  // Atomic idempotency claim: stamp the column in a single UPDATE that only
  // matches rows where it is still NULL. If no row is returned, another
  // concurrent request already claimed it — bail out without sending.
  const claimed = await db
    .update(clientsTable)
    .set({ referralWelcomeEmailSentAt: new Date() })
    .where(
      and(
        eq(clientsTable.id, clientId),
        eq(clientsTable.tenantId, tenantId),
        isNull(clientsTable.referralWelcomeEmailSentAt),
      ),
    )
    .returning({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email });

  if (claimed.length === 0) {
    logger.info({ clientId, tenantId }, "[email-queue] Referral welcome: already sent — skipping (idempotency)");
    return;
  }

  const client = claimed[0];

  const [tenant, settings] = await Promise.all([
    db
      .select({ name: tenantsTable.name, logoUrl: tenantsTable.logoUrl, slug: tenantsTable.slug })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({
        bonusValue: referralSettingsTable.bonusValue,
        discountValue: referralSettingsTable.discountValue,
        shareMessage: referralSettingsTable.shareMessage,
      })
      .from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, tenantId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);

  const agencyName = tenant?.name ?? "Agência";
  const bonusValue = settings ? Number(settings.bonusValue) : 0;
  const discountValue = settings ? Number(settings.discountValue) : 5;

  const resolvedSlug = tenantSlug ?? tenant?.slug ?? "";
  const frontendBase = (process.env["FRONTEND_URL"] ?? "https://app.visitecrm.com.br").replace(/\/$/, "");
  const storeBase = frontendBase.replace("app.", `${resolvedSlug}.`);
  const referralLink = `${storeBase}?ref=${referralCode}`;

  const defaultMessage = settings?.shareMessage
    ?? `Olá! Use meu código ${referralCode} na ${agencyName} e ganhe desconto especial na sua próxima viagem! 🌴✈️`;
  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(defaultMessage)}`;

  await enqueueReferralWelcomeEmail(
    {
      referrerName: client.name ?? client.email,
      referrerEmail: client.email,
      referralCode,
      referralLink,
      whatsappShareUrl,
      bonusValue,
      discountValue,
      agencyName,
      agencyLogo: tenant?.logoUrl ?? null,
    },
    tenantId,
    clientId,
  );

  logger.info({ clientId, referralCode, tenantId }, "[email-queue] Referral welcome email dispatched");
}

// ── Resend a failed email log ──────────────────────────────────────────────────

export async function resendEmailLog(
  emailLogId: string,
  tenantId: string,
): Promise<{ ok: boolean; error?: string }> {
  const [log] = await db
    .select()
    .from(emailLogsTable)
    .where(eq(emailLogsTable.id, emailLogId))
    .limit(1);

  if (!log) return { ok: false, error: "Email log not found" };
  if (log.tenantId !== tenantId) return { ok: false, error: "Not found" };
  if (log.status !== "failed") return { ok: false, error: "Only failed emails can be resent" };

  // Rebuild props from the original reservation (if available)
  let props: ReservationConfirmationEmailProps | null = null;
  if (log.reservationId) {
    props = await buildEmailPropsFromReservation(log.reservationId, tenantId);
  }

  if (!props) {
    return { ok: false, error: "Cannot reconstruct email — reservation data not found" };
  }

  // Create a fresh log entry for the resend attempt and enqueue/send
  await enqueueReservationConfirmationEmail({
    tenantId,
    reservationId: log.reservationId ?? undefined,
    subject: log.subject,
    props,
  });

  // Clear retriesExhaustedAt on all email logs for this reservation so the
  // exhausted-retry alert is immediately resolved — the staff member's manual
  // intervention is the resolution event, not the eventual delivery outcome.
  if (log.reservationId) {
    await db
      .update(emailLogsTable)
      .set({ retriesExhaustedAt: null })
      .where(
        and(
          eq(emailLogsTable.tenantId, tenantId),
          eq(emailLogsTable.reservationId, log.reservationId),
        ),
      );
  }

  // A new email_log row is created per resend attempt so the full send history
  // is preserved and each attempt is independently traceable.
  logger.info({ emailLogId, reservationId: log.reservationId }, "[email-queue] Resend enqueued, exhausted-retry alert resolved");
  return { ok: true };
}

// ── Referral: indicação revertida por cancelamento (#28) ─────────────────────

export async function dispatchReferralReversedEmail(opts: {
  referrerId: string;
  referredId: string | null;
  bonusAmount: string;
  tenantId: string;
  reason?: string | null;
  referralId?: string | null;
  reservationId?: string | null;
}): Promise<void> {
  const { referrerId, referredId, bonusAmount, tenantId, reason, referralId, reservationId } = opts;

  const [referrer] = await db
    .select({ name: clientsTable.name, email: clientsTable.email, referralEarnings: clientsTable.referralEarnings })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, referrerId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  if (!referrer?.email) {
    logger.warn({ referrerId, tenantId }, "[email-queue] Referral reversed: referrer has no email — skipping");
    return;
  }

  const [tenant] = await db
    .select({ name: tenantsTable.name, logoUrl: tenantsTable.logoUrl })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  let referredName: string | null = null;
  if (referredId) {
    const [referred] = await db
      .select({ name: clientsTable.name })
      .from(clientsTable)
      .where(and(eq(clientsTable.id, referredId), eq(clientsTable.tenantId, tenantId)))
      .limit(1);
    referredName = referred?.name ?? null;
  }

  const agencyName = tenant?.name ?? "Agência";
  const referrerName = referrer.name ?? referrer.email;
  const bonusAmountNum = parseFloat(bonusAmount) || 0;
  const newPendingBalance = parseFloat(String(referrer.referralEarnings ?? "0")) || 0;

  const subject = `Atualização sobre sua indicação — ${agencyName}`;

  await dispatchReferralOutbound(tenantId, "reversed", referralId ?? `${referrerId}:${referredId ?? "unknown"}`, {
    id: referrerId, name: referrerName, email: referrer.email,
  }, subject,
    `<h2>Atualização sobre sua indicação</h2><p>Olá, ${escapeHtmlEmail(referrerName)}!</p><p>A indicação${referredName ? ` de ${escapeHtmlEmail(referredName)}` : ""} foi revertida. O valor ajustado é ${formatBRL(bonusAmountNum)} e seu saldo pendente é ${formatBRL(newPendingBalance)}.${reason ? ` Motivo: ${escapeHtmlEmail(reason)}` : ""}</p>`,
    `Olá, ${referrerName}! Sua indicação${referredName ? ` de ${referredName}` : ""} foi revertida. Valor ajustado: ${formatBRL(bonusAmountNum)}. Saldo pendente: ${formatBRL(newPendingBalance)}.${reason ? ` Motivo: ${reason}` : ""}`,
    { referredName, bonusAmount: bonusAmountNum, newPendingBalance, reason }, referralId ?? undefined, reservationId);
  logger.info({ referrerId, tenantId, referralId, reservationId }, "[email-queue] Referral reversed dispatched");
  return;
}

// ── Referral: upgrade de tier (#137) ─────────────────────────────────────────

export async function dispatchReferralTierUpgradeEmail(
  referrerId: string,
  tenantId: string,
  newTierLevel: string,
  newTierLabel: string,
  bonusMultiplier: number,
): Promise<void> {
  const [referrer] = await db
    .select({ name: clientsTable.name, email: clientsTable.email })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, referrerId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  if (!referrer?.email) {
    logger.warn({ referrerId, tenantId }, "[email-queue] Referral tier upgrade: referrer has no email — skipping");
    return;
  }

  const [tenant] = await db
    .select({ name: tenantsTable.name, logoUrl: tenantsTable.logoUrl })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const agencyName = tenant?.name ?? "Agência";

  const emailLogId = generateId();
  const subject = `Você subiu para o nível ${newTierLabel}! — ${agencyName}`;
  await dispatchReferralOutbound(tenantId, "tier_upgrade", referrerId, {
    id: referrerId, name: referrer.name ?? referrer.email, email: referrer.email,
  }, subject,
    `<h2>Você subiu de nível!</h2><p>Olá, ${escapeHtmlEmail(referrer.name ?? referrer.email)}! Você alcançou o nível <strong>${escapeHtmlEmail(newTierLabel)}</strong> (${escapeHtmlEmail(newTierLevel)}), com multiplicador de bônus ${bonusMultiplier}x.</p>`,
    `Olá, ${referrer.name ?? referrer.email}! Você alcançou o nível ${newTierLabel} (${newTierLevel}), com multiplicador de bônus ${bonusMultiplier}x.`);

  logger.info({ emailLogId, referrerId, tenantId, newTierLevel, success: true }, "[email-queue] Referral tier upgrade dispatched");
}

// ── Price-drop alerts (public Vitrine, double opt-in) ─────────────────────────
// These helpers send plain transactional HTML (no React template) and always
// record the outcome to email_logs. They never throw: a failed send is logged
// and surfaced via the return value / log status so the caller (a product
// update) is never blocked by email/Resend problems.

function escapeHtmlEmail(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface PriceAlertConfirmationOpts {
  tenantId: string;
  to: string;
  storeName: string;
  productName: string;
  confirmUrl: string;
  unsubscribeUrl: string;
}

/**
 * Sends the double opt-in confirmation email for a price-drop alert
 * subscription. Returns true on a successful send. Never throws.
 */
export async function sendPriceAlertConfirmationEmail(opts: PriceAlertConfirmationOpts): Promise<boolean> {
  const { tenantId, to, storeName, productName, confirmUrl, unsubscribeUrl } = opts;
  const emailLogId = generateId();
  const safeStore = escapeHtmlEmail(storeName);
  const safeProduct = escapeHtmlEmail(productName);
  const subject = `Confirme seu alerta de preço — ${productName}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;">
    <h2 style="color:#111827;">Confirme seu alerta de preço</h2>
    <p>Você pediu para ser avisado quando o preço de <strong>${safeProduct}</strong> cair na loja <strong>${safeStore}</strong>.</p>
    <p>Para começar a receber os avisos, confirme seu e-mail:</p>
    <p style="text-align:center;margin:28px 0;">
      <a href="${confirmUrl}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;font-weight:bold;">Confirmar alerta de preço</a>
    </p>
    <p style="font-size:13px;color:#6b7280;">Se você não solicitou este alerta, ignore este e-mail — nenhum aviso será enviado sem a sua confirmação.</p>
    <p style="font-size:12px;color:#9ca3af;margin-top:24px;">Não quer mais receber? <a href="${unsubscribeUrl}" style="color:#9ca3af;">Cancelar</a></p>
  </div>`;
  try {
    const outbound = await dispatchOutboundMessage({
      tenantId,
      eventType: "price_alert_confirmation",
      idempotencyKey: `price-alert:confirmation:${to}:${confirmUrl}`,
      recipient: { type: "direct", email: to },
      email: { subject, html, senderName: storeName },
      whatsapp: { text: `Confirme seu alerta de preço para ${productName} na loja ${storeName}: ${confirmUrl}` },
      origin: "price-alert-confirmation",
      metadata: { productName, confirmUrl, unsubscribeUrl },
    });
    const delivery = outbound.deliveries.find((item) => item.channel === "email");
    logger.info({ emailLogId, tenantId, success: delivery?.status === "accepted" }, "[price-alert] Confirmation email processed");
    return delivery?.status !== "failed" && delivery?.status !== "skipped";
  } catch (err) {
    logger.warn({ emailLogId, tenantId, err }, "[price-alert] Confirmation email send threw — recording as failed");
    try {
      await db.insert(emailLogsTable).values({
        id: emailLogId,
        tenantId,
        reservationId: null,
        recipient: to,
        subject,
        status: "failed",
        messageId: null,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // swallow — logging the email outcome must never break the caller
    }
    return false;
  }
}

interface PriceDropEmailOpts {
  tenantId: string;
  to: string;
  storeName: string;
  productName: string;
  oldPrice: number;
  newPrice: number;
  productUrl: string;
  unsubscribeUrl: string;
}

/**
 * Sends a single price-drop alert email to one confirmed subscriber. Returns
 * true on a successful send. Never throws.
 */
export async function sendPriceDropAlertEmail(opts: PriceDropEmailOpts): Promise<boolean> {
  const { tenantId, to, storeName, productName, oldPrice, newPrice, productUrl, unsubscribeUrl } = opts;
  const emailLogId = generateId();
  const safeStore = escapeHtmlEmail(storeName);
  const safeProduct = escapeHtmlEmail(productName);
  const subject = `Baixou de preço: ${productName}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;">
    <h2 style="color:#111827;">O preço caiu! 🎉</h2>
    <p>Boas notícias: <strong>${safeProduct}</strong> está mais barato na loja <strong>${safeStore}</strong>.</p>
    <p style="font-size:18px;margin:16px 0;">
      <span style="color:#9ca3af;text-decoration:line-through;">${formatBRL(oldPrice)}</span>
      &nbsp;&rarr;&nbsp;
      <strong style="color:#16a34a;">${formatBRL(newPrice)}</strong>
    </p>
    <p style="text-align:center;margin:28px 0;">
      <a href="${productUrl}" style="background:#16a34a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;font-weight:bold;">Ver oferta</a>
    </p>
    <p style="font-size:12px;color:#9ca3af;margin-top:24px;">Não quer mais receber alertas deste produto? <a href="${unsubscribeUrl}" style="color:#9ca3af;">Cancelar</a></p>
  </div>`;
  try {
    const outbound = await dispatchOutboundMessage({
      tenantId,
      eventType: "price_drop_alert",
      idempotencyKey: `price-alert:drop:${to}:${productUrl}:${oldPrice}:${newPrice}`,
      recipient: { type: "direct", email: to },
      email: { subject, html, senderName: storeName },
      whatsapp: { text: `O preço de ${productName} caiu na loja ${storeName}: ${formatBRL(oldPrice)} → ${formatBRL(newPrice)}. Veja a oferta: ${productUrl}` },
      origin: "price-drop-alert",
      metadata: { productName, oldPrice, newPrice, productUrl, unsubscribeUrl },
    });
    const delivery = outbound.deliveries.find((item) => item.channel === "email");
    logger.info({ emailLogId, tenantId, success: delivery?.status === "accepted" }, "[price-alert] Price-drop email processed");
    return delivery?.status !== "failed" && delivery?.status !== "skipped";
  } catch (err) {
    logger.warn({ emailLogId, tenantId, err }, "[price-alert] Price-drop email send threw — recording as failed");
    try {
      await db.insert(emailLogsTable).values({
        id: emailLogId,
        tenantId,
        reservationId: null,
        recipient: to,
        subject,
        status: "failed",
        messageId: null,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // swallow — logging the email outcome must never break the caller
    }
    return false;
  }
}

export async function dispatchReferralCodeSuspendedEmail(opts: {
  clientId: string;
  tenantId: string;
  status: "blocked" | "cancelled";
}): Promise<boolean> {
  const { clientId, tenantId, status } = opts;

  const [client] = await db
    .select({ name: clientsTable.name, email: clientsTable.email, referralCode: clientsTable.referralCode })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  if (!client?.email) {
    logger.warn({ clientId, tenantId }, "[email-queue] referral-code-suspended: client has no email — skipping");
    return false;
  }

  if (!client.referralCode) {
    logger.warn({ clientId, tenantId }, "[email-queue] referral-code-suspended: client has no referral code — skipping");
    return false;
  }

  const [tenant] = await db
    .select({ name: tenantsTable.name, logoUrl: tenantsTable.logoUrl })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const agencyName = tenant?.name ?? "Agência";
  const statusCapitalized = status === "blocked" ? "Bloqueado" : "Cancelado";
  const subject = `Código de indicação ${statusCapitalized} — ${agencyName}`;

  const sendResult = await sendReferralCodeSuspendedEmail({
    clientName: client.name ?? client.email,
    clientEmail: client.email,
    referralCode: client.referralCode,
    status,
    agencyName,
    agencyLogo: tenant?.logoUrl ?? null,
  });

  const emailLogId = generateId();
  await db.insert(emailLogsTable).values({
    id: emailLogId,
    tenantId,
    reservationId: null,
    recipient: client.email,
    subject,
    status: sendResult.success ? "sent" : "failed",
    messageId: sendResult.messageId ?? null,
    errorMessage: sendResult.error ?? null,
  });

  logger.info(
    { emailLogId, clientId, tenantId, success: sendResult.success },
    "[email-queue] referral-code-suspended email dispatched"
  );

  return sendResult.success;
}

// ── Agency lifecycle notifications (suspension / reactivation) ────────────────

/**
 * Sends an e-mail to the agency's primary contact informing them their account
 * has been suspended by a superadmin. Fire-and-forget (no BullMQ queue needed
 * for infrequent admin actions; logs outcome to email_logs for auditability).
 */
export async function enqueueAgencySuspendedEmail(
  tenantId: string,
  reason?: string | null,
): Promise<void> {
  const [[tenantRow], [storeRow]] = await Promise.all([
    db
      .select({ agencyName: tenantsTable.name, agencyEmail: tenantsTable.email })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1),
    db
      .select({ email: storesTable.email })
      .from(storesTable)
      .where(eq(storesTable.tenantId, tenantId))
      .limit(1),
  ]);

  if (!tenantRow) {
    logger.warn({ tenantId }, "[email-queue] agency-suspended: tenant not found — skipping");
    return;
  }

  // Prefer store contact email (client-facing), fall back to tenant platform email
  const agencyEmail = storeRow?.email || tenantRow.agencyEmail;
  const row = { agencyName: tenantRow.agencyName, agencyEmail };

  if (!agencyEmail) {
    logger.warn({ tenantId }, "[email-queue] agency-suspended: no email on record — skipping");
    return;
  }

  const emailLogId = generateId();
  const subject = "[VisiteCRM] Conta Suspensa — Ação Necessária";

  const sendResult = await sendAgencySuspendedEmail({
    agencyName: row.agencyName,
    agencyEmail: row.agencyEmail,
    reason: reason ?? null,
  });

  await db.insert(emailLogsTable).values({
    id: emailLogId,
    tenantId,
    reservationId: null,
    recipient: row.agencyEmail,
    subject,
    status: sendResult.success ? "sent" : "failed",
    messageId: sendResult.messageId ?? null,
    errorMessage: sendResult.error ?? null,
  });

  logger.info(
    { emailLogId, tenantId, success: sendResult.success },
    "[email-queue] agency-suspended email dispatched",
  );
}

/**
 * Sends an e-mail to the agency's primary contact informing them their account
 * has been reactivated by a superadmin.
 */
export async function enqueueAgencyReactivatedEmail(tenantId: string): Promise<void> {
  const [[tenantRow], [storeRow]] = await Promise.all([
    db
      .select({ agencyName: tenantsTable.name, agencyEmail: tenantsTable.email })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1),
    db
      .select({ email: storesTable.email })
      .from(storesTable)
      .where(eq(storesTable.tenantId, tenantId))
      .limit(1),
  ]);

  if (!tenantRow) {
    logger.warn({ tenantId }, "[email-queue] agency-reactivated: tenant not found — skipping");
    return;
  }

  // Prefer store contact email (client-facing), fall back to tenant platform email
  const agencyEmail = storeRow?.email || tenantRow.agencyEmail;

  if (!agencyEmail) {
    logger.warn({ tenantId }, "[email-queue] agency-reactivated: no email on record — skipping");
    return;
  }

  const emailLogId = generateId();
  const subject = "[VisiteCRM] Conta Reativada — Acesso Restaurado";
  const loginUrl = (process.env["FRONTEND_URL"] ?? "https://app.visitecrm.com.br").replace(/\/$/, "");

  const sendResult = await sendAgencyReactivatedEmail({
    agencyName: tenantRow.agencyName,
    agencyEmail,
    loginUrl,
  });

  await db.insert(emailLogsTable).values({
    id: emailLogId,
    tenantId,
    reservationId: null,
    recipient: agencyEmail,
    subject,
    status: sendResult.success ? "sent" : "failed",
    messageId: sendResult.messageId ?? null,
    errorMessage: sendResult.error ?? null,
  });

  logger.info(
    { emailLogId, tenantId, success: sendResult.success },
    "[email-queue] agency-reactivated email dispatched",
  );
}

// ── PIX order alert to agency users ───────────────────────────────────────────

/**
 * Sends a PIX order alert email to all agency users (agencia + vendedor roles)
 * for the given tenant. Fire-and-forget — callers should .catch() this.
 */
export async function enqueuePixOrderAlertEmail({
  tenantId,
  storeName,
  orderNumber,
  customerName,
  customerEmail,
  customerPhone,
  totalAmount,
  productName,
}: {
  tenantId: string;
  storeName: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  totalAmount: number;
  productName: string;
}): Promise<void> {
  const adminUsers = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.tenantId, tenantId),
        inArray(usersTable.role, [ROLES.AGENCY_ADMIN, ROLES.SALES]),
      ),
    );

  const recipients = adminUsers.map((u) => u.email).filter(Boolean);
  if (recipients.length === 0) {
    logger.warn({ tenantId, orderNumber }, "[pix-alert] No agency users found — skipping PIX order alert");
    return;
  }

  const adminPanelUrl = `${process.env["STORE_PUBLIC_BASE"] ?? "https://app.visitecrm.com"}/loja/pedidos`;

  const html = `<h2>Novo pedido PIX recebido</h2><p>Pedido <strong>${escapeHtmlEmail(orderNumber)}</strong> na loja ${escapeHtmlEmail(storeName)}.</p><p>Cliente: ${escapeHtmlEmail(customerName)} (${escapeHtmlEmail(customerEmail)})<br>Produto: ${escapeHtmlEmail(productName)}<br>Valor: ${formatBRL(totalAmount)}<br>Telefone: ${escapeHtmlEmail(customerPhone ?? "não informado")}</p><p><a href="${adminPanelUrl}">Abrir pedidos</a></p>`;
  const text = `Novo pedido PIX: ${orderNumber}. Cliente: ${customerName} (${customerEmail}). Produto: ${productName}. Valor: ${formatBRL(totalAmount)}. Pedidos: ${adminPanelUrl}`;
  const results = await Promise.all(recipients.map((recipient) => dispatchOutboundMessage({
    tenantId,
    eventType: "pix_order_alert",
    idempotencyKey: `pix-order-alert:${orderNumber}:${recipient}`,
    recipient: { type: "direct", email: recipient },
    email: { subject: `Novo pedido PIX — ${orderNumber}`, html, senderName: storeName },
    whatsapp: { text },
    origin: "pix-order-alert",
    metadata: { orderNumber, customerName, customerEmail, customerPhone, totalAmount, productName, adminPanelUrl },
  })));
  logger.info({ tenantId, orderNumber, success: results.every((result) => result.message.status !== "failed"), recipients: recipients.length }, "[pix-alert] PIX order alert dispatched");
}

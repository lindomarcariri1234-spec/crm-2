import { db, emailLogsTable, reservationsTable, tripsTable, clientsTable, referralSettingsTable, tenantsTable, storesTable, usersTable } from "@workspace/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { getEmailQueue, getCancellationEmailQueue, getNewBookingNotificationEmailQueue, getReferralEmailQueue } from "./index";
import type { ReferralBonusPaidEmailJobData, ReferralConvertedEmailJobData, ReferralExpiredEmailJobData, ReferralExpiringSoonEmailJobData, ReferralBonusReleasedEmailJobData, ReferralLoyaltyPointsEmailJobData } from "./index";
import { sendReservationConfirmationEmail, sendReservationCancellationEmail, sendWelcomeCredentialsEmail, sendNewBookingNotificationEmail, sendReferralBonusPaidEmail, sendReferralConvertedEmail, sendReferralExpiredEmail, sendReferralExpiringSoonEmail, sendReferralBonusReleasedEmail, sendReferralWelcomeEmail, sendReferralTierUpgradeEmail, sendReferralReversedEmail, sendReminderHtmlEmail, sendReferralCodeSuspendedEmail, sendAgencySuspendedEmail, sendAgencyReactivatedEmail, sendReferralLoyaltyPointsEmail, sendPixOrderAlertEmail } from "@workspace/email";
import { ROLES } from "@workspace/permissions";
import { formatBRL } from "@workspace/shared";
import { logger } from "../lib/logger";
import type { ReservationConfirmationEmailProps, ReservationCancellationEmailProps, WelcomeCredentialsEmailProps, NewBookingNotificationEmailProps, ReferralBonusPaidEmailProps, ReferralConvertedEmailProps, ReferralExpiredEmailProps, ReferralExpiringSoonEmailProps, ReferralBonusReleasedEmailProps, ReferralWelcomeEmailProps, ReferralTierUpgradeEmailProps, ReferralLoyaltyPointsEmailProps } from "@workspace/email";
import { insertClientNotification } from "../lib/client-notifications";
import { areWorkersEnabled } from "../lib/redis";
import { dispatchWhatsAppReferralReversed } from "./whatsapp-helpers.js";

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
  const emailLogId = generateId();

  const queue = getEmailQueue();

  if (queue) {
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: reservationId ?? null,
      recipient: props.clientEmail,
      subject,
      status: "queued",
    });

    try {
      await queue.add("reservation-confirmation", {
        ...props,
        emailLogId,
        tenantId,
        reservationId,
      });
      logger.info({ emailLogId, reservationId }, "[email-queue] Email job enqueued");
    } catch (enqueueErr) {
      logger.warn({ emailLogId, err: enqueueErr }, "[email-queue] Failed to enqueue — falling back to direct send");
      const result = await sendReservationConfirmationEmail(props);
      await db
        .update(emailLogsTable)
        .set({
          status: result.success ? "sent" : "failed",
          messageId: result.messageId ?? null,
          errorMessage: result.error ?? null,
        })
        .where(eq(emailLogsTable.id, emailLogId));
      logger.info({ emailLogId, reservationId, success: result.success }, "[email-queue] Fallback direct send result");
    }
  } else {
    // No queue — send directly and log the outcome immediately
    if (!areWorkersEnabled()) {
      logger.warn(
        { reservationId, tenantId, jobType: "reservation-confirmation" },
        "[workers-disabled] ENABLE_WORKERS=false — sending confirmation email directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    const result = await sendReservationConfirmationEmail(props);

    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: reservationId ?? null,
      recipient: props.clientEmail,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });

    logger.info(
      { emailLogId, reservationId, success: result.success },
      "[email-queue] Email sent directly (no queue)",
    );
  }
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
  const queue = getCancellationEmailQueue();

  if (queue) {
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId,
      recipient: props.clientEmail,
      subject,
      status: "queued",
    });

    try {
      await queue.add("reservation-cancellation", {
        ...props,
        emailLogId,
        tenantId,
        reservationId,
      });
      logger.info({ emailLogId, reservationId }, "[email-queue] Cancellation email job enqueued");
    } catch (enqueueErr) {
      logger.warn({ emailLogId, err: enqueueErr }, "[email-queue] Failed to enqueue cancellation — falling back to direct send");
      const result = await sendReservationCancellationEmail(props);
      await db
        .update(emailLogsTable)
        .set({
          status: result.success ? "sent" : "failed",
          messageId: result.messageId ?? null,
          errorMessage: result.error ?? null,
        })
        .where(eq(emailLogsTable.id, emailLogId));
      logger.info({ emailLogId, reservationId, success: result.success }, "[email-queue] Fallback direct send result (cancellation)");
    }
  } else {
    if (!areWorkersEnabled()) {
      logger.warn(
        { reservationId, tenantId, jobType: "reservation-cancellation" },
        "[workers-disabled] ENABLE_WORKERS=false — sending cancellation email directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    const result = await sendReservationCancellationEmail(props);
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId,
      recipient: props.clientEmail,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });
    logger.info(
      { emailLogId, reservationId, success: result.success },
      "[email-queue] Cancellation email sent directly (no queue)",
    );
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

  const emailLogId = generateId();
  const subject = `Nova reserva — ${props.reservationNumber} (${props.destination})`;
  const queue = getNewBookingNotificationEmailQueue();
  const primaryRecipient = recipients[0];

  if (queue) {
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId,
      recipient: primaryRecipient,
      subject,
      status: "queued",
    });

    try {
      await queue.add("new-booking-notification", {
        ...props,
        emailLogId,
        tenantId,
        reservationId,
        recipients,
        cc,
      });
      logger.info(
        { emailLogId, reservationId, recipients, cc },
        "[email-queue] New-booking notification enqueued",
      );
    } catch (enqueueErr) {
      logger.warn(
        { emailLogId, err: enqueueErr },
        "[email-queue] Failed to enqueue new-booking notification — falling back to direct send",
      );
      const result = await sendNewBookingNotificationEmail(props, { to: recipients, cc });
      await db
        .update(emailLogsTable)
        .set({
          status: result.success ? "sent" : "failed",
          messageId: result.messageId ?? null,
          errorMessage: result.error ?? null,
        })
        .where(eq(emailLogsTable.id, emailLogId));
      logger.info(
        { emailLogId, reservationId, success: result.success },
        "[email-queue] Fallback direct send result (new-booking notification)",
      );
    }
  } else {
    if (!areWorkersEnabled()) {
      logger.warn(
        { reservationId, tenantId, jobType: "new-booking-notification" },
        "[workers-disabled] ENABLE_WORKERS=false — sending new-booking notification directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    const result = await sendNewBookingNotificationEmail(props, { to: recipients, cc });
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId,
      recipient: primaryRecipient,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });
    logger.info(
      { emailLogId, reservationId, success: result.success },
      "[email-queue] New-booking notification sent directly (no queue)",
    );
  }
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

  const result = await sendWelcomeCredentialsEmail(props);

  await db.insert(emailLogsTable).values({
    id: emailLogId,
    tenantId,
    reservationId: null,
    recipient: props.clientEmail,
    subject,
    status: result.success ? "sent" : "failed",
    messageId: result.messageId ?? null,
    errorMessage: result.error ?? null,
  });

  logger.info(
    { emailLogId, recipient: props.clientEmail, success: result.success },
    "[email-queue] Welcome email sent",
  );
}

// ── Referral: bônus pago ──────────────────────────────────────────────────────

export async function enqueueReferralBonusPaidEmail(
  props: ReferralBonusPaidEmailProps,
  tenantId: string,
): Promise<void> {
  const emailLogId = generateId();
  const subject = `Seu bônus de indicação foi pago! — ${props.agencyName}`;
  const queue = getReferralEmailQueue();

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
): Promise<void> {
  const emailLogId = generateId();
  const subject = `Sua indicação foi confirmada! — ${props.agencyName}`;
  const queue = getReferralEmailQueue();

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
): Promise<void> {
  const emailLogId = generateId();
  const subject = `Sua indicação expirou — compartilhe novamente! — ${props.agencyName}`;
  const queue = getReferralEmailQueue();

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
  );
}

// ── Referral: código expirando em breve ───────────────────────────────────────

export async function enqueueReferralExpiringSoonEmail(
  props: ReferralExpiringSoonEmailProps,
  tenantId: string,
  referralId?: string,
): Promise<void> {
  const emailLogId = generateId();
  const daysLabel = props.daysLeft <= 1 ? "1 dia" : `${props.daysLeft} dias`;
  const subject = `⏰ Seu código ${props.referralCode} vence em ${daysLabel} — ${props.agencyName}`;
  const queue = getReferralEmailQueue();

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
  );
}

// ── Referral: bônus liberado para pagamento ───────────────────────────────────

export async function enqueueReferralBonusReleasedEmail(
  props: ReferralBonusReleasedEmailProps,
  tenantId: string,
  referralId?: string,
): Promise<void> {
  const emailLogId = generateId();
  const subject = `🎉 Seu bônus de indicação está disponível para resgate! — ${props.agencyName}`;
  const queue = getReferralEmailQueue();

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
): Promise<void> {
  const emailLogId = generateId();
  const subject = `⭐ Você ganhou ${props.pointsEarned} pontos de fidelidade! — ${props.agencyName}`;
  const queue = getReferralEmailQueue();

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
  );
}

// ── Referral: boas-vindas ao código de indicação ─────────────────────────────

export async function enqueueReferralWelcomeEmail(
  props: ReferralWelcomeEmailProps,
  tenantId: string,
): Promise<void> {
  const emailLogId = generateId();
  const subject = `🎁 Seu código de indicação ${props.referralCode} está pronto! — ${props.agencyName}`;
  const queue = getReferralEmailQueue();

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
}): Promise<void> {
  const { referrerId, referredId, bonusAmount, tenantId, reason } = opts;

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

  const emailLogId = generateId();
  const subject = `Atualização sobre sua indicação — ${agencyName}`;

  const sendResult = await sendReferralReversedEmail({
    referrerName,
    referrerEmail: referrer.email,
    agencyName,
    agencyLogo: tenant?.logoUrl ?? null,
    referredName,
    bonusAmount: bonusAmountNum,
    newPendingBalance,
    reason: reason ?? null,
  });

  await db.insert(emailLogsTable).values({
    id: emailLogId,
    tenantId,
    reservationId: null,
    recipient: referrer.email,
    subject,
    status: sendResult.success ? "sent" : "failed",
    messageId: sendResult.messageId ?? null,
    errorMessage: sendResult.error ?? null,
  });

  logger.info({ emailLogId, referrerId, tenantId, success: sendResult.success }, "[email-queue] Referral reversed email sent");

  // WhatsApp (best-effort, non-blocking)
  const { dispatchWhatsAppReferralReversed } = await import("./whatsapp-helpers.js");
  dispatchWhatsAppReferralReversed({
    referrerId,
    referredName: referredName ?? "",
    bonusAmount: bonusAmountNum,
    newPendingBalance,
    tenantId,
  }).catch((err) => logger.warn({ err, referrerId, tenantId }, "[email-queue] WhatsApp referral reversed dispatch failed"));
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

  const result = await sendReferralTierUpgradeEmail({
    referrerName: referrer.name ?? referrer.email,
    referrerEmail: referrer.email,
    newTierLabel,
    newTierLevel,
    bonusMultiplier,
    agencyName,
    agencyLogo: tenant?.logoUrl ?? null,
  });

  const emailLogId = generateId();
  await db.insert(emailLogsTable).values({
    id: emailLogId,
    tenantId,
    reservationId: null,
    recipient: referrer.email,
    subject: `Você subiu para o nível ${newTierLabel}! — ${agencyName}`,
    status: result.success ? "sent" : "failed",
    messageId: result.messageId ?? null,
    errorMessage: result.error ?? null,
  });

  logger.info({ emailLogId, referrerId, tenantId, newTierLevel, success: result.success }, "[email-queue] Referral tier upgrade email sent");
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
    const result = await sendReminderHtmlEmail({ to, subject, html, fromName: storeName });
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: to,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });
    logger.info({ emailLogId, tenantId, success: result.success }, "[price-alert] Confirmation email processed");
    return result.success;
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
    const result = await sendReminderHtmlEmail({ to, subject, html, fromName: storeName });
    await db.insert(emailLogsTable).values({
      id: emailLogId,
      tenantId,
      reservationId: null,
      recipient: to,
      subject,
      status: result.success ? "sent" : "failed",
      messageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
    });
    logger.info({ emailLogId, tenantId, success: result.success }, "[price-alert] Price-drop email processed");
    return result.success;
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

  const result = await sendPixOrderAlertEmail({
    to: recipients,
    agencyName: storeName,
    orderNumber,
    customerName,
    customerEmail,
    customerPhone: customerPhone ?? undefined,
    totalAmount,
    productName,
    adminPanelUrl,
  });

  logger.info(
    { tenantId, orderNumber, success: result.success, recipients: recipients.length },
    "[pix-alert] PIX order alert dispatched",
  );
}

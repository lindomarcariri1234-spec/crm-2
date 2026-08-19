import { db, referralSettingsTable, clientsTable, tenantsTable, referralsTable, systemConfigsTable, passengersTable, reservationsTable, tripsTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { sendTenantWhatsAppMessage, interpolateWhatsAppMessage } from "../lib/whatsapp";
import { getWhatsAppQueue } from "./index";
import { logger } from "../lib/logger";
import { REFERRAL_STATUS } from "@workspace/permissions";
import { areWorkersEnabled } from "../lib/redis";
import { formatBRL } from "@workspace/shared";
import { db, referralSettingsTable, clientsTable, tenantsTable, referralsTable } from "@workspace/db";

const DEFAULT_CONVERTED_MESSAGE =
  "Boa notícia! {{nome}} usou seu código {{codigo}} e comprou com a {{agencia}}. Seu bônus de R$ {{valor}} está sendo processado.";

const DEFAULT_BONUS_PAID_MESSAGE =
  "Seu bônus de R$ {{valor}} foi pago! Obrigado por indicar clientes para a {{agencia}}.";

const DEFAULT_REVERSED_MESSAGE =
  "Olá! A reserva de {{nome}} foi cancelada e o bônus de R$ {{valor}} foi estornado do seu saldo na {{agencia}}. Seu saldo atual é R$ {{saldo}}.";

/** Public wrapper for enqueueing a single WhatsApp job (e.g. from a bulk broadcast route). */
export async function enqueueWhatsAppMessage(phone: string, message: string, tenantId: string): Promise<void> {
  return enqueueOrSend(phone, message, tenantId);
}

async function enqueueOrSend(phone: string, message: string, tenantId: string): Promise<void> {
  const queue = getWhatsAppQueue();
  if (queue) {
    await queue.add("whatsapp-notification", { phone, message, tenantId });
    logger.info({ phone }, "[whatsapp-queue] Job enqueued");
  } else {
    if (!areWorkersEnabled()) {
      logger.warn(
        { phone, tenantId, jobType: "whatsapp-notification" },
        "[workers-disabled] ENABLE_WORKERS=false — sending WhatsApp message directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    const result = await sendTenantWhatsAppMessage(tenantId, phone, message);
    if (!result.success && result.error !== "credentials_not_configured") {
      logger.warn({ phone, error: result.error }, "[whatsapp-queue] Direct send failed");
    }
  }
}

export async function dispatchWhatsAppReferralConverted(opts: {
  referrerId: string;
  referredName: string;
  referralCode: string;
  tenantId: string;
}): Promise<void> {
  const { referrerId, referredName, referralCode, tenantId } = opts;

  const [settings] = await db
    .select({
      whatsappEnabled: referralSettingsTable.whatsappEnabled,
      whatsappConvertedMessage: referralSettingsTable.whatsappConvertedMessage,
    })
    .from(referralSettingsTable)
    .where(eq(referralSettingsTable.tenantId, tenantId))
    .limit(1);

  if (!settings?.whatsappEnabled) return;

  const [referrer] = await db
    .select({ whatsapp: clientsTable.whatsapp, phone: clientsTable.phone })
    .from(clientsTable)
    .where(eq(clientsTable.id, referrerId))
    .limit(1);

  const phone = referrer?.whatsapp || referrer?.phone;
  if (!phone) return;

  const [tenant] = await db
    .select({ name: tenantsTable.name })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const [latestReferral] = await db
    .select({ bonusAmount: referralsTable.bonusAmount })
    .from(referralsTable)
    .where(and(
      eq(referralsTable.tenantId, tenantId),
      eq(referralsTable.referrerId, referrerId),
      eq(referralsTable.code, referralCode),
      eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
    ))
    .orderBy(desc(referralsTable.convertedAt))
    .limit(1);

  const bonusValue = parseFloat(String(latestReferral?.bonusAmount ?? "0")) || 0;

  const template = settings.whatsappConvertedMessage ?? DEFAULT_CONVERTED_MESSAGE;
  const message = interpolateWhatsAppMessage(template, {
    nome: referredName,
    codigo: referralCode,
    valor: bonusValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    agencia: tenant?.name ?? "",
  });

  await enqueueOrSend(phone, message, tenantId);
}

export async function dispatchWhatsAppReferralBonusPaid(opts: {
  referrerId: string;
  referrerPhone: string | null;
  referrerName: string | null;
  referralCode: string | null;
  bonusAmount: number;
  tenantId: string;
  tenantName: string;
}): Promise<void> {
  const { referrerId, referrerPhone, referrerName, referralCode, bonusAmount, tenantId, tenantName } = opts;

  const [settings] = await db
    .select({
      whatsappEnabled: referralSettingsTable.whatsappEnabled,
      whatsappBonusPaidMessage: referralSettingsTable.whatsappBonusPaidMessage,
    })
    .from(referralSettingsTable)
    .where(eq(referralSettingsTable.tenantId, tenantId))
    .limit(1);

  if (!settings?.whatsappEnabled) return;

  let phone = referrerPhone;
  if (!phone) {
    const [referrer] = await db
      .select({ whatsapp: clientsTable.whatsapp, phone: clientsTable.phone })
      .from(clientsTable)
      .where(eq(clientsTable.id, referrerId))
      .limit(1);
    phone = referrer?.whatsapp || referrer?.phone || null;
  }
  if (!phone) return;

  const template = settings.whatsappBonusPaidMessage ?? DEFAULT_BONUS_PAID_MESSAGE;
  const message = interpolateWhatsAppMessage(template, {
    nome: referrerName ?? "",
    codigo: referralCode ?? "",
    bonus: formatBRL(bonusAmount),
    valor: bonusAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    agencia: tenantName,
  });

  await enqueueOrSend(phone, message, tenantId);
}

export async function dispatchWhatsAppReferralReversed(opts: {
  referrerId: string;
  referredName: string;
  bonusAmount: number;
  newPendingBalance: number;
  tenantId: string;
}): Promise<void> {
  const { referrerId, referredName, bonusAmount, newPendingBalance, tenantId } = opts;

  const [settings] = await db
    .select({
      whatsappEnabled: referralSettingsTable.whatsappEnabled,
      whatsappReversedMessage: referralSettingsTable.whatsappReversedMessage,
    })
    .from(referralSettingsTable)
    .where(eq(referralSettingsTable.tenantId, tenantId))
    .limit(1);

  if (!settings?.whatsappEnabled) return;

  const [referrer] = await db
    .select({ whatsapp: clientsTable.whatsapp, phone: clientsTable.phone })
    .from(clientsTable)
    .where(eq(clientsTable.id, referrerId))
    .limit(1);

  const phone = referrer?.whatsapp || referrer?.phone;
  if (!phone) return;

  const [tenant] = await db
    .select({ name: tenantsTable.name })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const template = settings.whatsappReversedMessage?.trim() || DEFAULT_REVERSED_MESSAGE;
  const message = interpolateWhatsAppMessage(template, {
    nome: referredName,
    valor: bonusAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    agencia: tenant?.name ?? "",
    saldo: newPendingBalance.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  });

  await enqueueOrSend(phone, message, tenantId);
}

// ─────────────────────────────────────────────────────────────
// Transactional WhatsApp notifications
// ─────────────────────────────────────────────────────────────

export interface WhatsAppNotificationSettings {
  reservationConfirmed: boolean;
  reservationConfirmedMessage?: string | null;
  paymentReceived: boolean;
  paymentReceivedMessage?: string | null;
  boardingReminder: boolean;
  boardingReminderMessage?: string | null;
  /** New: fires when a reservation is first created (pending status) */
  cadastroRealizado: boolean;
  cadastroRealizadoMessage?: string | null;
  /** New: fires N days before departure when balance > 0 */
  pagamentoPendente: boolean;
  pagamentoPendenteMessage?: string | null;
  /** How many days before trip departure to send the pending-payment reminder (default: 7) */
  pagamentoPendenteDaysBeforeTrip?: number;
  /** Which days before departure to send the boarding reminder (default: [1]) */
  boardingReminderDaysBeforeTrip?: number[];
}

const DEFAULT_NOTIFICATION_SETTINGS: WhatsAppNotificationSettings = {
  reservationConfirmed: true,
  paymentReceived: true,
  boardingReminder: true,
  cadastroRealizado: false,
  pagamentoPendente: false,
  pagamentoPendenteDaysBeforeTrip: 7,
  boardingReminderDaysBeforeTrip: [1],
};

export const DEFAULT_RESERVATION_CONFIRMED_MESSAGE =
  "✅ Olá, {nome}! Sua reserva na viagem *{viagem}* foi confirmada. Partida em *{data}*. Referência: *{referencia}*. Qualquer dúvida, fale com {agencia}.";

export const DEFAULT_PAYMENT_RECEIVED_MESSAGE =
  "✅ Pagamento recebido! Olá, {nome}. Confirmamos *R$ {valor}*. Saldo restante: *R$ {saldo_restante}*. Obrigado! {agencia}";

export const DEFAULT_BOARDING_REMINDER_MESSAGE =
  "🚌 Olá, {nome}! Lembrete: sua viagem para *{viagem}* está marcada para *{data}*. Local de embarque: *{local_saida}* — {horario}. Boa viagem! {agencia}";

export const DEFAULT_CADASTRO_REALIZADO_MESSAGE =
  "👋 Olá, {nome}! Seu cadastro na viagem *{viagem}* foi realizado com sucesso. Referência: *{referencia}*. Em breve entraremos em contato. {agencia}";

export const DEFAULT_PAGAMENTO_PENDENTE_MESSAGE =
  "💰 Olá, {nome}! Sua viagem *{viagem}* parte em breve (*{data}*) e ainda há um saldo pendente de *R$ {saldo_restante}*. Regularize para garantir sua vaga. {agencia}";

async function getSystemConfig<T>(tenantId: string, key: string): Promise<T | null> {
  const [row] = await db
    .select()
    .from(systemConfigsTable)
    .where(and(eq(systemConfigsTable.tenantId, tenantId), eq(systemConfigsTable.key, key)))
    .limit(1);
  return row ? (row.value as T) : null;
}

export async function getWhatsAppNotificationSettings(tenantId: string): Promise<WhatsAppNotificationSettings> {
  const stored = await getSystemConfig<Partial<WhatsAppNotificationSettings>>(tenantId, "whatsapp_notifications_settings");
  return { ...DEFAULT_NOTIFICATION_SETTINGS, ...stored };
}

// ─────────────────────────────────────────────────────────────
// Shared broadcast helper — sends one message per unique phone
// across all passengers of a reservation (with client fallback).
// ─────────────────────────────────────────────────────────────

// Max configurable day offsets — must stay in sync with the worker query windows.
/** Largest boarding-reminder day offset the worker's D-1..D-N window covers. */
export const MAX_BOARDING_REMINDER_DAY = 14;
/** Largest pending-payment reminder day offset the worker's D-1..D-N window covers. */
export const MAX_PAGAMENTO_PENDENTE_DAY = 30;

async function broadcastToReservationPassengers(opts: {
  reservationId: string;
  tenantId: string;
  /** Return the interpolated message for a given passenger name. */
  buildMessage: (passengerName: string) => string;
  /** Optional fallback phone/name used when no passengers exist yet. */
  fallbackPhone?: string | null;
  fallbackName?: string | null;
}): Promise<void> {
  const { reservationId, tenantId, buildMessage, fallbackPhone, fallbackName } = opts;

  // Load passengers for this reservation
  const passengers = await db
    .select({ id: passengersTable.id, name: passengersTable.name, phone: passengersTable.phone })
    .from(passengersTable)
    .where(eq(passengersTable.reservationId, reservationId));

  // Load booking client for phone fallback + consent flag
  const [reservation] = await db
    .select({ clientId: reservationsTable.clientId })
    .from(reservationsTable)
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)))
    .limit(1);

  let clientPhone: string | null = null;
  let clientName: string | null = null;
  // whatsappOptIn=true means the booking client has NOT explicitly opted out.
  // We use the booking client's phone as fallback for passengers who have no own phone,
  // and for the zero-passenger case — but ONLY when they haven't opted out.
  let clientWhatsappOptIn = true;
  if (reservation?.clientId) {
    const [client] = await db
      .select({
        whatsapp: clientsTable.whatsapp,
        phone: clientsTable.phone,
        name: clientsTable.name,
        whatsappOptIn: clientsTable.whatsappOptIn,
      })
      .from(clientsTable)
      .where(eq(clientsTable.id, reservation.clientId))
      .limit(1);
    clientPhone = client?.whatsapp || client?.phone || null;
    clientName = client?.name || null;
    clientWhatsappOptIn = client?.whatsappOptIn !== false;
  }

  const sentPhones = new Set<string>();

  for (const p of passengers) {
    // Passenger's own phone: send without requiring the booking-client opt-in
    // (the passenger provided this number for the trip).
    if (p.phone) {
      const normalized = p.phone.replace(/\D/g, "");
      if (sentPhones.has(normalized)) continue;
      sentPhones.add(normalized);
      await enqueueOrSend(p.phone, buildMessage(p.name), tenantId);
      continue;
    }
    // No passenger phone — fall back to booking client's contact, respecting opt-in.
    if (clientPhone && clientWhatsappOptIn) {
      const normalized = clientPhone.replace(/\D/g, "");
      if (sentPhones.has(normalized)) continue;
      sentPhones.add(normalized);
      await enqueueOrSend(clientPhone, buildMessage(p.name), tenantId);
    }
  }

  // If no passengers were registered yet, fall back to the booking client (or caller-provided
  // fallback), still respecting the opt-in flag.
  if (sentPhones.size === 0) {
    const phone = fallbackPhone || (clientWhatsappOptIn ? clientPhone : null);
    const name = fallbackName || clientName || "";
    if (phone) {
      const normalized = phone.replace(/\D/g, "");
      if (!sentPhones.has(normalized)) {
        sentPhones.add(normalized);
        await enqueueOrSend(phone, buildMessage(name), tenantId);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Dispatcher: Reservation confirmed
// ─────────────────────────────────────────────────────────────

export async function dispatchWhatsAppReservationConfirmed(opts: {
  reservationId: string;
  tenantId: string;
}): Promise<void> {
  try {
    const settings = await getWhatsAppNotificationSettings(opts.tenantId);
    if (!settings.reservationConfirmed) return;

    // Look up reservation + trip + tenant for message vars
    const [row] = await db
      .select({
        tripName: tripsTable.name,
        departureDate: tripsTable.departureDate,
        reservationNumber: reservationsTable.reservationNumber,
        voucherCode: reservationsTable.voucherCode,
        tenantName: tenantsTable.name,
      })
      .from(reservationsTable)
      .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
      .innerJoin(tenantsTable, eq(reservationsTable.tenantId, tenantsTable.id))
      .where(and(eq(reservationsTable.id, opts.reservationId), eq(reservationsTable.tenantId, opts.tenantId)))
      .limit(1);

    if (!row) return;

    const depDate = row.departureDate
      ? row.departureDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" })
      : "";
    const ref = row.reservationNumber ?? row.voucherCode ?? "";

    const template = settings.reservationConfirmedMessage?.trim() || DEFAULT_RESERVATION_CONFIRMED_MESSAGE;

    await broadcastToReservationPassengers({
      reservationId: opts.reservationId,
      tenantId: opts.tenantId,
      buildMessage: (nome) =>
        interpolateWhatsAppMessage(template, {
          nome,
          viagem: row.tripName,
          data: depDate,
          referencia: ref,
          agencia: row.tenantName,
        }),
    });
  } catch (err) {
    logger.warn({ err, tenantId: opts.tenantId }, "[whatsapp] dispatchWhatsAppReservationConfirmed failed — non-fatal");
  }
}

// ─────────────────────────────────────────────────────────────
// Dispatcher: Payment received
// ─────────────────────────────────────────────────────────────

export async function dispatchWhatsAppPaymentReceived(opts: {
  reservationId: string;
  tenantId: string;
  amount: number;
  remainingBalance: number;
}): Promise<void> {
  try {
    const settings = await getWhatsAppNotificationSettings(opts.tenantId);
    if (!settings.paymentReceived) return;

    const [tenant] = await db
      .select({ name: tenantsTable.name })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, opts.tenantId))
      .limit(1);

    const tenantName = tenant?.name ?? "";
    const template = settings.paymentReceivedMessage?.trim() || DEFAULT_PAYMENT_RECEIVED_MESSAGE;

    await broadcastToReservationPassengers({
      reservationId: opts.reservationId,
      tenantId: opts.tenantId,
      buildMessage: (nome) =>
        interpolateWhatsAppMessage(template, {
          nome,
          valor: opts.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          saldo_restante: Math.max(0, opts.remainingBalance).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          agencia: tenantName,
        }),
    });
  } catch (err) {
    logger.warn({ err, tenantId: opts.tenantId }, "[whatsapp] dispatchWhatsAppPaymentReceived failed — non-fatal");
  }
}

// ─────────────────────────────────────────────────────────────
// Dispatcher: Boarding reminder — per passenger with their own
// boarding point resolved from the trip's boardingPoints array.
// ─────────────────────────────────────────────────────────────

export async function dispatchWhatsAppBoardingReminder(opts: {
  reservationId: string;
  tenantId: string;
  tripName: string;
  departureDate: string;
  boardingPoints: Array<{ id: string; name: string; time?: string }>;
  tenantName: string;
}): Promise<void> {
  try {
    const settings = await getWhatsAppNotificationSettings(opts.tenantId);
    if (!settings.boardingReminder) return;

    const template = settings.boardingReminderMessage?.trim() || DEFAULT_BOARDING_REMINDER_MESSAGE;
    const bpMap = new Map(opts.boardingPoints.map((bp) => [bp.id, bp]));

    // Load passengers with their boarding location IDs
    const passengers = await db
      .select({
        id: passengersTable.id,
        name: passengersTable.name,
        phone: passengersTable.phone,
        boardingLocationId: passengersTable.boardingLocationId,
      })
      .from(passengersTable)
      .where(eq(passengersTable.reservationId, opts.reservationId));

    // Booking client as fallback phone
    const [reservation] = await db
      .select({ clientId: reservationsTable.clientId })
      .from(reservationsTable)
      .where(and(eq(reservationsTable.id, opts.reservationId), eq(reservationsTable.tenantId, opts.tenantId)))
      .limit(1);

    let clientPhone: string | null = null;
    let clientName: string | null = null;
    let clientWhatsappOptIn = true;
    if (reservation?.clientId) {
      const [client] = await db
        .select({
          whatsapp: clientsTable.whatsapp,
          phone: clientsTable.phone,
          name: clientsTable.name,
          whatsappOptIn: clientsTable.whatsappOptIn,
        })
        .from(clientsTable)
        .where(eq(clientsTable.id, reservation.clientId))
        .limit(1);
      clientPhone = client?.whatsapp || client?.phone || null;
      clientName = client?.name || null;
      clientWhatsappOptIn = client?.whatsappOptIn !== false;
    }

    const sentPhones = new Set<string>();

    for (const p of passengers) {
      // Passenger's own phone: send freely (they provided it for the trip)
      if (p.phone) {
        const normalized = p.phone.replace(/\D/g, "");
        if (sentPhones.has(normalized)) continue;
        sentPhones.add(normalized);

        const bp = p.boardingLocationId ? bpMap.get(p.boardingLocationId) : undefined;
        const boardingLocation = bp?.name ?? (opts.boardingPoints[0]?.name ?? opts.tenantName);
        const boardingTime = bp?.time ?? opts.boardingPoints[0]?.time ?? "";
        const message = interpolateWhatsAppMessage(template, {
          nome: p.name,
          viagem: opts.tripName,
          data: opts.departureDate,
          local_saida: boardingLocation,
          horario: boardingTime,
          agencia: opts.tenantName,
        });
        await enqueueOrSend(p.phone, message, opts.tenantId);
        continue;
      }
      // No passenger phone — fall back to booking client's contact, respecting opt-in
      if (clientPhone && clientWhatsappOptIn) {
        const normalized = clientPhone.replace(/\D/g, "");
        if (sentPhones.has(normalized)) continue;
        sentPhones.add(normalized);

        const bp = p.boardingLocationId ? bpMap.get(p.boardingLocationId) : undefined;
        const boardingLocation = bp?.name ?? (opts.boardingPoints[0]?.name ?? opts.tenantName);
        const boardingTime = bp?.time ?? opts.boardingPoints[0]?.time ?? "";
        const message = interpolateWhatsAppMessage(template, {
          nome: p.name,
          viagem: opts.tripName,
          data: opts.departureDate,
          local_saida: boardingLocation,
          horario: boardingTime,
          agencia: opts.tenantName,
        });
        await enqueueOrSend(clientPhone, message, opts.tenantId);
      }
    }

    // Fallback: if no passengers registered, send to booking client (opt-in required)
    if (sentPhones.size === 0 && clientPhone && clientWhatsappOptIn) {
      const bp = opts.boardingPoints[0];
      const message = interpolateWhatsAppMessage(template, {
        nome: clientName ?? "",
        viagem: opts.tripName,
        data: opts.departureDate,
        local_saida: bp?.name ?? opts.tenantName,
        horario: bp?.time ?? "",
        agencia: opts.tenantName,
      });
      await enqueueOrSend(clientPhone, message, opts.tenantId);
    }
  } catch (err) {
    logger.warn({ err, tenantId: opts.tenantId }, "[whatsapp] dispatchWhatsAppBoardingReminder failed — non-fatal");
  }
}

// ─────────────────────────────────────────────────────────────
// Dispatcher: Cadastro realizado (new reservation, pending)
// ─────────────────────────────────────────────────────────────

export async function dispatchWhatsAppCadastroRealizado(opts: {
  reservationId: string;
  tenantId: string;
}): Promise<void> {
  try {
    const settings = await getWhatsAppNotificationSettings(opts.tenantId);
    if (!settings.cadastroRealizado) return;

    const [row] = await db
      .select({
        tripName: tripsTable.name,
        reservationNumber: reservationsTable.reservationNumber,
        voucherCode: reservationsTable.voucherCode,
        tenantName: tenantsTable.name,
      })
      .from(reservationsTable)
      .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
      .innerJoin(tenantsTable, eq(reservationsTable.tenantId, tenantsTable.id))
      .where(and(eq(reservationsTable.id, opts.reservationId), eq(reservationsTable.tenantId, opts.tenantId)))
      .limit(1);

    if (!row) return;

    const ref = row.reservationNumber ?? row.voucherCode ?? "";
    const template = settings.cadastroRealizadoMessage?.trim() || DEFAULT_CADASTRO_REALIZADO_MESSAGE;

    await broadcastToReservationPassengers({
      reservationId: opts.reservationId,
      tenantId: opts.tenantId,
      buildMessage: (nome) =>
        interpolateWhatsAppMessage(template, {
          nome,
          viagem: row.tripName,
          referencia: ref,
          agencia: row.tenantName,
        }),
    });
  } catch (err) {
    logger.warn({ err, tenantId: opts.tenantId }, "[whatsapp] dispatchWhatsAppCadastroRealizado failed — non-fatal");
  }
}

// ─────────────────────────────────────────────────────────────
// Dispatcher: Pagamento pendente (balance > 0, N days before trip)
// ─────────────────────────────────────────────────────────────

export async function dispatchWhatsAppPagamentoPendente(opts: {
  reservationId: string;
  tenantId: string;
  tripName: string;
  departureDate: string;
  remainingBalance: number;
  tenantName: string;
}): Promise<void> {
  try {
    const settings = await getWhatsAppNotificationSettings(opts.tenantId);
    if (!settings.pagamentoPendente) return;

    const template = settings.pagamentoPendenteMessage?.trim() || DEFAULT_PAGAMENTO_PENDENTE_MESSAGE;

    await broadcastToReservationPassengers({
      reservationId: opts.reservationId,
      tenantId: opts.tenantId,
      buildMessage: (nome) =>
        interpolateWhatsAppMessage(template, {
          nome,
          viagem: opts.tripName,
          data: opts.departureDate,
          saldo_restante: Math.max(0, opts.remainingBalance).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          agencia: opts.tenantName,
        }),
    });
  } catch (err) {
    logger.warn({ err, tenantId: opts.tenantId }, "[whatsapp] dispatchWhatsAppPagamentoPendente failed — non-fatal");
  }
}

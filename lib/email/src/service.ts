import { Resend } from 'resend';
import * as React from 'react';
import { ReservationConfirmationEmail, type ReservationConfirmationEmailProps } from './templates/reservation-confirmation';
import { ReservationCancellationEmail, type ReservationCancellationEmailProps } from './templates/reservation-cancellation';
import { BirthdayEmail, type BirthdayEmailProps } from './templates/birthday';
import { WelcomeCredentialsEmail, type WelcomeCredentialsEmailProps } from './templates/welcome-credentials';
import { NewBookingNotificationEmail, type NewBookingNotificationEmailProps } from './templates/new-booking-notification';
import { ReferralBonusPaidEmail, type ReferralBonusPaidEmailProps } from './templates/referral-bonus-paid';
import { ReferralConvertedEmail, type ReferralConvertedEmailProps } from './templates/referral-converted';
import { ReferralExpiredEmail, type ReferralExpiredEmailProps } from './templates/referral-expired';
import { ReferralExpiringSoonEmail, type ReferralExpiringSoonEmailProps } from './templates/referral-expiring-soon';
import { ReferralBonusReleasedEmail, type ReferralBonusReleasedEmailProps } from './templates/referral-bonus-released';
import { ReferralWelcomeEmail, type ReferralWelcomeEmailProps } from './templates/referral-welcome';
import { ReferralTierUpgradeEmail, type ReferralTierUpgradeEmailProps } from './templates/referral-tier-upgrade';
import { ReferralLoyaltyPointsEmail, type ReferralLoyaltyPointsEmailProps } from './templates/referral-loyalty-points';
import { LoyaltyTierUpgradeEmail, type LoyaltyTierUpgradeEmailProps } from './templates/loyalty-tier-upgrade';
import { NpsSurveyEmail, type NpsSurveyEmailProps } from './templates/nps-survey';
import { AgencySuspendedEmail, type AgencySuspendedEmailProps } from './templates/agency-suspended';
import { AgencyReactivatedEmail, type AgencyReactivatedEmailProps } from './templates/agency-reactivated';
import { FavoriteLowAvailabilityEmail, type FavoriteLowAvailabilityEmailProps } from './templates/favorite-low-availability';
export type { FavoriteLowAvailabilityEmailProps };
export type { ReferralWelcomeEmailProps };
export type { AgencySuspendedEmailProps, AgencyReactivatedEmailProps };
export type { ReferralTierUpgradeEmailProps };
export type { ReferralLoyaltyPointsEmailProps };
export type { LoyaltyTierUpgradeEmailProps };

export type { ReservationCancellationEmailProps };

export interface SendManifestEmailOptions {
  to: string;
  tripName: string;
  manifestNumber: string | null;
  agencyName: string;
  htmlContent: string;
  pdfAttachment?: Buffer;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[email] RESEND_API_KEY not configured — email sending is disabled');
    return null;
  }
  return new Resend(key);
}

export async function sendReservationCancellationEmail(
  props: ReservationCancellationEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.clientEmail],
      subject: `Reserva Cancelada — ${props.reservationNumber}`,
      react: React.createElement(ReservationCancellationEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send reservation cancellation:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending reservation cancellation:', message);
    return { success: false, error: message };
  }
}

export async function sendReservationConfirmationEmail(
  props: ReservationConfirmationEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.clientEmail],
      subject: `Reserva Confirmada — ${props.reservationNumber}`,
      react: React.createElement(ReservationConfirmationEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send reservation confirmation:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending reservation confirmation:', message);
    return { success: false, error: message };
  }
}

export interface SendBirthdayEmailOptions {
  emailSubject?: string | null;
  senderName?: string | null;
  emailMessage?: string | null;
}

export async function sendManifestEmail(opts: SendManifestEmailOptions): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const subject = `Manifesto ANTT — ${opts.tripName}${opts.manifestNumber ? ` (${opts.manifestNumber})` : ''}`;

    const safeName = (opts.tripName ?? 'manifesto')
      .replace(/[^a-zA-Z0-9\-_]/g, '_')
      .slice(0, 60);

    const attachments = opts.pdfAttachment
      ? [{ filename: `manifesto-antt-${safeName}.pdf`, content: opts.pdfAttachment }]
      : undefined;

    const { data, error } = await resend.emails.send({
      from: `${opts.agencyName} <reservas@resend.visitecrm.com>`,
      to: [opts.to],
      subject,
      html: opts.htmlContent,
      attachments,
    });

    if (error) {
      console.error('[email] Failed to send manifest email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending manifest email:', message);
    return { success: false, error: message };
  }
}

export async function sendBirthdayEmail(
  props: BirthdayEmailProps,
  options?: SendBirthdayEmailOptions
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const firstName = props.clientName.split(' ')[0];
    const fromName = options?.senderName || props.agencyName;
    const subject = options?.emailSubject
      ? options.emailSubject
          .replace(/\{\{name\}\}/gi, firstName)
          .replace(/\{\{coupon_code\}\}/gi, props.couponCode)
          .replace(/\{\{discount\}\}/gi, String(props.discountPercent))
          .replace(/\{\{valid_until\}\}/gi, props.validUntil)
          .replace(/\{\{agency_name\}\}/gi, props.agencyName)
      : `🎂 Feliz Aniversário, ${firstName}! Um presente especial para você`;

    const emailProps: BirthdayEmailProps = {
      ...props,
      customMessage: options?.emailMessage
        ? options.emailMessage
            .replace(/\{\{name\}\}/gi, props.clientName.split(' ')[0])
            .replace(/\{\{coupon_code\}\}/gi, props.couponCode)
            .replace(/\{\{discount\}\}/gi, String(props.discountPercent))
            .replace(/\{\{valid_until\}\}/gi, props.validUntil)
            .replace(/\{\{agency_name\}\}/gi, props.agencyName)
        : null,
    };

    const { data, error } = await resend.emails.send({
      from: `${fromName} <reservas@resend.visitecrm.com>`,
      to: [props.clientEmail],
      subject,
      react: React.createElement(BirthdayEmail, emailProps),
    });

    if (error) {
      console.error('[email] Failed to send birthday email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending birthday email:', message);
    return { success: false, error: message };
  }
}

export async function sendLoyaltyTierUpgradeEmail(
  props: LoyaltyTierUpgradeEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.clientEmail],
      subject: `🎉 Você subiu para o nível ${props.newTierLabel}! — ${props.agencyName}`,
      react: React.createElement(LoyaltyTierUpgradeEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send loyalty tier upgrade email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending loyalty tier upgrade email:', message);
    return { success: false, error: message };
  }
}

export interface SendReminderEmailOptions {
  to: string;
  subject: string;
  html: string;
  fromName: string;
}

export async function sendReminderHtmlEmail(opts: SendReminderEmailOptions): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${opts.fromName} <reservas@resend.visitecrm.com>`,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    });

    if (error) {
      console.error('[email] Failed to send reminder email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending reminder email:', message);
    return { success: false, error: message };
  }
}

export interface SendNewBookingNotificationOptions {
  to: string[];
  cc?: string[];
}

export async function sendNewBookingNotificationEmail(
  props: NewBookingNotificationEmailProps,
  opts: SendNewBookingNotificationOptions,
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const recipients = opts.to.filter((e) => !!e);
    if (recipients.length === 0) {
      return { success: false, error: 'No recipient address' };
    }

    const cc = (opts.cc ?? []).filter((e) => !!e && !recipients.includes(e));

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: recipients,
      ...(cc.length > 0 ? { cc } : {}),
      subject: `Nova reserva — ${props.reservationNumber} (${props.destination})`,
      react: React.createElement(NewBookingNotificationEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send new booking notification:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending new booking notification:', message);
    return { success: false, error: message };
  }
}

export async function sendWelcomeCredentialsEmail(
  props: WelcomeCredentialsEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.clientEmail],
      subject: `Bem-vindo(a)! Acesse sua Área do Cliente — ${props.agencyName}`,
      react: React.createElement(WelcomeCredentialsEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send welcome credentials email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending welcome credentials email:', message);
    return { success: false, error: message };
  }
}

export type { ReferralBonusPaidEmailProps, ReferralConvertedEmailProps, ReferralExpiredEmailProps, ReferralBonusReleasedEmailProps };

export async function sendReferralBonusPaidEmail(
  props: ReferralBonusPaidEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.referrerEmail],
      subject: `Seu bônus de indicação foi pago! — ${props.agencyName}`,
      react: React.createElement(ReferralBonusPaidEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send referral bonus paid email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending referral bonus paid email:', message);
    return { success: false, error: message };
  }
}

export async function sendReferralConvertedEmail(
  props: ReferralConvertedEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.referrerEmail],
      subject: `Sua indicação foi confirmada! — ${props.agencyName}`,
      react: React.createElement(ReferralConvertedEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send referral converted email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending referral converted email:', message);
    return { success: false, error: message };
  }
}

export async function sendReferralExpiredEmail(
  props: ReferralExpiredEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.referrerEmail],
      subject: `Sua indicação expirou — compartilhe novamente! — ${props.agencyName}`,
      react: React.createElement(ReferralExpiredEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send referral expired email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending referral expired email:', message);
    return { success: false, error: message };
  }
}

export async function sendReferralBonusReleasedEmail(
  props: ReferralBonusReleasedEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.referrerEmail],
      subject: `🎉 Seu bônus de indicação está disponível para resgate! — ${props.agencyName}`,
      react: React.createElement(ReferralBonusReleasedEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send referral bonus released email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending referral bonus released email:', message);
    return { success: false, error: message };
  }
}

export async function sendReferralLoyaltyPointsEmail(
  props: ReferralLoyaltyPointsEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.referrerEmail],
      subject: `⭐ Você ganhou ${props.pointsEarned} pontos de fidelidade! — ${props.agencyName}`,
      react: React.createElement(ReferralLoyaltyPointsEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send referral loyalty points email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending referral loyalty points email:', message);
    return { success: false, error: message };
  }
}

export interface SendRedisAlertEmailOptions {
  to: string;
  status: "degraded" | "unavailable";
  /** Absolute URL to the admin dashboard. When null the CTA button is omitted. */
  dashboardUrl: string | null;
}

export async function sendRedisAlertEmail(opts: SendRedisAlertEmailOptions): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const statusLabel = opts.status === "unavailable" ? "Indisponível" : "Degradado";
    const subject = `[VisiteCRM] Alerta: Redis ${statusLabel}`;
    const dashboardButton = opts.dashboardUrl
      ? `<p style="margin-top: 24px;">
          <a href="${opts.dashboardUrl}" style="background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
            Acessar o painel de administração
          </a>
        </p>`
      : '';
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #dc2626;">⚠️ Alerta de Infraestrutura — Redis ${statusLabel}</h2>
        <p>O Redis está com status <strong>${statusLabel}</strong>.</p>
        <p>Isso pode afetar filas de e-mail, jobs em background e outras funcionalidades que dependem do Redis.</p>
        ${dashboardButton}
        <p style="margin-top: 24px; color: #6b7280; font-size: 12px;">
          Este alerta é enviado no máximo uma vez por hora. Horário do alerta: ${new Date().toISOString()}
        </p>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: 'VisiteCRM <reservas@resend.visitecrm.com>',
      to: [opts.to],
      subject,
      html,
    });

    if (error) {
      console.error('[email] Failed to send Redis alert email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending Redis alert email:', message);
    return { success: false, error: message };
  }
}

export interface SendRedisRecoveryEmailOptions {
  to: string;
  /** Absolute URL to the admin dashboard. When null the CTA button is omitted. */
  dashboardUrl: string | null;
}

export async function sendRedisRecoveryEmail(opts: SendRedisRecoveryEmailOptions): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const dashboardButton = opts.dashboardUrl
      ? `<p style="margin-top: 24px;">
          <a href="${opts.dashboardUrl}" style="background: #16a34a; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
            Acessar o painel de administração
          </a>
        </p>`
      : '';
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #16a34a;">✅ Infraestrutura Normalizada — Redis Recuperado</h2>
        <p>O Redis voltou ao estado <strong>normal</strong> após um período de instabilidade.</p>
        <p>As filas de e-mail, jobs em background e demais funcionalidades dependentes do Redis estão operando normalmente.</p>
        ${dashboardButton}
        <p style="margin-top: 24px; color: #6b7280; font-size: 12px;">
          Horário da recuperação: ${new Date().toISOString()}
        </p>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: 'VisiteCRM <reservas@resend.visitecrm.com>',
      to: [opts.to],
      subject: '[VisiteCRM] Redis recuperado — sistema normalizado',
      html,
    });

    if (error) {
      console.error('[email] Failed to send Redis recovery email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending Redis recovery email:', message);
    return { success: false, error: message };
  }
}

export interface SendStripeWebhookDuplicateAlertEmailOptions {
  to: string;
  /** Number of enabled endpoints targeting the webhook path. */
  count: number;
  /** List of duplicate endpoint ids and urls. */
  endpoints: Array<{ id: string; url: string }>;
  /** Absolute URL to the Stripe Dashboard webhook settings. When null the CTA button is omitted. */
  stripeDashboardUrl: string | null;
}

export async function sendStripeWebhookDuplicateAlertEmail(
  opts: SendStripeWebhookDuplicateAlertEmailOptions,
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const endpointRows = opts.endpoints
      .map(
        (e) =>
          `<tr>
            <td style="padding: 4px 8px; font-family: monospace; font-size: 12px; color: #374151;">${e.id}</td>
            <td style="padding: 4px 8px; font-size: 12px; color: #374151;">${e.url}</td>
          </tr>`,
      )
      .join('');

    const dashboardButton = opts.stripeDashboardUrl
      ? `<p style="margin-top: 24px;">
          <a href="${opts.stripeDashboardUrl}" style="background: #7c3aed; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
            Abrir Stripe Dashboard — Webhooks
          </a>
        </p>`
      : '';

    const html = `
      <div style="font-family: sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #dc2626;">⚠️ Alerta Stripe — Endpoints de Webhook Duplicados</h2>
        <p>
          Foram detectados <strong>${opts.count} endpoints habilitados</strong> no Stripe apontando para
          <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">/api/stripe/webhook</code>.
        </p>
        <p>
          Com mais de um endpoint ativo, cada evento de cobrança é entregue várias vezes —
          isso pode causar <strong>ativações duplicadas de planos, cobranças duplicadas registradas e e-mails duplicados</strong>.
        </p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;background:#f9fafb;border-radius:6px;overflow:hidden;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:6px 8px;text-align:left;font-size:12px;color:#6b7280;">ID do Endpoint</th>
              <th style="padding:6px 8px;text-align:left;font-size:12px;color:#6b7280;">URL</th>
            </tr>
          </thead>
          <tbody>${endpointRows}</tbody>
        </table>
        <p style="margin-top:16px;">
          <strong>Ação necessária:</strong> Acesse o Stripe Dashboard, identifique o endpoint extra
          (provavelmente o criado manualmente ou por um deploy anterior) e <strong>remova-o</strong>,
          deixando apenas o endpoint gerenciado pelo sistema.
        </p>
        ${dashboardButton}
        <p style="margin-top: 24px; color: #6b7280; font-size: 12px;">
          Este alerta é enviado no máximo uma vez por dia. Horário da detecção: ${new Date().toISOString()}
        </p>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: 'VisiteCRM <reservas@resend.visitecrm.com>',
      to: [opts.to],
      subject: `[VisiteCRM] Alerta: ${opts.count} endpoints de webhook Stripe duplicados`,
      html,
    });

    if (error) {
      console.error('[email] Failed to send Stripe webhook duplicate alert email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending Stripe webhook duplicate alert email:', message);
    return { success: false, error: message };
  }
}

export async function sendReferralWelcomeEmail(
  props: ReferralWelcomeEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.referrerEmail],
      subject: `🎁 Seu código de indicação ${props.referralCode} está pronto! — ${props.agencyName}`,
      react: React.createElement(ReferralWelcomeEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send referral welcome email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending referral welcome email:', message);
    return { success: false, error: message };
  }
}

export interface SendRedisDailyLimitAlertEmailOptions {
  to: string;
  usagePct: number;
  commandCount: number;
  maxCommands: number;
  warningThresholdPct: number;
  dashboardUrl: string | null;
}

export async function sendRedisDailyLimitAlertEmail(opts: SendRedisDailyLimitAlertEmailOptions): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const usagePctRounded = Math.round(opts.usagePct * 10) / 10;
    const subject = `[VisiteCRM] Alerta: Redis com ${usagePctRounded}% do limite diário`;
    const dashboardButton = opts.dashboardUrl
      ? `<p style="margin-top: 24px;">
          <a href="${opts.dashboardUrl}" style="background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
            Acessar o painel de administração
          </a>
        </p>`
      : '';
    const barColor = opts.usagePct >= 90 ? '#dc2626' : '#f59e0b';
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: ${barColor};">⚠️ Alerta de Limite Diário — Redis Upstash</h2>
        <p>O uso de requisições Redis hoje atingiu <strong>${usagePctRounded}%</strong> do limite diário (threshold configurado: ${opts.warningThresholdPct}%).</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; color: #6b7280;">Requisições usadas</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">${opts.commandCount.toLocaleString('pt-BR')}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; color: #6b7280;">Limite diário</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">${opts.maxCommands.toLocaleString('pt-BR')}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; color: #6b7280;">Uso atual</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; color: ${barColor};">${usagePctRounded}%</td>
          </tr>
        </table>
        <div style="background: #f3f4f6; border-radius: 8px; height: 12px; margin: 16px 0; overflow: hidden;">
          <div style="background: ${barColor}; height: 100%; width: ${Math.min(100, opts.usagePct)}%;"></div>
        </div>
        <p style="color: #6b7280; font-size: 14px;">Se o limite for atingido, filas de e-mail e jobs em background passarão a rodar de forma síncrona até a renovação diária. Considere reduzir o número de operações Redis ou fazer upgrade do plano Upstash.</p>
        ${dashboardButton}
        <p style="margin-top: 24px; color: #6b7280; font-size: 12px;">
          Este alerta é enviado no máximo uma vez por hora. Horário do alerta: ${new Date().toISOString()}
        </p>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: 'VisiteCRM <reservas@resend.visitecrm.com>',
      to: [opts.to],
      subject,
      html,
    });

    if (error) {
      console.error('[email] Failed to send Redis daily limit alert email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending Redis daily limit alert email:', message);
    return { success: false, error: message };
  }
}

export async function sendReferralExpiringSoonEmail(
  props: ReferralExpiringSoonEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const daysLabel = props.daysLeft <= 1 ? '1 dia' : `${props.daysLeft} dias`;
    const subject = `⏰ Seu código ${props.referralCode} vence em ${daysLabel} — ${props.agencyName}`;

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.referrerEmail],
      subject,
      react: React.createElement(ReferralExpiringSoonEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send referral expiring soon email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending referral expiring soon email:', message);
    return { success: false, error: message };
  }
}

export async function sendReferralTierUpgradeEmail(
  props: ReferralTierUpgradeEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.referrerEmail],
      subject: `Você subiu para o nível ${props.newTierLabel}! — ${props.agencyName}`,
      react: React.createElement(ReferralTierUpgradeEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send referral tier upgrade email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending referral tier upgrade email:', message);
    return { success: false, error: message };
  }
}

export interface SendReferralReversedEmailProps {
  referrerName: string;
  referrerEmail: string;
  agencyName: string;
  agencyLogo?: string | null;
  referredName?: string | null;
  bonusAmount?: number | null;
  newPendingBalance?: number | null;
  reason?: string | null;
}

export async function sendReferralReversedEmail(
  props: SendReferralReversedEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const firstName = props.referrerName.split(' ')[0];
    const subject = `Atualização sobre sua indicação — ${props.agencyName}`;

    const bonusLine = props.bonusAmount != null
      ? `<p>O bônus de <strong>R$ ${props.bonusAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> referente a essa indicação foi estornado do seu saldo.</p>`
      : `<p>Infelizmente, com o cancelamento, a indicação correspondente foi revertida e o bônus associado foi descontado do seu saldo.</p>`;

    const reasonLabels: Record<string, string> = {
      reservation_cancelled: 'cancelamento de reserva',
      trip_cancelled: 'cancelamento da excursão',
    };
    const reasonLabel = props.reason ? (reasonLabels[props.reason] ?? props.reason) : null;

    const referredLine = props.referredName
      ? `<p>A reserva do(a) indicado(a) <strong>${props.referredName}</strong> foi cancelada pela agência <strong>${props.agencyName}</strong>.</p>`
      : `<p>Informamos que uma reserva vinculada à sua indicação foi cancelada pela agência <strong>${props.agencyName}</strong>.</p>`;

    const reasonLine = reasonLabel
      ? `<p><strong>Motivo:</strong> ${reasonLabel.charAt(0).toUpperCase() + reasonLabel.slice(1)}.</p>`
      : '';

    const balanceLine = props.newPendingBalance != null
      ? `<p>Seu saldo de bônus atual é de <strong>R$ ${props.newPendingBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>.</p>`
      : '';

    const htmlBody = `<p>Olá, <strong>${firstName}</strong>!</p>
${referredLine}
${reasonLine}
${bonusLine}
${balanceLine}
<p>Se você tiver dúvidas, entre em contato com a agência.</p>
<p>Obrigado por continuar indicando!</p>
<p>— ${props.agencyName}</p>`;

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.referrerEmail],
      subject,
      html: htmlBody,
    });

    if (error) {
      console.error('[email] Failed to send referral reversed email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending referral reversed email:', message);
    return { success: false, error: message };
  }
}

export interface SendReferralCodeSuspendedEmailProps {
  clientName: string;
  clientEmail: string;
  referralCode: string;
  status: "blocked" | "cancelled";
  agencyName: string;
  agencyLogo?: string | null;
}

export async function sendReferralCodeSuspendedEmail(
  props: SendReferralCodeSuspendedEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const firstName = props.clientName.split(' ')[0];
    const statusLabel = props.status === "blocked" ? "bloqueado temporariamente" : "cancelado";
    const statusCapitalized = props.status === "blocked" ? "Bloqueado" : "Cancelado";
    const subject = `Código de indicação ${statusCapitalized} — ${props.agencyName}`;

    const htmlBody = `<p>Olá, <strong>${firstName}</strong>!</p>
<p>Informamos que seu código de indicação <strong>${props.referralCode}</strong> foi <strong>${statusLabel}</strong> pela agência <strong>${props.agencyName}</strong>.</p>
<p>Durante este período, seu código não poderá ser compartilhado nem utilizado por novos indicados.</p>
<p>Caso tenha dúvidas ou acredite que isso foi um engano, entre em contato diretamente com a agência.</p>
<p>— ${props.agencyName}</p>`;

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.clientEmail],
      subject,
      html: htmlBody,
    });

    if (error) {
      console.error('[email] Failed to send referral code suspended email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending referral code suspended email:', message);
    return { success: false, error: message };
  }
}

export async function sendNpsSurveyEmail(props: NpsSurveyEmailProps): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const firstName = props.clientName.split(' ')[0];

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.clientEmail],
      subject: `${firstName}, como foi sua viagem? Deixe sua avaliação ✈️`,
      react: React.createElement(NpsSurveyEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send NPS survey email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending NPS survey email:', message);
    return { success: false, error: message };
  }
}

export type { NpsSurveyEmailProps };

export async function sendAgencySuspendedEmail(
  props: AgencySuspendedEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: 'VisiteCRM <noreply@resend.visitecrm.com>',
      to: [props.agencyEmail],
      subject: `[${props.platformName ?? 'VisiteCRM'}] Conta Suspensa — Ação Necessária`,
      react: React.createElement(AgencySuspendedEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send agency-suspended email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending agency-suspended email:', message);
    return { success: false, error: message };
  }
}

export async function sendAgencyReactivatedEmail(
  props: AgencyReactivatedEmailProps & { agencyEmail: string }
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: 'VisiteCRM <noreply@resend.visitecrm.com>',
      to: [props.agencyEmail],
      subject: `[${props.platformName ?? 'VisiteCRM'}] Conta Reativada — Acesso Restaurado`,
      react: React.createElement(AgencyReactivatedEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send agency-reactivated email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending agency-reactivated email:', message);
    return { success: false, error: message };
  }
}

export interface PixOrderAlertEmailProps {
  to: string[];
  agencyName: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  totalAmount: number;
  productName: string;
  adminPanelUrl: string;
}

export async function sendPixOrderAlertEmail(
  props: PixOrderAlertEmailProps,
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const recipients = props.to.filter((e) => !!e);
    if (recipients.length === 0) {
      return { success: false, error: 'No recipient address' };
    }

    const totalFormatted = props.totalAmount.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;background:#f5f5f5;padding:24px;margin:0">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:48px">💸</div>
      <h1 style="color:#1f2937;font-size:22px;margin:8px 0 4px">Novo pedido via PIX</h1>
      <p style="color:#6b7280;font-size:14px;margin:0">Aguardando confirmação de pagamento pela agência.</p>
    </div>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:20px">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="color:#6b7280;padding:5px 0;width:38%">Pedido:</td><td style="font-weight:700;color:#1f2937;font-family:monospace">${props.orderNumber}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 0">Cliente:</td><td style="font-weight:600;color:#1f2937">${props.customerName}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 0">E-mail:</td><td style="color:#1f2937">${props.customerEmail}</td></tr>
        ${props.customerPhone ? `<tr><td style="color:#6b7280;padding:5px 0">Telefone:</td><td style="color:#1f2937">${props.customerPhone}</td></tr>` : ''}
        <tr><td style="color:#6b7280;padding:5px 0">Produto:</td><td style="color:#1f2937">${props.productName}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 0">Valor:</td><td style="font-weight:700;color:#16a34a;font-size:16px">${totalFormatted}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 0">Pagamento:</td><td><span style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:700">PIX</span></td></tr>
      </table>
    </div>
    <div style="text-align:center;margin-bottom:24px">
      <a href="${props.adminPanelUrl}" style="background:#2563eb;color:#fff;padding:13px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block">
        Ver pedido no painel →
      </a>
    </div>
    <p style="color:#6b7280;font-size:13px;text-align:center;margin:0 0 16px">
      Após confirmar o recebimento do PIX, atualize o status do pedido para <strong>Confirmado</strong> e o pagamento para <strong>Pago</strong>.
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0">${props.agencyName} · VisiteCRM</p>
  </div>
</body>
</html>`;

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: recipients,
      subject: `💸 Novo pedido PIX — ${props.orderNumber} (aguardando confirmação)`,
      html,
    });

    if (error) {
      console.error('[email] Failed to send PIX order alert:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending PIX order alert:', message);
    return { success: false, error: message };
  }
}

export interface SendAbandonedReferralAlertEmailOptions {
  to: string;
  skipped: number;
  total: number;
  /** Absolute URL to the admin dashboard. When null the CTA button is omitted. */
  dashboardUrl: string | null;
}

export async function sendAbandonedReferralAlertEmail(
  opts: SendAbandonedReferralAlertEmailOptions
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const dashboardButton = opts.dashboardUrl
      ? `<p style="margin-top: 24px;">
          <a href="${opts.dashboardUrl}" style="background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
            Acessar o painel de administração
          </a>
        </p>`
      : '';

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #dc2626;">⚠️ Alerta — Limpeza de indicações abandonadas</h2>
        <p>A varredura diária de indicações abandonadas encontrou <strong>${opts.total}</strong> pedidos nunca pagos com indicações pendentes, mas <strong>nenhum</strong> foi reversível.</p>
        <p><strong>${opts.skipped}</strong> linha(s) foram ignoradas (já revertidas ou removidas). Isso pode indicar:</p>
        <ul>
          <li>ReferralId obsoleto ou removido manualmente no banco</li>
          <li>Divergência entre <code>pending_referral</code> e a tabela <code>referrals</code></li>
          <li>Problema de schema que impede a varredura de encontrar linhas PENDING</li>
        </ul>
        <p>Investigue os logs <code>[abandoned-referrals]</code> da última execução.</p>
        ${dashboardButton}
        <p style="margin-top: 24px; color: #6b7280; font-size: 12px;">
          Este alerta é enviado no máximo uma vez a cada 24 horas. Horário do alerta: ${new Date().toISOString()}
        </p>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: 'VisiteCRM <reservas@resend.visitecrm.com>',
      to: [opts.to],
      subject: '[VisiteCRM] Alerta — varredura de indicações abandonadas sem reversões',
      html,
    });

    if (error) {
      console.error('[email] Failed to send abandoned-referral alert email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending abandoned-referral alert email:', message);
    return { success: false, error: message };
  }
}

export async function sendFavoriteLowAvailabilityEmail(
  props: FavoriteLowAvailabilityEmailProps
): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: `${props.agencyName} <reservas@resend.visitecrm.com>`,
      to: [props.clientEmail],
      subject: `⚠️ Últimas vagas! "${props.tripName}" está quase esgotada`,
      react: React.createElement(FavoriteLowAvailabilityEmail, props),
    });

    if (error) {
      console.error('[email] Failed to send favorite-low-availability email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending favorite-low-availability email:', message);
    return { success: false, error: message };
  }
}

export interface SendStripeHealthAlertEmailOptions {
  to: string;
  /** Plans that are missing at least one Stripe price. */
  missingPlans: Array<{
    name: string;
    slug: string;
    monthlyOk: boolean;
    annualOk: boolean;
  }>;
  /** Absolute URL to the admin plans page. When null the CTA button is omitted. */
  dashboardUrl: string | null;
}

export async function sendStripeHealthAlertEmail(opts: SendStripeHealthAlertEmailOptions): Promise<SendEmailResult> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const subject = `[VisiteCRM] Alerta: ${opts.missingPlans.length} plano(s) com preço Stripe ausente`;

    const planRows = opts.missingPlans.map(p => {
      const missing: string[] = [];
      if (!p.monthlyOk) missing.push('mensal');
      if (!p.annualOk) missing.push('anual');
      return `
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${p.name} (<code>${p.slug}</code>)</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb; color: #dc2626; font-weight: bold;">${missing.join(', ')} ausente</td>
        </tr>`;
    }).join('');

    const dashboardButton = opts.dashboardUrl
      ? `<p style="margin-top: 24px;">
          <a href="${opts.dashboardUrl}" style="background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
            Ver planos no painel de administração
          </a>
        </p>`
      : '';

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #dc2626;">⚠️ Alerta: Preços Stripe ausentes</h2>
        <p>O monitoramento diário detectou <strong>${opts.missingPlans.length} plano(s)</strong> sem um preço Stripe correspondente (mensal ou anual). Clientes que tentarem assinar esses planos podem cair no fallback de pagamento único ou encontrar erros no checkout.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Plano</th>
              <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Problema</th>
            </tr>
          </thead>
          <tbody>${planRows}</tbody>
        </table>
        <p style="color: #6b7280; font-size: 14px;">Acesse o painel de administração → Planos para verificar e corrigir o mapeamento de preços no Stripe.</p>
        ${dashboardButton}
        <p style="margin-top: 24px; color: #6b7280; font-size: 12px;">
          Este alerta é enviado no máximo uma vez por dia. Horário da verificação: ${new Date().toISOString()}
        </p>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: 'VisiteCRM <reservas@resend.visitecrm.com>',
      to: [opts.to],
      subject,
      html,
    });

    if (error) {
      console.error('[email] Failed to send Stripe health alert email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error sending Stripe health alert email:', message);
    return { success: false, error: message };
  }
}

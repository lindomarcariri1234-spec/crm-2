import { Queue } from "bullmq";
import { getBullMQQueueConnection } from "../lib/redis";
import type { ReservationConfirmationEmailProps, ReservationCancellationEmailProps, BirthdayEmailProps, NewBookingNotificationEmailProps, ReferralBonusPaidEmailProps, ReferralConvertedEmailProps, ReferralExpiredEmailProps, ReferralExpiringSoonEmailProps, ReferralBonusReleasedEmailProps, ReferralWelcomeEmailProps, ReferralLoyaltyPointsEmailProps } from "@workspace/email";

export interface ReservationEmailJobData extends ReservationConfirmationEmailProps {
  emailLogId: string;
  tenantId: string;
  reservationId?: string;
}

export interface CancellationEmailJobData extends ReservationCancellationEmailProps {
  emailLogId: string;
  tenantId: string;
  reservationId?: string;
}

export interface BirthdayEmailJobData extends BirthdayEmailProps {
  tenantId: string;
  emailSubject?: string | null;
  senderName?: string | null;
  emailMessage?: string | null;
}

export interface NewBookingNotificationEmailJobData extends NewBookingNotificationEmailProps {
  emailLogId: string;
  tenantId: string;
  reservationId: string;
  recipients: string[];
  cc?: string[];
}

export interface ReferralBonusPaidEmailJobData extends ReferralBonusPaidEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralConvertedEmailJobData extends ReferralConvertedEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralExpiredEmailJobData extends ReferralExpiredEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralExpiringSoonEmailJobData extends ReferralExpiringSoonEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralBonusReleasedEmailJobData extends ReferralBonusReleasedEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralWelcomeEmailJobData extends ReferralWelcomeEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReferralLoyaltyPointsEmailJobData extends ReferralLoyaltyPointsEmailProps {
  emailLogId: string;
  tenantId: string;
}

export interface ReminderJobData {
  type: "boarding_reminder" | "payment_reminder" | "expired_reservations_cleanup" | "failed_email_retry" | "referral_expiry_notification" | "referral_expiry_warning" | "expiry_warning_email_retry" | "referral_bonus_release_notification" | "nps_dispatch" | "installment_due_reminder" | "seat_reconciliation" | "trial_expiry_notification" | "uploadthing_orphan_cleanup";
}

export interface PdfManifestJobData {
  type: "manifest";
  tenantId: string;
  tripId: string;
  tripName: string;
  manifestNumber: string | null;
  agencyName: string;
  recipientEmail: string;
  htmlContent: string;
  pdfBase64: string;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface PdfVoucherJobData {
  type: "voucher";
  tenantId: string;
  reservationId: string;
  passengerName: string;
  agencyName: string;
  primaryColor: string;
  reservationNumber: string | null;
  status: string;
  voucherCode: string | null;
  reservationDate: string;
  paymentMethod: string | null;
  totalValue: number;
  paidValue: number;
  balance: number;
  seatsCount: number;
  tripName: string;
  tripDestination: string;
  tripDepartureDate: string | null;
  tripReturnDate: string | null;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export type PdfJobData = PdfManifestJobData | PdfVoucherJobData;

export interface CommissionSyncJobData {
  reservationId: string;
  tenantId: string;
}

export interface WhatsAppMessageJobData {
  phone: string;
  message: string;
  tenantId: string;
}

export interface ReservationConfirmedWhatsAppJobData {
  kind: "reservation-confirmed";
  outboxId: string;
}

export type WhatsAppNotificationJobData =
  | WhatsAppMessageJobData
  | ReservationConfirmedWhatsAppJobData;
export interface CalendarSyncJobData {
  type: "syncTrip" | "syncTripForUser" | "syncPayment" | "syncBirthday" | "deleteEventsForTrip";
  tripId?: string;
  paymentId?: string;
  clientId?: string;
  actorUserId?: string;
}

export interface CampaignEmailJobData {
  to: string;
  toName: string;
  subject: string;
  htmlContent: string;
  fromName: string;
  campaignId: string;
  clientId: string;
  tenantId: string;
}

const QUEUES = {
  EMAIL: "emails",
  REMINDERS: "reminders",
  PDF: "pdfs",
  COMMISSION_SYNC: "commission-sync",
  WHATSAPP: "whatsapp-notifications",
  CALENDAR_SYNC: "calendar-sync",
} as const;

export type ReferralEmailJobData = ReferralBonusPaidEmailJobData | ReferralConvertedEmailJobData | ReferralExpiredEmailJobData | ReferralExpiringSoonEmailJobData | ReferralBonusReleasedEmailJobData | ReferralWelcomeEmailJobData;

let _emailQueue: Queue<ReservationEmailJobData> | null = null;
let _cancellationEmailQueue: Queue<CancellationEmailJobData> | null = null;
let _birthdayEmailQueue: Queue<BirthdayEmailJobData> | null = null;
let _newBookingNotificationEmailQueue: Queue<NewBookingNotificationEmailJobData> | null = null;
let _referralEmailQueue: Queue<ReferralEmailJobData> | null = null;
let _reminderQueue: Queue<ReminderJobData> | null = null;
let _pdfQueue: Queue<PdfJobData> | null = null;
let _commissionSyncQueue: Queue<CommissionSyncJobData> | null = null;

export function getEmailQueue(): Queue<ReservationEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_emailQueue) {
    _emailQueue = new Queue<ReservationEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _emailQueue;
}

export function getCancellationEmailQueue(): Queue<CancellationEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_cancellationEmailQueue) {
    _cancellationEmailQueue = new Queue<CancellationEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _cancellationEmailQueue;
}

export function getBirthdayEmailQueue(): Queue<BirthdayEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_birthdayEmailQueue) {
    _birthdayEmailQueue = new Queue<BirthdayEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _birthdayEmailQueue;
}

export function getNewBookingNotificationEmailQueue(): Queue<NewBookingNotificationEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_newBookingNotificationEmailQueue) {
    _newBookingNotificationEmailQueue = new Queue<NewBookingNotificationEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _newBookingNotificationEmailQueue;
}

export function getReferralEmailQueue(): Queue<ReferralEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_referralEmailQueue) {
    _referralEmailQueue = new Queue<ReferralEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _referralEmailQueue;
}

export function getReminderQueue(): Queue<ReminderJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_reminderQueue) {
    _reminderQueue = new Queue<ReminderJobData>(QUEUES.REMINDERS, {
      connection: conn,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _reminderQueue;
}

export function getPdfQueue(): Queue<PdfJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_pdfQueue) {
    _pdfQueue = new Queue<PdfJobData>(QUEUES.PDF, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _pdfQueue;
}

export function getCommissionSyncQueue(): Queue<CommissionSyncJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_commissionSyncQueue) {
    _commissionSyncQueue = new Queue<CommissionSyncJobData>(QUEUES.COMMISSION_SYNC, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _commissionSyncQueue;
}

let _calendarSyncQueue: Queue<CalendarSyncJobData> | null = null;

export function getCalendarSyncQueue(): Queue<CalendarSyncJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_calendarSyncQueue) {
    _calendarSyncQueue = new Queue<CalendarSyncJobData>(QUEUES.CALENDAR_SYNC, {
      connection: conn,
      defaultJobOptions: {
        // withCalendarRetry handles inline retries (30s/5min/20min, 4 attempts).
        // BullMQ attempts:2 is a safety net for paths not wrapped in withCalendarRetry
        // (e.g. deleteEvent calls). Avoids excessive multiplication for wrapped paths (4×2=8 max).
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _calendarSyncQueue;
}

let _campaignEmailQueue: Queue<CampaignEmailJobData> | null = null;

export function getCampaignEmailQueue(): Queue<CampaignEmailJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;
  if (!_campaignEmailQueue) {
    _campaignEmailQueue = new Queue<CampaignEmailJobData>(QUEUES.EMAIL, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _campaignEmailQueue;
}

let _whatsAppQueue: Queue<WhatsAppNotificationJobData> | null = null;

export function getWhatsAppQueue(): Queue<WhatsAppNotificationJobData> | null {
  const conn = getBullMQQueueConnection();
  if (!conn) return null;

  if (!_whatsAppQueue) {
    _whatsAppQueue = new Queue<WhatsAppNotificationJobData>(QUEUES.WHATSAPP, {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _whatsAppQueue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    _emailQueue?.close().catch(() => {}),
    _cancellationEmailQueue?.close().catch(() => {}),
    _birthdayEmailQueue?.close().catch(() => {}),
    _newBookingNotificationEmailQueue?.close().catch(() => {}),
    _referralEmailQueue?.close().catch(() => {}),
    _reminderQueue?.close().catch(() => {}),
    _pdfQueue?.close().catch(() => {}),
    _commissionSyncQueue?.close().catch(() => {}),
    _calendarSyncQueue?.close().catch(() => {}),
    _campaignEmailQueue?.close().catch(() => {}),
    _whatsAppQueue?.close().catch(() => {}),
  ]);
  _emailQueue = null;
  _cancellationEmailQueue = null;
  _birthdayEmailQueue = null;
  _newBookingNotificationEmailQueue = null;
  _reminderQueue = null;
  _pdfQueue = null;
  _commissionSyncQueue = null;
  _calendarSyncQueue = null;
  _campaignEmailQueue = null;
  _whatsAppQueue = null;
}

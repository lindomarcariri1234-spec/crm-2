import { sendReminderHtmlEmail } from "@workspace/email";
import { sendTenantWhatsAppMessage } from "../lib/whatsapp";
import { sendInstagramText, type InstagramMetaConfig } from "./instagram-messaging.js";
import { sendZernioInstagramText } from "./instagram-zernio.js";

export interface ProviderSendResult {
  provider: string;
  externalId: string | null;
  success: boolean;
  error: string | null;
  outcomeUnknown: boolean;
}

export interface ProviderAdapter<Input> {
  readonly id: string;
  send(input: Input): Promise<ProviderSendResult>;
}

export interface EmailProviderInput {
  recipient: string;
  subject: string;
  html: string;
  senderName: string;
  idempotencyKey: string;
}

export const emailProviderAdapter: ProviderAdapter<EmailProviderInput> = {
  id: "resend",
  async send(input) {
    const result = await sendReminderHtmlEmail({
      to: input.recipient,
      subject: input.subject,
      html: input.html,
      fromName: input.senderName,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      provider: "resend",
      externalId: result.messageId ?? null,
      success: result.success,
      error: result.error ?? null,
      outcomeUnknown: false,
    };
  },
};

export interface WhatsAppProviderInput {
  tenantId: string;
  recipient: string;
  text: string;
  integrationId?: string;
  requireEvolution?: boolean;
}

export const whatsappProviderAdapter: ProviderAdapter<WhatsAppProviderInput> = {
  id: "whatsapp",
  async send(input) {
    const result = await sendTenantWhatsAppMessage(
      input.tenantId,
      input.recipient,
      input.text,
      {
        integrationId: input.integrationId,
        requireEvolution: input.requireEvolution,
      },
    );
    return {
      provider: result.provider ?? "whatsapp",
      externalId: result.externalId ?? null,
      success: result.success,
      error: result.error ?? null,
      outcomeUnknown: result.outcome === "unknown",
    };
  },
};

export interface MetaInstagramProviderInput {
  config: InstagramMetaConfig;
  accessToken: string;
  instagramUserId: string;
  recipient: string;
  text: string;
}

export const metaInstagramProviderAdapter: ProviderAdapter<MetaInstagramProviderInput> = {
  id: "meta",
  async send(input) {
    return {
      provider: "meta",
      externalId: await sendInstagramText(
        input.config,
        input.accessToken,
        input.instagramUserId,
        input.recipient,
        input.text,
      ),
      success: true,
      error: null,
      outcomeUnknown: false,
    };
  },
};

export interface ZernioInstagramProviderInput {
  apiKey: string;
  accountId: string;
  conversationId: string;
  text: string;
  idempotencyKey: string;
}

export const zernioInstagramProviderAdapter: ProviderAdapter<ZernioInstagramProviderInput> = {
  id: "zernio",
  async send(input) {
    return {
      provider: "zernio",
      externalId: await sendZernioInstagramText(
        input.apiKey,
        input.accountId,
        input.conversationId,
        input.text,
        input.idempotencyKey,
      ),
      success: true,
      error: null,
      outcomeUnknown: false,
    };
  },
};

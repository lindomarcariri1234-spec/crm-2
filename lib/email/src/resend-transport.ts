import { ReplitConnectors } from "@replit/connectors-sdk";
import { Resend } from "resend";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

type EmailPayload = Parameters<Resend["emails"]["send"]>[0];
type EmailSendResponse = Awaited<ReturnType<Resend["emails"]["send"]>>;

type ConnectorAttachment = {
  content?: unknown;
  [key: string]: unknown;
};

type ResendConnector = {
  proxy(
    service: string,
    path: string,
    request: {
      method: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    },
  ): Promise<Response>;
};

function errorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; name?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.name === "string") return parsed.name;
  } catch {
    // Keep the provider's text response below when it isn't JSON.
  }
  return body || `Resend request failed with status ${status}`;
}

function serializeAttachment(attachment: ConnectorAttachment): ConnectorAttachment {
  if (!Buffer.isBuffer(attachment.content)) return attachment;
  return { ...attachment, content: attachment.content.toString("base64") };
}

function resolveFromAddress(from: unknown): unknown {
  if (process.env["RESEND_FROM_EMAIL"]) return process.env["RESEND_FROM_EMAIL"];

  // Resend's test sender permits the non-production delivery check without a
  // customer-owned domain. Production continues to use the configured sender
  // and must therefore have that domain verified in Resend.
  if (process.env["NODE_ENV"] !== "production") {
    return "VisiteCRM <onboarding@resend.dev>";
  }

  return from;
}

function toConnectorPayload(payload: EmailPayload): Record<string, unknown> {
  const message = payload as EmailPayload & {
    react?: unknown;
    html?: string;
    attachments?: ConnectorAttachment[];
  };
  const { react, attachments, ...rest } = message;
  const html = message.html ?? (
    React.isValidElement(react)
      ? renderToStaticMarkup(react)
      : undefined
  );

  if (!html && !("text" in rest)) {
    throw new Error("Email must include HTML, text, or a valid React email component");
  }

  return {
    ...rest,
    from: resolveFromAddress(rest.from),
    ...(html ? { html } : {}),
    ...(attachments ? { attachments: attachments.map(serializeAttachment) } : {}),
  };
}

export function createConnectorResend(
  connector: ResendConnector = new ReplitConnectors(),
): Resend {
  return {
    emails: {
      send: async (payload: EmailPayload): Promise<EmailSendResponse> => {
        try {
          // The connector's identity headers are short-lived and the SDK refreshes
          // them automatically when the platform returns a 401.
          const response = await connector.proxy("resend", "/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: toConnectorPayload(payload),
          });
          const body = await response.text();

          if (!response.ok) {
            return {
              data: null,
              error: { message: errorMessage(response.status, body) },
            } as EmailSendResponse;
          }

          const data = JSON.parse(body) as { id?: string };
          return {
            data: { id: data.id },
            error: null,
          } as EmailSendResponse;
        } catch (error) {
          return {
            data: null,
            error: { message: error instanceof Error ? error.message : String(error) },
          } as EmailSendResponse;
        }
      },
    },
  } as unknown as Resend;
}

/**
 * Prefer a direct key outside Replit, then use the attached Replit Resend
 * connector. This keeps local deployments working while avoiding a copied API
 * key in Replit environments.
 */
export function getResend(): Resend {
  const key = process.env["RESEND_API_KEY"];
  return key ? new Resend(key) : createConnectorResend();
}
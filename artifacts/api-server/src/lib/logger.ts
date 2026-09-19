import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Field names that may carry PII or secrets and must never reach the logs in
 * clear text. For each name we redact both the top-level occurrence and any
 * occurrence one level deep (`*.field`), which covers the common shapes such as
 * `{ client: { email } }` or `{ body: { cpf } }`. Paths that are absent from a
 * given log object are simply ignored by pino, so the list can be permissive.
 */
const SENSITIVE_FIELDS = [
  // PII
  "email",
  "cpf",
  "phone",
  "whatsapp",
  "birthDate",
  // Credentials / secrets
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "secret",
  "pixKey",
  "stripeSecretKey",
];

export const REDACT_PATHS: string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  ...SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`]),
];

export const redactConfig = {
  paths: REDACT_PATHS,
  censor: "[REDACTED]",
};

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: redactConfig,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

export interface AuditFailureContext {
  operation: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  requestId: string;
}

/**
 * Records an audit write failure using an allowlist of operational metadata.
 * Deliberately does not accept or serialize the failed audit payload or the
 * original error object, which may contain sensitive snapshots or SQL details.
 */
export function logAuditWriteFailure(context: AuditFailureContext, cause: unknown): void {
  logger.error(
    {
      operation: context.operation,
      tenantId: context.tenantId,
      entityType: context.entityType,
      entityId: context.entityId,
      requestId: context.requestId,
      errorType: cause instanceof Error ? cause.name : typeof cause,
    },
    "Audit log write failed; transaction rolled back",
  );
}

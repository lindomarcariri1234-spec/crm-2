import {
  pool,
} from "@workspace/db";
import {
  verifyFinancialCategoryIntegrity,
  type FinancialCategoryIntegrityQuery,
  type FinancialCategoryIntegrityResult,
} from "@workspace/db/financial-category-integrity";
import {
  sendFinancialCategoryIntegrityAlertEmail,
  type FinancialCategoryIntegrityAlertOptions,
  type SendEmailResult,
} from "@workspace/email";
import { generateId } from "./id";
import { logger } from "./logger";

type QueryRows = (
  statement: string,
  values?: readonly unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

type IntegrityLogger = Pick<typeof logger, "info" | "warn">;

export interface FinancialCategoryIntegrityCheckDependencies {
  query?: QueryRows;
  verify?: typeof verifyFinancialCategoryIntegrity;
  sendEmail?: (
    options: FinancialCategoryIntegrityAlertOptions,
  ) => Promise<SendEmailResult>;
  recipient?: string | null;
  releaseId?: string | null;
  sendTimeoutMs?: number;
  log?: IntegrityLogger;
}

const ALERT_SETTING_KEY = "redis_alert_email";
const ALERT_CLAIM_PREFIX = "financial_category_integrity_release:";
const DEFAULT_SEND_TIMEOUT_MS = 8_000;

const dbQuery: QueryRows = async (statement, values) =>
  pool.query(statement, values ? [...values] : undefined);

function validEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function stableReleaseId(explicitReleaseId?: string | null): string | null {
  const candidate =
    explicitReleaseId ??
    process.env["FINANCIAL_CATEGORY_RELEASE_ID"] ??
    process.env["PUBLICATION_EXPECTED_VERSION"] ??
    process.env["PUBLICATION_VERSION"] ??
    process.env["VERCEL_GIT_COMMIT_SHA"];
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > 128 ||
    !/^[A-Za-z0-9._-]+$/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

async function resolveRecipient(query: QueryRows): Promise<string | null> {
  try {
    const result = await query(
      "SELECT value FROM public.platform_settings WHERE key = $1 LIMIT 1",
      [ALERT_SETTING_KEY],
    );
    const configured = result.rows[0]?.["value"];
    const configuredEmail =
      typeof configured === "string" ? configured.trim() : null;
    if (validEmail(configuredEmail)) return configuredEmail;
  } catch {
    // If the setting cannot be read, try the environment fallback.
  }

  const fallback = process.env["SUPERADMIN_EMAIL"]?.trim();
  return validEmail(fallback) ? fallback : null;
}

function errorKind(error: unknown): string {
  if (error instanceof Error) return "Error";
  if (error !== null && typeof error === "object") return "ErrorObject";
  return "Unknown";
}

async function sendWithinTimeout(
  send: FinancialCategoryIntegrityCheckDependencies["sendEmail"],
  options: FinancialCategoryIntegrityAlertOptions,
  timeoutMs: number,
): Promise<SendEmailResult | null> {
  if (!send) return null;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      send(options),
      new Promise<null>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * Logs and emails aggregate-only integrity results. Every operational failure
 * is contained here so callers can run this after migrations without making
 * API startup or publication depend on the mail provider.
 */
export async function runFinancialCategoryIntegrityCheck(
  dependencies: FinancialCategoryIntegrityCheckDependencies = {},
): Promise<FinancialCategoryIntegrityResult | null> {
  const query = dependencies.query ?? dbQuery;
  const log = dependencies.log ?? logger;

  try {
    const result = await (dependencies.verify ?? verifyFinancialCategoryIntegrity)(
      query as FinancialCategoryIntegrityQuery,
    );
    const logFields = {
      migrationStatus: result.migrationStatus,
      totals: result.totals,
    };

    if (!result.needsAlert) {
      log.info(logFields, "[financial-category-integrity] PASS");
      return result;
    }

    log.warn(logFields, "[financial-category-integrity] FAIL; continuing");
    const releaseId = stableReleaseId(dependencies.releaseId);
    if (!releaseId) {
      log.warn(logFields, "[financial-category-integrity] No stable release ID; alert skipped");
      return result;
    }

    const recipient =
      dependencies.recipient === undefined
        ? await resolveRecipient(query)
        : dependencies.recipient;
    if (!validEmail(recipient)) {
      log.warn(logFields, "[financial-category-integrity] No alert recipient configured; alert skipped");
      return result;
    }

    const claimKey = `${ALERT_CLAIM_PREFIX}${releaseId}`;
    const claim = await query(
      `INSERT INTO public.platform_settings (id, key, value, label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [
        generateId(),
        claimKey,
        String(Date.now()),
        "Financial category integrity alert release claim",
      ],
    );
    if (claim.rows.length === 0) {
      log.info(logFields, "[financial-category-integrity] Alert already claimed for this release");
      return result;
    }

    const alertOptions: FinancialCategoryIntegrityAlertOptions = {
      to: recipient,
      migrationStatus: result.migrationStatus,
      totals: result.totals,
    };
    const configuredTimeout = dependencies.sendTimeoutMs;
    const timeoutMs =
      Number.isSafeInteger(configuredTimeout) && configuredTimeout! > 0
        ? configuredTimeout!
        : DEFAULT_SEND_TIMEOUT_MS;
    let sendResult: SendEmailResult | null;
    try {
      sendResult = await sendWithinTimeout(
        dependencies.sendEmail ?? sendFinancialCategoryIntegrityAlertEmail,
        alertOptions,
        timeoutMs,
      );
    } catch {
      // The provider error itself may carry response or request details.
      log.warn(
        logFields,
        "[financial-category-integrity] Alert send failed; continuing",
      );
      return result;
    }

    if (sendResult?.success) {
      log.info(logFields, "[financial-category-integrity] Alert sent");
    } else {
      // Do not log provider errors: SDK responses can contain sensitive details.
      log.warn(logFields, "[financial-category-integrity] Alert send failed or timed out; continuing");
    }
    return result;
  } catch (error) {
    log.warn(
      { errorType: errorKind(error) },
      "[financial-category-integrity] Check failed; continuing",
    );
    return null;
  }
}
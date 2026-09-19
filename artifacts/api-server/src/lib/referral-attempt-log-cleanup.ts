import { db, referralAttemptLogsTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Suspended-code attempts are abuse signals, not an unlimited audit ledger.
 * Keep enough history for operational review while bounding per-tenant storage.
 * The value can be lowered only with an explicit deployment setting; malformed
 * or unsafe values use the conservative default.
 */
export const DEFAULT_REFERRAL_ATTEMPT_LOG_RETENTION_DAYS = 90;
const MIN_REFERRAL_ATTEMPT_LOG_RETENTION_DAYS = 7;
const MAX_REFERRAL_ATTEMPT_LOG_RETENTION_DAYS = 3650;

export function getReferralAttemptLogRetentionDays(): number {
  const configured = Number.parseInt(process.env["REFERRAL_ATTEMPT_LOG_RETENTION_DAYS"] ?? "", 10);
  if (!Number.isFinite(configured)) return DEFAULT_REFERRAL_ATTEMPT_LOG_RETENTION_DAYS;
  return Math.min(
    MAX_REFERRAL_ATTEMPT_LOG_RETENTION_DAYS,
    Math.max(MIN_REFERRAL_ATTEMPT_LOG_RETENTION_DAYS, configured),
  );
}

export interface ReferralAttemptLogCleanupResult {
  retentionDays: number;
  tenantsScanned: number;
  deletedRows: number;
  failedTenants: number;
}

/**
 * Deletes only stale rows belonging to each tenant that has attempt logs.
 * Each tenant is a separate atomic DELETE so a failure cannot remove rows
 * from another tenant or make the whole cleanup appear to have succeeded.
 */
export async function runReferralAttemptLogCleanup(): Promise<ReferralAttemptLogCleanupResult> {
  const retentionDays = getReferralAttemptLogRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  let tenantRows: Array<{ tenantId: string }>;
  try {
    tenantRows = await db
      .select({ tenantId: referralAttemptLogsTable.tenantId })
      .from(referralAttemptLogsTable)
      .groupBy(referralAttemptLogsTable.tenantId);
  } catch (err) {
    logger.error(
      { retentionDays, errorType: err instanceof Error ? err.name : typeof err },
      "[referral-attempt-log-cleanup] Failed to discover tenants",
    );
    throw err;
  }

  let deletedRows = 0;
  let failedTenants = 0;

  for (const { tenantId } of tenantRows) {
    try {
      const deleted = await db
        .delete(referralAttemptLogsTable)
        .where(and(
          eq(referralAttemptLogsTable.tenantId, tenantId),
          lt(referralAttemptLogsTable.createdAt, cutoff),
        ))
        .returning({ id: referralAttemptLogsTable.id });
      deletedRows += deleted.length;
    } catch (err) {
      failedTenants++;
      logger.error(
        { tenantId, retentionDays, errorType: err instanceof Error ? err.name : typeof err },
        "[referral-attempt-log-cleanup] Failed to clean tenant rows",
      );
    }
  }

  const result = {
    retentionDays,
    tenantsScanned: tenantRows.length,
    deletedRows,
    failedTenants,
  };
  logger.info(result, "[referral-attempt-log-cleanup] Cleanup complete");
  return result;
}
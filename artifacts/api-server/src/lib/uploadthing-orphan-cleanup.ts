/**
 * uploadthing-orphan-cleanup.ts
 *
 * Nightly job that purges UploadThing files that are not referenced by any DB record.
 *
 * WHY THIS EXISTS
 * ---------------
 * The upload endpoints already clean up files when a DB insert fails immediately.
 * But if the server crashes between the UploadThing upload and the db.insert call,
 * the file is permanently orphaned — no in-process cleanup code will ever run.
 *
 * SAFETY DESIGN — TWO-RUN STAGING
 * --------------------------------
 * UploadThing's listFiles API does not expose a file-creation timestamp.  We
 * therefore cannot filter candidates by age in a single pass.  A user may upload
 * media before submitting a form, leaving a legitimate UploadThing file with no DB
 * record for an arbitrarily long window.  Deleting it in the same run that discovers
 * it would destroy real data.
 *
 * To guarantee a conservative grace period, the job uses a two-run approach:
 *
 *   Run N   — orphan candidates are discovered and written to platform_settings
 *             (key: "uploadthing_orphan_candidates") with a stagedAt timestamp.
 *             Nothing is deleted.
 *
 *   Run N+1+ — candidates still present after GRACE_MS have elapsed are treated as
 *              confirmed orphans.  Before each delete batch the DB reference set is
 *              re-fetched so any file that was linked in the intervening time is
 *              protected.  Confirmed orphans are then deleted.
 *
 * Grace period: GRACE_MS defaults to 26 hours (covering a full 24-hour day plus a
 * 2-hour buffer for timezone drift / late-night uploads).
 *
 * SCHEDULE
 * --------
 * BullMQ: nightly 02:00 America/Sao_Paulo ("uploadthing-orphan-cleanup-nightly").
 * node-cron fallback: same schedule in both !workersEnabled and !redisConn branches.
 */

import { db, platformSettingsTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { PoolClient } from "pg";
import { utapi } from "./uploadthing";
import { collectReferencedUploadThingKeys } from "./collectReferencedUploadThingKeys";
import { generateId } from "./id";
import { logger } from "./logger";
import { safeErrorLogFields } from "./safe-error-log";
import {
  runWhatsAppInboundMediaRetentionCleanup,
  type WhatsAppMediaRetentionResult,
} from "./whatsapp-media-retention";

// ── Configuration ─────────────────────────────────────────────────────────────

/** Minimum age (ms) a candidate must have been staged before it is deleted. */
const GRACE_MS = 26 * 60 * 60 * 1000; // 26 hours

const STAGING_KEY = "uploadthing_orphan_candidates";
const STAGING_LOCK_KEY = "uploadthing-orphan-cleanup-staging";
const PAGE_SIZE = 500;
const DELETE_BATCH_SIZE = 100;

// ── Types ─────────────────────────────────────────────────────────────────────

interface StagedCandidate {
  key: string;
  stagedAt: number; // Unix timestamp (ms)
}

export type UploadThingOrphanCleanupResult = {
  /** Total UploadThing file keys scanned. */
  scanned: number;
  /** New orphan candidates staged this run (not yet old enough to delete). */
  newlyStaged: number;
  /** Number of orphaned files successfully deleted. */
  deleted: number;
  /** Number of deletion failures (file still exists in UploadThing). */
  errors: number;
  /** Aggregate result of the inbound WhatsApp media retention pass. */
  retention: WhatsAppMediaRetentionResult;
};

// ── Staging helpers ───────────────────────────────────────────────────────────

async function readStagedCandidates(): Promise<StagedCandidate[]> {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, STAGING_KEY))
      .limit(1);
    if (!row?.value) return [];
    return JSON.parse(row.value) as StagedCandidate[];
  } catch {
    return [];
  }
}

async function writeStagedCandidates(candidates: StagedCandidate[]): Promise<void> {
  const value = JSON.stringify(candidates);
  const existing = await db
    .select({ id: platformSettingsTable.id })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, STAGING_KEY))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(platformSettingsTable)
      .set({ value })
      .where(eq(platformSettingsTable.key, STAGING_KEY));
  } else {
    await db.insert(platformSettingsTable).values({
      id: generateId(),
      key: STAGING_KEY,
      value,
      label: "UploadThing Orphan Candidates",
      description: "Staged file keys discovered as potential orphans by the nightly cleanup job. Keys present for longer than the grace period are deleted on the next run.",
      type: "json",
    });
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Main entry point.  Scans UploadThing for orphan candidates, stages new ones,
 * and deletes candidates that have been staged longer than the grace period.
 *
 * Never throws — errors are logged and the run continues.
 */
export async function runUploadThingOrphanCleanup(): Promise<UploadThingOrphanCleanupResult> {
  const result: UploadThingOrphanCleanupResult = {
    scanned: 0,
    newlyStaged: 0,
    deleted: 0,
    errors: 0,
    retention: { expiredMessages: 0, errors: 0 },
  };

  let retentionCleanupRejected = false;
  let stagingLockClient: PoolClient | undefined;
  let stagingLockHeld = false;

  try {
    // Expire old inbound media references before collecting keys, so files
    // released by the 90-day policy are staged by this same cleanup run.
    try {
      result.retention = await runWhatsAppInboundMediaRetentionCleanup();
    } catch {
      result.retention = { expiredMessages: 0, errors: 1 };
      retentionCleanupRejected = true;
    }

    stagingLockClient = await pool.connect();
    await stagingLockClient.query(
      "SELECT pg_advisory_lock(hashtextextended($1, 0))",
      [STAGING_LOCK_KEY],
    );
    stagingLockHeld = true;

    const now = Date.now();

    // ── Step 1: Collect DB-referenced keys and list all UT files ─────────────
    const [referencedKeys, existingStaged] = await Promise.all([
      collectReferencedUploadThingKeys(),
      readStagedCandidates(),
    ]);

    const existingStagedMap = new Map(existingStaged.map((c) => [c.key, c.stagedAt]));

    // ── Step 2: Page through UploadThing and identify current orphans ─────────
    const currentOrphanKeys = new Set<string>();
    let offset = 0;

    while (true) {
      let page: Awaited<ReturnType<typeof utapi.listFiles>>;
      try {
        page = await utapi.listFiles({ limit: PAGE_SIZE, offset });
      } catch (listErr) {
        logger.error(
          { providerError: safeErrorLogFields(listErr), offset },
          "[uploadthing-orphan] Failed to list files from UploadThing — aborting scan",
        );
        break;
      }

      for (const f of page.files) {
        result.scanned++;
        if (!referencedKeys.has(f.key)) {
          currentOrphanKeys.add(f.key);
        }
      }

      if (!page.hasMore) break;
      offset += PAGE_SIZE;
    }

    logger.info(
      { scanned: result.scanned, currentOrphans: currentOrphanKeys.size },
      "[uploadthing-orphan] Scan complete",
    );

    // ── Step 3: Separate into "ready to delete" vs "newly staged" ────────────
    const toDelete: string[] = [];
    const updatedStaging: StagedCandidate[] = [];

    for (const key of currentOrphanKeys) {
      const stagedAt = existingStagedMap.get(key);
      if (stagedAt !== undefined && now - stagedAt >= GRACE_MS) {
        // Candidate has been an orphan for the full grace period → eligible for deletion
        toDelete.push(key);
      } else if (stagedAt === undefined) {
        // First time we've seen this key as an orphan → stage it
        updatedStaging.push({ key, stagedAt: now });
        result.newlyStaged++;
      } else {
        // Still within grace period → keep staged
        updatedStaging.push({ key, stagedAt });
      }
    }
    // Keys in existingStaged that are no longer orphans (now in DB) are intentionally
    // omitted from updatedStaging — they get de-staged automatically.

    logger.info(
      { toDelete: toDelete.length, newlyStaged: result.newlyStaged, keptInGrace: updatedStaging.length - result.newlyStaged },
      "[uploadthing-orphan] Grace-period split complete",
    );

    // ── Step 4: Delete eligible candidates in batches, with per-batch re-check ─
    if (toDelete.length > 0) {
      for (let i = 0; i < toDelete.length; i += DELETE_BATCH_SIZE) {
        const batch = toDelete.slice(i, i + DELETE_BATCH_SIZE);

        // Per-batch re-check: re-fetch DB references immediately before this batch.
        // Protects files whose DB record was committed since the initial scan.
        let freshKeys: Set<string>;
        try {
          freshKeys = await collectReferencedUploadThingKeys();
        } catch (recheckErr) {
          logger.error(
            { error: safeErrorLogFields(recheckErr), batchStart: i },
            "[uploadthing-orphan] Per-batch re-check failed — skipping batch to be safe",
          );
          result.errors += batch.length;
          continue;
        }

        const confirmedBatch = batch.filter((key) => !freshKeys.has(key));
        const rescuedCount = batch.length - confirmedBatch.length;
        if (rescuedCount > 0) {
          logger.info(
            { rescuedCount, batchStart: i },
            "[uploadthing-orphan] Batch re-check rescued files now referenced in DB",
          );
        }

        if (confirmedBatch.length === 0) continue;

        try {
          const deleteResult = await utapi.deleteFiles(confirmedBatch);
          const reportedDeletedCount = deleteResult.deletedCount;
          const validDeletedCount =
            Number.isInteger(reportedDeletedCount) &&
            reportedDeletedCount >= 0 &&
            reportedDeletedCount <= confirmedBatch.length;
          const deletedCount = validDeletedCount ? reportedDeletedCount : 0;
          result.deleted += deletedCount;

          if (deletedCount < confirmedBatch.length) {
            const retainedCount = confirmedBatch.length - deletedCount;
            result.errors += retainedCount;
            // The provider reports only a count, not which keys were deleted.
            // Retain the whole batch with its original timestamps; the next list
            // scan drops keys that really disappeared and retries the rest.
            for (const key of confirmedBatch) {
              updatedStaging.push({
                key,
                stagedAt: existingStagedMap.get(key) ?? now,
              });
            }
            logger.warn(
              {
                batchStart: i,
                requestedCount: confirmedBatch.length,
                deletedCount,
                retainedCount,
                invalidProviderCount: !validDeletedCount,
              },
              "[uploadthing-orphan] Partial batch deletion — retaining candidates for retry",
            );
          }

          logger.info(
            { batchStart: i, batchSize: confirmedBatch.length, deletedCount },
            "[uploadthing-orphan] Batch delete response processed",
          );
        } catch (batchErr) {
          result.errors += confirmedBatch.length;
          // Keep these keys in updatedStaging so they get retried next run
          for (const key of confirmedBatch) {
            updatedStaging.push({ key, stagedAt: existingStagedMap.get(key) ?? now });
          }
          logger.error(
            {
              providerError: safeErrorLogFields(batchErr),
              batchStart: i,
              batchSize: confirmedBatch.length,
            },
            "[uploadthing-orphan] Batch deletion failed — retaining in staging for next run",
          );
        }
      }
    }

    // ── Step 5: Persist updated staging ──────────────────────────────────────
    try {
      await writeStagedCandidates(updatedStaging);
    } catch (writeErr) {
      logger.error(
        { error: safeErrorLogFields(writeErr) },
        "[uploadthing-orphan] Failed to persist updated staging — next run will re-discover candidates",
      );
    }

  } catch (err) {
    logger.error(
      { error: safeErrorLogFields(err) },
      "[uploadthing-orphan] Unexpected error during orphan cleanup — run aborted",
    );
  } finally {
    if (stagingLockClient) {
      let releaseFailure: unknown;
      if (stagingLockHeld) {
        try {
          const { rows } = await stagingLockClient.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [STAGING_LOCK_KEY],
          );
          if (rows[0]?.unlocked !== true) {
            throw new Error("UploadThing cleanup staging lock was not held");
          }
        } catch (error) {
          releaseFailure = error;
        }
      }

      // A failed unlock must not return a still-locked session to the pool.
      stagingLockClient.release(releaseFailure ? true : undefined);
      if (releaseFailure) {
        result.errors++;
        logger.error(
          { error: safeErrorLogFields(releaseFailure) },
          "[uploadthing-orphan] Failed to release staging lock; connection discarded",
        );
      }
    }
  }

  const completionSummary = {
    scanned: result.scanned,
    newlyStaged: result.newlyStaged,
    deleted: result.deleted,
    errors: result.errors,
    retention: result.retention,
  };

  if (result.retention.errors > 0) {
    logger.error(
      completionSummary,
      retentionCleanupRejected
        ? "[uploadthing-orphan] Run completed after WhatsApp retention cleanup rejected"
        : "[uploadthing-orphan] Run completed with WhatsApp retention cleanup errors",
    );
  } else {
    logger.info(completionSummary, "[uploadthing-orphan] Run complete");
  }

  return result;
}

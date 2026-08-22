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

import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { utapi } from "./uploadthing";
import { collectReferencedUploadThingKeys } from "./collectReferencedUploadThingKeys";
import { generateId } from "./id";
import { logger } from "./logger";

// ── Configuration ─────────────────────────────────────────────────────────────

/** Minimum age (ms) a candidate must have been staged before it is deleted. */
const GRACE_MS = 26 * 60 * 60 * 1000; // 26 hours

const STAGING_KEY = "uploadthing_orphan_candidates";
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
  };

  try {
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
          { err: listErr, offset },
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
    const deletedKeys: string[] = [];

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
            { err: recheckErr, batchStart: i },
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
          result.deleted += deleteResult.deletedCount;
          deletedKeys.push(...confirmedBatch.slice(0, deleteResult.deletedCount));
          logger.info(
            { batchStart: i, batchSize: confirmedBatch.length, deletedCount: deleteResult.deletedCount },
            "[uploadthing-orphan] Batch deleted",
          );
        } catch (batchErr) {
          result.errors += confirmedBatch.length;
          // Keep these keys in updatedStaging so they get retried next run
          for (const key of confirmedBatch) {
            updatedStaging.push({ key, stagedAt: existingStagedMap.get(key) ?? now });
          }
          logger.error(
            { err: batchErr, batchStart: i, batchSize: confirmedBatch.length },
            "[uploadthing-orphan] Batch deletion failed — retaining in staging for next run",
          );
        }
      }
    }

    // ── Step 5: Persist updated staging ──────────────────────────────────────
    try {
      await writeStagedCandidates(updatedStaging);
    } catch (writeErr) {
      logger.error({ err: writeErr }, "[uploadthing-orphan] Failed to persist updated staging — next run will re-discover candidates");
    }

  } catch (err) {
    logger.error({ err }, "[uploadthing-orphan] Unexpected error during orphan cleanup — run aborted");
  }

  logger.info(
    { scanned: result.scanned, newlyStaged: result.newlyStaged, deleted: result.deleted, errors: result.errors },
    "[uploadthing-orphan] Run complete",
  );

  return result;
}

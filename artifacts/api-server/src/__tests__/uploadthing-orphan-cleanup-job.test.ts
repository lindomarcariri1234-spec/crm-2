/**
 * uploadthing-orphan-cleanup-job.test.ts
 *
 * Unit tests for runUploadThingOrphanCleanup() in lib/uploadthing-orphan-cleanup.ts
 *
 * The job uses a two-run staging design:
 *   Run N   — orphan candidates are discovered and written to platform_settings
 *             (key: "uploadthing_orphan_candidates") with a stagedAt timestamp.
 *             Nothing is deleted on this run.
 *   Run N+1+ — candidates present for ≥ GRACE_MS (26 h) are deleted (with a
 *              per-batch DB re-check before each batch), and new candidates are
 *              added to staging.
 *
 * Contracts verified:
 *   1. First-time orphans are staged (newlyStaged++) — never immediately deleted.
 *   2. Orphans within the grace window remain staged and are not deleted.
 *   3. Orphans past the grace window are deleted (after per-batch DB re-check).
 *   4. Per-batch re-check rescues a file committed to the DB after staging.
 *   5. Pagination (hasMore = true) is handled correctly.
 *   6. listFiles errors abort the scan gracefully.
 *   7. Batch deletion errors keep the key in staging for retry.
 *   8. DB re-check failure skips the batch safely (errors += batch.length).
 *   9. The function never throws.
 *  10. Staging is written after every run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock state ───────────────────────────────────────────────────────

const {
  mockListFiles,
  mockDeleteFiles,
  mockCollectReferenced,
  mockDbSelect,
  mockDbSelectFrom,
  mockDbSelectFromWhere,
  mockDbSelectFromWhereLimit,
  mockDbUpdate,
  mockDbUpdateSet,
  mockDbUpdateSetWhere,
  mockDbInsert,
  mockDbInsertValues,
  mockLogInfo,
  mockLogError,
} = vi.hoisted(() => {
  const mockListFiles = vi.fn();
  const mockDeleteFiles = vi.fn();
  const mockCollectReferenced = vi.fn();

  // db.select().from().where().limit() chain
  const mockDbSelectFromWhereLimit = vi.fn();
  const mockDbSelectFromWhere = vi.fn(() => ({ limit: mockDbSelectFromWhereLimit }));
  const mockDbSelectFrom = vi.fn(() => ({ where: mockDbSelectFromWhere, limit: mockDbSelectFromWhereLimit }));
  const mockDbSelect = vi.fn(() => ({ from: mockDbSelectFrom }));

  // db.update().set().where()
  const mockDbUpdateSetWhere = vi.fn();
  const mockDbUpdateSet = vi.fn(() => ({ where: mockDbUpdateSetWhere }));
  const mockDbUpdate = vi.fn(() => ({ set: mockDbUpdateSet }));

  // db.insert().values()
  const mockDbInsertValues = vi.fn();
  const mockDbInsert = vi.fn(() => ({ values: mockDbInsertValues }));

  const mockLogInfo = vi.fn();
  const mockLogError = vi.fn();

  return {
    mockListFiles, mockDeleteFiles, mockCollectReferenced,
    mockDbSelect, mockDbSelectFrom, mockDbSelectFromWhere, mockDbSelectFromWhereLimit,
    mockDbUpdate, mockDbUpdateSet, mockDbUpdateSetWhere,
    mockDbInsert, mockDbInsertValues,
    mockLogInfo, mockLogError,
  };
});

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../lib/uploadthing.js", () => ({
  utapi: { listFiles: mockListFiles, deleteFiles: mockDeleteFiles },
}));

vi.mock("../lib/collectReferencedUploadThingKeys.js", () => ({
  collectReferencedUploadThingKeys: mockCollectReferenced,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
  },
  platformSettingsTable: {
    key: "platform_settings.key",
    value: "platform_settings.value",
    id: "platform_settings.id",
  },
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "mock-generated-id"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: mockLogInfo,
    warn: vi.fn(),
    error: mockLogError,
    debug: vi.fn(),
  },
}));

// ── Import subject under test ─────────────────────────────────────────────────

import { runUploadThingOrphanCleanup } from "../lib/uploadthing-orphan-cleanup.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** 26 hours in ms — must match GRACE_MS in the implementation. */
const GRACE_MS = 26 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPage(keys: string[], hasMore = false) {
  return {
    files: keys.map((key) => ({ key, name: `${key}.jpg`, size: 1000 })),
    hasMore,
  };
}

/**
 * Sets up the db.select() chain so that:
 *   - First call (readStagedCandidates) returns the given staging JSON
 *   - Subsequent calls (writeStagedCandidates existence check) return []
 */
function mockStaging(staged: { key: string; stagedAt: number }[]) {
  const json = JSON.stringify(staged);
  // 1st select: readStagedCandidates → returns row with value
  mockDbSelectFromWhereLimit
    .mockResolvedValueOnce([{ value: json }])  // read staging
    .mockResolvedValueOnce([{ id: "existing-id" }]); // write existence check → update path
}

function mockStagingEmpty() {
  // 1st select: readStagedCandidates → no staging row
  mockDbSelectFromWhereLimit
    .mockResolvedValueOnce([])  // read staging → empty
    .mockResolvedValueOnce([]); // write existence check → insert path
}

// ── Shared beforeEach ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Use mockReset() — vi.clearAllMocks() does NOT flush mockResolvedValueOnce queues.
  mockListFiles.mockReset();
  mockDeleteFiles.mockReset();
  mockCollectReferenced.mockReset();
  mockDbSelect.mockReset();
  mockDbSelectFrom.mockReset();
  mockDbSelectFromWhere.mockReset();
  mockDbSelectFromWhereLimit.mockReset();
  mockDbUpdate.mockReset();
  mockDbUpdateSet.mockReset();
  mockDbUpdateSetWhere.mockReset();
  mockDbInsert.mockReset();
  mockDbInsertValues.mockReset();
  mockLogInfo.mockReset();
  mockLogError.mockReset();

  // Re-wire the db chain after reset
  mockDbSelect.mockReturnValue({ from: mockDbSelectFrom });
  mockDbSelectFrom.mockReturnValue({ where: mockDbSelectFromWhere, limit: mockDbSelectFromWhereLimit });
  mockDbSelectFromWhere.mockReturnValue({ limit: mockDbSelectFromWhereLimit });
  mockDbUpdate.mockReturnValue({ set: mockDbUpdateSet });
  mockDbUpdateSet.mockReturnValue({ where: mockDbUpdateSetWhere });
  mockDbInsert.mockReturnValue({ values: mockDbInsertValues });

  // Default: no referenced keys, delete and write succeed
  mockCollectReferenced.mockResolvedValue(new Set<string>());
  mockDeleteFiles.mockResolvedValue({ deletedCount: 0 });
  mockDbUpdateSetWhere.mockResolvedValue([]);
  mockDbInsertValues.mockResolvedValue([]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runUploadThingOrphanCleanup() — two-run staging design", () => {

  describe("Run N (first discovery — no prior staging)", () => {
    it("stages a newly discovered orphan and does NOT delete it", async () => {
      const NEW_KEY = "brand-new-orphan";
      mockStagingEmpty();
      mockListFiles.mockResolvedValueOnce(buildPage([NEW_KEY]));

      const result = await runUploadThingOrphanCleanup();

      expect(result.scanned).toBe(1);
      expect(result.newlyStaged).toBe(1);
      expect(result.deleted).toBe(0);
      expect(result.errors).toBe(0);
      expect(mockDeleteFiles).not.toHaveBeenCalled();

      // Staging was written
      expect(mockDbInsertValues).toHaveBeenCalledOnce();
      const written = JSON.parse(mockDbInsertValues.mock.calls[0][0].value);
      expect(written).toHaveLength(1);
      expect(written[0].key).toBe(NEW_KEY);
      expect(typeof written[0].stagedAt).toBe("number");
    });

    it("does not stage files already referenced in the DB", async () => {
      const REFERENCED_KEY = "db-referenced-key";
      mockCollectReferenced.mockResolvedValue(new Set([REFERENCED_KEY]));
      mockStagingEmpty();
      mockListFiles.mockResolvedValueOnce(buildPage([REFERENCED_KEY]));

      const result = await runUploadThingOrphanCleanup();

      expect(result.newlyStaged).toBe(0);
      expect(mockDeleteFiles).not.toHaveBeenCalled();
      // Staging written with empty array
      const written = JSON.parse(mockDbInsertValues.mock.calls[0][0].value);
      expect(written).toHaveLength(0);
    });
  });

  describe("Run N+1 (grace period has NOT elapsed)", () => {
    it("keeps a recently staged orphan in staging and does NOT delete it", async () => {
      const KEY = "recent-orphan";
      const recentStagedAt = Date.now() - 1000; // 1 second ago — well within grace
      mockStaging([{ key: KEY, stagedAt: recentStagedAt }]);
      mockListFiles.mockResolvedValueOnce(buildPage([KEY]));

      const result = await runUploadThingOrphanCleanup();

      expect(result.deleted).toBe(0);
      expect(result.newlyStaged).toBe(0);
      expect(mockDeleteFiles).not.toHaveBeenCalled();

      // Key must be retained in staging with original stagedAt
      const written = JSON.parse(mockDbUpdateSet.mock.calls[0][0].value);
      expect(written).toHaveLength(1);
      expect(written[0].key).toBe(KEY);
      expect(written[0].stagedAt).toBe(recentStagedAt);
    });
  });

  describe("Run N+1 (grace period HAS elapsed)", () => {
    it("deletes a confirmed orphan staged longer than the grace period", async () => {
      const KEY = "old-orphan";
      const oldStagedAt = Date.now() - GRACE_MS - 1000; // 1 second past grace
      mockStaging([{ key: KEY, stagedAt: oldStagedAt }]);
      mockListFiles.mockResolvedValueOnce(buildPage([KEY]));
      // Per-batch re-check: still an orphan
      mockCollectReferenced
        .mockResolvedValueOnce(new Set())   // initial collectReferencedUploadThingKeys
        .mockResolvedValueOnce(new Set());  // per-batch re-check
      mockDeleteFiles.mockResolvedValueOnce({ deletedCount: 1 });

      const result = await runUploadThingOrphanCleanup();

      expect(result.deleted).toBe(1);
      expect(result.errors).toBe(0);
      expect(mockDeleteFiles).toHaveBeenCalledWith([KEY]);

      // Deleted key removed from staging
      const written = JSON.parse(mockDbUpdateSet.mock.calls[0][0].value);
      expect(written.find((c: { key: string }) => c.key === KEY)).toBeUndefined();
    });

    it("rescues an old-staged file that was committed to DB since staging (per-batch re-check)", async () => {
      const KEY = "late-committed-key";
      const oldStagedAt = Date.now() - GRACE_MS - 5000;
      mockStaging([{ key: KEY, stagedAt: oldStagedAt }]);
      mockListFiles.mockResolvedValueOnce(buildPage([KEY]));

      // Initial scan: still looks like orphan
      // Per-batch re-check: now in DB (form submitted between runs)
      mockCollectReferenced
        .mockResolvedValueOnce(new Set())            // initial scan
        .mockResolvedValueOnce(new Set([KEY]));      // per-batch re-check → rescued

      const result = await runUploadThingOrphanCleanup();

      expect(result.deleted).toBe(0);
      expect(mockDeleteFiles).not.toHaveBeenCalled();
      // Rescued key should not be in staging either (it's now referenced)
      const written = JSON.parse(mockDbUpdateSet.mock.calls[0][0].value);
      expect(written.find((c: { key: string }) => c.key === KEY)).toBeUndefined();
    });

    it("skips a delete batch and increments errors when per-batch re-check fails", async () => {
      const KEY = "orphan-recheck-fail";
      const oldStagedAt = Date.now() - GRACE_MS - 1000;
      mockStaging([{ key: KEY, stagedAt: oldStagedAt }]);
      mockListFiles.mockResolvedValueOnce(buildPage([KEY]));

      mockCollectReferenced
        .mockResolvedValueOnce(new Set())                        // initial scan
        .mockRejectedValueOnce(new Error("DB unreachable"));    // per-batch re-check fails

      const result = await runUploadThingOrphanCleanup();

      expect(result.deleted).toBe(0);
      expect(result.errors).toBe(1);
      expect(mockDeleteFiles).not.toHaveBeenCalled();
      expect(mockLogError).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("Per-batch re-check failed"),
      );
    });
  });

  describe("Error handling and pagination", () => {
    it("handles pagination correctly — scans all pages", async () => {
      const KEY_A = "page1-key";
      const KEY_B = "page2-key";
      mockStagingEmpty();
      mockListFiles
        .mockResolvedValueOnce(buildPage([KEY_A], /* hasMore= */ true))
        .mockResolvedValueOnce(buildPage([KEY_B], /* hasMore= */ false));

      const result = await runUploadThingOrphanCleanup();

      expect(result.scanned).toBe(2);
      expect(result.newlyStaged).toBe(2);
      expect(mockListFiles).toHaveBeenCalledTimes(2);
      expect(mockListFiles).toHaveBeenNthCalledWith(1, { limit: 500, offset: 0 });
      expect(mockListFiles).toHaveBeenNthCalledWith(2, { limit: 500, offset: 500 });
    });

    it("aborts scan and stages any found candidates when listFiles throws mid-pagination", async () => {
      const KEY = "key-before-error";
      mockStagingEmpty();
      mockListFiles
        .mockResolvedValueOnce(buildPage([KEY], /* hasMore= */ true))
        .mockRejectedValueOnce(new Error("UploadThing API unreachable"));

      const result = await runUploadThingOrphanCleanup();

      expect(result.scanned).toBe(1);
      expect(result.newlyStaged).toBe(1);
      expect(mockDeleteFiles).not.toHaveBeenCalled();
      expect(mockLogError).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), offset: 500 }),
        expect.stringContaining("Failed to list files"),
      );
    });

    it("keeps keys in staging for retry when a deletion batch fails", async () => {
      const KEY = "delete-fail-key";
      const oldStagedAt = Date.now() - GRACE_MS - 1000;
      mockStaging([{ key: KEY, stagedAt: oldStagedAt }]);
      mockListFiles.mockResolvedValueOnce(buildPage([KEY]));
      mockCollectReferenced
        .mockResolvedValueOnce(new Set())
        .mockResolvedValueOnce(new Set());  // per-batch re-check
      mockDeleteFiles.mockRejectedValueOnce(new Error("UploadThing delete failed"));

      const result = await runUploadThingOrphanCleanup();

      expect(result.deleted).toBe(0);
      expect(result.errors).toBe(1);
      expect(mockLogError).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("Batch deletion failed"),
      );
      // Key should be retained in staging for retry
      const written = JSON.parse(mockDbUpdateSet.mock.calls[0][0].value);
      expect(written.find((c: { key: string }) => c.key === KEY)).toBeDefined();
    });

    it("never throws even when collectReferencedUploadThingKeys rejects", async () => {
      mockCollectReferenced.mockRejectedValueOnce(new Error("DB unreachable"));

      const result = await expect(runUploadThingOrphanCleanup()).resolves.not.toThrow();
      expect(result).toBeDefined();
    });

    it("returns { scanned:0, newlyStaged:0, deleted:0, errors:0 } when UploadThing is empty", async () => {
      mockStagingEmpty();
      mockListFiles.mockResolvedValueOnce({ files: [], hasMore: false });

      const result = await runUploadThingOrphanCleanup();

      expect(result).toEqual({ scanned: 0, newlyStaged: 0, deleted: 0, errors: 0 });
      expect(mockDeleteFiles).not.toHaveBeenCalled();
    });

    it("de-stages a key that is now referenced in the DB (form was submitted)", async () => {
      const KEY = "form-submitted-key";
      const oldStagedAt = Date.now() - 1000; // within grace, but now referenced
      mockCollectReferenced.mockResolvedValue(new Set([KEY])); // now in DB
      mockStaging([{ key: KEY, stagedAt: oldStagedAt }]);
      mockListFiles.mockResolvedValueOnce(buildPage([KEY]));

      const result = await runUploadThingOrphanCleanup();

      // KEY not in currentOrphanKeys (it's referenced), so it's de-staged
      expect(result.newlyStaged).toBe(0);
      expect(result.deleted).toBe(0);
      const written = JSON.parse(mockDbUpdateSet.mock.calls[0][0].value);
      expect(written.find((c: { key: string }) => c.key === KEY)).toBeUndefined();
    });
  });
});

import type { UTApi as UTApiType } from "uploadthing/server";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * UploadThing API wrapper.
 *
 * uploadthing@7.7.4 is pinned (exact, no ^). The SDK's Effect-Platform
 * FetchHttpClient adds a spurious `Range: bytes=0-` header on CDN PUT
 * requests, causing "Invalid signature" 400 errors.
 *
 * Fix lives in two places:
 *  1. lib/fetch-patch.ts — patches globalThis.fetch before ANY uploadthing module
 *     loads (imported first in index.ts). MUST stay as the first import.
 *  2. build.mjs — "uploadthing" is in the external list so it is loaded via
 *     Node's require() at runtime (after the patch), not bundled inside esbuild.
 *
 * BEFORE UPGRADING uploadthing:
 *   Verify that Effect-Platform's FetchHttpClient no longer adds the Range header.
 *   If fixed: remove fetch-patch.ts, remove the external
 *   entry in build.mjs, and remove the exact-version pin in package.json.
 */

// Dynamic require: uploadthing is external in esbuild (see build.mjs), loaded
// at runtime after lib/fetch-patch.ts has already patched globalThis.fetch.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UTApi } = require("uploadthing/server") as { UTApi: typeof UTApiType };

export const utapi = new UTApi();

const UPLOADTHING_HOSTNAME_SUFFIXES = ["utfs.io", "ufs.io", "ufs.sh", "uploadthing.com"];
const UPLOADTHING_PATH_PREFIX = "/f/";

export function extractVerifiedUploadThingKey(url: string): string | null {
  try {
    const u = new URL(url);
    const hostname = u.hostname.toLowerCase();
    const isKnownHost = UPLOADTHING_HOSTNAME_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
    );
    if (!isKnownHost) return null;
    if (!u.pathname.startsWith(UPLOADTHING_PATH_PREFIX)) return null;
    const key = u.pathname.slice(UPLOADTHING_PATH_PREFIX.length);
    return key || null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the given file key is currently referenced by another record.
 * By default only other-tenant references are considered. Callers that already
 * removed their own DB record can opt into checking same-tenant references too,
 * which prevents deleting a file shared by multiple records in that tenant.
 *
 * Checks scalar UploadThing URL columns and image-array columns across all
 * tenant-scoped tables that participate in deleteOrphanedFile / deleteOrphanedImages
 * deletion flows. Gallery / image-array columns are checked via unnest(). The
 * documents table is checked both by the indexed file_key column and by the url
 * column. store_products has no direct tenantId so it is resolved via a JOIN to
 * stores.
 */
async function isFileKeyStillReferenced(
  key: string,
  callerTenantId: string,
  includeSameTenantReferences = false,
): Promise<boolean> {
  const like = `%/f/${key}`;
  const tenantFilter = includeSameTenantReferences ? sql`` : sql`AND tenant_id != ${callerTenantId}`;
  const tenantIdFilter = includeSameTenantReferences ? sql`` : sql`AND id != ${callerTenantId}`;
  const storeTenantFilter = includeSameTenantReferences ? sql`` : sql`AND s.tenant_id != ${callerTenantId}`;
  const result = await db.execute(sql`
    SELECT EXISTS(
      SELECT 1 FROM tenants
        WHERE logo_url LIKE ${like} ${tenantIdFilter}
      UNION ALL
      SELECT 1 FROM stores
        WHERE (logo LIKE ${like} OR logo_dark LIKE ${like} OR favicon LIKE ${like}
               OR banner_home LIKE ${like} OR banner_mobile LIKE ${like})
          ${tenantFilter}
      UNION ALL
      SELECT 1 FROM trips
        WHERE (cover_image LIKE ${like}
               OR EXISTS (SELECT 1 FROM unnest(gallery) g WHERE g LIKE ${like}))
          ${tenantFilter}
      UNION ALL
      SELECT 1 FROM trip_media
        WHERE url LIKE ${like} ${tenantFilter}
      UNION ALL
      SELECT 1 FROM accommodations
        WHERE (cover_image LIKE ${like}
               OR EXISTS (SELECT 1 FROM unnest(gallery) g WHERE g LIKE ${like}))
          ${tenantFilter}
      UNION ALL
      SELECT 1 FROM destinations
        WHERE (cover_image LIKE ${like}
               OR EXISTS (SELECT 1 FROM unnest(gallery) g WHERE g LIKE ${like}))
          ${tenantFilter}
      UNION ALL
      SELECT 1 FROM vehicles
        WHERE photo_url LIKE ${like} ${tenantFilter}
      UNION ALL
      SELECT 1 FROM clients
        WHERE photo_url LIKE ${like} ${tenantFilter}
      UNION ALL
      SELECT 1 FROM users
        WHERE avatar_url LIKE ${like} ${tenantFilter}
      UNION ALL
      SELECT 1 FROM documents
        WHERE (file_key = ${key} OR url LIKE ${like})
          ${tenantFilter}
      UNION ALL
      SELECT 1 FROM store_products sp
        JOIN stores s ON s.id = sp.store_id
        WHERE (sp.thumbnail LIKE ${like}
               OR EXISTS (SELECT 1 FROM unnest(sp.images) img WHERE img LIKE ${like})
               OR EXISTS (SELECT 1 FROM unnest(sp.gallery) g WHERE g LIKE ${like}))
          ${storeTenantFilter}
    ) AS referenced
  `);
  // db.execute returns { rows: [...] } — read the first row from .rows
  const rows = (result as unknown as { rows: Array<{ referenced: boolean }> }).rows;
  return rows?.[0]?.referenced === true;
}

type Logger = { warn: (obj: object, msg: string) => void };
type DeleteOrphanedFileOptions = {
  checkSameTenantReferences?: boolean;
};

export async function deleteOrphanedFile(
  oldUrl: string | null | undefined,
  newUrl: string | null | undefined,
  log: Logger,
  callerTenantId?: string,
  options?: DeleteOrphanedFileOptions,
): Promise<void> {
  if (!oldUrl || oldUrl === newUrl) return;
  const key = extractVerifiedUploadThingKey(oldUrl);
  if (!key) {
    log.warn({ oldUrl }, "Skipped orphaned file deletion: URL did not match known UploadThing hosts");
    return;
  }
  if (callerTenantId) {
    try {
      const referenceRisk = await isFileKeyStillReferenced(
        key,
        callerTenantId,
        options?.checkSameTenantReferences,
      );
      if (referenceRisk) {
        log.warn(
          { fileKey: key, callerTenantId },
          options?.checkSameTenantReferences
            ? "Skipped file deletion: key is still referenced by another record"
            : "Skipped file deletion: key is referenced by another tenant",
        );
        return;
      }
    } catch (checkErr) {
      log.warn({ err: checkErr, fileKey: key }, "Cross-tenant ownership check failed; skipping file deletion as a precaution");
      return;
    }
  }
  try {
    await utapi.deleteFiles(key);
  } catch (err) {
    log.warn({ err, fileKey: key }, "Failed to delete orphaned file from UploadThing");
  }
}

export async function deleteOrphanedImages(
  oldImages: string[] | null | undefined,
  newImages: string[] | null | undefined,
  log: Logger,
  callerTenantId?: string
): Promise<void> {
  if (!oldImages || oldImages.length === 0) return;
  const newSet = new Set(newImages ?? []);
  const toDelete = oldImages.filter((url) => !newSet.has(url));
  for (const url of toDelete) {
    await deleteOrphanedFile(url, null, log, callerTenantId);
  }
}

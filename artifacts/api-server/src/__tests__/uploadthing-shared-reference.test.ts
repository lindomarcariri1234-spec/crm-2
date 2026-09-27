import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDbExecute } = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: mockDbExecute },
}));

import { deleteOrphanedFile, utapi } from "../lib/uploadthing.js";

const FILE_URL = "https://utfs.io/f/shared-file-key";
const TENANT_ID = "tenant-1";
const log = { warn: vi.fn() };

describe("deleteOrphanedFile shared-reference protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [{ referenced: false }] });
  });

  it("does not remove storage when a remaining same-tenant record references the file", async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ referenced: true }] });
    const deleteFiles = vi.spyOn(utapi, "deleteFiles").mockResolvedValue({} as never);

    await deleteOrphanedFile(
      FILE_URL,
      null,
      log,
      TENANT_ID,
      { checkSameTenantReferences: true },
    );

    expect(mockDbExecute).toHaveBeenCalledOnce();
    expect(JSON.stringify(mockDbExecute.mock.calls[0]?.[0])).toContain("trip_media");
    expect(deleteFiles).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      { fileKey: "shared-file-key", callerTenantId: TENANT_ID },
      "Skipped file deletion: key is still referenced by another record",
    );
  });

  it("removes storage when no remaining record references the file", async () => {
    const deleteFiles = vi.spyOn(utapi, "deleteFiles").mockResolvedValue({} as never);

    await deleteOrphanedFile(
      FILE_URL,
      null,
      log,
      TENANT_ID,
      { checkSameTenantReferences: true },
    );

    expect(deleteFiles).toHaveBeenCalledWith("shared-file-key");
  });

  it("does not log raw UploadThing deletion errors", async () => {
    const marker = "SYNTHETIC_UPLOADTHING_DELETE_SECRET_418";
    const providerError = Object.assign(new Error(`UploadThing failed: ${marker}`), {
      statusCode: 502,
      response: { data: { token: marker } },
    });
    vi.spyOn(utapi, "deleteFiles").mockRejectedValueOnce(providerError);

    await deleteOrphanedFile(FILE_URL, null, log);

    expect(log.warn).toHaveBeenCalledWith(
      { providerError: { kind: "Error", status: 502 }, fileKey: "shared-file-key" },
      "Failed to delete orphaned file from UploadThing",
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(marker);
  });
});
import { describe, expect, it } from "vitest";
import { parseBackupText, validateBackupDownload } from "./backup-file";

const canonical = {
  format: "visitecrm-agency-backup",
  version: 4,
  tenant: { id: "source", name: "Agência A" },
  data: {},
};

describe("backup file validation", () => {
  it("accepts a canonical backup with an UTF-8 BOM", () => {
    expect(parseBackupText(`\uFEFF${JSON.stringify(canonical)}`).tenant.id).toBe("source");
  });

  it("accepts the supported legacy flat envelope", () => {
    const legacy = { meta: { formatVersion: 6 }, tenant: { id: "source" }, users: [] };
    expect(parseBackupText(JSON.stringify(legacy)).tenant.id).toBe("source");
  });

  it.each([
    ["", "vazio"],
    ['{"format":"visitecrm-agency-backup"', "incompleto"],
    ["<!doctype html><html></html>", "página HTML"],
    [JSON.stringify({ ...canonical, version: 999 }), "não é compatível"],
    [JSON.stringify({ format: canonical.format, version: 4 }), "estrutura do backup"],
    [JSON.stringify({ ...canonical, tenant: { id: "source", email: 42 } }), "identidade"],
  ])("explains invalid input %#", (input, expectedMessage) => {
    expect(() => parseBackupText(input)).toThrow(expectedMessage);
  });

  it("does not approve a non-JSON response for download", async () => {
    await expect(
      validateBackupDownload(new Blob(["gateway error"]), "text/html"),
    ).rejects.toThrow("conteúdo inesperado");
  });
});
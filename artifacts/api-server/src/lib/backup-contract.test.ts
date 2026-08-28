import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupContractError,
  isSameLogicalAgency,
  normalizeBackupPayload,
} from "./backup-contract.js";

describe("backup contract", () => {
  it("keeps the canonical envelope unchanged", () => {
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      tenant: { id: "source", name: "Agência A" },
      data: { agencia: {}, usuarios: {} },
    };
    expect(normalizeBackupPayload(backup)).toEqual(backup);
  });

  it("normalizes the legacy flat envelope and embedded children", () => {
    const normalized = normalizeBackupPayload({
      meta: { formatVersion: 6, tenantName: "Agência A", tenantSlug: "agencia-a" },
      tenant: { id: "old-tenant", name: "Agência A", slug: "agencia-a" },
      clients: [{ id: "client-1", notes: [{ id: "note-1" }] }],
      trips: [{ id: "trip-1", media: [{ id: "media-1" }] }],
      reservations: [{ id: "reservation-1", passengers: [{ id: "passenger-1" }] }],
    });
    const data = normalized.data;
    expect(normalized).toMatchObject({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      tenant: { id: "old-tenant", slug: "agencia-a" },
    });
    expect((data.clientes as { notes: unknown[] }).notes).toEqual([
      { id: "note-1", clientId: "client-1" },
    ]);
    expect((data.viagens as { media: unknown[] }).media).toEqual([
      { id: "media-1", tripId: "trip-1" },
    ]);
    expect((data.reservas as { passengers: unknown[] }).passengers).toEqual([
      { id: "passenger-1", reservationId: "reservation-1" },
    ]);
  });

  it("rejects unknown and incompatible versions separately", () => {
    expect(() => normalizeBackupPayload({ hello: "world" })).toThrowError(
      expect.objectContaining<Partial<BackupContractError>>({ code: "BACKUP_IMPORT_UNKNOWN_FORMAT" }),
    );
    expect(() => normalizeBackupPayload({
      format: BACKUP_FORMAT,
      version: 999,
      tenant: { id: "source" },
      data: {},
    })).toThrowError(
      expect.objectContaining<Partial<BackupContractError>>({ code: "BACKUP_IMPORT_VERSION_MISMATCH" }),
    );
  });

  it("rejects malformed tenant identity fields before agency matching", () => {
    expect(() => normalizeBackupPayload({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      tenant: { id: "source", email: { malformed: true } },
      data: {},
    })).toThrowError(
      expect.objectContaining<Partial<BackupContractError>>({ code: "BACKUP_IMPORT_INVALID" }),
    );
  });

  it("recognizes the same agency across installations without trusting the internal id", () => {
    expect(isSameLogicalAgency(
      { id: "source-id", cnpj: "12.345.678/0001-90" },
      { id: "destination-id", cnpj: "12345678000190" },
    )).toBe(true);
    expect(isSameLogicalAgency(
      { id: "source-id", slug: "agencia-a" },
      { id: "destination-id", slug: "agencia-a" },
    )).toBe(true);
    expect(isSameLogicalAgency(
      { id: "source-id", slug: "agencia-a" },
      { id: "destination-id", slug: "agencia-b" },
    )).toBe(false);
  });
});
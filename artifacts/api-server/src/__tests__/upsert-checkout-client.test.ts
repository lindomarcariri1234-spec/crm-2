import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// upsertCheckoutClient tests
//
// Covers the four key behaviours of the checkout client upsert:
//   1. New client (email not found) → inserted, isNew=true
//   2. Existing client with birthDate=null → NULL filled from order args
//   3. Existing client with birthDate already set → NOT overwritten
//   4. Existing client with cpf=null, no owner → CPF filled from order args
//   5. Existing client with cpf=null, but another client owns it → NOT assigned
//   6. New client whose CPF is already taken → inserted WITHOUT cpf
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  clientsTable: {
    id: "id",
    cpf: "cpf",
    birthDate: "birth_date",
    tenantId: "tenant_id",
    email: "email",
    name: "name",
    whatsapp: "whatsapp",
    createdById: "created_by_id",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ type: "eq", col, val })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  sql: vi.fn(() => "sql"),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "new-client-id"),
  generateReferralCode: vi.fn(),
}));

import { upsertCheckoutClient } from "../services/checkout/checkout-user.js";
import type { Tx } from "../services/checkout/tx.js";

// ---------------------------------------------------------------------------
// Mock tx factory
// ---------------------------------------------------------------------------

function makeMockTx(selectQueue: object[][]) {
  const queue = [...selectQueue];

  const mockLimitFn = vi.fn().mockImplementation(() => {
    return Promise.resolve(queue.shift() ?? []);
  });
  const mockWhereFn = vi.fn().mockReturnValue({ limit: mockLimitFn });
  const mockFromFn = vi.fn().mockReturnValue({ where: mockWhereFn });
  const mockSelectFn = vi.fn().mockReturnValue({ from: mockFromFn });

  const mockUpdateWhereFn = vi.fn().mockResolvedValue([]);
  const mockSetFn = vi.fn().mockReturnValue({ where: mockUpdateWhereFn });
  const mockUpdateFn = vi.fn().mockReturnValue({ set: mockSetFn });

  const mockInsertValuesFn = vi.fn().mockResolvedValue([]);
  const mockInsertFn = vi.fn().mockReturnValue({ values: mockInsertValuesFn });

  const tx = {
    select: mockSelectFn,
    update: mockUpdateFn,
    insert: mockInsertFn,
  } as unknown as Tx;

  const spies = {
    select: mockSelectFn,
    update: mockUpdateFn,
    insert: mockInsertFn,
    insertValues: mockInsertValuesFn,
    updateSet: mockSetFn,
    updateWhere: mockUpdateWhereFn,
  };

  return { tx, spies };
}

const BASE_ARGS = {
  tenantId: "tenant-001",
  email: "cliente@example.com",
  name: "Maria Silva",
  phone: "+55 11 99999-1234",
  createdById: "user-001",
  cpf: "123.456.789-00",
  birthDate: new Date("1990-05-15T12:00:00Z"),
};

describe("upsertCheckoutClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new client when the email is not found in the tenant", async () => {
    // No existing client by email, no CPF match either, no CPF collision
    const { tx, spies } = makeMockTx([
      [], // existing client lookup by email → none found
      [], // CPF fallback lookup → none found
      [], // WhatsApp fallback lookup → none found
      [], // CPF uniqueness check → not taken
    ]);

    const result = await upsertCheckoutClient(tx, BASE_ARGS);

    expect(result.isNew).toBe(true);
    expect(result.clientId).toBe("new-client-id");

    expect(spies.insert).toHaveBeenCalledTimes(1);
    expect(spies.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "new-client-id",
        tenantId: BASE_ARGS.tenantId,
        email: BASE_ARGS.email,
        name: BASE_ARGS.name,
        createdById: BASE_ARGS.createdById,
        cpf: BASE_ARGS.cpf,
        birthDate: BASE_ARGS.birthDate,
      }),
    );
    expect(spies.update).not.toHaveBeenCalled();
  });

  it("returns existing client found by CPF when email does not match and enriches empty email", async () => {
    const { tx, spies } = makeMockTx([
      [], // email lookup → none found
      [{ id: "cpf-client-id", email: "", cpf: BASE_ARGS.cpf, birthDate: null }], // CPF fallback → found
    ]);

    const result = await upsertCheckoutClient(tx, BASE_ARGS);

    expect(result.isNew).toBe(false);
    expect(result.clientId).toBe("cpf-client-id");

    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ email: BASE_ARGS.email, birthDate: BASE_ARGS.birthDate }),
    );
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it("returns isNew=false and enriches birthDate when the existing client has birthDate=null", async () => {
    const existingClient = { id: "existing-001", email: BASE_ARGS.email, cpf: null, birthDate: null };
    const { tx, spies } = makeMockTx([
      [existingClient], // existing client lookup → found
    ]);

    const result = await upsertCheckoutClient(tx, BASE_ARGS);

    expect(result.isNew).toBe(false);
    expect(result.clientId).toBe("existing-001");

    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ birthDate: BASE_ARGS.birthDate }),
    );
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it("reuses an existing client when only the normalized WhatsApp matches", async () => {
    const { tx, spies } = makeMockTx([
      [], // email lookup → no match
      [{ id: "phone-client-id", email: "old@example.com", cpf: null, birthDate: null, whatsapp: "5511999991234" }],
    ]);

    const result = await upsertCheckoutClient(tx, {
      ...BASE_ARGS,
      email: "new@example.com",
      cpf: undefined,
      phone: "(11) 99999-1234",
    });

    expect(result).toEqual({ clientId: "phone-client-id", isNew: false });
    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.updateSet).toHaveBeenCalledWith({
      birthDate: BASE_ARGS.birthDate,
    });
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it("does NOT overwrite an already-set birthDate on an existing client", async () => {
    const existingClient = {
      id: "existing-002",
      email: BASE_ARGS.email,
      cpf: null,
      birthDate: new Date("1985-03-20T12:00:00Z"),
    };
    const { tx, spies } = makeMockTx([
      [existingClient], // existing client lookup → found, no cpf → triggers CPF check
      [], // CPF uniqueness check → not taken
    ]);

    const result = await upsertCheckoutClient(tx, BASE_ARGS);

    expect(result.isNew).toBe(false);
    expect(result.clientId).toBe("existing-002");

    if (spies.update.mock.calls.length > 0) {
      const setArgs = spies.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(setArgs).not.toHaveProperty("birthDate");
    }
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it("enriches CPF on an existing client when the CPF slot is null and no other owner exists", async () => {
    const existingClient = { id: "existing-003", email: BASE_ARGS.email, cpf: null, birthDate: new Date("1990-01-01T00:00:00Z") };
    const { tx, spies } = makeMockTx([
      [existingClient], // existing client lookup
      [], // CPF uniqueness check → not taken
    ]);

    const result = await upsertCheckoutClient(tx, BASE_ARGS);

    expect(result.isNew).toBe(false);
    expect(result.clientId).toBe("existing-003");

    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ cpf: BASE_ARGS.cpf }),
    );
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it("does NOT assign CPF when another client in the tenant already owns it", async () => {
    const existingClient = { id: "existing-004", email: BASE_ARGS.email, cpf: null, birthDate: null };
    const { tx, spies } = makeMockTx([
      [existingClient], // existing client lookup
      [{ id: "other-owner-id" }], // CPF uniqueness check → owned by someone else
    ]);

    const result = await upsertCheckoutClient(tx, BASE_ARGS);

    expect(result.isNew).toBe(false);
    expect(result.clientId).toBe("existing-004");

    expect(spies.update).toHaveBeenCalledTimes(1);
    const setArgs = spies.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs).not.toHaveProperty("cpf");
  });

  it("performs no DB update when existing client already has both birthDate and CPF set", async () => {
    const existingClient = {
      id: "existing-005",
      email: BASE_ARGS.email,
      cpf: "999.888.777-66",
      birthDate: new Date("1988-12-01T00:00:00Z"),
    };
    const { tx, spies } = makeMockTx([[existingClient]]);

    const result = await upsertCheckoutClient(tx, BASE_ARGS);

    expect(result.isNew).toBe(false);
    expect(result.clientId).toBe("existing-005");
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });
});

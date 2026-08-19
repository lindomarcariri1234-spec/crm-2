import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  db: {
    transaction: vi.fn(),
  },
  clientsTable: {
    id: "id",
    tenantId: "tenant_id",
    referralCode: "referral_code",
    referralCodeGeneratedAt: "referral_code_generated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}));

vi.mock("../lib/errors.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = "AppError";
      this.statusCode = statusCode;
    }
  },
  ConflictError: class ConflictError extends Error {
    statusCode: number;
    constructor(message: string) {
      super(message);
      this.name = "ConflictError";
      this.statusCode = 409;
    }
  },
}));

import { db } from "@workspace/db";
import { generateAndAssignReferralCode } from "../lib/referral-code.js";

const BASE = "JOAO2026";
const NAME = "JOAO";
const YEAR = 2026;
const CLIENT_ID = "client-1";
const TENANT_ID = "tenant-1";

const pgUniqueViolation = () => Object.assign(new Error("duplicate key value"), { code: "23505" });
const pgSerializationFailure = () => Object.assign(new Error("could not serialize"), { code: "40001" });

function makeSelectChain(rows: object[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

function makeTx(opts: {
  existingCode?: string | null;
  candidateTaken?: boolean;
}) {
  let selectCall = 0;
  return {
    select: vi.fn(() => {
      const n = selectCall++;
      if (n === 0) {
        return makeSelectChain(
          opts.existingCode
            ? [{ id: CLIENT_ID, referralCode: opts.existingCode }]
            : [],
        );
      }
      return makeSelectChain(opts.candidateTaken ? [{ id: "other-client" }] : []);
    }),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };
}

function callbackTransaction(tx: ReturnType<typeof makeTx>) {
  return (db.transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
    async (cb: (tx: object) => Promise<string>) => cb(tx),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("generateAndAssignReferralCode — callback logic", () => {
  it("assigns and returns the base code when no conflict exists", async () => {
    const tx = makeTx({ existingCode: null, candidateTaken: false });
    callbackTransaction(tx);

    const result = await generateAndAssignReferralCode(CLIENT_ID, TENANT_ID, BASE, NAME, YEAR);

    expect(result).toBe(BASE);
    expect(tx.select).toHaveBeenCalledTimes(2);
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it("returns the existing code without updating when refetch finds one (concurrent assignment)", async () => {
    const tx = makeTx({ existingCode: "JOAO2026" });
    callbackTransaction(tx);

    const result = await generateAndAssignReferralCode(CLIENT_ID, TENANT_ID, BASE, NAME, YEAR);

    expect(result).toBe("JOAO2026");
    expect(tx.update).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("retries with a suffixed candidate when base code is taken by another client", async () => {
    const tx1 = makeTx({ existingCode: null, candidateTaken: true });
    const tx2 = makeTx({ existingCode: null, candidateTaken: false });
    callbackTransaction(tx1);
    callbackTransaction(tx2);

    const result = await generateAndAssignReferralCode(CLIENT_ID, TENANT_ID, BASE, NAME, YEAR);

    // Fallback candidates now carry a high-entropy random suffix instead of a
    // predictable numeric index, so we assert the format rather than an exact value.
    expect(result).toMatch(/^JOAO2026[0-9A-Z]{8}$/);
    expect(result).not.toBe(BASE);
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(tx1.update).not.toHaveBeenCalled();
    expect(tx2.update).toHaveBeenCalledTimes(1);
  });

  it("passes isolationLevel serializable to every transaction attempt", async () => {
    const tx1 = makeTx({ existingCode: null, candidateTaken: true });
    const tx2 = makeTx({ existingCode: null, candidateTaken: false });
    callbackTransaction(tx1);
    callbackTransaction(tx2);

    await generateAndAssignReferralCode(CLIENT_ID, TENANT_ID, BASE, NAME, YEAR);

    for (const call of (db.transaction as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toEqual({ isolationLevel: "serializable" });
    }
  });
});

describe("generateAndAssignReferralCode — retry loop", () => {
  it("retries and succeeds on PostgreSQL unique violation (23505)", async () => {
    (db.transaction as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(pgUniqueViolation())
      .mockImplementationOnce(async (cb: (tx: object) => Promise<string>) =>
        cb(makeTx({ existingCode: null, candidateTaken: false })),
      );

    const result = await generateAndAssignReferralCode(CLIENT_ID, TENANT_ID, BASE, NAME, YEAR);

    // Fallback candidate uses a high-entropy random suffix (not a numeric index).
    expect(result).toMatch(/^JOAO2026[0-9A-Z]{8}$/);
    expect(result).not.toBe(BASE);
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });

  it("retries the same candidate on PostgreSQL serialization failure (40001)", async () => {
    (db.transaction as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(pgSerializationFailure())
      .mockImplementationOnce(async (cb: (tx: object) => Promise<string>) =>
        cb(makeTx({ existingCode: null, candidateTaken: false })),
      );

    const result = await generateAndAssignReferralCode(CLIENT_ID, TENANT_ID, BASE, NAME, YEAR);

    expect(result).toBe(BASE);
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });

  it("throws ConflictError(409) after exhausting all 5 attempts", async () => {
    (db.transaction as ReturnType<typeof vi.fn>).mockRejectedValue(pgUniqueViolation());

    await expect(
      generateAndAssignReferralCode(CLIENT_ID, TENANT_ID, BASE, NAME, YEAR),
    ).rejects.toMatchObject({ name: "ConflictError", statusCode: 409 });

    expect(db.transaction).toHaveBeenCalledTimes(5);
  });

  it("does not swallow unrelated errors and stops immediately", async () => {
    const unexpected = new Error("unexpected connection failure");
    (db.transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(unexpected);

    await expect(
      generateAndAssignReferralCode(CLIENT_ID, TENANT_ID, BASE, NAME, YEAR),
    ).rejects.toThrow("unexpected connection failure");

    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});

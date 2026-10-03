import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  sendEmail: vi.fn(),
  poolQuery: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mocks.poolQuery },
}));
vi.mock("@workspace/db/financial-category-integrity", () => ({
  verifyFinancialCategoryIntegrity: mocks.verify,
}));
vi.mock("@workspace/email", () => ({
  sendFinancialCategoryIntegrityAlertEmail: mocks.sendEmail,
}));
vi.mock("../lib/id", () => ({
  generateId: () => "integrity-alert-id",
}));
vi.mock("../lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn },
}));

import {
  runFinancialCategoryIntegrityCheck,
  type FinancialCategoryIntegrityCheckDependencies,
} from "../lib/financial-category-integrity";

const passingResult = {
  migrationStatus: "applied" as const,
  totals: {
    expenses: 0,
    trip_costs: 0,
    fixed_costs: 0,
    variable_costs: 0,
  },
  needsAlert: false,
};

const failingResult = {
  migrationStatus: "missing" as const,
  totals: {
    expenses: 1,
    trip_costs: 2,
    fixed_costs: 3,
    variable_costs: 4,
  },
  needsAlert: true,
};

function dependencies(
  overrides: Partial<FinancialCategoryIntegrityCheckDependencies> = {},
): FinancialCategoryIntegrityCheckDependencies {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ key: "claimed" }] }),
    releaseId: "release-abc123",
    recipient: "ops@example.com",
    log: {
      info: mocks.info,
      warn: mocks.warn,
    } as unknown as FinancialCategoryIntegrityCheckDependencies["log"],
    ...overrides,
  };
}

describe("runFinancialCategoryIntegrityCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue(passingResult);
    mocks.sendEmail.mockResolvedValue({ success: true });
  });

  it("does not send when the migration and category totals pass", async () => {
    const deps = dependencies();

    await runFinancialCategoryIntegrityCheck(deps);

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(deps.query).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(
      { migrationStatus: "applied", totals: passingResult.totals },
      "[financial-category-integrity] PASS",
    );
  });

  it("sends only the migration status and the four aggregate totals", async () => {
    mocks.verify.mockResolvedValue(failingResult);
    const query = vi.fn().mockResolvedValue({ rows: [{ key: "claimed" }] });

    await runFinancialCategoryIntegrityCheck(dependencies({ query }));

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "ops@example.com",
      migrationStatus: "missing",
      totals: failingResult.totals,
    });
    const claimCall = query.mock.calls.find(([statement]) =>
      String(statement).includes("INSERT INTO public.platform_settings"),
    );
    expect(claimCall?.[1]?.[1]).toBe(
      "financial_category_integrity_release:release-abc123",
    );
  });

  it("uses the atomic release claim to suppress concurrent duplicate alerts", async () => {
    mocks.verify.mockResolvedValue(failingResult);
    const claimedKeys = new Set<string>();
    const query = vi.fn(async (statement: string, values?: readonly unknown[]) => {
      if (!statement.includes("INSERT INTO public.platform_settings")) {
        return { rows: [] };
      }
      const key = String(values?.[1]);
      if (claimedKeys.has(key)) return { rows: [] };
      claimedKeys.add(key);
      return { rows: [{ key }] };
    });

    await Promise.all([
      runFinancialCategoryIntegrityCheck(dependencies({ query })),
      runFinancialCategoryIntegrityCheck(dependencies({ query })),
    ]);

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("contains provider failures and does not log provider error details", async () => {
    mocks.verify.mockResolvedValue(failingResult);
    const providerSecret = "provider response details";
    const log = { info: vi.fn(), warn: vi.fn() };

    const result = await runFinancialCategoryIntegrityCheck(
      dependencies({
        sendEmail: vi.fn().mockRejectedValue(new Error(providerSecret)),
        log: log as unknown as FinancialCategoryIntegrityCheckDependencies["log"],
      }),
    );

    expect(result).toEqual(failingResult);
    expect(JSON.stringify(log)).not.toContain(providerSecret);
  });

  it("contains a stalled provider send within the configured timeout", async () => {
    mocks.verify.mockResolvedValue(failingResult);
    const log = { info: vi.fn(), warn: vi.fn() };

    const result = await runFinancialCategoryIntegrityCheck(
      dependencies({
        sendEmail: vi.fn(
          () => new Promise<{ success: boolean }>(() => undefined),
        ),
        sendTimeoutMs: 5,
        log: log as unknown as FinancialCategoryIntegrityCheckDependencies["log"],
      }),
    );

    expect(result).toEqual(failingResult);
    expect(log.warn).toHaveBeenCalledWith(
      { migrationStatus: "missing", totals: failingResult.totals },
      "[financial-category-integrity] Alert send failed or timed out; continuing",
    );
  });
});
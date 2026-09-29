import { describe, expect, it, vi } from "vitest";
import { recomputeClientClassification, resolveClassification, validateClientClassificationSettings } from "./client-classification";

describe("client classification precedence", () => {
  it("uses VIP, client, prospect, lead, then new in order", () => {
    expect(resolveClassification(true, true, true, true)).toBe("vip");
    expect(resolveClassification(true, true, true, false)).toBe("client");
    expect(resolveClassification(true, true, false, false)).toBe("prospect");
    expect(resolveClassification(true, false, false, false)).toBe("lead");
    expect(resolveClassification(false, false, false, false)).toBe("new");
  });

  it("does not downgrade a paid client because a qualified signal is absent", () => {
    expect(resolveClassification(true, false, true, false)).toBe("client");
  });
});

describe("client classification settings", () => {
  it("uses validated defaults for omitted agency settings", () => {
    expect(validateClientClassificationSettings(undefined)).toEqual({
      currency: "BRL",
      vipSpendThreshold: 3000,
      vipCompletedTripsThreshold: 5,
      periodType: "rolling",
      periodMonths: 12,
    });
  });

  it("rejects invalid VIP thresholds", () => {
    expect(() => validateClientClassificationSettings({
      currency: "BRL",
      vipSpendThreshold: -1,
      vipCompletedTripsThreshold: 5,
      periodType: "rolling",
      periodMonths: 12,
    })).toThrow(/vipSpendThreshold/);
  });
});

describe("client classification dry run", () => {
  it("previews a promotion and first-paid date without writing", async () => {
    const firstPaidAt = new Date("2025-02-03T12:00:00.000Z");
    let selectCall = 0;
    const select = vi.fn(() => {
      const current = selectCall++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(
              current === 0 ? [] : [{ classification: "new", firstPaidAt: null }],
            ),
          })),
        })),
      };
    });
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ amount: "0" }] })
      .mockResolvedValueOnce({ rows: [{ first_paid_at: firstPaidAt }] })
      .mockResolvedValueOnce({ rows: [{ count: 1, qualified_count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });
    const update = vi.fn();
    const insert = vi.fn();
    const executor = { select, execute, update, insert } as never;

    const result = await recomputeClientClassification({
      tenantId: "tenant-a",
      clientId: "client-a",
      trigger: "classification_backfill",
      dryRun: true,
      occurredAt: new Date("2025-03-01T00:00:00.000Z"),
    }, executor);

    expect(result).toMatchObject({
      classification: "lead",
      currentClassification: "new",
      classificationChanged: true,
      firstPaidAt,
      firstPaidAtChanged: true,
    });
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(5);
  });
});
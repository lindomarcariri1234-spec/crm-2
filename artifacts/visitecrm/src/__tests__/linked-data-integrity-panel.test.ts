import { describe, expect, it } from "vitest";
import { groupReconciliationIssues } from "../components/linked-data-integrity-panel";

describe("LinkedDataIntegrityPanel issue grouping", () => {
  it("keeps every issue in its relationship category", () => {
    const grouped = groupReconciliationIssues([
      { type: "deal-reservation", id: "deal-1", reason: "client_trip_or_value_mismatch" },
      { type: "deal-reservation", id: "deal-2", reason: "reservation_missing_in_tenant" },
      { type: "referral-reservation", id: "referral-1", reason: "ambiguous_order_candidates" },
    ]);

    expect(grouped["deal-reservation"]).toHaveLength(2);
    expect(grouped["referral-reservation"]).toEqual([
      { type: "referral-reservation", id: "referral-1", reason: "ambiguous_order_candidates" },
    ]);
  });

  it("returns an empty category map for a clean dry run", () => {
    expect(groupReconciliationIssues([])).toEqual({});
  });
});

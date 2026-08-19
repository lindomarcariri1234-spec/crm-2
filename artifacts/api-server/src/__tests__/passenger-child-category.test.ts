/**
 * Tests for the isChildUnder7 → ageCategory synchronization logic.
 *
 * Covers the three key product rules:
 *  1. resolveChildAgeCategory (pure helper used by POST and PATCH handlers)
 *  2. POST reservation: isOnLap / isChildUnder7 → correct initial ageCategory
 *  3. PATCH passenger:  flag wins and both fields are updated atomically
 */

import { describe, it, expect } from "vitest";
import { resolveChildAgeCategory, deriveAgeCategory } from "../lib/passenger.js";

// ─── resolveChildAgeCategory ─────────────────────────────────────────────────

describe("resolveChildAgeCategory", () => {
  it("returns 'child' when the passenger has a seat number (Criança com poltrona)", () => {
    expect(resolveChildAgeCategory("5")).toBe("child");
    expect(resolveChildAgeCategory("1")).toBe("child");
  });

  it("returns 'baby' when seatNumber is null (Bebê de colo — sem poltrona)", () => {
    expect(resolveChildAgeCategory(null)).toBe("baby");
  });

  it("returns 'baby' for an empty string seat (treated as no seat)", () => {
    expect(resolveChildAgeCategory("")).toBe("baby");
  });
});

// ─── POST reservation ageCategory derivation logic ───────────────────────────
// Replicate the in-handler derivation inline so these run without a DB mock.

function derivePostAgeCategory(opts: {
  isOnLap?: boolean;
  isChildUnder7?: boolean;
  birthDate: Date | null;
}): string {
  const { isOnLap, isChildUnder7, birthDate } = opts;
  if (isOnLap) return "baby";
  if (isChildUnder7) return resolveChildAgeCategory("1"); // any non-null seat
  return deriveAgeCategory(birthDate);
}

function derivePostIsChildUnder7(opts: {
  isOnLap?: boolean;
  isChildUnder7?: boolean;
  birthDate: Date | null;
}): boolean {
  const { isOnLap, isChildUnder7, birthDate } = opts;
  if (isOnLap) return true;
  if (isChildUnder7 !== undefined) return isChildUnder7;
  // Fall back to birth-date age check
  if (!birthDate) return false;
  const age = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return age < 7;
}

describe("POST reservation — ageCategory derivation", () => {
  it("sets ageCategory='baby' and isChildUnder7=true when isOnLap=true", () => {
    expect(derivePostAgeCategory({ isOnLap: true, birthDate: null })).toBe("baby");
    expect(derivePostIsChildUnder7({ isOnLap: true, birthDate: null })).toBe(true);
  });

  it("sets ageCategory='child' when isChildUnder7=true and NOT on lap (Criança com poltrona)", () => {
    expect(derivePostAgeCategory({ isChildUnder7: true, birthDate: null })).toBe("child");
    expect(derivePostIsChildUnder7({ isChildUnder7: true, birthDate: null })).toBe(true);
  });

  it("falls back to birth-date derivation when neither flag is set", () => {
    const adult = new Date();
    adult.setFullYear(adult.getFullYear() - 30);
    expect(derivePostAgeCategory({ birthDate: adult })).toBe("adult");

    const child = new Date();
    child.setFullYear(child.getFullYear() - 5);
    expect(derivePostAgeCategory({ birthDate: child })).toBe("child");
  });

  it("isChildUnder7 flag wins over birth-date when explicitly set to false", () => {
    const youngChild = new Date();
    youngChild.setFullYear(youngChild.getFullYear() - 4);
    // birth date says child, but flag says false — should not force "child"
    expect(derivePostIsChildUnder7({ isChildUnder7: false, birthDate: youngChild })).toBe(false);
  });
});

// ─── syncIsChildUnder7 ───────────────────────────────────────────────────────

import { syncIsChildUnder7 } from "../lib/passenger.js";

describe("syncIsChildUnder7", () => {
  it("returns true for 'child'", () => expect(syncIsChildUnder7("child")).toBe(true));
  it("returns true for 'baby'",  () => expect(syncIsChildUnder7("baby")).toBe(true));
  it("returns false for 'adult'",  () => expect(syncIsChildUnder7("adult")).toBe(false));
  it("returns false for 'senior'", () => expect(syncIsChildUnder7("senior")).toBe(false));
  it("returns false for 'pcd'",    () => expect(syncIsChildUnder7("pcd")).toBe(false));
});

// ─── PATCH passenger — atomicity rule ────────────────────────────────────────
// Mirrors the PATCH handler's priority logic as a pure function so we can
// cover all input combinations without a DB mock.

function applyPatchCategoryLogic(opts: {
  isChildUnder7?: boolean;
  ageCategory?: string | null;
  existingSeatNumber: string | null;
  incomingSeatNumber?: string | null; // undefined = not sent in PATCH body
}): { ageCategory: string; isChildUnder7: boolean } | null {
  const { isChildUnder7, ageCategory, existingSeatNumber, incomingSeatNumber } = opts;

  if (isChildUnder7 !== undefined) {
    if (isChildUnder7) {
      const effectiveSeat = incomingSeatNumber !== undefined ? (incomingSeatNumber ?? null) : existingSeatNumber;
      const resolvedCat = resolveChildAgeCategory(effectiveSeat);
      return { ageCategory: resolvedCat, isChildUnder7: true };
    } else {
      // Flag cleared — ageCategory resets to caller-supplied or adult default
      const clearedCat = ageCategory ?? "adult";
      return { ageCategory: clearedCat, isChildUnder7: syncIsChildUnder7(clearedCat) };
    }
  }

  if (ageCategory != null) {
    // ageCategory-only path: derive isChildUnder7 atomically
    return { ageCategory, isChildUnder7: syncIsChildUnder7(ageCategory) };
  }

  return null; // nothing to update
}

describe("PATCH passenger — isChildUnder7 atomicity", () => {
  it("sets ageCategory='child' and isChildUnder7=true for a seated child (flag sent alone)", () => {
    const result = applyPatchCategoryLogic({ isChildUnder7: true, existingSeatNumber: "3" });
    expect(result?.ageCategory).toBe("child");
    expect(result?.isChildUnder7).toBe(true);
  });

  it("sets ageCategory='baby' and isChildUnder7=true when current seat is null (on-lap)", () => {
    const result = applyPatchCategoryLogic({ isChildUnder7: true, existingSeatNumber: null });
    expect(result?.ageCategory).toBe("baby");
    expect(result?.isChildUnder7).toBe(true);
  });

  it("uses incoming seatNumber over existing when both are present", () => {
    const result = applyPatchCategoryLogic({
      isChildUnder7: true,
      existingSeatNumber: "5",
      incomingSeatNumber: null, // moving to on-lap
    });
    expect(result?.ageCategory).toBe("baby");
    expect(result?.isChildUnder7).toBe(true);
  });

  it("resets ageCategory to 'adult' and isChildUnder7=false when flag is cleared without explicit category", () => {
    const result = applyPatchCategoryLogic({ isChildUnder7: false, existingSeatNumber: "3" });
    expect(result?.ageCategory).toBe("adult");
    expect(result?.isChildUnder7).toBe(false);
  });

  it("uses caller-supplied ageCategory when isChildUnder7 is cleared with one", () => {
    const result = applyPatchCategoryLogic({ isChildUnder7: false, ageCategory: "senior", existingSeatNumber: "3" });
    expect(result?.ageCategory).toBe("senior");
    expect(result?.isChildUnder7).toBe(false);
  });

  it("flag=true overrides a conflicting caller-supplied ageCategory='adult'", () => {
    const result = applyPatchCategoryLogic({ isChildUnder7: true, ageCategory: "adult", existingSeatNumber: "7" });
    // Flag wins — must be "child", not "adult"
    expect(result?.ageCategory).toBe("child");
    expect(result?.isChildUnder7).toBe(true);
  });

  // ── inverse (ageCategory-only) PATCH cases ────────────────────────────────

  it("ageCategory-only PATCH to 'child' also sets isChildUnder7=true (no flag sent)", () => {
    const result = applyPatchCategoryLogic({ ageCategory: "child", existingSeatNumber: null });
    expect(result?.ageCategory).toBe("child");
    expect(result?.isChildUnder7).toBe(true);
  });

  it("ageCategory-only PATCH to 'baby' also sets isChildUnder7=true", () => {
    const result = applyPatchCategoryLogic({ ageCategory: "baby", existingSeatNumber: "2" });
    expect(result?.ageCategory).toBe("baby");
    expect(result?.isChildUnder7).toBe(true);
  });

  it("ageCategory-only PATCH to 'adult' also sets isChildUnder7=false (clears prior child flag)", () => {
    const result = applyPatchCategoryLogic({ ageCategory: "adult", existingSeatNumber: "5" });
    expect(result?.ageCategory).toBe("adult");
    expect(result?.isChildUnder7).toBe(false);
  });

  it("ageCategory-only PATCH to 'senior' also sets isChildUnder7=false", () => {
    const result = applyPatchCategoryLogic({ ageCategory: "senior", existingSeatNumber: null });
    expect(result?.ageCategory).toBe("senior");
    expect(result?.isChildUnder7).toBe(false);
  });
});

// ─── POST passenger — creation normalization ──────────────────────────────────
// Mirrors the POST /passengers handler logic as a pure function.

function applyPostCategoryLogic(opts: {
  isChildUnder7?: boolean;
  ageCategory: string;
  seatNumber?: string | null;
}): { ageCategory: string; isChildUnder7: boolean } {
  const { isChildUnder7, ageCategory, seatNumber } = opts;
  const resolvedCat = isChildUnder7 === true
    ? resolveChildAgeCategory(seatNumber ?? null)
    : ageCategory;
  return { ageCategory: resolvedCat, isChildUnder7: syncIsChildUnder7(resolvedCat) };
}

describe("POST passenger — creation normalization", () => {
  it("isChildUnder7=true + seat → ageCategory='child', isChildUnder7=true", () => {
    const r = applyPostCategoryLogic({ isChildUnder7: true, ageCategory: "adult", seatNumber: "3" });
    expect(r.ageCategory).toBe("child");
    expect(r.isChildUnder7).toBe(true);
  });

  it("isChildUnder7=true + no seat → ageCategory='baby', isChildUnder7=true", () => {
    const r = applyPostCategoryLogic({ isChildUnder7: true, ageCategory: "adult", seatNumber: null });
    expect(r.ageCategory).toBe("baby");
    expect(r.isChildUnder7).toBe(true);
  });

  it("isChildUnder7=false + ageCategory='child' → category kept, isChildUnder7=true (DOB-derived 'child')", () => {
    // A 10-year-old: birth-date derives ageCategory="child" but explicit flag=false shouldn't
    // silently set isChildUnder7=true *and* keep false. We normalise from the category.
    const r = applyPostCategoryLogic({ isChildUnder7: false, ageCategory: "child" });
    expect(r.ageCategory).toBe("child");
    expect(r.isChildUnder7).toBe(true); // derived from category, not the explicit false
  });

  it("explicit false + DOB-derived 'adult' → isChildUnder7=false, consistent", () => {
    const r = applyPostCategoryLogic({ isChildUnder7: false, ageCategory: "adult" });
    expect(r.ageCategory).toBe("adult");
    expect(r.isChildUnder7).toBe(false);
  });
});

/**
 * When `isChildUnder7` is true, return the correct ageCategory based on seat.
 * - Has a seat → "child" (Criança) — occupies a physical seat
 * - No seat    → "baby"  (Bebê de colo) — lap infant
 */
export function resolveChildAgeCategory(seatNumber: string | null): "child" | "baby" {
  return seatNumber ? "child" : "baby";
}

/**
 * Derive the `isChildUnder7` flag from a resolved `ageCategory`.
 * Single source of truth: isChildUnder7 ≡ ageCategory ∈ {"child", "baby"}.
 * Always call this after computing the final ageCategory to keep both fields atomic.
 */
export function syncIsChildUnder7(ageCategory: string): boolean {
  return ageCategory === "child" || ageCategory === "baby";
}

export function deriveAgeCategory(birthDate: Date | null): "child" | "adult" | "senior" {
  if (!birthDate) return "adult";
  const ageMs = Date.now() - birthDate.getTime();
  const age = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
  if (age < 12) return "child";
  if (age >= 60) return "senior";
  return "adult";
}

export function getAgeYears(birthDate: Date | null): number {
  if (!birthDate) return 30;
  return Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

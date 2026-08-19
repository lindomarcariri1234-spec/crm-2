import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  hexToRgb,
  relativeLuminance,
  readableForeground,
  mix,
  darken,
  lighten,
  withAlpha,
  hexToHslTriplet,
  buildVitrineTheme,
  CARIRI,
} from "@/lib/vitrineTheme";

describe("normalizeHex", () => {
  it("normalizes 6-digit hex to lowercase with leading #", () => {
    expect(normalizeHex("#1E5B8C")).toBe("#1e5b8c");
    expect(normalizeHex("1e5b8c")).toBe("#1e5b8c");
  });
  it("expands 3-digit shorthand", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("fff")).toBe("#ffffff");
  });
  it("returns null for invalid input", () => {
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("not-a-color")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });
});

describe("hexToRgb", () => {
  it("parses channels", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#1e5b8c")).toEqual({ r: 30, g: 91, b: 140 });
  });
});

describe("relativeLuminance / readableForeground", () => {
  it("white is bright, black is dark", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 2);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 2);
  });
  it("picks white text on dark blue and dark text on gold", () => {
    expect(readableForeground("#1e5b8c")).toBe("#ffffff");
    expect(readableForeground(CARIRI.dourado)).toBe("#1f2937");
    expect(readableForeground("#ffffff")).toBe("#1f2937");
  });
});

describe("mix / darken / lighten", () => {
  it("mixes endpoints", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
  it("darken moves toward black, lighten toward white", () => {
    expect(darken("#808080", 0.5)).toBe("#404040");
    expect(lighten("#808080", 0.5)).toBe("#c0c0c0");
  });
});

describe("withAlpha", () => {
  it("builds rgba string", () => {
    expect(withAlpha("#1e5b8c", 0.1)).toBe("rgba(30, 91, 140, 0.1)");
  });
  it("clamps alpha", () => {
    expect(withAlpha("#000000", 2)).toBe("rgba(0, 0, 0, 1)");
    expect(withAlpha("#000000", -1)).toBe("rgba(0, 0, 0, 0)");
  });
});

describe("hexToHslTriplet", () => {
  it("converts pure colors", () => {
    expect(hexToHslTriplet("#ffffff")).toBe("0 0% 100%");
    expect(hexToHslTriplet("#000000")).toBe("0 0% 0%");
    expect(hexToHslTriplet("#ff0000")).toBe("0 100% 50%");
  });
});

describe("buildVitrineTheme", () => {
  it("falls back to Cariri when colors are the DB defaults", () => {
    const theme = buildVitrineTheme({
      primaryColor: "#3b82f6",
      secondaryColor: "#10b981",
      accentColor: "#f59e0b",
    });
    expect(theme.isFallback).toBe(true);
    expect(theme.colors.primary).toBe(CARIRI.azul);
    expect(theme.colors.secondary).toBe(CARIRI.verde);
    expect(theme.colors.accent).toBe(CARIRI.dourado);
  });

  it("honors custom colors when any differ from defaults", () => {
    const theme = buildVitrineTheme({
      primaryColor: "#7c3aed",
      secondaryColor: "#10b981",
      accentColor: "#f59e0b",
    });
    expect(theme.isFallback).toBe(false);
    expect(theme.colors.primary).toBe("#7c3aed");
  });

  it("falls back when a color is invalid/missing", () => {
    const theme = buildVitrineTheme({
      primaryColor: "",
      secondaryColor: "#10b981",
      accentColor: "#f59e0b",
    });
    expect(theme.isFallback).toBe(true);
    expect(theme.colors.primary).toBe(CARIRI.azul);
  });

  it("exposes shadcn + brand CSS vars", () => {
    const theme = buildVitrineTheme({
      primaryColor: "#1e5b8c",
      secondaryColor: "#4c8b5f",
      accentColor: "#d8a646",
    });
    expect(theme.cssVars["--primary"]).toBe(hexToHslTriplet("#1e5b8c"));
    expect(theme.cssVars["--vitrine-primary"]).toBe("#1e5b8c");
    expect(theme.cssVars["--vitrine-accent"]).toBe("#d8a646");
    expect(theme.cssVars["--vitrine-gradient-hero"]).toContain("linear-gradient");
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/tripDuration", () => ({
  calculateTripDuration: vi.fn(() => null),
}));

vi.mock("@workspace/api-client-react", () => ({}));

import {
  formatCurrency,
  formatDate,
  getCountdownLabel,
  escapeHtml,
  formatCpf,
  generateProductSlug,
} from "../pages/trips/utils.js";

describe("formatCurrency", () => {
  it("formats zero as BRL currency", () => {
    const result = formatCurrency(0);
    expect(result).toMatch(/0,00/);
    expect(result).toMatch(/R\$/);
  });

  it("formats a positive value with BRL separators", () => {
    const result = formatCurrency(1234.56);
    expect(result).toMatch(/1\.234,56/);
    expect(result).toMatch(/R\$/);
  });

  it("formats a large value correctly", () => {
    const result = formatCurrency(10000);
    expect(result).toMatch(/10\.000,00/);
  });

  it("formats a fractional value with two decimal places", () => {
    const result = formatCurrency(9.9);
    expect(result).toMatch(/9,90/);
  });
});

describe("formatDate", () => {
  it("formats a valid ISO date string as dd/MM/yyyy", () => {
    expect(formatDate("2025-06-15")).toBe("15/06/2025");
  });

  it("formats the first day of the year correctly", () => {
    expect(formatDate("2024-01-01")).toBe("01/01/2024");
  });

  it("formats the last day of the year correctly", () => {
    expect(formatDate("2024-12-31")).toBe("31/12/2024");
  });

  it("returns the original string for a non-date input", () => {
    const result = formatDate("not-a-date");
    expect(result).toBe("not-a-date");
  });
});

describe("getCountdownLabel", () => {
  it("returns Encerrado for a past date", () => {
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(getCountdownLabel(past)).toBe("Encerrado");
  });

  it("returns Em breve for a date less than 1 hour away", () => {
    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    expect(getCountdownLabel(soon)).toBe("Em breve");
  });

  it("returns hours label for a date a few hours away", () => {
    // 3h30m: floor(3.5) = 3 → "3 horas"; well clear of the 4h boundary
    const hours3 = new Date(Date.now() + 3 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();
    expect(getCountdownLabel(hours3)).toBe("3 horas");
  });

  it("returns Amanhã for a date exactly 1 day away", () => {
    // 24h30m: floor hours=24, floor days=1 → "Amanhã"; buffer against any elapsed ms
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();
    expect(getCountdownLabel(tomorrow)).toBe("Amanhã");
  });

  it("returns dias label for 5 days away", () => {
    // 5d12h: floor hours=132, floor days=5 → "5 dias"; mid-bucket so clock drift is irrelevant
    const days5 = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000).toISOString();
    expect(getCountdownLabel(days5)).toBe("5 dias");
  });

  it("returns semanas label for 3 weeks away", () => {
    // 21d12h: floor days=21, round(21/7)=3 → "3 semanas"
    const weeks3 = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000).toISOString();
    expect(getCountdownLabel(weeks3)).toBe("3 semanas");
  });

  it("returns a non-empty string for an invalid date (parseISO does not throw)", () => {
    const result = getCountdownLabel("not-a-date");
    expect(typeof result).toBe("string");
  });
});

describe("escapeHtml", () => {
  it("escapes angle brackets", () => {
    expect(escapeHtml("<b>texto</b>")).toBe("&lt;b&gt;texto&lt;/b&gt;");
  });

  it("escapes ampersand", () => {
    expect(escapeHtml("R&B")).toBe("R&amp;B");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('"citação"')).toBe("&quot;citação&quot;");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeHtml("texto simples")).toBe("texto simples");
  });
});

describe("formatCpf", () => {
  it("formats an 11-digit CPF with dots and dash", () => {
    expect(formatCpf("12345678901")).toBe("123.456.789-01");
  });

  it("returns the original string when not 11 digits", () => {
    expect(formatCpf("123")).toBe("123");
  });

  it("returns the original string when it contains letters", () => {
    expect(formatCpf("abcdefghijk")).toBe("abcdefghijk");
  });
});

describe("generateProductSlug", () => {
  it("lowercases and hyphenates the name", () => {
    const slug = generateProductSlug("Viagem Rio");
    expect(slug).toMatch(/^viagem-rio-/);
  });

  it("strips accents from the slug", () => {
    const slug = generateProductSlug("São Paulo");
    expect(slug).toMatch(/^sao-paulo-/);
  });

  it("appends a random 5-character suffix", () => {
    const slug = generateProductSlug("Passeio");
    const parts = slug.split("-");
    const suffix = parts[parts.length - 1];
    expect(suffix).toHaveLength(5);
  });

  it("produces different slugs on each call due to random suffix", () => {
    const a = generateProductSlug("Viagem");
    const b = generateProductSlug("Viagem");
    expect(a).not.toBe(b);
  });
});

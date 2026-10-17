import { describe, expect, it } from "vitest";
import {
  buildReferralShareText,
  hasReferralShareVariable,
  interpolateReferralShareMessage,
} from "../lib/referral-message";

describe("referral share message", () => {
  it("uses the same name, code, link, and bonus substitutions for shared text", () => {
    const message = interpolateReferralShareMessage(
      "Oi {{nome}}, use {codigo} em {link} e ganhe {bonus}.",
      { name: "Ana", code: "ANA123", link: "https://example.com/r/ANA123", bonus: 75 },
    );

    expect(message).toContain("Oi Ana, use ANA123 em https://example.com/r/ANA123");
    expect(message).toContain("75,00");
  });

  it("appends a missing link once and detects both supported token styles", () => {
    expect(buildReferralShareText("Indique com o código {codigo}.", {
      code: "ANA123",
      link: "https://example.com/r/ANA123",
    })).toBe("Indique com o código ANA123.\nhttps://example.com/r/ANA123");
    expect(buildReferralShareText("Acesse https://example.com/r/ANA123", {
      link: "https://example.com/r/ANA123",
    })).toBe("Acesse https://example.com/r/ANA123");
    expect(hasReferralShareVariable("Olá {{codigo}}: {link}", "codigo")).toBe(true);
    expect(hasReferralShareVariable("Olá {{codigo}}: {link}", "link")).toBe(true);
  });
});

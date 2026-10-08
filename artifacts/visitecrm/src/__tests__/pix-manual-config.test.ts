import { describe, expect, it } from "vitest";
import {
  normalizePixKey,
  validatePixKeyValue,
  validatePixManualConfig,
} from "../lib/pix-manual-config.js";

describe("Pix Manual key configuration", () => {
  it("validates CPF check digits and removes punctuation before saving", () => {
    expect(validatePixKeyValue("529.982.247-25", "cpf")).toBeNull();
    expect(validatePixKeyValue("529.982.247-24", "cpf")).toContain("CPF válido");
    expect(normalizePixKey("529.982.247-25", "cpf")).toBe("52998224725");
  });

  it("validates numeric CNPJ check digits and accepts the 14-character alphanumeric format", () => {
    expect(validatePixKeyValue("11.222.333/0001-81", "cnpj")).toBeNull();
    expect(validatePixKeyValue("11.222.333/0001-80", "cnpj")).toContain("dígitos verificadores");
    expect(validatePixKeyValue("12.ABC.345/01DE-35", "cnpj")).toBeNull();
  });

  it("normalizes email and Brazilian phone keys", () => {
    expect(validatePixKeyValue("VENDAS@EXEMPLO.COM.BR", "email")).toBeNull();
    expect(normalizePixKey("VENDAS@EXEMPLO.COM.BR", "email")).toBe("vendas@exemplo.com.br");
    expect(validatePixKeyValue("(85) 99999-1234", "phone")).toBeNull();
    expect(normalizePixKey("(85) 99999-1234", "phone")).toBe("+5585999991234");
    expect(normalizePixKey("+1 (415) 555-0132", "phone")).toBe("+14155550132");
    expect(validatePixKeyValue("123", "phone")).toContain("DDD");
  });

  it("requires a complete random key", () => {
    expect(validatePixKeyValue("550e8400-e29b-41d4-a716-446655440000", "random")).toBeNull();
    expect(validatePixKeyValue("550e8400", "random")).toContain("UUID");
  });

  it("requires a key before enabling manual Pix", () => {
    expect(validatePixManualConfig({
      enabled: true,
      keyConfigured: false,
      key: "",
      keyType: "email",
    })).toContain("Cadastre uma chave");
  });

  it("requires a replacement key when changing the type of a stored key", () => {
    expect(validatePixManualConfig({
      enabled: true,
      keyConfigured: true,
      key: "",
      keyType: "phone",
      storedKeyType: "email",
    })).toContain("nova chave");
    expect(validatePixManualConfig({
      enabled: true,
      keyConfigured: true,
      key: "",
      keyType: "email",
      storedKeyType: "email",
    })).toBeNull();
  });
});

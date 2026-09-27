import { describe, expect, it } from "vitest";
import {
  clearSignupCpfHandoff,
  consumeSignupCpfHandoff,
  saveSignupCpfHandoff,
} from "@/lib/signup-cpf-handoff";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe("signup CPF handoff", () => {
  it("transfers the CPF once to the matching storefront", () => {
    const storage = createStorage();
    saveSignupCpfHandoff(storage, "cariri", "12345678901", 1_000);

    expect(consumeSignupCpfHandoff(storage, "cariri", 2_000)).toBe("12345678901");
    expect(consumeSignupCpfHandoff(storage, "cariri", 2_001)).toBeUndefined();
  });

  it("discards expired, future-dated, and cross-store handoffs", () => {
    const storage = createStorage();
    saveSignupCpfHandoff(storage, "cariri", "12345678901", 1_000);
    expect(consumeSignupCpfHandoff(storage, "other-store", 2_000)).toBeUndefined();

    saveSignupCpfHandoff(storage, "cariri", "12345678901", 1_000);
    expect(consumeSignupCpfHandoff(storage, "cariri", 901_001)).toBeUndefined();

    saveSignupCpfHandoff(storage, "cariri", "12345678901", 2_000);
    expect(consumeSignupCpfHandoff(storage, "cariri", 1_999)).toBeUndefined();
  });

  it("rejects malformed CPF data and clears explicitly", () => {
    const storage = createStorage();
    expect(() => saveSignupCpfHandoff(storage, "cariri", "not-a-cpf")).toThrow();
    saveSignupCpfHandoff(storage, "cariri", "12345678901", 1_000);
    clearSignupCpfHandoff(storage);
    expect(consumeSignupCpfHandoff(storage, "cariri", 2_000)).toBeUndefined();
  });
});
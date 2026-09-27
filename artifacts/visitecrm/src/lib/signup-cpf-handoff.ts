const STORAGE_KEY = "vitrine_signup_cpf_handoff_v1";
const MAX_HANDOFF_AGE_MS = 15 * 60 * 1000;

type HandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface SignupCpfHandoff {
  storeSlug: string;
  cpf: string;
  createdAt: number;
}

export function saveSignupCpfHandoff(
  storage: HandoffStorage,
  storeSlug: string,
  cpf: string,
  createdAt = Date.now(),
): void {
  if (!/^\d{11}$/.test(cpf)) {
    throw new Error("A valid CPF is required for signup handoff");
  }
  storage.setItem(STORAGE_KEY, JSON.stringify({ storeSlug, cpf, createdAt }));
}

export function consumeSignupCpfHandoff(
  storage: HandoffStorage,
  storeSlug: string,
  now = Date.now(),
): string | undefined {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return undefined;

  // Treat the handoff as one-time even if its contents are malformed.
  storage.removeItem(STORAGE_KEY);

  try {
    const parsed = JSON.parse(raw) as Partial<SignupCpfHandoff>;
    if (
      parsed.storeSlug !== storeSlug ||
      typeof parsed.cpf !== "string" ||
      !/^\d{11}$/.test(parsed.cpf) ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt) ||
      now < parsed.createdAt ||
      now - parsed.createdAt > MAX_HANDOFF_AGE_MS
    ) {
      return undefined;
    }
    return parsed.cpf;
  } catch {
    return undefined;
  }
}

export function clearSignupCpfHandoff(storage: HandoffStorage): void {
  storage.removeItem(STORAGE_KEY);
}
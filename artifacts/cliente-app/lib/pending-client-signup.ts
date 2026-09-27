import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "pending-client-signup-v1";

export interface PendingClientSignup {
  clerkId: string;
  name: string;
  email: string;
  cpf: string;
}

export async function savePendingClientSignup(
  signup: PendingClientSignup,
): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(signup));
}

export async function getPendingClientSignup(
  clerkId: string,
): Promise<PendingClientSignup | null> {
  const serialized = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!serialized) return null;

  try {
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== "object"
      || value === null
      || !("clerkId" in value)
      || !("name" in value)
      || !("email" in value)
      || !("cpf" in value)
      || typeof value.clerkId !== "string"
      || typeof value.name !== "string"
      || typeof value.email !== "string"
      || typeof value.cpf !== "string"
    ) {
      await clearPendingClientSignup();
      return null;
    }

    if (value.clerkId !== clerkId) {
      await clearPendingClientSignup();
      return null;
    }

    return {
      clerkId: value.clerkId,
      name: value.name,
      email: value.email,
      cpf: value.cpf,
    };
  } catch {
    await clearPendingClientSignup();
    return null;
  }
}

export async function clearPendingClientSignup(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
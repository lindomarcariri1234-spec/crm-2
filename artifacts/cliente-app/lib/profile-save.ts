export interface ProfileSaveDraft {
  name: string;
  phone: string;
  cpf: string;
  birthDate: string;
}

export interface ProfileUpdatePayload {
  name: string | undefined;
  phone: string | null;
  cpf: string | null;
  birthDate?: string | null;
}

export interface ProfileSaveDependencies {
  getToken: () => Promise<string | null>;
  apiFetch: (
    token: string | null,
    method: "PATCH",
    path: "/client/me",
    payload: ProfileUpdatePayload,
  ) => Promise<unknown>;
  invalidateProfile: () => Promise<unknown>;
}

export function parseProfileBirthDate(input: string): string | null {
  const cleaned = input.replace(/\D/g, "");
  if (cleaned.length === 8) {
    const day = cleaned.slice(0, 2);
    const month = cleaned.slice(2, 4);
    const year = cleaned.slice(4, 8);
    return `${year}-${month}-${day}`;
  }
  return null;
}

export function buildProfileUpdatePayload(draft: ProfileSaveDraft): ProfileUpdatePayload {
  const birthDate = draft.birthDate.trim()
    ? parseProfileBirthDate(draft.birthDate)
    : undefined;

  return {
    name: draft.name.trim() || undefined,
    phone: draft.phone.trim() || null,
    cpf: draft.cpf.trim() || null,
    ...(birthDate !== undefined ? { birthDate } : {}),
  };
}

export async function saveClientProfile(
  draft: ProfileSaveDraft,
  dependencies: ProfileSaveDependencies,
): Promise<void> {
  const token = await dependencies.getToken();
  const payload = buildProfileUpdatePayload(draft);
  await dependencies.apiFetch(token, "PATCH", "/client/me", payload);
  await dependencies.invalidateProfile();
}
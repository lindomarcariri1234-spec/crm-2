import React, { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

export const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "http://localhost:8080";

export class GuideApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "GuideApiError";
  }
}

const AUTH_KEY = "guide_auth_v1";
const TOKEN_KEY = "guide_auth_token_v1";

export interface GuideAuth {
  token: string;
  tripId: string;
  tenantId: string;
  guideName: string;
  expiresAt: string;
}

interface AuthContextType {
  auth: GuideAuth | null;
  isLoading: boolean;
  login: (auth: GuideAuth) => Promise<void>;
  logout: () => Promise<void>;
}

type GuideAuthMetadata = Omit<GuideAuth, "token">;

const AuthContext = createContext<AuthContextType>({
  auth: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<GuideAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function restoreAuth() {
      const [rawMetadata, secureToken] = await Promise.all([
        AsyncStorage.getItem(AUTH_KEY),
        SecureStore.getItemAsync(TOKEN_KEY),
      ]);
      if (!rawMetadata) {
        // A token without its metadata cannot identify a valid guide session.
        if (secureToken) await SecureStore.deleteItemAsync(TOKEN_KEY);
        return;
      }

      let metadata: GuideAuthMetadata;
      try {
        const parsed = JSON.parse(rawMetadata) as Partial<GuideAuth>;
        if (
          typeof parsed.tripId !== "string" ||
          typeof parsed.tenantId !== "string" ||
          typeof parsed.guideName !== "string" ||
          typeof parsed.expiresAt !== "string"
        ) {
          throw new Error("Invalid guide auth metadata");
        }
        metadata = {
          tripId: parsed.tripId,
          tenantId: parsed.tenantId,
          guideName: parsed.guideName,
          expiresAt: parsed.expiresAt,
        };
      } catch {
        await Promise.all([
          AsyncStorage.removeItem(AUTH_KEY),
          SecureStore.deleteItemAsync(TOKEN_KEY),
        ]);
        return;
      }

      const expiresAt = new Date(metadata.expiresAt);
      if (!secureToken || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
        await Promise.all([
          AsyncStorage.removeItem(AUTH_KEY),
          SecureStore.deleteItemAsync(TOKEN_KEY),
        ]);
        return;
      }
      setAuth({ ...metadata, token: secureToken });
    }

    async function migrateOrRestoreAuth() {
      const raw = await AsyncStorage.getItem(AUTH_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<GuideAuth>;
          // Version 1 stored the bearer token alongside metadata. Move it to
          // SecureStore before deleting the legacy AsyncStorage record.
          if (typeof parsed.token === "string" && parsed.token.length > 0) {
            await SecureStore.setItemAsync(TOKEN_KEY, parsed.token);
            const metadata = {
              tripId: parsed.tripId,
              tenantId: parsed.tenantId,
              guideName: parsed.guideName,
              expiresAt: parsed.expiresAt,
            };
            await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(metadata));
          }
        } catch {
          await Promise.all([
            AsyncStorage.removeItem(AUTH_KEY),
            SecureStore.deleteItemAsync(TOKEN_KEY),
          ]);
        }
      }
      await restoreAuth();
    }

    migrateOrRestoreAuth()
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  async function login(newAuth: GuideAuth) {
    const { token, ...metadata } = newAuth;
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(metadata));
    setAuth(newAuth);
  }

  async function logout() {
    await Promise.all([
      AsyncStorage.removeItem(AUTH_KEY),
      SecureStore.deleteItemAsync(TOKEN_KEY),
    ]);
    setAuth(null);
  }

  return (
    <AuthContext.Provider value={{ auth, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export async function apiFetch(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new GuideApiError("Sessão do guia expirada. Faça login novamente.", response.status);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as
      | { error?: string; message?: string }
      | null;
    throw new GuideApiError(payload?.message ?? payload?.error ?? `Erro ${response.status}`, response.status);
  }
  return response;
}

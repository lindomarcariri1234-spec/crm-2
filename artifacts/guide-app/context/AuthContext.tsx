import React, { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

const AUTH_KEY = "guide_auth_v1";

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
    AsyncStorage.getItem(AUTH_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as GuideAuth;
        if (new Date(parsed.expiresAt) > new Date()) {
          setAuth(parsed);
        } else {
          AsyncStorage.removeItem(AUTH_KEY);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  async function login(newAuth: GuideAuth) {
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(newAuth));
    setAuth(newAuth);
  }

  async function logout() {
    await AsyncStorage.removeItem(AUTH_KEY);
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
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

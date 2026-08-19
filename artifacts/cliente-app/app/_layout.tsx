import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import colors from "@/constants/colors";
import { apiFetch, ApiError } from "@/lib/api";
import type { ClientPortalProfile } from "@/lib/types";

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
    },
  },
});

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

const tokenCache =
  Platform.OS !== "web"
    ? {
        async getToken(key: string) {
          return AsyncStorage.getItem(key);
        },
        async saveToken(key: string, value: string) {
          return AsyncStorage.setItem(key, value);
        },
        async clearToken(key: string) {
          return AsyncStorage.removeItem(key);
        },
      }
    : undefined;

async function registerPushToken(authToken: string): Promise<void> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const { data: pushToken } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    await apiFetch<void>(authToken, "POST", "/client/push-token", { token: pushToken });
  } catch (err) {
    console.warn("[push-token] registration failed:", err);
  }
}

const PUBLIC_ROUTES = new Set(["sign-in", "sign-up"]);

function AuthGate() {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const segments = useSegments();
  const [roleStatus, setRoleStatus] = useState<"idle" | "loading" | "ok" | "denied">("idle");
  const checkedRef = useRef(false);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { type?: string; reservationId?: string }
        | undefined;
      if (data?.reservationId || data?.type) {
        router.navigate("/(tabs)/reservas");
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      checkedRef.current = false;
      setRoleStatus("idle");
      // Only redirect if we're not already on a public route (sign-in or sign-up)
      if (!PUBLIC_ROUTES.has(segments[0] as string)) {
        router.replace("/sign-in");
      }
      return;
    }

    if (checkedRef.current) return;
    checkedRef.current = true;
    setRoleStatus("loading");

    getToken()
      .then(async (tok) => {
        await apiFetch<ClientPortalProfile>(tok, "GET", "/client/me");
        setRoleStatus("ok");
        router.replace("/(tabs)");
        if (tok) {
          registerPushToken(tok);
        }
      })
      .catch((err: unknown) => {
        checkedRef.current = false;
        if (err instanceof ApiError && err.status === 403) {
          setRoleStatus("denied");
        } else {
          setRoleStatus("idle");
          router.replace("/sign-in");
        }
      });
  }, [isLoaded, isSignedIn, getToken, segments]);

  if (!isLoaded || roleStatus === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.light.primary} />
      </View>
    );
  }

  if (roleStatus === "denied") {
    return (
      <View style={styles.center}>
        <Text style={styles.deniedTitle}>Acesso Restrito</Text>
        <Text style={styles.deniedText}>
          Este aplicativo é exclusivo para clientes de agências. Sua conta não
          possui o perfil necessário.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.signOutBtn, { opacity: pressed ? 0.7 : 1 }]}
          onPress={() => {
            signOut();
            queryClient.clear();
            checkedRef.current = false;
            setRoleStatus("idle");
          }}
        >
          <Text style={styles.signOutText}>Sair da conta</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <AuthGate />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.light.background,
    padding: 32,
    gap: 16,
  },
  deniedTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: colors.light.foreground,
    textAlign: "center",
  },
  deniedText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: colors.light.mutedForeground,
    textAlign: "center",
    lineHeight: 22,
  },
  signOutBtn: {
    marginTop: 8,
    backgroundColor: colors.light.destructive,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 10,
  },
  signOutText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#ffffff",
  },
});

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Stack, router, useSegments } from "expo-router";
import * as Linking from "expo-linking";
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
import {
  clearPendingClientSignup,
  getPendingClientSignup,
} from "@/lib/pending-client-signup";

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
const DEFAULT_DENIED_MESSAGE =
  "Este aplicativo é exclusivo para clientes de agências. Sua conta não possui o perfil necessário.";
const CLIENT_SIGNUP_DENIED_MESSAGE =
  "Não foi possível vincular sua conta a um cadastro de cliente. Confira se o e-mail foi confirmado e se os dados correspondem ao cadastro da agência. Se o problema continuar, entre em contato com a agência.";

const tokenCache =
  Platform.OS !== "web"
    ? {
        async getToken(key: string) {
          return SecureStore.getItemAsync(key);
        },
        async saveToken(key: string, value: string) {
          return SecureStore.setItemAsync(key, value);
        },
        async clearToken(key: string) {
          return SecureStore.deleteItemAsync(key);
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

function navigateToDeepLink(url: string): void {
  const parsed = Linking.parse(url);
  const path = [parsed.hostname, parsed.path].filter(Boolean).join("/");
  const params = parsed.queryParams ?? {};
  const reservationId = typeof params.reservationId === "string"
    ? params.reservationId
    : path.match(/reservas?\/([^/]+)/i)?.[1];
  if (reservationId) {
    router.navigate({ pathname: "/(tabs)/reservas", params: { reservationId } });
  } else if (/voucher/i.test(path)) {
    router.navigate("/(tabs)/reservas");
  } else if (/atendimento|support|suporte/i.test(path)) {
    router.navigate("/(tabs)/perfil");
  } else if (/produto|product|vitrine|store/i.test(path)) {
    router.navigate("/(tabs)");
  }
}

function AuthGate() {
  const { isLoaded, isSignedIn, getToken, signOut, userId } = useAuth();
  const segments = useSegments();
  const [roleStatus, setRoleStatus] = useState<"idle" | "loading" | "ok" | "denied">("idle");
  const [deniedMessage, setDeniedMessage] = useState(DEFAULT_DENIED_MESSAGE);
  const checkedRef = useRef(false);
  const pendingSignupSyncRef = useRef(false);
  const pendingDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    function handleUrl(url: string | null) {
      if (!url) return;
      pendingDeepLinkRef.current = url;
      if (roleStatus === "ok") {
        pendingDeepLinkRef.current = null;
        navigateToDeepLink(url);
      }
    }
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const linkSubscription = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { type?: string; reservationId?: string; voucherCode?: string; url?: string }
        | undefined;
      if (data?.url) {
        handleUrl(data.url);
      } else if (data?.reservationId || data?.voucherCode || data?.type) {
        router.navigate({ pathname: "/(tabs)/reservas", params: { reservationId: data?.reservationId } });
      }
    });
    return () => {
      subscription.remove();
      linkSubscription.remove();
    };
  }, [roleStatus]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      checkedRef.current = false;
      pendingSignupSyncRef.current = false;
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
        const pendingSignup = userId
          ? await getPendingClientSignup(userId)
          : null;
        if (pendingSignup) {
          pendingSignupSyncRef.current = true;
          const syncedUser = await apiFetch<{ role: string }>(
            tok,
            "POST",
            "/users/me/sync",
            {
              clerkId: pendingSignup.clerkId,
              name: pendingSignup.name,
              email: pendingSignup.email,
              avatarUrl: null,
              cpf: pendingSignup.cpf,
              clientSignup: true,
            },
          );
          if (syncedUser.role !== "cliente") {
            throw new ApiError(
              "Cadastro de cliente não encontrado",
              403,
              "CLIENT_PROFILE_NOT_FOUND",
            );
          }
          await clearPendingClientSignup();
          pendingSignupSyncRef.current = false;
        }

        await apiFetch<ClientPortalProfile>(tok, "GET", "/client/me");
        setRoleStatus("ok");
        setDeniedMessage(DEFAULT_DENIED_MESSAGE);
        const pendingLink = pendingDeepLinkRef.current;
        pendingDeepLinkRef.current = null;
        if (pendingLink) navigateToDeepLink(pendingLink);
        else router.replace("/(tabs)");
        if (tok) {
          registerPushToken(tok);
        }
      })
      .catch((err: unknown) => {
        checkedRef.current = false;
        if (pendingSignupSyncRef.current) {
          setDeniedMessage(CLIENT_SIGNUP_DENIED_MESSAGE);
          setRoleStatus("denied");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setDeniedMessage(DEFAULT_DENIED_MESSAGE);
          setRoleStatus("denied");
        } else {
          setRoleStatus("idle");
          router.replace("/sign-in");
        }
      });
  }, [isLoaded, isSignedIn, getToken, segments, userId]);

  if (!isLoaded || roleStatus === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.light.azulChapada} />
      </View>
    );
  }

  if (roleStatus === "denied") {
    return (
      <View style={styles.center}>
        <Text style={styles.deniedTitle}>Acesso Restrito</Text>
        <Text style={styles.deniedText}>{deniedMessage}</Text>
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
    color: colors.light.primaryForeground,
  },
});

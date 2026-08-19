import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_BASE, useAuth } from "@/context/AuthContext";
import colors from "@/constants/colors";

export default function LoginScreen() {
  const { auth, isLoading, login } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const insets = useSafeAreaInsets();
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isLoading && auth) {
      router.replace("/trip");
    }
  }, [isLoading, auth]);

  function shake() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }

  async function handleLogin() {
    const clean = code.trim().toUpperCase();
    if (clean.length !== 8) {
      setError("O código deve ter 8 caracteres.");
      shake();
      return;
    }
    setSubmitting(true);
    setError("");
    Keyboard.dismiss();
    try {
      const res = await fetch(`${API_BASE}/api/guide/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: clean }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((data.error as string) || "Código inválido ou expirado.");
      }
      await login({
        token: data.token as string,
        tripId: data.tripId as string,
        tenantId: data.tenantId as string,
        guideName: data.guideName as string,
        expiresAt: data.expiresAt as string,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/trip");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao entrar. Tente novamente.");
      shake();
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.light.primary} />
      </View>
    );
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { paddingTop: topPad + 20, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.logoArea}>
          <View style={styles.iconCircle}>
            <Ionicons name="airplane" size={40} color={colors.light.primaryForeground} />
          </View>
          <Text style={styles.title}>App do Guia</Text>
          <Text style={styles.subtitle}>Check-in de Embarque</Text>
        </View>

        <Animated.View style={[styles.card, { transform: [{ translateX: shakeAnim }] }]}>
          <Text style={styles.label}>Código de acesso</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={(t) => { setCode(t.toUpperCase()); setError(""); }}
            placeholder="EX: AB12CD34"
            placeholderTextColor={colors.light.mutedForeground}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            editable={!submitting}
          />
          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={14} color={colors.light.destructive} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              submitting && styles.buttonDisabled,
            ]}
            onPress={handleLogin}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="log-in-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>Entrar</Text>
              </>
            )}
          </Pressable>
        </Animated.View>

        <Text style={styles.hint}>
          Solicite o código ao coordenador da viagem
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = colors.light;

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: s.background,
  },
  container: {
    flex: 1,
    backgroundColor: s.background,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  logoArea: {
    alignItems: "center",
    gap: 8,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: s.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: s.foreground,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: s.mutedForeground,
  },
  card: {
    width: "100%",
    backgroundColor: s.card,
    borderRadius: 16,
    padding: 24,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: s.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  input: {
    height: 52,
    backgroundColor: s.muted,
    borderRadius: 10,
    paddingHorizontal: 16,
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: s.foreground,
    letterSpacing: 4,
    textAlign: "center",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: s.destructive,
  },
  button: {
    height: 52,
    backgroundColor: s.primary,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  hint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: s.mutedForeground,
    textAlign: "center",
  },
});

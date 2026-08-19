import { Ionicons } from "@expo/vector-icons";
import { useSignIn, useAuth } from "@clerk/clerk-expo";
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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import colors from "@/constants/colors";

const s = colors.light;

export default function SignInScreen() {
  const { isSignedIn } = useAuth();
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const insets = useSafeAreaInsets();
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isSignedIn) {
      router.replace("/(tabs)");
    }
  }, [isSignedIn]);

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

  async function handleSignIn() {
    if (!isLoaded) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError("Preencha e-mail e senha.");
      shake();
      return;
    }
    setSubmitting(true);
    setError("");
    Keyboard.dismiss();
    try {
      const result = await signIn.create({
        identifier: cleanEmail,
        password,
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace("/(tabs)/reservas");
      } else {
        setError("Autenticação incompleta. Tente novamente.");
        shake();
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message.includes("password is incorrect")
            ? "Senha incorreta."
            : e.message.includes("No user found")
            ? "E-mail não encontrado."
            : e.message.includes("too many attempts")
            ? "Muitas tentativas. Aguarde e tente novamente."
            : "E-mail ou senha inválidos."
          : "Erro ao entrar. Tente novamente.";
      setError(msg);
      shake();
    } finally {
      setSubmitting(false);
    }
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: topPad + 20, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoArea}>
          <View style={styles.iconCircle}>
            <Ionicons name="airplane" size={40} color={s.primaryForeground} />
          </View>
          <Text style={styles.title}>VisiteCRM</Text>
          <Text style={styles.subtitle}>Portal do Viajante</Text>
        </View>

        <Animated.View style={[styles.card, { transform: [{ translateX: shakeAnim }] }]}>
          <Text style={styles.cardTitle}>Entrar na sua conta</Text>

          <View style={styles.field}>
            <Text style={styles.label}>E-mail</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(t) => { setEmail(t); setError(""); }}
              placeholder="seu@email.com"
              placeholderTextColor={s.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
              editable={!submitting}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Senha</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(t) => { setPassword(t); setError(""); }}
              placeholder="••••••••"
              placeholderTextColor={s.mutedForeground}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleSignIn}
              editable={!submitting}
            />
          </View>

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={14} color={s.destructive} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              submitting && styles.buttonDisabled,
            ]}
            onPress={handleSignIn}
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

        <View style={styles.signUpRow}>
          <Text style={styles.signUpText}>Não tem conta? </Text>
          <Pressable
            onPress={() => router.push("/sign-up")}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={styles.signUpLink}>Criar conta</Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>
          Acesse com o e-mail cadastrado na sua agência de viagens.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
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
    maxWidth: 440,
    backgroundColor: s.card,
    borderRadius: 16,
    padding: 24,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: s.foreground,
    marginBottom: 4,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: s.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    height: 48,
    backgroundColor: s.muted,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: s.foreground,
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
    flexShrink: 1,
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
    maxWidth: 280,
  },
  signUpRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  signUpText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: s.mutedForeground,
  },
  signUpLink: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: s.primary,
  },
});

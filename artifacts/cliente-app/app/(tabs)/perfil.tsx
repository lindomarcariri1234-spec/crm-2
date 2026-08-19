import { Feather } from "@expo/vector-icons";
import { useAuth, useUser } from "@clerk/clerk-expo";
import { SkeletonBox } from "@/components/Skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import type { ClientPortalProfile } from "@/lib/types";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

function InfoRow({
  icon,
  label,
  value,
  colors,
}: {
  icon: FeatherName;
  label: string;
  value: string | null | undefined;
  colors: ReturnType<typeof useColors>;
}) {
  if (!value) return null;
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Feather name={icon} size={16} color={colors.primary} />
      <View style={styles.infoText}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
      </View>
    </View>
  );
}

export default function PerfilScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken, signOut } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [birthDateInput, setBirthDateInput] = useState("");
  const [saving, setSaving] = useState(false);
  const params = useLocalSearchParams<{ openNps?: string }>();

  // When the client portal email CTA is clicked with ?openNps=1, navigate
  // to the home tab where the NPS survey modal auto-appears for eligible trips.
  useEffect(() => {
    if (params.openNps === "1") {
      router.replace("/(tabs)/");
    }
  }, [params.openNps]);

  const { data, isLoading, error, refetch, isRefetching } = useQuery<ClientPortalProfile>({
    queryKey: ["client-profile"],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<ClientPortalProfile>(token, "GET", "/client/me");
    },
  });


  function startEdit() {
    setNameInput(data?.client?.name ?? data?.user?.name ?? "");
    setPhoneInput(data?.client?.phone ?? "");
    const bd = data?.client?.birthDate;
    setBirthDateInput(bd ? new Date(bd + "T00:00:00").toLocaleDateString("pt-BR") : "");
    setEditing(true);
  }

  function parseBirthDate(input: string): string | null {
    const cleaned = input.replace(/\D/g, "");
    if (cleaned.length === 8) {
      const d = cleaned.slice(0, 2);
      const m = cleaned.slice(2, 4);
      const y = cleaned.slice(4, 8);
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const token = await getToken();
      const birthDate = birthDateInput.trim() ? parseBirthDate(birthDateInput) : undefined;
      await apiFetch<unknown>(token, "PATCH", "/client/me", {
        name: nameInput.trim() || undefined,
        phone: phoneInput.trim() || null,
        ...(birthDate !== undefined ? { birthDate } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["client-profile"] });
      setEditing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Erro", e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    Alert.alert(
      "Sair",
      "Deseja realmente sair da sua conta?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Sair",
          style: "destructive",
          onPress: async () => {
            await signOut();
            queryClient.clear();
            router.replace("/sign-in");
          },
        },
      ]
    );
  }

  if (isLoading) {
    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 20, gap: 16 }}
        scrollEnabled={false}
      >
        <View style={{ alignItems: "center", gap: 12, paddingVertical: 16 }}>
          <SkeletonBox width={80} height={80} borderRadius={40} />
          <SkeletonBox width={160} height={20} />
          <SkeletonBox width={200} height={14} />
        </View>
        <SkeletonBox height={100} borderRadius={14} />
        <SkeletonBox height={180} borderRadius={14} />
      </ScrollView>
    );
  }

  const profile = data;
  const client = profile?.client;
  const displayName = client?.name ?? profile?.user?.name ?? user?.firstName ?? "Viajante";
  const email = client?.email ?? profile?.user?.email ?? user?.primaryEmailAddress?.emailAddress ?? "";
  const tenantName = profile?.tenant?.name ?? "";

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.scroll,
        { paddingBottom: insets.bottom + 100 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={colors.primary}
        />
      }
    >
      {/* Avatar + name */}
      <View style={[styles.headerCard, { backgroundColor: colors.primary }]}>
        <View style={styles.headerDecor} />
        <View style={[styles.avatar, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
          <Text style={styles.avatarInitial}>
            {displayName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.headerName}>{displayName}</Text>
        {email ? (
          <Text style={styles.headerEmail}>{email}</Text>
        ) : null}
        {tenantName ? (
          <View style={[styles.agencyBadge, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
            <Feather name="briefcase" size={12} color="rgba(255,255,255,0.85)" />
            <Text style={styles.agencyBadgeText}>{tenantName}</Text>
          </View>
        ) : null}
      </View>

      {/* Info card */}
      {!editing ? (
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.infoCardHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Dados cadastrais</Text>
            <Pressable
              style={({ pressed }) => [styles.editBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={startEdit}
            >
              <Feather name="edit-2" size={14} color={colors.primary} />
              <Text style={[styles.editBtnText, { color: colors.primary }]}>Editar</Text>
            </Pressable>
          </View>
          <InfoRow icon="user" label="Nome" value={displayName} colors={colors} />
          <InfoRow icon="mail" label="E-mail" value={email} colors={colors} />
          <InfoRow icon="phone" label="Telefone" value={client?.phone} colors={colors} />
          <InfoRow icon="credit-card" label="CPF" value={client?.cpf} colors={colors} />
          <InfoRow
            icon="calendar"
            label="Data de nascimento"
            value={
              client?.birthDate
                ? new Date(client.birthDate + "T00:00:00").toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })
                : null
            }
            colors={colors}
          />
          <InfoRow icon="map-pin" label="Cidade" value={
            client?.addressCity
              ? `${client.addressCity}${client.addressState ? ` - ${client.addressState}` : ""}`
              : null
          } colors={colors} />
          {client?.customerCode ? (
            <InfoRow icon="hash" label="Código de cliente" value={client.customerCode} colors={colors} />
          ) : null}
        </View>
      ) : (
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Editar perfil</Text>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Nome</Text>
            <TextInput
              style={[styles.fieldInput, { backgroundColor: colors.muted, color: colors.foreground }]}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Seu nome"
              placeholderTextColor={colors.mutedForeground}
              editable={!saving}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Telefone</Text>
            <TextInput
              style={[styles.fieldInput, { backgroundColor: colors.muted, color: colors.foreground }]}
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="(11) 99999-9999"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="phone-pad"
              editable={!saving}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Data de nascimento</Text>
            <TextInput
              style={[styles.fieldInput, { backgroundColor: colors.muted, color: colors.foreground }]}
              value={birthDateInput}
              onChangeText={setBirthDateInput}
              placeholder="DD/MM/AAAA"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              editable={!saving}
            />
          </View>

          <View style={styles.editActions}>
            <Pressable
              style={({ pressed }) => [
                styles.cancelBtn,
                { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => setEditing(false)}
              disabled={saving}
            >
              <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: colors.primary, opacity: pressed || saving ? 0.8 : 1, flex: 1 },
              ]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Salvar</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {/* Stats summary */}
      {profile?.stats ? (
        <View style={[styles.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {profile.reservations.length}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Reservas</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
                .format(profile.stats.totalSpent)}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total gasto</Text>
          </View>
        </View>
      ) : null}

      {/* Sign out */}
      <Pressable
        style={({ pressed }) => [
          styles.signOutBtn,
          { borderColor: colors.destructive + "40", opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={handleSignOut}
      >
        <Feather name="log-out" size={18} color={colors.destructive} />
        <Text style={[styles.signOutText, { color: colors.destructive }]}>Sair da conta</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  scroll: {
    padding: 16,
    gap: 12,
  },
  headerCard: {
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
  },
  headerDecor: {
    position: "absolute",
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  avatarInitial: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
  },
  headerName: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
  },
  headerEmail: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.75)",
  },
  agencyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 4,
  },
  agencyBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.85)",
  },
  infoCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 2,
  },
  infoCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  editBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  infoText: {
    flex: 1,
    gap: 1,
  },
  infoLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  fieldGroup: {
    gap: 6,
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  fieldInput: {
    height: 46,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  editActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    height: 46,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  saveBtn: {
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#ffffff",
  },
  statsCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  statDivider: {
    width: 1,
    height: 40,
  },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  signOutText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});

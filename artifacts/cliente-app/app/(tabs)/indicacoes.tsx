import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/clerk-expo";
import { useQuery } from "@tanstack/react-query";
import { SkeletonBox } from "@/components/Skeleton";
import * as Clipboard from "expo-clipboard";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import type { ClientPortalProfile, MyReferralsResponse, ClientReferral } from "@/lib/types";

const REFERRAL_STATUS_LABELS: Record<string, string> = {
  pending: "Aguardando",
  completed: "Bônus liberado",
  converted: "Convertido",
  expired: "Expirado",
  reversed: "Revertido",
};

const REFERRAL_STATUS_COLORS: Record<string, string> = {
  pending: "#d97706",
  completed: "#16a34a",
  converted: "#16a34a",
  expired: "#6b7280",
  reversed: "#6b7280",
};

/**
 * Returns the number of whole days until `expiresAt`.
 * Negative means already expired.
 * Returns null when expiresAt is absent.
 */
function getDaysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const now = Date.now();
  const exp = new Date(expiresAt).getTime();
  return Math.floor((exp - now) / (1000 * 60 * 60 * 24));
}

function ExpiryBadge({
  expiresAt,
  status,
}: {
  expiresAt: string | null;
  status: string;
}) {
  const days = getDaysUntilExpiry(expiresAt);
  if (days === null) return null;
  if (status !== "completed" && status !== "converted") return null;

  if (days < 0) {
    return (
      <View style={[styles.expiryPill, { backgroundColor: "#f3f4f6" }]}>
        <Feather name="clock" size={11} color="#6b7280" />
        <Text style={[styles.expiryText, { color: "#6b7280" }]}>Expirou</Text>
      </View>
    );
  }
  if (days === 0) {
    return (
      <View style={[styles.expiryPill, { backgroundColor: "#fef2f2" }]}>
        <Feather name="alert-circle" size={11} color="#dc2626" />
        <Text style={[styles.expiryText, { color: "#dc2626" }]}>Expira hoje</Text>
      </View>
    );
  }
  const color = days <= 7 ? "#d97706" : "#6b7280";
  const bg = days <= 7 ? "#fffbeb" : "#f3f4f6";
  return (
    <View style={[styles.expiryPill, { backgroundColor: bg }]}>
      <Feather name="clock" size={11} color={color} />
      <Text style={[styles.expiryText, { color }]}>
        {days === 1 ? "Expira em 1 dia" : `Expira em ${days} dias`}
      </Text>
    </View>
  );
}

function ReferralItem({
  r,
  colors,
}: {
  r: ClientReferral;
  colors: ReturnType<typeof useColors>;
}) {
  const statusLabel = REFERRAL_STATUS_LABELS[r.status] ?? r.status;
  const statusColor = REFERRAL_STATUS_COLORS[r.status] ?? colors.mutedForeground;
  const date = new Date(r.createdAt).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <View style={[styles.referralItem, { borderBottomColor: colors.border }]}>
      <View style={[styles.avatarCircle, { backgroundColor: colors.accent }]}>
        <Feather name="user" size={18} color={colors.primary} />
      </View>
      <View style={styles.referralInfo}>
        <Text style={[styles.referralName, { color: colors.foreground }]}>
          {r.referredName ?? "Indicado"}
        </Text>
        <Text style={[styles.referralDate, { color: colors.mutedForeground }]}>{date}</Text>
        <ExpiryBadge expiresAt={r.expiresAt} status={r.status} />
      </View>
      <View style={[styles.statusPill, { backgroundColor: statusColor + "18" }]}>
        <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
      </View>
    </View>
  );
}

export default function IndicacoesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [copied, setCopied] = useState(false);

  const { data: profileData, isLoading, error, refetch, isRefetching } = useQuery<ClientPortalProfile>({
    queryKey: ["client-profile"],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<ClientPortalProfile>(token, "GET", "/client/me");
    },
  });

  const { data: referralsData } = useQuery<MyReferralsResponse>({
    queryKey: ["my-referrals"],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<MyReferralsResponse>(token, "GET", "/client/me/referrals");
    },
    enabled: !!profileData,
  });

  const referral = profileData?.referral;
  const code = referral?.code ?? null;
  const referrals = referralsData?.data ?? [];
  const isCodeBlocked = referral ? referral.referralCodeStatus !== "active" : false;
  const bonusValidityDays = referral?.bonusValidityDays ?? 30;

  const shareMsg = referral?.shareMessage
    ?? (code ? `Use meu código ${code} para se cadastrar e ganhar benefícios especiais!` : "");

  async function handleCopy() {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleShare() {
    if (!shareMsg) return;
    try {
      await Share.share({ message: shareMsg });
    } catch {
    }
  }

  async function handleWhatsApp() {
    if (!shareMsg) return;
    const encoded = encodeURIComponent(shareMsg);
    const url = `whatsapp://send?text=${encoded}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      await handleShare();
    }
  }

  if (isLoading) {
    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 20, gap: 16 }}
        scrollEnabled={false}
      >
        <SkeletonBox height={120} borderRadius={14} />
        <SkeletonBox height={80} borderRadius={14} />
        <SkeletonBox width={140} height={18} />
        {[1, 2, 3].map((i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <SkeletonBox width={40} height={40} borderRadius={20} />
            <View style={{ flex: 1, gap: 6 }}>
              <SkeletonBox width="60%" height={14} />
              <SkeletonBox width="40%" height={12} />
            </View>
            <SkeletonBox width={60} height={22} borderRadius={6} />
          </View>
        ))}
      </ScrollView>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="wifi-off" size={40} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Erro ao carregar</Text>
      </View>
    );
  }

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
      {/* Code card */}
      <View style={[styles.codeCard, { backgroundColor: colors.primary }]}>
        <View style={styles.codeCardDecor} />
        <Text style={styles.codeCardLabel}>Seu código de indicação</Text>
        <Text style={styles.codeValue}>{code ?? "Indisponível"}</Text>
        <View style={styles.codeActions}>
          {/* Copy button */}
          <Pressable
            style={({ pressed }) => [
              styles.codeBtn,
              { backgroundColor: copied ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.18)", opacity: pressed ? 0.75 : 1 },
            ]}
            onPress={handleCopy}
            disabled={!code}
          >
            <Feather name={copied ? "check" : "copy"} size={16} color="#fff" />
            <Text style={styles.codeBtnText}>{copied ? "Copiado!" : "Copiar"}</Text>
          </Pressable>

          {/* WhatsApp button */}
          <Pressable
            style={({ pressed }) => [
              styles.codeBtn,
              { backgroundColor: "rgba(255,255,255,0.18)", opacity: pressed ? 0.75 : 1 },
            ]}
            onPress={handleWhatsApp}
            disabled={!code}
          >
            <Feather name="message-circle" size={16} color="#fff" />
            <Text style={styles.codeBtnText}>WhatsApp</Text>
          </Pressable>

          {/* Generic share */}
          <Pressable
            style={({ pressed }) => [
              styles.codeBtn,
              { backgroundColor: "rgba(255,255,255,0.18)", opacity: pressed ? 0.75 : 1 },
            ]}
            onPress={handleShare}
            disabled={!code}
          >
            <Feather name="share-2" size={16} color="#fff" />
            <Text style={styles.codeBtnText}>Compartilhar</Text>
          </Pressable>
        </View>
      </View>

      {/* Blocked code alert */}
      {isCodeBlocked ? (
        <View style={[styles.blockedBanner, { backgroundColor: "#fef2f2", borderColor: "#fca5a5" }]}>
          <Feather name="alert-triangle" size={18} color="#dc2626" />
          <View style={styles.blockedBannerText}>
            <Text style={[styles.blockedBannerTitle, { color: "#dc2626" }]}>
              Código temporariamente bloqueado
            </Text>
            <Text style={[styles.blockedBannerBody, { color: "#7f1d1d" }]}>
              Seu código de indicação está inativo no momento. Entre em contato com a agência para reativá-lo.
            </Text>
          </View>
        </View>
      ) : null}

      {/* Stats */}
      {referral ? (
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {referral.totalReferrals}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.success }]}>
              {referral.completedReferrals}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Convertidos</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.warning }]}>
              {referral.pendingReferrals}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Pendentes</Text>
          </View>
        </View>
      ) : null}

      {/* Earnings */}
      {referral && (parseFloat(referral.totalEarnings) > 0 || parseFloat(referral.creditBalance) > 0) ? (
        <View style={[styles.earningsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.earningsRow}>
            <View>
              <Text style={[styles.earningsLabel, { color: colors.mutedForeground }]}>Total ganho</Text>
              <Text style={[styles.earningsValue, { color: colors.success }]}>
                R$ {parseFloat(referral.totalEarnings).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </Text>
            </View>
            {parseFloat(referral.creditBalance) > 0 ? (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.earningsLabel, { color: colors.mutedForeground }]}>Saldo disponível</Text>
                <Text style={[styles.earningsValue, { color: colors.primary }]}>
                  R$ {parseFloat(referral.creditBalance).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </Text>
              </View>
            ) : null}
          </View>
          {/* Bonus validity countdown */}
          {bonusValidityDays > 0 ? (
            <View style={[styles.validityRow, { borderTopColor: colors.border }]}>
              <Feather name="clock" size={13} color={colors.mutedForeground} />
              <Text style={[styles.validityText, { color: colors.mutedForeground }]}>
                Bônus liberados ficam disponíveis por{" "}
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                  {bonusValidityDays} {bonusValidityDays === 1 ? "dia" : "dias"}
                </Text>{" "}
                após serem confirmados
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Referrals list */}
      <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Indicações ({referrals.length})
        </Text>
        {referrals.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Você ainda não indicou ninguém. Compartilhe seu código!
          </Text>
        ) : (
          referrals.map((r) => (
            <ReferralItem key={r.id} r={r} colors={colors} />
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  scroll: {
    padding: 16,
    gap: 12,
  },
  codeCard: {
    borderRadius: 20,
    padding: 24,
    gap: 8,
    overflow: "hidden",
    alignItems: "center",
  },
  codeCardDecor: {
    position: "absolute",
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  codeCardLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.75)",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  codeValue: {
    fontSize: 34,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    letterSpacing: 6,
    textAlign: "center",
  },
  codeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
    justifyContent: "center",
  },
  codeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  codeBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#ffffff",
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  earningsCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  earningsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  earningsLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginBottom: 2,
  },
  earningsValue: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  listCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 8,
  },
  referralItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  referralInfo: {
    flex: 1,
    gap: 2,
  },
  referralName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  referralDate: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingVertical: 16,
    lineHeight: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  expiryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 3,
  },
  expiryText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  blockedBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  blockedBannerText: {
    flex: 1,
    gap: 2,
  },
  blockedBannerTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  blockedBannerBody: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  validityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  validityText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
});

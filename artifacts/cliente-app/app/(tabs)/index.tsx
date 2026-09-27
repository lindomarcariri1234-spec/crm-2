import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { SkeletonBox } from "@/components/Skeleton";
import { NpsSurveyModal } from "@/components/NpsSurveyModal";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useRef, useState, useMemo } from "react";
import {
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { apiFetch, fmtCurrency, fmtDate, daysUntil } from "@/lib/api";
import type { ClientPortalProfile, ClientPortalReservation } from "@/lib/types";

function TravelerCard({
  profile,
  colors,
}: {
  profile: ClientPortalProfile;
  colors: ReturnType<typeof useColors>;
}) {
  const name =
    profile.client?.name ?? profile.user?.name ?? "Viajante";
  const email = profile.user?.email ?? profile.client?.email ?? "";
  const agency = profile.tenant?.name ?? "";
  const customerCode = profile.client?.customerCode ?? null;
  const referralCode = profile.client?.referralCode ?? profile.referral?.code ?? null;
  const loyalty = profile.loyalty;
  const tierLabel = loyalty?.tier
    ? TIER_LABELS[loyalty.tier] ?? loyalty.tier
    : null;
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0])
    .join("")
    .toUpperCase();

  const scaleAnim = useRef(new Animated.Value(1)).current;

  function handlePressIn() {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 30,
      bounciness: 4,
    }).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
  function handlePressOut() {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 4,
    }).start();
  }

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <LinearGradient
          colors={[colors.marromCariri, colors.azulChapada, colors.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.card}
        >
          <View style={styles.cardDecor1} />
          <View style={styles.cardDecor2} />
          <View style={styles.cardDecor3} />

          <View style={styles.cardHeader}>
            <View style={styles.avatarCircle}>
              <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>{initials}</Text>
            </View>
            <View style={styles.cardHeaderText}>
              <Text style={[styles.cardName, { color: colors.primaryForeground }]} numberOfLines={1}>
                {name}
              </Text>
              <Text style={[styles.cardEmail, { color: colors.primaryForeground + "B3" }]} numberOfLines={1}>
                {email}
              </Text>
            </View>
             {tierLabel ? (
              <View style={styles.tierBadge}>
                <Text style={[styles.tierBadgeText, { color: colors.primaryForeground }]}>
                  {tierLabel}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.cardDivider} />

          <View style={styles.cardFooter}>
            <View style={styles.cardFooterItem}>
              <Text style={[styles.cardFooterLabel, { color: colors.primaryForeground + "99" }]}>Agência</Text>
              <Text style={[styles.cardFooterValue, { color: colors.primaryForeground }]} numberOfLines={1}>
                {agency || "—"}
              </Text>
            </View>
            {customerCode ? (
              <View style={styles.cardFooterItem}>
                <Text style={[styles.cardFooterLabel, { color: colors.primaryForeground + "99" }]}>Código</Text>
                <Text style={[styles.cardFooterValue, { color: colors.primaryForeground }]}>{customerCode}</Text>
              </View>
            ) : referralCode ? (
              <View style={styles.cardFooterItem}>
                <Text style={[styles.cardFooterLabel, { color: colors.primaryForeground + "99" }]}>Indicação</Text>
                <Text style={[styles.cardFooterValue, { color: colors.primaryForeground }]}>{referralCode}</Text>
              </View>
            ) : null}
            {loyalty ? (
              <View style={styles.cardFooterItem}>
                <Text style={[styles.cardFooterLabel, { color: colors.primaryForeground + "99" }]}>Pontos</Text>
                <Text style={[styles.cardFooterValue, { color: colors.primaryForeground }]}>
                  {loyalty.availablePoints.toLocaleString("pt-BR")}
                </Text>
              </View>
            ) : null}
          </View>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

function TravelerCardSkeleton() {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.marromCariri }]}>
      <View style={styles.cardHeader}>
        <SkeletonBox width={52} height={52} borderRadius={26} />
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonBox width="60%" height={16} />
          <SkeletonBox width="80%" height={12} />
        </View>
      </View>
      <View style={styles.cardDivider} />
      <View style={styles.cardFooter}>
        <SkeletonBox width={80} height={32} borderRadius={8} />
        <SkeletonBox width={80} height={32} borderRadius={8} />
        <SkeletonBox width={80} height={32} borderRadius={8} />
      </View>
    </View>
  );
}

function NextTripBanner({
  profile,
  colors,
}: {
  profile: ClientPortalProfile;
  colors: ReturnType<typeof useColors>;
}) {
  const reservations = profile.reservations ?? [];
  const upcoming = reservations
    .filter((r) => {
      if (r.status === "cancelled") return false;
      const d = daysUntil(r.tripDepartureDate);
      return d !== null && d >= 0;
    })
    .sort((a, b) => {
      const da = daysUntil(a.tripDepartureDate) ?? 9999;
      const db = daysUntil(b.tripDepartureDate) ?? 9999;
      return da - db;
    });

  const next = upcoming[0] ?? null;
  if (!next) return null;

  const days = daysUntil(next.tripDepartureDate) ?? 0;
  const isToday = days === 0;

  return (
    <View
      style={[
        styles.nextTripBanner,
        {
          backgroundColor: isToday ? colors.success : colors.primary,
          borderColor: isToday ? colors.success : colors.primary,
        },
      ]}
    >
      <View style={styles.nextTripLeft}>
        <Feather
          name={isToday ? "check-circle" : "calendar"}
          size={20}
          color={colors.primaryForeground}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.nextTripTitle, { color: colors.primaryForeground }]} numberOfLines={1}>
            {next.tripName}
          </Text>
          <Text style={[styles.nextTripSub, { color: colors.primaryForeground + "CC" }]}>
            {isToday
              ? "Sua viagem é hoje!"
              : days === 1
              ? "Amanhã"
              : `Em ${days} dias`}{" "}
            · {fmtDate(next.tripDepartureDate)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function QuickStats({
  profile,
  colors,
}: {
  profile: ClientPortalProfile;
  colors: ReturnType<typeof useColors>;
}) {
  const reservations = profile.reservations ?? [];
  const activeCount = reservations.filter(
    (r) => r.status !== "cancelled" && r.status !== "completed"
  ).length;
  const totalTrips = reservations.filter(
    (r) => r.status === "completed"
  ).length;
  const spent = profile.stats?.totalSpent ?? 0;

  return (
    <View style={styles.statsRow}>
      <View
        style={[
          styles.statCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Feather name="calendar" size={18} color={colors.primary} />
        <Text style={[styles.statValue, { color: colors.foreground }]}>
          {activeCount}
        </Text>
        <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
          Ativas
        </Text>
      </View>
      <View
        style={[
          styles.statCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Feather name="check-circle" size={18} color={colors.success} />
        <Text style={[styles.statValue, { color: colors.foreground }]}>
          {totalTrips}
        </Text>
        <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
          Viagens
        </Text>
      </View>
      <View
        style={[
          styles.statCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Feather name="dollar-sign" size={18} color={colors.warning} />
        <Text
          style={[
            styles.statValue,
            { color: colors.foreground, fontSize: 14 },
          ]}
          numberOfLines={1}
        >
          {fmtCurrency(spent)}
        </Text>
        <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
          Investido
        </Text>
      </View>
    </View>
  );
}

function UpcomingReservations({
  profile,
  colors,
}: {
  profile: ClientPortalProfile;
  colors: ReturnType<typeof useColors>;
}) {
  const reservations = profile.reservations ?? [];
  const upcoming = reservations
    .filter((r) => {
      if (r.status === "cancelled") return false;
      const d = daysUntil(r.tripDepartureDate);
      return d !== null && d >= 0;
    })
    .sort((a, b) => {
      const da = daysUntil(a.tripDepartureDate) ?? 9999;
      const db = daysUntil(b.tripDepartureDate) ?? 9999;
      return da - db;
    })
    .slice(0, 3);

  if (upcoming.length === 0) {
    return (
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Próximas Viagens
        </Text>
        <View style={styles.emptySection}>
          <Feather name="map" size={32} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Nenhuma viagem próxima
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.sectionCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        Próximas Viagens
      </Text>
      {upcoming.map((r, idx) => {
        const days = daysUntil(r.tripDepartureDate);
        const isToday = days === 0;
        const isClose = days !== null && days <= 7 && days > 0;

        return (
          <View
            key={r.id}
            style={[
              styles.tripItem,
              {
                borderBottomColor: colors.border,
                borderBottomWidth: idx < upcoming.length - 1 ? 1 : 0,
              },
            ]}
          >
            <View
              style={[
                styles.tripDayBadge,
                {
                  backgroundColor: isToday
                    ? colors.success
                    : isClose
                    ? colors.warning + "20"
                    : colors.accent,
                },
              ]}
            >
              <Text
                style={[
                  styles.tripDayNum,
                  {
                    color: isToday
                      ? colors.primaryForeground
                      : isClose
                      ? colors.warning
                      : colors.primary,
                  },
                ]}
              >
                {isToday ? "Hoje" : days !== null ? `${days}d` : "—"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.tripItemName, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {r.tripName}
              </Text>
              <Text
                style={[styles.tripItemDate, { color: colors.mutedForeground }]}
              >
                {fmtDate(r.tripDepartureDate)}
                {r.tripDestination ? ` · ${r.tripDestination}` : ""}
              </Text>
            </View>
            <Text
              style={[styles.tripItemValue, { color: colors.primary }]}
            >
              {fmtCurrency(r.totalValue)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function LoyaltySummary({
  profile,
  colors,
}: {
  profile: ClientPortalProfile;
  colors: ReturnType<typeof useColors>;
}) {
  const loyalty = profile.loyalty;
  if (!loyalty) return null;

  const tier = loyalty.tier ?? "bronze";
  const tierLabel = TIER_LABELS[tier] ?? tier;
  const tierFg = colors.accentForeground;
  const tierBg = colors.accent;

  return (
    <LinearGradient
      colors={[colors.marromCariri, colors.azulChapada]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.loyaltyCard}
    >
      <View style={styles.loyaltyCardDecor} />
      <View style={styles.loyaltyLeft}>
        <Text style={[styles.loyaltyProgram, { color: colors.primaryForeground + "B3" }]}>{loyalty.programName || "Programa de Pontos"}</Text>
        <Text style={[styles.loyaltyPoints, { color: colors.primaryForeground }]}>
          {loyalty.availablePoints.toLocaleString("pt-BR")}
          <Text style={styles.loyaltyPts}> pts</Text>
        </Text>
        <View style={[styles.loyaltyTierBadge, { backgroundColor: tierBg }]}>
          <Text style={[styles.loyaltyTierText, { color: tierFg }]}>
            {tierLabel}
          </Text>
        </View>
      </View>
      <View style={styles.loyaltyRight}>
          <Text style={[styles.loyaltyMiniLabel, { color: colors.primaryForeground + "99" }]}>Total acumulado</Text>
          <Text style={[styles.loyaltyMiniValue, { color: colors.primaryForeground }]}>
          {loyalty.totalPoints.toLocaleString("pt-BR")} pts
        </Text>
        <Text style={[styles.loyaltyMiniLabel, { marginTop: 8, color: colors.primaryForeground + "99" }]}>
          Pts por R$1
        </Text>
        <Text style={[styles.loyaltyMiniValue, { color: colors.primaryForeground }]}>{loyalty.pointsPerReal}x</Text>
      </View>
    </LinearGradient>
  );
}

const TIER_LABELS: Record<string, string> = {
  bronze: "Bronze",
  silver: "Prata",
  gold: "Ouro",
  platinum: "Platina",
  diamond: "Diamante",
};
function pickNpsPendingReservation(
  reservations: ClientPortalReservation[],
): ClientPortalReservation | null {
  const now = new Date();
  return (
    reservations.find((r) => {
      if (r.npsSubmitted) return false;
      if (r.status === "cancelled") return false;
      const dateStr = r.tripReturnDate ?? r.tripDepartureDate;
      if (!dateStr) return false;
      return new Date(dateStr) < now;
    }) ?? null
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [npsReservation, setNpsReservation] = useState<ClientPortalReservation | null>(null);
  const [npsDismissedIds, setNpsDismissedIds] = useState<Set<string>>(new Set());

  const { data, isLoading, error, refetch, isRefetching } =
    useQuery<ClientPortalProfile>({
      queryKey: ["client-profile"],
      queryFn: async () => {
        const token = await getToken();
        return apiFetch<ClientPortalProfile>(token, "GET", "/client/me");
      },
    });

  const pendingNps = useMemo(() => {
    if (!data?.reservations) return null;
    const eligible = data.reservations.filter((r) => !npsDismissedIds.has(r.id));
    return pickNpsPendingReservation(eligible);
  }, [data?.reservations, npsDismissedIds]);

  React.useEffect(() => {
    if (pendingNps && !npsReservation) {
      setNpsReservation(pendingNps);
    }
  }, [pendingNps, npsReservation]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (isLoading) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 8, paddingBottom: insets.bottom + 100 },
        ]}
        scrollEnabled={false}
      >
        <TravelerCardSkeleton />
        <View style={styles.statsRow}>
          {[1, 2, 3].map((i) => (
            <SkeletonBox key={i} style={{ flex: 1 }} height={80} borderRadius={12} />
          ))}
        </View>
        <SkeletonBox height={160} borderRadius={14} />
        <SkeletonBox height={80} borderRadius={14} />
      </ScrollView>
    );
  }

  if (error || !data) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: colors.background, paddingTop: topPad },
        ]}
      >
        <Feather name="wifi-off" size={40} color={colors.mutedForeground} />
        <Text style={[styles.errorTitle, { color: colors.foreground }]}>
          Erro ao carregar
        </Text>
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
          {error instanceof Error ? error.message : "Tente novamente."}
        </Text>
        <Pressable
          style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          onPress={() => refetch()}
        >
          <Text style={[styles.retryBtnText, { color: colors.primaryForeground }]}>Tentar novamente</Text>
        </Pressable>
      </View>
    );
  }

  function handleNpsDismiss() {
    if (npsReservation) {
      setNpsDismissedIds((prev) => new Set([...prev, npsReservation.id]));
    }
    setNpsReservation(null);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 8, paddingBottom: insets.bottom + 100 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.greetingRow}>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
            Bom dia,
          </Text>
          <Text style={[styles.greetingName, { color: colors.foreground }]}>
            {(data.client?.name ?? data.user?.name ?? "Viajante").split(" ")[0]}
          </Text>
        </View>

        <TravelerCard profile={data} colors={colors} />

        <NextTripBanner profile={data} colors={colors} />

        <QuickStats profile={data} colors={colors} />

        <UpcomingReservations profile={data} colors={colors} />

        {data.loyalty ? <LoyaltySummary profile={data} colors={colors} /> : null}
      </ScrollView>

      {npsReservation ? (
        <NpsSurveyModal
          reservation={npsReservation}
          onDismiss={handleNpsDismiss}
          npsCategories={data?.tenant?.npsCategories}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  greetingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 2,
  },
  greeting: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  greetingName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  card: {
    borderRadius: 8,
    padding: 20,
    gap: 14,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
  cardDecor1: {
    position: "absolute",
    top: -50,
    right: -50,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  cardDecor2: {
    position: "absolute",
    bottom: -30,
    left: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardDecor3: {
    position: "absolute",
    top: 30,
    right: 80,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
  },
  avatarText: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  cardHeaderText: {
    flex: 1,
    gap: 2,
  },
  cardName: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  cardEmail: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  tierBadge: {
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  tierBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  cardDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  cardFooterItem: {
    flex: 1,
    gap: 3,
  },
  cardFooterLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardFooterValue: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  nextTripBanner: {
    borderRadius: 8,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nextTripLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  nextTripTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 1,
  },
  nextTripSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
  },
  statCard: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  sectionCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 8,
  },
  emptySection: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 20,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  tripItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  tripDayBadge: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  tripDayNum: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  tripItemName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  tripItemDate: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  tripItemValue: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  loyaltyCard: {
    borderRadius: 8,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    overflow: "hidden",
  },
  loyaltyCardDecor: {
    position: "absolute",
    top: -30,
    right: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  loyaltyLeft: {
    flex: 1,
    gap: 6,
  },
  loyaltyRight: {
    alignItems: "flex-end",
    gap: 3,
  },
  loyaltyProgram: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  loyaltyPoints: {
    fontSize: 36,
    fontFamily: "Inter_700Bold",
    lineHeight: 42,
  },
  loyaltyPts: {
    fontSize: 18,
    fontFamily: "Inter_500Medium",
  },
  loyaltyTierBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  loyaltyTierText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  loyaltyMiniLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  loyaltyMiniValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  errorTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  errorText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginTop: 8,
  },
  retryBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});

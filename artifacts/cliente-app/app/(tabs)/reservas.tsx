import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/clerk-expo";
import { SkeletonBox } from "@/components/Skeleton";
import { useQuery } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import React from "react";
import {
  ActivityIndicator,
  Alert,
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
import { apiFetch, API_BASE, fmtCurrency, fmtDate, daysUntil } from "@/lib/api";
import type { ClientPortalProfile, ClientPortalReservation } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = {
  pending: "Aguardando",
  confirmed: "Confirmado",
  completed: "Concluído",
  cancelled: "Cancelado",
  processing: "Processando",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#d97706",
  confirmed: "#2563eb",
  completed: "#16a34a",
  cancelled: "#dc2626",
  processing: "#7c3aed",
};

function StatusBadge({ status, colors }: { status: string; colors: ReturnType<typeof useColors> }) {
  const label = STATUS_LABELS[status] ?? status;
  const color = STATUS_COLORS[status] ?? colors.mutedForeground;
  return (
    <View style={[styles.badge, { backgroundColor: color + "18", borderColor: color + "40" }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

async function shareReservationText(r: ClientPortalReservation) {
  const lines: string[] = [
    `🎟️ Comprovante de Reserva`,
    `Viagem: ${r.tripName}`,
    r.tripDestination ? `Destino: ${r.tripDestination}` : null,
    r.tripDepartureDate ? `Partida: ${fmtDate(r.tripDepartureDate)}` : null,
    `Passageiros: ${r.seatsCount}`,
    `Total: ${fmtCurrency(r.totalValue)}`,
    r.reservationNumber ? `Nº Reserva: ${r.reservationNumber}` : null,
    r.voucherCode ? `Código: ${r.voucherCode}` : null,
  ].filter(Boolean) as string[];

  try {
    await Share.share({ message: lines.join("\n") });
  } catch {
  }
}

async function openVoucherPdf(
  r: ClientPortalReservation,
  token: string | null
): Promise<void> {
  if (!token) {
    await shareReservationText(r);
    return;
  }

  const cacheDir = FileSystem.cacheDirectory ?? "";
  const safe = (r.voucherCode ?? r.id).replace(/[^a-zA-Z0-9_-]/g, "_");
  const localUri = `${cacheDir}voucher_${safe}.pdf`;

  try {
    const result = await FileSystem.downloadAsync(
      `${API_BASE}/api/client/reservations/${r.id}/voucher`,
      localUri,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (result.status === 200) {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(localUri, {
          mimeType: "application/pdf",
          dialogTitle: "Comprovante de Reserva",
          UTI: "com.adobe.pdf",
        });
      } else {
        await shareReservationText(r);
      }
    } else {
      throw new Error(`Status ${result.status}`);
    }
  } catch (err) {
    console.warn("[voucher] download failed:", err);
    Alert.alert(
      "Comprovante",
      "Não foi possível abrir o PDF. Deseja compartilhar os dados da reserva?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Compartilhar", onPress: () => shareReservationText(r) },
      ]
    );
  }
}

function ReservationCard({
  r,
  token,
  colors,
}: {
  r: ClientPortalReservation;
  token: string | null;
  colors: ReturnType<typeof useColors>;
}) {
  const days = daysUntil(r.tripDepartureDate);
  const isUpcoming = days !== null && days >= 0 && days <= 30;
  const isToday = days === 0;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.tripName, { color: colors.foreground }]} numberOfLines={1}>
            {r.tripName}
          </Text>
          <StatusBadge status={r.status} colors={colors} />
        </View>
        {r.tripDestination ? (
          <View style={styles.destRow}>
            <Feather name="map-pin" size={12} color={colors.mutedForeground} />
            <Text style={[styles.destText, { color: colors.mutedForeground }]}>
              {r.tripDestination}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>Partida</Text>
          <Text style={[styles.metaValue, { color: colors.foreground }]}>
            {fmtDate(r.tripDepartureDate)}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>Total</Text>
          <Text style={[styles.metaValue, { color: colors.foreground }]}>
            {fmtCurrency(r.totalValue)}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>Passageiros</Text>
          <Text style={[styles.metaValue, { color: colors.foreground }]}>{r.seatsCount}</Text>
        </View>
      </View>

      {(isUpcoming || r.balance > 0 || r.boardingPointName) ? (
        <View style={styles.tagsRow}>
          {isToday ? (
            <View style={[styles.tag, { backgroundColor: colors.successLight }]}>
              <Text style={[styles.tagText, { color: colors.success }]}>Hoje!</Text>
            </View>
          ) : isUpcoming && days !== null && days > 0 ? (
            <View style={[styles.tag, { backgroundColor: colors.accent }]}>
              <Text style={[styles.tagText, { color: colors.primary }]}>
                {days} dia{days !== 1 ? "s" : ""}
              </Text>
            </View>
          ) : null}
          {r.balance > 0 ? (
            <View style={[styles.tag, { backgroundColor: "#fef3c7", borderColor: "#fde68a", borderWidth: 1 }]}>
              <Feather name="alert-circle" size={11} color="#d97706" />
              <Text style={[styles.tagText, { color: "#d97706" }]}>
                Saldo: {fmtCurrency(r.balance)}
              </Text>
            </View>
          ) : null}
          {r.boardingPointName ? (
            <View style={[styles.tag, { backgroundColor: colors.secondary }]}>
              <Feather name="navigation" size={11} color={colors.primary} />
              <Text style={[styles.tagText, { color: colors.primary }]} numberOfLines={1}>
                {r.boardingPointName}
                {r.boardingPointTime ? ` ${r.boardingPointTime}` : ""}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {r.reservationNumber ? (
        <Text style={[styles.reservationNumber, { color: colors.mutedForeground }]}>
          #{r.reservationNumber}
        </Text>
      ) : null}

      {/* Voucher actions */}
      <View style={[styles.voucherRow, { borderTopColor: colors.border }]}>
        <Pressable
          style={({ pressed }) => [
            styles.voucherBtn,
            { backgroundColor: colors.accent, opacity: pressed ? 0.75 : 1 },
          ]}
          onPress={() => shareReservationText(r)}
        >
          <Feather name="share-2" size={13} color={colors.primary} />
          <Text style={[styles.voucherBtnText, { color: colors.primary }]}>
            Compartilhar
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.voucherBtn,
            { backgroundColor: colors.primary + "14", opacity: pressed ? 0.75 : 1 },
          ]}
          onPress={() => openVoucherPdf(r, token)}
        >
          <Feather name="file-text" size={13} color={colors.primary} />
          <Text style={[styles.voucherBtnText, { color: colors.primary }]}>
            Ver comprovante
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function ReservasScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const { data, isLoading, error, refetch, isRefetching } = useQuery<ClientPortalProfile>({
    queryKey: ["client-profile"],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<ClientPortalProfile>(token, "GET", "/client/me");
    },
  });

  const [token, setToken] = React.useState<string | null>(null);
  React.useEffect(() => {
    getToken().then(setToken);
  }, [getToken]);

  const reservations = data?.reservations ?? [];
  const active = reservations.filter((r) => r.status !== "cancelled" && r.status !== "completed");
  const past = reservations.filter((r) => r.status === "completed" || r.status === "cancelled");

  if (isLoading) {
    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        scrollEnabled={false}
      >
        <View style={styles.section}>
          <SkeletonBox width={130} height={18} style={{ marginBottom: 10 }} />
          {[1, 2, 3].map((i) => (
            <View key={i} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <SkeletonBox width="65%" height={16} />
                  <SkeletonBox width={70} height={22} borderRadius={6} />
                </View>
                <SkeletonBox width="45%" height={13} style={{ marginTop: 4 }} />
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.metaRow}>
                <View style={styles.metaItem}><SkeletonBox height={30} /></View>
                <View style={styles.metaItem}><SkeletonBox height={30} /></View>
                <View style={styles.metaItem}><SkeletonBox height={30} /></View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="wifi-off" size={40} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Erro ao carregar</Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          {error instanceof Error ? error.message : "Tente novamente."}
        </Text>
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
      {reservations.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="calendar" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Nenhuma reserva
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Suas reservas de viagem aparecerão aqui.
          </Text>
        </View>
      ) : (
        <>
          {active.length > 0 ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Ativas ({active.length})
              </Text>
              {active.map((r) => (
                <ReservationCard key={r.id} r={r} token={token} colors={colors} />
              ))}
            </View>
          ) : null}
          {past.length > 0 ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Histórico ({past.length})
              </Text>
              {past.map((r) => (
                <ReservationCard key={r.id} r={r} token={token} colors={colors} />
              ))}
            </View>
          ) : null}
        </>
      )}
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
    gap: 8,
  },
  section: {
    gap: 10,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: {
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  tripName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  destRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  destText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  divider: {
    height: 1,
  },
  metaRow: {
    flexDirection: "row",
    gap: 16,
  },
  metaItem: {
    flex: 1,
    gap: 2,
  },
  metaLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  metaValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  tagText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  reservationNumber: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  voucherRow: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  voucherBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  voucherBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  emptyState: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 64,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});

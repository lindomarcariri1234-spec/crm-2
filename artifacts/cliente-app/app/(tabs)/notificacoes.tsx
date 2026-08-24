import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/clerk-expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

interface ClientNotification {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  data: ClientNotification[];
  unreadCount: number;
}

function notificationTitle(notification: ClientNotification): string {
  const title = notification.payload.title;
  if (typeof title === "string" && title.trim()) return title;
  const labels: Record<string, string> = {
    booking_confirmed: "Reserva confirmada",
    reservation_updated: "Reserva atualizada",
    payment_received: "Pagamento recebido",
    referral_converted: "Sua indicação foi convertida",
    referral_bonus_released: "Cashback disponível",
    referral_bonus_paid: "Cashback liberado",
    referral_link_clicked: "Seu link de indicação foi acessado",
    loyalty_tier_upgraded: "Você subiu de nível",
  };
  return labels[notification.type] ?? "Atualização da sua viagem";
}

function notificationDescription(notification: ClientNotification): string | null {
  const payload = notification.payload;
  const referredName = typeof payload.referredName === "string" ? payload.referredName : "Uma indicação";
  const bonusAmount = typeof payload.bonusAmount === "number"
    ? `R$ ${payload.bonusAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
    : null;

  switch (notification.type) {
    case "referral_converted":
      return `${referredName} concluiu uma compra pela sua indicação.`;
    case "referral_bonus_released":
    case "referral_bonus_paid":
      return bonusAmount ? `${bonusAmount} de cashback está disponível para usar em uma próxima viagem.` : "Seu cashback de indicação está disponível para usar.";
    case "referral_link_clicked":
      return "Alguém abriu o seu link. Continue compartilhando para aumentar suas chances de conversão.";
    case "loyalty_tier_upgraded":
      return typeof payload.newTierLabel === "string" ? `Parabéns, você alcançou o nível ${payload.newTierLabel}.` : "Parabéns pelo seu novo nível no programa de fidelidade.";
    default:
      return typeof payload.description === "string" ? payload.description : null;
  }
}

function notificationDestination(type: string): { path: "/indicacoes" | "/fidelidade"; label: string } | null {
  if (type.startsWith("referral_")) return { path: "/indicacoes", label: "Ver indicações" };
  if (type === "loyalty_tier_upgraded") return { path: "/fidelidade", label: "Ver fidelidade" };
  return null;
}

export default function NotificacoesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery<NotificationsResponse>({
    queryKey: ["client-notifications"],
    queryFn: async () => apiFetch<NotificationsResponse>(await getToken(), "GET", "/client/notifications"),
  });
  const readAll = useMutation({
    mutationFn: async () => apiFetch<void>(await getToken(), "POST", "/client/notifications/read-all"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["client-notifications"] }),
  });

  if (query.isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  const notifications = query.data?.data ?? [];
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.primary} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>Notificações</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {query.data?.unreadCount ? `${query.data.unreadCount} não lida${query.data.unreadCount === 1 ? "" : "s"}` : "Tudo em dia"}
          </Text>
        </View>
        {query.data?.unreadCount ? (
          <Pressable onPress={() => readAll.mutate()} disabled={readAll.isPending} accessibilityRole="button">
            <Text style={[styles.readAll, { color: colors.primary }]}>Marcar como lidas</Text>
          </Pressable>
        ) : null}
      </View>
      {notifications.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="bell-off" size={42} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nenhuma notificação</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Avisos importantes da sua agência aparecerão aqui.</Text>
        </View>
      ) : notifications.map((notification) => {
        const destination = notificationDestination(notification.type);
        const description = notificationDescription(notification);
        return (
        <Pressable
          key={notification.id}
          style={[styles.item, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={destination ? () => router.navigate(destination.path) : undefined}
          disabled={!destination}
          accessibilityRole={destination ? "button" : undefined}
        >
          <View style={[styles.icon, { backgroundColor: notification.readAt ? colors.accent : colors.primary }]}>
            <Feather name={destination ? "gift" : "bell"} size={17} color={notification.readAt ? colors.primary : "#fff"} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.itemTitle, { color: colors.foreground }]}>{notificationTitle(notification)}</Text>
            {description ? <Text style={[styles.itemDescription, { color: colors.mutedForeground }]}>{description}</Text> : null}
            <Text style={[styles.itemDate, { color: colors.mutedForeground }]}>
              {new Date(notification.createdAt).toLocaleDateString("pt-BR")}
            </Text>
          </View>
          {destination ? <Text style={[styles.action, { color: colors.primary }]}>{destination.label}</Text> : null}
          {!notification.readAt ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
        </Pressable>
      )})}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 3 },
  readAll: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  item: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 4 },
  itemTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  itemDescription: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  itemDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  action: { maxWidth: 62, fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "right" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 80, gap: 10 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
});
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import colors from "@/constants/colors";
import { API_BASE, GuideAuth, apiFetch, useAuth } from "@/context/AuthContext";

const s = colors.light;

interface ApiPassenger {
  id: string;
  name: string;
  seatNumber: string | null;
  reservationId: string;
  customerCode?: string | null;
}

interface ApiCheckin {
  passengerId: string;
  status: "present" | "absent";
  checkedInAt: string;
}

interface TripData {
  id: string;
  name: string;
  departureDate: string;
  departureTime: string | null;
  destination: string | null;
  destinationCity: string | null;
}

interface Passenger {
  id: string;
  name: string;
  seat: string | null;
  reservationId: string;
  status: "checado" | "ausente" | "pendente";
  checkedInAt: string | null;
  customerCode?: string | null;
}

const POLL_MS = 30_000;
const LOCATION_INTERVAL_MS = 30_000;
const CACHE_KEY_PREFIX = "guide_trip_cache_";

export default function TripScreen() {
  const { auth, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [trip, setTrip] = useState<TripData | null>(null);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [locationOn, setLocationOn] = useState(false);
  const [locationStatus, setLocationStatus] = useState<"idle" | "on" | "error">("idle");
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) router.replace("/");
  }, [auth]);

  function mergePassengers(apiPassengers: ApiPassenger[], checkins: ApiCheckin[]): Passenger[] {
    const checkinMap = new Map(checkins.map((c) => [c.passengerId, c]));
    return apiPassengers.map((p) => {
      const checkin = checkinMap.get(p.id);
      return {
        id: p.id,
        name: p.name,
        seat: p.seatNumber,
        reservationId: p.reservationId,
        status: checkin ? (checkin.status === "present" ? "checado" : "ausente") : "pendente",
        checkedInAt: checkin?.checkedInAt ?? null,
        customerCode: p.customerCode ?? null,
      };
    });
  }

  const fetchData = useCallback(async (silent = false) => {
    if (!auth) return;
    if (!silent) setLoading(true);
    const cacheKey = `${CACHE_KEY_PREFIX}${auth.tripId}`;
    try {
      const res = await apiFetch(`/api/guide/trip/${auth.tripId}`, auth.token);
      if (res.ok) {
        const data = await res.json() as { trip: TripData; passengers: ApiPassenger[]; checkins: ApiCheckin[] };
        setTrip(data.trip);
        setPassengers(mergePassengers(data.passengers, data.checkins));
        setIsOffline(false);
        const now = new Date().toISOString();
        setCachedAt(now);
        AsyncStorage.setItem(cacheKey, JSON.stringify({ data, cachedAt: now })).catch(() => {});
      }
    } catch {
      setIsOffline(true);
      if (!silent) {
        try {
          const raw = await AsyncStorage.getItem(cacheKey);
          if (raw) {
            const { data, cachedAt: ts } = JSON.parse(raw) as {
              data: { trip: TripData; passengers: ApiPassenger[]; checkins: ApiCheckin[] };
              cachedAt: string;
            };
            setTrip(data.trip);
            setPassengers(mergePassengers(data.passengers, data.checkins));
            setCachedAt(ts);
          }
        } catch {
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [auth]);

  useEffect(() => {
    fetchData();
    pollRef.current = setInterval(() => fetchData(true), POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchData]);

  async function sendLocation(a: GuideAuth) {
    if (Platform.OS === "web") {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(async (pos) => {
        await apiFetch(`/api/guide/trip/${a.tripId}/location`, a.token, {
          method: "POST",
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        });
      });
      return;
    }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    await apiFetch(`/api/guide/trip/${a.tripId}/location`, a.token, {
      method: "POST",
      body: JSON.stringify({ lat: loc.coords.latitude, lng: loc.coords.longitude }),
    });
  }

  async function toggleLocation() {
    if (!auth) return;
    if (locationOn) {
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current);
      locationIntervalRef.current = null;
      setLocationOn(false);
      setLocationStatus("idle");
      return;
    }
    try {
      if (Platform.OS !== "web") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permissão negada", "Ative a localização nas configurações do dispositivo.");
          setLocationStatus("error");
          return;
        }
      }
      await sendLocation(auth);
      setLocationOn(true);
      setLocationStatus("on");
      locationIntervalRef.current = setInterval(() => {
        if (auth) sendLocation(auth).catch(() => {});
      }, LOCATION_INTERVAL_MS);
    } catch {
      setLocationStatus("error");
    }
  }

  useEffect(() => {
    return () => { if (locationIntervalRef.current) clearInterval(locationIntervalRef.current); };
  }, []);

  async function handleCheckin(passenger: Passenger, newStatus: "present" | "absent") {
    if (!auth) return;
    setActionLoading(passenger.id);
    try {
      if (passenger.status !== "pendente") {
        await apiFetch(`/api/guide/trip/${auth.tripId}/checkins/${passenger.id}`, auth.token, {
          method: "DELETE",
        });
      }
      await apiFetch(`/api/guide/trip/${auth.tripId}/checkins`, auth.token, {
        method: "POST",
        body: JSON.stringify({ passengerId: passenger.id, reservationId: passenger.reservationId, status: newStatus }),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchData(true);
    } catch {
      Alert.alert("Erro", "Não foi possível atualizar o status. Tente novamente.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUndo(passenger: Passenger) {
    if (!auth) return;
    setActionLoading(passenger.id);
    try {
      await apiFetch(`/api/guide/trip/${auth.tripId}/checkins/${passenger.id}`, auth.token, {
        method: "DELETE",
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchData(true);
    } catch {
      Alert.alert("Erro", "Não foi possível desfazer. Tente novamente.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleLogout() {
    Alert.alert("Sair", "Deseja sair do aplicativo?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Sair", style: "destructive", onPress: async () => {
          if (locationIntervalRef.current) clearInterval(locationIntervalRef.current);
          await logout();
          router.replace("/");
        }
      },
    ]);
  }

  const filtered = passengers.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.seat ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const checkedCount = passengers.filter((p) => p.status === "checado").length;
  const total = passengers.length;
  const progress = total > 0 ? checkedCount / total : 0;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  if (loading && !trip) {
    return (
      <View style={[styles.center, { paddingTop: topPad }]}>
        <ActivityIndicator size="large" color={s.primary} />
      </View>
    );
  }

  function renderPassenger({ item }: { item: Passenger }) {
    const isActioning = actionLoading === item.id;
    const isPending = item.status === "pendente";
    const isChecked = item.status === "checado";

    return (
      <View style={styles.passengerCard}>
        <View style={styles.passengerLeft}>
          <View style={[
            styles.statusDot,
            isChecked && styles.statusDotChecked,
            item.status === "ausente" && styles.statusDotAbsent,
          ]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.passengerName} numberOfLines={1}>{item.name}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {item.seat ? <Text style={styles.passengerSeat}>Assento {item.seat}</Text> : null}
              {item.customerCode ? (
                <Text style={styles.passengerCode}>{item.customerCode}</Text>
              ) : null}
            </View>
          </View>
          {isChecked ? (
            <View style={styles.badge}>
              <Ionicons name="checkmark" size={12} color={s.success} />
              <Text style={[styles.badgeText, { color: s.success }]}>Embarcado</Text>
            </View>
          ) : item.status === "ausente" ? (
            <View style={[styles.badge, styles.badgeAbsent]}>
              <Ionicons name="close" size={12} color={s.destructive} />
              <Text style={[styles.badgeText, { color: s.destructive }]}>Ausente</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.passengerActions}>
          {isActioning ? (
            <View style={{ flex: 1, alignItems: "center" }}>
              <ActivityIndicator size="small" color={s.primary} />
            </View>
          ) : isPending ? (
            <>
              <Pressable style={[styles.actionBtn, styles.actionBtnSuccess]} onPress={() => handleCheckin(item, "present")}>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.actionBtnText}>Embarcar</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, styles.actionBtnDanger]} onPress={() => handleCheckin(item, "absent")}>
                <Ionicons name="close" size={16} color="#fff" />
                <Text style={styles.actionBtnText}>Ausente</Text>
              </Pressable>
            </>
          ) : isChecked ? (
            <>
              <Pressable style={[styles.actionBtn, styles.actionBtnDanger]} onPress={() => handleCheckin(item, "absent")}>
                <Ionicons name="close" size={16} color="#fff" />
                <Text style={styles.actionBtnText}>Ausente</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, styles.actionBtnGray]} onPress={() => handleUndo(item)}>
                <Ionicons name="refresh" size={14} color={s.mutedForeground} />
                <Text style={[styles.actionBtnText, { color: s.mutedForeground }]}>Desfazer</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable style={[styles.actionBtn, styles.actionBtnSuccess]} onPress={() => handleCheckin(item, "present")}>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.actionBtnText}>Embarcar</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, styles.actionBtnGray]} onPress={() => handleUndo(item)}>
                <Ionicons name="refresh" size={14} color={s.mutedForeground} />
                <Text style={[styles.actionBtnText, { color: s.mutedForeground }]}>Desfazer</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.tripName} numberOfLines={1}>{trip?.name ?? "Carregando..."}</Text>
          {trip?.destinationCity ? (
            <Text style={styles.tripDest} numberOfLines={1}>{trip.destinationCity}</Text>
          ) : trip?.destination ? (
            <Text style={styles.tripDest} numberOfLines={1}>{trip.destination}</Text>
          ) : null}
        </View>
        <Pressable onPress={handleLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color={s.mutedForeground} />
        </Pressable>
      </View>

      {isOffline ? (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#92400e" />
          <Text style={styles.offlineBannerText}>
            {cachedAt
              ? `Sem conexão — dados de ${new Date(cachedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
              : "Sem conexão com a internet"}
          </Text>
        </View>
      ) : null}

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{checkedCount}</Text>
          <Text style={styles.statLabel}>Embarcados</Text>
        </View>
        <View style={[styles.statCard, { flex: 2 }]}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as `${number}%` }]} />
          </View>
          <Text style={styles.statLabel}>{Math.round(progress * 100)}% embarcados</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
      </View>

      <Pressable
        style={[
          styles.locationBtn,
          locationOn && styles.locationBtnActive,
          locationStatus === "error" && styles.locationBtnError,
        ]}
        onPress={toggleLocation}
      >
        <Ionicons
          name={locationOn ? "location" : "location-outline"}
          size={18}
          color={locationOn ? s.primaryForeground : locationStatus === "error" ? s.destructive : s.mutedForeground}
        />
        <Text style={[
          styles.locationBtnText,
          locationOn && { color: s.primaryForeground },
          locationStatus === "error" && { color: s.destructive },
        ]}>
          {locationStatus === "error"
            ? "Sem permissão de localização"
            : locationOn
            ? "Compartilhando localização (30s)"
            : "Compartilhar localização"}
        </Text>
        {locationOn && <Ionicons name="radio" size={14} color={s.primaryForeground} />}
      </Pressable>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={s.mutedForeground} style={{ marginLeft: 12 }} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar passageiro ou assento..."
          placeholderTextColor={s.mutedForeground}
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderPassenger}
        contentContainerStyle={{ paddingBottom: botPad + 16, paddingHorizontal: 16, gap: 8 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchData(); }}
            tintColor={s.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={40} color={s.mutedForeground} />
            <Text style={styles.emptyText}>
              {search ? "Nenhum passageiro encontrado" : "Nenhum passageiro nesta viagem"}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fef3c7",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#fde68a",
  },
  offlineBannerText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#92400e",
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: s.background,
  },
  container: {
    flex: 1,
    backgroundColor: s.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: s.border,
    backgroundColor: s.card,
  },
  tripName: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: s.foreground,
  },
  tripDest: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: s.mutedForeground,
    marginTop: 2,
  },
  logoutBtn: {
    padding: 8,
    marginLeft: 8,
  },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: s.card,
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    gap: 2,
  },
  statNumber: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: s.primary,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: s.mutedForeground,
  },
  progressBar: {
    width: "100%",
    height: 8,
    backgroundColor: s.muted,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 4,
  },
  progressFill: {
    height: "100%",
    backgroundColor: s.primary,
    borderRadius: 4,
  },
  locationBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: s.muted,
    borderWidth: 1,
    borderColor: s.border,
  },
  locationBtnActive: {
    backgroundColor: s.primary,
    borderColor: s.primary,
  },
  locationBtnError: {
    borderColor: s.destructive,
    backgroundColor: "#fef2f2",
  },
  locationBtnText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: s.mutedForeground,
    flex: 1,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: s.muted,
    borderRadius: 10,
    height: 40,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: s.foreground,
  },
  passengerCard: {
    backgroundColor: s.card,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  passengerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: s.border,
    flexShrink: 0,
  },
  statusDotChecked: {
    backgroundColor: s.success,
  },
  statusDotAbsent: {
    backgroundColor: s.destructive,
  },
  passengerName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: s.foreground,
  },
  passengerSeat: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: s.mutedForeground,
    marginTop: 1,
  },
  passengerCode: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: s.mutedForeground,
    marginTop: 1,
    opacity: 0.7,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: s.successLight,
    borderRadius: 20,
  },
  badgeAbsent: {
    backgroundColor: "#fef2f2",
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  passengerActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 9,
    borderRadius: 8,
  },
  actionBtnSuccess: {
    backgroundColor: s.primary,
  },
  actionBtnDanger: {
    backgroundColor: s.destructive,
  },
  actionBtnGray: {
    backgroundColor: s.muted,
    borderWidth: 1,
    borderColor: s.border,
  },
  actionBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: s.mutedForeground,
  },
});

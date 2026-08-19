/**
 * Álbum de Viagens — trip memory album for the client portal.
 *
 * Shows past confirmed trips with agency-uploaded photos (tripMediaTable)
 * and trip videos (trips.videos). YouTube and Vimeo links play inside an
 * embedded sheet, while direct video files continue to use the system player.
 *
 * API: GET /client/me/memories
 */

import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/clerk-expo";
import { SkeletonBox } from "@/components/Skeleton";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Image,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { useColors } from "@/hooks/useColors";
import { apiFetch, fmtDate } from "@/lib/api";
import type { MemoriesResponse, TripMemory } from "@/lib/types";

// ---------------------------------------------------------------------------
// Video cards and embedded player
// ---------------------------------------------------------------------------

type EmbeddedVideo = {
  provider: "youtube" | "vimeo";
  id: string;
  thumbnailUrl: string;
  embedUrl: string;
  label: string;
};

function getEmbeddedVideo(url: string): EmbeddedVideo | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const youtubeHosts = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

  if (youtubeHosts.has(host)) {
    const candidate =
      host === "youtu.be"
        ? pathParts[0]
        : parsed.searchParams.get("v") ??
          (["embed", "shorts", "live"].includes(pathParts[0] ?? "") ? pathParts[1] : null);

    if (candidate && /^[a-zA-Z0-9_-]{6,64}$/.test(candidate)) {
      return {
        provider: "youtube",
        id: candidate,
        thumbnailUrl: `https://i.ytimg.com/vi/${candidate}/hqdefault.jpg`,
        embedUrl: `https://www.youtube.com/embed/${candidate}?autoplay=1&playsinline=1&rel=0`,
        label: "YouTube",
      };
    }
  }

  const isVimeo = host === "vimeo.com" || host === "player.vimeo.com";
  if (isVimeo) {
    const candidate = [...pathParts].reverse().find((part) => /^\d{4,20}$/.test(part));
    if (candidate) {
      return {
        provider: "vimeo",
        id: candidate,
        thumbnailUrl: `https://vumbnail.com/${candidate}.jpg`,
        embedUrl: `https://player.vimeo.com/video/${candidate}?autoplay=1&playsinline=1`,
        label: "Vimeo",
      };
    }
  }

  return null;
}

function getVideoDisplayName(url: string, index: number) {
  try {
    const parsed = new URL(url);
    const lastPathPart = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    return lastPathPart.length > 0 && lastPathPart.length <= 40 ? lastPathPart : `Vídeo ${index + 1}`;
  } catch {
    return `Vídeo ${index + 1}`;
  }
}

function VideoPlayerSheet({
  video,
  visible,
  onClose,
  colors,
}: {
  video: EmbeddedVideo;
  visible: boolean;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.playerOverlay}>
        <Pressable
          accessibilityLabel="Fechar reprodutor"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.playerSheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={styles.playerHeader}>
            <View>
              <Text style={[styles.playerTitle, { color: colors.foreground }]}>
                Reproduzindo no álbum
              </Text>
              <Text style={[styles.playerSubtitle, { color: colors.mutedForeground }]}>
                {video.label}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Fechar reprodutor"
              hitSlop={10}
              onPress={onClose}
              style={styles.playerCloseButton}
              testID="close-embedded-video"
            >
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <View style={styles.playerFrame}>
            {Platform.OS === "web" ? (
              React.createElement("iframe", {
                allow: "autoplay; fullscreen; picture-in-picture",
                allowFullScreen: true,
                src: video.embedUrl,
                style: { border: 0, height: "100%", width: "100%" },
                title: `${video.label} player`,
              })
            ) : (
              <WebView
                allowsFullscreenVideo
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                originWhitelist={["https://*"]}
                source={{ uri: video.embedUrl }}
                style={styles.webView}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function VideoCard({
  url,
  index,
  colors,
}: {
  url: string;
  index: number;
  colors: ReturnType<typeof useColors>;
}) {
  const [pressing, setPressing] = useState(false);
  const [playerVisible, setPlayerVisible] = useState(false);
  const [thumbnailErrored, setThumbnailErrored] = useState(false);
  const embeddedVideo = getEmbeddedVideo(url);

  async function handlePress() {
    if (embeddedVideo) {
      setPlayerVisible(true);
      return;
    }

    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert("Não foi possível abrir o vídeo", url);
      }
    } catch {
      Alert.alert("Erro", "Não foi possível abrir o vídeo.");
    }
  }

  const displayName = embeddedVideo?.label ?? getVideoDisplayName(url, index);

  return (
    <>
      <Pressable
        accessibilityLabel={`Reproduzir ${displayName}`}
        onPress={handlePress}
        onPressIn={() => setPressing(true)}
        onPressOut={() => setPressing(false)}
        style={[
          styles.videoCard,
          {
            backgroundColor: pressing ? "#111827" : "#1f2937",
            opacity: pressing ? 0.85 : 1,
          },
        ]}
        testID={`trip-video-${index}`}
      >
        {embeddedVideo ? (
          <View style={styles.videoThumbnail}>
            {!thumbnailErrored ? (
              <Image
                source={{ uri: embeddedVideo.thumbnailUrl }}
                style={styles.videoThumbnailImage}
                resizeMode="cover"
                onError={() => setThumbnailErrored(true)}
              />
            ) : null}
            <View style={styles.videoThumbnailShade} />
            <View style={styles.videoPlayCircle}>
              <Feather name="play" size={20} color="#ffffff" />
            </View>
          </View>
        ) : (
          <View style={styles.videoPlayCircle}>
            <Feather name="play" size={20} color="#ffffff" />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.videoCardName} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.videoCardHint}>
            {embeddedVideo ? "Toque para assistir aqui" : "Toque para reproduzir"}
          </Text>
        </View>
        <Feather
          name={embeddedVideo ? "chevron-right" : "external-link"}
          size={16}
          color="rgba(255,255,255,0.4)"
        />
      </Pressable>
      {embeddedVideo ? (
        <VideoPlayerSheet
          colors={colors}
          onClose={() => setPlayerVisible(false)}
          video={embeddedVideo}
          visible={playerVisible}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Photo thumbnail
// ---------------------------------------------------------------------------

function PhotoThumb({
  url,
  colors,
}: {
  url: string;
  colors: ReturnType<typeof useColors>;
}) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <View
        style={[styles.photoThumb, { backgroundColor: colors.secondary }]}
      >
        <Feather name="image" size={18} color={colors.mutedForeground} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: url }}
      style={styles.photoThumb}
      onError={() => setErrored(true)}
      resizeMode="cover"
    />
  );
}

// ---------------------------------------------------------------------------
// Memory card — one past trip
// ---------------------------------------------------------------------------

function MemoryCard({
  memory,
  colors,
}: {
  memory: TripMemory;
  colors: ReturnType<typeof useColors>;
}) {
  const photos = memory.media.filter((m) => m.type === "photo" || m.type === "image");
  const videos = memory.tripVideos;
  const hasContent = photos.length > 0 || videos.length > 0;

  const dest =
    [memory.tripDestinationCity, memory.tripDestinationState]
      .filter(Boolean)
      .join(", ") ||
    memory.tripDestination ||
    null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Cover image */}
      {memory.tripCoverImage ? (
        <Image
          source={{ uri: memory.tripCoverImage }}
          style={styles.coverImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.coverPlaceholder, { backgroundColor: colors.secondary }]}>
          <Feather name="camera" size={32} color={colors.mutedForeground} />
        </View>
      )}

      <View style={styles.cardBody}>
        {/* Trip header */}
        <Text style={[styles.tripName, { color: colors.foreground }]} numberOfLines={2}>
          {memory.tripName}
        </Text>
        {dest ? (
          <View style={styles.destRow}>
            <Feather name="map-pin" size={12} color={colors.mutedForeground} />
            <Text style={[styles.destText, { color: colors.mutedForeground }]}>
              {dest}
            </Text>
          </View>
        ) : null}
        <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
          {fmtDate(memory.tripDepartureDate)}
          {memory.tripReturnDate ? ` → ${fmtDate(memory.tripReturnDate)}` : ""}
        </Text>

        {!hasContent ? (
          <View style={styles.emptyContent}>
            <Feather name="image" size={24} color={colors.mutedForeground} />
            <Text style={[styles.emptyContentText, { color: colors.mutedForeground }]}>
              Ainda sem fotos ou vídeos publicados pela agência
            </Text>
          </View>
        ) : null}

        {/* Photos section */}
        {photos.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name="image" size={14} color={colors.mutedForeground} />
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                Fotos ({photos.length})
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photoRow}
            >
              {photos.map((m) => (
                <PhotoThumb key={m.id} url={m.url} colors={colors} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* Videos section */}
        {videos.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name="video" size={14} color={colors.mutedForeground} />
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                Vídeos ({videos.length})
              </Text>
            </View>
            <View style={styles.videoList}>
              {videos.map((url, i) => (
                <VideoCard key={i} url={url} index={i} colors={colors} />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function MemoriasScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const { data, isLoading, error, refetch, isRefetching } =
    useQuery<MemoriesResponse>({
      queryKey: ["client-memories"],
      queryFn: async () => {
        const token = await getToken();
        return apiFetch<MemoriesResponse>(token, "GET", "/client/me/memories");
      },
    });

  const memories = data?.memories ?? [];

  if (isLoading) {
    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        scrollEnabled={false}
      >
        {[1, 2].map((i) => (
          <View key={i} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SkeletonBox height={160} style={{ borderRadius: 0 }} />
            <View style={styles.cardBody}>
              <SkeletonBox width="70%" height={18} style={{ marginBottom: 6 }} />
              <SkeletonBox width="45%" height={13} style={{ marginBottom: 4 }} />
              <SkeletonBox width="35%" height={13} />
            </View>
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
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          {error instanceof Error ? error.message : "Tente novamente."}
        </Text>
        <Pressable
          style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          onPress={() => refetch()}
        >
          <Text style={styles.retryBtnText}>Tentar novamente</Text>
        </Pressable>
      </View>
    );
  }

  if (memories.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="camera-off" size={48} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
          Nenhuma memória ainda
        </Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Suas fotos e vídeos de viagens concluídas aparecerão aqui.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={colors.primary}
        />
      }
    >
      {memories.map((memory) => (
        <MemoryCard key={memory.reservationId} memory={memory} colors={colors} />
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scroll: {
    gap: 12,
    padding: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  coverImage: {
    width: "100%",
    height: 160,
  },
  coverPlaceholder: {
    width: "100%",
    height: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    padding: 14,
    gap: 8,
  },
  tripName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 22,
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
  dateText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  emptyContent: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 20,
  },
  emptyContentText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  section: {
    gap: 8,
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  photoRow: {
    gap: 8,
    paddingRight: 4,
  },
  photoThumb: {
    width: 90,
    height: 90,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  videoList: {
    gap: 8,
  },
  videoCard: {
    borderRadius: 12,
    overflow: "hidden",
    minHeight: 68,
    paddingRight: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  videoThumbnail: {
    width: 104,
    height: 68,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  videoThumbnailImage: {
    ...StyleSheet.absoluteFillObject,
  },
  videoThumbnailShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  videoPlayCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  playerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  playerSheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  playerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  playerTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  playerSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  playerCloseButton: {
    padding: 4,
  },
  playerFrame: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
  },
  webView: {
    flex: 1,
    backgroundColor: "#000000",
  },
  videoCardName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#ffffff",
    marginBottom: 2,
  },
  videoCardHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)",
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  emptyText: {
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
    color: "#ffffff",
  },
});

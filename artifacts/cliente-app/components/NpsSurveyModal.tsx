import { useAuth } from "@clerk/clerk-expo";
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import type { ClientPortalReservation } from "@/lib/types";

type NpsCategories = {
  transport?: boolean;
  service?: boolean;
  organization?: boolean;
  guide?: boolean;
} | null | undefined;

interface NpsSurveyModalProps {
  reservation: ClientPortalReservation;
  onDismiss: () => void;
  npsCategories?: NpsCategories;
}

const STAR_LABELS = ["Péssimo", "Ruim", "Regular", "Bom", "Excelente"];

const CATEGORY_DEFS: { key: keyof NonNullable<NpsCategories>; label: string; emoji: string }[] = [
  { key: "transport", label: "Transporte", emoji: "🚌" },
  { key: "service", label: "Atendimento", emoji: "🤝" },
  { key: "organization", label: "Organização", emoji: "📋" },
  { key: "guide", label: "Guia", emoji: "🧭" },
];

function isCategoryEnabled(categories: NpsCategories, key: keyof NonNullable<NpsCategories>): boolean {
  if (!categories) return false;
  return categories[key] !== false;
}

function hasAnyCategory(categories: NpsCategories): boolean {
  return CATEGORY_DEFS.some(({ key }) => isCategoryEnabled(categories, key));
}

export function NpsSurveyModal({ reservation, onDismiss, npsCategories }: NpsSurveyModalProps) {
  const colors = useColors();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [selectedStar, setSelectedStar] = useState(0);
  const [categoryScores, setCategoryScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledCategories = CATEGORY_DEFS.filter(({ key }) => isCategoryEnabled(npsCategories, key));
  const showCategories = hasAnyCategory(npsCategories);

  async function handleSubmit() {
    if (selectedStar === 0) {
      setError("Selecione uma nota antes de enviar.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      const payload: Record<string, unknown> = {
        reservationId: reservation.id,
        score: selectedStar * 2,
        comment: comment.trim() || null,
      };
      if (showCategories) {
        if (isCategoryEnabled(npsCategories, "transport") && categoryScores["transport"]) {
          payload["scoreTransport"] = categoryScores["transport"];
        }
        if (isCategoryEnabled(npsCategories, "service") && categoryScores["service"]) {
          payload["scoreService"] = categoryScores["service"];
        }
        if (isCategoryEnabled(npsCategories, "organization") && categoryScores["organization"]) {
          payload["scoreOrganization"] = categoryScores["organization"];
        }
        if (isCategoryEnabled(npsCategories, "guide") && categoryScores["guide"]) {
          payload["scoreGuide"] = categoryScores["guide"];
        }
      }
      await apiFetch(token, "POST", "/client/nps", payload);
      setSubmitted(true);
      await queryClient.invalidateQueries({ queryKey: ["client-profile"] });
      setTimeout(onDismiss, 1600);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao enviar avaliação.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onDismiss}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={{ maxHeight: "90%" }}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.sheet, { backgroundColor: colors.card, shadowColor: colors.foreground }]}>
            {submitted ? (
              <View style={styles.thankYou}>
                <Text style={styles.thankYouEmoji}>🎉</Text>
                <Text style={[styles.thankYouTitle, { color: colors.foreground }]}>
                  Obrigado pela avaliação!
                </Text>
                <Text style={[styles.thankYouSub, { color: colors.mutedForeground }]}>
                  Seu feedback nos ajuda a melhorar.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.header}>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    Como foi sua viagem?
                  </Text>
                  <Text style={[styles.tripName, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {reservation.tripName}
                    {reservation.tripDestination ? ` · ${reservation.tripDestination}` : ""}
                  </Text>
                </View>

                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Pressable
                      key={star}
                      onPress={() => {
                        setSelectedStar(star);
                        setError(null);
                      }}
                      style={styles.starBtn}
                      hitSlop={8}
                    >
                      <Text style={[styles.star, { color: star <= selectedStar ? "#f59e0b" : colors.border }]}>
                        ★
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {selectedStar > 0 && (
                  <Text style={[styles.starLabel, { color: "#f59e0b" }]}>
                    {STAR_LABELS[selectedStar - 1]}
                  </Text>
                )}

                {showCategories && enabledCategories.length > 0 && (
                  <View style={[styles.categoriesSection, { borderTopColor: colors.border }]}>
                    <Text style={[styles.categoriesTitle, { color: colors.mutedForeground }]}>
                      Avalie por categoria (opcional)
                    </Text>
                    {enabledCategories.map(({ key, label, emoji }) => {
                      const score = categoryScores[key] ?? 0;
                      return (
                        <View key={key} style={styles.categoryRow}>
                          <Text style={[styles.categoryLabel, { color: colors.foreground }]}>
                            {emoji} {label}
                          </Text>
                          <View style={styles.categoryStars}>
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Pressable
                                key={s}
                                onPress={() =>
                                  setCategoryScores((prev) => ({
                                    ...prev,
                                    [key]: prev[key] === s ? 0 : s,
                                  }))
                                }
                                hitSlop={6}
                              >
                                <Text style={[styles.catStar, { color: s <= score ? "#f59e0b" : colors.border }]}>
                                  ★
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                <TextInput
                  style={[
                    styles.commentInput,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                  placeholder="Deixe um comentário (opcional)..."
                  placeholderTextColor={colors.mutedForeground}
                  value={comment}
                  onChangeText={setComment}
                  multiline
                  numberOfLines={3}
                  maxLength={500}
                  textAlignVertical="top"
                />

                {error ? (
                  <Text style={styles.errorText}>{error}</Text>
                ) : null}

                <View style={styles.actions}>
                  <Pressable
                    style={[styles.dismissBtn, { borderColor: colors.border }]}
                    onPress={onDismiss}
                    disabled={submitting}
                  >
                    <Text style={[styles.dismissBtnText, { color: colors.mutedForeground }]}>
                      Agora não
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.submitBtn,
                      { backgroundColor: selectedStar > 0 ? colors.primary : colors.border },
                    ]}
                    onPress={handleSubmit}
                    disabled={submitting || selectedStar === 0}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.submitBtnText}>Enviar</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    gap: 16,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 12,
  },
  header: {
    gap: 4,
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  tripName: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  starsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
  },
  starBtn: {
    padding: 4,
  },
  star: {
    fontSize: 48,
  },
  starLabel: {
    textAlign: "center",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginTop: -8,
  },
  categoriesSection: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 10,
  },
  categoriesTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  categoryLabel: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  categoryStars: {
    flexDirection: "row",
    gap: 2,
  },
  catStar: {
    fontSize: 28,
  },
  commentInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 72,
  },
  errorText: {
    color: "#dc2626",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  dismissBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: "center",
  },
  dismissBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  submitBtn: {
    flex: 2,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtnText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  thankYou: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 8,
  },
  thankYouEmoji: {
    fontSize: 48,
  },
  thankYouTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  thankYouSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});

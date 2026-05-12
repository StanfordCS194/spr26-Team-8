import { MarkdownishBoldLine } from "@/components/MarkdownishBoldLine";
import { MiniChatWindow } from "@/components/MiniChatWindow";
import { exportChatTextToFile } from "@/lib/chatExport";
import {
  parseWeeklyRecapBullets,
  resolveNudgeTapAction,
  type ParsedNudgeBullet,
} from "@/lib/nudgeBullet";
import { buildTentativePlanPrompt } from "@/lib/nudgePrompt";
import {
  loadSavedChatOutputs,
  removeSavedChatOutput,
  updateSavedChatOutputTitle,
  type SavedChatOutput,
} from "@/lib/savedChatOutputs";
import { track } from "@/lib/posthog";
import { fetchWeeklyRecap, generateWeeklyRecap } from "@/lib/weeklyRecap";
import { utcWeekAnchorMonday } from "@/lib/weekAnchor";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";

export default function NotificationsTab() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nudges, setNudges] = useState<ParsedNudgeBullet[]>([]);
  // only fire recap_viewed once per session even if user navigates away and back
  const recapViewedFired = useRef(false);
  const [saved, setSaved] = useState<SavedChatOutput[]>([]);
  const [selectedSaved, setSelectedSaved] = useState<SavedChatOutput | null>(null);
  const [editingSaved, setEditingSaved] = useState<SavedChatOutput | null>(null);
  const [editTitleDraft, setEditTitleDraft] = useState("");

  const handleRemoveSaved = useCallback((item: SavedChatOutput) => {
    Alert.alert("Remove saved output", "Delete this saved output? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void removeSavedChatOutput(item.id).then((next) => {
            setSaved(next);
            setSelectedSaved((cur) => (cur?.id === item.id ? null : cur));
          });
        },
      },
    ]);
  }, []);

  const handleDownloadSaved = useCallback((item: SavedChatOutput) => {
    track("chat_response_shared", { saved_id: item.id });
    void exportChatTextToFile(item.title, item.full_text)
      .then(() => Alert.alert("Download", "Use the share sheet to save this to Files."))
      .catch((err) =>
        Alert.alert(
          "Download failed",
          err instanceof Error ? err.message : "Could not export saved output."
        )
      );
  }, []);

  const handleOpenEditTitle = useCallback((item: SavedChatOutput) => {
    setEditingSaved(item);
    setEditTitleDraft(item.title);
  }, []);

  const handleSaveEditedTitle = useCallback(() => {
    if (!editingSaved) return;
    const nextTitle = editTitleDraft.trim();
    if (!nextTitle) {
      Alert.alert("Title required", "Please enter a title.");
      return;
    }
    if (nextTitle === editingSaved.title.trim()) {
      setEditingSaved(null);
      return;
    }
    void updateSavedChatOutputTitle(editingSaved.id, nextTitle).then((next) => {
      setSaved(next);
      setSelectedSaved((cur) =>
        cur?.id === editingSaved.id ? (next.find((x) => x.id === cur.id) ?? cur) : cur
      );
      setEditingSaved(null);
    });
  }, [editingSaved, editTitleDraft]);

  const refresh = useCallback(async (opts?: { mode?: "initial" | "pull" }) => {
    const mode = opts?.mode ?? "initial";
    setError(null);
    if (mode === "pull") setPullRefreshing(true);
    else setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        setNudges([]);
        setSaved([]);
        return;
      }
      const row = await fetchWeeklyRecap(utcWeekAnchorMonday());
      const parsed = row ? parseWeeklyRecapBullets(row.bullets) : [];
      setNudges(parsed);
      if (row && parsed.length > 0 && !recapViewedFired.current) {
        recapViewedFired.current = true;
        track("recap_viewed", { bullet_count: parsed.length });
      }
      setSaved(await loadSavedChatOutputs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications.");
    } finally {
      if (mode === "pull") setPullRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh({ mode: "initial" });
      return undefined;
    }, [refresh])
  );

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const row = await generateWeeklyRecap();
      const parsed = row ? parseWeeklyRecapBullets(row.bullets) : [];
      setNudges(parsed);
      if (row && parsed.length > 0 && !recapViewedFired.current) {
        recapViewedFired.current = true;
        track("recap_viewed", { bullet_count: parsed.length, generated: 1 });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate notifications.");
    } finally {
      setGenerating(false);
    }
  }, []);

  const subtitle = useMemo(
    () => {
      const n = nudges.length;
      const s = saved.length;
      const nPart = `${n} ${n === 1 ? "nudge" : "nudges"}`;
      const sPart = `${s} saved`;
      return `${nPart} • ${sPart}`;
    },
    [nudges.length, saved.length]
  );

  return (
    <View className="flex-1 bg-[#F4F0EA]">
      <SafeAreaView className="flex-1 bg-[#F4F0EA]" edges={["left", "right", "bottom"]}>
        <View className="flex-row items-center justify-end px-5 pt-2">
          <MiniChatWindow />
        </View>
        <Text className="px-5 pt-1 text-4xl font-bold tracking-[-0.5px] text-[#0B0B0B]">Inbox</Text>
        <Text className="px-5 pb-2 pt-1 text-xs font-medium uppercase tracking-[0.2em] text-[#6B6B6B]">
          {subtitle}
        </Text>

        <ScrollView
          className="flex-1 px-5"
          contentContainerClassName="pb-6"
          refreshControl={
            <RefreshControl
              refreshing={pullRefreshing}
              onRefresh={() => void refresh({ mode: "pull" })}
              tintColor="#0B0B0B"
            />
          }
        >
          {/* Nudges */}
          <View className="mt-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6B6B6B]">
                Action items
              </Text>
              <Pressable
                onPress={() => void handleGenerate()}
                disabled={generating}
                className="flex-row items-center gap-1.5 rounded-full bg-[#0B0B0B] px-3 py-2 active:opacity-80 disabled:opacity-50"
              >
                {generating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="sparkles-outline" size={16} color="#FFFFFF" />
                )}
                <Text className="text-sm font-semibold text-white">
                  {generating ? "Generating…" : "Refresh"}
                </Text>
              </Pressable>
            </View>

            {loading ? (
              <View className="mt-3 flex-row items-center gap-2">
                <ActivityIndicator size="small" color="#0B0B0B" />
                <Text className="text-sm text-[#5F5F5F]">Loading nudges…</Text>
              </View>
            ) : nudges.length === 0 ? (
              <View className="mt-3 rounded-3xl border border-[#E8E0D4] bg-white p-4">
                <Text className="text-base font-semibold text-[#0B0B0B]">No nudges yet</Text>
                <Text className="mt-1 text-sm leading-5 text-[#6B6B6B]">
                  Generate your weekly recap to get a few quick nudges here.
                </Text>
              </View>
            ) : (
              <View className="mt-3 gap-2.5">
                {nudges.map((nudge, idx) => {
                  const line = nudge.displayLine;
                  const action = resolveNudgeTapAction(nudge);
                  const iconName =
                    action === "library"
                      ? "image-outline"
                      : action === "none"
                        ? "information-circle-outline"
                        : "sparkles-outline";
                  const body = (
                    <View className="flex-row items-start gap-1">
                      <MarkdownishBoldLine
                        line={line}
                        className="min-w-0 flex-1 text-[15px] leading-[22px] text-[#1A1A1A]"
                        boldClassName="font-semibold"
                      />
                      {action === "chat" || action === "library" ? (
                        <Ionicons name="chevron-forward" size={16} color="#8A8278" />
                      ) : null}
                    </View>
                  );
                  return (
                    <View
                      key={`${idx}-${line.slice(0, 24)}`}
                      className="overflow-hidden rounded-2xl border border-[#E6E1DA] bg-[#FFFCF8] px-3.5 py-3 shadow-sm"
                    >
                      <View className="flex-row items-start gap-2.5">
                        <View className="mt-0.5 h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5">
                          <Ionicons name={iconName} size={14} color="#0B0B0B" />
                        </View>
                        <View className="min-w-0 flex-1">
                          {action === "none" ? (
                            <View accessibilityRole="text" accessibilityLabel={`Tip: ${line}`}>
                              {body}
                            </View>
                          ) : (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={
                                action === "library"
                                  ? "Open source image in Library"
                                  : "Get a tentative plan in chat"
                              }
                              onPress={() => {
                                if (action === "library" && nudge.memoryId) {
                                  track("nudge_tapped", {
                                    action: "library",
                                    memory_id: nudge.memoryId,
                                  });
                                  router.push({
                                    pathname: "/archive",
                                    params: { openMemoryId: nudge.memoryId },
                                  });
                                  return;
                                }
                                track("nudge_tapped", { action: "chat" });
                                router.push({
                                  pathname: "/action",
                                  params: {
                                    prompt: buildTentativePlanPrompt(line),
                                    autosend: "1",
                                  },
                                });
                              }}
                              className="active:opacity-80"
                            >
                              {body}
                            </Pressable>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Saved */}
          <View className="mt-8">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6B6B6B]">
                Saved from chat
              </Text>
              <View className="flex-row items-center gap-1 rounded-full border border-[#E6E1DA] bg-white px-3 py-2">
                <Ionicons name="bookmark-outline" size={16} color="#0B0B0B" />
                <Text className="text-sm font-semibold text-[#0B0B0B]">{saved.length}</Text>
              </View>
            </View>

            {saved.length === 0 ? (
              <View className="mt-3 overflow-hidden rounded-3xl border border-[#E8E0D4] bg-white">
                <View className="flex-row items-start gap-3 px-4 pb-4 pt-4">
                  <View className="mt-0.5 h-10 w-10 items-center justify-center rounded-2xl bg-[#0B0B0B]">
                    <Ionicons name="bookmark" size={18} color="#FFFCF7" />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-base font-semibold text-[#0B0B0B]">
                      Save outputs you want to reuse
                    </Text>
                    <Text className="mt-1 text-sm leading-5 text-[#6B6B6B]">
                      Tap Save on assistant responses to store recipes, checklists, drafts, and more here.
                    </Text>
                  </View>
                </View>
                <View className="border-t border-[#F0EBE2] bg-[#FFFCF7] px-4 py-3">
                  <Text className="text-xs font-medium uppercase tracking-[0.16em] text-[#8A8278]">
                    Tip
                  </Text>
                  <Text className="mt-1 text-sm leading-5 text-[#5F5F5F]">
                    When you see something useful, you’ll tap a bookmark to save it here.
                  </Text>
                </View>
              </View>
            ) : (
              <View className="mt-3 gap-2.5">
                {saved.map((item) => (
                  <View
                    key={item.id}
                    className="overflow-hidden rounded-2xl border border-[#E6E1DA] bg-white px-4 py-3 shadow-sm"
                  >
                    <View className="flex-row items-start gap-2">
                      <Pressable
                        onPress={() => setSelectedSaved(item)}
                        accessibilityRole="button"
                        accessibilityLabel="Open saved output"
                        className="min-w-0 flex-1 active:opacity-80"
                      >
                        <Text className="text-[15px] font-semibold leading-5 text-[#0B0B0B]">
                          {item.title}
                        </Text>
                        <Text className="mt-1 text-sm leading-5 text-[#6B6B6B]" numberOfLines={2}>
                          {item.preview}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Edit saved output title"
                        onPress={() => handleOpenEditTitle(item)}
                        className="rounded-full p-1.5 active:bg-black/5"
                      >
                        <Ionicons name="create-outline" size={18} color="#8A8278" />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Delete saved output"
                        onPress={() => handleRemoveSaved(item)}
                        className="rounded-full p-1.5 active:bg-black/5"
                      >
                        <Ionicons name="trash-outline" size={18} color="#8A8278" />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Download saved output"
                        onPress={() => handleDownloadSaved(item)}
                        className="rounded-full p-1.5 active:bg-black/5"
                      >
                        <Ionicons name="download-outline" size={18} color="#8A8278" />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {error ? (
            <View className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-3 py-3">
              <Text className="text-sm leading-5 text-red-800">{error}</Text>
            </View>
          ) : null}

        </ScrollView>

        <Modal
          visible={Boolean(selectedSaved)}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedSaved(null)}
        >
          <View className="flex-1">
            <Pressable
              className="absolute inset-0 bg-black/40"
              onPress={() => setSelectedSaved(null)}
              accessibilityLabel="Close saved output"
            />
            <View className="absolute inset-0 items-center justify-center px-5">
              <View className="max-h-[78%] w-full overflow-hidden rounded-3xl border border-[#E6E1DA] bg-white">
                <View className="flex-row items-center justify-between border-b border-[#F0EBE2] px-4 py-3">
                  <Text className="min-w-0 flex-1 pr-3 text-base font-semibold text-[#0B0B0B]">
                    Saved output
                  </Text>
                  <View className="flex-row items-center gap-1">
                    {selectedSaved ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Edit saved output title"
                        onPress={() => handleOpenEditTitle(selectedSaved)}
                        className="rounded-full p-1 active:bg-black/5"
                      >
                        <Ionicons name="create-outline" size={20} color="#8A8278" />
                      </Pressable>
                    ) : null}
                    {selectedSaved ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Download saved output"
                        onPress={() => handleDownloadSaved(selectedSaved)}
                        className="rounded-full p-1 active:bg-black/5"
                      >
                        <Ionicons name="download-outline" size={20} color="#8A8278" />
                      </Pressable>
                    ) : null}
                    {selectedSaved ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Delete saved output"
                        onPress={() => handleRemoveSaved(selectedSaved)}
                        className="rounded-full p-1 active:bg-black/5"
                      >
                        <Ionicons name="trash-outline" size={20} color="#8A8278" />
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Close saved output"
                      onPress={() => setSelectedSaved(null)}
                      className="rounded-full p-1 active:bg-black/5"
                    >
                      <Ionicons name="close" size={20} color="#2C2C2C" />
                    </Pressable>
                  </View>
                </View>
                <ScrollView className="px-4 py-3" contentContainerClassName="pb-5">
                  {selectedSaved ? (
                    <>
                      <Text className="text-lg font-semibold text-[#0B0B0B]">{selectedSaved.title}</Text>
                      <Text className="mt-2 text-base leading-6 text-[#2C2C2C]">
                        {selectedSaved.full_text}
                      </Text>
                    </>
                  ) : null}
                </ScrollView>
              </View>
            </View>
          </View>
        </Modal>
        <Modal
          visible={Boolean(editingSaved)}
          transparent
          animationType="fade"
          onRequestClose={() => setEditingSaved(null)}
        >
          <View className="flex-1">
            <Pressable
              className="absolute inset-0 bg-black/40"
              onPress={() => setEditingSaved(null)}
              accessibilityLabel="Close edit title"
            />
            <View className="absolute inset-0 items-center justify-center px-5">
              <View className="w-full max-w-md rounded-3xl border border-[#E6E1DA] bg-white px-4 py-4">
                <Text className="text-base font-semibold text-[#0B0B0B]">Edit title</Text>
                <TextInput
                  value={editTitleDraft}
                  onChangeText={setEditTitleDraft}
                  placeholder="Enter title"
                  placeholderTextColor="#8A8278"
                  className="mt-3 rounded-2xl border border-[#E6E1DA] px-3 py-2.5 text-base text-[#0B0B0B]"
                  autoFocus
                  maxLength={56}
                />
                <View className="mt-4 flex-row items-center justify-end gap-2">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel title edit"
                    onPress={() => setEditingSaved(null)}
                    className="rounded-full border border-[#E6E1DA] px-4 py-2 active:opacity-80"
                  >
                    <Text className="text-sm font-semibold text-[#5F5F5F]">Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save title"
                    onPress={handleSaveEditedTitle}
                    className="rounded-full bg-[#0B0B0B] px-4 py-2 active:opacity-80"
                  >
                    <Text className="text-sm font-semibold text-white">Save</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

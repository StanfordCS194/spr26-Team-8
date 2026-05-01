import {
  clearDismissedWeekAnchor,
  dismissWeekAnchor,
  getDismissedWeekAnchor,
  getWeeklyNudgeEnabled,
  setWeeklyNudgeEnabled,
  subscribeNudgePreferenceChanges,
} from "@/lib/nudgePrefs";
import { supabase } from "@/lib/supabase";
import { utcWeekAnchorMonday } from "@/lib/weekAnchor";
import {
  fetchWeeklyRecap,
  generateWeeklyRecap,
  WEEKLY_RECAP_LINE_COUNT,
  type WeeklyRecapRow,
} from "@/lib/weeklyRecap";
import { MarkdownishBoldLine } from "@/components/MarkdownishBoldLine";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

/** Split model output into clean lines for list UI (legacy rows may exceed three). */
function parseBulletLines(raw: string): string[] {
  return raw
    .split(/\n/)
    .map((line) =>
      line
        .replace(/^\s*[-*•]\s*/, "")
        .replace(/^\s*\d+[.)]\s*/, "")
        .trim()
    )
    .filter((line) => line.length > 0);
}

/**
 * Weekly intent recap for the Action tab — polished card above the chat thread.
 */

export function WeeklyRecapCard({
  onPickPrompt,
}: {
  onPickPrompt?: (prompt: string) => void;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [weekAnchor] = useState(() => utcWeekAnchorMonday());
  const [prefsOn, setPrefsOn] = useState(true);
  const [recap, setRecap] = useState<WeeklyRecapRow | null>(null);
  const [dismissedAnchor, setDismissedAnchor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [errorHint, setErrorHint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      setUserId(uid);
      if (!uid) {
        setLoading(false);
        return;
      }

      const [on, dismissed, recapRow] = await Promise.all([
        getWeeklyNudgeEnabled(),
        getDismissedWeekAnchor(uid),
        fetchWeeklyRecap(weekAnchor),
      ]);

      setPrefsOn(on);
      setDismissedAnchor(dismissed);
      setRecap(recapRow);
      setErrorHint(null);
      setLoading(false);
    } catch (e) {
      setErrorHint(e instanceof Error ? e.message : "Could not load weekly nudges.");
      setLoading(false);
    }
  }, [weekAnchor]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return undefined;
    }, [refresh])
  );

  useEffect(() => {
    const unsub = subscribeNudgePreferenceChanges(() => {
      void refresh();
    });
    return unsub;
  }, [refresh]);

  const tryGenerate = useCallback(async () => {
    if (!userId) return;
    setGenerating(true);
    setErrorHint(null);
    try {
      const row = await generateWeeklyRecap();
      if (row) {
        setRecap({
          week_anchor: row.week_anchor,
          bullets: row.bullets,
          created_at: new Date().toISOString(),
        });
        setDismissedAnchor(null);
      }
    } catch (e) {
      setErrorHint(e instanceof Error ? e.message : "Could not generate recap.");
    } finally {
      setGenerating(false);
    }
  }, [userId]);

  const onDismiss = useCallback(async () => {
    if (!userId) return;
    await dismissWeekAnchor(userId, weekAnchor);
    setDismissedAnchor(weekAnchor);
  }, [userId, weekAnchor]);

  const onShowAgain = useCallback(async () => {
    if (!userId) return;
    await clearDismissedWeekAnchor(userId);
    setDismissedAnchor(null);
  }, [userId]);

  const onEnable = useCallback(async () => {
    await setWeeklyNudgeEnabled(true);
    setPrefsOn(true);
  }, []);

  const bulletLines = useMemo(
    () => (recap ? parseBulletLines(recap.bullets) : []),
    [recap]
  );

  const displayLines = useMemo(
    () => bulletLines.slice(0, WEEKLY_RECAP_LINE_COUNT),
    [bulletLines]
  );

  const longTextFallback = Boolean(recap && bulletLines.length === 0 && recap.bullets.trim());

  if (loading || !userId) return null;

  if (!prefsOn) {
    return (
      <View className="mb-5 overflow-hidden rounded-3xl border border-[#E8E0D4] bg-white">
        <View className="border-b border-[#F0EBE2] bg-[#FFFCF7] px-4 pb-3 pt-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1 flex-row items-start gap-3">
              <View className="mt-0.5 h-10 w-10 items-center justify-center rounded-2xl bg-[#0B0B0B]">
                <Ionicons name="sparkles" size={20} color="#FFFCF7" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-lg font-bold tracking-[-0.3px] text-[#0B0B0B]">Your week</Text>
                <Text className="mt-0.5 text-sm leading-5 text-[#6B6B6B]">
                  Weekly nudges are turned off
                </Text>
              </View>
            </View>
          </View>
        </View>
        <View className="px-4 pb-4 pt-3">
          <Pressable
            onPress={() => void onEnable()}
            className="flex-row items-center justify-center gap-2 rounded-2xl bg-[#0B0B0B] py-3.5 active:opacity-90"
          >
            <Ionicons name="toggle" size={18} color="#FFF" />
            <Text className="text-base font-semibold text-white">Turn on nudges</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (dismissedAnchor === weekAnchor) {
    return (
      <View className="mb-5 overflow-hidden rounded-3xl border border-[#E8E0D4] bg-white">
        <View className="border-b border-[#F0EBE2] bg-[#FFFCF7] px-4 pb-3 pt-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1 flex-row items-start gap-3">
              <View className="mt-0.5 h-10 w-10 items-center justify-center rounded-2xl bg-[#0B0B0B]">
                <Ionicons name="sparkles" size={20} color="#FFFCF7" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-lg font-bold tracking-[-0.3px] text-[#0B0B0B]">Your week</Text>
                <Text className="mt-0.5 text-sm leading-5 text-[#6B6B6B]">
                  Hidden for this week
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => void onShowAgain()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Show weekly recap again"
              className="rounded-full bg-[#F4F0EA] px-3 py-2 active:opacity-80"
            >
              <Text className="text-sm font-semibold text-[#0B0B0B]">Show</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const isSetupHint =
    Boolean(errorHint) &&
    (errorHint!.includes("Weekly recap tables") ||
      errorHint!.includes("supabase/migrations") ||
      errorHint!.toLowerCase().includes("could not find the table"));

  const cardShadow = Platform.select({
    ios: {
      shadowColor: "#1A1208",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.08,
      shadowRadius: 16,
    },
    android: { elevation: 4 },
    default: {},
  });

  return (
    <View
      className="mb-5 overflow-hidden rounded-3xl border border-[#E8E0D4] bg-white"
      style={cardShadow}
    >
      <View className="border-b border-[#F0EBE2] bg-[#FFFCF7] px-4 pb-3 pt-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1 flex-row items-start gap-3">
            <View className="mt-0.5 h-10 w-10 items-center justify-center rounded-2xl bg-[#0B0B0B]">
              <Ionicons name="sparkles" size={20} color="#FFFCF7" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-lg font-bold tracking-[-0.3px] text-[#0B0B0B]">Your week</Text>
              <Text className="mt-0.5 text-sm leading-5 text-[#6B6B6B]">
                Three quick nudges from what you’ve saved & chatted about
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => void onDismiss()}
            hitSlop={10}
            accessibilityLabel="Hide weekly recap for this week"
            className="rounded-full p-1.5 active:bg-black/5"
          >
            <Ionicons name="close" size={22} color="#8A8278" />
          </Pressable>
        </View>
      </View>

      <View className="px-4 pb-4 pt-3">
        {!recap ? (
          <View className="gap-4">
            <View className="flex-row items-center gap-2 rounded-2xl bg-[#F4F0EA] px-3 py-2.5">
              <Ionicons name="images-outline" size={18} color="#5C534A" />
              <Text className="flex-1 text-sm leading-5 text-[#4A4540]">
                We’ll pull from your Library “I want to…” lines and this conversation.
              </Text>
            </View>
            <Pressable
              onPress={() => void tryGenerate()}
              disabled={generating}
              className="flex-row items-center justify-center gap-2 rounded-2xl bg-[#0B0B0B] py-3.5 active:opacity-90 disabled:opacity-40"
            >
              {generating ? (
                <>
                  <ActivityIndicator color="#FFF" />
                  <Text className="text-base font-semibold text-white">Putting it together…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="create-outline" size={20} color="#FFF" />
                  <Text className="text-base font-semibold text-white">Build my recap</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : longTextFallback ? (
          <View>
            {expanded ? (
              <ScrollView
                style={{ maxHeight: 280 }}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                <Text className="text-[15px] leading-6 text-[#2C2C2C]">{recap.bullets}</Text>
              </ScrollView>
            ) : (
              <Pressable onPress={() => setExpanded(true)}>
                <Text className="text-[15px] leading-6 text-[#2C2C2C]" numberOfLines={6}>
                  {recap.bullets}
                </Text>
              </Pressable>
            )}
            <View className="mt-3 flex-row items-center justify-between">
              {recap.bullets.length > 200 ? (
                <Pressable
                  onPress={() => setExpanded(!expanded)}
                  className="flex-row items-center gap-1"
                >
                  <Text className="text-sm font-semibold text-[#0B7AEE]">
                    {expanded ? "Show less" : "Read more"}
                  </Text>
                  <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color="#0B7AEE"
                  />
                </Pressable>
              ) : (
                <View />
              )}
              <Pressable
                disabled={generating}
                onPress={() => void tryGenerate()}
                className="flex-row items-center gap-1.5 rounded-full bg-[#F4F0EA] px-3 py-2 active:opacity-80"
              >
                <Ionicons name="refresh" size={16} color="#0B0B0B" />
                <Text className="text-sm font-semibold text-[#0B0B0B]">Refresh</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View>
            <View className="gap-2.5">
              {displayLines.map((line, i) => (
                <Pressable
                  key={`${i}-${line.slice(0, 24)}`}
                  accessibilityRole="button"
                  onPress={() => onPickPrompt?.(line)}
                  disabled={!onPickPrompt}
                  className="overflow-hidden rounded-2xl border border-[#E6E1DA] bg-[#FFFCF8] px-3.5 py-3 shadow-sm active:opacity-70 disabled:opacity-100"
                >
                  <View className="flex-row items-start gap-2.5">
                    <View className="mt-0.5 h-6 w-6 items-center justify-center rounded-full bg-black/5">
                      <Ionicons name="chatbubble-ellipses-outline" size={14} color="#0B0B0B" />
                    </View>
                    <View className="min-w-0 flex-1">
                      <MarkdownishBoldLine
                        line={line}
                        className="text-[15px] leading-[22px] text-[#1A1A1A]"
                        boldClassName="font-semibold"
                      />
                      {onPickPrompt ? (
                        <Text className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-[#8A8278]">
                          Tap to ask
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#8A8278" />
                  </View>
                </Pressable>
              ))}
            </View>

            <View className="mt-4 flex-row items-center justify-end border-t border-[#F0EBE2] pt-3">
              <Pressable
                disabled={generating}
                onPress={() => void tryGenerate()}
                className="flex-row items-center gap-1.5 rounded-full border border-[#E6E1DA] bg-white px-3.5 py-2 active:bg-[#FAF7F2]"
              >
                {generating ? (
                  <ActivityIndicator size="small" color="#0B0B0B" />
                ) : (
                  <Ionicons name="refresh-outline" size={18} color="#0B0B0B" />
                )}
                <Text className="text-sm font-semibold text-[#0B0B0B]">
                  {generating ? "Updating…" : "Refresh recap"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {errorHint ? (
          <View
            className={`mt-4 rounded-2xl px-3 py-3 ${
              isSetupHint ? "bg-[#FFF4E5] border border-[#E8D4B8]" : "bg-red-50 border border-red-100"
            }`}
          >
            <View className="flex-row gap-2">
              <Ionicons
                name={isSetupHint ? "information-circle" : "alert-circle"}
                size={20}
                color={isSetupHint ? "#9A6B2D" : "#B91C1C"}
              />
              <Text
                className={`min-w-0 flex-1 text-sm leading-5 ${
                  isSetupHint ? "text-[#5C4A32]" : "text-red-800"
                }`}
              >
                {isSetupHint
                  ? "Run the SQL file supabase/migrations/20260430120000_weekly_nudge_chat.sql in Supabase (SQL Editor), then tap Build my recap again."
                  : errorHint}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

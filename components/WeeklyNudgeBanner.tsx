import {
  dismissWeekAnchor,
  getDismissedWeekAnchor,
  getWeeklyNudgeEnabled,
  subscribeNudgePreferenceChanges,
} from "@/lib/nudgePrefs";
import { supabase } from "@/lib/supabase";
import { utcWeekAnchorMonday } from "@/lib/weekAnchor";
import { fetchWeeklyRecap, generateWeeklyRecap, type WeeklyRecapRow } from "@/lib/weeklyRecap";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Lightweight weekly “nudge”: shows condensed recap bullets for this UTC week.
 * Applies after you run the SQL migration (`supabase/migrations/...weekly_nudge...sql`).
 */

export function WeeklyNudgeBanner() {
  const insets = useSafeAreaInsets();
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

  const onDismissBanner = useCallback(async () => {
    if (!userId) return;
    await dismissWeekAnchor(userId, weekAnchor);
    setDismissedAnchor(weekAnchor);
  }, [userId, weekAnchor]);

  if (loading || !userId || !prefsOn) return null;

  if (dismissedAnchor === weekAnchor) return null;

  return (
    <View
      className="border-b border-[#E6E1DA] bg-[#FFF9F0]"
      style={{ paddingTop: insets.top > 12 ? 4 : insets.top, paddingHorizontal: 16, paddingBottom: 10 }}
    >
      <View className="flex-row items-center justify-between gap-2 pb-1">
        <Text className="flex-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#6B6B6B]">
          This week
        </Text>
        <Pressable onPress={() => void onDismissBanner()} hitSlop={8} accessibilityLabel="Dismiss nudge banner">
          <Text className="text-xs font-semibold text-[#5F5F5F]">Dismiss</Text>
        </Pressable>
      </View>

      {!recap ? (
        <View className="gap-2 pt-1">
          <Text className="text-sm leading-5 text-[#3A3A3A]">
            Build a recap from uploads — things you typed under “I want to…” plus Action chat.
          </Text>
          <Pressable
            onPress={() => void tryGenerate()}
            disabled={generating}
            className="self-start rounded-full bg-[#0B0B0B] px-4 py-2.5 active:opacity-80 disabled:opacity-40"
          >
            {generating ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator color="#FFF" />
                <Text className="text-sm font-semibold text-white">Working…</Text>
              </View>
            ) : (
              <Text className="text-sm font-semibold text-white">Make my recap</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <View className="gap-1 pt-1">
          <Pressable onPress={() => setExpanded(!expanded)}>
            <Text className="text-[15px] leading-6 text-[#0B0B0B]" numberOfLines={expanded ? undefined : 5}>
              {recap.bullets}
            </Text>
          </Pressable>

          {recap.bullets.trim().length > 280 ? (
            <Text className="text-xs font-medium text-[#0B7AEE]">{expanded ? "Tap to shrink" : "Tap to expand"}</Text>
          ) : null}

          <Pressable
            className="mt-1 self-start"
            disabled={generating}
            onPress={() => void tryGenerate()}
          >
            <Text className="text-sm font-semibold text-[#5F5F5F]">Refresh recap</Text>
          </Pressable>
        </View>
      )}

      {errorHint ? (
        <Text className="mt-2 text-xs leading-5 text-red-600">{errorHint}</Text>
      ) : null}
    </View>
  );
}

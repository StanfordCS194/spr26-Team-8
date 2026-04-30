import { fetchWeeklyRecap, generateWeeklyRecap } from "@/lib/weeklyRecap";
import { utcWeekAnchorMonday } from "@/lib/weekAnchor";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";

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

export default function NotificationsTab() {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        setNotifications([]);
        return;
      }
      const row = await fetchWeeklyRecap(utcWeekAnchorMonday());
      setNotifications(row ? parseBulletLines(row.bullets) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return undefined;
    }, [refresh])
  );

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const row = await generateWeeklyRecap();
      setNotifications(row ? parseBulletLines(row.bullets) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate notifications.");
    } finally {
      setGenerating(false);
    }
  }, []);

  const subtitle = useMemo(
    () => `${notifications.length} ${notifications.length === 1 ? "notification" : "notifications"}`,
    [notifications.length]
  );

  return (
    <View className="flex-1 bg-[#F4F0EA]">
      <SafeAreaView className="flex-1 bg-[#F4F0EA]" edges={["left", "right", "bottom"]}>
        <Text className="px-5 pt-2 text-sm font-medium text-[#5F5F5F]">Assistant</Text>
        <Text className="px-5 pt-1 text-4xl font-bold tracking-[-0.5px] text-[#0B0B0B]">Notifications</Text>
        <Text className="px-5 pb-2 pt-1 text-xs font-medium uppercase tracking-[0.2em] text-[#6B6B6B]">
          {subtitle}
        </Text>

        <ScrollView className="flex-1 px-5" contentContainerClassName="pb-6">
          {loading ? (
            <View className="mt-10 flex-row items-center gap-2">
              <ActivityIndicator size="small" color="#0B0B0B" />
              <Text className="text-sm text-[#5F5F5F]">Loading notifications...</Text>
            </View>
          ) : notifications.length === 0 ? (
            <View className="mt-6 rounded-3xl border border-[#E8E0D4] bg-white p-4">
              <Text className="text-base font-semibold text-[#0B0B0B]">No notifications yet</Text>
              <Text className="mt-1 text-sm leading-5 text-[#6B6B6B]">
                Generate your weekly recap to get notification nudges.
              </Text>
            </View>
          ) : (
            <View className="gap-2.5">
              {notifications.map((line, idx) => (
                <View
                  key={`${idx}-${line.slice(0, 24)}`}
                  className="overflow-hidden rounded-2xl border border-[#E6E1DA] bg-[#FFFCF8] px-3.5 py-3 shadow-sm"
                >
                  <View className="flex-row items-start gap-2.5">
                    <View className="mt-0.5 h-6 w-6 items-center justify-center rounded-full bg-black/5">
                      <Ionicons name="notifications-outline" size={14} color="#0B0B0B" />
                    </View>
                    <Text className="min-w-0 flex-1 text-[15px] leading-[22px] text-[#1A1A1A]">{line}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {error ? (
            <View className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-3 py-3">
              <Text className="text-sm leading-5 text-red-800">{error}</Text>
            </View>
          ) : null}

          <View className="mt-4 flex-row items-center justify-end gap-2">
            <Pressable
              onPress={() => void refresh()}
              disabled={loading || generating}
              className="flex-row items-center gap-1.5 rounded-full border border-[#E6E1DA] bg-white px-3.5 py-2 active:bg-[#FAF7F2] disabled:opacity-50"
            >
              <Ionicons name="refresh-outline" size={18} color="#0B0B0B" />
              <Text className="text-sm font-semibold text-[#0B0B0B]">Refresh</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleGenerate()}
              disabled={generating}
              className="flex-row items-center gap-1.5 rounded-full bg-[#0B0B0B] px-3.5 py-2 active:opacity-80 disabled:opacity-50"
            >
              {generating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="sparkles-outline" size={16} color="#FFFFFF" />
              )}
              <Text className="text-sm font-semibold text-white">
                {generating ? "Generating..." : "Generate"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

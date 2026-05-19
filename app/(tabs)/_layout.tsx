import { useAuth } from "@/lib/auth";
import { isOnboardingComplete } from "@/lib/userProfile";
import { venn } from "@/lib/vennTheme";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function TabsLayout() {
  const { session, isLoading } = useAuth();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    if (!session?.user?.id) {
      setOnboardingChecked(true);
      setNeedsOnboarding(false);
      return;
    }
    let cancelled = false;
    void isOnboardingComplete(session.user.id).then((complete) => {
      if (cancelled) return;
      setNeedsOnboarding(!complete);
      setOnboardingChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  if (isLoading || (session && !onboardingChecked)) {
    return (
      <View className="flex-1 items-center justify-center bg-[#F4F0EA]">
        <ActivityIndicator size="small" color="#0B0B0B" />
      </View>
    );
  }

  if (!session) {
    // signed-out users always see the intro before the auth screen
    return <Redirect href="/intro" />;
  }

  if (needsOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F4F0EA" }} edges={["top", "left", "right"]}>
      <View style={{ flex: 1, minHeight: 0 }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarShowLabel: false,
            tabBarActiveTintColor: venn.text,
            tabBarInactiveTintColor: "rgba(95, 95, 95, 0.75)",
            tabBarStyle: {
              backgroundColor: venn.tabBar,
              borderTopWidth: 0,
              elevation: 0,
              shadowOpacity: 0,
              height: 64,
              paddingBottom: 10,
              paddingTop: 10,
            },
            tabBarItemStyle: {
              justifyContent: "center",
              alignItems: "center",
            },
          }}
        >
                    <Tabs.Screen
            name="archive"
            options={{
              title: "Library",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "albums" : "albums-outline"} size={22} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="action"
            options={{
              title: "Action",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "flash" : "flash-outline"} size={22} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="notifications"
            options={{
              title: "Inbox",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "mail" : "mail-outline"} size={22} color={color} />
              ),
            }}
          />
        </Tabs>
      </View>
    </SafeAreaView>
  );
}

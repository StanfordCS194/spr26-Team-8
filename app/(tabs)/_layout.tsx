import { useAuth } from "@/lib/auth";
import { venn } from "@/lib/vennTheme";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function TabsLayout() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
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
            name="action"
            options={{
              title: "Action",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "flash" : "flash-outline"} size={22} color={color} />
              ),
            }}
          />
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
            name="notifications"
            options={{
              title: "Inbox",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "sparkles" : "sparkles-outline"} size={22} color={color} />
              ),
            }}
          />
        </Tabs>
      </View>
    </SafeAreaView>
  );
}

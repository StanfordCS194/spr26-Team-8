import { useAuth } from "@/lib/auth";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";

export default function TabsLayout() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="small" color="#3B82F6" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/auth" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#3B82F6",
        tabBarInactiveTintColor: "#9CA3AF",
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopColor: "#E5E7EB",
          borderTopWidth: 1,
          height: 72,
          paddingBottom: 0,
          paddingTop: 10,
        },
        tabBarItemStyle: {
          justifyContent: "center",
          alignItems: "center",
        },
        tabBarLabelStyle: {
          fontSize: 14,
          fontWeight: "800",
          marginBottom: 0,
          marginTop: -2,
        },
        tabBarIcon: () => null,
        tabBarIconStyle: {
          display: "none",
        },
      }}
    >
      <Tabs.Screen name="archive" options={{ title: "Archive" }} />
      <Tabs.Screen name="action" options={{ title: "Action" }} />
    </Tabs>
  );
}

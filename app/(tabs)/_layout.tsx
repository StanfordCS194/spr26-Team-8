import { Tabs } from "expo-router";

export default function TabsLayout() {
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

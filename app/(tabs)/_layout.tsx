import { venn } from "@/lib/vennTheme";
import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: venn.text,
        tabBarInactiveTintColor: "rgba(95, 95, 95, 0.75)",
        tabBarStyle: {
          backgroundColor: venn.tabBar,
          borderTopColor: venn.hairline,
          borderTopWidth: 0.5,
          height: 78,
          paddingBottom: 10,
          paddingTop: 10,
        },
        tabBarItemStyle: {
          justifyContent: "center",
          alignItems: "center",
        },
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: "600",
          marginBottom: 0,
          marginTop: 0,
          letterSpacing: 0.1,
        },
        tabBarIcon: () => null,
        tabBarIconStyle: {
          display: "none",
        },
      }}
    >
      <Tabs.Screen name="archive" options={{ title: "Library" }} />
      <Tabs.Screen name="action" options={{ title: "Action" }} />
    </Tabs>
  );
}

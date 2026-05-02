import { Stack } from "expo-router";
import { AuthProvider } from "@/lib/auth";
import { posthog } from "@/lib/posthog";
import { ShareIntentProvider } from "expo-share-intent";
import { PostHogProvider } from "posthog-react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";

export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <SafeAreaProvider>
        <PostHogProvider client={posthog}>
          <AuthProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </AuthProvider>
        </PostHogProvider>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}

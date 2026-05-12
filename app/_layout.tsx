import { Stack } from "expo-router";
import { AuthProvider } from "@/lib/auth";
import { posthog, resetSessionId, track } from "@/lib/posthog";
import { PostHogProvider } from "posthog-react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import "../global.css";

// fires session_start / session_end so we can compute average session duration
// and join every other event on session_id
function SessionTracker() {
  const sessionStartedAt = useRef<number | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    // initial foreground when the app boots
    if (appState.current === "active") {
      resetSessionId();
      sessionStartedAt.current = Date.now();
      track("session_start");
    }

    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;
      if (prev !== "active" && next === "active") {
        // resumed from background, start a fresh session
        resetSessionId();
        sessionStartedAt.current = Date.now();
        track("session_start");
      } else if (prev === "active" && (next === "background" || next === "inactive")) {
        const startedAt = sessionStartedAt.current;
        if (startedAt !== null) {
          track("session_end", { duration_ms: Date.now() - startedAt });
          sessionStartedAt.current = null;
        }
      }
    });
    return () => sub.remove();
  }, []);

  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PostHogProvider client={posthog}>
        <SessionTracker />
        <AuthProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </AuthProvider>
      </PostHogProvider>
    </SafeAreaProvider>
  );
}

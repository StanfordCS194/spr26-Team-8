import { Alert, Platform, Share } from "react-native";

/**
 * Puts assistant text on the clipboard on web.
 * On native, opens the system share sheet so the user can tap Copy (no expo-clipboard
 * native module required — avoids crashes when the dev client wasn't rebuilt).
 */
export async function copyChatOutput(messageText: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      await navigator.clipboard.writeText(messageText);
      Alert.alert("Copied", "Paste this text anywhere you like.");
    } catch {
      Alert.alert("Copy failed", "Clipboard isn't available in this browser.");
    }
    return;
  }

  try {
    await Share.share({ message: messageText });
  } catch (err) {
    Alert.alert(
      "Couldn't share",
      err instanceof Error ? err.message : "Something went wrong.",
    );
  }
}

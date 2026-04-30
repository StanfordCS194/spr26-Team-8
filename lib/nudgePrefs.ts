import AsyncStorage from "@react-native-async-storage/async-storage";

const ENABLED_KEY = "venn:weekly_nudge_enabled";
const DISMISS_PREFIX = "venn:weekly_nudge_dismissed:";

const prefsListeners = new Set<() => void>();

/** Notify listeners after preference changes (e.g. WeeklyNudgeBanner). */
export function subscribeNudgePreferenceChanges(listener: () => void): () => void {
  prefsListeners.add(listener);
  return () => prefsListeners.delete(listener);
}

function notifyPrefListeners() {
  prefsListeners.forEach((l) => l());
}

export async function getWeeklyNudgeEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(ENABLED_KEY);
    if (v === null) return true;
    return v === "1";
  } catch {
    return true;
  }
}

export async function setWeeklyNudgeEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  notifyPrefListeners();
}

export async function getDismissedWeekAnchor(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(DISMISS_PREFIX + userId);
  } catch {
    return null;
  }
}

/** Hide the banner for `weekAnchor` until the next weekly anchor rolls over in the caller. */
export async function dismissWeekAnchor(userId: string, weekAnchor: string): Promise<void> {
  await AsyncStorage.setItem(DISMISS_PREFIX + userId, weekAnchor);
}

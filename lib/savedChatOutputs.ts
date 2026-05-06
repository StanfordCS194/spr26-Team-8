import AsyncStorage from "@react-native-async-storage/async-storage";

const SAVED_CHAT_OUTPUTS_KEY = "venn_saved_chat_outputs_v1";

export type SavedChatOutput = {
  id: string;
  title: string;
  preview: string;
  created_at: string;
  full_text: string;
};

function buildTitle(text: string): string {
  const first = text.split(/\n/).map((x) => x.trim()).find(Boolean) ?? "Saved output";
  return first.length > 56 ? `${first.slice(0, 55)}…` : first;
}

export function suggestSavedChatOutputTitle(text: string): string {
  return buildTitle(text);
}

function capTitle(title: string): string {
  return title.length > 56 ? `${title.slice(0, 55)}…` : title;
}

function buildPreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 180 ? `${flat.slice(0, 179)}…` : flat;
}

export async function loadSavedChatOutputs(): Promise<SavedChatOutput[]> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_CHAT_OUTPUTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedChatOutput[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export async function saveChatOutput(
  text: string,
  opts?: { title?: string }
): Promise<SavedChatOutput[]> {
  const cleaned = text.trim();
  if (!cleaned) return loadSavedChatOutputs();

  const existing = await loadSavedChatOutputs();
  const dupe = existing.find((x) => x.full_text.trim() === cleaned);
  if (dupe) return existing;

  const now = new Date().toISOString();
  const preferredTitle = opts?.title?.trim() ?? "";
  const item: SavedChatOutput = {
    id: `saved-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: preferredTitle ? capTitle(preferredTitle) : buildTitle(cleaned),
    preview: buildPreview(cleaned),
    created_at: now,
    full_text: cleaned,
  };

  const next = [item, ...existing].slice(0, 100);
  await AsyncStorage.setItem(SAVED_CHAT_OUTPUTS_KEY, JSON.stringify(next));
  return next;
}

export async function removeSavedChatOutput(id: string): Promise<SavedChatOutput[]> {
  const existing = await loadSavedChatOutputs();
  const next = existing.filter((item) => item.id !== id);
  await AsyncStorage.setItem(SAVED_CHAT_OUTPUTS_KEY, JSON.stringify(next));
  return next;
}

export async function updateSavedChatOutputTitle(
  id: string,
  title: string
): Promise<SavedChatOutput[]> {
  const cleaned = title.trim();
  if (!cleaned) return loadSavedChatOutputs();
  const existing = await loadSavedChatOutputs();
  const next = existing.map((item) =>
    item.id === id ? { ...item, title: capTitle(cleaned) } : item
  );
  await AsyncStorage.setItem(SAVED_CHAT_OUTPUTS_KEY, JSON.stringify(next));
  return next;
}

import AsyncStorage from "@react-native-async-storage/async-storage";

// one key per user so sessions stay isolated
const KEY_PREFIX = "venn:archive_signed_urls:";

export type CachedSignedUrl = { url: string; expiresAt: number };

// load whatever's on disk and toss anything that's already expired
export async function loadSignedUrlCache(userId: string): Promise<Map<string, CachedSignedUrl>> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return new Map();
    const parsed: Record<string, CachedSignedUrl> = JSON.parse(raw);
    const now = Date.now();
    const out = new Map<string, CachedSignedUrl>();
    for (const [path, entry] of Object.entries(parsed)) {
      if (entry?.url && entry.expiresAt > now) out.set(path, entry);
    }
    return out;
  } catch {
    // corrupt or missing, start fresh
    return new Map();
  }
}

// best-effort write. if it fails we just regenerate URLs next launch
export async function saveSignedUrlCache(
  userId: string,
  cache: Map<string, CachedSignedUrl>
): Promise<void> {
  try {
    const obj: Record<string, CachedSignedUrl> = {};
    for (const [k, v] of cache) obj[k] = v;
    await AsyncStorage.setItem(KEY_PREFIX + userId, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

// wipe the cache for a user (e.g. on sign out, so signed URLs don't linger)
export async function clearSignedUrlCache(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_PREFIX + userId);
  } catch {
    // ignore
  }
}

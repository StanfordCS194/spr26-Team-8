import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";

/** @deprecated Legacy flat hash set — cleared on read. */
const LEGACY_CONTENT_HASH_KEY_PREFIX = "venn_upload_content_hashes_v1:";
const HASH_BY_MEMORY_KEY_PREFIX = "venn_upload_hash_by_memory_v1:";
const MAX_STORED_ENTRIES = 500;
/** Hash only a prefix of the file — full SHA-256 on multi‑MB JPEGs blocks the RN JS thread. */
const CONTENT_HASH_SAMPLE_BYTES = 64 * 1024;

export type LibraryFileRef = { searchFileName: string };

/** Stable suffix stored as `{timestamp}-{suffix}` in `files.file_name`. */
export function uploadNameSuffix(
  rawName: string,
  sanitizedBaseName: string,
  wasJpeg: boolean
): string {
  const base = rawName.replace(/[^\w.\-]/g, "_");
  return (wasJpeg ? base : `${sanitizedBaseName}.jpeg`).toLowerCase();
}

export function libraryItemsIncludeNameSuffix(
  items: LibraryFileRef[],
  suffix: string
): boolean {
  const needle = suffix.toLowerCase();
  if (!needle) return false;
  return items.some((item) => {
    const fn = item.searchFileName?.toLowerCase() ?? "";
    return fn === needle || fn.endsWith(`-${needle}`);
  });
}

export async function remoteLibraryHasNameSuffix(
  userId: string,
  suffix: string
): Promise<boolean> {
  if (!suffix) return false;
  const { data, error } = await supabase
    .from("files")
    .select("file_id")
    .eq("user_id", userId)
    .ilike("file_name", `%-${suffix}`)
    .limit(1);
  if (error) return false;
  return Boolean(data?.length);
}

function hashByMemoryStorageKey(userId: string): string {
  return `${HASH_BY_MEMORY_KEY_PREFIX}${userId}`;
}

async function loadHashByMemory(userId: string): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(hashByMemoryStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveHashByMemory(userId: string, map: Record<string, string>): Promise<void> {
  const entries = Object.entries(map).slice(0, MAX_STORED_ENTRIES);
  await AsyncStorage.setItem(
    hashByMemoryStorageKey(userId),
    JSON.stringify(Object.fromEntries(entries))
  );
}

function digestToHex(digestBuf: ArrayBuffer): string {
  const hashBytes = new Uint8Array(digestBuf);
  return Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function contentHashOfUpload(arrayBuffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(arrayBuffer);
  const sample =
    bytes.byteLength <= CONTENT_HASH_SAMPLE_BYTES
      ? bytes
      : bytes.subarray(0, CONTENT_HASH_SAMPLE_BYTES);
  const digestBuf = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, sample);
  return `${bytes.byteLength}:${digestToHex(digestBuf)}`;
}

/** True only if this hash belongs to a memory that still exists in the library. */
export async function libraryHasContentHash(
  userId: string,
  contentHash: string,
  activeMemoryIds?: Set<string>
): Promise<boolean> {
  const map = await loadHashByMemory(userId);
  const memoryIds = Object.entries(map)
    .filter(([, hash]) => hash === contentHash)
    .map(([memoryId]) => memoryId);
  if (!memoryIds.length) return false;

  if (activeMemoryIds?.size) {
    if (memoryIds.some((id) => activeMemoryIds.has(id))) return true;
  }

  const { data, error } = await supabase
    .from("memories")
    .select("memory_id")
    .eq("user_id", userId)
    .in("memory_id", memoryIds)
    .limit(1);
  if (error) return false;
  return Boolean(data?.length);
}

export async function rememberUploadContentHash(
  userId: string,
  memoryId: string,
  contentHash: string
): Promise<void> {
  const map = await loadHashByMemory(userId);
  map[memoryId] = contentHash;
  await saveHashByMemory(userId, map);
}

export async function forgetUploadContentHash(
  userId: string,
  memoryId: string
): Promise<void> {
  const map = await loadHashByMemory(userId);
  if (!(memoryId in map)) return;
  delete map[memoryId];
  await saveHashByMemory(userId, map);
}

/** Name (from picker) and/or pixel hash — only blocks if the file is still in the library. */
export async function isDuplicateLibraryUpload(opts: {
  userId: string;
  items: LibraryFileRef[];
  nameSuffix: string;
  contentHash: string;
  activeMemoryIds?: string[];
}): Promise<boolean> {
  if (opts.nameSuffix && libraryItemsIncludeNameSuffix(opts.items, opts.nameSuffix)) {
    return true;
  }

  const activeSet = opts.activeMemoryIds?.length
    ? new Set(opts.activeMemoryIds)
    : undefined;

  const [remoteNameDup, contentDup] = await Promise.all([
    opts.nameSuffix
      ? remoteLibraryHasNameSuffix(opts.userId, opts.nameSuffix)
      : Promise.resolve(false),
    opts.contentHash
      ? libraryHasContentHash(opts.userId, opts.contentHash, activeSet)
      : Promise.resolve(false),
  ]);

  return remoteNameDup || contentDup;
}

/** One-time cleanup of the old flat hash list (no longer read). */
export async function clearLegacyUploadContentHashes(userId: string): Promise<void> {
  await AsyncStorage.removeItem(`${LEGACY_CONTENT_HASH_KEY_PREFIX}${userId}`);
}

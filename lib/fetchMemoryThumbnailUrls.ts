import { supabase } from "@/lib/supabase";

const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7;

export type RelatedMemoryThumbnail = {
  memoryId: string;
  uri: string;
};

type MemoryFileRow = {
  memory_id: string;
  files:
    | { storage_path: string }
    | { storage_path: string }[]
    | null;
};

/**
 * Signed URLs for the user's memory photos (same bucket as Library).
 * Preserves order of `memoryIds` (first occurrence only); skips missing files.
 */
export async function fetchRelatedMemoryThumbnails(
  memoryIds: string[]
): Promise<RelatedMemoryThumbnail[]> {
  const seen = new Set<string>();
  const uniq = memoryIds.filter((id) => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (uniq.length === 0) return [];

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  const { data: rows, error } = await supabase
    .from("memories")
    .select("memory_id, files(storage_path)")
    .eq("user_id", auth.user.id)
    .in("memory_id", uniq);

  if (error || !rows?.length) return [];

  const pathByMemory = new Map<string, string>();
  for (const row of rows as MemoryFileRow[]) {
    const file = Array.isArray(row.files) ? row.files[0] : row.files;
    const path = file?.storage_path?.trim();
    if (path) pathByMemory.set(String(row.memory_id), path);
  }

  const paths = [...new Set([...pathByMemory.values()])];
  if (paths.length === 0) return [];

  const { data: signed } = await supabase.storage
    .from("memories")
    .createSignedUrls(paths, SIGNED_URL_TTL_SEC);

  const urlByPath = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  const out: RelatedMemoryThumbnail[] = [];
  const thumbSeen = new Set<string>();
  for (const id of memoryIds) {
    if (!id || thumbSeen.has(id)) continue;
    const path = pathByMemory.get(id);
    const uri = path ? urlByPath.get(path) : undefined;
    if (uri) {
      thumbSeen.add(id);
      out.push({ memoryId: id, uri });
    }
  }
  return out;
}

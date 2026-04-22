import * as FileSystem from "expo-file-system/legacy";

/**
 * Text extracted from images (OCR), scene labels, or transcripts — merged into `searchBlob` via
 * `enrichArchiveRows({ searchableTextById })`. Persists across launches so search works offline.
 */
const STORE_VERSION = 1;
const storePath = `${FileSystem.documentDirectory ?? ""}venn-archive-supplemental-search.json`;

type StoreFile = {
  version: number;
  byId: Record<string, string>;
};

export async function loadSupplementalSearchText(): Promise<Record<string, string>> {
  if (!FileSystem.documentDirectory) return {};
  try {
    const info = await FileSystem.getInfoAsync(storePath);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(storePath);
    const parsed = JSON.parse(raw) as StoreFile;
    if (!parsed || parsed.version !== STORE_VERSION || !parsed.byId || typeof parsed.byId !== "object") {
      return {};
    }
    return parsed.byId;
  } catch {
    return {};
  }
}

async function writeAll(byId: Record<string, string>): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  const payload: StoreFile = { version: STORE_VERSION, byId };
  await FileSystem.writeAsStringAsync(storePath, JSON.stringify(payload));
}

function mergeChunk(prev: string | undefined, add: string): string {
  const a = (prev ?? "").trim();
  const b = add.trim();
  if (!b) return a;
  if (!a) return b;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a} ${b}`;
}

export async function removeSupplementalSearchText(id: string): Promise<Record<string, string>> {
  const current = await loadSupplementalSearchText();
  if (!(id in current)) return current;
  const next = { ...current };
  delete next[id];
  await writeAll(next);
  return next;
}

/**
 * Merge new OCR/caption text for an archive id and persist.
 * Reloads from disk first so concurrent uploads do not clobber each other.
 */
export async function upsertSupplementalSearchText(id: string, chunk: string): Promise<Record<string, string>> {
  const current = await loadSupplementalSearchText();
  const merged = mergeChunk(current[id], chunk);
  if (!merged) return current;
  const next = { ...current, [id]: merged };
  await writeAll(next);
  return next;
}

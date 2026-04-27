import * as FileSystem from "expo-file-system/legacy";

/** Sidecar metadata so we do not touch upload paths or teammate-owned stores. */
export type ArchiveItemMeta = {
  tags: string[];
};

/** Id + filename pair used by every archive enrichment / sync function. */
export type ArchiveIdRef = { id: string; fileName: string };

export type EnrichedArchiveItem = {
  id: string;
  fileName: string;
  tags: string[];
  theme: string;
  searchBlob: string;
};

/** Why a row matched — Photos-style explainability; cap in UI. */
export type ArchiveSearchMatchHighlight = {
  kind: "filename" | "tag" | "theme" | "meta";
  /** Short label shown in UI */
  label: string;
  /** Matched value (tag text, file name, etc.) */
  value: string;
};

export type ArchiveSearchResult = {
  row: EnrichedArchiveItem;
  /** Higher = stronger match; used for ordering. */
  score: number;
  highlights: ArchiveSearchMatchHighlight[];
};

const META_VERSION = 1;
const metaPath = `${FileSystem.documentDirectory ?? ""}venn-archive-item-meta.json`;

type MetaFile = {
  version: number;
  items: Record<string, ArchiveItemMeta>;
};

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "of",
  "in",
  "on",
  "at",
  "to",
  "from",
  "with",
  "img",
  "image",
  "screenshot",
  "photo",
  "pic",
  "new",
  "copy",
  "dsc",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

const THEME_RULES: { theme: string; needles: string[] }[] = [
  {
    theme: "food",
    needles: [
      "food",
      "restaurant",
      "cafe",
      "coffee",
      "lunch",
      "dinner",
      "recipe",
      "kitchen",
      "eat",
      "market",
      "bakery",
      "bar",
    ],
  },
  {
    theme: "travel",
    needles: ["travel", "trip", "flight", "hotel", "airbnb", "map", "city", "visit", "tour"],
  },
  {
    theme: "fashion",
    needles: ["outfit", "fashion", "clothing", "dress", "ring", "jewelry", "style", "wear"],
  },
  {
    theme: "study",
    needles: ["study", "class", "lecture", "notes", "homework", "exam", "semester", "school"],
  },
  {
    theme: "social",
    needles: ["friend", "party", "birthday", "hangout", "meetup", "club"],
  },
  {
    theme: "work",
    needles: ["job", "intern", "startup", "work", "career", "fair", "interview", "office"],
  },
  {
    theme: "media",
    needles: ["tiktok", "insta", "reel", "video", "podcast", "article"],
  },
];

export function fileNameFromArchiveId(id: string): string {
  if (id.startsWith("uploaded-")) return id.slice("uploaded-".length);
  return id.replace(/^\.\//, "");
}

export function inferTagsFromFileName(fileName: string): string[] {
  const base = fileName.replace(/\.[^.]+$/i, "").toLowerCase();
  const parts = base.split(/[^a-z0-9]+/i).filter(Boolean);
  const tags = [...new Set(parts.filter((p) => p.length > 1 && !STOPWORDS.has(p)))];
  return tags.slice(0, 12);
}

export function inferTheme(tags: string[], fileName: string): string {
  const hay = `${tags.join(" ")} ${fileName}`.toLowerCase();
  for (const rule of THEME_RULES) {
    if (rule.needles.some((n) => hay.includes(n))) return rule.theme;
  }
  return "life";
}

export function buildSearchBlob(
  id: string,
  fileName: string,
  tags: string[],
  theme: string,
  extraSearchText?: string
): string {
  const base = [id, fileName, ...tags, theme].join(" ").toLowerCase();
  const extra = (extraSearchText ?? "").trim().toLowerCase();
  return extra ? `${base} ${extra}` : base;
}

/**
 * Split query into tokens (AND semantics: every token must match somewhere in the blob).
 * Alphanumeric chunks only; empty query → no tokens (no text filter).
 */
export function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .trim()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0);
}

function rowMatchesAllTokens(row: EnrichedArchiveItem, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = row.searchBlob;
  return tokens.every((t) => hay.includes(t));
}

const SCORE_FILENAME_WORD = 150;
const SCORE_FILENAME_SUBSTRING = 110;
const SCORE_TAG_EXACT = 95;
const SCORE_TAG_PREFIX = 68;
const SCORE_TAG_SUBSTRING = 48;
const SCORE_THEME_EXACT = 38;
const SCORE_THEME_SUBSTRING = 22;
const SCORE_ID_SUBSTRING = 12;

function scoreTokenAgainstRow(
  token: string,
  row: EnrichedArchiveItem
): { score: number; highlight: ArchiveSearchMatchHighlight | null } {
  const fn = row.fileName.toLowerCase();
  const stem = fn.replace(/\.[^.]+$/i, "");
  const fnWords = stem.split(/[^a-z0-9]+/i).filter(Boolean);

  let best = { score: 0, highlight: null as ArchiveSearchMatchHighlight | null };

  const consider = (score: number, highlight: ArchiveSearchMatchHighlight) => {
    if (score > best.score) best = { score, highlight };
  };

  if (fnWords.some((w) => w === token)) {
    consider(SCORE_FILENAME_WORD, {
      kind: "filename",
      label: "File name",
      value: row.fileName,
    });
  } else if (stem.includes(token) || fn.includes(token)) {
    consider(SCORE_FILENAME_SUBSTRING, {
      kind: "filename",
      label: "File name",
      value: row.fileName,
    });
  }

  for (const tag of row.tags) {
    const t = tag.toLowerCase();
    if (t === token) {
      consider(SCORE_TAG_EXACT, { kind: "tag", label: "Tag", value: tag });
    } else if (t.startsWith(token)) {
      consider(SCORE_TAG_PREFIX, { kind: "tag", label: "Tag", value: tag });
    } else if (t.includes(token)) {
      consider(SCORE_TAG_SUBSTRING, { kind: "tag", label: "Tag", value: tag });
    }
  }

  const th = row.theme.toLowerCase();
  if (th === token) {
    consider(SCORE_THEME_EXACT, { kind: "theme", label: "Category", value: row.theme });
  } else if (th.includes(token)) {
    consider(SCORE_THEME_SUBSTRING, { kind: "theme", label: "Category", value: row.theme });
  }

  if (row.id.toLowerCase().includes(token)) {
    consider(SCORE_ID_SUBSTRING, { kind: "meta", label: "Reference", value: token });
  }

  if (best.score === 0 && row.searchBlob.includes(token)) {
    consider(1, { kind: "meta", label: "Match", value: token });
  }

  return best;
}

function dedupeHighlights(items: ArchiveSearchMatchHighlight[], max = 4): ArchiveSearchMatchHighlight[] {
  const seen = new Set<string>();
  const out: ArchiveSearchMatchHighlight[] = [];
  for (const h of items) {
    const key = `${h.kind}:${h.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

function scoreAndHighlightsForRow(
  row: EnrichedArchiveItem,
  tokens: string[]
): { score: number; highlights: ArchiveSearchMatchHighlight[] } {
  if (tokens.length === 0) return { score: 0, highlights: [] };

  let total = 0;
  const highlightParts: ArchiveSearchMatchHighlight[] = [];

  for (const token of tokens) {
    const { score, highlight } = scoreTokenAgainstRow(token, row);
    total += score;
    if (highlight) highlightParts.push(highlight);
  }

  return { score: total, highlights: dedupeHighlights(highlightParts) };
}

/**
 * Theme filter + token AND search + relevance sort (filename & exact tags rank above loose blob).
 * Designed so the same ranking logic can move server-side for huge libraries (inverted index later).
 */
export function searchAndRankArchiveRows(
  rows: EnrichedArchiveItem[],
  query: string,
  theme: "all" | string
): ArchiveSearchResult[] {
  const tokens = tokenizeSearchQuery(query);

  const themed = rows.filter((row) => theme === "all" || row.theme === theme);

  if (tokens.length === 0) {
    return themed.map((row) => ({ row, score: 0, highlights: [] }));
  }

  const matched = themed.filter((row) => rowMatchesAllTokens(row, tokens));

  const scored = matched.map((row) => {
    const { score, highlights } = scoreAndHighlightsForRow(row, tokens);
    return { row, score, highlights };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.row.fileName.localeCompare(b.row.fileName);
  });

  return scored;
}

async function readMetaFile(): Promise<Record<string, ArchiveItemMeta>> {
  if (!FileSystem.documentDirectory) return {};
  try {
    const info = await FileSystem.getInfoAsync(metaPath);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(metaPath);
    const parsed = JSON.parse(raw) as MetaFile;
    if (!parsed || parsed.version !== META_VERSION || !parsed.items || typeof parsed.items !== "object") {
      return {};
    }
    return parsed.items;
  } catch {
    return {};
  }
}

async function writeMetaFile(items: Record<string, ArchiveItemMeta>): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  const payload: MetaFile = { version: META_VERSION, items };
  await FileSystem.writeAsStringAsync(metaPath, JSON.stringify(payload));
}

/**
 * Ensures every item id has metadata. New ids get tags inferred from the file name only.
 * Existing entries are left unchanged so teammates (or a future API) can enrich tags safely.
 */
export async function hydrateArchiveMeta(
  ids: { id: string; fileName: string }[]
): Promise<Record<string, ArchiveItemMeta>> {
  const existing = await readMetaFile();
  const next = { ...existing };
  let changed = false;

  for (const { id, fileName } of ids) {
    if (next[id]) continue;
    const tags = inferTagsFromFileName(fileName);
    next[id] = { tags };
    changed = true;
  }

  if (changed) await writeMetaFile(next);
  return next;
}

/** Merge remote/pipeline hints into local sidecar meta without deleting existing keys. */
export function mergeArchiveMeta(
  local: Record<string, ArchiveItemMeta>,
  remote: Record<string, Partial<ArchiveItemMeta> | undefined>
): Record<string, ArchiveItemMeta> {
  const out: Record<string, ArchiveItemMeta> = { ...local };
  for (const [id, patch] of Object.entries(remote)) {
    if (!patch?.tags?.length) continue;
    const prev = out[id]?.tags ?? [];
    out[id] = { tags: [...new Set([...prev, ...patch.tags])] };
  }
  return out;
}

export type EnrichArchiveOptions = {
  /** When embeddings / backend supply a cluster label, it wins over keyword `inferTheme`. */
  themeOverrides?: Record<string, string>;
  /**
   * Extra searchable text per item (captions, transcripts, OCR, notes) — folded into `searchBlob` only.
   * When you have thousands of multimodal items, populate from backend sync; ranking stays client-side until indexed.
   */
  searchableTextById?: Record<string, string>;
};

export function enrichArchiveRows(
  ids: string[],
  meta: Record<string, ArchiveItemMeta>,
  options?: EnrichArchiveOptions
): EnrichedArchiveItem[] {
  return ids.map((id) => {
    const fileName = fileNameFromArchiveId(id);
    const tags =
      meta[id]?.tags && meta[id].tags.length > 0 ? meta[id].tags : inferTagsFromFileName(fileName);
    const theme =
      options?.themeOverrides?.[id] && options.themeOverrides[id].length > 0
        ? options.themeOverrides[id]
        : inferTheme(tags, fileName);
    const extra = options?.searchableTextById?.[id];
    const searchBlob = buildSearchBlob(id, fileName, tags, theme, extra);
    return { id, fileName, tags, theme, searchBlob };
  });
}

/** Snapshot shape you can POST to a backend later without changing the UI module. */
export function archiveIndexForBackend(rows: EnrichedArchiveItem[]) {
  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    tags: r.tags,
    theme: r.theme,
  }));
}

/** @deprecated Prefer `searchAndRankArchiveRows` for ranked results + highlights. */
export function filterBySearchAndTheme(
  rows: EnrichedArchiveItem[],
  query: string,
  theme: "all" | string
): EnrichedArchiveItem[] {
  return searchAndRankArchiveRows(rows, query, theme).map((r) => r.row);
}

export function distinctThemes(rows: EnrichedArchiveItem[]): string[] {
  return [...new Set(rows.map((r) => r.theme))].sort((a, b) => a.localeCompare(b));
}

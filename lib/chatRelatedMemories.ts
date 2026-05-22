export type MemoryMatchCandidate = {
  memory_id: string;
  haystack: string;
};

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "with",
  "that",
  "this",
  "from",
  "have",
  "been",
  "were",
  "was",
  "are",
  "will",
  "would",
  "could",
  "some",
  "there",
  "their",
  "into",
  "what",
  "when",
  "where",
  "which",
  "about",
  "also",
  "like",
  "just",
  "make",
  "made",
  "many",
  "more",
  "much",
  "than",
  "then",
  "them",
  "these",
  "those",
  "very",
  "such",
  "each",
  "both",
  "few",
  "may",
  "might",
  "must",
  "can",
  "had",
  "how",
  "why",
  "who",
  "way",
  "week",
  "weekend",
  "today",
  "great",
  "good",
  "nice",
  "best",
  "idea",
  "plan",
  "plans",
  "things",
  "thing",
  "stuff",
  "sure",
  "want",
  "maybe",
  "really",
  "getting",
  "little",
  "lots",
  "morning",
  "afternoon",
  "evening",
  "tomorrow",
  "today",
  "simple",
  "popular",
  "great",
  "easy",
  "enjoy",
  "fresh",
  "start",
  "head",
  "city",
  "urban",
]);

/** Stricter matching so unrelated Library photos are not shown. */
export const CHAT_RELATED_MEMORY_OPTS = {
  maxPick: 4,
  minScore: 3,
  minMatchCount: 2,
} as const;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function overlapMetrics(
  replyTokens: Set<string>,
  haystack: string
): { score: number; matchCount: number } {
  let score = 0;
  let matchCount = 0;
  for (const t of tokenize(haystack)) {
    if (!replyTokens.has(t)) continue;
    matchCount += 1;
    score += t.length >= 6 ? 3 : t.length >= 5 ? 2 : 1;
  }
  return { score, matchCount };
}

/**
 * Pick memories plausibly referenced by the assistant reply (same lexical cues as snippet text).
 */
export function pickRelatedMemoryIds(
  assistantReply: string,
  candidates: MemoryMatchCandidate[],
  opts?: {
    maxPick?: number;
    minScore?: number;
    minMatchCount?: number;
    /** Memory IDs already shown on a prior bubble in this reply — skip repeats. */
    excludeMemoryIds?: Iterable<string>;
  }
): string[] {
  const maxPick = opts?.maxPick ?? CHAT_RELATED_MEMORY_OPTS.maxPick;
  const minScore = opts?.minScore ?? CHAT_RELATED_MEMORY_OPTS.minScore;
  const minMatchCount = opts?.minMatchCount ?? CHAT_RELATED_MEMORY_OPTS.minMatchCount;
  const exclude = new Set(opts?.excludeMemoryIds ?? []);

  const replyTokens = new Set(tokenize(assistantReply));
  if (replyTokens.size === 0 || candidates.length === 0) return [];

  const scored = candidates
    .map((c) => {
      const { score, matchCount } = overlapMetrics(replyTokens, c.haystack);
      return { memory_id: c.memory_id, score, matchCount };
    })
    .filter((s) => s.score >= minScore && s.matchCount >= minMatchCount)
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of scored) {
    if (seen.has(row.memory_id) || exclude.has(row.memory_id)) continue;
    seen.add(row.memory_id);
    out.push(row.memory_id);
    if (out.length >= maxPick) break;
  }
  return out;
}

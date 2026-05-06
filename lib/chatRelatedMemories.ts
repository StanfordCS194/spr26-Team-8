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
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Score overlap between assistant reply and memory captions/OCR (weighted toward longer tokens). */
function overlapScore(replyTokens: Set<string>, haystack: string): number {
  let score = 0;
  for (const t of tokenize(haystack)) {
    if (!replyTokens.has(t)) continue;
    score += t.length >= 6 ? 3 : t.length >= 5 ? 2 : 1;
  }
  return score;
}

/**
 * Pick memories plausibly referenced by the assistant reply (same lexical cues as snippet text).
 */
export function pickRelatedMemoryIds(
  assistantReply: string,
  candidates: MemoryMatchCandidate[],
  opts?: { maxPick?: number; minScore?: number }
): string[] {
  const maxPick = opts?.maxPick ?? 4;
  const minScore = opts?.minScore ?? 2;

  const replyTokens = new Set(tokenize(assistantReply));
  if (replyTokens.size === 0 || candidates.length === 0) return [];

  const scored = candidates
    .map((c) => ({
      memory_id: c.memory_id,
      score: overlapScore(replyTokens, c.haystack),
    }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of scored) {
    if (seen.has(row.memory_id)) continue;
    seen.add(row.memory_id);
    out.push(row.memory_id);
    if (out.length >= maxPick) break;
  }
  return out;
}
